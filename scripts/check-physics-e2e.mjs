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
 *   3. `ACCESS_CODE` 门禁真的拦得住未授权访问；
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
 *        --access-code your-code          # 同时验证口令门禁
 *   node scripts/check-physics-e2e.mjs --base-url https://your.site \
 *        --expect-build-id <id>           # 线上部署：显式声明期望的 BUILD_ID
 *   node scripts/check-physics-e2e.mjs --base-url https://xxx.edgeone.cool \
 *        --site-query "eo_token=...&eo_time=..." \
 *        --access-code your-code          # EdgeOne 预设域名：带平台令牌 + 访问码
 *
 * 退出码：全部通过为 0，存在失败项为 1。
 */

import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const BASE_URL = argValue('--base-url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const ACCESS_CODE = argValue('--access-code', '');
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

/** 关键路由：每条都要返回 200，且首帧与服务端一致。 */
const ROUTES = [
  { path: '/', label: '首页 · 物理学习门户' },
  { path: '/login', label: '登录页' },
  { path: '/physics/overview', label: '学生端 · 学习总览' },
  { path: '/physics/diagnosis', label: '学生端 · 学情诊断' },
  { path: '/physics/curriculum', label: '学生端 · 章节与知识图谱' },
  { path: '/physics/projects', label: '学生端 · 项目匹配' },
  { path: '/physics/tasks', label: '学生端 · 任务闯关' },
  { path: '/physics/assistant', label: '学生端 · AI 助教' },
  { path: '/physics/lab', label: '学生端 · 虚拟实验' },
  { path: '/physics/report', label: '学生端 · 学习报告' },
  { path: '/teacher/dashboard', label: '教师端 · 教学驾驶舱' },
  { path: '/teacher/class', label: '教师端 · 班级画像' },
  { path: '/teacher/curriculum', label: '教师端 · 课程项目矩阵' },
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

/** 判断请求头里是否已经带了 Cookie（兼容 Headers 实例与普通对象）。 */
function hasCookieHeader(headers) {
  if (!headers) return false;
  if (typeof headers.has === 'function') return headers.has('cookie');
  return Object.keys(headers).some((key) => key.toLowerCase() === 'cookie');
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

/** 应用自己的访问码会话 Cookie（middleware 校验 HMAC 签名）。 */
let authCookie = '';

/** 合并两层 Cookie。 */
function cookieHeader() {
  return [siteCookie, authCookie].filter(Boolean).join('; ');
}

/** 用带 eo_token 的链接换取平台 Cookie。 */
async function acquireSiteAccess() {
  if (!SITE_QUERY) return;
  // 平台把访问 Cookie 下在 **302 响应** 上，所以必须手动跟随一次跳转：
  // 用 redirect:'follow' 只能看到最后一跳的响应头，会漏掉 Set-Cookie。
  const first = await fetch(`${BASE_URL}/?${SITE_QUERY}`, { redirect: 'manual' });
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

async function fetchWithTimeout(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { ...(init.headers || {}) };
    // 门禁（ACCESS_CODE）开启时，未授权请求会被 middleware 拦成 401。
    // 取到会话 Cookie 之后的每一次请求都必须带上它，否则页面路由全 401，
    // 自检会把「已登录可用」误判成「站点不可达」。
    const combined = cookieHeader();
    if (combined && !hasCookieHeader(headers)) {
      headers.Cookie = combined;
    }
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
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
    const matches = [
      ...source.matchAll(/(\d+)\s*个客户端 chunk 全部 200/g),
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

async function checkAccessCode() {
  const status = await fetchWithTimeout('/api/access-code/status');
  const statusJson = await status.json();
  if (!statusJson.enabled) {
    record('ACCESS_CODE 门禁', true, '未配置 ACCESS_CODE（本地演示形态），跳过门禁校验');
    return;
  }
  if (!ACCESS_CODE) {
    record(
      'ACCESS_CODE 门禁',
      false,
      '服务端已启用 ACCESS_CODE，但未提供 --access-code，无法验证门禁',
    );
    return;
  }

  const unauthorized = await fetchWithTimeout('/api/stages');
  if (unauthorized.status !== 401) {
    record(
      'ACCESS_CODE 未授权被拦截',
      false,
      `GET /api/stages 期望 401，实际 ${unauthorized.status}`,
    );
  } else {
    record('ACCESS_CODE 未授权被拦截', true, 'GET /api/stages → 401');
  }

  const wrong = await fetchWithTimeout('/api/access-code/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'definitely-wrong-code' }),
  });
  if (wrong.status !== 401) {
    record('ACCESS_CODE 错误口令被拒绝', false, `期望 401，实际 ${wrong.status}`);
  } else {
    record('ACCESS_CODE 错误口令被拒绝', true, 'POST /api/access-code/verify → 401');
  }

  const accepted = await fetchWithTimeout('/api/access-code/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ACCESS_CODE }),
  });
  const setCookie = accepted.headers.get('set-cookie') ?? '';
  if (accepted.status !== 200 || !setCookie.includes('openmaic_access=')) {
    record(
      'ACCESS_CODE 正确口令放行',
      false,
      `期望 200 + Set-Cookie，实际 ${accepted.status} / ${setCookie ? '有 Set-Cookie' : '无 Set-Cookie'}`,
    );
    return;
  }
  record('ACCESS_CODE 正确口令放行', true, 'HTTP 200 + Set-Cookie: openmaic_access');

  const cookie = setCookie.split(';')[0];
  authCookie = cookie;
  const authenticated = await fetchWithTimeout('/api/access-code/status', {
    headers: { Cookie: cookie },
  });
  const authJson = await authenticated.json();
  if (authJson.authenticated === true) {
    record(
      'ACCESS_CODE 会话生效',
      true,
      '带 Cookie 后 /api/access-code/status → authenticated: true',
    );
  } else {
    record(
      'ACCESS_CODE 会话生效',
      false,
      `带 Cookie 后 authenticated = ${String(authJson.authenticated)}`,
    );
  }
}

async function checkProviderDegradation() {
  // 启用 ACCESS_CODE 时，provider 列表同样受门禁保护，需要带上会话 Cookie。
  const response = await fetchWithTimeout('/api/server-providers', {
    headers: authCookie ? { Cookie: authCookie } : {},
  });
  const json = await response.json();
  if (response.status !== 200 || json.success !== true) {
    record('模型供给可查询（降级前提）', false, `HTTP ${response.status}`);
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
    process.stdout.write(`[FAIL] 目标站点不可达 — ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  // 先做门禁校验：它负责取到会话 Cookie，后面的页面/资源检查都要靠这个 Cookie。
  await checkAccessCode();
  await checkRoutes();
  await checkChunks();
  await checkBuildId();
  await checkProviderDegradation();

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

await main();
