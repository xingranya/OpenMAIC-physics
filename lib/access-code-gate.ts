/**
 * 访问码门禁的判定逻辑（纯函数，无 React / 无 DOM，便于单测）。
 *
 * 背景：前端这道访问码门禁要在"断网也能演示"和"未授权访问被拦截"之间取舍。
 * 关键是分清两种失败——它们在浏览器里看起来都是"请求没成功"：
 *
 * 1. **网络层失败**（连接被拒 / 超时 / DNS 失败）：`fetch` 本身 reject，
 *    服务端此刻根本联系不上。这时弹访问码框只会挡住断网演示——访问码要
 *    提交给服务端才能校验，填了也没用，评委只看到一个填不动的弹窗。
 *    所以放行内容；**服务端鉴权完全不变**，未授权的 API 请求照常 401。
 *
 * 2. **授权失败 / 服务端异常**：拿到了 HTTP 响应，但状态码不是 2xx，
 *    或响应体不是预期的 JSON（例如网关返回 HTML 错误页）。这时**不能**
 *    放行，否则服务端一旦返回非预期内容，这道门禁会跟着被一起绕过。
 *    按"未授权"处理，要求输入访问码。
 *
 * 两者必须分开：把第 2 种混进第 1 种，等于给门禁开了一个只在服务端异常时
 * 才出现的缺口；把第 1 种当成第 2 种，则会让断网演示无法进行。
 */

/** 一次状态查询的结果：要么拿到了 HTTP 响应，要么是网络层失败。 */
export type AccessGateOutcome =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network-error' };

/** 门禁判定结果。`enabled=false` 表示不需要访问码，直接放行。 */
export interface AccessGateState {
  enabled: boolean;
  authenticated: boolean;
}

/**
 * 根据状态查询结果给出门禁判定。
 *
 * - 网络层失败 → 放行（`enabled: false`），不弹框；
 * - HTTP 非 2xx → 按未授权处理，弹框；
 * - 2xx 但响应体不是预期 JSON → 按未授权处理，弹框；
 * - 2xx 且响应体合法 → 以服务端的 `enabled` / `authenticated` 为准。
 */
export function resolveAccessGate(outcome: AccessGateOutcome): AccessGateState {
  if (outcome.kind === 'network-error') {
    // 断网 / 服务不可达：放行内容，服务端鉴权不变。
    return { enabled: false, authenticated: true };
  }

  if (outcome.status < 200 || outcome.status >= 300) {
    // 服务端明确拒绝：不能因为"拿到的不是期望内容"就把门禁一起放过去。
    return { enabled: true, authenticated: false };
  }

  const body = outcome.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    // 2xx 但响应体形状不对（例如网关塞了 HTML）：同样按未授权处理。
    return { enabled: true, authenticated: false };
  }

  const record = body as { enabled?: unknown; authenticated?: unknown };
  return {
    enabled: Boolean(record.enabled),
    authenticated: Boolean(record.authenticated),
  };
}

/**
 * 「提交访问码」的结果分类。
 *
 * - `ok` → 码正确；
 * - `invalid-code` → 服务端明确判定码不对（HTTP 401）；
 * - `rate-limited` → 尝试次数超限（HTTP 429）；
 * - `not-reached` → **请求没到达我们的 API**。
 */
export type AccessCodeVerifyOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid-code' }
  | { kind: 'rate-limited' }
  | { kind: 'not-reached' };

/** 一次「提交访问码」的原始结果。 */
export type AccessCodeVerifyResponse =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network-error' };

/**
 * 提交访问码的请求参数。
 *
 * ## 为什么必须 `redirect: 'manual'`
 *
 * 预设域（`*.edgeone.dev`）要求带 `eo_token`，缺了会被平台 **302** 到它
 * 自己的访问保护页。默认的 `redirect: 'follow'` 会跟过去，于是我们看到的是
 * **平台的 401 HTML 页面**——状态码 401 看起来就像「访问码错了」，
 * 而实际上码完全正确、只是请求根本没到我们的 API。
 *
 * 手动处理重定向后，平台的拦截表现为 `opaqueredirect`（status 0），
 * 才能与真正的 401 区分开。**这一条是本次修复的关键**：
 * 没有它，界面会继续把「被平台拦截」说成「访问码错误」。
 */
export function accessCodeVerifyRequestInit(code: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    redirect: 'manual',
  };
}

/**
 * 响应体是不是**我方 API** 的错误 JSON。
 *
 * `apiError()` 产出的形状是 `{ success: false, errorCode, error }`。
 * 若响应体不是这个形状（例如平台塞的 HTML 错误页），说明响应被中间层
 * 替换了 —— 那种情况下**不能**把 401 判成「访问码错误」。
 */
function isOurApiError(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  return (body as { success?: unknown }).success === false;
}

/**
 * 把「提交访问码」的结果分成四类，**让界面能说清到底哪里不对**。
 *
 * ## 为什么必须分四类（而不是一律「访问码错误」）
 *
 * 之前弹框把三种完全不同的失败都报成同一句「访问码错误」，其中两种
 * **与访问码本身无关**：
 *
 * 1. **被平台访问保护拦截**：预设域（`*.edgeone.dev`）要求带
 *    `eo_token` 查询参数，缺了会被平台 **302** 到它自己的访问保护页。
 *    浏览器跟随后拿到的是平台的 401 HTML，而不是我们 API 的 JSON 响应。
 *    此时**即使访问码完全正确**，界面也会说「访问码错误」——
 *    演示现场会把人引到完全错误的方向上去（实测踩到过）。
 * 2. **网络层失败**（连接被拒 / 超时 / DNS 失败）：同样与码无关。
 *
 * 这与本文件上方那条原则是同一件事：**网络层失败与服务端明确拒绝必须
 * 分开**。状态查询那侧已经分开了，提交这一侧漏了。
 *
 * 所以这里把「没到达我们的 API」单列一类，界面据此提示
 * 「检查网络或访问地址」，而不是让操作者反复重输一个本来就没错的码。
 */
export function classifyAccessCodeVerify(
  outcome: AccessCodeVerifyResponse,
): AccessCodeVerifyOutcome {
  if (outcome.kind === 'network-error') {
    // fetch 本身失败：服务端联系不上，与码无关。
    return { kind: 'not-reached' };
  }
  // 被平台 302 拦截的情况不用单独分支：`redirect: 'manual'` 下它表现为
  // opaqueredirect（status 0），落进下面的 `status < 200` 即可。
  if (outcome.status === 429) {
    // 尝试次数超限——是「等一会」，不是「码错了」。
    return isOurApiError(outcome.body) ? { kind: 'rate-limited' } : { kind: 'not-reached' };
  }
  if (outcome.status === 401) {
    // 服务端明确判定：码不对。
    // **但只有响应体是我方 API 的错误 JSON 时才算**——平台若直接回 401 +
    // HTML，那是我们没被请求到，不是码错。
    return isOurApiError(outcome.body) ? { kind: 'invalid-code' } : { kind: 'not-reached' };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    // 其他状态码（含 5xx）都不能算「码错了」——那是服务端异常。
    return { kind: 'not-reached' };
  }
  const body = outcome.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    // 2xx 但响应体不是我们的 API 的 JSON：中间层把响应换掉了（例如
    // 平台的 HTML 错误页）。不是码的问题。
    return { kind: 'not-reached' };
  }
  const record = body as { success?: unknown; valid?: unknown };
  return record.success === true && record.valid === true
    ? { kind: 'ok' }
    : { kind: 'not-reached' };
}
