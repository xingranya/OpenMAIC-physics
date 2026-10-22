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
 * 按 package.json 的 exports/module/main 找出包的入口文件。
 */
function resolvePackageEntry(dir) {
  const manifest = readManifest(dir);
  const candidates = [];
  if (manifest) {
    const root = manifest.exports && manifest.exports['.'];
    const picked = pickCondition(root);
    if (picked) candidates.push(picked);
    if (typeof manifest.module === 'string') candidates.push(manifest.module);
    if (typeof manifest.main === 'string') candidates.push(manifest.main);
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
