/**
 * 入站限流与请求体量上限。
 *
 * ## 为什么需要它（以及它为什么不是「鉴权」）
 *
 * 会话令牌由**客户端自己写入**，服务端只能验形状（见 `account-store.ts` 的
 * 诚实说明）。也就是说「已登录」这件事在服务端**不可验证**——所以任何
 * 以身份为键的额度都挡不住刻意伪造：换个 `userId` 就是新身份。
 *
 * 真正换不掉的是 **IP**。因此这里的限流以 IP 为主键，令牌只作二级约束
 * （防单个浏览器独占），两者**同时计数**——「有令牌就跳过 IP 桶」等于
 * 给攻击者留门。
 *
 * 这是**缓解**不是根治：进程内的计数器在云函数多实例下各算各的。
 * 根治要么把账号搬到服务端（需要数据库，本项目刻意不接），要么接
 * 共享计数器（Redis / KV，当前没有）。这一点必须写进材料，不能含糊成
 * 「已做鉴权」。
 *
 * ## 为什么按「花费」加权而不是按次数
 *
 * 一次完整生成 ≈ 26–42 个 POST，其中 `generate-classroom` 一个请求就会拉起
 * 整条 LLM 流水线。若只数次数，`300 次/分钟` 等于「每分钟 300 次完整生成」，
 * 等于没限。所以每个前缀带一个权重，桶里累加的是**权重和**。
 */

/** 限流策略。改这里必须同步改 `scripts/prune-edgeone-function.mjs` 的同名常量。 */
export const RATE_LIMIT_POLICY = {
  /** 按 IP：一次 4 场景生成约 70 单位，400 单位/分钟能容纳并发，也挡得住猛刷。 */
  ipPerMinute: 400,
  /** 按 IP 每小时：约 42 次完整生成，足够一整节课。 */
  ipPerHour: 3000,
  /** 按令牌：防单浏览器独占；令牌可伪造，故阈值更紧、只作二级。 */
  tokenPerMinute: 200,
  tokenPerHour: 1500,
  /** 进程级每日总预算，超了直接熔断（503），把「额度被刷爆」变成「今天不可用」。 */
  globalDailyUnits: 20_000,
  /** 请求体上限。只对 JSON 生成类前缀生效，`/api/materials` 有自己的更大上限。 */
  maxBodyBytes: 32 * 1024 * 1024,
} as const;

/**
 * 每个前缀的「花费权重」。按**最长前缀**匹配，未列出的按 1 计。
 *
 * 权重只需要近似反映上游成本：目的是让「一次完整生成」与「一次心跳」在
 * 同一个桶里有不同的分量，而不是精确计费。
 */
export const RATE_LIMIT_WEIGHTS: Readonly<Record<string, number>> = {
  '/api/generate-classroom': 20,
  '/api/generate/scene-outlines-stream': 10,
  '/api/generate/scene-content': 5,
  '/api/generate/image': 5,
  '/api/generate/video': 20,
  '/api/chat': 2,
};

/** 需要校验 `content-length` 的前缀。刻意用白名单，避免误伤 `/api/materials`。 */
export const RATE_LIMIT_BODY_PREFIXES: readonly string[] = [
  '/api/generate/',
  '/api/generate-classroom',
  '/api/chat',
  '/api/agent/',
  '/api/pbl/',
  '/api/web-search',
  '/api/quiz-grade',
];

/** 完全不参与限流的路径。`classroom-media` 走 Range 请求，一个视频几十次 GET。 */
export const RATE_LIMIT_SKIP_PREFIXES: readonly string[] = ['/api/health', '/api/classroom-media/'];

/** 只限写请求：GET / HEAD 一律放行。 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 桶数量上限，防止伪造 IP 把 Map 撑爆。 */
const MAX_BUCKETS = 5000;

interface Bucket {
  minuteStart: number;
  minuteUnits: number;
  hourStart: number;
  hourUnits: number;
}

const ipBuckets = new Map<string, Bucket>();
const tokenBuckets = new Map<string, Bucket>();
let globalBucket = { dayStart: 0, units: 0 };
let lastSweepAt = 0;

/** 清空全部计数器（只给测试用；生产不该调用）。 */
export function resetRateLimits(): void {
  ipBuckets.clear();
  tokenBuckets.clear();
  globalBucket = { dayStart: 0, units: 0 };
  lastSweepAt = 0;
}

/** 这个路径的花费权重。 */
export function requestCost(pathname: string): number {
  let best = 0;
  let cost = 1;
  for (const [prefix, weight] of Object.entries(RATE_LIMIT_WEIGHTS)) {
    if (pathname.startsWith(prefix) && prefix.length > best) {
      best = prefix.length;
      cost = weight;
    }
  }
  return cost;
}

/** 这次请求要不要参与限流。 */
export function rateLimitApplies(method: string, pathname: string): boolean {
  if (READ_METHODS.has(String(method ?? '').toUpperCase())) return false;
  return !RATE_LIMIT_SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** 这次请求的 `content-length` 要不要按生成类上限校验。 */
export function bodyLimitApplies(pathname: string): boolean {
  return RATE_LIMIT_BODY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 从请求头取客户端 IP。
 *
 * 只认形状合法的值：这个字符串会成为 Map 的键，不校验就等于允许任意长度
 * 的键——那是一条廉价的内存攻击面。
 */
export function clientIpFromHeaders(read: (name: string) => string | null | undefined): string {
  const forwarded = read('x-forwarded-for');
  const candidate = forwarded?.split(',')[0]?.trim() || read('x-real-ip')?.trim() || '';
  return /^[0-9a-fA-F:.]{2,64}$/.test(candidate) ? candidate : 'anon';
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 建议的 `Retry-After` 秒数。 */
  retryAfterSeconds: number;
  /** 触发了哪一层。`null` 表示放行。 */
  scope: 'global' | 'ip' | 'token' | null;
}

function consume(
  map: Map<string, Bucket>,
  key: string,
  cost: number,
  perMinute: number,
  perHour: number,
  now: number,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { minuteStart: now, minuteUnits: 0, hourStart: now, hourUnits: 0 };
    map.set(key, bucket);
  }
  if (now - bucket.minuteStart >= MINUTE_MS) {
    bucket.minuteStart = now;
    bucket.minuteUnits = 0;
  }
  if (now - bucket.hourStart >= HOUR_MS) {
    bucket.hourStart = now;
    bucket.hourUnits = 0;
  }

  if (bucket.minuteUnits + cost > perMinute) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.minuteStart + MINUTE_MS - now) / 1000)),
    };
  }
  if (bucket.hourUnits + cost > perHour) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.hourStart + HOUR_MS - now) / 1000)),
    };
  }

  bucket.minuteUnits += cost;
  bucket.hourUnits += cost;
  return { ok: true };
}

/** 每 60 秒清一次过期桶；超量时丢最旧的一批。 */
function sweep(now: number): void {
  if (now - lastSweepAt < MINUTE_MS) return;
  lastSweepAt = now;
  for (const map of [ipBuckets, tokenBuckets]) {
    for (const [key, bucket] of map) {
      if (now - bucket.hourStart >= HOUR_MS) map.delete(key);
    }
    while (map.size > MAX_BUCKETS) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }
}

/**
 * 判一次请求的预算。
 *
 * 顺序是**全局 → IP → 令牌**：全局熔断优先（今天不能再花钱了），
 * 然后才是单来源的速率。两个来源桶**都**计数，不存在「有令牌就免 IP」。
 */
export function checkRequestBudget(input: {
  ip: string;
  token: string | null;
  cost: number;
  now?: number;
}): RateLimitDecision {
  const now = input.now ?? Date.now();
  const cost = Math.max(1, input.cost);

  sweep(now);

  if (now - globalBucket.dayStart >= DAY_MS) {
    globalBucket = { dayStart: now, units: 0 };
  }
  if (globalBucket.units + cost > RATE_LIMIT_POLICY.globalDailyUnits) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((globalBucket.dayStart + DAY_MS - now) / 1000)),
      scope: 'global',
    };
  }

  const ipVerdict = consume(
    ipBuckets,
    input.ip,
    cost,
    RATE_LIMIT_POLICY.ipPerMinute,
    RATE_LIMIT_POLICY.ipPerHour,
    now,
  );
  if (!ipVerdict.ok) {
    return { allowed: false, retryAfterSeconds: ipVerdict.retryAfterSeconds, scope: 'ip' };
  }

  if (input.token) {
    const tokenVerdict = consume(
      tokenBuckets,
      input.token,
      cost,
      RATE_LIMIT_POLICY.tokenPerMinute,
      RATE_LIMIT_POLICY.tokenPerHour,
      now,
    );
    if (!tokenVerdict.ok) {
      return { allowed: false, retryAfterSeconds: tokenVerdict.retryAfterSeconds, scope: 'token' };
    }
  }

  globalBucket.units += cost;
  return { allowed: true, retryAfterSeconds: 0, scope: null };
}

/** 被限流时的响应体。与 `API_ERROR_CODES.RATE_LIMITED` 同名。 */
export function rateLimitedBody(scope: NonNullable<RateLimitDecision['scope']>): {
  success: false;
  errorCode: 'RATE_LIMITED';
  error: string;
} {
  return {
    success: false,
    errorCode: 'RATE_LIMITED',
    error:
      scope === 'global'
        ? '今日模型调用额度已用尽，请明天再试'
        : '请求过于频繁，请稍后再试',
  };
}
