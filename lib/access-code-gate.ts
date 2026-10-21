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
