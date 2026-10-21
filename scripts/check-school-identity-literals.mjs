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
 * 扫描口径：
 * - 只扫 `app/`、`components/`、`lib/` 下的 `.ts` / `.tsx`；
 * - `lib/school/` 是身份定义处本身，排除；
 * - 逐行剔除注释行（注释里的说明文字不算"出现在站上"）；
 * - 白名单：`scripts/`（校验脚本自身需要字面量）、`tests/`、`NOTICE` 等法务文本。
 *
 * 用法：node scripts/check-school-identity-literals.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * 禁止出现在源码字符串里的字面量（校名 / 学院 / 班级 / 师生）。
 *
 * 用**词元**而不是完整词匹配：`长江大学文理学院` 只要写了 `长江` 就算命中，
 * 否则拼接写法（`'长江' + '大学文理学院'`）会绕过检查。
 *
 * `match: 'exact'` 用于「2601」这类**裸编号**——否则会误伤模型版本号
 * （`doubao-seedream-5-0-260128` 里也含 "2601"）。班级全称另有
 * `includes` 规则兜住（「物理学 2601 班」）。
 */
const FORBIDDEN = [
  { text: '长江', match: 'includes' },
  { text: '文理学院', match: 'includes' },
  { text: '2601 班', match: 'includes' },
  { text: '2601', match: 'exact' },
  { text: '陈思远', match: 'includes' },
  { text: '顿老师', match: 'includes' },
  { text: 'dunzhongwan', match: 'includes' },
];

/** 扫描根目录（相对仓库根）。 */
const SCAN_ROOTS = ['app', 'components', 'lib'];

/** 排除路径前缀（相对仓库根）。 */
const EXCLUDE_PREFIXES = ['lib/school'];

/** 允许出现字面量的文件（法务文本、校验脚本等）。 */
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

/** 判断是不是注释行（含行尾注释的判定从简：只看行首）。 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  );
}

/**
 * 从一行代码里抽出字符串字面量，避免把标识符 / 属性名误判。
 * 只处理单引号、双引号、反引号包裹的简单字面量。
 */
function stringLiterals(line) {
  const literals = [];
  const pattern = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    literals.push(match[2]);
  }
  return literals;
}

const violations = [];

for (const scanRoot of SCAN_ROOTS) {
  const files = [...collect(join(ROOT, scanRoot), '.ts'), ...collect(join(ROOT, scanRoot), '.tsx')];
  for (const file of files) {
    const repoPath = toRepoPath(file);
    if (ALLOWED_FILES.includes(repoPath)) continue;
    if (EXCLUDE_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      const literals = stringLiterals(line);
      // 除了单个字面量，还检查"同一行所有字面量拼接后"的结果——
      // 否则 `'长江' + '大学文理学院'` 这类拼接写法会绕过检查。
      const candidates = literals.length > 1 ? [...literals, literals.join('')] : literals;
      for (const literal of candidates) {
        for (const rule of FORBIDDEN) {
          const hit = rule.match === 'exact' ? literal === rule.text : literal.includes(rule.text);
          if (hit) {
            violations.push({
              file: repoPath,
              line: index + 1,
              forbidden: rule.text,
              literal: literal.length > 80 ? `${literal.slice(0, 77)}...` : literal,
            });
          }
        }
      }
    });
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
  `校本身份字面量检查通过：${SCAN_ROOTS.join(' / ')} 下未发现硬编码的校名 / 班级 / 师生字面量。`,
);
