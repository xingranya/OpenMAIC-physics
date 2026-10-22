#!/usr/bin/env node
/**
 * 上游 mock 工厂的导出面门禁（只管**本分支新增的导出**）。
 *
 * 背景（第八轮独立复审 F1，阻断级）：本分支给
 * `lib/server/provider-config.ts` 新增了 `isLLMProviderDisabled` 导出，
 * 而 5 个**上游**测试用**固定形状**的 `vi.mock` 工厂 mock 该模块
 * （工厂里逐个列死了导出 key）。vitest 遇到工厂里没有的导出就抛
 * `No "isLLMProviderDisabled" export is defined on the mock`，
 * 于是 **48 例上游测试由绿转红**——而 CI 的 `pnpm test` 跑全量且没有
 * `continue-on-error`，**交付分支的 CI 会红**。
 *
 * 这个问题很难靠人眼发现：新增一个导出，类型检查不报错、局部跑测试也不报错，
 * 只有跑全量才炸。
 *
 * 判定口径（避免误报）：
 * - 只看**值导出**（interface / type 编译后不存在，vitest 不需要 mock）；
 * - 只看**本分支相对上游基线新增**的导出——上游遗留的差异不算本分支的责任；
 * - 只看**固定形状工厂**（用了 `importOriginal` 保留原导出的是开放式的，
 *   随模块导出自动跟随，不会出问题）。
 *
 * 用法：node scripts/check-mock-factory-exports.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS_DIR = join(ROOT, 'tests');

/** 上游基线（用于判断"本分支新增的导出"）。 */
const BASELINE = '39d04dd46';

const baselineCache = new Map();

/** 把绝对路径转成仓库相对的正斜杠路径。 */
function toRepoPath(absolute) {
  return relative(ROOT, absolute).split(sep).join('/');
}

/** 递归收集测试文件。 */
function collectTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectTests(full, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** 解析一段 TS 源码。 */
function parseSource(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** 语句/声明上是否带 `export` 修饰符。 */
function hasExportModifier(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

/**
 * 收集一个模块文件的**值导出名**（不含 interface / type —— 它们编译后不存在）。
 */
function collectValueExports(source, resolveDep) {
  const names = new Set();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name && hasExportModifier(statement)) names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      if (hasExportModifier(statement)) names.add(statement.name.text);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add((element.propertyName ?? element.name).text);
        }
      } else if (statement.moduleSpecifier) {
        const target = resolveDep(statement.moduleSpecifier.getText(source).slice(1, -1));
        if (target)
          for (const name of collectValueExports(target.source, resolveDep)) names.add(name);
      }
    }
  }
  return names;
}

/** 解析模块说明符到仓库内文件。 */
function resolveModuleFile(specifier) {
  if (!specifier.startsWith('@/')) return null;
  const base = join(ROOT, specifier.slice(2));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 读一个模块文件（带基线回退）。 */
function loadModule(file) {
  const repoPath = toRepoPath(file);
  if (!baselineCache.has(repoPath)) {
    let baselineText = null;
    try {
      baselineText = execFileSync('git', ['show', `${BASELINE}:${repoPath}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      baselineText = null; // 基线里没有这个文件 → 全新文件
    }
    baselineCache.set(repoPath, {
      current: parseSource(file, readFileSync(file, 'utf8')),
      baseline: baselineText === null ? null : parseSource(file, baselineText),
    });
  }
  return baselineCache.get(repoPath);
}

/**
 * 在一个测试文件里找出所有「固定形状」的 `vi.mock` 工厂。
 *
 * 注意 AST 形态：`vi.mock(...)` 的 expression 是
 * PropertyAccessExpression{expression: Identifier(vi), name: 'mock'}，
 * **不是** Identifier —— 按 Identifier 匹配会一个 mock 都找不到，门禁变成恒真。
 */
function findFixedShapeMocks(file) {
  const source = parseSource(file, readFileSync(file, 'utf8'));
  const found = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'mock' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'vi' &&
      node.arguments.length >= 2
    ) {
      const [moduleArg, factoryArg] = node.arguments;
      if (ts.isStringLiteral(moduleArg) && factoryArg) {
        const shape = fixedShapeOf(factoryArg, source);
        if (shape) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          found.push({ module: moduleArg.text, provided: shape, line });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 若是固定形状工厂，返回它提供的导出名集合；否则返回 null。 */
function fixedShapeOf(factoryArg, source) {
  // `vi.mock('x', async (importOriginal) => ({ ...await importOriginal(), ... }))`
  // ——保留了原导出，是开放式的，不算固定形状。
  if (ts.isArrowFunction(factoryArg) || ts.isFunctionExpression(factoryArg)) {
    if (factoryArg.parameters.length > 0) return null;
  }
  let returned = null;
  if (ts.isArrowFunction(factoryArg) || ts.isFunctionExpression(factoryArg)) {
    const body = factoryArg.body;
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          returned = statement.expression;
          break;
        }
      }
    } else {
      returned = body;
    }
  } else {
    returned = factoryArg;
  }
  // `() => ({ … })` 的函数体是 ParenthesizedExpression，必须解包括号，
  // 否则所有这种写法都会被当成"不是固定形状"而跳过——门禁就静默恒真了。
  while (returned && ts.isParenthesizedExpression(returned)) {
    returned = returned.expression;
  }
  if (!returned || !ts.isObjectLiteralExpression(returned)) return null;

  const provided = new Set();
  for (const property of returned.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      provided.add(property.name.getText(source).replace(/^['"]|['"]$/g, ''));
    } else if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
      provided.add(property.name.getText(source).replace(/^['"]|['"]$/g, ''));
    }
  }
  return provided;
}

const problems = [];

for (const testFile of collectTests(TESTS_DIR)) {
  for (const mock of findFixedShapeMocks(testFile)) {
    const targetFile = resolveModuleFile(mock.module);
    if (!targetFile) continue; // 第三方包或相对路径
    const loadedModule = loadModule(targetFile);
    const resolveDep = (specifier) => {
      const file = resolveModuleFile(specifier);
      if (!file) return null;
      return { file, source: loadModule(file).current };
    };

    const current = collectValueExports(loadedModule.current, resolveDep);
    const baseline = loadedModule.baseline
      ? collectValueExports(loadedModule.baseline, resolveDep)
      : new Set();

    // 本分支新增的导出（上游没有、现在有）——固定形状工厂必须覆盖它们。
    const added = [...current].filter((name) => !baseline.has(name));
    if (added.length === 0) continue;
    const missing = added.filter((name) => !mock.provided.has(name));
    if (missing.length === 0) continue;

    problems.push({
      testFile: toRepoPath(testFile),
      line: mock.line,
      module: mock.module,
      target: toRepoPath(targetFile),
      missing,
    });
  }
}

if (problems.length > 0) {
  console.error(
    '[FAIL] 发现「固定形状 mock 工厂」漏掉了被 mock 模块**本分支新增**的导出：\n' +
      '（这会让 vitest 抛 `No "X" export is defined on the mock`，把上游测试从绿变红）\n',
  );
  for (const problem of problems) {
    console.error(
      `  ${problem.testFile}:${problem.line}  mock ${problem.module}  →  ${problem.target}`,
    );
    console.error(`      本分支新增但工厂未提供：${problem.missing.join('、')}`);
  }
  console.error(
    '\n修复二选一：\n' +
      '  a) 在该工厂里补上这些导出（语义要与真实实现一致，别为了让测试变绿而降低测试强度）；\n' +
      "  b) 把工厂改成开放式的：vi.mock('模块', async (importOriginal) => ({\n" +
      '       ...(await importOriginal()),\n' +
      '       // 只覆盖需要替换的部分\n' +
      '     }))',
  );
  process.exit(1);
}

console.log(
  '上游 mock 工厂导出面检查通过：所有固定形状工厂都覆盖了被 mock 模块在本分支新增的导出。',
);
