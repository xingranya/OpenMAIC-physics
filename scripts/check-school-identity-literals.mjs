#!/usr/bin/env node
/**
 * 校本身份字面量门禁。
 *
 * 硬约束：全站不得出现硬编码的校名 / 班级 / 师生字面量，
 * 一律经由 `lib/school/identity.ts` 读取。
 *
 * 为什么需要这个门禁：第四轮独立复审发现三处绕过——页面 title、首页校徽
 * alt、某个学生视图的兜底对象——都直接写了字面量。这类问题在 code review
 * 里极容易漏（值和 identity 里的完全一致，功能上没有任何异常），
 * 所以必须靠自动化检查拦。
 *
 * 扫描口径（用 TypeScript AST，不做正则）：
 * - 只扫 `app/`、`components/`、`lib/` 下的 `.ts` / `.tsx`；
 * - `lib/school/` 是身份定义处本身，排除；
 * - 覆盖四种字符串来源：
 *   ① 字符串字面量 `'…'` / `"…"`；
 *   ② 无插值模板字符串 `` `…` ``；
 *   ③ 模板字符串的各段（含多行模板）；
 *   ④ **JSX 文本节点**——React 组件里写死校名最自然的写法就是它，
 *      只查引号字面量会完全看不见（第五轮复审实测漏报）；
 * - 另加一条**拼接**检查：`'长江' + '大学'` 这类拼接也要命中；
 * - 用 AST 的另一个好处：**注释天然不在字面量节点里**，
 *   所以行尾注释里带引号的中文不会再被误判（第五轮复审 F 项误报）。
 *
 * 已知边界：`const a = '文理'; const b = '学院';` 这种跨变量的拼接
 * 静态不可判定——刻意绕过检查不在本门禁的职责范围内。
 *
 * 用法：node scripts/check-school-identity-literals.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * 动态载入 TypeScript 编译器 API。
 *
 * `typescript` 是 devDependency（门禁属于开发期工具）。若在只装了生产依赖的
 * 环境里跑这个脚本，要给出可读提示，而不是一段 ERR_MODULE_NOT_FOUND。
 */
const ts = await (async () => {
  try {
    return (await import('typescript')).default;
  } catch {
    console.error('[FAIL] 找不到 typescript —— 本门禁需要它来解析 AST（含 JSX 文本节点）。');
    console.error('  请先执行 pnpm install（typescript 在 devDependencies 里）。');
    process.exit(1);
  }
})();

/**
 * 禁止出现在源码字符串里的词元（校名 / 学院 / 班级 / 师生）。
 *
 * 用**词元**而不是完整词匹配：`长江大学文理学院` 只要写了 `长江` 就算命中，
 * 否则拼接写法（`'长江' + '大学文理学院'`）会绕过检查。
 *
 * `match: 'exact'` 用于「2601」这类**裸编号**——否则会误伤模型版本号
 * （`doubao-seedream-5-0-260128` 里也含 "2601"）。
 *
 * 班级号用**正则**而不是字面量：「2601 班」写成「2601班」「2601  班」
 * （少一个空格）同样是要拦的，所以数字与"班"之间允许任意空白。
 */
const FORBIDDEN = [
  { text: '长江', match: 'includes' },
  { text: '文理学院', match: 'includes' },
  { text: '2601', match: 'class-number' },
  { text: '陈思远', match: 'includes' },
  { text: '顿老师', match: 'includes' },
  { text: 'dunzhongwan', match: 'includes' },
];

/**
 * 词元白名单：某些合法的中文搭配会命中上面的词元（例如「长江流域」）。
 *
 * 语义是「**只放行命中的那个片段**」，不是「整条字面量放行」——
 * 否则 `'长江流域 长江大学'` 会因为前半截合法而整条被放行，
 * 后半截的真校名就漏了（第六轮复审实测的绕过）。
 */
const ALLOWED_LITERAL_PATTERNS = [
  { token: '长江', pattern: /长江(流域|大桥|三角洲|水温|水位|经济带)/ },
];

/**
 * 判断某个词元在字面量里的某次出现是否被白名单允许。
 *
 * @param {string} literal 字面量全文
 * @param {string} token 词元（如 '长江'）
 * @param {number} index 词元在该次命中中的起始位置
 */
function occurrenceAllowed(literal, token, index) {
  for (const rule of ALLOWED_LITERAL_PATTERNS) {
    if (rule.token !== token) continue;
    // 取从命中位置开始的一段，让 pattern 有上下文可用。
    const tail = literal.slice(index);
    const matched = rule.pattern.exec(tail);
    if (matched && matched.index === 0) return true;
  }
  return false;
}

/** 扫描根目录（相对仓库根）。 */
const SCAN_ROOTS = ['app', 'components', 'lib'];

/** 排除路径前缀（相对仓库根）。 */
const EXCLUDE_PREFIXES = ['lib/school'];

/** 允许出现字面量的文件（法务文本等）。 */
const ALLOWED_FILES = ['NOTICE'];

/** 把绝对路径转成仓库相对的正斜杠路径。 */
function toRepoPath(absolute) {
  return relative(ROOT, absolute).split(sep).join('/');
}

/** 递归收集指定扩展名的文件。 */
function collect(dir, extension, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, extension, out);
    } else if (name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 收集一个表达式里能静态确定的字符串片段。
 *
 * 支持：字符串字面量、无插值模板、模板各段、以及 `+` 拼接。
 * 返回 null 表示这段表达式里有非静态部分（变量、函数调用……）。
 */
function staticStringOf(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    // 模板里只要有插值，就只能取各段的字面量部分（分段检查）。
    return null;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringOf(node.left, source);
    const right = staticStringOf(node.right, source);
    if (left === null || right === null) return null;
    return left + right;
  }
  if (ts.isParenthesizedExpression(node)) {
    return staticStringOf(node.expression, source);
  }
  return null;
}

/**
 * 词元是否在字面量里出现，且这次出现没有被白名单放行。
 *
 * `class-number` 规则要同时覆盖两种写法：
 * - 裸编号：整个字面量就是 `2601`（不能误伤 `doubao-seedream-5-0-260128`）；
 * - 班级号：数字与"班"之间允许任意空白（`2601 班` / `2601班` / `2601  班`）。
 */
function matchesRule(literal, rule) {
  if (rule.match === 'exact') {
    return literal === rule.text;
  }
  if (rule.match === 'class-number') {
    if (literal === rule.text) return true;
    const pattern = new RegExp(`${rule.text}\\s*班`);
    let match;
    while ((match = pattern.exec(literal)) !== null) {
      if (!occurrenceAllowed(literal, rule.text, match.index)) return true;
    }
    return false;
  }
  // includes
  let index = literal.indexOf(rule.text);
  while (index !== -1) {
    if (!occurrenceAllowed(literal, rule.text, index)) return true;
    index = literal.indexOf(rule.text, index + rule.text.length);
  }
  return false;
}

/**
 * 扫描一个文件，返回违规记录。
 *
 * @returns {Array<{line:number, forbidden:string, literal:string}>}
 */
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
  const seen = new Set();

  const record = (literal, node) => {
    if (!literal) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const rule of FORBIDDEN) {
      if (!matchesRule(literal, rule)) continue;
      const key = `${line}:${rule.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        line,
        forbidden: rule.text,
        literal: literal.length > 80 ? `${literal.slice(0, 77)}...` : literal,
      });
    }
  };

  const visit = (node) => {
    // ① / ② 字符串字面量与无插值模板
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node.text, node);
    }
    // ③ 模板字符串的各段（覆盖多行模板）
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      record(node.text, node);
    }
    // ④ JSX 文本节点（React 里写死校名的最自然写法）
    else if (ts.isJsxText(node)) {
      const raw = node.getText(source);
      // JSX 文本里的空白与实体要归一，否则 `{'\u3000'}` 之类会误判
      const normalized = raw.replace(/&[a-z]+;|&#\d+;/gi, '').trim();
      if (normalized) record(normalized, node);
    }
    // ⑤ `+` 拼接
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const joined = staticStringOf(node, source);
      if (joined) record(joined, node);
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
    const repoPath = toRepoPath(file);
    if (ALLOWED_FILES.includes(repoPath)) continue;
    if (EXCLUDE_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) continue;

    for (const violation of scanFile(file)) {
      violations.push({ file: repoPath, ...violation });
    }
  }
}

if (violations.length > 0) {
  console.error('[FAIL] 发现绕过 lib/school/identity.ts 的硬编码校本字面量：\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.forbidden}]  ${v.literal}`);
  }
  console.error('\n修复：改为从 @/lib/school/identity 读取（SCHOOL / COURSE / PLATFORM / DEMO）。');
  process.exit(1);
}

console.log(
  `校本身份字面量检查通过：${SCAN_ROOTS.join(' / ')} 下未发现硬编码的校名 / 班级 / 师生字面量（含 JSX 文本与模板字符串）。`,
);
