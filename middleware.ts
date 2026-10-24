import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME, isSessionCookieValue } from '@/lib/physics/account-store';

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
 * ## 与函数入口的一致性（重要）
 *
 * EdgeOne Pages **不部署 Next 中间件**（实测产物的
 * `.next/server/middleware-manifest.json` 里 middleware 为空），
 * 所以线上真正生效的是 `scripts/prune-edgeone-function.mjs` 生成的
 * `createSessionGate`。本文件是**本地开发与 Vercel 备份部署**用的那份。
 *
 * 两处的 Cookie 名与「必须登录」前缀列表必须一致——
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!requiresSession(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value && isSessionCookieValue(cookie.value)) {
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
