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
import { builtinModules, createRequire, Module } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { collectNeededPackages, repairIncompletePackages } from './edgeone-deps-lib.mjs';
import { outsideRepoTemp } from './edgeone-temp.mjs';

const ROOT = process.cwd();
const FN_DIR = join(ROOT, '.edgeone', 'cloud-functions', 'ssr-node');
const APPLY = process.argv.includes('--yes');

/**
 * 工作区包在运行期真正需要的文件：package.json + dist + 许可/说明。
 * 源码（src）、测试、配置在函数包里用不到，却有十几 MiB。
 */
const RUNTIME_FILES = new Set(['package.json', 'LICENSE', 'README.md', 'README-zh.md']);

/** 函数包里必须保留的顶层条目（其余整个删掉）。 */
const KEEP_TOP_LEVEL = new Set([
  // 运行时代码与依赖
  '.next',
  'node_modules',
  'deps', // 依赖目录改名后的落点（平台会剥离 node_modules，详见 renameDependenciesToDeps）
  'packages', // workspace 包的软链目标：node_modules/@openmaic/* -> ../../packages/...
  'skills', // agent runtime 在运行时读 skills/**
  // 注意：'public' **不在**保留清单里。
  // 它的全部内容（avatars / brand / logos / vendor/…）已经由平台托管在
  // `.edgeone/assets/` 下（见构建日志的 Collecting/Uploading static files），
  // 静态请求走平台的 filesystem handler，不经过云函数；
  // 函数包里再放一份纯属重复，白占几 MiB。
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

/** 扁平布局（node-linker=hoisted）下要保留的 @img 包名。 */
const KEEP_SHARP_HTML = new Set(['sharp-linux-x64', 'sharp-libvips-linux-x64']);

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
  'next.config.ts',
  'SECURITY.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'README.md',
  'README-zh.md',
]);

/**
 * 递归统计目录体积（字节）。
 *
 * 目录里的**符号链接**指向的目标不计入：它们在函数包内是「指针」，
 * 真实字节落在被指向的位置，单独计一次即可，避免重复计数。
 * 传入的若是**文件**则直接返回其大小（早期版本对文件调用 readdir 会抛异常，
 * 被 catch 吞掉后返回 0，导致「预计释放体积」算不准）。
 */
function dirSize(dir) {
  let total = 0;
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
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
      if (entry.isSymbolicLink()) continue;
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
//    两种布局都要覆盖：
//      - pnpm 软链布局：node_modules/.pnpm/@img+sharp-<平台>@<版本>/
//      - 扁平布局（node-linker=hoisted）：node_modules/@img/sharp-<平台>/
//    扁平布局下 libvips 的 5 个平台变体各约 18 MiB，不裁就是 90 MiB 纯浪费。
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
const imgDir = join(FN_DIR, 'node_modules', '@img');
if (existsSync(imgDir)) {
  for (const entry of readdirSync(imgDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('sharp-')) continue;
    // 只保留 linux-x64 的 sharp 与 libvips（EdgeOne 函数运行时固定 linux-x64）。
    if (!KEEP_SHARP_HTML.has(entry.name)) {
      doomed.push(join('node_modules', '@img', entry.name));
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

// 4.5) node_modules 拍平：把 pnpm 的符号链接布局改成平台能识别的真实目录布局。
//      必须在裁剪删除**之后**做：否则会被裁掉的 darwin 原生变体又被实体化回来。
flattenNodeModules(FN_DIR);

// 4.6) 依赖目录改名成 deps（平台上传时会剥离任何名为 node_modules 的目录）。
renameDependenciesToDeps(FN_DIR);

// 4.7) 实体化 Turbopack 的外部模块别名（源取工作区，落到 deps/<别名>）。
materializeExternalAliases(FN_DIR, ROOT);

// 4.75) 补齐产物用到、但函数包顶层没有的传递依赖（源取工作区）。
ensureRuntimePackages(FN_DIR, ROOT);

// 4.8) 写入 ESM 解析钩子：裸标识符 → deps/。
//      必须排在「修复残缺包」之前：修复要靠钩子做 ESM 侧的解析判定。
writeEsmResolveHooks(FN_DIR);

// 4.87) 丢弃 source map（*.map）：**运行期一律不用**，纯粹是调试辅助。
//       实测 496 个文件共 7.2 MiB——函数包有 128 MiB 硬上限，这块是白扔的体积。
//       删掉不影响任何 require/import：Node 找不到 map 时只是不提供源码映射。
//       必须排在**所有拷贝步骤之后**——别名实体化与依赖修复都会把 .map 拷回来。
let droppedMaps = 0;
let droppedMapBytes = 0;
for (const root of [join(FN_DIR, '.next'), join(FN_DIR, 'deps')]) {
  if (!existsSync(root)) continue;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.map')) continue;
      try {
        droppedMapBytes += statSync(full).size;
        rmSync(full, { force: true });
        droppedMaps += 1;
      } catch {
        /* 删不掉就算了，不影响运行 */
      }
    }
  }
}
if (droppedMaps > 0) {
  console.log(
    `[prune-edgeone-function] 已丢弃 source map ${droppedMaps} 个（${mib(droppedMapBytes)} MiB，运行期不用）`,
  );
}

// 4.9) 拍平后的强制校验（任何不满足都中止部署）。
//      **必须 await**：这个函数是异步的，不 await 的话它的失败会变成
//      unhandled rejection（退出码非零但输出看不懂），而且校验会在
//      「裁剪完成」之后才跑——门禁与产物状态对不上号。
await verifyFlattenedPackage(FN_DIR);

const after = dirSize(FN_DIR);
console.log(`[prune-edgeone-function] 裁剪完成：${mib(before)} MiB → ${mib(after)} MiB`);

/**

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
 * 运行时监听加固：让函数进程**双栈监听**，消除「平台连不上函数」这一整类故障。
 *
 * opennext 生成的 bootstrap.js 里写死了：
 *   const SERVER_HOST = 'localhost';
 *   const SERVER_PORT = 9000;
 *   server.listen(SERVER_PORT, SERVER_HOST, ...)
 *
 * `server.listen(port, 'localhost')` 的绑定地址取决于**运行机器上 localhost 的解析顺序**：
 * Node ≥17 默认 verbatim 解析，macOS/Linux 上 `localhost` 常常先解析出 `::1`，
 * 于是函数只监听 IPv6 的 `[::1]:9000`，**IPv4 的 `127.0.0.1:9000` 完全不通**。
 * 本机实测正是如此：进程占住的是 `TCP [::1]:9000 (LISTEN)`，curl 127.0.0.1 直接连接失败。
 *
 * 平台侧若按 IPv4 回连 127.0.0.1:9000，就会连不上，表现为函数「运行时间 0ms /
 * 运行内存 0.0000MB / 状态失败」，所有走云函数的路由 502
 * （CLOUD_FUNCTION_INVOCATION_FAILED）——因为函数进程压根没接到任何请求。
 *
 * 修法：去掉 host 参数，`server.listen(SERVER_PORT)` 会监听 `::`（双栈，IPv4 映射地址
 * 同样可达），**只放宽、不收紧**：IPv4 与 IPv6 两条路都能连上。
 */
const bootstrapEntry = join(FN_DIR, 'bootstrap.js');
if (existsSync(bootstrapEntry)) {
  const original = readFileSync(bootstrapEntry, 'utf8');
  const patched = original.replace(
    'server.listen(SERVER_PORT, SERVER_HOST, () => {',
    [
      '// [patched] 去掉 host 参数，改为双栈监听（`::`），',
      '// 保证平台无论用 127.0.0.1 还是 [::1] 回连都能命中。',
      'server.listen(SERVER_PORT, () => {',
    ].join('\n'),
  );
  if (patched !== original) {
    writeFileSync(bootstrapEntry, patched);
    console.log('[prune-edgeone-function] 已把函数监听改为双栈（不再绑定单个 localhost 解析结果）');
  }
}

/**
 * 入口可观测性：给 index.mjs 加启动日志、失败原因捕获与**兜底诊断服务器**。
 *
 * 原版 index.mjs 是三行静态 import + 调用，**任何 import 期异常都在日志落地前抛出**，
 * 平台侧只能看到「函数起不来」或一个通用错误页，看不到原因。
 *
 * 改写后：
 *   1. 启动即打印 Node 版本/平台/架构；
 *   2. 动态 import + try/catch，失败时把**完整报错与环境探针**打到 stderr；
 *   3. 更关键：失败时**自己起一个最小 HTTP 服务器**（占用平台预期的 9000 端口），
 *      把诊断文本原样写进 HTTP 响应体。这样平台返回的就是我们的正文而不是通用错误页，
 *      线上排查可以直接读出真实原因——EdgeOne Pages 控制台不暴露 SSR 函数的 stdout。
 *
 * 语义与原版一致（同样的模块、同样的调用顺序），只多了日志、错误兜底与诊断。
 */
const indexEntry = join(FN_DIR, 'index.mjs');
if (existsSync(indexEntry)) {
  const original = readFileSync(indexEntry, 'utf8');
  // 幂等标记必须用**本版独有**的字符串：早期版本只打印启动日志、
  // 失败即 process.exit(1)，若沿用那个标记做守卫，新版就永远不会被写入。
  // （每次给入口加可观测能力时，同步换掉这里的标记。）
  //
  // v9：会话门禁同时认 Cookie 与 x-physics-session；修掉正则被字符串转义
  //     吃成 `.d{10,16}` 的致命错误（合法令牌永远匹配不上 → 线上恒 401）。
  //     守卫和写出的标记必须是**同一个值**，否则老产物永远不会被新版覆盖。
  const ENTRY_DIAG_VERSION = 9;
  if (!original.includes(`entry-diag-version: ${ENTRY_DIAG_VERSION}`)) {
    writeFileSync(
      indexEntry,
      [
        '// EdgeOne Pages 云函数入口（opennext 生成，本文件为可观测性改写版）。',
        '// entry-diag-version: 9',
        '// 与原版语义一致：加载 bootstrap/handler → 启动框架服务器；',
        '// 额外把启动阶段信息、失败原因与诊断文本暴露出来，便于线上排障。',
        "console.log('[ssr-node] entry start', process.version, process.platform, process.arch);",
        '',
        '/**',
        ' * 依赖解析接线。',
        ' *',
        ' * 平台在**上传/解包**时会剥离任何名为 `node_modules` 的目录，',
        ' * 所以依赖在产物里被改名为 `deps`。运行时把两条解析路径都接上：',
        " *   - CJS：`require('next/…')` 走 NODE_PATH → deps；",
        " *   - ESM：`await import('pg-<hash>')`（Turbopack 的 externalImport）",
        ' *     由 esm-hooks.mjs 的 resolve 钩子映射到 deps。',
        ' *',
        ' * 注意：运行时文件系统**只读**，建不了 node_modules 软链，',
        ' * 所以不能用「建软链」的办法兜底，只能用 NODE_PATH + 解析钩子。',
        ' */',
        'async function registerEsmHooks() {',
        "  const { register } = await import('node:module');",
        "  register('./esm-hooks.mjs', import.meta.url);",
        "  console.log('[ssr-node] ESM 解析钩子已注册（deps/ 作为裸标识符解析目标）');",
        '}',
        '',
        'await registerEsmHooks();',
        '',
        '/**',
        ' * 平台把依赖放在 deps/（node_modules 会被剥离，且运行时只读、建不了软链）。',
        ' * CJS 的裸标识符解析只认 node_modules 目录，但 NODE_PATH 以兜住它：',
        " * 把 deps 加进 NODE_PATH 后，require('next/…') 就能解析到 deps/next。",
        ' */',
        'async function extendNodePath() {',
        "  const path = await import('node:path');",
        "  const { Module } = await import('node:module');",
        "  const deps = path.join(process.cwd(), 'deps');",
        '  const current = process.env.NODE_PATH;',
        '  process.env.NODE_PATH = current ? deps + path.delimiter + current : deps;',
        '  Module._initPaths();',
        "  console.log('[ssr-node] NODE_PATH = ' + process.env.NODE_PATH);",
        '}',
        '',
        'await extendNodePath();',
        '',
        '/** 把**平台上真实的文件系统状态**打出来：目录里到底有什么。 */',
        'async function reportRuntimeEnvironment() {',
        "  const fs = await import('node:fs');",
        "  const path = await import('node:path');",
        '  const lines = [];',
        "  lines.push('cwd: ' + process.cwd());",
        '  const list = (dir) => {',
        '    try {',
        "      return fs.readdirSync(dir).slice(0, 120).join(',');",
        '    } catch (error) {',
        "      return 'ERR ' + error.code;",
        '    }',
        '  };',
        "  lines.push('cwd entries: ' + list(process.cwd()));",
        "  lines.push('deps entries: ' + list(path.join(process.cwd(), 'deps')));",
        "  lines.push('deps/next exists: ' + fs.existsSync(path.join(process.cwd(), 'deps', 'next')));",
        "  lines.push('deps/next/dist exists: ' + fs.existsSync(path.join(process.cwd(), 'deps', 'next', 'dist')));",
        "  lines.push('deps/next/start-server.js exists: ' + fs.existsSync(path.join(process.cwd(), 'deps', 'next', 'dist', 'server', 'lib', 'start-server.js')));",
        "  lines.push('/var/user entries: ' + list('/var/user'));",
        "  lines.push('.next entries: ' + list(path.join(process.cwd(), '.next')));",
        "  lines.push('.edgeone entries: ' + list(path.join(process.cwd(), '.edgeone')));",
        "  lines.push('/var/user/node_modules entries: ' + list('/var/user/node_modules'));",
        "  return lines.join('\\n');",
        '}',
        '',
        "console.log('[ssr-node] runtime env:\\n' + (await reportRuntimeEnvironment()));",
        '',
        '/** 收集环境探针：出错时把关键事实一起回传。 */',
        'async function collectDiagnostics(error) {',
        '  const lines = [];',
        '  const push = (key, value) => lines.push(`${key}: ${value}`);',
        '  const detail = error && (error.stack || error.message) ? error.stack || error.message : String(error);',
        "  push('error', detail);",
        "  push('node', `${process.version} ${process.platform} ${process.arch}`);",
        "  push('cwd', process.cwd());",
        '  try {',
        "    const fs = await import('node:fs');",
        "    push('cwd entries', fs.readdirSync(process.cwd()).slice(0, 80).join(','));",
        '    for (const file of [',
        "      'package.json',",
        "      '.next/required-server-files.json',",
        "      '.next/routes-manifest.json',",
        "      '.next/server/app-paths-manifest.json',",
        "      'deps/next/package.json',",
        "      'run-config.json',",
        "      'config.json',",
        "      'handler.js',",
        "      'bootstrap.js',",
        '    ]) {',
        "      let size = 'MISSING';",
        '      try {',
        '        size = `${fs.statSync(file).size} bytes`;',
        '      } catch {',
        '        /* 保持 MISSING */',
        '      }',
        '      push(`file ${file}`, size);',
        '    }',
        "    push('next version', JSON.parse(fs.readFileSync('deps/next/package.json', 'utf8')).version);",
        '  } catch (probeError) {',
        "    push('fs probe failed', probeError && probeError.message);",
        '  }',
        "  push('env keys', Object.keys(process.env).sort().join(','));",
        "  return lines.join('\\n');",
        '}',
        '',
        '/**',
        ' * 会话门禁：只有**高耗能接口**要求已登录。',
        ' *',
        ' * 为什么必须在函数里做：EdgeOne Pages **不部署 Next 中间件**——',
        ' * 实测产物的 .next/server/middleware-manifest.json 里 middleware 为空，',
        ' * 平台的 edge function 里也没有这段逻辑。所以 middleware.ts 里那道门',
        ' * 在平台上等于不存在，必须在这里补回来。',
        ' *',
        ' * 为什么不再守全部 /api/*：原先是一道**访问码**门禁（全员共用一个口令），',
        ' * 它不是账号系统——没有注册、没有「谁提交的」。现在换成真正的账号系统',
        ' * （注册 + 登录），站点对所有访问者开放，门禁只守在**会消耗模型额度',
        ' * 或上游资源**的接口前面；其余接口（本地解析、材料上传、静态查询）',
        ' * 不消耗外部资源，拦了只会让「断网也能演示」这类承诺失效。',
        ' *',
        ' * ## 为什么同时认 Cookie 与请求头',
        ' *',
        ' * 线上曾出现「带合法 Cookie 仍然 401」。真因就在**上面那一行正则**：',
        ' * 它写在字符串字面量里，`\\.` / `\\d` 少一层反斜杠就会被字符串求值吃成',
        ' * `.` / `d`，生成出来的正则变成「任意字符 + 10~16 个 d」，',
        ' * 合法令牌永远匹配不上。而本地跑的是 Next 中间件（middleware.ts），',
        ' * **根本不会执行这段生成代码**，所以本地全绿、线上恒 401。',
        ' * 该转义已修正，并由 `tests/deploy/session-gate-contract.test.ts`',
        ' * 求值生成后的正则来守住（只匹配源文件子串的断言会放过这个错误）。',
        ' *',
        ' * 请求头这条通道是**冗余保险**：万一平台转发层将来吞掉 Cookie，',
        ' * 客户端发的 x-physics-session 仍能放行。两条通道强度相同',
        ' * （令牌无签名，只验形状，挡的是随手匿名调用）。',
        ' *',
        ' * 令牌形态：<账号 id>.<登录时间戳>。',
        ' * **诚实说明**：这个令牌由客户端自己写入，服务器只能验证形状，',
        ' * 验证不了「是不是本人」——账号校验在本地进行（不接数据库）。',
        ' * 它挡得住随手匿名调用，挡不住刻意伪造。',
        ' */',
        "const SESSION_COOKIE_NAME = 'physics_session';",
        "const SESSION_HEADER_NAME = 'x-physics-session';",
        "const SESSION_REQUIRED_PREFIXES = ['/api/generate/', '/api/chat', '/api/agent/', '/api/pbl/v2/evaluate', '/api/transcription', '/api/web-search'];",
        'const SESSION_COOKIE_PATTERN = /^[A-Za-z0-9._-]{1,128}\\.\\d{10,16}$/;',
        '',
        'function parseCookieHeader(header) {',
        '  const out = {};',
        '  if (!header) return out;',
        "  for (const part of header.split(';')) {",
        "    const index = part.indexOf('=');",
        '    if (index === -1) continue;',
        '    const name = part.slice(0, index).trim();',
        '    if (!name || name in out) continue;',
        '    const raw = part.slice(index + 1).trim();',
        '    // 畸形百分号转义（%zz / %）会让 decodeURIComponent 抛 URIError，',
        '    // 异常一路冒到框架层就变成 502 —— 未授权客户端能用一个坏 Cookie',
        '    // 把任意 /api/* 打成 502。Next 自己的 cookie 解析是 try/catch 吞掉的，',
        '    // 这里保持一致：解析失败就当这个 Cookie 没有值。',
        '    try {',
        '      out[name] = decodeURIComponent(raw);',
        '    } catch {',
        '      out[name] = raw;',
        '    }',
        '  }',
        '  return out;',
        '}',
        '',
        'function isValidSessionCookie(value) {',
        '  if (!value) return false;',
        '  return SESSION_COOKIE_PATTERN.test(String(value));',
        '}',
        '',
        '/**',
        ' * 取请求路径：',
        ' * opennext 的 bootstrap 把 **Node 的 IncomingMessage** 传给 handler',
        ' *（request.url 是相对路径，Cookie 在 request.headers.cookie），',
        ' * 但同一份入口也可能收到 WHATWG Request（request.url 绝对、headers.get）。',
        ' * 两种形态都要支持，否则门禁会静默失效。',
        ' */',
        'function readRequestPathname(request) {',
        '  try {',
        "    return new URL(request.url || '/', 'http://localhost').pathname;",
        '  } catch {',
        "    return '/';",
        '  }',
        '}',
        '',
        '/**',
        ' * 大小写无关地取一个请求头的值。',
        ' *',
        ' * 平台转发层给的 headers 形态不止一种，这里全部要认：',
        ' *   - WHATWG Headers（.get 大小写无关）；',
        ' *   - Node IncomingMessage.headers（普通对象，键全小写）；',
        ' *   - 平台自建的普通对象（**保留原始大小写**，可能是 Cookie / Cookie: 数组）；',
        ' *   - rawHeaders 平铺数组 [名称, 值, 名称, 值, …]。',
        ' *',
        ' * 只认 headers.cookie 会在第三种形态上**静默失效**：',
        ' * 表现就是「带 Cookie 仍然 401」，而本地（走 Next 中间件）完全正常。',
        ' */',
        'function readHeaderValue(request, name) {',
        '  const lower = String(name).toLowerCase();',
        '  const headers = request && request.headers;',
        '  if (headers) {',
        "    if (typeof headers.get === 'function') {",
        '      try {',
        '        const value = headers.get(lower);',
        "        if (typeof value === 'string' && value !== '') return value;",
        '      } catch {',
        '        /* 形态不认就继续往下试 */',
        '      }',
        '    }',
        '    if (Array.isArray(headers)) {',
        '      for (const pair of headers) {',
        '        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === lower) {',
        '          return String(pair[1]);',
        '        }',
        '      }',
        "    } else if (typeof headers === 'object') {",
        '      for (const key of Object.keys(headers)) {',
        '        if (String(key).toLowerCase() !== lower) continue;',
        '        const value = headers[key];',
        "        if (typeof value === 'string' && value !== '') return value;",
        "        if (Array.isArray(value) && value.length) return value.join('; ');",
        '      }',
        '    }',
        '  }',
        '  const raw = request && (request.rawHeaders || (request.raw && request.raw.rawHeaders));',
        '  if (Array.isArray(raw)) {',
        '    for (let index = 0; index + 1 < raw.length; index += 2) {',
        '      if (String(raw[index]).toLowerCase() === lower) return String(raw[index + 1]);',
        '    }',
        '  }',
        "  return '';",
        '}',
        '',
        '/**',
        ' * 这次请求**实际到达**了哪些请求头——只列名字，不含任何值。',
        ' *',
        ' * 401 响应会把它带回去（x-session-gate-headers）。没有它的话，',
        ' * 「平台上 Cookie 到没到」只能靠猜——本项目已经在这上面误判过一次。',
        ' */',
        'function describeHeaderNames(request) {',
        '  const names = new Set();',
        '  const headers = request && request.headers;',
        '  if (headers) {',
        "    if (typeof headers.forEach === 'function') {",
        '      try {',
        '        headers.forEach((_value, key) => names.add(String(key).toLowerCase()));',
        '      } catch {',
        '        /* 非 Headers 的 forEach 会抛，忽略 */',
        '      }',
        '    }',
        "    if (names.size === 0 && typeof headers === 'object') {",
        '      for (const key of Object.keys(headers)) names.add(String(key).toLowerCase());',
        '    }',
        '  }',
        '  const raw = request && (request.rawHeaders || (request.raw && request.raw.rawHeaders));',
        '  if (Array.isArray(raw)) {',
        '    for (let index = 0; index < raw.length; index += 2) {',
        '      names.add(String(raw[index]).toLowerCase());',
        '    }',
        '  }',
        "  return [...names].sort().slice(0, 40).join(',');",
        '}',
        '',
        '/**',
        ' * 取这次请求携带的会话令牌：Cookie 优先，其次请求头。',
        ' * 两条通道强度相同——令牌无签名，验的是形状，挡的是随手匿名调用。',
        ' */',
        'function readSessionToken(request) {',
        "  const cookies = parseCookieHeader(readHeaderValue(request, 'cookie'));",
        '  const fromCookie = cookies[SESSION_COOKIE_NAME];',
        "  if (isValidSessionCookie(fromCookie)) return { token: fromCookie, source: 'cookie' };",
        "  const fromHeader = readHeaderValue(request, SESSION_HEADER_NAME);",
        "  if (isValidSessionCookie(fromHeader)) return { token: fromHeader, source: 'header' };",
        "  return { token: '', source: 'none' };",
        '}',
        '',
        'function createSessionGate(handler) {',
        '  return async (request, context) => {',
        '    const pathname = readRequestPathname(request);',
        '    const required = SESSION_REQUIRED_PREFIXES.some((prefix) => pathname.startsWith(prefix));',
        '    if (!required) return handler(request, context);',
        '    const session = readSessionToken(request);',
        '    if (session.token) {',
        '      return handler(request, context);',
        '    }',
        "    const arrived = describeHeaderNames(request) || 'none';",
        "    console.warn('[ssr-node] 未登录访问被拦截：' + pathname + '（到达的请求头：' + arrived + '）');",
        '    return new Response(',
        "      JSON.stringify({ success: false, errorCode: 'INVALID_REQUEST', error: 'Login required' }),",
        '      {',
        '        status: 401,',
        '        headers: {',
        "          'content-type': 'application/json',",
        "          'x-session-gate': 'blocked',",
        "          'x-session-gate-headers': arrived,",
        '        },',
        '      },',
        '    );',
        '  };',
        '}',
        '',
        'try {',
        "  const { createFrameworkServer, importShim } = await import('./bootstrap.js');",
        "  const { default: handler } = await import('./handler.js');",
        '  importShim();',
        '  createFrameworkServer(createSessionGate(handler));',
        "  console.log('[ssr-node] framework server listening（会话门禁已启用）');",
        '} catch (error) {',
        '  const diagnostics = await collectDiagnostics(error);',
        "  console.error('[ssr-node] bootstrap failed:\\n' + diagnostics);",
        '  // 兜底：自己监听平台预期的 9000 端口，把诊断文本回给调用方。',
        "  const { createServer } = await import('node:http');",
        '  const fallback = createServer((req, res) => {',
        "    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });",
        "    res.end('[ssr-node] bootstrap failed\\n' + diagnostics);",
        '  });',
        "  fallback.on('error', (err) => console.error('[ssr-node] fallback server error:', err));",
        "  fallback.listen(9000, () => console.log('[ssr-node] fallback diagnostics server listening'));",
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    console.log(
      '[prune-edgeone-function] 已改写 index.mjs（启动日志 + 失败诊断 + 兜底诊断服务器）',
    );
  }
}

/**
 * 判断一个软链是不是**工作区包**（指向 ../../packages/...）。
 *
 * 用 readlink 的**原始目标字符串**判断，而不是 realpath：
 * 软链一旦断链（函数包里的 packages/ 被删掉），realpath 直接抛错，
 * 于是这个包会被「静默跳过」——最后留在产物里的是一条断链软链，
 * 平台不物化它，运行时必然 MODULE_NOT_FOUND。
 */
function isWorkspaceLink(linkPath) {
  try {
    const raw = readlinkSync(linkPath).split('\\').join('/');
    return raw.includes('packages/');
  } catch {
    return false;
  }
}

/**
 * 列出 node_modules 下的包条目（处理 @scope 两级结构）。
 * 返回 [{ name, full }]，name 是包名（scoped 包形如 `@scope/pkg`）。
 */
function listPackageEntries(dir) {
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
    if (name.startsWith('@')) {
      let scoped = [];
      try {
        scoped = readdirSync(full);
      } catch {
        continue;
      }
      for (const sub of scoped) out.push({ name: `${name}/${sub}`, full: join(full, sub) });
    } else {
      out.push({ name, full });
    }
  }
  return out;
}

/**
 * node_modules **拍平**：把 pnpm 的「符号链接布局」改成 npm 式的「真实目录布局」。
 *
 * ## 为什么必须拍平（这是线上 502 的真正根因）
 *
 * opennext 打包时会把仓库的 node_modules 原样拷进函数包，而仓库用 pnpm，
 * 于是 `node_modules/next` 之类的条目是**符号链接**：
 *
 *   node_modules/next -> .pnpm/next@16.3.3_.../node_modules/next
 *
 * **EdgeOne Pages 的上传/解包不会物化符号链接**：符号链接条目被跳过，
 * 真实字节虽然以 `.pnpm/...` 的形式上传了，但顶层没有 `node_modules/next` 这个入口。
 * 运行时 `require('next/dist/server/lib/start-server.js')` 于是直接失败：
 *
 *   Error: Cannot find module 'next/dist/server/lib/start-server.js'
 *     at Object.<anonymous> (/var/user/.edgeone/dist/run/next.cjs:41:30)
 *
 * 表现就是：静态页（走平台 filesystem handler）200，
 * 所有走云函数的路由 500 INTERNAL_CLOUD_FUNCTION_ERROR / 502 CLOUD_FUNCTION_INVOCATION_FAILED。
 *
 * 本机跑得通是因为本机文件系统认得符号链接——**这正是本地无法复现线上故障的原因**。
 *
 * ## 拍平做了什么
 *
 *   1. 以 `.pnpm/node_modules/<name>` 的指向为「标准实例」，把每个包的**真实文件**
 *      复制到顶层 `node_modules/<name>`（顶层原来是符号链接，先删再复制）；
 *   2. 个别包要求非标准版本的依赖（实测 2 处：fetch-blob→web-streams-polyfill、
 *      gaxios→node-fetch），把那个版本**嵌套**到使用方自己的 node_modules 下，
 *      保持 Node 的解析语义；
 *   3. 工作区包（`@openmaic/*`、`mathml2omml`、`pptxgenjs`，指向 `packages/`）
 *      同样实体化；
 *   4. 删掉 `node_modules/.pnpm` 与顶层的 `packages/`（内容已进 node_modules）。
 *
 * 拍平后包体反而更小：.pnpm 的重复实例与 packages/ 的源码都不再需要。
 */
function flattenNodeModules(fnDir) {
  const nmDir = join(fnDir, 'node_modules');
  const pnpmDir = join(nmDir, '.pnpm');
  if (!existsSync(pnpmDir)) return { skipped: 'node_modules/.pnpm 不存在，无需拍平' };

  /** 列出 node_modules 下的包条目（处理 @scope 两级结构）。 */
  const listEntries = (dir) => {
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
      if (name.startsWith('@')) {
        let scoped = [];
        try {
          scoped = readdirSync(full);
        } catch {
          continue;
        }
        for (const sub of scoped) out.push({ name: `${name}/${sub}`, full: join(full, sub) });
      } else {
        out.push({ name, full });
      }
    }
    return out;
  };

  /** 读一个包目录的 package.json（读不到就当作没有依赖信息）。 */
  const readManifest = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      return null;
    }
  };

  /** 递归复制目录内容，跳过 node_modules，并把符号链接解引用成真实文件。 */
  const copyTree = (src, dest) => {
    const srcStat = lstatSync(src);
    if (srcStat.isSymbolicLink()) {
      const real = realpathSync(src);
      if (lstatSync(real).isDirectory()) {
        copyTree(real, dest);
      } else {
        cpSync(real, dest, { dereference: true });
      }
      return;
    }
    if (srcStat.isDirectory()) {
      mkdirSafe(dest);
      for (const entry of readdirSync(src)) {
        if (entry === 'node_modules') continue;
        copyTree(join(src, entry), join(dest, entry));
      }
      return;
    }
    cpSync(src, dest, { dereference: true });
  };

  const mkdirSafe = (dir) => {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* 目录已存在或不可创建，后续写入会暴露问题 */
    }
  };

  // ---- 1) 标准实例：.pnpm/node_modules/<name> 的指向 ----
  const canonical = new Map();
  for (const entry of listEntries(join(pnpmDir, 'node_modules'))) {
    try {
      if (!lstatSync(entry.full).isSymbolicLink()) continue;
      canonical.set(entry.name, realpathSync(entry.full));
    } catch {
      /* 断链的符号链接（被裁剪掉的平台原生变体）跳过 */
    }
  }

  // ---- 2) 顶层实体化 ----
  // 需要实体化的有两类：
  //   a) `.pnpm/node_modules/<name>` 的标准实例（pnpm 的去重入口）；
  //   b) **顶层自己就是符号链接**的条目——其中包含 Turbopack 为外部包生成的
  //      **哈希别名**（形如 `pg-4c0d8067d674414d`，运行时用
  //      `await import('pg-4c0d8067d674414d')` 加载 `serverExternalPackages` 里的包）。
  //      这些别名**必须保留**，否则运行时会报
  //      `Cannot find package 'pg-<hash>'`，函数直接起不来。
  //      所以这里一律「实体化」而不是「删掉」。
  const materializeTargets = new Map(canonical);
  for (const entry of listEntries(nmDir)) {
    try {
      if (!lstatSync(entry.full).isSymbolicLink()) continue;
      // **工作区包**（软链指向 ../../packages/...）不在这里实体化：
      // 它们由下面的「第 4 步」单独处理——源取**工作区**的 packages/，
      // 并且只拷运行期需要的部分（package.json + dist + 许可）。
      // 放在函数包内部解析会踩两个坑：
      //   1) 函数包里的 packages/ 副本与 node_modules 里的软链目标可能是同一份
      //      inode，Node 的 cpSync 会直接报 "src and dest cannot be the same"；
      //   2) 第 5 步会删掉函数包里的 packages/，届时软链全部断链。
      if (isWorkspaceLink(entry.full)) continue;
      materializeTargets.set(entry.name, realpathSync(entry.full));
    } catch {
      /* 断链的符号链接（被裁掉的平台原生变体）后面统一清理 */
    }
  }

  let materialized = 0;
  for (const [name, realDir] of materializeTargets) {
    const dest = join(nmDir, name);
    // 目标已经是**实体目录**（上一轮已实体化）→ 跳过，避免 src===dest。
    // 注意：这里不能用 realpath 比较——realpath 会**跟随软链**，软链指向的真实目录
    // 恰好就是 realDir，比出来永远「相等」，会把所有待实体化的软链全部跳过。
    if (existsSync(dest) && !lstatSync(dest).isSymbolicLink()) continue;
    // 顶层多数包**原本并不存在**（pnpm 只在顶层放直接依赖），
    // 所以这里必须先判断存在性再操作，不能让 lstatSync 的异常把整包跳过。
    try {
      if (existsSync(dest)) {
        // 软链必须用 unlink 删除：fs.rmSync 对「指向目录的软链」不加 recursive
        // 会抛 ERR_FS_EISDIR，异常一旦被吞掉，这个包就会被整包跳过（next/react… 全丢）；
        // 而加 recursive 又会**跟随软链删掉目标目录的内容**（实测把 deps/ 掏空）。
        removePath(dest);
      }
    } catch {
      /* 删不掉就跳过这一项 */
      continue;
    }
    try {
      copyTree(realDir, dest);
      materialized += 1;
    } catch (error) {
      console.warn(`[prune-edgeone-function] 拍平失败：${name} — ${error.message}`);
    }
  }
  // ---- 3) 版本冲突的嵌套处理 ----
  let nested = 0;
  for (const [name, realDir] of canonical) {
    const manifest = readManifest(realDir);
    if (!manifest) continue;
    const deps = { ...(manifest.dependencies || {}), ...(manifest.optionalDependencies || {}) };
    // pnpm 里这个包的依赖实例放在同一个 instance 目录的 node_modules 下
    const instanceDir = join(pnpmDir, relative(join(pnpmDir, 'node_modules'), realDir));
    const instanceParent = realDir.slice(0, realDir.length - `/${name}`.length);
    for (const dep of Object.keys(deps)) {
      const link = join(instanceParent, dep);
      let depReal;
      try {
        if (!lstatSync(link).isSymbolicLink()) continue;
        depReal = realpathSync(link);
      } catch {
        continue;
      }
      const canonDep = canonical.get(dep);
      if (!canonDep || canonDep === depReal) continue;
      // 该包需要的是非标准版本 → 嵌套一份到它自己的 node_modules 下
      const nestedDest = join(nmDir, name, 'node_modules', dep);
      try {
        rmSync(nestedDest, { recursive: true, force: true });
        copyTree(depReal, nestedDest);
        nested += 1;
      } catch (error) {
        console.warn(`[prune-edgeone-function] 嵌套版本失败：${name} → ${dep} — ${error.message}`);
      }
      void instanceDir;
    }
  }

  // ---- 4) 工作区包实体化（指向 packages/ 的符号链接）----
  //
  // 源取**工作区**的 packages/<name>，而不是函数包里的副本：
  //   - 函数包里的副本会被第 5 步删掉，源没了就无从拷贝；
  //   - 函数包里的副本与 node_modules 软链目标可能指向同一份 inode，
  //     Node 的 cpSync 会判定 "src and dest cannot be the same" 直接失败。
  // 工作区是唯一权威来源（packages/*/dist 由 postinstall 构建，不在版本控制里）。
  let workspaces = 0;
  for (const entry of listEntries(nmDir)) {
    let target = null;
    let raw = null;
    try {
      if (!lstatSync(entry.full).isSymbolicLink()) continue;
      if (!isWorkspaceLink(entry.full)) continue;
      // 软链形如 ../../packages/@openmaic/dsl → 取出 packages/ 之后的相对名
      raw = readlinkSync(entry.full).split('\\').join('/');
      const marker = raw.lastIndexOf('packages/');
      if (marker === -1) continue;
      target = join(ROOT, 'packages', raw.slice(marker + 'packages/'.length));
    } catch {
      continue;
    }
    if (!existsSync(target)) {
      console.warn(
        `[prune-edgeone-function] 工作区包在仓库里不存在，跳过：${entry.name}（${target}）`,
      );
      continue;
    }
    const dest = entry.full;
    try {
      if (existsSync(dest) && !lstatSync(dest).isSymbolicLink()) {
        workspaces += 1;
        continue;
      }
      removePath(dest);
      mkdirSync(dest, { recursive: true });
      // 工作区包只拷**运行期需要**的部分：package.json + dist + 许可/说明。
      // 源码与测试在函数包里用不到，却有十几 MiB。
      copyRuntimeTree(target, dest);
      workspaces += 1;
      console.log(
        `[prune-edgeone-function] 工作区包实体化：${entry.name} ← ${relative(ROOT, target)}` +
          `（软链目标 ${raw}，产物 ${lstatSync(dest).isSymbolicLink() ? '仍是软链' : '已是实体目录'}）`,
      );
    } catch (error) {
      console.warn(`[prune-edgeone-function] 工作区包实体化失败：${entry.name} — ${error.message}`);
    }
  }

  // ---- 5) 删掉 .pnpm 与顶层 packages/ ----
  let freed = 0;
  try {
    freed += dirSize(pnpmDir);
    rmSync(pnpmDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
  const packagesDir = join(fnDir, 'packages');
  if (existsSync(packagesDir)) {
    try {
      freed += dirSize(packagesDir);
      rmSync(packagesDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }

  // ---- 5.5) 清理**断链**的顶层符号链接 ----
  // 只有目标已经不存在的断链才删（被裁掉的平台原生变体，如 @img/sharp-darwin-*）。
  // **能解析的一律保留**：Turbopack 的外部包哈希别名（`pg-<hash>` 等）
  // 就长这样，删掉等于让运行时找不到模块。
  let dropped = 0;
  for (const entry of listEntries(nmDir)) {
    try {
      if (!lstatSync(entry.full).isSymbolicLink()) continue;
      realpathSync(entry.full);
      // 能解析 → 说明它已被实体化过或仍可用，保留
      continue;
    } catch {
      /* 断链，删掉 */
    }
    try {
      removePath(entry.full);
      dropped += 1;
    } catch {
      /* 忽略 */
    }
  }
  if (dropped > 0) {
    console.log(`[prune-edgeone-function] 清理断链的顶层符号链接 ${dropped} 个`);
  }

  console.log(
    `[prune-edgeone-function] node_modules 已拍平：实体化 ${materialized} 个包、嵌套 ${nested} 个冲突版本、工作区包 ${workspaces} 个；` +
      `释放 ${mib(freed)} MiB`,
  );
  return { materialized, nested, workspaces, freed };
}

/**
 * 实体化 Turbopack 的**外部模块别名**。
 *
 * Next 16 的 Turbopack 会为 serverExternalPackages 里的包生成带哈希的别名目录，
 * 例如 `pg-4c0d8067d674414d`，运行时由 `[turbopack]_runtime.js` 里的
 * `externalImport(id)` 执行 `await import(id)` 加载。
 *
 * 关键点：
 *   - `externalImport` 走的是**原生 ESM 动态导入**，ESM 只认 `node_modules` 目录，
 *     而平台在上传/解包时会剥离任何名为 `node_modules` 的目录 →
 *     运行时必然报 `Cannot find package 'pg-<hash>'`，函数起不来。
 *   - 所以别名必须以**实体目录**的形态待在 `deps/` 下，再由运行时的
 *     ESM 解析钩子把裸标识符映射到 deps/（见 index.mjs 与 esm-hooks.mjs）。
 *
 * 别名的**实体来源**取自**工作区**的 `.next/node_modules`：
 * 函数包里的那份是软链（指向 .pnpm），而函数包内的 .pnpm 已被拍平步骤删掉，
 * 在函数包内部解析必然断链；工作区里 .pnpm 还在，软链解析得开。
 */
function materializeExternalAliases(fnDir, workspaceRoot) {
  const depsDir = join(fnDir, 'deps');
  const fnAliasDir = join(fnDir, '.next', 'node_modules');
  const wsAliasDir = join(workspaceRoot, '.next', 'node_modules');
  if (!existsSync(fnAliasDir) && !existsSync(wsAliasDir)) return 0;

  /** 递归复制目录内容，跳过 node_modules，并把符号链接解引用成真实文件。 */
  const copyTree = (src, dest) => {
    const srcStat = lstatSync(src);
    if (srcStat.isSymbolicLink()) {
      const real = realpathSync(src);
      if (lstatSync(real).isDirectory()) copyTree(real, dest);
      else cpSync(real, dest, { dereference: true });
      return;
    }
    if (srcStat.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        if (entry === 'node_modules') continue;
        copyTree(join(src, entry), join(dest, entry));
      }
      return;
    }
    cpSync(src, dest, { dereference: true });
  };

  // 名字清单以**产物**为准（它才是这次构建真正要用到的别名）。
  const names = new Set();
  for (const entry of listPackageEntries(fnAliasDir)) names.add(entry.name);
  for (const entry of listPackageEntries(wsAliasDir)) names.add(entry.name);

  let aliases = 0;
  const failed = [];
  for (const name of names) {
    const dest = join(depsDir, name);
    if (existsSync(dest)) continue;
    // 先试工作区（软链在那里解析得开），再退回产物自带的那份（多数已是实体目录）。
    const candidates = [join(wsAliasDir, name), join(fnAliasDir, name)];
    let source = null;
    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate)) continue;
        source = realpathSync(candidate);
        if (existsSync(source)) break;
        source = null;
      } catch {
        source = null;
      }
    }
    if (!source) {
      failed.push(name);
      continue;
    }
    try {
      mkdirSync(dirname(dest), { recursive: true });
      copyTree(source, dest);
      aliases += 1;
    } catch (error) {
      failed.push(`${name}（${error.message}）`);
    }
  }
  if (aliases > 0) {
    console.log(`[prune-edgeone-function] 已实体化外部模块别名 ${aliases} 个到 deps/`);
  }
  if (failed.length > 0) {
    throw new Error(
      `外部模块别名实体化失败：${failed.join('、')}。` +
        '这些别名是 Turbopack 为 serverExternalPackages 生成的哈希别名，' +
        '运行时会被 externalImport 直接 import，缺一个函数就起不来。',
    );
  }
  return aliases;
}

/**
 * 复制一个包目录里**运行期需要**的部分：package.json + dist + 许可/说明文件。
 * 源码（src）、测试、配置等一律不要——工作区包加起来有十几 MiB 源码，运行期用不到。
 *
 * ## 为什么 dist 必须整棵拷贝
 *
 * 这里的过滤条件**只作用于包根**：根目录下只放行 `dist` 与许可/说明。
 * 一旦进入 `dist/`，里面的 `index.js`、`runtime/http.js`、`pg-json.js`……
 * 都必须**整棵**拷贝下来。
 *
 * 早期版本在每一层都套同一个过滤条件，于是进入 dist 后，
 * 里面的文件既不叫 `dist` 也不在许可/说明清单里 → 全被跳过，
 * 结果是 `deps/@openmaic/storage/dist/` 是个**空目录**：
 * package.json 声明的入口 `./dist/index.js` 根本不存在。
 *
 * 后果在本地被仓库的 node_modules 掩盖（向上能找到完整副本），
 * 到线上就是：凡是加载 @openmaic/storage 的路由全部返回**空体 500**。
 */
function copyRuntimeTree(src, dest, depth = 0) {
  let source = src;
  try {
    if (lstatSync(src).isSymbolicLink()) source = realpathSync(src);
  } catch {
    return;
  }
  // 源与目标指向同一处（软链自环）→ 直接跳过，否则 cpSync 会报
  // "src and dest cannot be the same"。
  try {
    if (realpathSync(source) === realpathSync(dest)) return;
  } catch {
    /* 目标还不存在，按正常拷贝处理 */
  }
  const srcStat = lstatSync(source);
  if (srcStat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(source)) {
      if (entry === 'node_modules') continue;
      // 只有**包根**才过滤；dist/ 内部整棵拷贝。
      if (depth === 0 && entry !== 'dist' && !RUNTIME_FILES.has(entry)) continue;
      copyRuntimeTree(join(source, entry), join(dest, entry), depth + 1);
    }
    return;
  }
  cpSync(source, dest, { dereference: true });
}

/**
 * 删除一个路径。
 *
 * **软链必须用 unlink，不能用 rm(recursive)**：rmSync 对「指向目录的软链」会
 * **跟随软链删掉目标目录里的内容**（实测把 deps/ 掏空），这是数据丢失级陷阱。
 */
function removePath(target) {
  let isLink = false;
  try {
    isLink = lstatSync(target).isSymbolicLink();
  } catch {
    /* 不存在就当删掉了 */
    return;
  }
  if (isLink) {
    // **异常不许吞**：吞掉会让「软链其实没删掉」变成静默失败——
    // 后续拷贝会穿过软链写进目标目录，Node 的 cpSync 随后报
    // "src and dest cannot be the same"，根因却完全看不出来。
    unlinkSync(target);
    return;
  }
  rmSync(target, { recursive: true, force: true });
}

/**
 * 判断一个包目录能否被 **ESM** 解析：按 package.json 的 `exports["."].import`
 * （或 `module` / `main`）找到入口文件并确认它存在。
 *
 * 外部包大量是 ESM-only（exports 只声明 `import` 条件），`require.resolve`
 * 对它们必然失败，但运行期用的是 `await import()`——所以要用这个判据。
 */
function esmEntryExists(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const root = pkg.exports?.['.'];
    const target =
      typeof root === 'string' ? root : (root?.import ?? root?.default ?? root?.require);
    if (target) return existsSync(join(dir, target));
    if (pkg.module) return existsSync(join(dir, pkg.module));
    if (pkg.main) return existsSync(join(dir, pkg.main));
    return existsSync(join(dir, 'index.js'));
  } catch {
    return false;
  }
}

/**
 * 把依赖目录改名为 `deps`，并把 Turbopack 的外部模块别名并进去。
 *
 * ## 为什么必须改名
 *
 * **EdgeOne Pages 会在上传/解包时剥离任何名为 `node_modules` 的目录**
 * （实测：函数包根与 `.next/node_modules` 下的 node_modules 都没了，
 * `/var/user/node_modules` 不存在）。因此**只要依赖待在 node_modules 里，
 * 就一定到不了运行时**——无论里面是软链还是实体目录、无论用 pnpm 还是 npm 布局。
 *
 * ## 为什么改名就够
 *
 * 平台剥离发生在**上传时**，而**运行时**我们仍然可以自己把入口接上：
 * 入口 index.mjs 在 import handler 之前运行，它会创建
 *   - `<包根>/node_modules        -> deps`（CJS 解析 `require('next/…')` 用）
 *   - `<包根>/.next/node_modules  -> deps`（ESM 解析 `import('pg-<hash>')` 用）
 * 于是 CJS 与 ESM 两条解析路径都重新可用，且**不依赖平台是否物化符号链接**
 * （这两个符号链接是运行时在可写目录里新建的）。
 */
function renameDependenciesToDeps(fnDir) {
  const nmDir = join(fnDir, 'node_modules');
  const depsDir = join(fnDir, 'deps');
  // 注意：existsSync 会跟随符号链接，对**悬空软链**返回 false，
  // 这里必须用 lstatSync 判断「这个路径条目是否存在」。
  let nmStat = null;
  try {
    nmStat = lstatSync(nmDir);
  } catch {
    nmStat = null;
  }
  if (!nmStat) return 0;

  // 1) 先把 node_modules 改名成 deps（**必须先做**：否则后面合并别名时
  //    deps 会被重建，刚并进去的别名就丢了）。
  removePath(depsDir);
  // node_modules 可能是上一次失败留下的**悬空软链**（指向已被删掉的 deps），
  // 这种情况下必须删掉而不是改名，否则会把软链本身改名成 deps。
  if (lstatSync(nmDir).isSymbolicLink()) {
    removePath(nmDir);
    console.log('[prune-edgeone-function] 清除了上一次残留的 node_modules 悬空软链');
  } else {
    renameSync(nmDir, depsDir);
  }

  // 2) `.next/node_modules` 整个删掉：里面是 Turbopack 的外部模块别名（软链），
  //    平台会剥离任何名为 node_modules 的目录，留着也没有意义。
  //    别名的**实体内容**由 materializeExternalAliases 从工作区取，
  //    直接落到 deps/<别名> 下。
  const aliasDir = join(fnDir, '.next', 'node_modules');
  if (existsSync(aliasDir)) {
    removePath(aliasDir);
  }
  const size = dirSize(depsDir);
  console.log(
    `[prune-edgeone-function] 依赖目录已改名为 deps（${mib(size)} MiB）；` +
      '运行时由 NODE_PATH（CJS）与 ESM 解析钩子（ESM）把裸标识符指向 deps/',
  );
  return size;
}

/**
 * 把 ESM 解析钩子拷进函数包。
 *
 * 钩子本体是**独立文件** `scripts/edgeone-esm-hooks.mjs`，原样拷进去——
 * 不在脚本里再抄一份模板字符串，否则两边迟早漂移，
 * 而漂移的后果是「本地门禁全绿、线上 Cannot find package」。
 * 独立文件还能被单测直接验证（tests/deploy/esm-hooks.test.ts）。
 */
function writeEsmResolveHooks(fnDir) {
  const source = join(ROOT, 'scripts', 'edgeone-esm-hooks.mjs');
  if (!existsSync(source)) {
    throw new Error(`找不到 ESM 解析钩子源文件：${relative(ROOT, source)}`);
  }
  const target = join(fnDir, 'esm-hooks.mjs');
  cpSync(source, target);
  console.log('[prune-edgeone-function] 已写入 ESM 解析钩子 esm-hooks.mjs');
}

/**
 * 递归复制目录内容，跳过嵌套 node_modules，并把符号链接解引用成真实文件。
 */
function copyTreeDereferenced(src, dest) {
  const srcStat = lstatSync(src);
  if (srcStat.isSymbolicLink()) {
    const real = realpathSync(src);
    if (lstatSync(real).isDirectory()) copyTreeDereferenced(real, dest);
    else cpSync(real, dest, { dereference: true });
    return;
  }
  if (srcStat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      if (entry === 'node_modules') continue;
      copyTreeDereferenced(join(src, entry), join(dest, entry));
    }
    return;
  }
  cpSync(src, dest, { dereference: true });
}

/**
 * 工作区里「装了哪些包」的索引。
 *
 * 两种布局都要覆盖：
 *   - hoisted（node-linker=hoisted）：顶层 node_modules/<name>；
 *   - pnpm 隔离布局：node_modules/.pnpm/<实例>/node_modules/<name>。
 *
 * 这个索引是**判定「某个裸标识符到底是不是依赖」的依据**：
 * 产物里会 require 一些工作区根本没装的包（例如 @aws-sdk/signature-v4-crt，
 * 它是 AWS SDK 的可选 Rust 加速实现，SDK 内部用 try/catch 包着，
 * 缺失属预期行为）。这类 require 不该让门禁失败；
 * 但凡是**工作区里装了**的，就必须出现在 deps/ 里。
 */
function buildWorkspacePackageIndex(workspaceRoot) {
  const index = new Set();
  const add = (dir, prefix) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        add(join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      index.add(`${prefix}${entry.name}`);
    }
  };
  add(join(workspaceRoot, 'node_modules'), '');
  const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');
  let entries = [];
  try {
    entries = readdirSync(pnpmDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    add(join(pnpmDir, entry.name, 'node_modules'), '');
  }
  return index;
}

/** 在工作区里找一个包的**真实目录**（顶层优先，其次 pnpm 实例）。 */
function resolveWorkspacePackage(workspaceRoot, name) {
  const segments = name.split('/');
  const top = join(workspaceRoot, 'node_modules', ...segments);
  try {
    if (existsSync(top)) return realpathSync(top);
  } catch {
    /* 断链则继续找 */
  }
  const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');
  let entries = [];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = join(pnpmDir, entry, 'node_modules', ...segments);
    try {
      if (existsSync(candidate)) return realpathSync(candidate);
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

/**
 * Turbopack 外部模块别名的名字形状：`<包名>-<16 位十六进制哈希>`。
 *
 * 判定落在**根包名**上：别名的子路径（如 `<别名>/node`）也是别名，
 * 只看整串会因为末尾不是哈希而漏判。
 */
function looksLikeExternalAlias(spec) {
  const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return /-[0-9a-f]{12,}$/.test(root);
}

/**
 * 补齐产物用到、但函数包顶层没有的包。
 *
 * 产物里会 require/import 一些**传递依赖**（例如 `@aws-sdk/signature-v4-crt`：
 * 它是 `@aws-sdk/client-s3` 的依赖，不是本项目的直接依赖）。pnpm 的隔离布局下
 * 顶层只放直接依赖，于是这些包在函数包的 node_modules 顶层**根本不存在**；
 * 平台剥离 node_modules 之后，它们也没有别的来路 → 运行时 MODULE_NOT_FOUND。
 *
 * 这里按产物里**真实用到**的裸标识符，把缺的那些从**工作区**实体化到 deps/。
 * 工作区是 hoisted 布局，传递依赖都在顶层，直接复制即可。
 */
function ensureRuntimePackages(fnDir, workspaceRoot) {
  const depsDir = join(fnDir, 'deps');
  const { esm, cjs } = collectBareSpecifiers(join(fnDir, '.next', 'server'));
  const roots = new Set();
  for (const spec of [...esm, ...cjs]) {
    if (builtinModules.includes(spec)) continue;
    if (spec.startsWith('next/')) continue;
    const segments = spec.split('/');
    roots.add(spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]);
  }

  const workspaceIndex = buildWorkspacePackageIndex(workspaceRoot);
  let added = 0;
  const failed = [];
  const optional = [];
  for (const name of roots) {
    const dest = join(depsDir, name);
    if (existsSync(dest)) continue;
    const real = resolveWorkspacePackage(workspaceRoot, name);
    if (!real || !existsSync(real)) {
      // 工作区里根本没装 → 这是**可选依赖**（如 AWS SDK 的 Rust 加速件），
      // 产物里的 require 期望它失败并降级，不该让门禁失败。
      if (workspaceIndex.has(name) || looksLikeExternalAlias(name)) failed.push(name);
      else optional.push(name);
      continue;
    }
    try {
      mkdirSync(dirname(dest), { recursive: true });
      copyTreeDereferenced(real, dest);
      added += 1;
    } catch (error) {
      failed.push(`${name}（${error.message}）`);
    }
  }
  if (added > 0) {
    console.log(`[prune-edgeone-function] 已从工作区补齐 ${added} 个传递依赖到 deps/`);
  }
  if (optional.length > 0) {
    console.log(
      `[prune-edgeone-function] ${optional.length} 个可选依赖未安装（预期运行期降级）：${optional.join('、')}`,
    );
  }
  if (failed.length > 0) {
    throw new Error(
      `产物用到的以下包在函数包与工作区里都找不到：${failed.join('、')}。` +
        '它们会被运行期直接 import/require，缺一个就是 MODULE_NOT_FOUND。',
    );
  }
  return added;
}

/**
 * 把一个包按「运行期真正会加载的文件」最小化拷贝到产物里。
 *
 * ## 为什么不能整包拷贝
 *
 * 函数包有 128 MiB 的硬上限。整包拷贝光 openai（9.5 MiB / 1296 个文件，一半是
 * .d.ts 类型声明）就装不下——而产物里真正需要的往往只是它的一条 require 闭包。
 *
 * ## 为什么不能只拷 package.json
 *
 * 产物里 opennext 留下的 `node_modules/<pkg>/` 有时就是**一个桩目录**：
 * 版本、exports 都对，但里面除 package.json 什么都没有。平台剥离 node_modules
 * 之后，这些桩在运行期就是 `Cannot find package`。
 *
 * ## 这里做什么
 *
 * 以「入口 + 其相对 require 闭包」为准：
 *   1. package.json 原样拷贝（exports 映射是运行时契约）；
 *   2. 入口 = exports 里声明的所有目标 + main/module（运行时可能 import 任意子路径）；
 *   3. 对每个入口文件，扫出**相对**说明符（./ 与 ../），递归跟随；
 *   4. 裸标识符（其它包）不在这里处理——它们是别的包，由各自的拷贝负责。
 */
/**
 * 拍平后的**强制校验**。
 *
 * 三件事必须同时成立，任何一条不满足都直接中止部署（fail-closed）：
 *   1. 函数包里不允许残留任何符号链接（平台不物化符号链接 → 残留即 MODULE_NOT_FOUND）；
 *   2. 产物里真实引用到的**裸标识符**，其根包必须存在于 `deps/`；
 *   3. 这些裸标识符必须**真的能被解析**：
 *      CJS 走 NODE_PATH，ESM 走 esm-hooks.mjs 的 resolve 钩子。
 *   4. **`deps/` 里每个包的运行时入口必须真的存在**——
 *      产物里可能残留「只有 package.json 的桩目录」，它们在仓库内会被
 *      仓库自己的 node_modules 掩盖，到线上就是空体 500。
 *
 * ## 为什么校验必须发生在「工作区之外」
 *
 * 函数包位于仓库内（.edgeone/cloud-functions/ssr-node），而 Node 的 CJS 解析会
 * **沿父目录逐级向上找 node_modules**：函数包里没有 node_modules 时，
 * 它会一路找到**仓库根的 node_modules**——探针照样全绿，
 * 门禁验证的根本不是将要上线的那份产物（早期版本就栽在这里，
 * 还因为 `symlinkSync` 没被 import 而静默跳过建链，断言恒真）。
 *
 * 现在 CJS 探针走的是 **NODE_PATH**（与生产运行时同一条解析路径：
 * 平台上没有 node_modules，入口就是把 deps 挂进 NODE_PATH），
 * 探针目录放在仓库之外，向上找不到任何 node_modules。
 *
 * 所以校验用的探针目录放在仓库之外：向上找不到任何 node_modules，
 * 只有 deps/ 一条路——这才与平台上的情形一致
 * （平台剥离 node_modules，运行时只读，也建不了软链）。
 */
async function verifyFlattenedPackage(fnDir) {
  const depsDir = join(fnDir, 'deps');
  const { listPackageDirs, resolvePackagesRuntime } = await import('./verify-edgeone-deps.mjs');

  // ---- 1) 残留符号链接 ----
  const examples = [];
  let remainingLinks = 0;
  const countLinks = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        remainingLinks += 1;
        if (examples.length < 5) examples.push(relative(fnDir, full));
        continue;
      }
      if (entry.isDirectory()) countLinks(full);
    }
  };
  countLinks(fnDir);
  if (remainingLinks > 0) {
    throw new Error(
      `拍平后函数包内仍有 ${remainingLinks} 个符号链接（如 ${examples.join('、')}），` +
        '平台不会物化它们，函数必然起不来。请检查 scripts/prune-edgeone-function.mjs 的拍平逻辑。',
    );
  }

  // 判定「这个裸标识符到底是不是一个依赖」：
  //   - 工作区里装了 → 是依赖，deps/ 里必须有；
  //   - 名字是 Turbopack 外部别名形状（pkg-<哈希>）→ 是依赖，必须有；
  //   - 其余（工作区没装的可选依赖，如 @aws-sdk/signature-v4-crt）
  //     是 SDK 内部 try/catch 包着的可选加速件，缺失属预期行为，不算失败。
  const workspaceIndex = buildWorkspacePackageIndex(ROOT);
  const rootOf = (spec) => {
    const segments = spec.split('/');
    return spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  };

  // ---- 2) 产物里真实用到的裸标识符 ----
  const {
    esm: esmSpecifiers,
    cjs: cjsSpecifiers,
    indirect,
  } = collectBareSpecifiers(
    join(fnDir, '.next', 'server'),
    // 只有「工作区里确实装了同名包」的名字才算包名——
    // 否则 `"set-cookie"` 这种 HTTP 头名会被误当成包。
    (name) => workspaceIndex.has(rootOf(name)),
  );

  // ---- 2.5) **扫描器自检** ----
  //
  // 没有自检的扫描器是会「静默退化」的：第十二轮复审把 `.y(` 换成
  // `externalImport("...")`（一个产物里根本不存在的形态）之后，
  // ESM 集合从 9 个塌成 1 个，而门禁**照样全绿**——因为它只报告
  // 「实测失败 N 个」，而 N 仍然是 0。
  //
  // 所以这里给扫描器自己加三道兜底：
  //   1. 规模下限：裸标识符扫不出足够多的条目 → 扫描器一定退化了；
  //   2. 间接动态 import 形态：产物里既然有 `Function("specifier", …)`，
  //      就必须认出它加载的包，而且这些包必须进 ESM 探针集合；
  //   3. 命中的每个包都必须在 deps/ 里真实存在。
  //
  // **下限是相对值**：与产物里实际存在的 Turbopack 外部别名（`<包名>-<哈希>`）
  // 数量挂钩。写死一个绝对值会在「合法删掉某个 provider 路由」时误伤——
  // 那时别名本来就少了，扫描器并没有退化。
  const aliasDirCount = listPackageDirs(depsDir).filter((pkg) =>
    /-[0-9a-f]{8,}$/.test(pkg.name),
  ).length;
  const minCjsSpecifiers = 10;
  const minEsmSpecifiers = Math.max(1, Math.min(3, aliasDirCount));
  if (cjsSpecifiers.size < minCjsSpecifiers || esmSpecifiers.size < minEsmSpecifiers) {
    // 只打印**真正越界**的那一项。两个条件并排列出会出现「CJS 32 < 10」
    // 这种字面为假的描述，读者会以为自己看错了——第十三轮独立复审
    // 把它列为信息级问题：报错信息必须指向真正出问题的那一项。
    const violations = [];
    if (cjsSpecifiers.size < minCjsSpecifiers) {
      violations.push(`CJS ${cjsSpecifiers.size} < ${minCjsSpecifiers}`);
    }
    if (esmSpecifiers.size < minEsmSpecifiers) {
      violations.push(`ESM ${esmSpecifiers.size} < ${minEsmSpecifiers}`);
    }
    throw new Error(
      `裸标识符扫描结果异常偏少（${violations.join('、')}；产物里的外部别名共 ${aliasDirCount} 个）。` +
        '这通常意味着 Turbopack 的产物压缩形态变了、扫描器的正则打不中真实调用点——' +
        '此时门禁会「扫不到就等于没问题」，是恒真断言，必须先修扫描器。',
    );
  }
  if (indirect.chunkCount > 0 && indirect.specifiers.size === 0) {
    throw new Error(
      `产物里有 ${indirect.chunkCount} 个 chunk 用了 ` +
        '`Function("specifier","return import(specifier)")` 这种间接动态 import，' +
        '但扫描器一个包都没认出来。间接形态的包名是变量调用的实参，' +
        '正则匹配不到——扫描器在这里退化了，pg 这类关键包会逃过探针。',
    );
  }
  const missingIndirect = [...indirect.specifiers].filter((spec) => {
    const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return !existsSync(join(depsDir, root));
  });
  if (missingIndirect.length > 0) {
    throw new Error(
      `间接动态 import 形态引用了这些包，但它们不在 deps/ 里：${missingIndirect.join('、')}。` +
        '它们在平台运行期会变成 Cannot find package。',
    );
  }
  const allSpecifiers = new Set([...esmSpecifiers, ...cjsSpecifiers]);
  const isEnforceable = (spec) => {
    if (builtinModules.includes(spec)) return false;
    if (spec.startsWith('next/')) return false;
    const root = rootOf(spec);
    return workspaceIndex.has(root) || looksLikeExternalAlias(spec);
  };
  // 注意：这里**不再**做「deps/ 里有没有这个包」的静态判断——
  // 装配阶段（materializeExternalAliases / ensureRuntimePackages）已经 fail-closed 过一次，
  // 静态判断在它之后跑必然恒空，等于一条没有牙齿的断言（第十一轮复审 I-2）。
  // 真正能发现「包其实装不上」的是下面两把探针：
  //   - CJS 探针：用 NODE_PATH 真解析每一个裸标识符；
  //   - ESM 探针：起子进程真 import 每一个裸标识符。

  // ---- 3) 在工作区之外建探针目录：node_modules -> deps ----
  // 这条软链模拟「平台剥离 node_modules 后，我们把解析入口接到 deps/」的结果。
  const probeDir = outsideRepoTemp('edgeone-fn-probe', ROOT);
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(
    join(probeDir, 'package.json'),
    JSON.stringify({ name: 'edgeone-fn-probe', version: '0.0.0', private: true }),
  );
  // CJS 探针走 **NODE_PATH**，与生产运行时**同一条解析路径**：
  // 入口 index.mjs 运行时也是把 deps 挂进 NODE_PATH（平台上没有 node_modules 可用）。
  // 用软链代替会测到另一条机制——机制不同，结论就不能代表线上。
  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = previousNodePath ? `${depsDir}${delimiter}${previousNodePath}` : depsDir;
  Module._initPaths();

  try {
    // ---- 4) CJS 解析：关键模块 + 产物里 require() 的裸标识符 ----
    const probeRequire = createRequire(join(probeDir, 'package.json'));
    // 这些是**运行期真正外置**（不被打进 bundle）的包，缺一个函数就起不来。
    const probe = [
      'next/dist/server/lib/start-server.js',
      'next/dist/server/load-manifest.external.js',
      'react',
      'react-dom',
      'pg',
      'sharp',
      'postcss',
      'shiki',
    ];
    const unresolved = [];
    for (const spec of probe) {
      try {
        probeRequire.resolve(spec);
      } catch {
        unresolved.push(spec);
      }
    }
    for (const spec of cjsSpecifiers) {
      if (!isEnforceable(spec)) continue;
      try {
        probeRequire.resolve(spec);
      } catch {
        unresolved.push(spec);
      }
    }

    // ---- 5) ESM 解析：子进程里真注册钩子、真 import ----
    const esmFailures = await verifyEsmImports(
      fnDir,
      probeDir,
      [...esmSpecifiers].filter(isEnforceable),
    );

    // ---- 6) 运行期要用的包，入口必须真的存在 ----
    // 产物里可能残留 opennext 留下的「只有 package.json 的桩目录」：
    // 版本与 exports 都对，文件却一个没有。上面两把探针查的是
    // 「产物里有没有引用到这个裸标识符」，查不到「这个包自己装不装得上」——
    // 而后者才是线上 500 的真凶（@openmaic/storage 的 dist 是空的）。
    // 这里独立再验一遍：不信任修复，只信结果。
    const needed = collectNeededPackages(fnDir, ROOT, collectBareSpecifiers);
    const neededInDeps = listPackageDirs(depsDir).filter((pkg) => needed.has(pkg.name));
    const statuses = await resolvePackagesRuntime(
      neededInDeps.map((p) => p.name),
      depsDir,
      fnDir,
    );
    const brokenPackages =
      statuses && statuses.error
        ? []
        : neededInDeps
            .map((pkg) => ({ name: pkg.name, status: statuses[pkg.name] }))
            .filter((item) => item.status && !item.status.ok);

    console.log(
      `[prune-edgeone-function] 拍平校验：残留符号链接 0 个，关键模块 ${probe.length - unresolved.length}/${probe.length} 可解析，` +
        `裸标识符 ${allSpecifiers.size} 个（CJS ${cjsSpecifiers.size} / ESM ${esmSpecifiers.size}），` +
        `ESM 实测失败 ${esmFailures.length} 个，` +
        `运行期依赖 ${neededInDeps.length} 个、装不上 ${brokenPackages.length} 个`,
    );

    if (unresolved.length > 0) {
      throw new Error(
        `拍平后以下模块仍无法解析：${unresolved.join('、')}。平台会因缺少模块直接 5xx。`,
      );
    }
    if (esmFailures.length > 0) {
      throw new Error(
        `拍平后以下 ESM 标识符无法通过解析钩子加载：${esmFailures.join('、')}。` +
          'Turbopack 的 externalImport 走的是原生 import(id)，缺了就报 Cannot find package。',
      );
    }
    if (brokenPackages.length > 0) {
      // **这里只报告，不中止。**
      //
      // 静态闭包是**过近似**：它会把「产物引用到的包」连同它们的**全部**传递依赖
      // 都算进来，于是 typebox / @smithy/core / @aws-sdk/* 这些**运行期根本不会
      // 加载**的包也进了集合。把它们逐个实体化要多塞好几 MiB——而函数包有
      // 128 MiB 硬上限，为了「静态全绿」把包撑爆是本末倒置。
      //
      // 真正的判据是**运行期**：仓库外把函数包跑起来，看它到底缺哪个包。
      // scripts/repair-edgeone-runtime-deps.mjs 用这个反馈驱动来补包，
      // scripts/verify-edgeone-runtime.mjs 用同一把尺子做门禁。
      console.log(
        `[prune-edgeone-function] ⚠ 静态闭包里有 ${brokenPackages.length} 个包入口缺失` +
          `（${brokenPackages.map((item) => item.name).join('、')}）。` +
          '它们多数是运行期不会加载的传递依赖；是否需要补，由运行期门禁判定。',
      );
    }
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
    Module._initPaths();
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* 沙箱可能不允许删仓库外的目录 */
    }
  }
}

/**
 * 在子进程里**真实**验证 ESM 解析：注册产物里的 esm-hooks.mjs，
 * 然后逐个 import 产物里用到的裸标识符。
 *
 * 子进程的工作目录放在工作区之外，因此默认解析**找不到**任何 node_modules——
 * 能解析成功就只可能是钩子把标识符指向了 deps/。
 * 这与平台上的情形一致（平台剥离 node_modules）。
 */
async function verifyEsmImports(fnDir, probeDir, esmSpecifiers) {
  const targets = [...esmSpecifiers].filter(
    (spec) => !builtinModules.includes(spec) && !spec.startsWith('next/'),
  );
  if (targets.length === 0) return [];

  const hooksUrl = pathToFileURL(join(fnDir, 'esm-hooks.mjs')).href;
  const probeFile = join(probeDir, 'esm-probe.mjs');
  writeFileSync(
    probeFile,
    [
      "import { register } from 'node:module';",
      `register(${JSON.stringify(hooksUrl)});`,
      'const failures = [];',
      'for (const spec of ' + JSON.stringify(targets) + ') {',
      '  try {',
      '    await import(spec);',
      '  } catch (error) {',
      '    failures.push(spec + ": " + (error && error.code ? error.code : String(error)));',
      '  }',
      '}',
      "console.log('ESM_PROBE_RESULT ' + JSON.stringify(failures));",
      '',
    ].join('\n'),
    'utf-8',
  );

  const result = spawnSync(process.execPath, [probeFile], {
    cwd: probeDir,
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const match = stdout.match(/ESM_PROBE_RESULT (\[.*\])/);
  if (!match) {
    throw new Error(
      'ESM 解析探针没有产出结果（子进程异常退出）。' +
        `stdout: ${stdout.trim().slice(0, 400)} / stderr: ${(result.stderr || '').trim().slice(0, 600)}`,
    );
  }
  return JSON.parse(match[1]);
}

/**
 * 找出用 `Function("specifier","return import(specifier)")` 这种**间接**动态
 * import 形态加载的包。
 *
 * ## 为什么单靠正则不够
 *
 * 产物里的真实写法是：
 *   let r = Function("specifier", "return import(specifier)"), { Pool: s } = await r("pg")
 * 也就是说**包名是变量调用的实参**（`r("pg")`），不是 `Function(...)(...)` 的
 * 紧邻字面量。正则 `Function\([^)]*\)\(\s*["']([^"']+)` 打不中它——
 * 而 `pg` 恰恰是 serverExternalPackages 里最关键的包（Postgres 驱动）。
 *
 * ## 两道必要的收敛（否则会误报）
 *
 * 1. **就近**：调用必须出现在赋值的**同一语句附近**（Turbopack 的形态就是
 *    逗号表达式里紧跟着）。否则文件里任何一个叫 `r` 的变量调用都会被算上——
 *    实测就误报过 `"set-cookie"`（那是 HTTP 头名，不是包）。
 * 2. **是真实的包**：调用方再按「工作区里确实装了同名包」过滤一次。
 *
 * @param {(name: string) => boolean} isKnownPackage 判断某个名字是不是工作区里装着的包
 */
function collectFunctionImportSpecifiers(dir, isKnownPackage = () => true) {
  const candidates = new Set();
  const chunkCount = new Set();
  const isPackageName = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('${') &&
    !value.includes('\\') &&
    !value.startsWith('node:') &&
    !value.startsWith('.') &&
    !value.startsWith('/');

  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      let text = '';
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!text.includes('return import(specifier)')) continue;
      chunkCount.add(full);
      for (const assign of text.matchAll(
        /([A-Za-z_$][\w$]*)\s*=\s*Function\(\s*["']specifier["']/g,
      )) {
        const varName = assign[1];
        // 只看赋值之后**就近**的一小段：Turbopack 的形态就在同一语句里。
        const window = text.slice(assign.index, assign.index + 400);
        const callPattern = new RegExp(`\\b${varName}\\(\\s*["']([^"']+)["']\\s*\\)`, 'g');
        for (const call of window.matchAll(callPattern)) {
          if (isPackageName(call[1]) && isKnownPackage(call[1])) {
            candidates.add(call[1]);
          }
        }
      }
    }
  };
  walk(dir);
  return { specifiers: candidates, chunkCount: chunkCount.size };
}

/**
 * 扫描产物里**真实调用点**上的裸标识符。
 *
 * 匹配源必须打在真正的调用点上：
 *   - `require("x")` —— CJS 引用；
 *   - `import("x")` —— 字面量形式的 ESM 动态导入；
 *   - `.y("x")` —— Turbopack 的 externalImport 调用点
 *     （`.next/server/chunks/[turbopack]_runtime.js` 里
 *      `contextPrototype.y = externalImport`，externalImport 内部执行 `await import(id)`）。
 *   - `r("x")` —— `Function("specifier","return import(specifier)")` 赋出来的
 *     那个函数变量上的调用（见 collectFunctionImportSpecifiers）。
 *
 * 早期版本用的是 `externalImport\("..."` 这个正则，它**打不中任何调用点**
 * （产物里根本没有 `externalImport("x")` 这种写法），于是「别名全部可解析」
 * 恒真——门禁形同虚设，缺包照样上线。
 */
function collectBareSpecifiers(dir, isKnownPackage = () => true) {
  const esm = new Set();
  const cjs = new Set();
  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      let text = '';
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // 注意：模板字面量（`import("${t}")`）不是包名，必须排除；
      // `node:` 前缀的是内置模块，也排除。
      const isPackageName = (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        !value.includes('${') &&
        !value.includes('\\') &&
        !value.startsWith('node:') &&
        !value.startsWith('.') &&
        !value.startsWith('/');
      for (const match of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
        if (isPackageName(match[1])) cjs.add(match[1]);
      }
      for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        if (isPackageName(match[1])) esm.add(match[1]);
      }
      for (const match of text.matchAll(/\.y\(\s*["']([^"']+)["']\s*\)/g)) {
        if (isPackageName(match[1])) esm.add(match[1]);
      }
    }
  };
  walk(dir);
  // 间接动态 import 形态（Turbopack 的 Function("specifier", …) 变量调用）
  // 同样是 ESM 动态导入，必须进 ESM 集合——否则 pg 这类包根本不会被探针验证。
  const indirect = collectFunctionImportSpecifiers(dir, isKnownPackage);
  for (const spec of indirect.specifiers) esm.add(spec);
  return { esm, cjs, indirect };
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
  /**
   * **去掉函数包的依赖清单（dependencies / devDependencies / peerDependencies）。**
   *
   * 这是平台侧一个很隐蔽的约定：SCF 系的函数运行时看到 package.json 里声明了
   * `dependencies`，就会**认为依赖由它自己安装**，于是把包里**已经打好的
   * node_modules 整个剥掉**（平台侧实测：/var/user 下没有 node_modules 目录，
   * 函数日志报 `Cannot find module 'next/dist/server/lib/start-server.js'`）。
   *
   * 而我们的依赖清单里有 `@openmaic/dsl: workspace:*` 这类工作区协议，
   * 平台根本装不上 → 依赖两头落空。
   *
   * 所以：**产物副本里不带依赖清单**。依赖已经由裁剪阶段的「拍平」完整放进
   * 函数包的 node_modules 了，运行期不需要任何安装。
   * （仓库根 package.json 的 dependencies 一行不改，那边是给本地开发用的。）
   */
  if (pkg.dependencies || pkg.devDependencies || pkg.peerDependencies) {
    delete pkg.dependencies;
    delete pkg.devDependencies;
    delete pkg.peerDependencies;
    changed = true;
    console.log(
      '[prune-edgeone-function] 已移除函数包的依赖清单（避免平台剥掉已拍平的 node_modules）',
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
