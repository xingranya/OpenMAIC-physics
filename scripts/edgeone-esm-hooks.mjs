// EdgeOne Pages 云函数：ESM 解析钩子。
//
// 本文件**就是**部署产物里的那份钩子（scripts/prune-edgeone-function.mjs
// 原样把它拷进函数包），不是它的副本——
// 这样它可以被单测直接验证，不必在脚本里再抄一份模板字符串。
//
// 平台剥离 node_modules，依赖放在 deps/。CJS 走 NODE_PATH，
// 但 ESM 不认 NODE_PATH —— Turbopack 的 externalImport 用的正是
// 原生 `await import(id)`，缺了这个钩子就会
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg-<hash>'
//
// 这里把「默认解析失败」的裸标识符回退到 deps/ 下的同名包。
//
// 函数入口请调用本文件导出的 `registerEsmHooks()`（而不是自己裸调
// `module.register(...)`）：注册失败时它会打印可读诊断并返回 {ok:false}，
// 入口据此给出可读的错误，而不是让异常在入口最前面把函数打崩。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const depsDir = join(dirname(fileURLToPath(import.meta.url)), 'deps');

/** 把裸标识符拆成「包名 + 子路径」。 */
function splitSpecifier(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return { name: parts.slice(0, 2).join('/'), subpath: parts.slice(2).join('/') };
  }
  return { name: parts[0], subpath: parts.slice(1).join('/') };
}

/**
 * 从条件对象里挑出一个具体目标。
 * 条件顺序对齐 Node 的 ESM 解析顺序：node → import → require → default。
 */
function pickCondition(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  for (const condition of ['node', 'import', 'require', 'default']) {
    const picked = pickCondition(value[condition]);
    if (picked) return picked;
  }
  return null;
}

/** 读包的 package.json（读不到就当没有）。 */
function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 按 package.json 的 exports/main/module 找出包的入口文件。
 *
 * **字段优先级必须对齐 Node 的 ESM 解析**：
 * `exports`（含 import/require/default 条件）→ `main` → `module`。
 *
 * `module` 是**打包器**（webpack/rollup）的约定，**Node 根本不读这个字段**——
 * Node 只认 `exports` → `import` → `main`。把它排在 `main` 前面，
 * 等于「拿 bundler 的规矩去解析 Node 的 import」，与线上真实行为不一致
 * （当前函数包里的目标包都没同时给 `main` 与 `module`，所以此前没暴露）。
 */
function resolvePackageEntry(dir) {
  const manifest = readManifest(dir);
  const candidates = [];
  if (manifest) {
    const root = manifest.exports && manifest.exports['.'];
    const picked = pickCondition(root);
    if (picked) candidates.push(picked);
    if (typeof manifest.main === 'string') candidates.push(manifest.main);
    if (typeof manifest.module === 'string') candidates.push(manifest.module);
  }
  candidates.push('index.js');
  for (const candidate of candidates) {
    const full = join(dir, candidate);
    try {
      if (existsSync(full) && statSync(full).isFile()) return full;
    } catch {
      /* 忽略不可读的候选 */
    }
  }
  return null;
}

/**
 * 按 exports 映射解析**子路径**（例如 别名/node → ./dist/node.js）。
 * 只探文件系统是不够的：很多包的 exports 子路径并不对应同名目录。
 */
function resolveExportsSubpath(dir, subpath) {
  const manifest = readManifest(dir);
  if (!manifest || !manifest.exports || typeof manifest.exports !== 'object') return null;
  const target = manifest.exports['./' + subpath];
  if (!target) return null;
  const picked = pickCondition(target);
  if (!picked) return null;
  const full = join(dir, picked);
  try {
    if (existsSync(full) && statSync(full).isFile()) return full;
  } catch {
    return null;
  }
  return null;
}

/** 在 deps/ 下找一个裸标识符对应的文件。 */
function resolveInDeps(specifier) {
  const parts = splitSpecifier(specifier);
  const base = join(depsDir, parts.name);
  if (parts.subpath) {
    // 1) 先按 exports 映射解析（子路径常常不对应同名目录）
    const viaExports = resolveExportsSubpath(base, parts.subpath);
    if (viaExports) return viaExports;
    // 2) 再探文件系统：子路径本身是文件，或是一个目录（按目录里的包入口解析）
    const candidate = join(base, parts.subpath);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return resolvePackageEntry(candidate);
      }
    } catch {
      return null;
    }
    return null;
  }
  return resolvePackageEntry(base);
}

export async function resolve(specifier, context, nextResolve) {
  // 相对路径 / 绝对路径 / 带协议（node:、file:、data:）/ #imports 一律走默认解析。
  const isBare =
    typeof specifier === 'string' &&
    specifier.length > 0 &&
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('#') &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier);
  if (!isBare) return nextResolve(specifier, context);
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const target = resolveInDeps(specifier);
    if (!target) throw error;
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
}

/**
 * 注册本解析钩子（**带兜底诊断**）。
 *
 * 函数入口（函数包里的 index.mjs）应该调用**这个函数**，
 * 而不是自己裸调 `module.register(...)`：
 *
 *   - 裸调一旦抛错（Node < 20.6 没有 `module.register`、钩子文件路径不对、
 *     钩子线程启动失败……），异常会在**入口最前面**抛出，
 *     函数直接崩掉，平台侧只看到「函数起不来」，看不到原因；
 *   - 这里把异常**接住**并打印可读诊断（含「钩子没注册上 → 裸标识符
 *     （pg-<hash> 等）不会被映射到 deps/ → 运行时会抛 ERR_MODULE_NOT_FOUND」，
 *     让入口能据此给出可读的错误，而不是静默崩溃。
 *
 * @param {object} options
 * @param {string} [options.hooksUrl] 钩子文件 URL（默认就是本文件）
 * @param {string} [options.parentUrl] 父模块 URL（默认就是本文件）
 * @param {Function} [options.register] 注入的 register（测试用）
 * @param {Function} [options.log] 注入的日志函数（测试用）
 * @returns {Promise<{ok: boolean, error?: unknown, message?: string}>}
 */
export async function registerEsmHooks(options = {}) {
  const {
    // 注意：必须传 **URL 对象**，不能传 href 字符串——
    // `module.register()` 对字符串 specifier 走「相对父 URL 解析」，
    // 传 'file://…' 字符串会被拼成 '<父目录>/file:/…' 这种废路径，注册必然失败。
    // 而 import.meta.url **本身就是 URL 字符串**，要转 URL 对象得用 new URL(...)，
    // 不能用 pathToFileURL(...)——后者把 URL 字符串当**文件路径**，会拼出另一条废路径。
    hooksUrl = new URL(import.meta.url),
    parentUrl = new URL(import.meta.url),
    register: registerFn,
    log = console.log,
  } = options;
  try {
    const register = registerFn ?? (await import('node:module')).register;
    register(hooksUrl, parentUrl);
    log('[edgeone-esm-hooks] ESM 解析钩子已注册（deps/ 作为裸标识符解析目标）');
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(
      '[edgeone-esm-hooks] ⚠ ESM 解析钩子注册失败：' +
        detail +
        '\n  钩子没注册上，裸标识符（pg-<hash> 等）不会被映射到 deps/，' +
        '运行时会抛 ERR_MODULE_NOT_FOUND。' +
        '请确认 node:module.register 可用（Node ≥ 20.6），且 esm-hooks.mjs 与函数入口同级。',
    );
    return { ok: false, error, message: detail };
  }
}
