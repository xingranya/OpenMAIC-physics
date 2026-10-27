/**
 * 第 3 批修复的三条回归护栏：
 *
 * 1. **持久化失败不再静默** —— `saveStateWithReason` 能说出失败原因；
 * 2. **账号表读—改—写有锁** —— 两个标签页同时注册不会互相覆盖；
 * 3. **会话 Cookie 在 HTTPS 下带 `Secure`** —— 但 http 下**不能**带，
 *    否则本地开发会变成「登录成功、下一个请求 401」。
 *
 * 这三条的共同点：原来都是**没有症状**的错。数据在丢、账号在消失、
 * Cookie 在明文过网，而界面、测试、构建全绿。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { registerAccount, type AccountCrypto } from '@/lib/physics/accounts';
import { ACCOUNT_STORAGE_KEY, LocalAccountRepository } from '@/lib/physics/account-store';
import { saveState, saveStateWithReason } from '@/lib/physics/local-store';
import { createInitialState } from '@/lib/physics/local-store';

/** 内存版 Storage。 */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data: Record<string, string> = { ...seed };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem(key: string) {
      return key in data ? data[key] : null;
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  } as Storage;
}

/** 写就抛配额错的 Storage（模拟 localStorage 满了）。 */
function fullStorage(): Storage {
  const storage = memoryStorage();
  storage.setItem = () => {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  };
  return storage;
}

describe('saveStateWithReason · 能说出失败原因', () => {
  it('正常写入 → ok', () => {
    expect(saveStateWithReason(createInitialState(), memoryStorage(), 'u1')).toEqual({ ok: true });
  });

  it('配额写满 → quota（不是笼统的 unknown）', () => {
    expect(saveStateWithReason(createInitialState(), fullStorage(), 'u1')).toEqual({
      ok: false,
      reason: 'quota',
    });
  });

  it('老 Firefox 的配额错误名也认', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('quota', 'NS_ERROR_DOM_QUOTA_REACHED');
    };
    expect(saveStateWithReason(createInitialState(), storage, 'u1')).toEqual({
      ok: false,
      reason: 'quota',
    });
  });

  it('只给 code 22 的实现也认', () => {
    const storage = memoryStorage();
    // 有些老实现抛的不是 DOMException，只带 code。
    storage.setItem = () => {
      const error = new Error('quota') as Error & { code: number };
      error.code = 22;
      throw error;
    };
    expect(saveStateWithReason(createInitialState(), storage, 'u1')).toEqual({
      ok: false,
      reason: 'quota',
    });
  });

  it('其他异常 → unknown', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('boom');
    };
    expect(saveStateWithReason(createInitialState(), storage, 'u1')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('没有 storage → unavailable（无痕模式 / 禁用存储）', () => {
    expect(saveStateWithReason(createInitialState(), undefined, 'u1')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('`saveState` 仍然返回 boolean（老调用方不受影响）', () => {
    expect(saveState(createInitialState(), memoryStorage(), 'u1')).toBe(true);
    expect(saveState(createInitialState(), fullStorage(), 'u1')).toBe(false);
  });
});

/** 一个按名字串行化的假 LockManager（Node 里没有 navigator.locks）。 */
function fakeLockManager() {
  const chains = new Map<string, Promise<unknown>>();
  const requests: string[] = [];
  return {
    requests,
    locks: {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        requests.push(name);
        const previous = chains.get(name) ?? Promise.resolve();
        const next = previous.then(callback);
        chains.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    },
  };
}

function fakeCrypto(): AccountCrypto {
  return {
    async deriveBits() {
      return new Uint8Array(32).fill(7).buffer;
    },
    randomBytes(length) {
      return new Uint8Array(length).fill(3);
    },
  };
}

function deps() {
  let counter = 0;
  return {
    crypto: fakeCrypto(),
    newUserId: () => `user-${(counter += 1)}`,
    now: () => 1_700_000_000_000,
  };
}

/** 让 `list()` 有一次真实的异步间隙——没有间隙就复现不出并发覆盖。 */
class SlowAccountRepository extends LocalAccountRepository {
  override async list() {
    const accounts = await super.list();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return accounts;
  }
}

describe('账号表 · 读—改—写串行化', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  function installLocks(manager: { locks: unknown }) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { locks: manager.locks },
      configurable: true,
      writable: true,
    });
  }

  it('两个账号并发注册 → 两个都在（后写的不覆盖先写的）', async () => {
    const manager = fakeLockManager();
    installLocks(manager);

    const storage = memoryStorage();
    const repo = new SlowAccountRepository(storage);

    const [first, second] = await Promise.all([
      registerAccount(repo, { username: 'alice', password: 'physics-2026', role: 'student' }, deps()),
      registerAccount(repo, { username: 'bob', password: 'physics-2026', role: 'student' }, deps()),
    ]);

    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(second.ok, JSON.stringify(second)).toBe(true);

    const stored = JSON.parse(storage.getItem(ACCOUNT_STORAGE_KEY) ?? '[]') as { username: string }[];
    expect(stored.map((item) => item.username).sort()).toEqual(['alice', 'bob']);

    // 锁真的被用上了，而不是「恰好串行」。
    expect(manager.requests).toContain('physics-accounts');
  });

  it('没有 navigator.locks 时照常工作（老浏览器不该因此不能注册）', async () => {
    Reflect.deleteProperty(globalThis, 'navigator');

    const repo = new LocalAccountRepository(memoryStorage());
    const result = await registerAccount(
      repo,
      { username: 'carol', password: 'physics-2026', role: 'teacher' },
      deps(),
    );
    expect(result.ok).toBe(true);
  });
});

describe('会话 Cookie · Secure 只在 HTTPS 下加', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

  afterEach(() => {
    for (const [name, descriptor] of [
      ['document', originalDocument],
      ['location', originalLocation],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  /** 装一个只记录 `document.cookie` 写入的假 document。 */
  function installDom(protocol: string): { writes: string[] } {
    const writes: string[] = [];
    Object.defineProperty(globalThis, 'document', {
      value: {
        set cookie(value: string) {
          writes.push(value);
        },
        get cookie() {
          return writes.join('; ');
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'location', {
      value: { protocol },
      configurable: true,
      writable: true,
    });
    return { writes };
  }

  const session = {
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    role: 'student' as const,
    at: 1_700_000_000_000,
  };

  it('HTTPS → 带 secure', async () => {
    const { writes } = installDom('https:');
    const { setSessionCookie } = await import('@/lib/physics/account-store');
    setSessionCookie(session);
    expect(writes.at(-1)).toContain('secure');
  });

  it('http://localhost → 不带 secure（带了浏览器会直接丢弃，本地就登不上）', async () => {
    const { writes } = installDom('http:');
    const { setSessionCookie } = await import('@/lib/physics/account-store');
    setSessionCookie(session);
    expect(writes.at(-1)).not.toContain('secure');
  });

  it('清除 Cookie 时属性与写入时一致（否则清不掉）', async () => {
    const { writes } = installDom('https:');
    const { clearSessionCookie } = await import('@/lib/physics/account-store');
    clearSessionCookie();
    const value = writes.at(-1) ?? '';
    expect(value).toContain('max-age=0');
    expect(value).toContain('path=/');
    expect(value).toContain('secure');
  });
});
