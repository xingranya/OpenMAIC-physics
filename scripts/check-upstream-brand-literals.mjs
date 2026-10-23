#!/usr/bin/env node
/**
 * 界面与出站层**不得出现上游品牌字面量**。
 *
 * ## 为什么要有这道门禁
 *
 * 本项目是 OpenMAIC 的二开，「全站无上游品牌残留」是硬约束。但这条约束
 * 在复审里被**两次**靠人工 grep 才发现：
 *
 *   - `components/access-code-modal.tsx` 的访问码弹框副标题直接写着
 *     「OpenMAIC」——那是**用户进门第一眼**看到的界面；
 *   - `components/physics/workbench.tsx` 的页脚写着「基于 OpenMAIC 二次开发」。
 *
 * 两次都是「靠人记得去 grep」，而不是「有东西拦着」。所以把它变成门禁。
 *
 * ## 拦什么、不拦什么
 *
 * 拦的是**界面文案**与**出站请求里标识「本应用是谁」的字段**——
 * 用户看得见的东西，以及会替我们署名到第三方服务上的东西。
 *
 * 明确**不拦**的（并在下面逐条给出理由）：
 *
 *   - `@openmaic/storage` 这类**工作区包名**：是上游被 vendored 进来的
 *     内部包标识，改名等于重写整个依赖图，收益为零、风险极大；
 *   - `openmaic_access` 这类**会话 Cookie 名**：内部协议常量；
 *   - `X-OpenMAIC-Element-Reference-Accepted` 这类**自有 API 的响应头名**：
 *     收发两端都在本仓库内，不对外呈现，也不表达「本应用是谁」。
 *
 * 上面三类都记在仓库根的 `NOTICE` 里（"出站请求标识"一节），决策是显式的。
 *
 * ## 怎么扫
 *
 * 用 TypeScript 的 AST 扫**字符串字面量 / 模板字面量 / JSX 文本 / `+` 拼接**，
 * **注释不在其中**——所以代码注释里说明「这段来自上游」不会被误伤，
 * 而真正会显示给用户的字符串会被抓住。
 *
 * 用法：node scripts/check-upstream-brand-literals.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 扫描根目录（相对仓库根）。`packages/` 不扫：那是 vendored 的上游代码。 */
const SCAN_ROOTS = ['app', 'components', 'lib'];

/**
 * 禁止出现的上游品牌字面量片段。
 *
 * 大小写敏感是有意的：`@openmaic/*` 是工作区包名（合法），
 * `openmaic_access` 是内部 Cookie 名（合法），它们都是小写。
 */
const FORBIDDEN = ['OpenMAIC', 'open.maic.chat', 'THU-MAIC'];

/**
 * 明确放行的**整个字面量**（精确匹配，不做子串放行）。
 *
 * 精确匹配是刻意的：若按片段放行，`X-OpenMAIC-…` 这条例外就会顺带
 * 放行所有含 `OpenMAIC` 的字面量——护栏当场失效。
 */
const ALLOWED_LITERALS = new Set([
  // 自有 API 的响应头名：收发两端都在本仓库内，不对外呈现。
  // 决策记录见仓库根 NOTICE 的「出站请求标识」一节。
  'X-OpenMAIC-Element-Reference-Accepted',
]);

/** 把绝对路径转成仓库相对的正斜杠路径。 */
function toRepoPath(absolute) {
  return relative(ROOT, absolute).split(sep).join('/');
}

/** 递归收集指定扩展名的文件。 */
function collect(dir, extension, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, extension, out);
    else if (name.endsWith(extension)) out.push(full);
  }
  return out;
}

/**
 * 判断一个字面量是否命中禁止片段。
 *
 * @param {string} literal 字面量全文
 * @returns {string|null} 命中的禁止片段；未命中返回 null
 */
export function matchForbiddenBrand(literal) {
  if (ALLOWED_LITERALS.has(literal)) return null;
  for (const token of FORBIDDEN) {
    if (literal.includes(token)) return token;
  }
  return null;
}

/** 扫描一个文件，返回违规记录。 */
function scanFile(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations = [];

  const record = (literal, node) => {
    if (!literal) return;
    const token = matchForbiddenBrand(literal);
    if (!token) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    violations.push({
      line,
      token,
      literal: literal.length > 100 ? `${literal.slice(0, 97)}...` : literal,
    });
  };

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node.text, node);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      record(node.text, node);
    } else if (ts.isJsxText(node)) {
      const normalized = node
        .getText(source)
        .replace(/&[a-z]+;|&#\d+;/gi, '')
        .trim();
      if (normalized) record(normalized, node);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      ts.isStringLiteral(node.left) &&
      ts.isStringLiteral(node.right)
    ) {
      record(node.left.text + node.right.text, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return violations;
}

const violations = [];

for (const scanRoot of SCAN_ROOTS) {
  const files = [...collect(join(ROOT, scanRoot), '.ts'), ...collect(join(ROOT, scanRoot), '.tsx')];
  for (const file of files) {
    for (const violation of scanFile(file)) {
      violations.push({ file: toRepoPath(file), ...violation });
    }
  }
}

if (violations.length > 0) {
  console.error('界面与出站层出现了上游品牌字面量：');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  命中「${v.token}」  ${v.literal}`);
  }
  console.error(
    '\n修法：界面文案改用 lib/school/identity.ts 的品牌常量（BRAND_FULL_NAME 等）；' +
      '出站请求里标识「本应用是谁」的字段改指向本产品自己。' +
      '若确实需要保留（工作区包名 / 内部协议常量），把它加进本脚本的 ALLOWED_LITERALS 并在 NOTICE 记录理由。',
  );
  process.exit(1);
}

console.log(
  `界面与出站层无上游品牌字面量（扫描 ${SCAN_ROOTS.join(' / ')}，` +
    `放行 ${ALLOWED_LITERALS.size} 个内部协议常量）。`,
);
