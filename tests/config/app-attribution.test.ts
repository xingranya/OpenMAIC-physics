import { describe, expect, it } from 'vitest';

import {
  APP_ATTRIBUTION_URL,
  APP_URL_HEADER,
  appAttributionHeaders,
  isAttributionGatewayHost,
  withAppAttributionInit,
} from '@/lib/config/app-attribution';

describe('app attribution host matching', () => {
  it.each([
    'https://tokendance.space/gateway/v1/chat/completions',
    'https://tokendance.space/gateway/ark/v3/images/generations',
    'https://tokendance.space/gateway/minimax/v1/t2a_v2',
    'https://tokendance.space/gateway/bocha/api/search',
    // Subdomain gateways, and case-insensitive hostname matching.
    'https://api.tokendance.space/v1/chat/completions',
    'https://TOKENDANCE.space/gateway/v1/models',
  ])('matches TokenDance gateway targets (%s)', (url) => {
    expect(isAttributionGatewayHost(url)).toBe(true);
    expect(appAttributionHeaders(url)).toEqual({ [APP_URL_HEADER]: APP_ATTRIBUTION_URL });
  });

  it.each([
    'https://api.minimaxi.com/v1/video_generation',
    'https://api.kimi.com/coding/v1/chat/completions',
    'https://api.moonshot.cn/v1/chat/completions',
    'https://ark.cn-beijing.volces.com/api/v3',
    // Suffix/prefix lookalikes must NOT match.
    'https://evil-tokendance.space/v1',
    'https://tokendance.space.evil.com/v1',
    // Non-absolute targets have no host to match.
    'relative/path',
    '',
  ])('leaves every other target untouched (%s)', (url) => {
    expect(isAttributionGatewayHost(url)).toBe(false);
    expect(appAttributionHeaders(url)).toEqual({});
  });

  it('accepts Request objects', () => {
    expect(isAttributionGatewayHost(new Request('https://tokendance.space/gateway/v1'))).toBe(true);
    expect(isAttributionGatewayHost(new Request('https://api.openai.com/v1'))).toBe(false);
  });
});

describe('withAppAttributionInit', () => {
  const gatewayUrl = 'https://tokendance.space/gateway/v1/chat/completions';

  it('adds the header while preserving an existing Headers instance', () => {
    const init = { method: 'POST', headers: new Headers({ Authorization: 'Bearer k' }) };
    const out = withAppAttributionInit(gatewayUrl, init);
    expect(new Headers(out.headers).get(APP_URL_HEADER)).toBe(APP_ATTRIBUTION_URL);
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer k');
    expect(out.method).toBe('POST');
  });

  it('merges into plain-record headers', () => {
    const out = withAppAttributionInit(gatewayUrl, {
      headers: { Authorization: 'Bearer k' },
    });
    expect(new Headers(out.headers).get(APP_URL_HEADER)).toBe(APP_ATTRIBUTION_URL);
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer k');
  });

  it('merges into tuple-array headers', () => {
    const out = withAppAttributionInit(gatewayUrl, {
      headers: [['Authorization', 'Bearer k']],
    });
    expect(new Headers(out.headers).get(APP_URL_HEADER)).toBe(APP_ATTRIBUTION_URL);
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer k');
  });

  it('handles an undefined init', () => {
    const out = withAppAttributionInit(gatewayUrl, undefined as RequestInit | undefined);
    expect(new Headers(out?.headers).get(APP_URL_HEADER)).toBe(APP_ATTRIBUTION_URL);
  });

  it('returns the same init object for non-gateway targets', () => {
    const init = { headers: { Authorization: 'Bearer k' } };
    expect(withAppAttributionInit('https://api.openai.com/v1/chat/completions', init)).toBe(init);
  });
});

/**
 * 归因值本身必须被钉住。
 *
 * 上面的用例全都拿 `APP_ATTRIBUTION_URL` **常量自己**做断言——
 * 那是自证：把常量改成上游的站点，所有断言照样全绿。
 *
 * 而这个头的语义是「**本应用是谁**」：填上游站点等于把本项目的流量
 * 算到上游头上（上游是 MIT 开源项目，并未参与本项目的推广结算）。
 * 所以这里显式钉住：必须是本项目自己的站点，且不得是上游站点。
 */
describe('应用归因值', () => {
  it('指向本项目自己的公开站点', () => {
    expect(APP_ATTRIBUTION_URL).toBe('https://dun.xran.uk');
  });

  it('不得指向上游项目的站点', () => {
    expect(APP_ATTRIBUTION_URL).not.toContain('open.maic.chat');
    expect(APP_ATTRIBUTION_URL).not.toContain('openmaic');
  });
});
