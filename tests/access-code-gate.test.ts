import { describe, expect, it } from 'vitest';

import { resolveAccessGate } from '@/lib/access-code-gate';

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
