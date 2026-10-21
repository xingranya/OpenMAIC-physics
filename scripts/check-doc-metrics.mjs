#!/usr/bin/env node
/**
 * 参赛材料自引数字的漂移门禁。
 *
 * `docs/参赛/作品说明书.md` §8.1 里有一张"规模"表，写着物理域 / 校本层 /
 * 工作台 UI / 参赛材料 / 部署文档各自的行数。手工维护这张表的问题是：
 * **每改一次文档，数字就漂一次**，而表里其它数字都是准的，读者会默认整表可信。
 *
 * 这个脚本把那张表变成可执行的断言：读出表里写的行数，用同样口径实测一遍，
 * 对不上就退出码非 0。
 *
 * 用法：node scripts/check-doc-metrics.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC = join(ROOT, 'docs', '参赛', '作品说明书.md');

/** 统计一组文件的总行数（只算普通文件，目录跳过）。 */
function countLines(paths) {
  let total = 0;
  for (const path of paths) total += readFileSync(path, 'utf8').split('\n').length - 1;
  return total;
}

/** 递归收集目录下的指定扩展名文件。 */
function collect(dir, extension) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full, extension));
    else if (name.endsWith(extension)) out.push(full);
  }
  return out;
}

/**
 * 实测物理域单元测试的文件数与用例数。
 *
 * 第四轮独立复审发现：说明书里「104 / 104 通过（10 个文件）」在新增两个
 * 测试文件后变成了 12 文件 109 例，文档却没跟着改。行数指标被门禁盯着，
 * 测试数却没人管——这类数字漂移最容易被评委当场问住，所以也纳入门禁。
 *
 * 用 vitest 的 json reporter 拿权威数字，而不是去数 `it(` 的个数。
 */
function measurePhysicsTests() {
  const vitestCli = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitestCli)) {
    throw new Error(`找不到 vitest（${vitestCli}）。请先执行 pnpm install 再跑本脚本。`);
  }
  const reportDir = mkdtempSync(join(tmpdir(), 'doc-metrics-vitest-'));
  const reportPath = join(reportDir, 'report.json');
  try {
    const result = spawnSync(
      process.execPath,
      [vitestCli, 'run', 'tests/physics/', '--reporter=json', `--outputFile=${reportPath}`],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: process.env.TMPDIR ?? reportDir },
      },
    );
    if (result.error) {
      throw new Error(`vitest 启动失败：${result.error.message}`);
    }
    if (!existsSync(reportPath)) {
      throw new Error(
        `vitest 未产出报告（exit=${result.status}）：${(result.stderr || result.stdout || '').slice(0, 400)}`,
      );
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const files = Array.isArray(report.testResults)
      ? report.testResults.length
      : Number(report.numTotalTestSuites ?? 0);
    const tests = Number(report.numTotalTests ?? 0);
    if (!Number.isFinite(tests) || tests === 0) {
      throw new Error(
        `vitest 报告里没有用例数（exit=${result.status}）：${(result.stderr || result.stdout || '').slice(0, 400)}`,
      );
    }
    return { files, tests };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

let physicsTests = null;

/** 一项指标：文档里的标签、文档里写的行数、实测行数。 */
const METRICS = [
  {
    label: '物理域总规模',
    pattern: /物理域总规模\s*\|\s*([\d\s]+)\s*行/,
    measure: () => countLines(collect(join(ROOT, 'lib', 'physics'), '.ts')),
  },
  {
    label: '校本层规模',
    pattern: /校本层规模\s*\|\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'lib', 'school'))
          .filter((name) => name.endsWith('.ts'))
          .map((name) => join(ROOT, 'lib', 'school', name)),
      ),
  },
  {
    label: '工作台 UI 规模',
    pattern: /工作台 UI 规模\s*\|\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines([
        ...collect(join(ROOT, 'components', 'physics'), '.tsx'),
        ...collect(join(ROOT, 'components', 'portal'), '.tsx'),
      ]),
  },
  {
    label: '参赛材料规模',
    pattern: /参赛材料规模\s*\|\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'docs', '参赛'))
          .filter((name) => name.endsWith('.md'))
          .map((name) => join(ROOT, 'docs', '参赛', name)),
      ),
  },
  {
    label: '部署文档规模',
    pattern: /部署文档规模\s*\|\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'deploy'))
          .map((name) => join(ROOT, 'deploy', name))
          .filter((path) => statSync(path).isFile()),
      ),
  },
  {
    // 「**N / N 通过**（M 个文件）」——两个数字都要对得上。
    label: '物理域单元测试',
    unit: '例',
    pattern: /物理域单元测试\s*\|\s*\*\*(\d+)\s*\/\s*(\d+)\s*通过\*\*\s*（(\d+)\s*个文件）/,
    measure: () => {
      if (!physicsTests) physicsTests = measurePhysicsTests();
      return physicsTests.tests;
    },
    // 额外校验测试文件数与用例数。
    extra: () => {
      if (!physicsTests) physicsTests = measurePhysicsTests();
      return { files: physicsTests.files, tests: physicsTests.tests };
    },
  },
];

if (!existsSync(DOC)) {
  console.error(`找不到 ${relative(ROOT, DOC)}`);
  process.exit(1);
}

const source = readFileSync(DOC, 'utf8');
const problems = [];
const rows = [];

for (const metric of METRICS) {
  const match = metric.pattern.exec(source);
  if (!match) {
    problems.push(`${metric.label}：说明书里找不到对应行`);
    continue;
  }
  // 表格里的数字用窄空格（U+202F）或普通空格分隔，这里统一去掉所有空白。
  const declared = Number(match[1].replace(/[\s\u202f\u00a0]/g, ''));
  const actual = metric.measure();
  rows.push({ label: metric.label, declared, actual, unit: metric.unit ?? '行' });
  if (declared !== actual) {
    problems.push(
      `${metric.label}：说明书写 ${declared} ${metric.unit ?? '行'}，实测 ${actual} ${
        metric.unit ?? '行'
      }（请同步后重跑）`,
    );
  }

  if (metric.extra) {
    const { files, tests } = metric.extra();
    const declaredTests = Number(match[2]);
    const declaredFiles = Number(match[3]);
    rows[rows.length - 1].detail = `${declaredTests} 例 / ${declaredFiles} 个文件`;
    rows[rows.length - 1].actualDetail = `${tests} 例 / ${files} 个文件`;
    if (declaredTests !== tests) {
      problems.push(
        `${metric.label}：说明书写 ${declaredTests} 例，实测 ${tests} 例（请同步后重跑）`,
      );
    }
    if (declaredFiles !== files) {
      problems.push(
        `${metric.label}：说明书写 ${declaredFiles} 个测试文件，实测 ${files} 个（请同步后重跑）`,
      );
    }
  }
}

for (const row of rows) {
  const ok = row.declared === row.actual;
  const detail = row.detail ? ` — ${row.detail} / 实测 ${row.actualDetail}` : '';
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${row.label} — 说明书 ${row.declared} ${row.unit} / 实测 ${row.actual} ${row.unit}${detail}`,
  );
}

if (problems.length > 0) {
  console.error('\n参赛材料自引数字与实现不一致：');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n修复：更新 docs/参赛/作品说明书.md §8.1 对应行，然后重跑本脚本。');
  process.exit(1);
}

console.log(`\n参赛材料自引数字全部一致（${rows.length} 项）。`);
