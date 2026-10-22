#!/usr/bin/env node
/**
 * 裁剪 EdgeOne 云函数包（.edgeone/cloud-functions/ssr-node/）。
 *
 * 为什么需要裁剪：EdgeOne Pages 的 Cloud SSR Node 函数包有 **128MiB 硬上限**，
 * 超限平台直接拒绝部署（部署记录状态 Failed，错误码 30，原始报错：
 *   Error: Cloud SSR Node functions package size exceeds 128MiB limit (422MiB)
 * 这个上限作用在**平台解包后**的目录体积上，不是压缩包体积。
 *
 * 本项目（上游 OpenMAIC 全量 + 物理工作台）打包后约 300MiB，超限 2 倍多。
 * 其中绝大部分是**在 EdgeOne 上永远用不到、却被打进包里**的东西：
 *
 *   1. sharp 的 6 个平台原生变体（约 133MiB）
 *      `sharp` 的 optionalDependencies 会把所有平台的 libvips 一起装进
 *      node_modules，Next 的文件追踪会原样带进函数包。EdgeOne 的函数运行时
 *      固定是 linux-x64；而且 EdgeOne CLI 会给 Next 注入自定义图片加载器
 *      （images.loader='custom'），**Next 自己的 image optimizer 完全不碰
 *      sharp**。所以只有「应用自己直接 import sharp」用的那一份
 *      （sharp 0.35.4 → libvips 1.3.3，linux-x64）是必需的。
 *
 *   2. 项目源码的整份拷贝（约 34MiB）
 *      opennext 会把项目根目录整体复制进函数包。运行时真正需要的只有
 *      `packages/`（workspace 包的软链目标）、`skills/`、以及
 *      outputFileTracingIncludes 里点名的那一个 mjs；app/ components/ lib/
 *      tests/ e2e/ eval/ docs/ 等在运行时一个字节都不会被读到。
 *
 *   3. public/vendor/maic-importer（约 9MiB）
 *      maic-importer 的产物是通过 **URL 动态 import** 的静态资源，由平台的
 *      静态资源托管（.edgeone/assets/vendor/maic-importer）提供；函数包里
 *      放的那份是纯重复。
 *
 * 裁剪只动 `.edgeone/` 下的产物，不改仓库任何源码。
 *
 * 用法：
 *   node scripts/prune-edgeone-function.mjs            # dry-run，只报告
 *   node scripts/prune-edgeone-function.mjs --yes      # 真正执行
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FN_DIR = join(ROOT, '.edgeone', 'cloud-functions', 'ssr-node');
const APPLY = process.argv.includes('--yes');

/** 函数包里必须保留的顶层条目（其余整个删掉）。 */
const KEEP_TOP_LEVEL = new Set([
  // 运行时代码与依赖
  '.next',
  'node_modules',
  'packages', // workspace 包的软链目标：node_modules/@openmaic/* -> ../../packages/...
  'skills', // agent runtime 在运行时读 skills/**
  'public', // 静态资源兜底（静态托管已在 .edgeone/assets 里）
  'lib', // 只保留 outputFileTracingIncludes 点名的那个 mjs（见 pruneLib）
  // 运行时配置与入口
  'package.json',
  'server.js',
  'index.mjs',
  'handler.js',
  'bootstrap.js',
  'config.json',
  'run-config.json',
  'tag-manifest.json',
  'next.config.original.ts',
  'edgeone.json',
  'instrumentation.ts',
  'middleware.ts',
  '.edgeone', // 平台注入的运行时
  // 许可随包分发
  'LICENSE',
  'NOTICE',
]);

/** lib/ 下唯一需要保留的文件（next.config.ts 的 outputFileTracingIncludes 点名）。 */
const KEEP_LIB_FILES = new Set(['server/agent-runtime/import-pptx-worker.mjs']);

/**
 * sharp 的原生变体：只保留 linux-x64 的 libvips 1.3.3（应用直接依赖的
 * sharp 0.35.4 所对应的那份）。其余一律删除：
 *   - libvips 1.2.4（Next 自带的 sharp 0.34.5）：EdgeOne 上 Next 用的是
 *     注入的自定义图片加载器，Next 的 image optimizer 不会 dlopen sharp；
 *   - darwin-arm64、linux-arm64、linuxmusl 各变体：EdgeOne 运行时不是这些平台。
 */
const KEEP_SHARP_PNPM = new Set([
  '@img+sharp-libvips-linux-x64@1.3.3',
  '@img+sharp-linux-x64@0.35.4',
]);

/** 需要删掉的顶层文件（构建/测试/工具链配置，运行时一律不用）。 */
const DROP_TOP_FILES = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.typecheck.json',
  'vitest.config.ts',
  'vitest.eval.config.ts',
  'playwright.config.ts',
  'eslint.config.mjs',
  'postcss.config.mjs',
  'components.json',
  'app.json',
  'vercel.json',
  'docker-compose.yml',
  'Dockerfile',
  'next.config.ts',
  'SECURITY.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'README.md',
  'README-zh.md',
  'comfyui-setup-instructions.md',
]);

/** 递归统计目录体积（字节）。 */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* 文件可能已被并发移除 */
        }
      }
    }
  }
  return total;
}

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);

if (!existsSync(FN_DIR)) {
  console.error(`[prune-edgeone-function] 找不到函数包目录：${relative(ROOT, FN_DIR)}`);
  console.error('  请先运行：edgeone pages build --mode prod');
  process.exit(1);
}

const before = dirSize(FN_DIR);
console.log(`[prune-edgeone-function] 裁剪前：${mib(before)} MiB`);

/** 收集要删除的路径（相对函数包根）。 */
const doomed = [];

// 1) 顶层：白名单之外的全删；黑名单里的必删。
for (const entry of readdirSync(FN_DIR, { withFileTypes: true })) {
  const name = entry.name;
  if (KEEP_TOP_LEVEL.has(name)) continue;
  if (DROP_TOP_FILES.has(name) || entry.isDirectory() || entry.isFile()) {
    doomed.push(name);
  }
}

// 2) lib/：只保留 outputFileTracingIncludes 点名的文件。
const libDir = join(FN_DIR, 'lib');
if (existsSync(libDir)) {
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (!KEEP_LIB_FILES.has(rel)) {
        doomed.push(join('lib', rel));
      }
    }
  };
  walk(libDir, '');
}

// 3) sharp 的非 linux-x64 原生变体。
const pnpmDir = join(FN_DIR, 'node_modules', '.pnpm');
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const isSharpNative =
      entry.name.startsWith('@img+sharp-libvips-') || entry.name.startsWith('@img+sharp-');
    if (isSharpNative && !KEEP_SHARP_PNPM.has(entry.name)) {
      doomed.push(join('node_modules', '.pnpm', entry.name));
    }
  }
}

// 4) public/vendor/maic-importer：静态资源托管里已有一份，函数包里这份是重复。
const vendorDir = join(FN_DIR, 'public', 'vendor', 'maic-importer');
if (existsSync(vendorDir)) {
  doomed.push(join('public', 'vendor', 'maic-importer'));
}

// 去重后按体积从大到小统计。
const seen = new Set();
const targets = doomed.filter((p) => {
  if (seen.has(p)) return false;
  seen.add(p);
  return true;
});
targets.sort((a, b) => dirSize(join(FN_DIR, b)) - dirSize(join(FN_DIR, a)));

let freed = 0;
for (const target of targets) {
  const full = join(FN_DIR, target);
  const size = dirSize(full);
  freed += size;
  console.log(`  - ${target}  (${mib(size)} MiB)`);
}

console.log(
  `[prune-edgeone-function] 预计释放 ${mib(freed)} MiB，裁剪后约 ${mib(before - freed)} MiB（上限 128 MiB）`,
);
console.log('[prune-edgeone-function] 另将修正配置中的本机绝对路径，并补回图片加载器');

if (!APPLY) {
  console.log('[prune-edgeone-function] dry-run 结束（加 --yes 执行）');
  process.exit(0);
}

for (const target of targets) {
  const full = join(FN_DIR, target);
  // 用 fs.rm 递归删除（产物目录，可由重新构建完全再生）。
  const { rmSync } = await import('node:fs');
  rmSync(full, { recursive: true, force: true });
}

const after = dirSize(FN_DIR);
console.log(`[prune-edgeone-function] 裁剪完成：${mib(before)} MiB → ${mib(after)} MiB`);

/**
 * 运行时路径修复：把配置里内联的**本机绝对路径**换成函数包内的相对路径。
 *
 * opennext 在构建期把 Next 的运行配置序列化进 run-config.json /
 * server.js / .next/required-server-files.json，其中的 repoRoot、
 * outputFileTracingRoot、turbopack.root、images.loaderFile 全是**构建机上的
 * 绝对路径**（形如 /Users/<someone>/<repo>）。本地跑得通是因为那条路径真的
 * 存在；部署到平台后这些路径不存在，运行时一旦去解析就 502
 * （平台侧表现为 CLOUD_FUNCTION_INVOCATION_FAILED）。
 *
 * 函数包的根目录就是平台上的工作目录，所以把仓库根前缀整体换成 `.` 即可。
 */
const ABS_ROOT = ROOT;
const PATH_FIX_FILES = [
  'server.js',
  'run-config.json',
  join('.next', 'required-server-files.json'),
];
for (const file of PATH_FIX_FILES) {
  const full = join(FN_DIR, file);
  if (!existsSync(full)) continue;
  const before2 = readFileSync(full, 'utf8');
  const after2 = before2.split(ABS_ROOT).join('.');
  if (after2 !== before2) {
    writeFileSync(full, after2);
    console.log(`[prune-edgeone-function] 已修正绝对路径：${file}`);
  }
}

/**
 * 补回 opennext 注入、随后又在 restoreNextConfig 里删掉的图片加载器。
 * 它对应 EdgeOne 的 imageMogr2 图片处理参数（缩放 + 质量 + webp）。
 * 客户端 bundle 里已经内联了一份，运行时这份只是为了让
 * images.loaderFile 指向的相对路径能解析到实际文件。
 */ const loaderPath = join(FN_DIR, '.edgeone', 'image-loader.mjs');
if (!existsSync(loaderPath)) {
  writeFileSync(
    loaderPath,
    `'use client'

export default function edgeoneImageLoader({ src, width, quality }) {
  // SVG/GIF/ICO 不适合光栅优化，直接原样返回。
  var ext = src.split('?')[0].split('#')[0].split('.').pop();
  if (ext && ['svg', 'gif', 'ico'].indexOf(ext.toLowerCase()) !== -1) {
    return src;
  }

  var q = quality || 75;
  var params = [];
  if (width) params.push('thumbnail/' + width + 'x');
  params.push('quality/' + q);
  params.push('format/webp');

  var sep = src.indexOf('?') !== -1 ? '&' : '?';
  return src + sep + 'imageMogr2/' + params.join('/');
}
`,
    'utf-8',
  );
  console.log('[prune-edgeone-function] 已补回 .edgeone/image-loader.mjs');
}

/**
 * 运行时入口修复：让 Next 的 standalone 入口 server.js 在 **ESM 包**里也能跑。
 *
 * 函数包里同时存在两个入口：
 *   - index.mjs  —— opennext 的 ESM 入口（import bootstrap.js / handler.js）
 *   - server.js  —— Next `output: 'standalone'` 产出的 CommonJS 入口
 *
 * 而函数包的 package.json 带着 `"type": "module"`（opennext 写进去的，为了让
 * bootstrap.js / handler.js 按 ESM 解释）。于是 server.js 里的 `require` 在
 * ESM 作用域下会直接抛：
 *   ReferenceError: require is not defined in ES module scope
 * 平台若把 server.js 当作入口拉起，函数会在启动阶段就崩掉，
 * 表现为所有动态路由 502（CLOUD_FUNCTION_INVOCATION_FAILED）。
 *
 * 修法：给 server.js 加 createRequire 垫片，让它在 ESM 包里也能用 require。
 * 这对以 index.mjs 为入口的平台无副作用（server.js 根本不会被加载）。
 */ const serverEntry = join(FN_DIR, 'server.js');
if (existsSync(serverEntry)) {
  const original = readFileSync(serverEntry, 'utf8');
  if (!original.includes('createRequire')) {
    const patched = original.replace(
      "const path = require('path')",
      [
        "import { createRequire } from 'node:module';",
        '// 函数包是 ESM 包（package.json 里 type=module），但 Next standalone',
        '// 产出的 server.js 是 CommonJS。用 createRequire 垫片让它在 ESM 下也能 require。',
        'const require = createRequire(import.meta.url);',
        "const path = require('path')",
      ].join('\n'),
    );
    if (patched !== original) {
      writeFileSync(serverEntry, patched);
      console.log('[prune-edgeone-function] 已修正 server.js 的 ESM/CommonJS 入口兼容性');
    }
  }
}

/**
 * 声明云函数入口。
 *
 * opennext 只产出 `index.mjs`（ESM 入口），**不写 package.json 的 main**。
 * 平台拉起函数时按 package.json#main（或其默认入口约定）找入口，找不到就直接
 * 判定函数起不来——线上表现是：静态页 200（走平台的 filesystem handler），
 * 而所有动态路由 502 `CLOUD_FUNCTION_INVOCATION_FAILED`，日志里
 * 「运行时间 0ms / 运行内存 0.0000MB / 状态 失败」——函数压根没被启动。
 *
 * 这里做两件事，两个入口约定都覆盖到：
 *   1. package.json 写上 `"main": "index.mjs"`；
 *   2. 额外放一个 `index.js`，内容是转发到 index.mjs 的 ESM 转发文件，
 *      （包本身是 type:module，所以 .js 也按 ESM 解释）。
 *
 * 另外把 engines.node 绑到 edgeone.json 的 nodeVersion：平台按产物的
 * engines 判定运行时版本，仓库里的 ">=22.19.0" 在平台上没有对应运行时
 * （日志里显示的是 Nodejs20.19），函数会在启动前就被拒绝。
 */
const fnPkgPath = join(FN_DIR, 'package.json');
if (existsSync(fnPkgPath)) {
  const pkg = JSON.parse(readFileSync(fnPkgPath, 'utf8'));
  let changed = false;
  if (!pkg.main) {
    pkg.main = 'index.mjs';
    changed = true;
    console.log('[prune-edgeone-function] 已在函数包 package.json 声明 main=index.mjs');
  }
  // 运行时版本：平台给 Makers 云函数分配的运行时是 **Nodejs20.19**
  // （控制台「项目设置 → Node.js 版本」只作用于构建期；项目级 NodejsVersion
  // 与 edgeone.json 的 nodeVersion 都设成 24.5.0 了，构建日志也确实是
  // v24.5.0，但函数运行时仍显示 Nodejs20.19 —— 由平台固定，改不动）。
  //
  // 产物里如果写着 engines.node >= 22.19.0（上游 OpenMAIC 的要求），平台找不到
  // 满足该约束的运行时，就会在**拉起阶段**直接拒绝：线上表现为运行时间 0ms、
  // 运行内存 0.0000MB、状态失败，所有动态路由 502，而静态页（走平台的
  // filesystem handler，不经过函数）仍然 200。
  //
  // 所以这里只把**产物副本**的 engines 放宽到平台实际提供的运行时；
  // 仓库里的 package.json 仍保持上游要求的 ">=22.19.0"（构建期用的是 24.5.0）。
  const RUNTIME_ENGINE = '>=20.19.0';
  if (pkg.engines?.node !== RUNTIME_ENGINE) {
    pkg.engines = { ...pkg.engines, node: RUNTIME_ENGINE };
    changed = true;
    console.log(
      `[prune-edgeone-function] 已把函数包 engines.node 放宽到平台运行时（${RUNTIME_ENGINE}）`,
    );
  }
  if (changed) {
    writeFileSync(fnPkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}
const fnIndexJs = join(FN_DIR, 'index.js');
if (!existsSync(fnIndexJs) && existsSync(join(FN_DIR, 'index.mjs'))) {
  writeFileSync(
    fnIndexJs,
    [
      '// EdgeOne Pages 云函数入口：转发到 opennext 的 ESM 入口。',
      '// 平台可能按 package.json#main 或默认的 index.js 找入口，两个都给上。',
      "import './index.mjs';",
      '',
    ].join('\n'),
    'utf-8',
  );
  console.log('[prune-edgeone-function] 已补出 index.js 入口转发文件');
}
