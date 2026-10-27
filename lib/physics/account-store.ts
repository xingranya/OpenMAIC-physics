/**
 * 账号系统的浏览器适配层：localStorage 存储、WebCrypto 哈希、会话 Cookie。
 *
 * ## 为什么与领域层分开
 *
 * `lib/physics/accounts.ts` 是**纯领域层**——它只定义「怎么算、怎么比」，
 * 不碰 DOM、不碰浏览器存储。这里提供这些**运行时能力**的具体实现，
 * 并把 `AccountRepository` / `AccountCrypto` 两个接口落地。
 *
 * ## 存储位置与含义
 *
 * 账号记录存在**本浏览器的 localStorage** 里，不上传服务端。
 * 这是本项目的明确取舍（约束要求不引入数据库），代价是：
 * **换浏览器、换设备都看不到这些账号**，需要重新注册。
 * 材料里必须如实这样写，不能暗示它是服务端账号体系。
 */
import {
  AccountStorageCorruptError,
  PASSWORD_HASH_BITS,
  type AccountCrypto,
  type AccountDeps,
  type AccountRepository,
  type AccountSession,
  type PhysicsAccount,
} from './accounts';

/** 账号在 localStorage 里的键。 */
export const ACCOUNT_STORAGE_KEY = 'physics-ai-accounts';

/**
 * 会话 Cookie 名。
 *
 * 函数入口（云函数）用它判断「这个请求是不是已登录」——
 * 见 `scripts/prune-edgeone-function.mjs` 生成的 `createSessionGate`。
 * 两处必须一致，由 `tests/deploy/session-gate-contract.test.ts` 盯着。
 */
export const SESSION_COOKIE_NAME = 'physics_session';

/** 会话 Cookie 的有效期（秒）。7 天，与访问码会话同量级。 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * 会话 Cookie 的形状：`<账号 id>.<登录时间戳>`。
 *
 * 服务器**只能验证形状**，验证不了「是不是本人」——这个 Cookie 里
 * **没有任何签名**：内容就是账号 id 与登录时间戳，客户端自己写的。
 * 这是一个刻意的取舍：账号校验在本地进行（不接数据库），服务器这边要的是
 * 「挡得住随手匿名调用」，不是强身份鉴权。材料里必须这样写，
 * 也不能含糊成「服务端验证了身份」或「有签名」。
 */
const SESSION_COOKIE_PATTERN = /^[A-Za-z0-9._-]{1,128}\.\d{10,16}$/;

/** 会话 Cookie 的形状是否合法。 */
export function isSessionCookieValue(value: string): boolean {
  return SESSION_COOKIE_PATTERN.test(String(value ?? ''));
}

/**
 * 当前浏览器是否持有会话 Cookie（即「已登录」）。
 *
 * 供**高耗能入口**在发请求前自查：那些接口在服务端会 401，
 * 与其让调用方拿到一个没有上下文的 401，不如先给一句人话。
 */
export function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

/**
 * 是否该因为「没有会话」而**在客户端**拦下这次请求。
 *
 * ## 为什么只在浏览器里判
 *
 * 客户端这道拦截是**UX 提示**（给一句人话），真正的判定在服务端
 * （会话门禁）。所以：
 * - 浏览器里没有会话 → 拦，给一句「请先登录」；
 * - **非浏览器环境**（SSR / 单元测试）→ 不拦。那里的「没有 Cookie」
 *   并不代表用户没登录，拦了只会让正常的服务端 401 变成一个
 *   没有上下文的假失败。
 */
export function shouldBlockForMissingSession(): boolean {
  if (typeof document === 'undefined') return false;
  return !hasSessionCookie();
}

function getStorage(): Storage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

/**
 * 校验从存储里读出来的账号记录。
 *
 * localStorage 是**可被篡改的**（用户自己就能改），数据也可能来自旧版本或
 * 损坏的 JSON。形状不对的记录直接丢掉——**不要**因为一条脏数据让整个
 * 登录流程崩掉。
 */
export function isAccountShape(value: unknown): value is PhysicsAccount {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<PhysicsAccount>;
  return (
    typeof record.userId === 'string' &&
    record.userId.length > 0 &&
    typeof record.username === 'string' &&
    record.username.length > 0 &&
    typeof record.displayName === 'string' &&
    (record.role === 'student' || record.role === 'teacher') &&
    typeof record.salt === 'string' &&
    typeof record.passwordHash === 'string' &&
    typeof record.iterations === 'number' &&
    typeof record.createdAt === 'number'
  );
}

/** localStorage 支撑的账号仓库。 */
export class LocalAccountRepository implements AccountRepository {
  constructor(private readonly storage?: Storage) {}

  private resolve(): Storage | undefined {
    return this.storage ?? getStorage();
  }

  async list(): Promise<PhysicsAccount[]> {
    const storage = this.resolve();
    if (!storage) return [];
    const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return [];

    // ## 损坏时**绝不**返回空数组
    //
    // 返回 `[]` 看起来最"稳"，实际最危险：注册流程拿到空数组后会
    // `save([newAccount])`，把整张账号表覆盖成只有新账号——原有账号全部消失，
    // 而且用户看不到任何提示。所以这里先备份原始内容，再抛错让上层给提示。
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw this.backupAndBuildCorruptError(raw, storage);
    }
    if (!Array.isArray(parsed)) {
      throw this.backupAndBuildCorruptError(raw, storage);
    }
    return parsed.filter(isAccountShape);
  }

  /**
   * 把损坏的原始字符串另存一份，再构造要抛的错误。
   *
   * 备份失败（例如配额已满）也**不改变结论**：仍然抛错，绝不退回空数组。
   */
  private backupAndBuildCorruptError(raw: string, storage: Storage): AccountStorageCorruptError {
    try {
      storage.setItem(`${ACCOUNT_STORAGE_KEY}:corrupt-${Date.now()}`, raw);
    } catch {
      /* 备份失败不改变"损坏"这个事实 */
    }
    return new AccountStorageCorruptError();
  }

  async save(accounts: PhysicsAccount[]): Promise<void> {
    const storage = this.resolve();
    if (!storage) {
      throw new Error('浏览器存储不可用，无法保存账号');
    }
    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
  }
}

/**
 * 浏览器里的 PBKDF2 实现。
 *
 * `crypto.subtle` 需要**安全上下文**（HTTPS 或 localhost）——
 * 线上是 HTTPS，开发是 localhost，都满足；若在其它协议下访问，
 * 这里会抛出一句能看懂的错，而不是静默失败。
 */
export function browserAccountCrypto(): AccountCrypto {
  return {
    async deriveBits(password, salt, iterations) {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) {
        throw new Error('当前环境不支持 Web Crypto（需要 HTTPS 或 localhost），无法安全地保存口令');
      }
      const key = await subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      return subtle.deriveBits(
        // 复制一份：TS 5.7 起 Uint8Array 的缓冲区类型是泛型的，
        // 而 SubtleCrypto 要的是 ArrayBuffer 支撑的视图。
        { name: 'PBKDF2', salt: Uint8Array.from(salt), iterations, hash: 'SHA-256' },
        key,
        PASSWORD_HASH_BITS,
      );
    },
    randomBytes(length) {
      const out = new Uint8Array(length);
      globalThis.crypto.getRandomValues(out);
      return out;
    },
  };
}

/** 浏览器里的账号依赖（随机 id + 当前时间）。 */
export function browserAccountDeps(): AccountDeps {
  return {
    crypto: browserAccountCrypto(),
    newUserId: () => {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    now: () => Date.now(),
  };
}

/**
 * 会话 Cookie 的 `Secure` 属性。
 *
 * HTTPS 站点要带：不带的话，任何一个「先降级到 http 再跳回来」的路径
 * 都会让这个值以明文过一次网络。
 *
 * 只在 HTTPS 下加，是因为**加了 `Secure` 的 Cookie 在 http:// 页面上会被
 * 浏览器直接丢弃**——本地 `next dev`（http://localhost）会因此变成
 * 「登录成功但下一个请求 401」，那正是本项目之前花了两轮才定位到的症状。
 * localhost 本身被规范当作安全上下文，不需要这个属性。
 */
function secureCookieAttribute(): string {
  if (typeof location === 'undefined') return '';
  return location.protocol === 'https:' ? '; secure' : '';
}

/**
 * 下发会话 Cookie（供云函数判断「是否已登录」）。
 *
 * **诚实说明**：这个 Cookie 是**客户端自己写的**，内容就是账号 id 与
 * 登录时间戳，**没有任何签名**——所以服务器只能验证「形状对不对」，
 * **验证不了「是不是本人」**。
 * 它的作用是**挡住随手匿名调用高耗能接口**，不是强身份鉴权。
 * 材料里必须这样写，不能含糊成「服务端验证了身份」。
 *
 * `HttpOnly` **做不到**：这个令牌本来就要被客户端读出来再放进请求头
 * （见 `lib/physics/session-header.ts` 的 fetch 补丁），加了 `HttpOnly`
 * 整条链路就断了。这是设计取舍，不是遗漏。
 */
export function setSessionCookie(session: AccountSession): void {
  if (typeof document === 'undefined') return;
  const value = `${encodeURIComponent(session.userId)}.${session.at}`;
  document.cookie = `${SESSION_COOKIE_NAME}=${value}; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; samesite=lax${secureCookieAttribute()}`;
}

/** 清除会话 Cookie。 */
export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE_NAME}=; path=/; max-age=0; samesite=lax${secureCookieAttribute()}`;
}
