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
import { SESSION_HEADER_NAME } from '@/lib/physics/session-header';

const REPO_ROOT = process.cwd();
const PRUNE_SCRIPT = join(REPO_ROOT, 'scripts', 'prune-edgeone-function.mjs');

/** 一个形状合法的会话 Cookie 值。 */
function sessionValue(): string {
  return `probe-account.${Date.now()}`;
}

/**
 * 取出函数入口**生成后**的某一行源码。
 *
 * 生成器里那一行是「一个字符串字面量 + 逗号」，例如
 * `        "const SESSION_COOKIE_NAME = 'physics_session';",`
 * ——把它求值，得到的就是真正写进 `index.mjs` 的那行代码。
 *
 * 为什么不能直接断言源文件里含某个子串：源文件里写的是**转义前**的形态，
 * 而运行时看到的是**转义后**的形态。两者不同正是线上 401 的成因
 * （`\.` 在字符串里被吃成 `.`，正则从「点 + 十位以上数字」变成
 * 「任意字符 + d」），只断言源文件子串的测试会**全绿放行**。
 */
function generatedLine(fragment: string): string {
  const source = readFileSync(PRUNE_SCRIPT, 'utf8');
  const line = source
    .split('\n')
    .find((candidate) => candidate.includes(fragment) && candidate.trim().endsWith(','));
  if (!line) throw new Error(`生成器里找不到 ${fragment}`);
  // 该行形如 `<缩进>'<字符串>',` —— 去掉缩进与尾逗号后就是一个合法的字符串字面量。
  const literal = line.trim().replace(/,$/, '');
  return new Function(`return ${literal};`)() as string;
}

function request(pathname: string, cookie?: string, sessionHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${SESSION_COOKIE_NAME}=${cookie}`);
  if (sessionHeader) headers.set(SESSION_HEADER_NAME, sessionHeader);
  return new NextRequest(`http://localhost${pathname}`, { method: 'GET', headers });
}

describe('会话门禁 · 三处契约一致', () => {
  it('Cookie 名在三处完全相同', () => {
    expect(SESSION_COOKIE_NAME).toBe('physics_session');
    expect(generatedLine("const SESSION_COOKIE_NAME = 'physics_session';")).toBe(
      `const SESSION_COOKIE_NAME = '${SESSION_COOKIE_NAME}';`,
    );
  });

  it('会话请求头名在三处完全相同', () => {
    expect(SESSION_HEADER_NAME).toBe('x-physics-session');
    expect(generatedLine('const SESSION_HEADER_NAME =')).toBe(
      `const SESSION_HEADER_NAME = '${SESSION_HEADER_NAME}';`,
    );
  });

  /**
   * 这条是线上 401 的回归测试。
   *
   * 生成器把正则写在字符串里，`\.` / `\d` 必须写成 `\\.` / `\\d`；
   * 少一个反斜杠，生成出来的就是 `/^[…]{1,128}.d{10,16}$/`——
   * 合法令牌（`abc.1700000000000`）永远匹配不上，而**本地走的是 Next 中间件**，
   * 根本碰不到这段代码，所以单测、构建、本地联调全都不会红。
   */
  it('函数入口的令牌形状判定与实际令牌匹配（转义不能被打坏）', () => {
    const source = generatedLine('const SESSION_COOKIE_PATTERN =');
    const pattern = new Function(`return ${source.replace(/^const SESSION_COOKIE_PATTERN = /, '')}`)();
    expect(pattern).toBeInstanceOf(RegExp);
    expect(String(pattern)).toBe(String(/^[A-Za-z0-9._-]{1,128}\.\d{10,16}$/));
    expect(pattern.test(sessionValue())).toBe(true);
    expect(pattern.test(`demo-student.${Date.now()}`)).toBe(true);
    // 反向：形状不对的必须仍然拒绝，别为了放行把门拆了。
    expect(pattern.test('not-a-session')).toBe(false);
    expect(pattern.test('probe-account')).toBe(false);
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

  /**
   * 第二条通道：平台转发层读不出 Cookie 时，客户端发的请求头仍要放行。
   * 这条与上面那条**互不替代**——任一条失效，线上就会出现「登录了还是 401」。
   */
  it('带合法会话请求头（没有 Cookie）→ 放行', async () => {
    const response = await middleware(request('/api/chat', undefined, sessionValue()));
    expect(response.status).not.toBe(401);
  });

  it('带**形状不合法**的 Cookie → 仍然 401（不能靠乱写 Cookie 混进去）', async () => {
    const response = await middleware(request('/api/chat', 'not-a-session'));
    expect(response.status).toBe(401);
  });

  it('带**形状不合法**的会话请求头 → 仍然 401', async () => {
    const response = await middleware(request('/api/chat', undefined, 'not-a-session'));
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
