import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSharedOwnerId } from '@/lib/server/agent-runtime/shared-owner';

/**
 * Configure the feature the way a deployment would.
 *
 * The shared-owner mode used to require `ACCESS_CODE`: with it set, the
 * middleware kept unauthenticated requests away, so resolving every request to
 * one owner did not expose a single shared course library. That access code is
 * **retired** — the site now uses per-user accounts and a session gate that
 * only covers the expensive routes. There is no site-wide gate any more, so
 * the shared-owner mode is refused outright instead of quietly exposing one
 * library to everyone.
 */
function configure(sharedOwnerId: string): void {
  vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', sharedOwnerId);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveSharedOwnerId', () => {
  it('is unset when the variable is absent', () => {
    expect(resolveSharedOwnerId()).toBeUndefined();
  });

  it('treats a blank value as unset', () => {
    // `KEY=` in an env file is indistinguishable from an operator who meant to
    // leave the feature off, so it must not be an error and must not be an id.
    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', '');
    expect(resolveSharedOwnerId()).toBeUndefined();

    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', '   ');
    expect(resolveSharedOwnerId()).toBeUndefined();
  });

  it('rejects the reserved anonymous prefix', () => {
    // `anon:` is not in the allowed set, which is what keeps a shared id from
    // aliasing onto a cookie owner — and from being refused by `publish`, which
    // is the behaviour this setting exists to remove.
    configure('anon:00000000-0000-4000-8000-000000000000');
    expect(() => resolveSharedOwnerId()).toThrow(/PERSISTENCE_SHARED_OWNER_ID/);
  });

  it('rejects values the material-key sanitiser would rewrite', () => {
    // Any character outside the set is rewritten to `_` in material object
    // keys, where two different ids could then collide.
    for (const value of ['has space', 'slash/y', 'percent%', 'quote"', 'semi;colon', 'emoji🙂']) {
      configure(value);
      expect(() => resolveSharedOwnerId(), value).toThrow(/PERSISTENCE_SHARED_OWNER_ID/);
    }
  });

  it('rejects a value longer than the limit', () => {
    configure('a'.repeat(129));
    expect(() => resolveSharedOwnerId()).toThrow(/PERSISTENCE_SHARED_OWNER_ID/);
  });

  it('refuses to resolve without a site-wide gate, naming the variable', () => {
    // Otherwise every request on an open deployment would resolve to one
    // owner: one readable, editable and publishable library for whoever asks.
    // The message has to name the variable, since the fix is to unset it (or
    // restore a site-wide gate) and a reader should not have to guess which.
    configure('team-alpha');
    expect(() => resolveSharedOwnerId()).toThrow(/PERSISTENCE_SHARED_OWNER_ID[\s\S]*site-wide/);
  });

  it('fails closed rather than falling back to per-cookie owners', () => {
    // The whole point of refusing is that the alternative — silently resolving
    // to per-cookie owners — is exactly the confusing behaviour this setting
    // exists to remove. So it throws; it never degrades.
    configure('team-alpha');
    let resolved: string | undefined = 'not-called';
    try {
      resolved = resolveSharedOwnerId();
    } catch {
      resolved = undefined;
    }
    expect(resolved).toBeUndefined();
  });
});
