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
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { PURE_TIER } from './check-physics-domain-purity.mjs';
import { collectRoutes } from './verify-edgeone-runtime.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC = join(ROOT, 'docs', '参赛', '作品说明书.md');
/** 答辩预案也会自引同一批规模数字，它同样会被改到漂移。 */
const QA = join(ROOT, 'docs', '参赛', '答辩预案.md');
/** 部署手册同样自引部署事实（函数包体积、运行期路由数）。 */
const DEPLOY = join(ROOT, 'deploy', 'README.md');
/** EdgeOne 函数包产物的终态目录（裁剪 + 补包之后）。 */
const FN_DIR = join(ROOT, '.edgeone', 'cloud-functions', 'ssr-node');

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

/** 纯领域层（物理域不依赖 React/DOM 的那一半）的总行数。 */
function measurePureTier() {
  const files = collect(join(ROOT, 'lib', 'physics'), '.ts');
  let total = 0;
  for (const file of files) {
    const repoPath = toRepoPath(file);
    if (PURE_TIER.has(repoPath)) total += countLines([file]);
  }
  return total;
}

/** 把仓库路径转成与 PURE_TIER 一致的正斜杠相对路径。 */
function toRepoPath(file) {
  return relative(ROOT, file).split(sep).join('/');
}

/**
 * 实测 EdgeOne 函数包产物的两个部署事实：最终体积与运行期路由数。
 *
 * ## 为什么它们必须进门禁
 *
 * 第十三轮独立复审发现：部署手册里写着「116.5 MiB」「79 条路由」，
 * 实测却是「119.4 MiB」「67 条路由」——**没有任何门禁盯这两个数**，
 * 于是它们漂了整整几轮都没人发现。而这两个数字恰恰是评委最可能追问的
 * 「你们到底部署了多少东西」。
 *
 * ## 口径必须与部署脚本一致
 *
 * - 体积：`dirSize` 按文件字节求和（与 `deploy-edgeone.mjs` 的 `dirSize` 同口径），
 *   测的是**最终上传**的那份产物（裁剪 + 补包之后）。
 * - 路由数：直接复用 `verify-edgeone-runtime.mjs` 的 `collectRoutes`，
 *   免得两处各算各的、永远对不上。
 *
 * 产物不存在（没构建过）时返回 null——「无从校验」与「校验不通过」是两回事，
 * 门禁会明确报 SKIP，而不是悄悄放过。
 */
let functionPackage = null;
function measureFunctionPackage() {
  if (functionPackage) return functionPackage;
  if (!existsSync(FN_DIR)) {
    functionPackage = { mib: null, routes: null };
    return functionPackage;
  }
  let bytes = 0;
  const stack = [FN_DIR];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          bytes += statSync(full).size;
        } catch {
          /* 忽略读不到的文件 */
        }
      }
    }
  }
  functionPackage = {
    mib: Math.round((bytes / 1048576) * 10) / 10,
    routes: collectRoutes(FN_DIR).length,
  };
  return functionPackage;
}

/**
 * 部署事实那两行的匹配模式（部署手册与说明书里用的是同一句）。
 *
 * 抽成常量是为了让两份文档用**同一把尺子**：分开写两条正则的话，
 * 很容易一边改了另一边没改。
 */
const DEPLOY_FACTS_PATTERN =
  /当前产物实测（门禁口径）\*\*：函数包最终体积\s*\*\*([\d.]+)\s*MiB\*\*，运行期门禁覆盖\s*\*\*(\d+)\s*条路由\*\*/;

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
    // 同一组数字在 §3 的对照表与 §8.4 的正文里也各出现一次。
    // 第八轮复审实测：只守护 §8.1 的话，把这两处改成别的数字，门禁仍 exit=0。
    label: '物理域总规模（§3 对照表）',
    // 捕获组：1 = 纯领域层行数，2 = 浏览器适配层行数，3 = 合计。
    declaredGroup: 3,
    pattern: /纯领域层 11 文件 ([\d\s]+) 行 \+ 浏览器适配层 8 文件 ([\d\s]+) 行，共 ([\d\s]+) 行/,
    measure: () => countLines(collect(join(ROOT, 'lib', 'physics'), '.ts')),
    // 额外校验纯层、适配层与合计三个分项。
    extra: (match) => {
      const total = countLines(collect(join(ROOT, 'lib', 'physics'), '.ts'));
      const pure = measurePureTier();
      return {
        groups: [
          { label: '纯领域层', declared: Number(match[1].replace(/\s/g, '')), actual: pure },
          {
            label: '浏览器适配层',
            declared: Number(match[2].replace(/\s/g, '')),
            actual: total - pure,
          },
          {
            label: '物理域合计',
            declared: Number(match[3].replace(/\s/g, '')),
            actual: total,
          },
        ],
      };
    },
  },
  {
    label: '纯领域层累计（§8.4 正文）',
    pattern: /纯领域层累计 ([\d\s]+) 行/,
    measure: () => measurePureTier(),
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
    // 额外校验用例数与测试文件数（第 2、3 个捕获组）。
    extra: (match) => {
      if (!physicsTests) physicsTests = measurePhysicsTests();
      return {
        groups: [
          { label: '用例数', declared: Number(match[2]), actual: physicsTests.tests },
          { label: '测试文件数', declared: Number(match[3]), actual: physicsTests.files },
        ],
      };
    },
  },
  // ---------------------------------------------------------------------
  // 答辩预案《Q15 你说规模是多少？》里也自引同一批数字。
  // 它此前完全没人管：说明书的表改对了，答辩预案里的数字照样漂着——
  // 而这恰恰是评委**最可能当场追问**的一处。
  // ---------------------------------------------------------------------
  {
    label: '答辩预案 · 物理域规模',
    file: QA,
    pattern: /物理域\s*([\d\s]+)\s*行/,
    measure: () => countLines(collect(join(ROOT, 'lib', 'physics'), '.ts')),
  },
  {
    label: '答辩预案 · 校本层规模',
    file: QA,
    pattern: /校本层\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'lib', 'school'))
          .filter((name) => name.endsWith('.ts'))
          .map((name) => join(ROOT, 'lib', 'school', name)),
      ),
  },
  {
    label: '答辩预案 · 工作台 UI 规模',
    file: QA,
    pattern: /工作台 UI\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines([
        ...collect(join(ROOT, 'components', 'physics'), '.tsx'),
        ...collect(join(ROOT, 'components', 'portal'), '.tsx'),
      ]),
  },
  {
    label: '答辩预案 · 参赛材料规模',
    file: QA,
    pattern: /参赛材料\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'docs', '参赛'))
          .filter((name) => name.endsWith('.md'))
          .map((name) => join(ROOT, 'docs', '参赛', name)),
      ),
  },
  {
    label: '答辩预案 · 物理域单元测试',
    file: QA,
    unit: '例',
    pattern: /物理域\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*通过\s*（(\d+)\s*个文件）/,
    measure: () => {
      if (!physicsTests) physicsTests = measurePhysicsTests();
      return physicsTests.tests;
    },
    extra: (match) => {
      if (!physicsTests) physicsTests = measurePhysicsTests();
      return {
        groups: [
          { label: '用例数', declared: Number(match[2]), actual: physicsTests.tests },
          { label: '测试文件数', declared: Number(match[3]), actual: physicsTests.files },
        ],
      };
    },
  },
  {
    label: '答辩预案 · 部署文档规模',
    file: QA,
    pattern: /部署文档\s*([\d\s]+)\s*行/,
    measure: () =>
      countLines(
        readdirSync(join(ROOT, 'deploy'))
          .map((name) => join(ROOT, 'deploy', name))
          .filter((path) => statSync(path).isFile()),
      ),
  },
  // ---------------------------------------------------------------------
  // 部署事实：函数包体积与运行期路由数。
  //
  // 第十三轮独立复审发现这两组数字漂了好几轮没人管——而它们恰恰是
  // 评委最可能追问的「你们到底部署了多少东西」：
  //   文档写「116.5 MiB / 79 条路由」，实测是「119.4 MiB / 67 条路由」。
  //
  // 体积允许 ±0.5 MiB 容差：依赖版本微调会让产物字节数自然抖动，
  // 而真正要抓的漂移（本次是 2.9 MiB 与 12 条路由）远大于这个容差。
  // 路由数是严格的——它由 app 路由表唯一确定，不该有任何浮动。
  // ---------------------------------------------------------------------
  {
    label: '部署事实 · 函数包体积与路由数（部署手册）',
    file: DEPLOY,
    unit: 'MiB',
    declaredGroup: 1,
    pattern: DEPLOY_FACTS_PATTERN,
    measure: () => measureFunctionPackage().mib,
    tolerance: 0.5,
    optional: true,
    extra: (match) => ({
      groups: [
        {
          label: '运行期路由数',
          declared: Number(match[2]),
          actual: measureFunctionPackage().routes ?? Number.NaN,
        },
      ],
    }),
  },
  {
    label: '部署事实 · 函数包体积与路由数（说明书）',
    unit: 'MiB',
    declaredGroup: 1,
    pattern: DEPLOY_FACTS_PATTERN,
    measure: () => measureFunctionPackage().mib,
    tolerance: 0.5,
    optional: true,
    extra: (match) => ({
      groups: [
        {
          label: '运行期路由数',
          declared: Number(match[2]),
          actual: measureFunctionPackage().routes ?? Number.NaN,
        },
      ],
    }),
  },
  {
    // 门禁自己的项数也会被文档自引（「check-doc-metrics.mjs（N 项）」）。
    // 它同样会漂：加了两项新指标而文档没改，就成了下一个没人看的数字。
    label: '文档门禁项数（说明书自引）',
    unit: '项',
    pattern: /check-doc-metrics\.mjs`?（(\d+)\s*项）/,
    measure: () => METRICS.length,
  },
];

if (!existsSync(DOC)) {
  console.error(`找不到 ${relative(ROOT, DOC)}`);
  process.exit(1);
}

const source = readFileSync(DOC, 'utf8');
const problems = [];
const rows = [];

/**
 * 量测阶段出错时优雅退出，而不是抛一整段 stack trace。
 *
 * 门禁必须 **fail-closed**（退出码非 0），但失败原因要能一眼看懂：
 * 「vitest 没装」和「数字对不上」是两种完全不同的问题。
 */
function measureSafely(metric) {
  try {
    return metric.measure();
  } catch (error) {
    console.error(`\n[FAIL] 无法实测「${metric.label}」：`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error('  本门禁 fail-closed：请先修好上面这个问题，再重跑。\n');
    process.exit(1);
  }
}

/**
 * 比较「文档写的数」与「实测的数」。
 *
 * `tolerance` 是允许的绝对偏差（如函数包体积 ±0.5 MiB：依赖版本微调会让
 * 产物字节数自然抖动，但真正要抓的漂移远大于它）。不给容差就是**严格相等**。
 */
function withinTolerance(declared, actual, tolerance) {
  if (typeof tolerance !== 'number') return declared === actual;
  return Math.abs(declared - actual) <= tolerance;
}

for (const metric of METRICS) {
  // 指标默认落在说明书；个别指标可以指定别的文件（答辩预案也自引这批数字）。
  const metricSource = metric.file ? readFileSync(metric.file, 'utf8') : source;
  const metricLabel = metric.file ? relative(ROOT, metric.file) : '说明书';
  const match = metric.pattern.exec(metricSource);
  if (!match) {
    problems.push(`${metric.label}：${metricLabel}里找不到对应行`);
    continue;
  }
  // 表格里的数字用窄空格（U+202F）或普通空格分隔，这里统一去掉所有空白。
  const group = metric.declaredGroup ?? 1;
  const declared = Number(match[group].replace(/[\s\u202f\u00a0]/g, ''));
  const measured = measureSafely(metric);

  // 「无从校验」与「校验不通过」是两回事：产物没构建过就没有体积可言，
  // 这时报 SKIP 并明确写出来，而不是悄悄放过或直接报失败。
  if (metric.optional && (measured === null || measured === undefined)) {
    rows.push({
      label: metric.label,
      declared,
      actual: '未校验',
      unit: metric.unit ?? '行',
      fileLabel: metricLabel,
      skipped: true,
    });
    continue;
  }

  const actual = measured;
  const ok = withinTolerance(declared, actual, metric.tolerance);
  rows.push({
    label: metric.label,
    declared,
    actual,
    unit: metric.unit ?? '行',
    fileLabel: metricLabel,
    ok,
  });
  if (!ok) {
    problems.push(
      `${metric.label}：${metricLabel}写 ${declared} ${metric.unit ?? '行'}，实测 ${actual} ${
        metric.unit ?? '行'
      }${metric.tolerance ? `（容差 ±${metric.tolerance}）` : ''}（请同步后重跑）`,
    );
  }

  if (metric.extra) {
    const { groups } = metric.extra(match);
    for (const group of groups) {
      const groupOk = withinTolerance(group.declared, group.actual, metric.tolerance);
      rows[rows.length - 1].detail = groups
        .map((item) => `${item.label} ${item.declared}`)
        .join(' · ');
      rows[rows.length - 1].actualDetail = groups
        .map((item) => `${item.label} ${item.actual}`)
        .join(' · ');
      if (!groupOk) {
        problems.push(
          `${metric.label}（${group.label}）：${metricLabel}写 ${group.declared}，实测 ${group.actual}（请同步后重跑）`,
        );
      }
    }
  }
}

for (const row of rows) {
  if (row.skipped) {
    console.log(
      `[SKIP] ${row.label} — ${row.fileLabel} ${row.declared} ${row.unit} / 未校验（函数包产物不存在）`,
    );
    continue;
  }
  const ok = row.ok;
  const detail = row.detail ? ` — ${row.detail} / 实测 ${row.actualDetail}` : '';
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${row.label} — ${row.fileLabel} ${row.declared} ${row.unit} / 实测 ${row.actual} ${row.unit}${detail}`,
  );
}

const skippedCount = rows.filter((row) => row.skipped).length;
if (skippedCount > 0) {
  console.log(
    `\n注意：有 ${skippedCount} 项因「函数包产物不存在」而未校验——` +
      '先构建并裁剪出 .edgeone/cloud-functions/ssr-node，再重跑本脚本。',
  );
}

if (problems.length > 0) {
  console.error('\n参赛材料自引数字与实现不一致：');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n修复：更新 docs/参赛/作品说明书.md §8.1 与 docs/参赛/答辩预案.md 对应行，然后重跑本脚本。',
  );
  process.exit(1);
}

console.log(`\n参赛材料自引数字全部一致（${rows.length} 项）。`);
