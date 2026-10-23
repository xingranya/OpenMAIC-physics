/**
 * 函数包依赖完整性校验：deps/ 下每个包**真的能被解析**吗？
 *
 * ## 为什么需要这一步
 *
 * EdgeOne Pages 的构建产物里，`node_modules/<pkg>/` 有时只是**一个桩目录**：
 * 版本号、exports 都对，但里面除了 package.json 什么都没有。
 * 平台在部署时会剥离 node_modules，运行时全靠我们把 deps/ 挂进 NODE_PATH
 * 与 ESM 解析钩子——桩目录到了平台上就是 `Cannot find package`。
 *
 * 更隐蔽的是：**本仓库里的 node_modules 会替这些桩兜底**。
 * 函数包位于仓库内，Node 沿父目录向上找 node_modules，一路找到仓库根，
 * 于是「本地全绿、线上 500」——线上 `/api/stages*` 返回空体 500 就是这么来的
 * （凡是加载 @openmaic/storage 的路由全挂，其余路由正常）。
 *
 * 所以这里的探针必须满足两条：
 *   1. **不执行**模块（避免 sharp 这类平台原生包在 macOS 上误报）；
 *   2. **向上找不到任何 node_modules**（探针目录放在仓库之外），
 *      解析结果必须落在 deps/ 里，否则视为「不是从产物解析到的」。
 *
 * 判定用 Node 自己的解析器（require.resolve / import.meta.resolve），
 * 而不是自己解析 package.json 的 exports——条件顺序（node/import/require/default）
 * 与子路径映射由 Node 说了算，自己实现必然漂移。
 */
import { spawnSync } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { outsideRepoTemp } from './edgeone-temp.mjs';

/** 列出 node_modules 下的包条目（含 @scope 两级）。返回 [{ name, dir }]。 */
export function listPackageDirs(dir) {
  const out = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (name.startsWith('@')) {
      let scoped = [];
      try {
        scoped = readdirSync(full);
      } catch {
        continue;
      }
      for (const sub of scoped) {
        const subFull = join(full, sub);
        try {
          if (statSync(subFull).isDirectory()) out.push({ name: `${name}/${sub}`, dir: subFull });
        } catch {
          /* 忽略读不到的条目 */
        }
      }
      continue;
    }
    out.push({ name, dir: full });
  }
  return out;
}

/**
 * 用 Node 自己的解析器判定「这个包名能不能解析出真实文件」。
 *
 * @param {string} name 包名
 * @param {string} fromDir 解析起点目录（其 package.json 作为 require 的 parent）
 * @param {string} depsDir 产物依赖目录
 * @returns {{ ok: boolean, resolved?: string, reason?: string }}
 */
function resolveCjs(name, fromDir, depsDir) {
  const previous = process.env.NODE_PATH;
  const previousPaths = Module.globalPaths;
  process.env.NODE_PATH = depsDir;
  // **必须**重新初始化路径：Node 在启动时把 NODE_PATH 固化进 Module.globalPaths，
  // 光改环境变量不调用 _initPaths() 的话，NODE_PATH 根本不生效——
  // 探针会一路报 MODULE_NOT_FOUND，看起来像「包装不上」，其实是探针自己坏了。
  Module._initPaths();
  try {
    // createRequire 需要一个真实存在的文件作为 parent
    const parent = join(fromDir, 'package.json');
    if (!existsSync(parent)) return { ok: false, reason: 'parent 缺少 package.json' };
    const req = createRequire(parent);
    const resolved = req.resolve(name);
    if (!resolved.startsWith(depsDir)) {
      return { ok: false, reason: `解析到了产物之外：${resolved}`, resolved };
    }
    if (!existsSync(resolved)) return { ok: false, reason: '入口文件不存在', resolved };
    return { ok: true, resolved };
  } catch (error) {
    return { ok: false, reason: error && error.code ? error.code : String(error && error.message) };
  } finally {
    if (previous === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previous;
    Module.globalPaths = previousPaths;
    Module._initPaths();
  }
}

/**
 * 这个包到底是不是「JS 包」？
 *
 * 原生二进制包（@img/sharp-linux-x64 之类）没有 JS 入口，
 * 既不能被 require 也不能被 import —— 那不是「破损」，而是它本来的样子。
 * 把它们算成破损，门禁就会变成永远红的噪音。
 */
export function hasJsEntryForTest(pkgDir) {
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
  if (manifest.exports) return true;
  if (typeof manifest.main === 'string' || typeof manifest.module === 'string') return true;
  return existsSync(join(pkgDir, 'index.js'));
}

/**
 * 用 ESM 解析器（import.meta.resolve）判定包名能否解析。
 * 不执行模块，只解析。
 */
function resolveEsmBatch(fnDir, specifiers) {
  const script = `
    import { register } from 'node:module';
    import { pathToFileURL } from 'node:url';
    register(pathToFileURL(${JSON.stringify(join(fnDir, 'esm-hooks.mjs'))}).href);
    const specs = ${JSON.stringify(specifiers)};
    const out = {};
    for (const spec of specs) {
      try {
        out[spec] = { ok: true, url: import.meta.resolve(spec) };
      } catch (error) {
        out[spec] = { ok: false, reason: error && error.code ? error.code : String(error && error.message) };
      }
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const probeDir = outsideRepoTemp('edgeone-deps-probe');
  try {
    writeFileSync(join(probeDir, 'package.json'), '{"name":"edgeone-deps-probe"}');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: probeDir,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    if (result.status !== 0) {
      return { error: `ESM 探针子进程失败：${(result.stderr || '').slice(-800)}` };
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { error: `ESM 探针输出不可解析：${result.stdout.slice(-400)}` };
    }
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
}

/**
 * 批量判定若干包名在产物里能不能解析出真实文件。
 *
 * CJS 与 ESM 各走各的解析器（条件顺序不同），任一条通就算这个包可用
 * ——纯 ESM 包与纯 CJS 包都合法。两条都不通 = 入口文件真的不在产物里。
 *
 * ESM 侧只起**一个**子进程批量解析：每个包起一次进程太慢，
 * 而裁剪脚本要对几十个包逐个判断「装不装得上」。
 *
 * @param {string[]} names 包名
 * @param {string} depsDir 产物依赖目录
 * @param {string} fnDir 函数包目录（ESM 探针需要它定位 esm-hooks.mjs）
 */
export async function resolvePackagesRuntime(names, depsDir, fnDir) {
  const probeDir = outsideRepoTemp('edgeone-deps-parent');
  writeFileSync(join(probeDir, 'package.json'), '{"name":"edgeone-deps-parent"}');
  try {
    const esmResult = resolveEsmBatch(fnDir, names);
    if (esmResult && esmResult.error) {
      return { error: esmResult.error };
    }
    const out = {};
    for (const name of names) {
      const cjs = resolveCjs(name, probeDir, depsDir);
      const esm = esmResult[name] || { ok: false, reason: '未返回结果' };
      const esmOk = Boolean(esm.ok && esm.url && esm.url.startsWith(pathToFileURL(depsDir).href));
      const esmReason = esm.ok ? (esmOk ? undefined : `解析到了产物之外：${esm.url}`) : esm.reason;
      if (cjs.ok || esmOk) {
        out[name] = { ok: true, resolved: cjs.ok ? cjs.resolved : esm.url };
      } else {
        out[name] = { ok: false, reason: cjs.reason, esm: esmReason };
      }
    }
    return out;
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
}

/** 单包版本（便捷封装）。 */
export async function resolvePackageRuntime(name, depsDir, fnDir) {
  const result = await resolvePackagesRuntime([name], depsDir, fnDir);
  if (result.error) return { ok: false, reason: result.error };
  return result[name] || { ok: false, reason: '未返回结果' };
}

/**
 * 校验函数包 deps/ 的依赖完整性。
 *
 * @param {string} fnDir 函数包目录
 * @returns {Promise<{ ok: boolean, checked: number, broken: Array<{ name: string, dir: string, cjs?: string, esm?: string }>, probeError?: string }>}
 */
export async function verifyEdgeOneDeps(fnDir) {
  const depsDir = join(fnDir, 'deps');
  const top = listPackageDirs(depsDir);
  const broken = [];
  let checked = 0;

  // 探针目录放在仓库之外：向上找不到任何 node_modules，
  // 解析结果只可能来自 NODE_PATH → deps/。
  const probeDir = outsideRepoTemp('edgeone-deps-parent');
  writeFileSync(join(probeDir, 'package.json'), '{"name":"edgeone-deps-parent"}');

  try {
    // ---- 顶层包：按包名解析 ----
    const jsPackages = top.filter((pkg) => hasJsEntryForTest(pkg.dir));
    const esmResult = resolveEsmBatch(
      fnDir,
      jsPackages.map((p) => p.name),
    );
    if (esmResult && esmResult.error) {
      return { ok: false, checked: 0, broken, probeError: esmResult.error };
    }

    for (const pkg of jsPackages) {
      checked += 1;
      const cjs = resolveCjs(pkg.name, probeDir, depsDir);
      const esm = esmResult[pkg.name] || { ok: false, reason: '未返回结果' };
      const esmOk = Boolean(esm.ok && esm.url && esm.url.startsWith(pathToFileURL(depsDir).href));
      const esmReason = esm.ok ? (esmOk ? undefined : `解析到了产物之外：${esm.url}`) : esm.reason;
      // CJS 与 ESM 只要有一条通就算这个包可用（纯 ESM / 纯 CJS 包都合法）。
      // 两条都不通 = 入口文件真的不在产物里 = 线上必然 MODULE_NOT_FOUND。
      if (!cjs.ok && !esmOk) {
        broken.push({
          name: pkg.name,
          dir: relative(fnDir, pkg.dir),
          cjs: cjs.reason,
          esm: esmReason,
        });
      }
    }

    // ---- 嵌套包：deps/<pkg>/node_modules/<dep> ----
    for (const pkg of top) {
      const nestedDir = join(pkg.dir, 'node_modules');
      if (!existsSync(nestedDir)) continue;
      for (const nested of listPackageDirs(nestedDir)) {
        if (!hasJsEntryForTest(nested.dir)) continue;
        checked += 1;
        const cjs = resolveCjs(nested.name, nestedDir, depsDir);
        if (!cjs.ok) {
          broken.push({
            name: `${pkg.name}/node_modules/${nested.name}`,
            dir: relative(fnDir, nested.dir),
            cjs: cjs.reason,
          });
        }
      }
    }
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  return { ok: broken.length === 0, checked, broken };
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fnDir = process.argv[2] || join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node');
  const result = await verifyEdgeOneDeps(fnDir);
  if (result.probeError) {
    console.error(`[verify-edgeone-deps] 探针失败：${result.probeError}`);
    process.exit(2);
  }
  console.log(`[verify-edgeone-deps] 检查 ${result.checked} 个包，破损 ${result.broken.length} 个`);
  for (const item of result.broken) {
    console.log(
      `  ✗ ${item.name}  (${item.dir})` +
        `${item.cjs ? `  CJS=${item.cjs}` : ''}${item.esm ? `  ESM=${item.esm}` : ''}`,
    );
  }
  process.exit(result.ok ? 0 : 1);
}
