/**
 * 账号域的回归护栏（纯领域层）。
 *
 * ## 守的是什么
 *
 * 1. **口令不明文落盘**：账号记录里只有盐与派生值；
 * 2. **口令错误一律同一句话**：账号不存在与口令不对，返回同一个错误码
 *    —— 否则「这个账号不存在」就成了枚举账号的工具；
 * 3. **找不到账号时也要走一遍哈希**：否则响应时间能区分
 *    「用户不存在」与「口令不对」；
 * 4. **用户名大小写/空格归一**：注册与登录用同一口径，
 *    否则「Student」和「student」会变成两个账号；
 * 5. **错误码可区分**：界面要能分别提示「用户名太短」与「已被占用」。
 */
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_MIN_PASSWORD_LENGTH,
  PASSWORD_HASH_ITERATIONS,
  PASSWORD_SALT_BYTES,
  RESERVED_DEMO_USERNAMES,
  constantTimeEqual,
  createAccountSession,
  decodeBase64,
  encodeBase64,
  loginAccount,
  normalizeUsername,
  registerAccount,
  validateRegistration,
  type AccountCrypto,
  type AccountRepository,
  type PhysicsAccount,
} from '@/lib/physics/accounts';
import { DEMO_ACCOUNTS } from '@/lib/physics/data';
import { authenticate } from '@/lib/physics/session';

/** 确定性的假加密实现：可断言「派生了没有」，且不依赖真随机。 */
function fakeCrypto(): AccountCrypto & { deriveCalls: number } {
  let deriveCalls = 0;
  let saltCounter = 0;
  return {
    get deriveCalls() {
      return deriveCalls;
    },
    async deriveBits(password, salt, iterations) {
      deriveCalls += 1;
      const material = `${iterations}:${password}:${Array.from(salt).join(',')}`;
      const input = new TextEncoder().encode(material);
      const out = new Uint8Array(32);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = (input[i % input.length] + i * 7 + 31) & 255;
      }
      return out.buffer;
    },
    randomBytes(length) {
      saltCounter += 1;
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        out[i] = (i * 31 + saltCounter * 17) & 255;
      }
      return out;
    },
  };
}

/** 内存账号仓库。 */
function memoryRepo(): AccountRepository & { accounts: PhysicsAccount[] } {
  const accounts: PhysicsAccount[] = [];
  return {
    accounts,
    async list() {
      return [...accounts];
    },
    async save(next) {
      accounts.length = 0;
      accounts.push(...next);
    },
  };
}

function deps(crypto = fakeCrypto()) {
  let idCounter = 0;
  return {
    crypto,
    deps: {
      crypto,
      newUserId: () => `user-${(idCounter += 1)}`,
      now: () => 1_700_000_000_000,
    },
  };
}

const VALID = { username: '2026010118', password: 'physics-2026', role: 'student' as const };

describe('账号域 · base64 与常量时间比较', () => {
  it('base64 能往返（盐与哈希都靠它）', () => {
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([255, 254, 253, 252, 251]),
      new Uint8Array(32).fill(7),
    ]) {
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('base64 解码能正确处理 padding（长度不能错）', () => {
    expect(decodeBase64(encodeBase64(new Uint8Array([1]))).length).toBe(1);
    expect(decodeBase64(encodeBase64(new Uint8Array([1, 2]))).length).toBe(2);
    expect(decodeBase64(encodeBase64(new Uint8Array([1, 2, 3]))).length).toBe(3);
  });

  it('常量时间比较对不同长度也返回 false', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('账号域 · 注册校验', () => {
  it('用户名归一：去空格 + 转小写', () => {
    expect(normalizeUsername('  Student  ')).toBe('student');
    expect(normalizeUsername('张思远')).toBe('张思远');
  });

  it('错误码逐项可区分', () => {
    expect(validateRegistration({ username: '', password: 'physics-2026', role: 'student' })).toBe(
      'username-required',
    );
    expect(
      validateRegistration({ username: 'ab', password: 'physics-2026', role: 'student' }),
    ).toBe('username-too-short');
    expect(
      validateRegistration({ username: 'a'.repeat(33), password: 'physics-2026', role: 'student' }),
    ).toBe('username-too-long');
    expect(
      validateRegistration({ username: 'has space', password: 'physics-2026', role: 'student' }),
    ).toBe('username-invalid');
    expect(validateRegistration({ username: 'okname', password: '', role: 'student' })).toBe(
      'password-required',
    );
    expect(validateRegistration({ username: 'okname', password: 'short', role: 'student' })).toBe(
      'password-too-short',
    );
    expect(
      validateRegistration({ username: 'okname', password: 'physics-2026', role: 'x' as never }),
    ).toBe('role-invalid');
  });

  it('用户名允许中文与学号形态', () => {
    expect(
      validateRegistration({ username: '张思远', password: 'physics-2026', role: 'student' }),
    ).toBeNull();
    expect(
      validateRegistration({ username: '2026010118', password: 'physics-2026', role: 'student' }),
    ).toBeNull();
  });

  it('口令长度下限是 8 位', () => {
    expect(ACCOUNT_MIN_PASSWORD_LENGTH).toBe(8);
    expect(
      validateRegistration({
        username: 'okname',
        password: 'a'.repeat(ACCOUNT_MIN_PASSWORD_LENGTH),
        role: 'student',
      }),
    ).toBeNull();
  });
});

/**
 * 演示账号名必须保留。
 *
 * ## 为什么
 *
 * 演示账号（`student` / `teacher`）不在账号表里，登录时走的是
 * `authenticate()` 的明文比对。如果允许注册同名账号，就会出现两个同名身份：
 * 用 `dunzhongwan` 登录落到 `demo-student` 的数据分区，用自己设的口令登录
 * 落到另一个分区——同名不同人，现场演示时最难解释。
 */
describe('账号域 · 演示账号名保留', () => {
  it('注册 student / teacher 被拒绝', () => {
    expect(
      validateRegistration({ username: 'student', password: 'physics-2026', role: 'student' }),
    ).toBe('username-reserved');
    expect(
      validateRegistration({ username: 'teacher', password: 'physics-2026', role: 'teacher' }),
    ).toBe('username-reserved');
  });

  it('大小写与首尾空格同样被拒（比对的是归一后的名字）', () => {
    expect(
      validateRegistration({ username: '  Student ', password: 'physics-2026', role: 'student' }),
    ).toBe('username-reserved');
    expect(
      validateRegistration({ username: 'TEACHER', password: 'physics-2026', role: 'teacher' }),
    ).toBe('username-reserved');
  });

  it('保留名单覆盖全部演示账号（防漂移：新增演示账号必须同步）', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(RESERVED_DEMO_USERNAMES).toContain(normalizeUsername(account.username));
    }
  });

  it('演示账号本身仍然能登录（保留名只拦注册，不拦登录）', () => {
    expect(authenticate('student', 'dunzhongwan')?.role).toBe('student');
    expect(authenticate('teacher', 'dunzhongwan')?.role).toBe('teacher');
    expect(authenticate('student', 'wrong-password')).toBeNull();
  });
});

describe('账号域 · 注册', () => {
  it('注册成功：写回仓库，且**不含明文口令**', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    const result = await registerAccount(repo, VALID, d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = repo.accounts[0];
    expect(stored.username).toBe('2026010118');
    expect(stored.displayName).toBe('2026010118');
    expect(stored.role).toBe('student');
    expect(stored.iterations).toBe(PASSWORD_HASH_ITERATIONS);
    expect(stored.salt.length).toBeGreaterThan(0);
    expect(decodeBase64(stored.salt).length).toBe(PASSWORD_SALT_BYTES);

    // 明文口令**不得**出现在记录的任何字段里
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain('physics-2026');
    expect(stored.passwordHash).not.toBe('physics-2026');
  });

  it('同名账号不能重复注册（大小写归一后算同名）', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    await registerAccount(repo, VALID, d);

    const again = await registerAccount(repo, { ...VALID, username: ' 2026010118 ' }, d);
    expect(again).toEqual({ ok: false, error: 'username-taken' });
  });

  it('每个账号的盐都不同（相同口令也不同哈希）', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    await registerAccount(repo, VALID, d);
    await registerAccount(repo, { ...VALID, username: 'other' }, d);

    const [a, b] = repo.accounts;
    expect(a.salt).not.toBe(b.salt);
    expect(a.passwordHash).not.toBe(b.passwordHash);
  });
});

describe('账号域 · 登录', () => {
  it('口令正确 → 放行', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    await registerAccount(repo, VALID, d);

    const result = await loginAccount(repo, '2026010118', 'physics-2026', d);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.username).toBe('2026010118');
  });

  it('登录时用户名同样归一（大小写/空格不敏感）', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    await registerAccount(repo, VALID, d);

    const result = await loginAccount(repo, ' 2026010118 ', 'physics-2026', d);
    expect(result.ok).toBe(true);
  });

  it('口令错误 → 与「账号不存在」**同一个**错误码', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    await registerAccount(repo, VALID, d);

    const wrongPassword = await loginAccount(repo, '2026010118', 'wrong-password', d);
    const noSuchUser = await loginAccount(repo, 'nobody-here', 'physics-2026', d);

    expect(wrongPassword).toEqual({ ok: false, error: 'invalid-credentials' });
    expect(noSuchUser).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('账号不存在时**也要走一遍哈希**（否则能用响应时间枚举账号）', async () => {
    const repo = memoryRepo();
    const crypto = fakeCrypto();
    const { deps: d } = deps(crypto);

    const before = crypto.deriveCalls;
    await loginAccount(repo, 'nobody-here', 'physics-2026', d);
    expect(crypto.deriveCalls).toBeGreaterThan(before);
  });

  it('会话带上账号 id（学习数据按它分区）', async () => {
    const repo = memoryRepo();
    const { deps: d } = deps();
    const registered = await registerAccount(repo, VALID, d);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const session = createAccountSession(registered.value, 1_700_000_000_000);
    expect(session.userId).toBe('user-1');
    expect(session.username).toBe('2026010118');
    expect(session.role).toBe('student');
  });
});
