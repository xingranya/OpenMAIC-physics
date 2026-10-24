/**
 * 学习数据**按账号分区**的回归护栏。
 *
 * ## 为什么必须分区
 *
 * 有了真正的账号系统之后，「一份学习数据」不再成立：A 账号的诊断分、
 * 实验记录、教师复核**不能**出现在 B 账号的界面上。
 *
 * 升级前所有数据都在**一个固定键**（`physicsAISystem`）里——两个账号会互相
 * 看到对方的记录（判分、实验次数、复核结果）。这在演示现场是会被看出来的：
 * 评委注册一个新账号，首页却显示着上一个账号的成绩。
 *
 * ## 旧数据怎么办
 *
 * 升级前只有一份无作用域的数据，它属于当时的**演示身份**。
 * 所以旧键只作为**演示学生**的种子被继承一次（`LEGACY_STORAGE_SCOPE`），
 * 其余账号从空状态开始——宁可让新账号看不到旧数据，也不能让两个账号互相看到。
 */
import { describe, expect, it } from 'vitest';

import {
  LEGACY_STORAGE_SCOPE,
  PHYSICS_STORAGE_KEY,
  STORAGE_VERSION,
  clearState,
  loadState,
  saveState,
  storageKeyForScope,
} from '@/lib/physics/local-store';
import type { StorageLike } from '@/lib/physics/types';

/** 内存存储（够用即可）。 */
function memoryStorage(seed: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem(key) {
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function envelope(data: unknown): string {
  return JSON.stringify({ version: STORAGE_VERSION, data });
}

describe('学习数据按账号分区', () => {
  it('键名带上作用域', () => {
    expect(storageKeyForScope('user-1')).toBe(`${PHYSICS_STORAGE_KEY}:user-1`);
    // 没有作用域时退回旧键（向后兼容）
    expect(storageKeyForScope(undefined)).toBe(PHYSICS_STORAGE_KEY);
  });

  it('不同账号互相看不到对方的数据', () => {
    const storage = memoryStorage();

    saveState({ ...loadState(storage, 'user-a'), activeTask: 3 }, storage, 'user-a');

    const a = loadState(storage, 'user-a');
    const b = loadState(storage, 'user-b');

    expect(a.activeTask).toBe(3);
    expect(b.activeTask).toBe(0);
  });

  it('保存只写自己的作用域，不碰别人的', () => {
    const storage = memoryStorage();

    saveState(loadState(storage, 'user-a'), storage, 'user-a');
    saveState(loadState(storage, 'user-b'), storage, 'user-b');

    expect(Object.keys(storage.data).sort()).toEqual([
      `${PHYSICS_STORAGE_KEY}:user-a`,
      `${PHYSICS_STORAGE_KEY}:user-b`,
    ]);
  });

  it('清空只清自己的作用域（别人的记录不受影响）', () => {
    const storage = memoryStorage();
    saveState(loadState(storage, 'user-a'), storage, 'user-a');
    saveState(loadState(storage, 'user-b'), storage, 'user-b');

    expect(clearState(storage, 'user-a')).toBe(true);

    expect(storage.getItem(`${PHYSICS_STORAGE_KEY}:user-a`)).toBeNull();
    expect(storage.getItem(`${PHYSICS_STORAGE_KEY}:user-b`)).not.toBeNull();
  });

  it('旧数据只被演示学生继承一次，其它账号看不到', () => {
    const legacy = {
      [PHYSICS_STORAGE_KEY]: envelope({ ...loadState(memoryStorage()), activeTask: 3 }),
    };
    const storage = memoryStorage(legacy);

    // 演示学生继承旧数据
    expect(loadState(storage, LEGACY_STORAGE_SCOPE).activeTask).toBe(3);
    // 别的账号从空状态开始
    expect(loadState(storage, 'someone-else').activeTask).toBe(0);
    expect(loadState(storage, undefined).activeTask).toBe(3);
  });

  it('继承来的旧数据写回自己的键后就不再依赖旧键', () => {
    const legacy = {
      [PHYSICS_STORAGE_KEY]: envelope({ ...loadState(memoryStorage()), activeTask: 3 }),
    };
    const storage = memoryStorage(legacy);

    const adopted = loadState(storage, LEGACY_STORAGE_SCOPE);
    saveState(adopted, storage, LEGACY_STORAGE_SCOPE);

    // 旧键被清掉后，演示学生的数据仍在自己的键里
    delete storage.data[PHYSICS_STORAGE_KEY];
    expect(loadState(storage, LEGACY_STORAGE_SCOPE).activeTask).toBe(3);
  });
});
