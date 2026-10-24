/**
 * 会话令牌的**第二条通道**：`x-physics-session` 请求头。
 *
 * ## 为什么需要第二条通道
 *
 * 线上曾出现「带合法 Cookie 仍然 401」。真因是生成器里的**正则转义**被字符串
 * 吃掉（`\.` → `.`、`\d` → `d`），合法令牌永远匹配不上——那处已修，
 * 并加了会真红的回归测试。但那次排查也暴露了一件事：
 * **门禁只有一条通道时，任何一层出问题都是全站功能瘫痪**。
 *
 * Cookie 本来就是客户端自己写的、无签名（见 `account-store.ts` 的诚实说明），
 * 所以「再发一个请求头」不降低任何强度——它挡的仍然是「随手匿名调用」。
 * 两条通道**任一合法即放行**，互为冗余：平台转发层若吞掉 Cookie，
 * 请求头还在；本地与 Vercel 备份部署照旧用 Cookie。
 *
 * ## 这条通道是怎么接上的
 *
 * `installSessionHeaderBridge()` 给 `window.fetch` 打一层**只作用于本站 `/api/`**
 * 的补丁：请求若还没有这个头，就把当前 Cookie 里的令牌抄进去。
 * 于是业务代码一行都不用改，所有既有调用点自动获得第二条通道。
 */
import { SESSION_COOKIE_NAME, isSessionCookieValue } from './account-store';

/**
 * 会话令牌的请求头名。
 *
 * **三处必须一致**：本文件、`middleware.ts`、
 * `scripts/prune-edgeone-function.mjs` 生成的云函数入口。
 * 由 `tests/deploy/session-gate-contract.test.ts` 盯着。
 */
export const SESSION_HEADER_NAME = 'x-physics-session';

/**
 * 从 `Cookie` 头里取出会话令牌。
 *
 * 与云函数入口的 `parseCookieHeader` 同语义：同名取第一个，
 * 畸形百分号转义不让它抛（一个坏 Cookie 不该把请求打成 500）。
 */
export function sessionTokenFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE_NAME) continue;
    const raw = part.slice(index + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    return isSessionCookieValue(value) ? value : null;
  }
  return null;
}

/** 当前浏览器持有的会话令牌（没有或不合法则为 null）。 */
export function currentSessionToken(): string | null {
  if (typeof document === 'undefined') return null;
  return sessionTokenFromCookieHeader(document.cookie);
}

/** 这个 URL 是否属于本站的 `/api/`（相对路径或同源绝对地址）。 */
function isOwnApiUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/api/')) return true;
  if (typeof location === 'undefined') return false;
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

type FetchInput = RequestInfo | URL;

function inputUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? '';
}

/**
 * 给 `window.fetch` 打补丁：本站 `/api/` 请求自动带上会话令牌头。
 *
 * 幂等——重复调用只装一次。返回卸载函数（主要给单测用）。
 *
 * **只加不覆盖**：调用方自己设了这个头就原样保留，
 * 免得将来某处显式传值被这里悄悄改掉。
 */
export function installSessionHeaderBridge(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  const scope = window as Window & { __physicsSessionBridge?: () => void };
  if (scope.__physicsSessionBridge) return scope.__physicsSessionBridge;

  const originalFetch = window.fetch.bind(window);

  const patched: typeof window.fetch = (input, init) => {
    const token = currentSessionToken();
    if (!token || !isOwnApiUrl(inputUrl(input as FetchInput))) {
      return originalFetch(input, init);
    }
    try {
      const base = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const headers = new Headers(base as HeadersInit | undefined);
      if (!headers.has(SESSION_HEADER_NAME)) {
        headers.set(SESSION_HEADER_NAME, token);
      }
      return originalFetch(input, { ...init, headers });
    } catch {
      // 构造 Headers 失败（极少见）就退回原样请求：宁可走 Cookie 通道，
      // 也不要因为一层补丁把业务请求弄丢。
      return originalFetch(input, init);
    }
  };

  window.fetch = patched;

  const uninstall = () => {
    if (window.fetch === patched) window.fetch = originalFetch;
    delete scope.__physicsSessionBridge;
  };
  scope.__physicsSessionBridge = uninstall;
  return uninstall;
}
