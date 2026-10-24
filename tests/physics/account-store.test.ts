/**
 * 账号存储的**损坏容错**回归护栏。
 *
 * ## 守的是什么
 *
 * 账号表是 localStorage 里的一个 JSON 数组。它可能被写坏：用户手改、
 * 扩展干扰、写入过程中断电、旧版本格式迁移失败。
 *
 * 旧实现遇到解析失败直接 `return []`，于是**注册时** `[...accounts, account]`
 * 会把整张表覆盖成只有新账号——原有账号全部消失，而且没有任何提示。
 * 这比「注册失败」严重得多：用户会以为账号被删了，实际上数据也真没了。
 *
 * 现在的约定：
 * 1. 解析失败**先备份**原始字符串到 `physics-ai-accounts:corrupt-<时间戳>`；
 * 2. 再抛 `AccountStorageCorruptError`，让上层给出可读提示；
 * 3. **绝不写回**，原有键保持原样。
 */
import { describe, expect, it } from 'vitest';

import {
  AccountStorageCorruptError,
  registerAccount,
  type AccountCrypto,
  type PhysicsAccount,
} from '@/lib/physics/accounts';
import { ACCOUNT_STORAGE_KEY, LocalAccountRepository } from '@/lib/physics/account-store';

/** 内存版 Storage（只需要 get/set/remove 三个方法）。 */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data: Record<string, string> = { ...seed };
  return {
    get data() {
      return data;
    },
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

function fakeCrypto(): AccountCrypto {
  return {
    async deriveBits(_password, _salt, _iterations) {
      return new Uint8Array(32).fill(7).buffer;
    },
    randomBytes(length) {
      return new Uint8Array(length).fill(3);
    },
  };
}

function deps(crypto = fakeCrypto()) {
  let counter = 0;
  return {
    crypto,
    newUserId: () => `user-${(counter += 1)}`,
    now: () => 1_700_000_000_000,
  };
}

const VALID = { username: '2026010118', password: 'physics-2026', role: 'student' as const };

describe('账号存储 · 正常路径', () => {
  it('保存后能读回同一批账号', async () => {
    const storage = memoryStorage();
    const repo = new LocalAccountRepository(storage);
    const account: PhysicsAccount = {
      userId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      role: 'student',
      salt: 'AAAA',
      passwordHash: 'BBBB',
      iterations: 10,
      createdAt: 1,
    };
    await repo.save([account]);
    await expect(repo.list()).resolves.toEqual([account]);
  });

  it('键为空时返回空数组（不是损坏）', async () => {
    const repo = new LocalAccountRepository(memoryStorage());
    await expect(repo.list()).resolves.toEqual([]);
  });
});

describe('账号存储 · 损坏时不丢数据', () => {
  it('JSON 解析失败：抛 AccountStorageCorruptError，且**原键原样保留**', async () => {
    const broken = '{not valid json';
    const storage = memoryStorage({ [ACCOUNT_STORAGE_KEY]: broken });
    const repo = new LocalAccountRepository(storage);

    await expect(repo.list()).rejects.toBeInstanceOf(AccountStorageCorruptError);

    // 最关键的一条：没有把坏数据洗成空数组再让上层写回。
    expect(storage.getItem(ACCOUNT_STORAGE_KEY)).toBe(broken);

    // 原始内容被备份到另一个键，用户/开发者还能捞回来。
    const backupKeys = Object.keys(
      (storage as unknown as { data: Record<string, string> }).data,
    ).filter((key) => key.startsWith(`${ACCOUNT_STORAGE_KEY}:corrupt-`));
    expect(backupKeys).toHaveLength(1);
    expect(storage.getItem(backupKeys[0])).toBe(broken);
  });

  it('JSON 合法但不是数组：同样按损坏处理', async () => {
    const broken = '{"username":"alice"}';
    const storage = memoryStorage({ [ACCOUNT_STORAGE_KEY]: broken });
    const repo = new LocalAccountRepository(storage);

    await expect(repo.list()).rejects.toBeInstanceOf(AccountStorageCorruptError);
    expect(storage.getItem(ACCOUNT_STORAGE_KEY)).toBe(broken);
  });

  it('损坏时注册返回 storage-corrupt，而不是覆盖整张表', async () => {
    const broken = 'not-json-at-all';
    const storage = memoryStorage({ [ACCOUNT_STORAGE_KEY]: broken });
    const repo = new LocalAccountRepository(storage);

    const result = await registerAccount(repo, VALID, deps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('storage-corrupt');
    expect(storage.getItem(ACCOUNT_STORAGE_KEY)).toBe(broken);
  });
});
