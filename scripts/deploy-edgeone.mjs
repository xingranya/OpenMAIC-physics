#!/usr/bin/env node
/**
 * 一键部署到腾讯云 EdgeOne Pages（生产环境）。
 *
 * 为什么需要这个脚本，而不是直接 `edgeone makers deploy`：
 *
 * 1. **函数包 128MiB 硬上限。** EdgeOne 的 Cloud SSR Node 函数包解包后超过
 *    128MiB 平台直接拒收（部署状态 Failed / 错误码 30，原始报错
 *    `Cloud SSR Node functions package size exceeds 128MiB limit`）。
 *    本项目打包后约 255MiB，必须先裁剪（见 prune-edgeone-function.mjs）
 *    再上传，否则部署永远失败。
 *
 * 2. **裁剪必须在构建之后、上传之前。** CLI 没有暴露这个钩子，但当待部署
 *    目录里**只有 .edgeone 与 edgeone.json** 时，CLI 会判定「产物已就绪」
 *    并跳过本地构建（见 CLI 的 Qee()/build 判定）。所以流程是：
 *        构建 → 裁剪 → 挪进只有 .edgeone 的暂存目录 → 从暂存目录 deploy。
 *
 * 3. **构建期不能用 corepack 默认的 pnpm。** 受限环境里 corepack 缓存可能
 *    没有 packageManager 指定的那个 pnpm 版本，构建第一步就会挂。
 *    这里显式给出 InstallCommand，指向仓库内可用的 pnpm 与内容寻址 store。
 *
 * 用法：
 *   node scripts/deploy-edgeone.mjs                # 完整流程（构建→裁剪→部署）
 *   node scripts/deploy-edgeone.mjs --dry-run      # 只跑构建+裁剪并报告体积
 *   node scripts/deploy-edgeone.mjs --skip-build   # 复用已有 .edgeone 产物
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';

const ROOT = process.cwd();
const EDGEONE_DIR = join(ROOT, '.edgeone');
const STAGE_DIR = join(ROOT, '.tmp', 'edgeone-stage');
const PROJECT_NAME = process.env.EDGEONE_PROJECT_NAME || 'physics-ai-classroom-global';
/**
 * **加速区域**（项目级，决定静态资源与函数落在哪套可用区）。
 *
 * 实测（2026-10-23，控制台项目列表 + DescribePagesProjects 逐字段对比）：
 *   - `Area: "global"`   → 控制台显示「全球可用区（**含**中国大陆）」→ 函数默认落 ap-guangzhou
 *   - `Area: "overseas"` → 控制台显示「全球可用区（**不含**中国大陆）」→ 函数落 ap-singapore，**无大陆节点**
 *
 * 而 EdgeOne CLI 建项目时**写死** `CreatePagesProject {Area: "global"}`，
 * 也就是「含中国大陆」的那一档——所以 CLI 单独建出来的项目永远带大陆节点。
 * 本项目要「零大陆节点 + 自定义域名免 ICP 备案」，必须用 API 显式建
 * `Area: "overseas"` 的项目（见 ensureOverseasProject）。
 */
const PROJECT_AREA = process.env.EDGEONE_PROJECT_AREA || 'overseas';
/** CLI 的 API 区域参数（决定打哪个 API 端点，与上面的加速区域是两回事）。 */
const AREA = process.env.EDGEONE_AREA || 'global';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BUILD = process.argv.includes('--skip-build');

/** 函数包体积上限（EdgeOne 平台对 Cloud SSR Node 函数的硬限制）。 */
const LIMIT_MIB = 128;

/**
 * 干净的环境变量白名单。
 *
 * **为什么必须净化**：EdgeOne CLI 在编译 edge 函数（也就是 Next 的 middleware）
 * 时，会把**当前进程的 env 整体内联**进产物。实测一次部署内联了 79 个变量，
 * 里面既有本机的 PATH / HOME / PWD，也有 `WEKNORA_API_KEY`、
 * `ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN` 这类**真实凭据**。
 *
 * 这不只是泄露风险：macOS 专有的环境变量（`XPC_*`、`MACH_PORT_*` 等）被塞进
 * 边缘运行时后，edge 函数在平台上**加载即崩**，所有经过中间件的路由都会
 * 返回 502（`CLOUD_FUNCTION_INVOCATION_FAILED`）；而静态页由平台的 filesystem
 * handler 直接服务、不经函数，所以呈现出「静态页 200、动态页 502」的怪现象。
 *
 * 所以这里只透传构建真正需要的变量，其余一律不带。平台侧的运行时环境变量
 * （ACCESS_CODE / EDGEONE / DEFAULT_MODEL）由 `edgeone makers env set` 写在
 * 平台环境里，与本地进程无关。
 */
const CLEAN_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  'npm_config_store_dir',
  'npm_config_package_import_method',
  'npm_config_registry',
  'npm_config_user_config',
  'PNPM_HOME',
];

/** 构造一份净化后的环境变量。 */
function cleanEnv(extra = {}) {
  const env = {};
  for (const key of CLEAN_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // PATH 也要收窄：构建只需要 node、pnpm shim、edgeone CLI 和系统基础目录，
  // 不收窄的话本机的各种个人工具目录（~/.bun/bin、~/.cargo/bin…）会被写进产物。
  const keepDirs = (process.env.PATH || '')
    .split(':')
    .filter((dir) => dir && (/\/\.tmp\/bin$/.test(dir) || /\/node_modules\/\.bin$/.test(dir)));
  // edgeone CLI 自己所在目录也要留着，否则子进程根本起不来。
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir) continue;
    try {
      if (existsSync(join(dir, 'edgeone'))) {
        keepDirs.push(dir);
        break;
      }
    } catch {
      /* 忽略不可读目录 */
    }
  }
  env.PATH = [
    ...new Set([...keepDirs, path.dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin']),
  ].join(':');
  env.SHELL = env.SHELL || '/bin/bash';
  env.LANG = env.LANG || 'en_US.UTF-8';
  env.CI = 'true';
  return { ...env, ...extra };
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: 'inherit',
    env: cleanEnv(options.env || {}),
  });
  if (result.status !== 0) {
    throw new Error(`命令失败（退出码 ${result.status}）：${command} ${args.join(' ')}`);
  }
}

/** 递归统计目录体积（字节，与平台口径一致：按文件字节求和）。 */
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
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* 并发移除 */
        }
      }
    }
  }
  return total;
}

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);

// ---------------------------------------------------------------- 1. 构建
if (!SKIP_BUILD) {
  console.log('=== 1/3 构建 EdgeOne 产物 ===');
  // Next.js 在构建期会重写 tsconfig.json（补齐它自己的选项、压成一行 JSON，
  // 并追加 cloud-functions/node-functions 等排除项）。那不是我们想要的
  // 仓库状态，会让 prettier --check 与 git diff 变脏，所以构建后还原。
  const tsconfigPath = join(ROOT, 'tsconfig.json');
  const tsconfigBefore = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, 'utf8') : null;
  try {
    run('edgeone', ['pages', 'build', '--mode', 'prod'], {
      env: {
        // 受限环境的 corepack 缓存可能没有 packageManager 指定的 pnpm；
        // 显式指定安装命令，绕开 corepack 并固定到仓库内的内容寻址 store。
        //
        // 安装命令是「装 → 修 store → 再装」：
        //   某些防护策略会**按文件名**拦截 `.gitmodules` 的创建，pnpm 往包里写这个
        //   文件时直接 EPERM，整个安装中断。真正的解药是先修 store 索引
        //   （scripts/fix-pnpm-store-gitmodules.mjs 把该条目从索引里摘掉，pnpm 就不会
        //   再尝试创建它），再重跑一次安装。
        //
        // 这里**不能**用 `--ignore-scripts`：它会跳过 root postinstall，
        // 于是 `packages/*/dist`（不在版本控制里，只由 postinstall 生成）不会被构建，
        // 干净机器上的构建链会断在第一步。
        InstallCommand:
          process.env.InstallCommand ||
          [
            `pnpm install --frozen-lockfile --package-import-method=hardlink --store-dir=${join(ROOT, '.pnpm-store')}`,
            `node scripts/fix-pnpm-store-gitmodules.mjs`,
            `pnpm install --frozen-lockfile --package-import-method=hardlink --store-dir=${join(ROOT, '.pnpm-store')}`,
          ].join(' ; '),
        CI: 'true',
      },
    });
  } finally {
    if (tsconfigBefore !== null && readFileSync(tsconfigPath, 'utf8') !== tsconfigBefore) {
      writeFileSync(tsconfigPath, tsconfigBefore);
      console.log('[deploy-edgeone] 已还原构建期被改写的 tsconfig.json');
    }
  }
} else {
  console.log('=== 1/3 跳过构建（复用现有 .edgeone） ===');
}

if (!existsSync(EDGEONE_DIR)) {
  throw new Error(`没有构建产物：${EDGEONE_DIR}`);
}

/**
 * 产物泄露门禁：CLI 编译 edge 函数时会把当前进程的 env 内联进产物。
 * 这里确认**没有**把本机路径与本机凭据带进去；带进去了既泄露凭据，
 * 又会因为 macOS 专有环境变量让边缘函数在平台上加载即崩。
 */
const edgeBundle = join(EDGEONE_DIR, 'edge-functions', 'index.js');
if (!existsSync(edgeBundle)) {
  // fail-closed：产物里找不到 edge 函数 bundle，说明 CLI 改了产物路径或构建异常。
  // 此时**不能**静默放行——门禁一旦形同虚设，本机凭据就可能随产物上线。
  throw new Error(
    `产物泄露门禁找不到 edge 函数产物：${relative(ROOT, edgeBundle)}。` +
      '请确认 edgeone CLI 的产物路径未变更，或该产物本就不含 edge 函数。',
  );
}
{
  const bundle = readFileSync(edgeBundle, 'utf8');
  const problems = [];

  // (1) 产物里内联的环境变量名必须在白名单内。
  //     白名单 = 构建机必需的那几个 + 平台侧下发的部署相关变量。
  const allowed = new Set([
    ...CLEAN_ENV_KEYS,
    'ACCESS_CODE',
    'EDGEONE',
    'DEFAULT_MODEL',
    'EDGEONE_PROJECT_ID',
    'PAGES_PROJECT_ID',
  ]);
  const bundledNames = [
    ...new Set([...bundle.matchAll(/"([A-Z][A-Z0-9_]{2,})":/g)].map((m) => m[1])),
  ];
  const unexpected = bundledNames.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    problems.push(`白名单外的环境变量 ${unexpected.join('、')}`);
  }

  // (2) 本机凭据的取值不能出现在产物里。
  for (const key of Object.keys(process.env)) {
    if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) continue;
    const value = process.env[key];
    if (!value || value.length < 12) continue;
    if (bundle.includes(value)) problems.push(`环境变量 ${key} 的取值`);
  }

  if (problems.length > 0) {
    throw new Error(
      `构建产物把本机环境内联进了 edge 函数（${problems.join('、')}）。` +
        '请检查部署脚本是否走了净化环境（scripts/deploy-edgeone.mjs 的 cleanEnv）。',
    );
  }
  console.log(
    `[deploy-edgeone] 产物泄露门禁通过：edge 函数只内联了 ${bundledNames.length} 个白名单变量`,
  );
}

// ---------------------------------------------------------------- 2. 裁剪
console.log('\n=== 2/3 裁剪云函数包 ===');
run('node', ['scripts/prune-edgeone-function.mjs', '--yes']);

const fnDir = join(EDGEONE_DIR, 'cloud-functions', 'ssr-node');
const fnSize = dirSize(fnDir);
console.log(`\n函数包体积：${mib(fnSize)} MiB（平台上限 ${LIMIT_MIB} MiB）`);
if (fnSize / 1024 / 1024 > LIMIT_MIB) {
  throw new Error(
    `函数包仍超限（${mib(fnSize)} MiB > ${LIMIT_MIB} MiB）。需要继续削减内容，见 deploy/README.md §8.1d。`,
  );
}

if (DRY_RUN) {
  console.log('\n--dry-run：到此为止，不上传。');
  process.exit(0);
}

/**
 * 确保目标项目存在，且**加速区域**是「全球可用区（不含中国大陆）」。
 *
 * 为什么必须自己做这件事：
 *   - EdgeOne CLI 建项目时写死 `CreatePagesProject {Area: "global"}`，
 *     那一档在控制台显示为「全球可用区（**含**中国大陆）」，
 *     函数会默认落 ap-guangzhou（实测 actualRegions），自定义域名也被 ICP 备案拦住；
 *   - 加速区域**项目创建后不能更改**，只能删了重建；
 *   - 所以这里显式用 API 建 `Area: "overseas"` 的项目，并在部署前核对，
 *     防止「项目被误建/被改成含大陆」后我们毫无察觉地继续部署。
 */
async function ensureOverseasProject() {
  const token = process.env.EDGEONE_PAGES_API_TOKEN;
  if (!token) {
    console.log(
      '[deploy-edgeone] 未提供 EDGEONE_PAGES_API_TOKEN，跳过项目加速区域核对（沿用已有项目）',
    );
    return null;
  }
  const api = process.env.EDGEONE_PAGES_API || 'https://pages-api.cloud.tencent.com/v1';
  const call = async (action, data) => {
    const response = await fetch(api, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Action: action, ...data }),
    });
    const json = await response.json();
    const error = json?.Data?.Response?.Error;
    if (error) throw new Error(`${action} 失败：${error.Code} ${error.Message}`);
    return json?.Data?.Response ?? json?.Response ?? json;
  };

  const listed = await call('DescribePagesProjects', { PageNumber: 1, PageSize: 50 });
  let project = (listed?.Projects || []).find((item) => item.Name === PROJECT_NAME);
  if (!project) {
    const created = await call('CreatePagesProject', {
      Name: PROJECT_NAME,
      Provider: 'Upload',
      Channel: 'Custom',
      Area: PROJECT_AREA,
      Source: 'cli',
    });
    project = { Name: PROJECT_NAME, ProjectId: created.ProjectId, Area: PROJECT_AREA };
    console.log(
      `[deploy-edgeone] 已创建项目 ${PROJECT_NAME}（加速区域 ${PROJECT_AREA}，ID ${created.ProjectId}）`,
    );
  }
  if (project.Area !== PROJECT_AREA) {
    throw new Error(
      `项目 ${PROJECT_NAME} 的加速区域是 ${project.Area}` +
        `（${project.Area === 'global' ? '全球可用区（含中国大陆）' : '未知'}），` +
        `而本项目要求 ${PROJECT_AREA}（全球可用区（不含中国大陆））。` +
        '加速区域在项目创建后不能更改，请删除该项目重建，或用 EDGEONE_PROJECT_NAME 换一个项目。',
    );
  }
  console.log(`[deploy-edgeone] 项目 ${PROJECT_NAME} 加速区域 = ${project.Area}（无大陆节点）✔`);
  return project;
}

// ---------------------------------------------------------------- 3. 部署
console.log('\n=== 3/3 部署到生产环境 ===');
await ensureOverseasProject();
mkdirSync(STAGE_DIR, { recursive: true });
// CLI 判定「目录里只有 .edgeone」时会跳过本地构建，直接上传既有产物。
if (existsSync(join(STAGE_DIR, '.edgeone'))) {
  rmSync(join(STAGE_DIR, '.edgeone'), { recursive: true, force: true });
}
renameSync(EDGEONE_DIR, join(STAGE_DIR, '.edgeone'));
cpSync(join(ROOT, 'edgeone.json'), join(STAGE_DIR, 'edgeone.json'));

try {
  // 鉴权令牌只在**部署这一步**透传，不进 CLEAN_ENV_KEYS：
  // 构建子进程的 env 会被 CLI 内联进 edge 产物（已实测），
  // 把令牌放进白名单等于把令牌写进产物。
  const deployEnv = {};
  if (process.env.EDGEONE_PAGES_API_TOKEN) {
    deployEnv.EDGEONE_PAGES_API_TOKEN = process.env.EDGEONE_PAGES_API_TOKEN;
  }
  run(
    'edgeone',
    ['makers', 'deploy', '.', '-n', PROJECT_NAME, '-e', 'production', '--area', AREA, '--json'],
    {
      cwd: STAGE_DIR,
      env: deployEnv,
    },
  );
} finally {
  // 把产物挪回仓库根（保持 .edgeone/ 依旧是仓库内的构建产物）。
  if (existsSync(join(STAGE_DIR, '.edgeone'))) {
    if (existsSync(EDGEONE_DIR)) rmSync(EDGEONE_DIR, { recursive: true, force: true });
    renameSync(join(STAGE_DIR, '.edgeone'), EDGEONE_DIR);
  }
}
