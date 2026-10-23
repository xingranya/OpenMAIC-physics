/**
 * App attribution for provider gateways that support it.
 *
 * TokenDance documents "app attribution" (应用归因): the `X-App-URL` request
 * header is the single attribution element — it can also be recorded on an
 * API key, but the per-request header takes precedence. The value only needs
 * to be URL-form and unique + stable for the app; it does not need to be
 * reachable. Sending it lets TokenDance recognize that a request originates
 * from this deployment, which is what their partner program and support flow
 * key off.
 *
 * ## 为什么指向本项目自己的站点
 *
 * 这个头的语义是「**本应用是谁**」，填上游项目的站点属于**错误归因**——
 * 会把本项目的流量算到上游头上（上游是 MIT 协议的开源项目，没有参与
 * 我们的推广结算）。所以它指向本项目自己的公开站点。
 *
 * 注意：上游原实现此处填的是 `https://open.maic.chat`。二开时改成自己的
 * 域名是一项**显式决策**，理由记录在仓库根的 `NOTICE` 里。
 *
 * Attribution is app-level and aggregate; no user-identifying data is added.
 * The header is attached only when the outbound request targets the
 * TokenDance gateway host, so requests to every other provider are untouched.
 */

/**
 * The App URL identifying this application: the product's public site. Stable,
 * unique to this app, and self-describing for anyone reading TokenDance's
 * attribution dashboard.
 */
export const APP_ATTRIBUTION_URL = 'https://dun.xran.uk';

/** Header name exactly as documented by TokenDance. */
export const APP_URL_HEADER = 'X-App-URL';

/** Hosts whose gateways implement the attribution header. */
const ATTRIBUTION_HOST_SUFFIXES = ['tokendance.space'] as const;

function hostnameOf(url: string | URL | RequestInfo): string {
  const raw = typeof url === 'string' || url instanceof URL ? url : ((url as Request).url ?? '');
  try {
    // A `Request`'s url is absolute; bare strings may be relative (SDK
    // internals occasionally pass those), in which case there is no host to
    // match and attribution is simply skipped.
    return new URL(raw, 'https://placeholder.invalid').hostname;
  } catch {
    return '';
  }
}

/**
 * Host check for the attribution gateways. Matches the apex host and any
 * subdomain (`api.tokendance.space`, `gateway.tokendance.space`, …),
 * case-insensitively as hostnames are.
 */
export function isAttributionGatewayHost(url: string | URL | RequestInfo): boolean {
  const host = hostnameOf(url).toLowerCase();
  return ATTRIBUTION_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Headers to merge into an outbound provider request. Returns `{}` (nothing to
 * merge) unless the target is an attribution gateway, in which case it returns
 * the `X-App-URL` header:
 *
 * ```ts
 * fetch(url, { headers: { Authorization: `Bearer ${key}`, ...appAttributionHeaders(url) } })
 * ```
 */
export function appAttributionHeaders(url: string | URL | RequestInfo): Record<string, string> {
  return isAttributionGatewayHost(url) ? { [APP_URL_HEADER]: APP_ATTRIBUTION_URL } : {};
}

/**
 * Merge the attribution header into a `fetch` init, preserving whatever
 * headers shape the caller used (`Headers`, tuples array, or plain record —
 * `new Headers()` accepts all three). Returns the init untouched when the
 * target is not an attribution gateway. Intended for the shared transport
 * seams, so every provider SDK riding them gets the header for free.
 */
export function withAppAttributionInit<T extends RequestInit | undefined>(
  url: string | URL | RequestInfo,
  init: T,
): T {
  if (!isAttributionGatewayHost(url)) return init;
  const headers = new Headers(init?.headers);
  headers.set(APP_URL_HEADER, APP_ATTRIBUTION_URL);
  return { ...init, headers } as T;
}
