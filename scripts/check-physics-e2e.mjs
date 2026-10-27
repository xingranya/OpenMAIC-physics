#!/usr/bin/env node
/**
 * 物理 AI 智慧课堂 —— 端到端自检（不依赖浏览器二进制）。
 *
 * 为什么需要它：说明书里那些"只有跑起来才暴露"的缺陷，有两个共同特征——
 * 页面文字完全正常，但功能是哑的。构建日志、单元测试都看不出来。
 * 这个脚本把这些结论固化成**任何环境都能复现**的检查：
 *
 *   1. 关键路由可达，且首帧是「水合安全」的形态（与服务端一致）；
 *   2. 页面引用的**每一个客户端 chunk 都返回 200**——
 *      chunk 500 会让 React 整站不水合，表现就是"文字正常、按钮全哑"；
 *   3. **会话门禁**真的拦得住未登录的高耗能接口调用；
 *   4. 未配置模型时 provider 为空、生成路径优雅降级；
 *   5. **服务返回的 BUILD_ID 与目标产物一致**——
 *      重建产物后若忘了重启服务，旧进程会按旧 BUILD_ID 返回 HTML，
 *      而客户端 chunk 的文件名是**内容哈希**（源码没变 → 哈希没变 → 旧 chunk
 *      仍在磁盘），所以"chunk 全 200"这一项在过期进程上依然会通过，
 *      查不出问题。只有比对 BUILD_ID 才能识别过期进程。
 *
 * 用法：
 *   node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3000
 *   node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3000 \
 *   node scripts/check-physics-e2e.mjs --base-url https://your.site \
 *        --expect-build-id <id>           # 线上部署：显式声明期望的 BUILD_ID
 *   node scripts/check-physics-e2e.mjs --base-url https://xxx.edgeone.cool \
 *        --site-query "eo_token=...&eo_time=..." \
 *        --site-query "eo_token=...&eo_time=..."   # EdgeOne 预设域名：带平台令牌
 *
 * 退出码：全部通过为 0，存在失败项为 1。
 */

import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeCheckFailure, guardCheck, toFailureRecord } from './e2e-resilience-lib.mjs';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const BASE_URL = argValue('--base-url', 'http://127.0.0.1:3000').replace(/\/$/, '');
/**
 * 会话 Cookie 名。**三处必须一致**：客户端下发（lib/physics/account-store.ts）、
 * 中间件（middleware.ts）、云函数入口（scripts/prune-edgeone-function.mjs）。
 * 由 `tests/deploy/session-gate-contract.test.ts` 盯着。
 */
const SESSION_COOKIE_NAME = 'physics_session';
const TIMEOUT_MS = 15_000;
/** 仓库根目录（本脚本按仓库根运行）。 */
const ROOT = process.cwd();

/**
 * 期望的 BUILD_ID。
 *
 * 优先级：命令行 `--expect-build-id` > 本地 `.next/BUILD_ID`（存在时）。
 * 两者都没有就跳过这项检查（线上部署且未声明时）。
 */
function resolveExpectedBuildId() {
  const explicit = argValue('--expect-build-id', '').trim();
  if (explicit) return { buildId: explicit, source: '--expect-build-id' };

  try {
    const local = join(process.cwd(), '.next', 'BUILD_ID');
    if (existsSync(local)) {
      const value = readFileSync(local, 'utf-8').trim();
      if (value) return { buildId: value, source: '.next/BUILD_ID' };
    }
  } catch {
    // 读不到就当作"没有期望值"，跳过这项检查。
  }
  return { buildId: '', source: '' };
}

/**
 * 关键路由：每条都要返回 200，且首帧与服务端一致。
 *
 * 顺序与侧栏导航一致（学生 11 个视图 → 教师 8 个视图 + 首页/登录 = 21 条）。
 * 三诊（课前/课中/课后）与「质量核验」都在这里，是因为它们各自对应申请书里
 * 一个必须能被点开的功能点——路由可达是「功能可用」的最低门槛。
 */
const ROUTES = [
  { path: '/', label: '首页 · 物理学习门户' },
  { path: '/login', label: '登录页' },
  { path: '/physics/overview', label: '学生端 · 学习总览' },
  { path: '/physics/diagnosis', label: '学生端 · 学情诊断' },
  { path: '/physics/preclass', label: '学生端 · 课前诊断与配对' },
  { path: '/physics/inclass', label: '学生端 · 课中伴随诊断' },
  { path: '/physics/postclass', label: '学生端 · 课后过程评价' },
  { path: '/physics/curriculum', label: '学生端 · 章节与知识图谱' },
  { path: '/physics/projects', label: '学生端 · 项目匹配' },
  { path: '/physics/tasks', label: '学生端 · 任务闯关' },
  { path: '/physics/assistant', label: '学生端 · AI 助教' },
  { path: '/physics/lab', label: '学生端 · 虚拟实验' },
  { path: '/physics/report', label: '学生端 · 学习报告' },
  { path: '/teacher/dashboard', label: '教师端 · 教学驾驶舱' },
  { path: '/teacher/class', label: '教师端 · 班级画像' },
  { path: '/teacher/curriculum', label: '教师端 · 课程项目矩阵' },
  { path: '/teacher/reviews', label: '教师端 · 三诊审核' },
  { path: '/teacher/scores', label: '教师端 · 成绩登记总表' },
  { path: '/teacher/verify', label: '教师端 · 质量核验' },
  { path: '/teacher/evaluation', label: '教师端 · 评价复核' },
  { path: '/teacher/insights', label: '教师端 · 教学洞察' },
];

/** 期望出现在 SSR HTML 里的校级标记。 */
const BRAND_MARKERS = ['长江大学文理学院', '大学物理'];

/** 期望出现在工作台首帧里的水合安全标记（由 state-provider 的 hydrated 门禁产出）。 */
const WORKBENCH_MARKER = '正在加载工作台';

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  process.stdout.write(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/**
 * 把多份 Cookie 头按 **cookie 名**合并去重（同名保留先出现的）。
 *
 * EdgeOne 预设域名有一层 Cookie：平台保护层下发的 eo_token / eo_time。
 * 两层都要带，缺任何一层都会被对应的保护层拦成 401。
 * 之前调用点显式传 `headers: { Cookie: xxx }` 会把平台那层**顶掉**，
 * 于是「已登录可用」被误判成「站点不可达」，甚至在解析平台 401 的 HTML 时崩栈。
 */
function mergeCookies(...sources) {
  const seen = new Map();
  for (const source of sources) {
    if (!source) continue;
    for (const part of String(source).split(';')) {
      const piece = part.trim();
      if (!piece) continue;
      const eq = piece.indexOf('=');
      const name = eq === -1 ? piece : piece.slice(0, eq);
      if (!seen.has(name)) seen.set(name, piece);
    }
  }
  return [...seen.values()].join('; ');
}

/**
 * 安全读取 JSON。
 *
 * 平台保护层拦下来的响应是 **HTML**（401 页面），`response.json()` 会抛
 * SyntaxError 让整个自检脚本带着未捕获的 Promise rejection 崩掉，后续检查一项都跑不了。
 * 这里统一容错：解析失败返回 null，由调用方按「状态码不对」记录失败。
 */
async function readJson(response) {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * EdgeOne 预设域名（*.edgeone.cool）默认带**平台级**访问保护：没有带
 * `eo_token` 的请求会拿到平台自己的 401 页面（不是应用的 401）。
 * 带令牌的第一次访问会由平台下发一枚 HttpOnly Cookie，后续请求带上它即可。
 * 绑定自定义域名后不需要这一层，SITE_QUERY 留空即可。
 */
const SITE_QUERY = argValue('--site-query', '');

/** 平台下发的 Cookie（EdgeOne 预设域名保护层）。 */
let siteCookie = '';

/** 合并两层 Cookie。 */
function cookieHeader() {
  return siteCookie;
}

/** 用带 eo_token 的链接换取平台 Cookie。 */
async function acquireSiteAccess() {
  if (!SITE_QUERY) return;
  // 平台把访问 Cookie 下在 **302 响应** 上，所以必须手动跟随一次跳转：
  // 用 redirect:'follow' 只能看到最后一跳的响应头，会漏掉 Set-Cookie。
  // 连接层失败要重试（见 fetchWithTimeout 的注释）：这一跳是整套自检的前提，
  // 一次网络抖动不该让整个自检崩掉。
  let first = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      first = await fetch(`${BASE_URL}/?${SITE_QUERY}`, { redirect: 'manual' });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  if (!first) throw lastError;
  const setCookies =
    typeof first.headers.getSetCookie === 'function' ? first.headers.getSetCookie() : [];
  const pairs = setCookies.map((cookie) => cookie.split(';')[0]).filter(Boolean);
  siteCookie = pairs.join('; ');
  process.stdout.write(
    siteCookie
      ? `已取得 EdgeOne 预设域名访问 Cookie（${pairs.length} 项）\n`
      : '警告：带 eo_token 访问未取得平台 Cookie，后续请求可能被平台 401\n',
  );
}

/**
 * 带超时的请求，**并且对连接层失败做重试**。
 *
 * ## 为什么需要重试
 *
 * 自检会连打几十个请求，而这台机器到 EdgeOne 海外边缘的连接**是间歇性失败的**：
 * 实测同一时刻 curl 能连上（TCP 握手 1ms），Node 的 fetch 却有相当高的概率报
 * `UND_ERR_CONNECT_TIMEOUT`（10s 连接超时）。
 * 那是**本机网络**的问题，不是站点的问题——但自检是门禁，门禁要测的是站点。
 *
 * 所以这里只对**连接层**失败（fetch 直接 reject）重试，带退避；
 * HTTP 层的任何状态码（含 4xx/5xx）都**不重试**——那是站点自己的答案，
 * 重试只会把真实故障糊过去。
 *
 * ## 为什么默认重试次数是 5
 *
 * 设单次连接失败概率为 p，重试 n 次后「全败」的概率是 pⁿ。单次 p≈0.2 时：
 * 3 次 → 0.8%，一轮自检几十个请求累计下来「至少有一处全败」的概率接近三成；
 * 5 次 → 0.03%，累计约百分之二。**门禁不能因为本机抖动而误报站点故障**，
 * 所以按累计概率选次数，而不是按单次概率拍脑袋。
 */
async function fetchWithTimeout(path, init = {}, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // 用 Headers 实例统一承载请求头：既能正确读取调用方传入的 Headers，
      // 也避免 `{ ...init.headers }` 展开 Headers 实例得到空对象的问题。
      const headers = new Headers(init.headers || {});
      // 会话门禁开启时，未登录请求会被拦成 401。
      // 取到会话 Cookie 之后的每一次请求都必须带上它，否则页面路由全 401，
      // 自检会把「已登录可用」误判成「站点不可达」。
      // **平台 Cookie 与应用 Cookie 必须合并**：调用方显式传了 Cookie 也不能把平台那层丢掉。
      const combined = mergeCookies(headers.get('cookie'), cookieHeader());
      if (combined) headers.set('cookie', combined);
      return await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function collectChunkPaths(html) {
  const paths = new Set();
  const pattern = /\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/g;
  let match = pattern.exec(html);
  while (match) {
    paths.add(match[0]);
    match = pattern.exec(html);
  }
  return [...paths];
}

async function checkRoutes() {
  for (const route of ROUTES) {
    try {
      const response = await fetchWithTimeout(route.path);
      const html = await response.text();
      const missing = BRAND_MARKERS.filter((marker) => !html.includes(marker));
      const isWorkbench = route.path.startsWith('/physics/') || route.path.startsWith('/teacher/');
      if (isWorkbench && !html.includes(WORKBENCH_MARKER)) missing.push(WORKBENCH_MARKER);
      if (response.status !== 200) {
        record(`路由可达 · ${route.label}`, false, `HTTP ${response.status}`);
        continue;
      }
      if (missing.length > 0) {
        record(`路由可达 · ${route.label}`, false, `首帧缺少标记：${missing.join('、')}`);
        continue;
      }
      record(`路由可达 · ${route.label}`, true, 'HTTP 200，首帧含校名与水合安全标记');
    } catch (error) {
      record(`路由可达 · ${route.label}`, false, String(error));
    }
  }
}

async function checkChunks() {
  const chunkPaths = new Set();
  for (const route of ROUTES) {
    try {
      const response = await fetchWithTimeout(route.path);
      const html = await response.text();
      for (const path of collectChunkPaths(html)) chunkPaths.add(path);
    } catch {
      /* 路由已单独记录失败，这里不重复 */
    }
  }
  if (chunkPaths.size === 0) {
    record('客户端 chunk 全部 200', false, '未能从任何页面解析到 chunk 引用');
    return;
  }
  const broken = [];
  for (const path of chunkPaths) {
    try {
      // chunk 扫描是**几十个连续请求**，连接层重试必须够狠：单次连接失败率
      // 约五分之一，3 次全败的概率 0.2³ ≈ 0.8%，42 个 chunk 连打下来
      // 「至少有一个全败」的概率接近三成——那会把网络抖动报成站点故障。
      // 默认的 5 次重试（0.2⁵ ≈ 0.03%）就是按这个累计概率定的；
      // 而 HTTP 层的任何状态码仍然**不重试**：那是站点自己的答案，
      // 重试只会把真实故障糊过去。
      const response = await fetchWithTimeout(path);
      if (response.status !== 200) broken.push(`${path} → ${response.status}`);
    } catch (error) {
      broken.push(`${path} → ${String(error)}`);
    }
  }
  record(
    '客户端 chunk 全部 200',
    broken.length === 0,
    broken.length === 0
      ? `${chunkPaths.size} 个 chunk 全部 200（chunk 非 200 会导致 React 不水合）`
      : `异常 ${broken.length} 个：${broken.slice(0, 5).join('；')}`,
  );
  checkDocChunkCount(chunkPaths.size);
}

/**
 * 材料里自引的 chunk 数必须与实测一致。
 *
 * 第四轮独立复审发现：说明书里写着「51 个客户端 chunk 全部 200」，
 * 而用本脚本实测是 49 —— 数字漂了但没人管。行数与用例数已经有门禁盯着，
 * chunk 数同样要有一处能自证的地方。
 *
 * 第五轮复审补充：只查说明书会漏掉**部署手册**（那里也引用了同一个数字，
 * 且一度与说明书不一致）。所以两处都要查，且都要是同一个数。
 *
 * 注意 chunk 数随前端改动而变（新增/删除 chunk 都会动它），所以这是
 * "必须同步文档"的提醒项，而不是"必须等于某个常量"的断言。
 */
const CHUNK_COUNT_DOCS = [
  { label: '说明书', path: join(ROOT, 'docs', '参赛', '作品说明书.md') },
  { label: '部署手册', path: join(ROOT, 'deploy', 'README.md') },
  // 答辩预案也要查：第十三轮独立复审发现它写的是 49，而说明书与部署手册
  // 都是 42、实测也是 42——而答辩预案恰恰是评委**最可能当场追问**的一处。
  { label: '答辩预案', path: join(ROOT, 'docs', '参赛', '答辩预案.md') },
];

function checkDocChunkCount(actual) {
  for (const doc of CHUNK_COUNT_DOCS) {
    let source;
    try {
      source = readFileSync(doc.path, 'utf8');
    } catch {
      record(`${doc.label}自引 chunk 数`, true, `找不到${doc.label}，跳过`);
      continue;
    }
    // 取第一个出现的数字；同一份文档里若出现多个不同数字，下面会一并报出。
    // 两种措辞都要认：「N 个客户端 chunk 全部 200」与「本次 N 个」——
    // 第六轮复审发现部署手册里后者仍写着 51，前一种正则看不见它。
    //
    // **加粗形态也必须认**：说明书里有一处写的是「42 个客户端 chunk **全部 200**」，
    // 原正则只匹配不加粗的写法，于是那一处是**盲区**——真把它改成别的数字，
    // 门禁照样全绿。`\**` 同时匹配「无标记」与「**…**」两种形态。
    const matches = [
      ...source.matchAll(/(\d+)\s*个客户端 chunk\s*\**\s*全部 200/g),
      // 「本次 N 个」必须带 chunk 上下文，否则「本次 3 个步骤」这类句子会被误判。
      ...source.matchAll(/本次\s*(\d+)\s*个(?:客户端)?\s*chunk/g),
    ];
    if (matches.length === 0) {
      record(
        `${doc.label}自引 chunk 数`,
        false,
        `${doc.label}里找不到「N 个客户端 chunk 全部 200」`,
      );
      continue;
    }
    const declared = Number(matches[0][1]);
    const drifted = matches.map((m) => Number(m[1])).filter((n) => n !== declared);
    const consistent = drifted.length === 0;
    record(
      `${doc.label}自引 chunk 数`,
      declared === actual && consistent,
      declared === actual && consistent
        ? `${doc.label} ${declared} 个 / 实测 ${actual} 个，一致`
        : `${doc.label}写 ${declared} 个${
            consistent ? '' : `（同文另有 ${drifted.join(' / ')} 个）`
          }，实测 ${actual} 个（请同步${doc.label}）`,
    );
  }
}

/**
 * 会话门禁：高耗能接口必须已登录。
 *
 * 站点不再有访问码——入口换成账号系统（注册 + 登录）。
 * 门禁只守在**会消耗模型额度或上游资源**的接口前面，
 * 由云函数入口的 `createSessionGate` 强制
 * （见 `scripts/prune-edgeone-function.mjs`）。
 *
 * 这里验四件事：
 * 1. 未登录调用高耗能接口 → 401（门禁真的在生效）；
 * 2. 带会话 Cookie → 不再是 401（不是把所有人都拒了）；
 * 3. 带会话**请求头**（`x-physics-session`）→ 也不再是 401
 *    （平台转发层读不出 Cookie 时的第二条通道）；
 * 4. 不消耗外部资源的接口不拦（否则「断网也能演示」这类承诺会失效）。
 */
async function checkSessionGate() {
  const gated = await fetchWithTimeout('/api/chat');
  if (gated.status !== 401) {
    record(
      '会话门禁 · 未登录调用高耗能接口被拦截',
      false,
      `GET /api/chat 期望 401，实际 ${gated.status}`,
    );
  } else {
    record('会话门禁 · 未登录调用高耗能接口被拦截', true, 'GET /api/chat → 401');
  }

  // 带一个形状合法的会话 Cookie。**门禁只验形状**（强度如实写在线上材料里），
  // 所以这里造一个即可——它验的是「门禁认这个 Cookie」，不是「这个人是谁」。
  const cookie = `${SESSION_COOKIE_NAME}=probe-session.${Date.now()}`;
  const withSession = await fetchWithTimeout('/api/chat', { headers: { Cookie: cookie } });
  if (withSession.status === 401) {
    // 失败时把函数入口回报的「实际到达的请求头名」打出来：
    // 没有这条信息，就只能靠猜是「平台没转发 Cookie」还是「判定写错了」——
    // 本项目已经在这上面误判过一次（真因是生成器的正则被字符串转义吃掉了）。
    record(
      '会话门禁 · 带会话后放行',
      false,
      `带会话 Cookie 仍然 401 —— 门禁把已登录也一起拒了（到达的请求头：${
        withSession.headers.get('x-session-gate-headers') ?? '未回报'
      }）`,
    );
  } else {
    record('会话门禁 · 带会话后放行', true, `带会话 Cookie → ${withSession.status}（不再是 401）`);
  }

  // 第二条通道：请求头。平台转发层若读不出 Cookie，这条必须仍然放行。
  const withHeader = await fetchWithTimeout('/api/chat', {
    headers: { 'x-physics-session': `probe-session.${Date.now()}` },
  });
  if (withHeader.status === 401) {
    record(
      '会话门禁 · 带会话请求头也放行',
      false,
      `带 x-physics-session 仍然 401 —— 第二条通道没接上（到达的请求头：${
        withHeader.headers.get('x-session-gate-headers') ?? '未回报'
      }）`,
    );
  } else {
    record('会话门禁 · 带会话请求头也放行', true, `带 x-physics-session → ${withHeader.status}`);
  }

  // 不消耗外部资源的接口不该拦。
  const open = await fetchWithTimeout('/api/health');
  if (open.status === 401) {
    record('会话门禁 · 非高耗能接口不拦', false, 'GET /api/health 被 401 拦下 —— 匿名访问本该放行');
  } else {
    record('会话门禁 · 非高耗能接口不拦', true, `GET /api/health → ${open.status}`);
  }
}

async function checkProviderDegradation() {
  // provider 列表不消耗外部资源，不受会话门禁保护；匿名也应能查到。
  const response = await fetchWithTimeout('/api/server-providers');
  const json = await readJson(response);
  if (response.status !== 200 || !json?.success) {
    record(
      '模型供给可查询（降级前提）',
      false,
      `HTTP ${response.status}${json ? '' : '（响应非 JSON）'}`,
    );
    return;
  }
  const providerCount = Object.keys(json.providers ?? {}).length;
  record(
    '模型供给可查询（降级前提）',
    true,
    providerCount === 0
      ? '未配置任何模型 Key：生成路径应优雅降级，物理工作台与预置包不受影响'
      : `已配置 ${providerCount} 个 provider`,
  );
}

/**
 * 校验服务返回的 BUILD_ID 与目标产物一致。
 *
 * 这一项专门用来抓「重建了产物却没重启服务」：旧进程按旧 BUILD_ID 返回 HTML，
 * 而 chunk 文件名是内容哈希，源码没变就仍然存在磁盘上——所以"chunk 全 200"
 * 在过期进程上照样通过。只有比对 BUILD_ID 才能识别。
 */
async function checkBuildId() {
  const expected = resolveExpectedBuildId();
  if (!expected.buildId) {
    record('BUILD_ID 与目标产物一致', true, '未提供期望值（本地无 .next/BUILD_ID），跳过');
    return;
  }
  try {
    const response = await fetchWithTimeout('/');
    const html = await response.text();
    if (html.includes(expected.buildId)) {
      record(
        'BUILD_ID 与目标产物一致',
        true,
        `服务返回 ${expected.buildId}（期望值来自 ${expected.source}）`,
      );
      return;
    }
    const served = /\\?"b\\?":\\?"([A-Za-z0-9_-]+)/.exec(html)?.[1];
    record(
      'BUILD_ID 与目标产物一致',
      false,
      `服务返回的 BUILD_ID 是 ${served ?? '（未识别）'}，期望 ${expected.buildId}` +
        `（来自 ${expected.source}）。多半是重建产物后没有重启服务进程。`,
    );
  } catch (error) {
    record('BUILD_ID 与目标产物一致', false, String(error));
  }
}

/**
 * 汇总结果并决定退出码。
 *
 * 单独抽出来，是因为「检查全部跑完」和「检查中途抛了」两条路径都要用它——
 * 否则中途抛了就会只留一屏栈信息、连「一共几项、过了几项」都看不到。
 */
function summarize() {
  const failed = results.filter((item) => !item.ok);
  process.stdout.write(
    `\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}\n`,
  );
  if (failed.length > 0) {
    process.stdout.write('失败项：\n');
    failed.forEach((item) => process.stdout.write(`  - ${item.name}：${item.detail ?? ''}\n`));
    process.exitCode = 1;
  }
}

async function main() {
  process.stdout.write(`物理 AI 智慧课堂 · 端到端自检\n目标：${BASE_URL}\n\n`);
  await acquireSiteAccess();
  try {
    // 门禁开启时首页会返回 401（这是预期行为，不是「站点不可达」）。
    // /api/health 在 middleware 的门禁白名单里，用它判定站点是否真的活着。
    let probe = await fetchWithTimeout('/api/health');
    if (!probe.ok) {
      const fallback = await fetchWithTimeout('/');
      if (!fallback.ok && fallback.status !== 401) {
        throw new Error(`目标站点不可达（HTTP ${fallback.status}）`);
      }
    }
  } catch (error) {
    // 连接层失败要分开说：TLS 证书问题（自定义域名最常见——**域名绑定成功 +
    // DNS 生效 ≠ 证书已签发**，边缘此时下发的是共享 CDN 证书）会被 fetch
    // 报成 `fetch failed`，笼统说「目标站点不可达」会让人往站点本身查，
    // 而真正要修的是证书。
    const text = String(error);
    const isTls = /certificate|TLS|SSL|CERT_/i.test(text) || /fetch failed/.test(text);
    // 用 record() 而不是直接 write：**这条要进账**，否则末尾的总数会显示
    // 「失败 0」而退出码是 1，自相矛盾（独立复审 F9）。
    record('目标站点不可达', false, text);
    if (isTls) {
      process.stdout.write(
        '  提示：若是自定义域名，先查 TLS 证书是否已为该域名签发——' +
          '「域名绑定成功 + DNS 生效」不等于「证书已签发」，' +
          '证书没签发时边缘会下发共享的 CDN 证书，浏览器会报证书错误。\n' +
          '  核验：echo | openssl s_client -connect <域名>:443 -servername <域名> 2>/dev/null ' +
          '| openssl x509 -noout -subject   （CN/SAN 里必须有该域名）\n',
      );
    }
    process.exitCode = 1;
    // 这条早退路径也要出总数：否则报告里只有一句「不可达」，
    // 看不到「一共该跑多少项、跑了多少项」——判读成本反而更高
    // （独立复审 F9）。
    summarize();
    return;
  }

  // 每项检查**独立兜底**：一项挂了（多半是本机网络抖动）只记一条 FAIL，
  // 后面的检查照跑。这样一轮自检要么给出完整结论，要么给出「哪一项连不上」，
  // 而不是变成一屏 Node 栈信息。
  await guardCheck('会话门禁', checkSessionGate, record);
  await guardCheck('关键路由可达', checkRoutes, record);
  await guardCheck('客户端 chunk 全部 200', checkChunks, record);
  await guardCheck('BUILD_ID 与目标产物一致', checkBuildId, record);
  await guardCheck('模型未配置时优雅降级', checkProviderDegradation, record);

  summarize();
}

// 顶层兜底：**绝不让异常以未捕获 rejection 的形式收场**。
// 那种收场方式只留一屏 Node 栈信息，看不出「是本机网络还是站点」，
// 判读成本远高于一条结构化的 FAIL。
try {
  await main();
} catch (error) {
  const failure = toFailureRecord('自检整体执行', error);
  record(failure.name, failure.ok, failure.detail);
  process.stdout.write(
    '  提示：连接层失败通常是**本机到 EdgeOne 海外边缘**的网络抖动，不是站点故障。\n' +
      `  另起一条命令复现：curl -s -o /dev/null -w '%{http_code}\\n' ${BASE_URL}/api/health\n`,
  );
  summarize();
}
