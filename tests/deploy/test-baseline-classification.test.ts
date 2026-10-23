import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyFixed,
  classifyIntroduced,
  failedFiles,
  fileExistsIn,
} from '@/scripts/test-baseline-lib.mjs';

/**
 * 「全量失败集合 vs 上游基线」的判定逻辑。
 *
 * ## 为什么它值得单独守
 *
 * 这段判定是「本分支有没有引入回归」的**唯一自动化判据**，而它原先直接写在
 * `scripts/check-test-baseline.mjs` 里——那个脚本在模块顶层就跑完整个对照
 * 流程（解基线树 + 两侧全量 vitest），**没法被单测覆盖**。
 *
 * 而且它此前有两个真 bug：
 *   1. `rerunIsolated` 根本没定义 → 脚本每次跑到差集那步就抛
 *      `ReferenceError` 退出，**从未跑出过结论**；
 *   2. 「相比基线不再失败」把**文件已被本分支删掉**的也算成「顺手修好的」。
 *
 * 抽成纯函数后，这两条判定都能被钉住。
 */

/** 造一个 vitest JSON 报告。 */
function writeReport(name: unknown, testResults: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-report-'));
  const path = join(dir, 'report.json');
  writeFileSync(path, JSON.stringify({ name, testResults }));
  return { dir, path };
}

describe('failedFiles', () => {
  it('读出失败文件并转成相对路径', () => {
    const { dir, path } = writeReport('r', [
      { name: '/repo/tests/a.test.ts', status: 'failed' },
      { name: '/repo/tests/b.test.ts', status: 'passed' },
    ]);
    try {
      const failed = failedFiles(path, '/repo');
      expect(failed).not.toBeNull();
      expect([...(failed as Set<string>)]).toEqual(['tests/a.test.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('status 缺失时按断言结果判定（`??` 与 `?:` 混用的优先级坑）', () => {
    const { dir, path } = writeReport('r', [
      { name: '/repo/tests/c.test.ts', assertionResults: [{ status: 'failed' }] },
      {
        name: '/repo/tests/d.test.ts',
        assertionResults: [{ status: 'passed' }, { status: 'passed' }],
      },
    ]);
    try {
      const failed = failedFiles(path, '/repo');
      expect([...(failed as Set<string>)]).toEqual(['tests/c.test.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('报告文件不存在时返回 null（而不是空集合）', () => {
    expect(failedFiles(join(tmpdir(), 'definitely-not-here.json'), '/repo')).toBeNull();
  });
});

describe('classifyFixed', () => {
  it('把「文件已删除」与「文件还在但修好了」分开', () => {
    const baseFailed = new Set([
      'tests/gone.test.ts',
      'tests/kept.test.ts',
      'tests/still-red.test.ts',
    ]);
    const currentFailed = new Set(['tests/still-red.test.ts']);
    const existing = new Set(['tests/kept.test.ts', 'tests/still-red.test.ts']);
    const { removed, actuallyFixed } = classifyFixed(baseFailed, currentFailed, (file) =>
      existing.has(file),
    );
    expect(removed).toEqual(['tests/gone.test.ts']);
    expect(actuallyFixed).toEqual(['tests/kept.test.ts']);
  });

  it('基线失败、当前仍失败的文件不算「修好」', () => {
    const baseFailed = new Set(['tests/x.test.ts']);
    const currentFailed = new Set(['tests/x.test.ts']);
    const { removed, actuallyFixed } = classifyFixed(baseFailed, currentFailed, () => true);
    expect(removed).toEqual([]);
    expect(actuallyFixed).toEqual([]);
  });
});

describe('classifyIntroduced', () => {
  it('区分「确定性回归」与「并发敏感」', () => {
    const candidates = ['tests/regression.test.ts', 'tests/flaky.test.ts'];
    const stillFailing = new Set(['tests/regression.test.ts']);
    const { deterministic, concurrencySensitive } = classifyIntroduced(candidates, stillFailing);
    expect(deterministic).toEqual(['tests/regression.test.ts']);
    expect(concurrencySensitive).toEqual(['tests/flaky.test.ts']);
  });
});

describe('fileExistsIn', () => {
  it('相对仓库根判定文件是否存在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-exists-'));
    try {
      writeFileSync(join(dir, 'there.test.ts'), '// x');
      expect(fileExistsIn(dir, 'there.test.ts')).toBe(true);
      expect(fileExistsIn(dir, 'not-there.test.ts')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
