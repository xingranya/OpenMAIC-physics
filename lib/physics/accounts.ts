/**
 * 账号域：注册、登录、密码哈希与会话（**纯领域层**）。
 *
 * ## 这一层为什么存在
 *
 * 原先站点用的是一把**访问码**——所有人共用一个口令，进门就弹框。
 * 它不是账号系统：没有「注册」，没有「我的账号」，也没有「谁提交的」。
 * 本模块把入口换成**正常的账号注册 + 登录**。
 *
 * ## 为什么密码哈希放在这一层
 *
 * 哈希算法与迭代次数属于**领域规则**（产品约定「密码怎么存」），
 * 不是存储细节；而 `crypto.subtle` / `localStorage` 是**运行时能力**。
 * 所以这里只定义「怎么算、怎么比」，把真正的加密与存储**注入进来**：
 * - 纯领域层不碰 DOM、不碰浏览器存储，也不直接引用 `crypto` 全局；
 * - 测试可以注入确定性的假实现，断言不依赖随机数与时间。
 *
 * ## 口令绝不明文落盘
 *
 * 账号记录里只有 `salt` 与 `passwordHash`（PBKDF2-SHA256 派生值）。
 * 即便有人打开了浏览器存储，看到的也不是口令本身。
 */
import type { UserRole } from './types';

/** 口令最小长度。低于此值直接拒绝注册——太短的口令连 PBKDF2 都救不回来。 */
export const ACCOUNT_MIN_PASSWORD_LENGTH = 8;

/** 口令最大长度。防止超长输入拖垮哈希计算。 */
export const ACCOUNT_MAX_PASSWORD_LENGTH = 128;

/** 用户名最小长度。 */
export const ACCOUNT_MIN_USERNAME_LENGTH = 3;

/** 用户名最大长度。 */
export const ACCOUNT_MAX_USERNAME_LENGTH = 32;

/** 显示名最大长度。 */
export const ACCOUNT_MAX_DISPLAY_NAME_LENGTH = 24;

/** PBKDF2 迭代次数。取 OWASP 2023 对 PBKDF2-HMAC-SHA256 的建议量级。 */
export const PASSWORD_HASH_ITERATIONS = 210_000;

/** 派生密钥长度（位）。SHA-256 → 256 位。 */
export const PASSWORD_HASH_BITS = 256;

/** 盐的长度（字节）。 */
export const PASSWORD_SALT_BYTES = 16;

/** 账号记录。**永远不含明文口令。** */
export interface PhysicsAccount {
  /** 稳定标识。学习记录按它分区——不同账号看不到彼此的数据。 */
  userId: string;
  /** 规范化后的用户名（小写、去首尾空格）。登录按它匹配。 */
  username: string;
  /** 显示名。默认等于用户名。 */
  displayName: string;
  /** 角色：学生还是教师。决定能进哪一端工作台。 */
  role: UserRole;
  /** 盐（base64）。每个账号一份，绝不重复。 */
  salt: string;
  /** 口令派生值（base64）。 */
  passwordHash: string;
  /** 当时的迭代次数。存下来，将来调参数不影响老账号。 */
  iterations: number;
  /** 注册时间戳。 */
  createdAt: number;
}

/** 登录会话。 */
export interface AccountSession {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** 登录时间戳。 */
  at: number;
}

/** 账号仓库（注入）。纯领域层只认这个接口，不认任何具体存储。 */
export interface AccountRepository {
  /** 读出全部账号。 */
  list(): Promise<PhysicsAccount[]>;
  /** 覆盖写回全部账号。 */
  save(accounts: PhysicsAccount[]): Promise<void>;
}

/** 加密能力（注入）。把「怎么算」与「用什么算」分开。 */
export interface AccountCrypto {
  /** 用 PBKDF2-SHA256 派生密钥。 */
  deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer>;
  /** 生成随机字节（盐、账号 id 都用它）。 */
  randomBytes(length: number): Uint8Array;
}

/** 注册/登录依赖（注入）。 */
export interface AccountDeps {
  crypto: AccountCrypto;
  /** 生成账号 id。注入后测试可确定。 */
  newUserId: () => string;
  /** 当前时间。注入后测试可确定。 */
  now: () => number;
}

/** 注册/登录的失败原因。 */
export type AccountErrorCode =
  | 'username-required'
  | 'username-too-short'
  | 'username-too-long'
  | 'username-invalid'
  | 'username-taken'
  | 'password-required'
  | 'password-too-short'
  | 'password-too-long'
  | 'display-name-too-long'
  | 'role-invalid'
  | 'invalid-credentials'
  | 'storage-unavailable';

export interface AccountFailure {
  ok: false;
  error: AccountErrorCode;
}

export interface AccountSuccess<T> {
  ok: true;
  value: T;
}

export type AccountResult<T> = AccountSuccess<T> | AccountFailure;

/**
 * 用户名规范化：去首尾空格 + 转小写。
 *
 * 登录与注册用**同一个**规范化口径，否则「Student」和「student」会变成两个账号。
 */
export function normalizeUsername(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/**
 * 用户名是否合法。
 *
 * 允许 Unicode 字母与数字（中文姓名拼音、学号都该能用），
 * 以及 `_` 与 `-`；不允许空格与其它符号。
 */
export function isValidUsername(raw: string): boolean {
  return /^[\p{L}\p{N}_.-]+$/u.test(raw);
}

/**
 * 校验注册输入。
 *
 * 逐项给出**可区分**的错误码——界面上要能分别提示「用户名太短」
 * 和「用户名已被占用」，不能一律说「注册失败」。
 */
export function validateRegistration(input: {
  username: string;
  password: string;
  displayName?: string;
  role: UserRole;
}): AccountErrorCode | null {
  const username = String(input.username ?? '').trim();
  if (!username) return 'username-required';
  if (username.length < ACCOUNT_MIN_USERNAME_LENGTH) return 'username-too-short';
  if (username.length > ACCOUNT_MAX_USERNAME_LENGTH) return 'username-too-long';
  if (!isValidUsername(username)) return 'username-invalid';

  const password = String(input.password ?? '');
  if (!password) return 'password-required';
  if (password.length < ACCOUNT_MIN_PASSWORD_LENGTH) return 'password-too-short';
  if (password.length > ACCOUNT_MAX_PASSWORD_LENGTH) return 'password-too-long';

  const displayName = String(input.displayName ?? '').trim();
  if (displayName.length > ACCOUNT_MAX_DISPLAY_NAME_LENGTH) return 'display-name-too-long';

  if (input.role !== 'student' && input.role !== 'teacher') return 'role-invalid';

  return null;
}

/** base64 编码（纯实现，不依赖 btoa/atob）。 */
export function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return out;
}

/**
 * base64 解码（纯实现）。
 *
 * **padding 必须显式处理**：丢掉 `=` 就丢掉了「这一组有几个字节」的信息，
 * 解出来的长度会错。`c2` 缺失只出 1 个字节，`c3` 缺失只出 2 个。
 */
export function decodeBase64(text: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const src = String(text ?? '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 4) {
    const c0 = alphabet.indexOf(src[i]);
    const c1 = alphabet.indexOf(src[i + 1]);
    const c2 = src[i + 2] === '=' ? -1 : alphabet.indexOf(src[i + 2]);
    const c3 = src[i + 3] === '=' ? -1 : alphabet.indexOf(src[i + 3]);
    if (c0 < 0 || c1 < 0) break;
    const triple = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out.push((triple >> 16) & 255);
    if (c2 >= 0) out.push((triple >> 8) & 255);
    if (c3 >= 0) out.push(triple & 255);
  }
  return new Uint8Array(out);
}

/**
 * 常量时间比较。
 *
 * **长度不同也要走完整个循环**——早退会让攻击者用响应时间
 * 一位一位地猜出口令。长度差异本身用 `^` 累进差异位，最后一次性判定。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) | 0) ^ (right.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** 派生口令哈希值（base64）。 */
export async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
  crypto: AccountCrypto,
): Promise<string> {
  const bits = await crypto.deriveBits(password, salt, iterations);
  return encodeBase64(new Uint8Array(bits));
}

/** 用账号记录里的盐与参数校验口令。 */
export async function verifyPassword(
  account: PhysicsAccount,
  password: string,
  crypto: AccountCrypto,
): Promise<boolean> {
  const salt = decodeBase64(account.salt);
  const derived = await derivePasswordHash(password, salt, account.iterations, crypto);
  return constantTimeEqual(derived, account.passwordHash);
}

/**
 * 注册一个账号。
 *
 * 失败时给出**可区分**的错误码；成功时把账号写回仓库。
 */
export async function registerAccount(
  repository: AccountRepository,
  input: { username: string; password: string; displayName?: string; role: UserRole },
  deps: AccountDeps,
): Promise<AccountResult<PhysicsAccount>> {
  const invalid = validateRegistration(input);
  if (invalid) return { ok: false, error: invalid };

  const username = normalizeUsername(input.username);
  const accounts = await repository.list();
  if (accounts.some((item) => item.username === username)) {
    return { ok: false, error: 'username-taken' };
  }

  const salt = deps.crypto.randomBytes(PASSWORD_SALT_BYTES);
  const passwordHash = await derivePasswordHash(
    input.password,
    salt,
    PASSWORD_HASH_ITERATIONS,
    deps.crypto,
  );

  const displayName = String(input.displayName ?? '').trim() || username;
  const account: PhysicsAccount = {
    userId: deps.newUserId(),
    username,
    displayName,
    role: input.role,
    salt: encodeBase64(salt),
    passwordHash,
    iterations: PASSWORD_HASH_ITERATIONS,
    createdAt: deps.now(),
  };

  await repository.save([...accounts, account]);
  return { ok: true, value: account };
}

/**
 * 登录。
 *
 * **找不到账号时也要走一遍哈希**：否则「用户不存在」比「口令不对」快得多，
 * 攻击者能据此枚举出哪些用户名存在。
 */
export async function loginAccount(
  repository: AccountRepository,
  username: string,
  password: string,
  deps: AccountDeps,
): Promise<AccountResult<PhysicsAccount>> {
  const normalized = normalizeUsername(username);
  const accounts = await repository.list();
  const account = accounts.find((item) => item.username === normalized);

  if (!account) {
    await derivePasswordHash(
      String(password ?? ''),
      deps.crypto.randomBytes(PASSWORD_SALT_BYTES),
      PASSWORD_HASH_ITERATIONS,
      deps.crypto,
    );
    return { ok: false, error: 'invalid-credentials' };
  }

  const ok = await verifyPassword(account, String(password ?? ''), deps.crypto);
  if (!ok) return { ok: false, error: 'invalid-credentials' };
  return { ok: true, value: account };
}

/** 由账号生成会话。 */
export function createAccountSession(account: PhysicsAccount, now: number): AccountSession {
  return {
    userId: account.userId,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    at: now,
  };
}
