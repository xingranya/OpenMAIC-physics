/**
 * 函数包**运行时**校验：在仓库外启动它，打全部路由，断言没有 5xx。
 *
 * ## 为什么必须有这一步
 *
 * 静态检查（require.resolve / import.meta.resolve）只能证明「某个包能解析」。
 * 它证明不了「跑起来会不会炸」，而线上真正炸的就是运行时：
 *
 *   - 凡是加载 @openmaic/storage 的路由（/api/stages*）在线上返回**空体 500**，
 *     其余路由正常 —— 一个纯静态的包完整性检查根本看不出这个差别。
 *
 * 更要命的是**本地会骗人**：函数包放在仓库里，Node 沿父目录向上找 node_modules，
 * 一路找到仓库根的 node_modules，把产物里缺失的文件全给补上了（"桩目录"
 * 只有 package.json，本地照样能 require 到仓库里的完整副本）。
 * 于是「本地全绿、线上 500」。
 *
 * 所以这个校验必须：
 *   1. 把函数包挪到**仓库之外**再启动 —— 向上找不到任何 node_modules，
 *      平台上的真实情形（剥离 node_modules、只读、只能靠 deps/）被复现；
 *   2. 打**全部**路由，而不是挑几个看着重要的；
 *   3. 同时抓子进程 stderr 里的 "Failed to load external module" ——
 *      那是「某个外部包在运行期装不上」的直接证据，
 *      也是「补包」这件事的**输入**（见 repair-edgeone-runtime-deps.mjs）。
 *
 * 用法：node scripts/verify-edgeone-runtime.mjs [fnDir] [nodeBin]
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProbeOutsideRepo, detectRepoRoot, outsideRepoTemp } from './edgeone-temp.mjs';

/**
 * 硬链接复制一棵树。
 *
 * 为什么不用普通复制：函数包约 140 MiB，普通复制会在临时目录里堆一份，
 * 而沙箱**不允许删除仓库外的目录**（实测 /tmp、/var/tmp、~ 全是 EPERM），
 * 跑几次门禁就把磁盘堆满了。硬链接不占额外空间。
 *
 * 为什么不用软链：软链会被 Node 解析成**仓库内的真实路径**，
 * 向上找 node_modules 就会命中仓库根的 node_modules——产物里缺失的文件
 * 又被补上了，门禁形同虚设。硬链接保留的是仓库外的**路径**，
 * Node 向上找不到任何 node_modules，这才是平台上的真实情形。
 */
function linkTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      linkTree(from, to);
    } else if (entry.isFile()) {
      try {
        linkSync(from, to);
      } catch {
        // 跨设备等场景退化为普通复制
        cpSync(from, to, { dereference: true });
      }
    }
  }
}

/**
 * 从产物的路由清单里取出全部可访问路径。
 *
 * 清单的键是**文件路径**（`/api/stages/[id]/route`），最后一段 `route`/`page`
 * 是文件名而不是 URL 的一部分——不去掉的话，请求 `/api/stages/route` 会被
 * `/api/stages/[id]` 接住（id="route"），测的就不是我们想测的路由了。
 * 动态段（[id]）用占位值替换：只关心「这条路由会不会加载失败」。
 *
 * 导出供数字门禁复用（`scripts/check-doc-metrics.mjs`）——路由数必须用
 * **同一套**口径实测，否则文档里的数字和门禁永远对不上。
 */
export function collectRoutes(fnDir) {
  const manifestPath = join(fnDir, '.next', 'app-path-routes-manifest.json');
  if (!existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
  const routes = new Set();
  for (const key of Object.keys(manifest)) {
    // 去掉文件名段（route / page），剩下的才是 URL 路径
    let cleaned = key.replace(/\/(route|page)$/, '');
    if (!cleaned) cleaned = '/';
    // 路由组 (group) 不是 URL 的一部分
    cleaned = cleaned.replace(/\/\([^/]+\)/g, '');
    // 动态段填占位值
    const filled = cleaned.replace(/\[[^\]]+\]/g, 'probe-id');
    if (filled === '/_not-found' || filled === '/_global-error') continue;
    routes.add(filled);
  }
  return [...routes].sort();
}

/**
 * 监听端口是**写死**在 bootstrap.js 里的（opennext 生成，平台约定 9000），
 * 不看 PORT 环境变量——之前探测连不上就是这个原因。
 */
function detectPort(fnDir) {
  if (process.env.PROBE_PORT) return process.env.PROBE_PORT;
  try {
    const bootstrap = readFileSync(join(fnDir, 'bootstrap.js'), 'utf8');
    const match = bootstrap.match(/const\s+SERVER_PORT\s*=\s*(\d+)/);
    if (match) return match[1];
  } catch {
    /* 读不到就用默认值 */
  }
  return '9000';
}

async function waitForServer(base, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      await res.text();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

/**
 * 跑一次运行期探测。
 *
 * @returns {Promise<{
 *   up: boolean, routes: string[], failures: Array<{route:string,status:any,head?:string}>,
 *   loadErrors: string[], nativeOnly: string[], statusByCode: Map<string, number>,
 *   probeDir: string, stderr: string, stdout: string
 * }>}
 */
/** 会话 Cookie 名。与客户端、中间件、部署脚本三处一致（契约测试盯着）。 */
const SESSION_COOKIE_NAME = 'physics_session';

export async function runRuntimeProbe(fnDir, options = {}) {
  const nodeBin = options.nodeBin || process.execPath;
  const repoRoot = options.repoRoot || detectRepoRoot();
  const port = options.port || detectPort(fnDir);

  const workDir = options.workDir || outsideRepoTemp('edgeone-runtime', repoRoot);
  const pkgDir = join(workDir, 'pkg');

  // 「探针在仓库之外」这道不变量，必须在**调用点**独立成立。
  //
  // 为什么不能只靠 outsideRepoTemp()：它是被调用方——有人把这一行换成
  // `join(process.cwd(), '.tmp', …)` 时，outsideRepoTemp 根本不会执行，
  // 探针就落进仓库，Node 沿父目录找到仓库根的 node_modules，把产物里缺失的
  // 文件全给补齐。于是门禁 exit 0 全绿，还照样打印「通过：仓库外运行」，
  // 而产物其实缺 yaml/nanoid —— 这正是「本地全绿、线上空体 500」的成因。
  //
  // 所以这道断言既不依赖被调用方守规矩，也不依赖仓库根判得准：
  // assertProbeOutsideRepo 同时检查「不在仓库内」与「向上无 node_modules」。
  //
  // 它排在凭据检查**之前**：探针落位是门禁自身的完整性前提——
  // 探针都不在仓库外，后面测的一切都不可信。
  try {
    assertProbeOutsideRepo(workDir, repoRoot);
    linkTree(fnDir, pkgDir);
    // 复制完再查一次：产物自身若带了 node_modules，同样会污染解析。
    assertProbeOutsideRepo(pkgDir, repoRoot);
  } catch (error) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* 沙箱可能不允许删仓库外的目录：硬链接不占额外空间，可放着 */
    }
    throw error;
  }

  const child = spawn(nodeBin, ['index.mjs'], {
    cwd: pkgDir,
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      EDGEONE: '1',
      DEFAULT_MODEL: process.env.PROBE_DEFAULT_MODEL || 'openai:@makers/deepseek-v4-flash',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });

  const base = `http://127.0.0.1:${port}`;
  const up = await waitForServer(base);
  const cleanup = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* 沙箱可能不允许删仓库外的目录：硬链接不占额外空间，可放着 */
    }
  };

  if (!up) {
    cleanup();
    return {
      up: false,
      routes: [],
      failures: [],
      nativeFailures: [],
      loadErrors: [],
      nativeOnly: [],
      statusByCode: new Map(),
      probeDir: workDir,
      stderr,
      stdout,
    };
  }

  // 以「已登录」的身份探测：会话 Cookie 的形状是 <账号 id>.<时间戳>，
  // 门禁只验形状（强度如实写在线上材料里），所以这里直接造一张。
  // 不带 Cookie 也能探——只是受门禁保护的路由会返回 401，探不到它们的真实行为。
  const cookie = `${SESSION_COOKIE_NAME}=runtime-probe.${Date.now()}`;

  // 打全部路由
  const routes = collectRoutes(fnDir);
  const failures = [];
  const nativeFailures = [];
  const statusByCode = new Map();
  // 「平台原生不匹配」要单独归类：产物里带的是 linux-x64 的原生二进制
  // （sharp / libvips），在 macOS 上本来就加载不了——那是本机与平台的
  // 架构差异，不是产物缺东西，不能算成门禁失败。
  //
  // 归因必须**逐请求**做：只按 stderr 里「有没有出现过」来判，会把
  // 「别的路由触发的 sharp 报错」也算到当前路由头上。这里记录每次请求
  // 前后 stderr 的长度差，只看**这次请求自己**产生的那段。
  const NATIVE_MISMATCH =
    /using the (darwin|linux)-?\w* runtime|was compiled against a different Node\.js version/i;
  for (const route of routes) {
    const stderrBefore = stderr.length;
    try {
      const res = await fetch(`${base}${route}`, {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
      });
      const body = await res.text();
      const bucket = String(res.status);
      statusByCode.set(bucket, (statusByCode.get(bucket) || 0) + 1);
      // 501 是**有意**的应答：视频渲染服务未配置时返回 PROVIDER_DISABLED，
      // 那是产品的既定行为，不是故障。其余 5xx 一律算失败。
      if (res.status >= 500 && res.status !== 501) {
        const own = stderr.slice(stderrBefore);
        const record = {
          route,
          status: res.status,
          head: body.slice(0, 160).replace(/\s+/g, ' '),
        };
        if (NATIVE_MISMATCH.test(own)) nativeFailures.push(record);
        else failures.push(record);
      }
    } catch (error) {
      failures.push({ route, status: `ERR ${error.message}` });
    }
  }

  // 运行期外部模块加载失败
  // 「平台原生不匹配」要单独归类：产物里带的是 linux-x64 的原生二进制
  // （sharp / libvips），在 macOS 上本来就加载不了——那是本机与平台的
  // 架构差异，不是产物缺东西，不能算成门禁失败。
  const allLoadErrors = [
    ...new Set(
      (stderr.match(/Failed to load external module[^\n]*/g) || []).map((line) =>
        line.replace(/\s+/g, ' '),
      ),
    ),
  ];

  cleanup();

  return {
    up: true,
    routes,
    failures,
    loadErrors: allLoadErrors.filter((line) => !NATIVE_MISMATCH.test(line)),
    nativeOnly: allLoadErrors.filter((line) => NATIVE_MISMATCH.test(line)),
    nativeFailures,
    statusByCode,
    probeDir: workDir,
    stderr,
    stdout,
  };
}

/**
 * 从运行期错误里认出「缺哪个包」。
 *
 * 两种形态都要认：
 *   - `Cannot find package 'yaml' imported from …`      → yaml
 *   - `Cannot find module '…/deps/nanoid/non-secure/index.js'` → nanoid
 *     （这种是包**在** deps 里、但它的入口文件不在）
 */
export function extractMissingPackages(loadErrors) {
  const names = new Set();
  for (const line of loadErrors) {
    const byPackage = line.match(/Cannot find package '([^']+)'/);
    if (byPackage) {
      names.add(byPackage[1]);
      continue;
    }
    const byPath = line.match(/\/deps\/((?:@[^/]+\/)?[^/]+)\//);
    if (byPath) names.add(byPath[1]);
  }
  return [...names];
}

// ---- CLI ----
async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((arg, index) => {
    return !arg.startsWith('--');
  });

  const fnDir = resolve(
    positional[0] || join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node'),
  );
  const nodeBin = positional[1] || process.execPath;

  let result;
  try {
    result = await runRuntimeProbe(fnDir, { nodeBin });
  } catch (error) {
    // 断言类失败（探针落进仓库、拿不到访问码等）必须给出可读信息，
    // 而不是一坨 unhandled rejection 栈。
    console.error(`[verify-edgeone-runtime] ${error.message}`);
    process.exit(1);
  }

  if (!result.up) {
    console.error('[verify-edgeone-runtime] 函数包没能起来：');
    console.error(result.stderr.slice(-4000) || result.stdout.slice(-2000));
    process.exit(1);
  }

  const summary = [...result.statusByCode.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => `${k}×${v}`)
    .join('  ');
  console.log(`[verify-edgeone-runtime] 探测 ${result.routes.length} 条路由：${summary}`);
  console.log(
    `[verify-edgeone-runtime] 探针目录 ${result.probeDir}（已断言：不在仓库内、向上无 node_modules）`,
  );
  if (result.loadErrors.length > 0) {
    console.log(`[verify-edgeone-runtime] 运行期外部模块加载失败 ${result.loadErrors.length} 类：`);
    // 展示时再截断：解析必须用完整行（包路径往往在第 200 个字符之后）。
    for (const line of result.loadErrors) console.log(`  ✗ ${line.slice(0, 300)}`);
    const missing = extractMissingPackages(result.loadErrors);
    if (missing.length > 0) console.log(`  → 缺这些包：${missing.join('、')}`);
  }
  if (result.nativeOnly.length > 0) {
    console.log(
      `[verify-edgeone-runtime] 另有 ${result.nativeOnly.length} 类**平台原生差异**（产物带 linux-x64 原生库，本机是 macOS），不计入失败：`,
    );
    for (const line of result.nativeOnly) console.log(`  · ${line.slice(0, 300)}`);
  }
  if (result.nativeFailures && result.nativeFailures.length > 0) {
    console.log(
      `[verify-edgeone-runtime] 另有 ${result.nativeFailures.length} 条 5xx 归因于**平台原生差异**（产物带 linux-x64 原生库，本机是 macOS），不计入失败：`,
    );
    for (const item of result.nativeFailures) console.log(`  · ${item.status} ${item.route}`);
  }
  if (result.failures.length > 0) {
    console.log(`[verify-edgeone-runtime] 5xx / 请求失败 ${result.failures.length} 条：`);
    for (const item of result.failures) {
      console.log(`  ✗ ${item.status} ${item.route}${item.head ? `  ${item.head}` : ''}`);
    }
  }
  if (result.failures.length > 0 || result.loadErrors.length > 0) {
    console.error('[verify-edgeone-runtime] 函数包在仓库外跑不出健康状态，拒绝放行。');
    process.exit(1);
  }
  console.log('[verify-edgeone-runtime] 通过：在仓库外运行无 5xx、无外部模块加载失败。');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
