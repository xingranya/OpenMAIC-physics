/**
 * 端到端自检的**抗抖动**判定（纯函数，无 I/O，可被单测直接覆盖）。
 *
 * ## 为什么需要它
 *
 * 自检是从本机打向 EdgeOne 海外边缘的一串请求。实测这台机器到该边缘的
 * **连接层**失败率不低（`UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET`），
 * 那是**本机网络**的问题，不是站点的问题——但自检是门禁，门禁要测的是站点。
 *
 * 原先只有「重试」这一招。一旦重试也用尽，异常会一路逃出 `main()`，
 * 在顶层变成**未捕获的 Promise rejection**：脚本带着 Node 堆栈崩掉，
 * 后面的检查一项都跑不了，只留一屏栈信息。判读成本极高——而且那种崩法
 * 和「站点真的坏了」长得完全不一样，人分不清该查本机还是查站点。
 *
 * 所以这里把两件事分开：
 *
 * 1. **一次检查失败不该打断整轮自检** —— 每项检查独立，失败就记成一条 FAIL，
 *    别的检查照跑，末尾照常出总数。
 * 2. **连接层失败必须和站点故障区分开** —— 失败文案里要说清是
 *    「本机连不上」还是「站点返回了坏答案」。
 *
 * ## 为什么要抽成纯函数（而不是就地写个 try/catch）
 *
 * 这类兜底逻辑最容易被「写得巧」而写错：判断写在调用点里，测试就只能测到壳；
 * 更糟的是 `catch {}` 把异常吞掉后**门禁照样全绿**——那等于给门禁开了个缺口。
 * 抽成纯函数后，「连接层失败 / 站点故障」这条界线能被单独断言，
 * 并且 `guardCheck` 的契约（**不把异常抛出去**）也能被直接测到。
 */

/** Node / undici 的连接层错误码。命中即视为「本机连不上」，而非站点故障。 */
export const CONNECTION_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
]);

/**
 * 「连接已建立、但服务端迟迟不给响应」的错误码。
 *
 * 这两种**不能**算「本机连不上」：TCP 已经握手成功，对面就是我们的服务，
 * 是它慢。混进「本机连不上」会把排查方向指到链路上，而真正该查的是站点
 * （独立复审 F8）。
 */
export const RESPONSE_TIMEOUT_ERROR_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * 把一个错误的全部「代码」收集起来。
 *
 * undici 的连接层错误把真正的原因藏在 `cause` 里（`TypeError: fetch failed`
 * → `cause.code = 'UND_ERR_CONNECT_TIMEOUT'`），而 `AggregateError` 还会再
 * 套一层 `errors[]`。只查最外层会漏判，所以要递归展开。
 */
export function collectErrorCodes(error) {
  const codes = [];
  const seen = new Set();

  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof value.code === 'string') codes.push(value.code);
    if (Array.isArray(value.errors)) value.errors.forEach(walk);
    if (value.cause) walk(value.cause);
  };

  walk(error);
  return codes;
}

/** 把一个错误压成一行可读文本（含 cause 与 code）。 */
export function errorText(error) {
  if (error === null || error === undefined) return String(error);
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);

  const parts = [];
  if (error.name) parts.push(String(error.name));
  if (error.message) parts.push(String(error.message));

  const cause = error.cause;
  if (cause && typeof cause === 'object' && cause.message) {
    parts.push(String(cause.message));
    if (cause.code) parts.push(`(${String(cause.code)})`);
  } else if (typeof cause === 'string') {
    parts.push(cause);
  }

  const codes = collectErrorCodes(error);
  const extraCodes = codes.filter((code) => !parts.some((part) => part.includes(code)));
  if (extraCodes.length > 0) parts.push(`(${extraCodes.join(', ')})`);

  return parts.join(': ') || String(error);
}

/**
 * 这是「本机连不上」还是「站点响应慢」还是「别的」。
 *
 * - 连接层失败 → `true`：fetch 根本没拿到 HTTP 响应，问题在链路上；
 * - 其它 → `false`：拿到了响应或别的错误，那多半是站点自己的问题。
 */
export function isConnectionFailure(error) {
  if (!error) return false;
  // 响应超时**先排除**：它是「连上了但对面慢」，说成「本机连不上」会把
  // 排查方向指错。注意 undici 会把 headers/body 超时也包成
  // `TypeError: fetch failed`，所以光看文本分不出来——必须先看错误码。
  if (isResponseTimeout(error)) return false;
  for (const code of collectErrorCodes(error)) {
    if (CONNECTION_ERROR_CODES.has(code)) return true;
  }
  const text = errorText(error);
  return /fetch failed|connect timeout|socket hang up|network (?:error|is unreachable)|getaddrinfo/i.test(
    text,
  );
}

/**
 * 「连接已建立、但响应超时」。
 *
 * 与「本机连不上」是**不同的责任方**：TCP 握手成功，对面就是我们的服务，
 * 是它慢。报告里必须分开说，否则会去查链路，而真正该查的是站点。
 */
export function isResponseTimeout(error) {
  if (!error) return false;
  return collectErrorCodes(error).some((code) => RESPONSE_TIMEOUT_ERROR_CODES.has(code));
}

/**
 * 把一次检查的失败收敛成一句人能读懂的话。
 *
 * 关键在于**说清责任方**：本机网络抖动和站点故障要用完全不同的措辞，
 * 否则看报告的人会去查错的方向。
 */
export function describeCheckFailure(error) {
  const text = errorText(error);
  if (isConnectionFailure(error)) {
    return `本机连不上目标站点（连接层失败，不是站点返回的答案）：${text}`;
  }
  if (isResponseTimeout(error)) {
    return `连接已建立但响应超时（可能是站点响应慢或负载高，不是本机网络问题）：${text}`;
  }
  return `检查执行失败：${text}`;
}

/** 失败记录的统一形状：与脚本里 `record(name, ok, detail)` 产出的条目一致。 */
export function toFailureRecord(name, error) {
  return { name, ok: false, detail: describeCheckFailure(error) };
}

/**
 * 跑一项检查，**不让异常逃出去**。
 *
 * 契约（可被单测直接断言）：
 * - 检查正常完成 → 什么都不记，返回 `{ok:true}`；
 * - 检查抛异常 → 记一条 `ok:false` 的 FAIL，返回 `{ok:false}`，**不抛**。
 *
 * 不抛是关键：一旦异常逃出去，顶层就会变成未捕获 rejection，
 * 整轮自检连同后面的检查一起没了，而且只剩一屏栈信息。
 *
 * @param {string} name   检查项名称（失败时用它当 FAIL 项的名字）
 * @param {() => Promise<unknown>} body  检查体
 * @param {(name: string, ok: boolean, detail: string) => void} record 记账函数
 */
export async function guardCheck(name, body, record) {
  try {
    await body();
    return { ok: true };
  } catch (error) {
    const failure = toFailureRecord(name, error);
    record(failure.name, failure.ok, failure.detail);
    return { ok: false, failure };
  }
}
