import { describe, expect, it } from 'vitest';

import {
  accessCodeVerifyRequestInit,
  classifyAccessCodeVerify,
  resolveAccessGate,
} from '@/lib/access-code-gate';

/**
 * 访问码门禁的判定回归护栏。
 *
 * 这道门要同时满足两条互相拉扯的要求：
 * - 「断网也能演示」——网络层失败时不能弹访问码框（框里的码要提交给
 *   服务端才能校验，服务端联系不上时填了也没用）；
 * - 「未授权访问被拦截」——服务端明确拒绝、或返回了非预期内容时，
 *   绝不能顺手放行，否则这道门会在服务端异常时被一起绕过。
 *
 * 所以「网络层失败」和「授权失败」必须走两条不同的分支。
 */
describe('resolveAccessGate', () => {
  it('网络层失败 → 放行，不弹访问码框（断网演示不中断）', () => {
    expect(resolveAccessGate({ kind: 'network-error' })).toEqual({
      enabled: false,
      authenticated: true,
    });
  });

  it('HTTP 401 → 按未授权处理，弹访问码框', () => {
    expect(resolveAccessGate({ kind: 'response', status: 401, body: { error: 'nope' } })).toEqual({
      enabled: true,
      authenticated: false,
    });
  });

  it('HTTP 5xx → 同样按未授权处理，不因服务端异常放行', () => {
    expect(resolveAccessGate({ kind: 'response', status: 502, body: undefined })).toEqual({
      enabled: true,
      authenticated: false,
    });
  });

  it('2xx 但响应体不是 JSON（例如网关返回 HTML）→ 按未授权处理', () => {
    expect(resolveAccessGate({ kind: 'response', status: 200, body: undefined })).toEqual({
      enabled: true,
      authenticated: false,
    });
    expect(resolveAccessGate({ kind: 'response', status: 200, body: '<!doctype html>' })).toEqual({
      enabled: true,
      authenticated: false,
    });
  });

  it('2xx 且响应体合法 → 以服务端结论为准', () => {
    expect(
      resolveAccessGate({
        kind: 'response',
        status: 200,
        body: { success: true, enabled: true, authenticated: true },
      }),
    ).toEqual({ enabled: true, authenticated: true });

    expect(
      resolveAccessGate({
        kind: 'response',
        status: 200,
        body: { success: true, enabled: true, authenticated: false },
      }),
    ).toEqual({ enabled: true, authenticated: false });
  });

  it('未启用访问码时（enabled=false）→ 放行', () => {
    expect(
      resolveAccessGate({
        kind: 'response',
        status: 200,
        body: { success: true, enabled: false, authenticated: false },
      }),
    ).toEqual({ enabled: false, authenticated: false });
  });

  it('数组 / null 之类的异常响应体 → 按未授权处理', () => {
    expect(resolveAccessGate({ kind: 'response', status: 200, body: [] })).toEqual({
      enabled: true,
      authenticated: false,
    });
    expect(resolveAccessGate({ kind: 'response', status: 200, body: null })).toEqual({
      enabled: true,
      authenticated: false,
    });
  });
});

/**
 * 「提交访问码」的结果分类。
 *
 * ## 为什么这道护栏值得单独写
 *
 * 之前弹框把**三种完全不同的失败**都报成同一句「访问码错误」，其中两种
 * 与访问码本身毫无关系：
 *
 * 1. **被平台访问保护拦截**：预设域（`*.edgeone.dev`）要求带 `eo_token`，
 *    缺了会被平台 **302** 到它自己的访问保护页；浏览器跟随后拿到的是平台的
 *    401 HTML，而不是我们 API 的 JSON 响应。此时**码完全正确**，界面却说
 *    「访问码错误」——演示现场会把人引到完全错误的方向（实测踩过）。
 * 2. **网络层失败**（连接被拒 / 超时 / DNS 失败）：同样与码无关。
 *
 * 这与本文件上方那条原则是同一件事：**网络层失败与服务端明确拒绝必须分开**。
 * 状态查询那侧已经分开了，提交这一侧漏了。
 */
describe('classifyAccessCodeVerify', () => {
  it('成功响应 → ok', () => {
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 200,
        body: { success: true, valid: true },
      }),
    ).toEqual({ kind: 'ok' });
  });

  it('HTTP 401 → invalid-code（真的是码不对）', () => {
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 401,
        body: { success: false, errorCode: 'INVALID_REQUEST' },
      }),
    ).toEqual({ kind: 'invalid-code' });
  });

  it('HTTP 429 → rate-limited（不是码错，是尝试次数超限）', () => {
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 429,
        body: { success: false, errorCode: 'RATE_LIMITED' },
      }),
    ).toEqual({ kind: 'rate-limited' });
  });

  it('网络层失败 → not-reached（与码无关）', () => {
    expect(classifyAccessCodeVerify({ kind: 'network-error' })).toEqual({ kind: 'not-reached' });
  });

  it('被平台 302 拦截（redirect: manual 下表现为 status 0）→ not-reached，不是 invalid-code', () => {
    // 这一条是本次修的真问题：平台访问保护 302 → 浏览器跟随后拿到 401 HTML。
    // 若归到 invalid-code，操作者就会反复重输一个本来就没错的码。
    expect(classifyAccessCodeVerify({ kind: 'response', status: 0, body: undefined })).toEqual({
      kind: 'not-reached',
    });
    expect(classifyAccessCodeVerify({ kind: 'response', status: 302, body: undefined })).toEqual({
      kind: 'not-reached',
    });
  });

  it('2xx 但响应体不是我们的 API（平台塞了 HTML）→ not-reached', () => {
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 200,
        body: '<!doctype html><html>platform access protection</html>',
      }),
    ).toEqual({ kind: 'not-reached' });
  });

  it('2xx 但缺少 valid=true → not-reached（不敢当成成功）', () => {
    expect(
      classifyAccessCodeVerify({ kind: 'response', status: 200, body: { success: true } }),
    ).toEqual({ kind: 'not-reached' });
  });

  it('5xx → not-reached（服务端异常，不是码错）', () => {
    expect(classifyAccessCodeVerify({ kind: 'response', status: 502, body: undefined })).toEqual({
      kind: 'not-reached',
    });
  });
});

/**
 * 提交访问码的请求参数。
 *
 * `redirect: 'manual'` 是这次修复的**关键**：预设域的 `eo_token` 访问保护
 * 会把请求 302 到它自己的页面；默认的 `follow` 跟过去后我们看到的是平台的
 * 401 HTML —— 状态码看起来像「码错了」，而实际上码完全正确。
 */
describe('accessCodeVerifyRequestInit', () => {
  it('必须手动处理重定向（否则平台的 302 会被当成 401 = 码错）', () => {
    expect(accessCodeVerifyRequestInit('abc').redirect).toBe('manual');
  });

  it('把访问码放进请求体，并带上 JSON 头', () => {
    const init = accessCodeVerifyRequestInit('abc');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: 'abc' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});

describe('classifyAccessCodeVerify · 中间层替换了响应体', () => {
  it('401 但响应体不是我方 API 的 JSON（平台 HTML）→ not-reached，不是码错', () => {
    // 平台访问保护在某些配置下直接回 401 + HTML。
    // 若把它判成 invalid-code，操作者就会反复重输一个本来就没错的码。
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 401,
        body: '<!doctype html><html><body>Access protection</body></html>',
      }),
    ).toEqual({ kind: 'not-reached' });
  });

  it('401 但响应体是对象、却不是我方错误形状 → not-reached', () => {
    // 关键：body 是**对象**（能通过 typeof 检查），但没有 success:false，
    // 于是真正被拦下的是「形状不对」这一条，而不是「不是对象」那一条。
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 401,
        body: { message: 'denied by access protection' },
      }),
    ).toEqual({ kind: 'not-reached' });
  });

  it('429 但响应体不是我方 API 的 JSON → not-reached', () => {
    expect(
      classifyAccessCodeVerify({
        kind: 'response',
        status: 429,
        body: 'not json at all',
      }),
    ).toEqual({ kind: 'not-reached' });
  });
});
