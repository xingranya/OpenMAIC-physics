import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * PPTX 导出链路的**接线**护栏（AST 判定）。
 *
 * 背景（第五轮 N1 / 第六轮 F1）：`tests/physics/pptx-branding.test.ts` 验的是
 * 「装饰之后产物里有没有页眉页脚」，但它自己调 `decorateSlidesWithBrand`
 * 再把结果喂给 `buildPptxBlob` —— 而 `buildPptxBlob` **内部并不做装饰**。
 *
 * 于是形成真实的覆盖缺口：把导出 hook 里的
 * `decorateSlidesWithBrand(slides, {…})` 换成 `slides`（模拟"导出不再调用
 * 装饰"），`pptx-branding.test.ts` 依然全绿。
 *
 * **为什么必须用 AST 而不是正则**：第六轮复审实测发现，正则断言会被
 * **源码注释里同形的文字**满足——注释里写着
 * `` // `const brandedSlides = decorateSlidesWithBrand(slides, …)` `` 时，
 * 即使真实代码已经被换成 `slides`，正则依然匹配那行注释，护栏形同虚设。
 * AST 不含注释，从根上避免这个陷阱。
 *
 * **为什么不能绑定变量名**：只断言"文件里出现过 `decorateSlidesWithBrand`"
 * 会误伤合法重构（把 `brandedSlides` 改名），也会被"调用还在、结果被丢弃"
 * 这类变异绕过。所以这里的判定是**语义**的：
 *   每个 `buildPptxBlob(...)` 调用点的首参，
 *   必须是一个变量，而该变量的初始值必须**就是** `decorateSlidesWithBrand(...)` 调用。
 */
const FILE = join(process.cwd(), 'lib/export/use-export-pptx.ts');
const source = ts.createSourceFile(
  FILE,
  readFileSync(FILE, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

/** 变量名 → 初始值表达式。 */
const declarations = new Map<string, ts.Expression>();

/** 所有 `buildPptxBlob(...)` 调用点。 */
const callSites: ts.CallExpression[] = [];

/** `buildPptxBlob` 函数体本身（用来确认它不自己装饰，避免双重装饰）。 */
let buildPptxBlobBody: ts.Node | null = null;

const collect = (node: ts.Node): void => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    declarations.set(node.name.text, node.initializer);
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'buildPptxBlob') {
    callSites.push(node);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'buildPptxBlob' && node.body) {
    buildPptxBlobBody = node.body;
  }
  ts.forEachChild(node, collect);
};
collect(source);

/**
 * 剥掉类型断言 / 括号。
 *
 * 真实代码写的是
 * `decorateSlidesWithBrand(slides, {…}) as unknown as Slide[]`，
 * AST 里这是一层 `AsExpression` 包着调用，不剥掉就认不出来。
 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(node))
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

/** 从 `@/lib/export/slide-branding` 导入的语句。 */
function brandImports(): ts.ImportDeclaration[] {
  return source.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier.getText(source) === "'@/lib/export/slide-branding'",
  );
}

/** 某个函数体里是否调用了给定名字的函数。 */
function callsInside(body: ts.Node | null, name: string): boolean {
  if (!body) return false;
  let found = false;
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) {
      found = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

describe('PPTX 导出的品牌装饰接线', () => {
  it('导出 hook 从共享实现导入装饰函数', () => {
    const imports = brandImports();
    expect(imports.length).toBe(1);
    const named = imports[0].importClause?.namedBindings;
    expect(named && ts.isNamedImports(named)).toBe(true);
    const names = (named as ts.NamedImports).elements.map((element) => element.name.text);
    expect(names).toContain('decorateSlidesWithBrand');
  });

  it('每个 buildPptxBlob 调用点的首参都是装饰后的画布', () => {
    expect(callSites.length).toBeGreaterThan(0);
    for (const call of callSites) {
      const arg = call.arguments[0];
      expect(arg, 'buildPptxBlob 的首参缺失').toBeDefined();
      expect(
        ts.isIdentifier(arg),
        `buildPptxBlob 的首参应是变量，实际是 ${arg?.getText(source)}`,
      ).toBe(true);

      const rawInitializer = declarations.get((arg as ts.Identifier).text);
      expect(rawInitializer, `变量 ${(arg as ts.Identifier).text} 没有初始值`).toBeDefined();
      const initializer = unwrapExpression(rawInitializer!);
      expect(
        ts.isCallExpression(initializer),
        `变量 ${(arg as ts.Identifier).text} 的初始值不是函数调用`,
      ).toBe(true);
      // 关键判定：初始值必须**就是**共享的装饰函数。
      expect(
        (initializer as ts.CallExpression).expression.getText(source),
        `变量 ${(arg as ts.Identifier).text} 的初始值不是 decorateSlidesWithBrand 调用`,
      ).toBe('decorateSlidesWithBrand');
    }
  });

  it('buildPptxBlob 内部不做装饰（避免同一页出现两条页眉）', () => {
    expect(callsInside(buildPptxBlobBody, 'decorateSlidesWithBrand')).toBe(false);
    expect(callsInside(buildPptxBlobBody, 'buildBrandElements')).toBe(false);
  });

  it('导出 hook 不再自行拼装装饰元素（避免两处实现分叉）', () => {
    for (const statement of brandImports()) {
      const named = statement.importClause?.namedBindings;
      if (!named || !ts.isNamedImports(named)) continue;
      const names = named.elements.map((element) => element.name.text);
      expect(names).not.toContain('buildBrandElements');
    }
  });
});
