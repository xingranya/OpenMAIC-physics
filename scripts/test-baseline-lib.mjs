/**
 * 「全量测试失败集合 vs 上游基线」的判定逻辑。
 *
 * ## 为什么要抽出来
 *
 * 这段判定原本直接写在 `scripts/check-test-baseline.mjs` 里，而那个脚本在
 * 模块顶层就会跑完整个对照流程（解基线树 + 两侧全量 vitest，十分钟量级）。
 * 于是它**无法被测试覆盖**——而它恰恰是「本分支有没有引入回归」的唯一
 * 自动化判据。抽成纯函数后就能被单测钉住。
 *
 * 顺带修掉一个此前没人发现的语义错误：「相比基线不再失败」里混着
 * **文件已被本分支删除**的情况（特性整个移除，测试文件随之删除），
 * 把它说成「本分支顺手修好的」是错的。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 从 vitest 的 JSON 报告里读出失败的测试文件集合。
 *
 * 返回的是**相对于 `root` 的路径**：两侧（当前树 / 基线树）必须用同一套
 * 相对路径才能比对——绝对路径带各自的前缀，永远比不相等，
 * 「本分支修好了哪些」那一栏就会变成全量误报。
 *
 * @param {string} reportPath vitest JSON 报告路径
 * @param {string} root 用于计算相对路径的根目录
 * @returns {Set<string>|null} 失败文件集合；报告不存在时返回 null
 */
export function failedFiles(reportPath, root) {
  if (!existsSync(reportPath)) return null;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const failed = new Set();
  for (const file of report.testResults ?? []) {
    // 注意：`??` 与 `?:` 混用会踩优先级坑（`a ?? b ? c : d` 实际是
    // `(a ?? b) ? c : d`），一旦 status 是非空字符串就会一律判成 'passed'，
    // 于是失败文件被当成通过。这里显式分支，不依赖运算符优先级。
    let status = file.status;
    if (!status) {
      const results = file.assertionResults ?? [];
      status =
        results.length > 0 && results.every((assertion) => assertion.status === 'passed')
          ? 'passed'
          : 'failed';
    }
    if (status === 'failed') {
      const absolute = file.name.replace(/\\/g, '/');
      failed.add(root ? absolute.replace(`${root}/`, '') : absolute);
    }
  }
  return failed;
}

/**
 * 把「基线失败、当前不失败」的文件分成两类。
 *
 * - `removed`：**文件已不存在**——本分支把那个特性整个移除了，测试随之删除。
 *   这不是「修好的」，说成修好是不实的。
 * - `actuallyFixed`：文件还在，只是现在通过了——这才是本分支顺手修好的。
 *
 * @param {Iterable<string>} baseFailed 基线侧失败文件集合
 * @param {Set<string>} currentFailed 当前侧失败文件集合
 * @param {(file: string) => boolean} exists 判断文件在当前树里是否仍存在
 */
export function classifyFixed(baseFailed, currentFailed, exists) {
  const removed = [];
  const actuallyFixed = [];
  for (const file of baseFailed) {
    if (currentFailed.has(file)) continue;
    (exists(file) ? actuallyFixed : removed).push(file);
  }
  return { removed, actuallyFixed };
}

/**
 * 从「当前失败、基线没失败」里挑出**确定性**的回归。
 *
 * 全量并发下失败的用例有一部分是**并发敏感**的（时序断言互相踩），
 * 把候选文件单独再跑一遍，那些并发放大的失败会通过，剩下的才是真回归。
 *
 * @param {Iterable<string>} candidates 候选文件（当前失败、基线没失败）
 * @param {Set<string>} stillFailing 单独重跑后仍然失败的文件集合
 */
export function classifyIntroduced(candidates, stillFailing) {
  const deterministic = [];
  const concurrencySensitive = [];
  for (const file of candidates) {
    (stillFailing.has(file) ? deterministic : concurrencySensitive).push(file);
  }
  return { deterministic, concurrencySensitive };
}

/** 默认的「文件是否仍存在」判定：相对仓库根。 */
export function fileExistsIn(root, file) {
  return existsSync(join(root, file));
}
