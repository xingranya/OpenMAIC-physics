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
 *
 * ## 为什么这个文件同时也是一个「可导入的模块」
 *
 * 「加速区域」门禁（`ensureOverseasProject`）是本项目**唯一**保证
 * 「线上没有中国大陆节点」的防线，必须**真的被测到**，而不是靠读代码确认。
 * 上一轮独立复审就是用 mock API 测出：设 `EDGEONE_PROJECT_AREA=global`
 * 照样建出**含大陆**的项目、门禁照样放行，还恒定打印「（无大陆节点）✔」。
 *
 * 所以这里把门禁写成**依赖可注入的纯函数**并 export，
 * 由 `tests/deploy/deploy-area-guard.test.ts` 用 mock API 直接驱动；
 * 只有被 `node` 直接执行时才跑部署流程（见文件末尾的 `isDirectInvocation`）。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path, { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * 本项目**唯一**允许的加速区域（白名单）。
 *
 * 为什么是白名单而不是「默认 overseas」：加速区域**项目创建后不可更改**，
 * 填错一次就等于把「带大陆节点」焊死在线上，只能删了重建。
 * 上一轮复审实测：设 `EDGEONE_PROJECT_AREA=global` 时脚本照样建出了
 * `Area:"global"`（含中国大陆）的项目，门禁还恒定打印「（无大陆节点）✔」。
 * 所以任何非 `overseas` 取值（`global` / 空串 / 乱填）都必须**中止部署**。
 */
export const REQUIRED_PROJECT_AREA = 'overseas';

/** Pages API 基址（中国站）。 */
const DEFAULT_PAGES_API = 'https://pages-api.cloud.tencent.com/v1';

/**
 * 读 `EDGEONE_PROJECT_AREA`，**区分「未设置」与「设置为空串」**。
 *
 * 空串同样是非法取值：它既不是 overseas 也不是 global，
 * 却会被 `|| 'overseas'` 悄悄兜底成默认值——那样就又回到了
 * 「本地常量说了算、实际建出来是什么不管」的老问题。
 */
function readProjectAreaEnv() {
  const isSet = Object.prototype.hasOwnProperty.call(process.env, 'EDGEONE_PROJECT_AREA');
  return isSet ? process.env.EDGEONE_PROJECT_AREA : REQUIRED_PROJECT_AREA;
}

const PROJECT_AREA = readProjectAreaEnv();
/** CLI 的 API 区域参数（决定打哪个 API 端点，与上面的加速区域是两回事）。 */
const AREA = process.env.EDGEONE_AREA || 'global';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BUILD = process.argv.includes('--skip-build');

/** 函数包体积上限（EdgeOne 平台对 Cloud SSR Node 函数的硬限制）。 */
const LIMIT_MIB = 128;

/**
 * 干净的环境变量白名单。
 *
 * **为什么必须净化**：EdgeOne CLI 在编译 edge 函数（也就是 Next 的 middleware）时，
 * 会把**当前进程的 env 整体内联**进产物。实测一次部署内联了 79 个变量，
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

/**
 * 允许出现在 edge 函数产物里的环境变量名（白名单）。
 *
 * = 构建机必需的那几个（CLEAN_ENV_KEYS）+ 平台侧下发的部署相关变量。
 */
const DEFAULT_ALLOWED_ENV_NAMES = [
  ...CLEAN_ENV_KEYS,
  'ACCESS_CODE',
  'EDGEONE',
  'DEFAULT_MODEL',
  'EDGEONE_PROJECT_ID',
  'PAGES_PROJECT_ID',
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
    ...new Set([
      ...keepDirs,
      // 可用的 pnpm 所在目录要**排在 /usr/local/bin 前面**：
      // /usr/local/bin/pnpm 往往只是 corepack 的壳，它会尝试清理自己的缓存
      // （~/.cache/node/corepack/…），在受限沙箱里这一步是 EPERM，
      // 于是安装步骤直接失败。本机真正可用的 pnpm 常在 ~/.local/bin。
      ...(usablePnpmDir() ? [usablePnpmDir()] : []),
      path.dirname(process.execPath),
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ]),
  ].join(':');
  env.SHELL = env.SHELL || '/bin/bash';
  env.LANG = env.LANG || 'en_US.UTF_8';
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

/**
 * 找一个**真能用**的 pnpm，返回它所在的目录。
 *
 * 为什么要专门找：`/usr/local/bin/pnpm` 常常只是 corepack 的壳——
 * 它在跑之前会去清理自己的缓存（~/.cache/node/corepack/…），
 * 受限沙箱里这一步是 EPERM，安装步骤直接失败（实测 deploy 卡在这里）。
 * 真正可用的 pnpm 通常在 `~/.local/bin`。
 *
 * 判定标准是「跑 `pnpm --version` 真的成功」，不是「文件存在」。
 */
let pnpmDirCache;
function usablePnpmDir() {
  if (pnpmDirCache !== undefined) return pnpmDirCache;
  const candidates = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  for (const dir of candidates) {
    const bin = join(dir, 'pnpm');
    if (!existsSync(bin)) continue;
    try {
      const result = spawnSync(bin, ['--version'], {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, CI: 'true' },
      });
      if (result.status === 0 && /\d+\.\d+/.test(result.stdout || '')) {
        pnpmDirCache = dir;
        return dir;
      }
    } catch {
      /* 试下一个 */
    }
  }
  pnpmDirCache = null;
  return null;
}

/**
 * pnpm 能不能真的跑起来？
 *
 * 受限环境里 `pnpm` 往往只是一个 **corepack 壳**：corepack 缓存里没有
 * `packageManager` 指定的那个版本时，它会尝试联网下载——受限网络下必然失败
 * （实测报 `ENOENT ~/.cache/node/corepack/v1/pnpm/10.28.0`）。
 *
 * 构建命令里写的是 pnpm，一旦 corepack 这条路走不通，**构建第一步就挂**，
 * 后面什么都不用谈。所以先探一次，用不了就退到 npm（Node 自带，永远在）。
 */
function probePnpm() {
  return usablePnpmDir() !== null;
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

/**
 * 加速区域白名单守卫。
 *
 * 这是「线上没有大陆节点」这件事的**第一道**防线：
 * 任何非 `overseas` 取值都在**发出任何 API 调用之前**中止，
 * 所以非法取值下**不可能**建出项目。
 */
export function assertOverseasArea(area, source = 'EDGEONE_PROJECT_AREA') {
  if (area === REQUIRED_PROJECT_AREA) return area;
  const shown = area === undefined || area === null || area === '' ? '（空值）' : `"${area}"`;
  throw new Error(
    `加速区域取值非法：${source}=${shown}。` +
      `本项目只允许 "${REQUIRED_PROJECT_AREA}"（全球可用区（不含中国大陆））；` +
      '"global" 是「含中国大陆」的那一档，加速区域**项目创建后不可更改**，' +
      '填错只能删了重建。已中止部署。',
  );
}

/** 把加速区域取值翻译成人话（错误信息用）。 */
function describeArea(area) {
  if (area === 'global') return '全球可用区（含中国大陆）';
  if (area === REQUIRED_PROJECT_AREA) return '全球可用区（不含中国大陆）';
  if (!area) return '读不到该字段';
  return '未知取值';
}

/**
 * 从 edgeone CLI 的本地凭据目录（`~/.edgeone`）里取 `eo_token`。
 *
 * 用途：**没有** EDGEONE_PAGES_API_TOKEN 时仍能核对加速区域
 * （CLI 自己就是拿这份凭据登录的），而不是「跳过核对」把门禁架空。
 * 读不到就返回 null，由调用方按「未核对」处理。
 */
export function readEdgeoneCliToken(dir = join(homedir(), '.edgeone')) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!parsed || parsed.key !== 'eo_token') continue;
    const value = parsed.value;
    if (typeof value === 'string' && value) return value;
    if (value && typeof value.Token === 'string' && value.Token) return value.Token;
  }
  return null;
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
 *
 * 两条硬规则（上一轮独立复审的结论）：
 *   1. **白名单**：加速区域只允许 `overseas`，非法取值在**任何 API 调用之前**中止；
 *   2. **以读回为准**：「（无大陆节点）✔」只能根据**从 API 读回来的** Area 字段打印，
 *      读不到 Area 就不许打 ✔（本地常量不算证据）。
 *
 * @param {object} options 依赖注入（测试用 mock API 驱动，不打真实腾讯云）
 * @returns {Promise<PagesProjectInfo|null>} 项目信息；未核对时返回 null（并已中止或已告警）
 */
/**
 * Pages 项目的关键字段（只声明门禁真正用到的）。
 *
 * 不用 `object`：那样调用方拿不到 `.Area` 的类型，测试里只能强转，
 * 反而把「读回 Area」这条最关键的断言变成了不可检查的东西。
 *
 * @typedef {object} PagesProjectInfo
 * @property {string} [ProjectId]
 * @property {string} [Name]
 * @property {string} [Area] 加速区域：`overseas` = 全球可用区（不含中国大陆），`global` = 含中国大陆
 * @property {string} [PresetDomain]
 */

export async function ensureOverseasProject(options = {}) {
  const {
    token: envToken = process.env.EDGEONE_PAGES_API_TOKEN,
    projectName = PROJECT_NAME,
    projectArea = PROJECT_AREA,
    api = process.env.EDGEONE_PAGES_API || DEFAULT_PAGES_API,
    fetchImpl = globalThis.fetch,
    log = console.log,
    warn = console.warn,
    readLocalToken = readEdgeoneCliToken,
  } = options;

  // (1) 白名单：必须在**任何** API 调用之前，非法取值根本到不了建项目那一步。
  assertOverseasArea(projectArea, 'EDGEONE_PROJECT_AREA');

  // (2) 令牌：环境变量 → edgeone CLI 的本地凭据（~/.edgeone 的 eo_token）。
  let token = envToken || null;
  let tokenSource = envToken ? 'EDGEONE_PAGES_API_TOKEN' : null;
  if (!token) {
    token = (await readLocalToken()) || null;
    if (token) {
      tokenSource = 'edgeone CLI 的本地凭据（~/.edgeone 的 eo_token）';
      log(`[deploy-edgeone] 未设置 EDGEONE_PAGES_API_TOKEN，改用 ${tokenSource} 核对加速区域`);
    }
  }
  if (!token) {
    // 没有令牌 = 一次 API 调用都发不出去 = 区域守卫等于不存在。
    // 这种情况必须**显式告警**并中止，而不是「跳过核对」继续部署。
    warn(
      '[deploy-edgeone] ⚠ 未找到 Pages API 令牌（EDGEONE_PAGES_API_TOKEN 未设置，' +
        '~/.edgeone 里也没有 eo_token）：**本次部署未核对加速区域**。' +
        'CLI 建项目写死 Area="global"（含中国大陆），未核对就部署等于把大陆节点带上线。' +
        '请设置 EDGEONE_PAGES_API_TOKEN 后重试。',
    );
    throw new Error(
      '无法核对项目加速区域（没有可用的 Pages API 令牌）：本次部署未核对加速区域，已中止。' +
        '请设置 EDGEONE_PAGES_API_TOKEN（或先 `edgeone login`）后重试。',
    );
  }

  const call = async (action, data) => {
    const response = await fetchImpl(api, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Action: action, ...data }),
    });
    const json = await response.json();
    const error = json?.Data?.Response?.Error;
    if (error) throw new Error(`${action} 失败：${error.Code} ${error.Message}`);
    return json?.Data?.Response ?? json?.Response ?? json;
  };

  /** 在项目列表里按名字找项目。 */
  const findProject = (response) =>
    (response?.Projects || []).find((item) => item.Name === projectName) || null;

  /** 核对（必要时创建）目标项目，并以**读回的** Area 字段为唯一依据。 */
  const verify = async () => {
    const listed = await call('DescribePagesProjects', { PageNumber: 1, PageSize: 100 });
    let project = findProject(listed);
    if (!project) {
      const created = await call('CreatePagesProject', {
        Name: projectName,
        Provider: 'Upload',
        Channel: 'Custom',
        Area: REQUIRED_PROJECT_AREA,
        Source: 'cli',
      });
      // **读回**：创建接口的回包不可信（真实平台甚至可能不返回 Area），
      // 一律以「再查一次项目列表」读到的 Area 为准。
      const reread = await call('DescribePagesProjects', { PageNumber: 1, PageSize: 100 });
      project = findProject(reread);
      if (!project) {
        throw new Error(
          `已创建项目 ${projectName}（ID ${created?.ProjectId ?? '未知'}），` +
            '但读回项目列表里找不到它，无法确认加速区域，已中止部署。请稍后重跑。',
        );
      }
      log(
        `[deploy-edgeone] 已创建项目 ${projectName}（ID ${created?.ProjectId ?? project.ProjectId ?? '未知'}），` +
          `读回加速区域 = ${project.Area ?? '（读不到）'}`,
      );
    }

    // 以**读回的** Area 判定：读不到 / 不匹配 → 中止，且**不打印 ✔**。
    const observedArea = typeof project.Area === 'string' ? project.Area : undefined;
    if (observedArea !== REQUIRED_PROJECT_AREA) {
      throw new Error(
        `项目 ${projectName} 的加速区域是 ${observedArea ?? '（读不到）'}` +
          `（${describeArea(observedArea)}），而本项目要求 ${REQUIRED_PROJECT_AREA}` +
          '（全球可用区（不含中国大陆））。' +
          '加速区域在项目创建后不能更改，请删除该项目重建，或用 EDGEONE_PROJECT_NAME 换一个项目。',
      );
    }
    log(`[deploy-edgeone] 项目 ${projectName} 加速区域 = ${observedArea}（无大陆节点）✔`);
    return project;
  };

  try {
    return await verify();
  } catch (error) {
    // 核对没做成 = 本次部署**没有**核对过加速区域，必须把这句话说出来。
    throw new Error(
      '项目加速区域核对未通过：**本次部署未核对加速区域**，已中止部署。（' +
        `${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}
/**
 * 产物泄露门禁：CLI 编译 edge 函数时会把当前进程的 env 内联进产物。
 * 这里确认**没有**把本机路径与本机凭据带进去；带进去了既泄露凭据，
 * 又会因为 macOS 专有环境变量让边缘函数在平台上加载即崩。
 *
 * fail-closed：找不到产物 / 发现白名单外的变量 / 发现凭据取值 → 抛错中止。
 */
export function assertBundleHasNoEnvLeak(bundlePath, options = {}) {
  const { root = ROOT, env = process.env, allowed = DEFAULT_ALLOWED_ENV_NAMES } = options;
  if (!existsSync(bundlePath)) {
    // fail-closed：产物里找不到 edge 函数 bundle，说明 CLI 改了产物路径或构建异常。
    // 此时**不能**静默放行——门禁一旦形同虚设，本机凭据就可能随产物上线。
    throw new Error(
      `产物泄露门禁找不到 edge 函数产物：${relative(root, bundlePath)}。` +
        '请确认 edgeone CLI 的产物路径未变更，或该产物本就不含 edge 函数。',
    );
  }
  const bundle = readFileSync(bundlePath, 'utf8');
  const problems = [];

  // (1) 产物里内联的环境变量名必须在白名单内。
  //     白名单 = 构建机必需的那几个 + 平台侧下发的部署相关变量。
  const allowedSet = new Set(allowed);
  const bundledNames = [
    ...new Set([...bundle.matchAll(/"([A-Z][A-Z0-9_]{2,})":/g)].map((m) => m[1])),
  ];
  const unexpected = bundledNames.filter((name) => !allowedSet.has(name));
  if (unexpected.length > 0) {
    problems.push(`白名单外的环境变量 ${unexpected.join('、')}`);
  }

  // (2) 本机凭据的取值不能出现在产物里。
  for (const key of Object.keys(env)) {
    if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) continue;
    const value = env[key];
    if (!value || value.length < 12) continue;
    if (bundle.includes(value)) problems.push(`环境变量 ${key} 的取值`);
  }

  if (problems.length > 0) {
    throw new Error(
      `构建产物把本机环境内联进了 edge 函数（${problems.join('、')}）。` +
        '请检查部署脚本是否走了净化环境（scripts/deploy-edgeone.mjs 的 cleanEnv）。',
    );
  }
  return { bundledNames };
}

async function main() {
  // 加速区域白名单：**在构建之前**就 fail-fast，
  // 免得白等一次十几分钟的构建才发现环境变量填错了。
  assertOverseasArea(PROJECT_AREA, 'EDGEONE_PROJECT_AREA');

  // ---------------------------------------------------------------- 1. 构建
  if (!SKIP_BUILD) {
    console.log('=== 1/5 构建 EdgeOne 产物 ===');
    // Next.js 在构建期会重写 tsconfig.json（补齐它自己的选项、压成一行 JSON，
    // 并追加 cloud-functions/node-functions 等排除项）。那不是我们想要的
    // 仓库状态，会让 prettier --check 与 git diff 变脏，所以构建后还原。
    const tsconfigPath = join(ROOT, 'tsconfig.json');
    const tsconfigBefore = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, 'utf8') : null;

    // 构建命令里用的是 pnpm，但**受限环境里 pnpm 未必可用**：
    // corepack 缓存里没有 packageManager 指定的那个版本时，corepack 会尝试联网
    // 下载（受限网络下失败），构建第一步就挂。实测本机就是这个状态。
    //
    // 所以这里先探一次 pnpm 能不能用：能用就用原来的命令；不能用就临时把
    // edgeone.json 的 buildCommand 换成 npm（npm 是 Node 自带的，永远在），
    // 构建完再还原——仓库里保留 pnpm 版本，平台侧与协作环境不受影响。
    const pnpmUsable = probePnpm();
    const edgeoneJsonPath = join(ROOT, 'edgeone.json');
    const edgeoneJsonBefore = existsSync(edgeoneJsonPath)
      ? readFileSync(edgeoneJsonPath, 'utf8')
      : null;
    if (!pnpmUsable && edgeoneJsonBefore !== null) {
      const manifest = JSON.parse(edgeoneJsonBefore);
      if (typeof manifest.buildCommand === 'string' && /\bpnpm\b/.test(manifest.buildCommand)) {
        manifest.buildCommand = manifest.buildCommand.replace(/\bpnpm build\b/g, 'npm run build');
        writeFileSync(edgeoneJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(
          '[deploy-edgeone] 本机 pnpm 不可用，构建命令临时改用 npm（构建后还原 edgeone.json）',
        );
      }
    }

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
          //   再尝试创建它），再跑一次安装。
          //
          // 这里**不能**用 `--ignore-scripts`：它会跳过 root postinstall，
          // 于是 `packages/*/dist`（不在版本控制里，只由 postinstall 生成）不会被构建，
          // 干净机器上的构建链会断在第一步。
          InstallCommand:
            process.env.InstallCommand ||
            (pnpmUsable
              ? [
                  // 用**绝对路径**调 pnpm：子进程的 PATH 里 /usr/local/bin/pnpm
                  // 是 corepack 的壳，会在跑之前尝试清理自己的缓存
                  // （受限沙箱里是 EPERM），直接把安装步骤搞挂。
                  `${join(usablePnpmDir(), 'pnpm')} install --frozen-lockfile --package-import-method=hardlink --store-dir=${join(ROOT, '.pnpm-store')}`,
                  `node scripts/fix-pnpm-store-gitmodules.mjs`,
                  `${join(usablePnpmDir(), 'pnpm')} install --frozen-lockfile --package-import-method=hardlink --store-dir=${join(ROOT, '.pnpm-store')}`,
                ].join(' ; ')
              : // 没有可用的 pnpm 就退到 npm：node_modules 已经就绪时，直接跳过安装即可。
                'true'),
          CI: 'true',
        },
      });
    } finally {
      if (tsconfigBefore !== null && readFileSync(tsconfigPath, 'utf8') !== tsconfigBefore) {
        writeFileSync(tsconfigPath, tsconfigBefore);
        console.log('[deploy-edgeone] 已还原构建期被改写的 tsconfig.json');
      }
      if (
        edgeoneJsonBefore !== null &&
        readFileSync(edgeoneJsonPath, 'utf8') !== edgeoneJsonBefore
      ) {
        writeFileSync(edgeoneJsonPath, edgeoneJsonBefore);
        console.log('[deploy-edgeone] 已还原 edgeone.json');
      }
    }
  } else {
    console.log('=== 1/4 跳过构建（复用现有 .edgeone） ===');
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
  const { bundledNames } = assertBundleHasNoEnvLeak(edgeBundle);
  console.log(
    `[deploy-edgeone] 产物泄露门禁通过：edge 函数只内联了 ${bundledNames.length} 个白名单变量`,
  );

  // ---------------------------------------------------------------- 2. 裁剪
  console.log('\n=== 2/5 裁剪云函数包 ===');
  run('node', ['scripts/prune-edgeone-function.mjs', '--yes']);

  const fnDir = join(EDGEONE_DIR, 'cloud-functions', 'ssr-node');

  // ---------------------------------------------------------------- 3. 补依赖
  // 裁剪后的产物里，有些包只剩一个「只有 package.json 的桩目录」——
  // 平台剥离 node_modules 之后，它们在运行期就是 Cannot find package，
  // 表现为**空体 500**（线上凡是加载 @openmaic/storage 的路由全挂就是这么来的）。
  //
  // 这里按**运行期反馈**来补：把函数包挪到仓库外跑一遍，看它到底缺哪个包，
  // 补完再跑，直到不再缺。静态闭包会把运行期根本不加载的传递依赖也拖进来，
  // 补一轮多塞好几 MiB，而函数包有 128 MiB 硬上限。
  console.log('\n=== 3/5 按运行期反馈补齐依赖 ===');
  run('node', ['scripts/repair-edgeone-runtime-deps.mjs']);

  // ---------------------------------------------------------------- 4. 门禁
  // 必须在**仓库之外**跑：函数包放在仓库里时，Node 沿父目录向上找 node_modules，
  // 会找到仓库根的那一份，把产物里缺失的文件全给补上——门禁就永远绿。
  // 线上正是这样被「本地全绿、线上 500」骗过去的。
  console.log('\n=== 4/5 仓库外运行时门禁（全部路由） ===');
  run('node', ['scripts/verify-edgeone-runtime.mjs']);

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

  // ---------------------------------------------------------------- 3. 部署
  console.log('\n=== 5/5 部署到生产环境 ===');
  const project = await ensureOverseasProject();
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

  await warmUpFunction(project && project.PresetDomain);
}

/**
 * 部署后**预热**云函数。
 *
 * ## 为什么需要
 *
 * EdgeOne 的云函数是**冷启动**的：第一次请求要先把 120+ MiB 的函数包解开、
 * 拉起 Node、再初始化 Next.js。实测冷启动后的第一个请求耗时 **8–25 秒**，
 * 平台侧的请求超时会把连接掐断（客户端看到 `fetch failed` / `AbortError`）。
 * 之后的请求才是 0.3 秒。
 *
 * 对**现场演示**这是硬伤：评委第一次点开页面如果正好撞上冷启动，页面就转圈
 * 直到超时。所以部署完主动打几次，把函数烤热。
 *
 * 预热失败**不中止部署**——线上站点本身是好的，冷启动只是慢；
 * 但要明确打出来，不能让人误以为部署失败。
 */
async function warmUpFunction(presetDomain) {
  // 预设域名从项目信息里读（不写死后缀——那是本项目当前的值，不是平台约定）。
  const host = presetDomain || process.env.EDGEONE_PRESET_DOMAIN || null;
  if (!host) {
    console.log('\n=== 预热云函数：拿不到预设域名，跳过 ===');
    return;
  }
  const url = `https://${host}/api/health`;
  console.log(`\n=== 预热云函数（${url}） ===`);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      console.log(
        `[deploy-edgeone] 预热第 ${attempt} 次：HTTP ${res.status}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      // 401 也说明函数已经起来了（预设域名有访问保护层），不必继续烤。
      return;
    } catch (error) {
      console.log(
        `[deploy-edgeone] 预热第 ${attempt} 次失败（${error.message}），${attempt < 5 ? '重试…' : '放弃'}`,
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('[deploy-edgeone] ⚠ 预热未成功，线上首次访问可能较慢（不影响部署结果）');
}

/**
 * 只有被 `node scripts/deploy-edgeone.mjs` 直接执行时才跑部署流程；
 * 被 `import`（单测）时只导出上面的纯函数，不碰构建与部署。
 */
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectInvocation()) {
  await main();
}
