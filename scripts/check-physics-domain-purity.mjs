#!/usr/bin/env node
/**
 * 物理域依赖分层断言。
 *
 * `lib/physics/**` 分两层，各有不同的依赖约束：
 *
 * 1. **纯领域层**（types / data / engine / shortcuts / prompts / 剧本与课堂构建器）
 *    —— 不得依赖 React、Next.js、DOM 或浏览器存储。
 *       收益：可在浏览器、Node 脚本、测试与未来其它前端框架中直接复用；
 *       单测不需要 jsdom，也就不受运行时环境影响。
 * 2. **浏览器适配层**（local-store / session / undo / download / use-shortcuts /
 *    预置包导入）—— 可以访问 window / localStorage / document，
 *       但**仍不得**依赖 React 之外的前端框架、Next.js 路由或 UI 组件：
 *       那些属于 `components/physics/` 的职责。
 *
 * 这条断言把分层从约定变成可执行的门禁：领域层一旦被写上
 * `import ... from 'react'`，CI 立刻失败。
 *
 * 用法：node scripts/check-physics-domain-purity.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGET = join(ROOT, 'lib', 'physics');

/**
 * 纯领域层：与运行时完全无关。
 * 这里的文件不得触碰 React / Next.js / DOM / 浏览器存储。
 */
const PURE_TIER = new Set([
  'lib/physics/types.ts',
  'lib/physics/data.ts',
  'lib/physics/engine.ts',
  'lib/physics/shortcuts.ts',
  'lib/physics/prompts/physics-constraints.ts',
  'lib/physics/presets/types.ts',
  'lib/physics/presets/recipes.ts',
  'lib/physics/presets/build-classroom.ts',
  'lib/physics/presets/ultrasonic-lab.ts',
]);

/** 两层都不允许的依赖。 */
const FORBIDDEN_EVERYWHERE = [
  { pattern: /from\s+['"]next(?:\/[^'"]*)?['"]/, hint: '不得依赖 Next.js（路由与框架能力属于 components/physics/）' },
  { pattern: /from\s+['"]@\/components\//, hint: '不得依赖 UI 组件' },
  { pattern: /from\s+['"]@\/app\//, hint: '不得依赖路由' },
];

/** 仅纯领域层禁止的依赖。 */
const FORBIDDEN_IN_PURE_TIER = [
  { pattern: /from\s+['"]react(?:\/[^'"]*)?['"]/, hint: '纯领域层不得依赖 React' },
  { pattern: /from\s+['"]react-dom(?:\/[^'"]*)?['"]/, hint: '纯领域层不得依赖 React' },
  { pattern: /\bdocument\s*\.\s*(?:createElement|getElementById|querySelector|body)/, hint: '纯领域层不得触碰 DOM' },
  { pattern: /\bwindow\s*\./, hint: '纯领域层不得触碰浏览器全局' },
  { pattern: /\blocalStorage\s*\.\s*(?:getItem|setItem|removeItem|clear)/, hint: '纯领域层不得访问浏览器存储' },
  { pattern: /\bnew\s+Blob\b/, hint: '纯领域层不得构造浏览器对象' },
];

/**
 * 去掉字符串字面量与模板字符串内容后再做 DOM 规则检查。
 *
 * `presets/ultrasonic-lab.ts` 里出现的 `document.getElementById` 属于**内嵌
 * 在 HTML 字符串里的脚本**，不是本模块自身的代码；把它当成本模块的 DOM 依赖
 * 是误报。
 */
function stripLiterals(source) {
  return source
    // 模板字符串（可跨行）
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    // 单引号 / 双引号字符串
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];
const checked = { pure: 0, adapter: 0 };

for await (const file of walk(TARGET)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const isPure = PURE_TIER.has(rel);
  if (isPure) checked.pure += 1;
  else checked.adapter += 1;

  const source = await readFile(file, 'utf8');
  const code = stripLiterals(source);

  code.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

    const rules = isPure
      ? [...FORBIDDEN_EVERYWHERE, ...FORBIDDEN_IN_PURE_TIER]
      : FORBIDDEN_EVERYWHERE;

    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        violations.push(
          `${rel}:${index + 1}  [${isPure ? '纯领域层' : '浏览器适配层'}] ${rule.hint}\n    ${trimmed}`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error('物理域依赖分层检查失败：\n');
  violations.forEach((violation) => console.error(`  - ${violation}`));
  console.error(
    '\n修复方向：框架相关逻辑上移到 components/physics/，' +
      '浏览器存储访问收敛到 local-store.ts / session.ts / undo.ts / download.ts。',
  );
  process.exit(1);
}

console.log(
  `物理域依赖分层检查通过：纯领域层 ${checked.pure} 个文件，浏览器适配层 ${checked.adapter} 个文件；` +
    '未引入 Next.js / UI 组件依赖，纯领域层未触碰 React / DOM / 浏览器存储。',
);
