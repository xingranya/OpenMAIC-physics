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
 *   4. 未配置模型时 provider 为空、生成路径优雅降级。
 *
 * 用法：
 *   node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3000
 *   node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3000 \
 *        --access-code your-code          # 同时验证口令门禁
 *
 * 退出码：全部通过为 0，存在失败项为 1。
 */

import process from 'node:process';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const BASE_URL = argValue('--base-url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const ACCESS_CODE = argValue('--access-code', '');
const TIMEOUT_MS = 15_000;

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
/** 通过口令门禁后拿到的 Cookie，后续 API 检查需要带上。 */
let authCookie = '';

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  process.stdout.write(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}\n`);
}

async function fetchWithTimeout(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal, redirect: 'manual' });
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
    record('ACCESS_CODE 未授权被拦截', false, `GET /api/stages 期望 401，实际 ${unauthorized.status}`);
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
    record('ACCESS_CODE 会话生效', true, '带 Cookie 后 /api/access-code/status → authenticated: true');
  } else {
    record('ACCESS_CODE 会话生效', false, `带 Cookie 后 authenticated = ${String(authJson.authenticated)}`);
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

async function main() {
  process.stdout.write(`物理 AI 智慧课堂 · 端到端自检\n目标：${BASE_URL}\n\n`);
  try {
    const probe = await fetchWithTimeout('/');
    if (!probe.ok) throw new Error(`目标站点不可达（HTTP ${probe.status}）`);
  } catch (error) {
    process.stdout.write(`[FAIL] 目标站点不可达 — ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  await checkRoutes();
  await checkChunks();
  await checkAccessCode();
  await checkProviderDegradation();

  const failed = results.filter((item) => !item.ok);
  process.stdout.write(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}\n`);
  if (failed.length > 0) {
    process.stdout.write('失败项：\n');
    failed.forEach((item) => process.stdout.write(`  - ${item.name}：${item.detail ?? ''}\n`));
    process.exitCode = 1;
  }
}

await main();
