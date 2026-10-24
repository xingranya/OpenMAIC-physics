/**
 * 会话门禁的**契约一致性**与行为回归。
 *
 * ## 为什么要有这道测试
 *
 * 同一道门有三份实现：
 * 1. 客户端下发会话 Cookie（`lib/physics/account-store.ts`）；
 * 2. Next 中间件（`middleware.ts`，本地开发与 Vercel 备份部署用）；
 * 3. **云函数入口**（`scripts/prune-edgeone-function.mjs` 生成的 `createSessionGate`，
 *    EdgeOne Pages 上真正生效的那份——平台不部署 Next 中间件）。
 *
 * 三份靠人记 inevitably 会漂：改了其中一处，线上表现与本地不一样，
 * 而且**很难察觉**（门禁只是「多挡了一些」或「少挡了一些」）。
 * 所以这里把「一致」变成机器断言。
 *
 * ## 断言打在真正的匹配源上
 *
 * 第 3 份是**构建期生成**的源码，断言只能读它的源文件——但锚点用的是
 * **完整字面量**（`"const SESSION_COOKIE_NAME = 'physics_session';"`），
 * 注释里写同形的一行骗不过去（这是本项目吃过两次亏的地方）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import { middleware, SESSION_REQUIRED_PREFIXES, requiresSession } from '@/middleware';
import { SESSION_COOKIE_NAME, isSessionCookieValue } from '@/lib/physics/account-store';

const REPO_ROOT = process.cwd();
const PRUNE_SCRIPT = join(REPO_ROOT, 'scripts', 'prune-edgeone-function.mjs');

/** 一个形状合法的会话 Cookie 值。 */
function sessionValue(): string {
  return `probe-account.${Date.now()}`;
}

function request(pathname: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${SESSION_COOKIE_NAME}=${cookie}`);
  return new NextRequest(`http://localhost${pathname}`, { method: 'GET', headers });
}

describe('会话门禁 · 三处契约一致', () => {
  it('Cookie 名在三处完全相同', () => {
    expect(SESSION_COOKIE_NAME).toBe('physics_session');

    // 第 3 份：构建期生成进函数入口的源码。锚点是**完整字面量**，
    // 注释里写同形的一行匹配不到（否则这道断言就是恒真的）。
    const generated = readFileSync(PRUNE_SCRIPT, 'utf8');
    expect(generated).toContain(`"const SESSION_COOKIE_NAME = '${SESSION_COOKIE_NAME}';"`);
  });

  it('「必须登录」的前缀列表在中间件与函数入口之间一致', () => {
    const generated = readFileSync(PRUNE_SCRIPT, 'utf8');
    for (const prefix of SESSION_REQUIRED_PREFIXES) {
      expect(generated, `函数入口缺少前缀 ${prefix}`).toContain(`'${prefix}'`);
    }
    // 反向：函数入口里出现的前缀，中间件也得有。
    const matched = generated.match(/const SESSION_REQUIRED_PREFIXES = \[([^\]]*)\]/);
    expect(matched, '没找到函数入口的前缀列表').not.toBeNull();
    const prefixes = [...(matched?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(prefixes.sort()).toEqual([...SESSION_REQUIRED_PREFIXES].sort());
  });

  it('会话 Cookie 的形状判定只有一处实现（客户端与函数入口同规则）', () => {
    expect(isSessionCookieValue('probe-account.1700000000000')).toBe(true);
    expect(isSessionCookieValue('probe-account')).toBe(false);
    expect(isSessionCookieValue('')).toBe(false);
    expect(isSessionCookieValue('probe-account.not-a-number')).toBe(false);
  });
});

describe('会话门禁 · 行为', () => {
  it('未登录调用高耗能接口 → 401', async () => {
    const response = await middleware(request('/api/chat'));
    expect(response.status).toBe(401);
  });

  it('带合法会话 Cookie → 放行', async () => {
    const response = await middleware(request('/api/chat', sessionValue()));
    expect(response.status).not.toBe(401);
  });

  it('带**形状不合法**的 Cookie → 仍然 401（不能靠乱写 Cookie 混进去）', async () => {
    const response = await middleware(request('/api/chat', 'not-a-session'));
    expect(response.status).toBe(401);
  });

  it('不消耗外部资源的接口不拦（否则「断网也能演示」会失效）', async () => {
    const response = await middleware(request('/api/health'));
    expect(response.status).not.toBe(401);
  });

  it('页面路由不拦（站点对所有访问者开放）', async () => {
    const response = await middleware(request('/physics/overview'));
    expect(response.status).not.toBe(401);
  });

  it('前缀判定按「会不会花钱」划线', () => {
    expect(requiresSession('/api/chat')).toBe(true);
    expect(requiresSession('/api/chat/pi')).toBe(true);
    expect(requiresSession('/api/generate/scene-content')).toBe(true);
    expect(requiresSession('/api/agent/sessions')).toBe(true);
    expect(requiresSession('/api/health')).toBe(false);
    expect(requiresSession('/api/materials')).toBe(false);
    expect(requiresSession('/api/server-providers')).toBe(false);
  });
});
