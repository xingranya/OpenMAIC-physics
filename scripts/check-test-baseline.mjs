#!/usr/bin/env node
/**
 * 全量测试失败集合与上游基线的**逐条对照**（交付前跑一次）。
 *
 * 背景（第八轮独立复审 F1，阻断级）：本分支给
 * `lib/server/provider-config.ts` 新增 `isLLMProviderDisabled` 导出，
 * 破坏了 5 个上游测试的**固定形状** `vi.mock` 工厂 → 48 例上游测试由绿转红。
 * 当时"全量失败数没变多"（5 个文件变成了 10 个文件，但下面的例子是另一个），
 * 只有**逐文件与基线对照**才能发现差别。
 *
 * 所以这里把那个手工方法固化成脚本：
 *   1. 用 `git archive` 把上游基线（默认 v1.1.4）解到临时目录（**不碰 .git**）；
 *   2. 在基线树与当前仓库各跑一次全量 vitest；
 *   3. 比对**失败文件集合**：当前有、基线没有的，就是本分支引入的回归。
 *
 * 用法：
 *   node scripts/check-test-baseline.mjs                       # 用默认基线
 *   node scripts/check-test-baseline.mjs --baseline 39d04dd46   # 指定基线
 *   node scripts/check-test-baseline.mjs --skip-baseline-run     # 只跑当前树
 *
 * 说明：需要跑两次全量，耗时较长（本机约 200 秒/次），所以这是**交付前的
 * 一次性检查**，不是 CI 门禁。CI 里的等价防线是 `check-mock-factory-exports`。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyFixed, failedFiles, fileExistsIn } from './test-baseline-lib.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

/** 上游基线（release/1.1.x 的 v1.1.4 提交）。 */
const BASELINE = argValue('--baseline', '39d04dd46');
const SKIP_BASELINE_RUN = args.includes('--skip-baseline-run');

/** 在某个工作目录里跑一次全量 vitest，返回失败文件集合（相对该目录的路径）。 */
function runVitest(cwd, reportPath) {
  console.log(`  · 跑全量 vitest（${cwd}）……`);
  const result = spawnSync(
    process.execPath,
    [
      join(cwd, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: process.env.TMPDIR ?? cwd } },
  );
  const failed = failedFiles(reportPath, cwd);
  if (!failed) {
    console.error('  · vitest 未产出 JSON 报告：');
    console.error((result.stderr || result.stdout || '').slice(0, 800));
    process.exit(1);
  }
  return failed;
}

/**
 * 把候选文件**单独再跑一遍**，只留下仍然失败的。
 *
 * ## 为什么必须单独再跑
 *
 * 全量并发下失败的用例里有一部分是**并发敏感**的（时序断言互相踩）。
 * 把候选文件单独跑一遍，那些并发放大的失败会通过，剩下的才是
 * 真正确定性的回归——只有后者才算「本分支引入」。
 *
 * ## 这段以前是坏的
 *
 * 脚本里这一行原本调用了一个**从未定义**的 `rerunIsolated`，于是每次跑到
 * 差集那一步就抛 `ReferenceError` 退出——脚本自称是「可复现的逐条对照」，
 * 实际上从来没有跑出过结论。现在补上实现。
 */
function rerunIsolated(cwd, files) {
  if (files.length === 0) return files;
  console.log(`  · 差集单独再跑（${files.length} 个文件）……`);
  const reportPath = join(workDir, 'isolated.json');
  const result = spawnSync(
    process.execPath,
    [
      join(cwd, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      ...files,
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: process.env.TMPDIR ?? cwd } },
  );
  const stillFailing = failedFiles(reportPath, cwd);
  if (!stillFailing) {
    console.error('  · 差集重跑未产出 JSON 报告：');
    console.error((result.stderr || result.stdout || '').slice(0, 800));
    process.exit(1);
  }
  const deterministic = files.filter((file) => stillFailing.has(file));
  console.log(
    `  · 差集单独再跑：${deterministic.length} 个仍失败` +
      `（其余 ${files.length - deterministic.length} 个单独跑通过，属并发敏感）`,
  );
  return deterministic;
}

const workDir = mkdtempSync(join(tmpdir(), 'test-baseline-'));
try {
  console.log('全量测试 vs 上游基线 · 逐条对照\n');

  // ── 1) 基线树 ──
  const baseDir = join(workDir, 'base');
  console.log(`解出基线 ${BASELINE} → ${baseDir}`);
  const archive = spawnSync('git', ['archive', BASELINE], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    console.error(`git archive ${BASELINE} 失败：${archive.stderr?.toString().slice(0, 300)}`);
    process.exit(1);
  }
  spawnSync('mkdir', ['-p', baseDir]);
  const tar = spawnSync('tar', ['-x', '-C', baseDir], {
    input: archive.stdout,
    encoding: 'buffer',
  });
  if (tar.status !== 0) {
    console.error('解包基线树失败');
    process.exit(1);
  }
  // 基线树需要依赖才能跑测试；用当前仓库的 node_modules（只读引用）。
  const baseModules = join(baseDir, 'node_modules');
  if (!existsSync(baseModules)) {
    spawnSync('ln', ['-s', join(ROOT, 'node_modules'), baseModules]);
  }

  // ── 2) 两侧各跑一次 ──
  const currentFailed = runVitest(ROOT, join(workDir, 'current.json'));
  console.log(`  · 当前树：${currentFailed.size} 个失败文件`);

  let baseFailed = new Set();
  if (SKIP_BASELINE_RUN) {
    console.log('  · 跳过基线侧运行（--skip-baseline-run）');
  } else {
    baseFailed = runVitest(baseDir, join(workDir, 'base.json'));
    console.log(`  · 基线树：${baseFailed.size} 个失败文件`);
  }

  // ── 3) 比对 ──
  // 先把「当前失败、基线没失败」的文件**单独再跑一遍**：
  // 并发敏感的文件单独跑会通过，只剩真正确定性的回归。
  const candidates = [...currentFailed].filter((file) => !baseFailed.has(file));
  const introduced = candidates.length > 0 ? rerunIsolated(ROOT, candidates) : candidates;
  // 「相比基线不再失败」要分两类：**文件已被本分支删掉**（特性整个移除）
  // 与**文件还在但现在通过了**（真的修好了）。混为一谈会把前者说成「修好的」。
  const { removed, actuallyFixed } = classifyFixed(baseFailed, currentFailed, (file) =>
    fileExistsIn(ROOT, file),
  );

  console.log('\n── 结果 ──');
  if (SKIP_BASELINE_RUN) {
    // 跳过基线侧运行时**不能**做差集——否则会把"上游本来就红"的失败
    // 一律说成"本分支引入"，那是误导。
    console.log(`当前树有 ${currentFailed.size} 个失败文件（未与基线对照）。`);
    console.log('要判断哪些是本分支引入的，请去掉 --skip-baseline-run 跑一次完整对照。');
    process.exit(0);
  }
  if (introduced.length > 0) {
    console.log(`❌ 本分支引入的失败文件（${introduced.length} 个）：`);
    for (const file of introduced) console.log(`  · ${file}`);
    console.log(
      '\n  常见成因：给被 mock 的模块**新增了导出**，而上游测试用固定形状的 ' +
        '`vi.mock` 工厂 mock 它 → vitest 抛 `No "X" export is defined on the mock`。\n' +
        '  修法：在该工厂补上这个导出（语义要与真实实现一致），' +
        '或把工厂改成开放式的 `async (importOriginal) => ({ ...(await importOriginal()), … })`。\n' +
        '  `node scripts/check-mock-factory-exports.mjs` 会直接指出该补哪几处。',
    );
  } else {
    console.log('✅ 没有本分支引入的失败文件（与基线一致）。');
  }
  if (actuallyFixed.length > 0) {
    console.log(`\nℹ️ 相比基线不再失败的文件（${actuallyFixed.length} 个，本分支顺手修好的）：`);
    for (const file of actuallyFixed) console.log(`  · ${file}`);
  }
  if (removed.length > 0) {
    console.log(
      `\nℹ️ 基线里失败、本分支**不再有该测试文件**的（${removed.length} 个）：` +
        '对应特性已整体移除（测试随之删除），不是「修好了」。',
    );
    for (const file of removed) console.log(`  · ${file}`);
  }

  process.exit(introduced.length > 0 ? 1 : 0);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
