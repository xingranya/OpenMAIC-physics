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
 *       但**仍不得**依赖 Next.js 路由或 UI 组件：
 *       那些属于 `components/physics/` 的职责。
 *
 * 这条断言把分层从约定变成可执行的门禁：领域层一旦被写上
 * `import ... from 'react'`，CI 立刻失败。
 *
 * 匹配策略（重要）：
 *  - **import 规则**必须在**原始源码**上匹配。规则依赖的是模块说明符本身，
 *    如果先把字符串字面量剥掉，`from 'react'` 会变成 `from ''`，规则永远
 *    匹配不到——门禁就成了摆设。
 *  - **运行时能力规则**（DOM / 浏览器全局）才在剥离字面量后的源码上匹配，
 *    避免把内嵌在 HTML 字符串里的 `document.getElementById` 误判成本模块的
 *    DOM 依赖。
 *
 * 用法：node scripts/check-physics-domain-purity.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGET = join(ROOT, 'lib', 'physics');

/**
 * 纯领域层：与运行时完全无关。
 * 这里的文件不得触碰 React / Next.js / DOM / 浏览器存储。
 */
export const PURE_TIER = new Set([
  'lib/physics/types.ts',
  'lib/physics/data.ts',
  'lib/physics/engine.ts',
  'lib/physics/shortcuts.ts',
  'lib/physics/prompts/physics-constraints.ts',
  'lib/physics/presets/types.ts',
  'lib/physics/presets/recipes.ts',
  'lib/physics/presets/build-classroom.ts',
  'lib/physics/presets/ultrasonic-lab.ts',
  'lib/physics/presets/pbl.ts',
  'lib/physics/presets/actions.ts',
]);

/**
 * 模块说明符匹配。
 *
 * 同时覆盖静态 import、副作用 import、动态 import() 与 require()——
 * 四者都是"依赖了这个包"。
 *
 * 包名以 '/' 结尾（如 '@/components/'）时允许任意子路径；否则只允许
 * '/' 分隔的子路径，避免 'react' 命中 'react-native'、'next' 命中
 * 'next-themes' 这类误报。
 */
function moduleSpecifier(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = name.endsWith('/') ? '[^\'"]*' : '(?:/[^\'"]*)?';
  return new RegExp(
    `(?:from\\s+|import\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${escaped}${suffix}['"]`,
  );
}

/** 两层都不允许的 import。 */
export const FORBIDDEN_IMPORTS = [
  {
    pattern: moduleSpecifier('next'),
    hint: '不得依赖 Next.js（路由与框架能力属于 components/physics/）',
  },
  { pattern: moduleSpecifier('@/components/'), hint: '不得依赖 UI 组件' },
  { pattern: moduleSpecifier('@/app/'), hint: '不得依赖路由' },
];

/** 仅纯领域层禁止的 import。 */
export const FORBIDDEN_IMPORTS_IN_PURE_TIER = [
  { pattern: moduleSpecifier('react'), hint: '纯领域层不得依赖 React' },
  { pattern: moduleSpecifier('react-dom'), hint: '纯领域层不得依赖 React' },
];

/** 仅纯领域层禁止的运行时能力（在剥离字符串字面量后的源码上匹配）。 */
export const FORBIDDEN_RUNTIME_IN_PURE_TIER = [
  {
    pattern: /\bdocument\s*\.\s*(?:createElement|getElementById|querySelector|body)/,
    hint: '纯领域层不得触碰 DOM',
  },
  { pattern: /\bwindow\s*\./, hint: '纯领域层不得触碰浏览器全局' },
  {
    pattern: /\blocalStorage\s*\.\s*(?:getItem|setItem|removeItem|clear)/,
    hint: '纯领域层不得访问浏览器存储',
  },
  { pattern: /\bnew\s+Blob\b/, hint: '纯领域层不得构造浏览器对象' },
];

/**
 * 去掉字符串字面量与模板字符串内容。
 *
 * `presets/ultrasonic-lab.ts` 里出现的 `document.getElementById` 属于**内嵌
 * 在 HTML 字符串里的脚本**，不是本模块自身的代码；把它当成本模块的 DOM 依赖
 * 是误报。
 *
 * 用**等长空白**替换而不是整体删除：整体删除会把跨行模板字符串压成一行，
 * 后面所有代码的行号都会错位，报错时指不到真正的问题。
 */
export function stripLiterals(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return (
    source
      // 模板字符串（可跨行）
      .replace(/`(?:\\.|[^`\\])*`/g, blank)
      // 单引号 / 双引号字符串
      .replace(/'(?:\\.|[^'\\\n])*'/g, blank)
      .replace(/"(?:\\.|[^"\\\n])*"/g, blank)
  );
}

/** 注释行不参与匹配。 */
function isCommentLine(trimmed) {
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

/**
 * 对单个文件做依赖分层检查。
 *
 * @param {string} rel 相对仓库根的文件路径（用于层级判定与报错）
 * @param {string} source 文件源码
 * @returns {string[]} 违规描述；空数组表示通过
 */
export function findViolations(rel, source) {
  const isPure = PURE_TIER.has(rel);
  const importRules = isPure
    ? [...FORBIDDEN_IMPORTS, ...FORBIDDEN_IMPORTS_IN_PURE_TIER]
    : FORBIDDEN_IMPORTS;
  const runtimeRules = isPure ? FORBIDDEN_RUNTIME_IN_PURE_TIER : [];

  const violations = [];
  const layer = isPure ? '纯领域层' : '浏览器适配层';

  // import 规则：原始源码。
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (isCommentLine(trimmed)) return;
    for (const rule of importRules) {
      if (rule.pattern.test(line)) {
        violations.push(`${rel}:${index + 1}  [${layer}] ${rule.hint}\n    ${trimmed}`);
      }
    }
  });

  // 运行时能力规则：剥离字面量后的源码。
  const code = stripLiterals(source);
  code.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (isCommentLine(trimmed)) return;
    for (const rule of runtimeRules) {
      if (rule.pattern.test(line)) {
        violations.push(`${rel}:${index + 1}  [${layer}] ${rule.hint}\n    ${trimmed}`);
      }
    }
  });

  return violations;
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

export async function main() {
  const violations = [];
  const checked = { pure: 0, adapter: 0 };

  for await (const file of walk(TARGET)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (PURE_TIER.has(rel)) checked.pure += 1;
    else checked.adapter += 1;

    const source = await readFile(file, 'utf8');
    violations.push(...findViolations(rel, source));
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
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
