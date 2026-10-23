/**
 * EdgeOne 函数包的依赖修复与校验（共享实现）。
 *
 * ## 要解决的问题
 *
 * EdgeOne Pages 的构建产物里，`node_modules/<pkg>/` 有时只是**一个桩目录**：
 * 版本号、exports 都对，但里面除了 package.json 什么都没有。
 * 平台部署时会剥离 node_modules，运行时全靠我们把 deps/ 挂进 NODE_PATH
 * 与 ESM 解析钩子——桩目录到了平台上就是 `Cannot find package` / 空体 500。
 *
 * 另一半的坑在**本地会骗人**：函数包位于仓库内，Node 沿父目录向上找
 * node_modules，一路找到仓库根，把产物里缺失的文件全给补上了。
 * 于是「本地全绿、线上 500」——线上凡是加载 @openmaic/storage 的路由
 * （/api/stages*、/api/folders*、/api/classroom…）全部返回空体 500，
 * 而其余路由正常。
 *
 * 所以这里的判定必须满足两条：
 *   1. 探针放在**仓库之外**（向上找不到任何 node_modules）；
 *   2. 解析结果必须落在产物 deps/ 里，否则视为「不是从产物解析到的」。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

export {
  listPackageDirs,
  resolvePackageRuntime,
  resolvePackagesRuntime,
} from './verify-edgeone-deps.mjs';

/**
 * 把一个包按「运行期真正会加载的文件」最小化拷贝到产物里。
 *
 * ## 为什么不能整包拷贝
 *
 * 函数包有 128 MiB 的硬上限。整包拷贝光 openai（9.5 MiB / 1296 个文件，
 * 一半是 .d.ts 类型声明）就装不下——而产物里真正需要的往往只是它的一条
 * require 闭包。
 *
 * ## 为什么不能只拷 package.json
 *
 * 产物里 opennext 留下的 `node_modules/<pkg>/` 就是这种桩目录：版本、exports
 * 都对，文件一个没有。
 *
 * ## 这里做什么
 *
 * 以「入口 + 其相对 require 闭包」为准：
 *   1. package.json 原样拷贝（exports 映射是运行时契约）；
 *   2. 入口 = exports 里声明的所有目标 + main/module（运行时可能 import 任意子路径）；
 *   3. 对每个入口文件，扫出**相对**说明符（./ 与 ../），递归跟随；
 *   4. 裸标识符（其它包）不在这里处理——它们是别的包，由各自的拷贝负责。
 */
export function copyRuntimeGraph(srcDir, destDir) {
  const copied = new Set();

  /** 按 Node 的相对解析规则找一个文件。 */
  const resolveRelative = (fromFile, spec) => {
    const base = resolve(dirname(fromFile), spec);
    const candidates = [
      base,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}.json`,
      join(base, 'index.js'),
      join(base, 'index.mjs'),
      join(base, 'index.cjs'),
    ];
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* 忽略读不到的候选 */
      }
    }
    return null;
  };

  /** 扫出源码里的相对说明符。 */
  const collectRelative = (file) => {
    let source = '';
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const specs = new Set();
    const patterns = [
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
      /\bfrom\s*["']([^"']+)["']/g,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\s+["']([^"']+)["']/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const spec = match[1];
        if (spec.startsWith('./') || spec.startsWith('../')) specs.add(spec);
      }
    }
    return [...specs];
  };

  const copyFile = (file) => {
    const real = (() => {
      try {
        return realpathSync(file);
      } catch {
        return file;
      }
    })();
    if (copied.has(real)) return;
    copied.add(real);
    const rel = relative(srcDir, real);
    if (rel.startsWith('..')) return; // 不拷包外的文件
    const dest = join(destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(real, dest, { dereference: true });
    for (const spec of collectRelative(real)) {
      const target = resolveRelative(real, spec);
      if (target) copyFile(target);
    }
  };

  // 1) package.json
  const manifest = join(srcDir, 'package.json');
  if (!existsSync(manifest)) return { files: 0, missing: [] };
  mkdirSync(destDir, { recursive: true });
  cpSync(manifest, join(destDir, 'package.json'), { dereference: true });

  // 2) 入口：exports 的所有目标 + main/module + index.js
  const missing = [];
  const entries = [];
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    parsed = null;
  }
  const pushExportTargets = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./')) entries.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) pushExportTargets(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) pushExportTargets(item);
    }
  };
  if (parsed && parsed.exports) pushExportTargets(parsed.exports);
  if (parsed && typeof parsed.main === 'string' && parsed.main.startsWith('./')) {
    entries.push(parsed.main);
  }
  if (parsed && typeof parsed.module === 'string' && parsed.module.startsWith('./')) {
    entries.push(parsed.module);
  }
  entries.push('./index.js');

  for (const entry of entries) {
    const target = resolveRelative(join(srcDir, 'package.json'), entry);
    if (target) {
      copyFile(target);
    } else {
      missing.push(entry);
    }
  }

  return { files: copied.size, missing };
}

/** 在工作区里找某个包的实体目录（跟随软链，兼容 workspace 包）。 */
export function resolveWorkspacePackageDir(workspaceRoot, name) {
  const candidates = [
    join(workspaceRoot, 'node_modules', name),
    join(workspaceRoot, 'packages', name),
    join(workspaceRoot, 'packages', '@openmaic', name.replace(/^@openmaic\//, '')),
  ];
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const real = realpathSync(candidate);
      if (existsSync(join(real, 'package.json'))) return real;
    } catch {
      /* 忽略不可用的候选 */
    }
  }
  return null;
}

/** 读工作区里某个包的 package.json（跟随软链，workspace 包也适用）。 */
export function readWorkspaceManifest(workspaceRoot, name) {
  const dir = resolveWorkspacePackageDir(workspaceRoot, name);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 读某个包在**产物里**的 manifest。
 *
 * 产物里每个包都有 manifest（哪怕只是桩目录，package.json 也在），
 * 而且它带着**真实包名**——这正是穿过 Turbopack 哈希别名的关键：
 * 别名 `postcss-9745a0d11e3197ae` 在工作区里根本不存在（工作区只有
 * `postcss`），但产物里那份 manifest 的 `name` 字段写着 `postcss`，
 * 顺着它就能找到真包、也就能找到它的传递依赖（nanoid 就是这么漏掉的）。
 */
export function readArtifactManifest(depsDir, name) {
  try {
    return JSON.parse(readFileSync(join(depsDir, name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 产物**运行期真正会加载**的包集合。
 *
 * 三部分：
 *   1. `.next/server` 里真实出现的裸标识符的根包；
 *   2. 上面这些包的**传递依赖**——运行期由外部包 require 的依赖不在
 *      `.next/server` 里，但一样要装得上（postcss → nanoid 就是这么漏的：
 *      nanoid 只被 postcss 在运行期 require，产物里根本没有它的字面引用）；
 *   3. **穿过 Turbopack 哈希别名**：别名在产物里的 manifest 写着真包名，
 *      顺着真包名继续走依赖链（否则 nanoid / yaml 永远不在集合里，
 *      修复步骤也就不会去补它们）。
 *
 * @param {(dir: string) => { esm: string[], cjs: string[] }} collectBareSpecifiers
 */
export function collectNeededPackages(fnDir, workspaceRoot, collectBareSpecifiers) {
  const depsDir = join(fnDir, 'deps');
  const { esm, cjs } = collectBareSpecifiers(join(fnDir, '.next', 'server'));
  const roots = new Set();
  for (const spec of [...esm, ...cjs]) {
    if (builtinModules.includes(spec)) continue;
    if (spec.startsWith('next/')) continue;
    const segments = spec.split('/');
    roots.add(spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]);
  }

  const needed = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop();
    if (needed.has(name)) continue;
    needed.add(name);

    // 先看产物里的 manifest（别名在这里能给出真包名），
    // 拿不到再退回工作区。
    const artifactManifest = readArtifactManifest(depsDir, name);
    const workspaceManifest = readWorkspaceManifest(workspaceRoot, name);
    const manifest = artifactManifest || workspaceManifest;
    if (!manifest) continue;

    // 别名 → 真包名：真包在 deps/ 里的目录名才是真实可解析的名字。
    const realName =
      artifactManifest && artifactManifest.name && artifactManifest.name !== name
        ? artifactManifest.name
        : name;
    if (realName !== name) needed.add(realName);

    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(manifest[field] || {})) {
        if (!needed.has(dep)) queue.push(dep);
      }
    }
  }
  return needed;
}

/**
 * 修复产物里**装不上的包**：凡是运行期入口解析不出来的，一律从工作区
 * 按运行期最小闭包重新实体化。
 *
 * 只修「运行期真正会加载」的那批：其余的桩包虽然也装不上，但运行期根本
 * 不会 require 它们，整包实体化又会把函数包顶出 128 MiB 上限——
 * 那属于浪费，不属于修复。
 *
 * 修不好 → 直接 fail-closed，绝不让「版本对、文件空」的桩包带着上线。
 */
export async function repairIncompletePackages(
  fnDir,
  workspaceRoot,
  collectBareSpecifiers,
  { log = console.log } = {},
) {
  const depsDir = join(fnDir, 'deps');
  const needed = collectNeededPackages(fnDir, workspaceRoot, collectBareSpecifiers);
  const { listPackageDirs, resolvePackagesRuntime, resolvePackageRuntime } =
    await import('./verify-edgeone-deps.mjs');

  const packages = listPackageDirs(depsDir).filter((pkg) => needed.has(pkg.name));
  if (packages.length === 0) return { repaired: 0, unrepairable: [], needed: needed.size };

  const statuses = await resolvePackagesRuntime(
    packages.map((p) => p.name),
    depsDir,
    fnDir,
  );
  if (statuses && statuses.error) {
    throw new Error(`依赖完整性探测失败：${statuses.error}`);
  }

  let repaired = 0;
  const unrepairable = [];
  for (const pkg of packages) {
    const status = statuses[pkg.name];
    if (!status || status.ok) continue;

    const source = resolveWorkspacePackageDir(workspaceRoot, pkg.name);
    if (!source) {
      unrepairable.push(`${pkg.name}（工作区里找不到源）`);
      continue;
    }
    const result = copyRuntimeGraph(source, pkg.dir);
    const after = await resolvePackageRuntime(pkg.name, depsDir, fnDir);
    if (!after.ok) {
      unrepairable.push(`${pkg.name}（修复后仍不可解析：${after.reason || after.esm || ''}）`);
      continue;
    }
    repaired += 1;
    log(`[prune-edgeone-function] 已修复残缺包：${pkg.name}（补入 ${result.files} 个运行期文件）`);
  }

  if (unrepairable.length > 0) {
    throw new Error(
      `以下包在产物里装不上，且无法从工作区修复：${unrepairable.join('、')}。` +
        '它们在平台运行期会变成 Cannot find package / MODULE_NOT_FOUND。',
    );
  }
  return { repaired, unrepairable, needed: needed.size };
}
