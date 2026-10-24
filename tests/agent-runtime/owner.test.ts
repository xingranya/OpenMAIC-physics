import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveRequestOwnerId } from '@/lib/server/agent-runtime/owner';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveRequestOwnerId', () => {
  it('mints a UUID-backed anonymous owner when the cookie is absent', () => {
    const responseHeaders = new Headers();

    const ownerId = resolveRequestOwnerId(new Request('http://localhost/agent'), responseHeaders);

    expect(ownerId.startsWith('anon:')).toBe(true);
    expect(ownerId.slice('anon:'.length)).toMatch(UUID_V4);
    expect(responseHeaders.get('set-cookie')).toContain(
      `anonymous_id=${ownerId.slice('anon:'.length)}`,
    );
  });

  it('reuses a valid anonymous cookie without returning another cookie header', () => {
    const id = 'a652e716-0e2e-47f5-8432-4ee60f6f0977';
    const responseHeaders = new Headers();
    const request = new Request('http://localhost/agent', {
      headers: { cookie: `theme=dark; anonymous_id=${id}; locale=en` },
    });

    expect(resolveRequestOwnerId(request, responseHeaders)).toBe(`anon:${id}`);
    expect(responseHeaders.has('set-cookie')).toBe(false);
  });

  it('sets a long-lived, HTTP-only, SameSite=Lax cookie at the root path', () => {
    const responseHeaders = new Headers();

    resolveRequestOwnerId(new Request('http://localhost/agent'), responseHeaders);

    expect(responseHeaders.get('set-cookie')).toMatch(
      /^anonymous_id=[0-9a-f-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/i,
    );
  });

  it('adds Secure to the cookie in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const responseHeaders = new Headers();

    resolveRequestOwnerId(new Request('https://example.test/agent'), responseHeaders);

    expect(responseHeaders.get('set-cookie')).toMatch(/; Secure$/);
  });

  it('omits Secure when COOKIE_SECURE=0', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COOKIE_SECURE', '0');
    const responseHeaders = new Headers();

    resolveRequestOwnerId(new Request('http://localhost/agent'), responseHeaders);

    expect(responseHeaders.get('set-cookie')).toMatch(
      /^anonymous_id=[0-9a-f-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/i,
    );
  });

  it('uses an explicit authenticated owner without minting an anonymous cookie', () => {
    const responseHeaders = new Headers();

    const ownerId = resolveRequestOwnerId(
      new Request('http://localhost/agent'),
      responseHeaders,
      'user-42',
    );

    expect(ownerId).toBe('user-42');
    expect(responseHeaders.has('set-cookie')).toBe(false);
  });

  it('prefers an authenticated owner over an existing anonymous cookie', () => {
    const responseHeaders = new Headers();
    const request = new Request('http://localhost/agent', {
      headers: { cookie: 'anonymous_id=a652e716-0e2e-47f5-8432-4ee60f6f0977' },
    });

    expect(resolveRequestOwnerId(request, responseHeaders, 'user-42')).toBe('user-42');
    expect(responseHeaders.has('set-cookie')).toBe(false);
  });

  it('refuses the shared owner instead of resolving every request to it', () => {
    // 共享 owner 模式依赖**站点级门禁**（原先是访问码）：只有门禁挡着，
    // 「所有请求共用一个 owner」才安全。访问码退役后没有那个门禁了，
    // 于是这个模式**一律拒绝**（fail-closed），而不是悄悄降级成按 Cookie 分区
    // ——降级恰恰是这个设置当初要消除的「记不清自己是谁」。
    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', 'team-alpha');
    const responseHeaders = new Headers();

    expect(() =>
      resolveRequestOwnerId(
        new Request('http://localhost/agent', {
          headers: { cookie: 'anonymous_id=a652e716-0e2e-47f5-8432-4ee60f6f0977' },
        }),
        responseHeaders,
      ),
    ).toThrow(/site-wide/);
    // 拒绝时不该留下半截状态（没发 cookie）。
    expect(responseHeaders.has('set-cookie')).toBe(false);
  });

  it('lets an authenticated owner outrank the shared owner', () => {
    // A host auth layer added later must not require clearing this variable
    // first, so the explicit identity keeps winning.
    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', 'team-alpha');
    const responseHeaders = new Headers();

    expect(
      resolveRequestOwnerId(new Request('http://localhost/agent'), responseHeaders, 'user-42'),
    ).toBe('user-42');
    expect(responseHeaders.has('set-cookie')).toBe(false);
  });
});
