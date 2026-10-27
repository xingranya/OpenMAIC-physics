import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME, isSessionCookieValue } from '@/lib/physics/account-store';
import { SESSION_HEADER_NAME, sessionTokenFromCookieHeader } from '@/lib/physics/session-header';
import {
  RATE_LIMIT_POLICY,
  bodyLimitApplies,
  checkRequestBudget,
  clientIpFromHeaders,
  rateLimitApplies,
  rateLimitedBody,
  requestCost,
} from '@/lib/server/rate-limit';

/**
 * 会话门禁：只有**高耗能接口**要求已登录。
 *
 * ## 为什么不是「全站门禁」
 *
 * 原先这里是一道**访问码**门禁：所有人共用一个口令，进门就弹框。
 * 它不是账号系统——没有注册、没有「谁提交的」，所有数据还混在一起。
 * 现在换成真正的账号系统（注册 + 登录），站点本身对所有访问者开放，
 * 门禁只守在**会消耗模型额度或上游资源**的接口前面。
 *
 * ## 为什么同时认 Cookie 与请求头
 *
 * 线上曾出现「带合法 Cookie 仍然 401」。真因不在判定逻辑，而在**生成器**：
 * `scripts/prune-edgeone-function.mjs` 把形状正则写在字符串字面量里，
 * 少写了一层反斜杠，`\.` / `\d` 在字符串求值时被吃成 `.` / `d`，
 * 于是函数入口拿到的是 `/^[…]{1,128}.d{10,16}$/` —— 合法令牌永远匹配不上。
 * 而**本地跑的是本文件（Next 中间件），根本碰不到那段生成代码**，
 * 所以单测、构建、本地联调全绿，线上恒 401。
 *
 * 那个转义错误已修，并加了会真红的回归测试（`session-gate-contract.test.ts`
 * 会求值生成后的正则，而不是只匹配源文件子串）。
 * 请求头这条通道是**冗余保险**：万一平台转发层将来吞掉 Cookie，
 * 客户端发的 `x-physics-session` 仍能放行。两条通道强度相同
 * （令牌无签名，验的是形状，挡的是随手匿名调用）。
 *
 * ## 与函数入口的一致性（重要）
 *
 * EdgeOne Pages **不部署 Next 中间件**（实测产物的
 * `.next/server/middleware-manifest.json` 里 middleware 为空），
 * 所以线上真正生效的是 `scripts/prune-edgeone-function.mjs` 生成的
 * `createSessionGate`。本文件是**本地开发与 Vercel 备份部署**用的那份。
 *
 * 两处的 Cookie 名、请求头名与「必须登录」前缀列表必须一致——
 * 由 `tests/deploy/session-gate-contract.test.ts` 盯着，不靠人记。
 */

/**
 * 必须已登录的接口前缀。
 *
 * 判据是「会不会花钱」：这些路由会调用模型、搜索或转写服务，
 * 匿名调用等于替别人烧额度。其余接口（本地解析、材料上传、静态查询）
 * 不消耗外部资源，不该拦——拦了只会让「断网也能演示」这类承诺失效。
 */
export const SESSION_REQUIRED_PREFIXES = [
  '/api/generate/',
  // 注意：`/api/generate-classroom` **不**被上面的前缀覆盖（`generate/` 带斜杠）。
  // 漏掉它的后果最严重——那是唯一会经 `after()` 拉起整条 LLM 流水线的入口，
  // 线上实测曾出现「匿名 POST 直接进到业务层」。
  '/api/generate-classroom',
  '/api/chat',
  '/api/agent/',
  '/api/pbl/v2/evaluate',
  '/api/transcription',
  '/api/web-search',
];

/** 该路径是否要求已登录。 */
export function requiresSession(pathname: string): boolean {
  return SESSION_REQUIRED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 取这次请求携带的会话令牌：Cookie 优先，其次请求头。
 *
 * 两个都验形状，都不验签名（令牌无签名，见 `account-store.ts`）。
 */
export function readSessionToken(request: NextRequest): string | null {
  const fromCookie = sessionTokenFromCookieHeader(request.headers.get('cookie'));
  if (fromCookie) return fromCookie;
  const fromHeader = request.headers.get(SESSION_HEADER_NAME);
  return fromHeader && isSessionCookieValue(fromHeader) ? fromHeader : null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = readSessionToken(request);

  // ---- 限流与体量：先于会话判定 ----
  //
  // 顺序是刻意的。体量检查最便宜（只看一个头，不读 body），放最前；
  // 限流次之；会话判定最后。这样「超大请求」不会先消耗掉一个配额单位。
  if (rateLimitApplies(request.method, pathname)) {
    if (bodyLimitApplies(pathname)) {
      const declared = Number(request.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > RATE_LIMIT_POLICY.maxBodyBytes) {
        return NextResponse.json(
          {
            success: false,
            errorCode: 'PAYLOAD_TOO_LARGE',
            error: `请求体过大（上限 ${Math.floor(RATE_LIMIT_POLICY.maxBodyBytes / 1024 / 1024)} MiB）`,
          },
          { status: 413 },
        );
      }
    }

    const decision = checkRequestBudget({
      ip: clientIpFromHeaders((name) => request.headers.get(name)),
      token,
      cost: requestCost(pathname),
    });
    if (!decision.allowed) {
      return NextResponse.json(rateLimitedBody(decision.scope ?? 'ip'), {
        status: decision.scope === 'global' ? 503 : 429,
        headers: { 'retry-after': String(decision.retryAfterSeconds) },
      });
    }
  }

  if (!requiresSession(pathname)) {
    return NextResponse.next();
  }

  if (token) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { success: false, errorCode: 'INVALID_REQUEST', error: 'Login required' },
    { status: 401 },
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
