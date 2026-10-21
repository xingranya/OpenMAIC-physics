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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  rows.push({ label: metric.label, declared, actual });
  if (declared !== actual) {
    problems.push(`${metric.label}：说明书写 ${declared} 行，实测 ${actual} 行（请同步后重跑）`);
  }
}

for (const row of rows) {
  const ok = row.declared === row.actual;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${row.label} — 说明书 ${row.declared} 行 / 实测 ${row.actual} 行`,
  );
}

if (problems.length > 0) {
  console.error('\n参赛材料自引数字与实现不一致：');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n修复：更新 docs/参赛/作品说明书.md §8.1 对应行，然后重跑本脚本。');
  process.exit(1);
}

console.log(`\n参赛材料自引数字全部一致（${rows.length} 项）。`);
