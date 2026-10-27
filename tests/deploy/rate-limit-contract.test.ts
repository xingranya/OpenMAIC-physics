import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_BODY_PREFIXES,
  RATE_LIMIT_POLICY,
  RATE_LIMIT_SKIP_PREFIXES,
  RATE_LIMIT_WEIGHTS,
  bodyLimitApplies,
  checkRequestBudget,
  clientIpFromHeaders,
  rateLimitApplies,
  requestCost,
  resetRateLimits,
} from '@/lib/server/rate-limit';

/**
 * 限流的两份实现必须**行为一致**。
 *
 * ## 为什么是两份
 *
 * 云函数入口（`.edgeone/cloud-functions/ssr-node/index.mjs`）不在 Next 的模块图里，
 * `import '@/lib/server/rate-limit'` 解析不到，只能把逻辑内联进入口源码。
 * 于是 TS 版（`middleware.ts` 用，本地与 Vercel）与生成的 JS 版（线上真正生效）
 * 是同一套策略的两份代码。
 *
 * ## 为什么比行为而不是比字符串
 *
 * 比字面量只能发现「常量改了一处」，发现不了「条件写反了」「先扣后判改成了
 * 先判后扣」。所以这里把生成的那段代码**真的求值一遍**，然后让两份实现跑
 * **同一组请求序列**，逐条比对 allowed / scope / retryAfterSeconds。
 *
 * 这条测试能红的方式，恰好就是线上会出事的方式。
 */

type Verdict = { allowed: boolean; retryAfterSeconds: number; scope: string | null };

/**
 * 从生成器源码里取出 `rateLimitGateLines()` 返回的那个数组，并**求值**它。
 *
 * 不能 `import` 那个脚本：它是「导入即执行」的——顶层会跑完整套裁剪流程
 * 并 `process.exit(0)`，导入它的测试会直接被杀掉。
 *
 * 求值而不是直接读文本，是因为**转义在这一步才发生**：源文件里写的是
 * `'const P = 1;',` 这样的字符串字面量，真正写进 `index.mjs` 的是去掉引号
 * 与逗号之后的内容。本项目在门禁正则上吃过一次亏——只比源文件子串的断言
 * 会放过转义错误。
 */
function generatedLimiterSource(): string {
  const source = readFileSync(join(process.cwd(), 'scripts', 'prune-edgeone-function.mjs'), 'utf8');
  const fnStart = source.indexOf('export function rateLimitGateLines()');
  if (fnStart === -1) throw new Error('生成器里找不到 rateLimitGateLines()');

  const arrayStart = source.indexOf('return [', fnStart) + 'return '.length;
  const arrayEnd = source.indexOf('\n  ];', arrayStart);
  if (arrayStart <= 'return ['.length - 1 || arrayEnd === -1) {
    throw new Error('没能定位 rateLimitGateLines() 里的数组字面量');
  }

  const literal = `${source.slice(arrayStart, arrayEnd)}]`;
  const lines = new Function(`return ${literal};`)() as string[];
  if (!Array.isArray(lines) || lines.length < 50) {
    // 抽取一旦退化成空数组，下面每条断言都会「通过」。这个下限就是防这个。
    throw new Error(`生成的限流代码只有 ${lines?.length ?? 0} 行，明显不对`);
  }
  return lines.join('\n');
}

interface GeneratedLimiter {
  RATE_LIMIT_POLICY: typeof RATE_LIMIT_POLICY;
  RATE_LIMIT_WEIGHTS: Record<string, number>;
  RATE_LIMIT_BODY_PREFIXES: string[];
  RATE_LIMIT_SKIP_PREFIXES: string[];
  rateLimitCost: (pathname: string) => number;
  rateLimitApplies: (method: string, pathname: string) => boolean;
  rateBodyLimitApplies: (pathname: string) => boolean;
  checkRateBudget: (ip: string, token: string, cost: number, now: number) => Verdict;
  rateClientIp: (request: unknown) => string;
}

/**
 * 把生成的那段代码求值成一个可调用的对象。
 *
 * `readHeaderValue` 在真实入口里另有定义（要兼容四种 headers 形态），
 * 这里给一个最小替身——限流本身不关心它是怎么读出来的。
 */
function makeGeneratedLimiter(): GeneratedLimiter {
  const source = generatedLimiterSource();
  const factory = new Function(
    'readHeaderValue',
    `${source}
    return {
      RATE_LIMIT_POLICY,
      RATE_LIMIT_WEIGHTS,
      RATE_LIMIT_BODY_PREFIXES,
      RATE_LIMIT_SKIP_PREFIXES,
      rateLimitCost,
      rateLimitApplies,
      rateBodyLimitApplies,
      checkRateBudget,
      rateClientIp,
    };`,
  );
  const readHeaderValue = (request: { headers?: Record<string, string> }, name: string) =>
    request?.headers?.[name] ?? '';
  return factory(readHeaderValue) as GeneratedLimiter;
}

/** 一组会走到不同分支的路径。 */
const SAMPLE_PATHS = [
  '/api/generate-classroom',
  '/api/generate/scene-outlines-stream',
  '/api/generate/scene-content',
  '/api/generate/scene-actions',
  '/api/generate/tts',
  '/api/generate/image',
  '/api/generate/video',
  '/api/chat',
  '/api/chat/pi',
  '/api/agent/sessions',
  '/api/materials',
  '/api/classroom',
  '/api/health',
];

describe('限流策略 · 两份实现一致', () => {
  const generated = makeGeneratedLimiter();

  it('策略常量逐项相同', () => {
    expect(generated.RATE_LIMIT_POLICY).toEqual(RATE_LIMIT_POLICY);
    expect(generated.RATE_LIMIT_WEIGHTS).toEqual({ ...RATE_LIMIT_WEIGHTS });
    expect(generated.RATE_LIMIT_BODY_PREFIXES).toEqual([...RATE_LIMIT_BODY_PREFIXES]);
    expect(generated.RATE_LIMIT_SKIP_PREFIXES).toEqual([...RATE_LIMIT_SKIP_PREFIXES]);
  });

  it('每个路径的花费权重相同', () => {
    for (const pathname of SAMPLE_PATHS) {
      expect(generated.rateLimitCost(pathname), pathname).toBe(requestCost(pathname));
    }
  });

  it('「这次请求要不要限流」的判定相同', () => {
    for (const pathname of SAMPLE_PATHS) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'get']) {
        expect(generated.rateLimitApplies(method, pathname), `${method} ${pathname}`).toBe(
          rateLimitApplies(method, pathname),
        );
      }
    }
  });

  it('「要不要查 content-length」的判定相同', () => {
    for (const pathname of SAMPLE_PATHS) {
      expect(generated.rateBodyLimitApplies(pathname), pathname).toBe(bodyLimitApplies(pathname));
    }
  });

  it('IP 提取规则相同（含伪造防护）', () => {
    const cases: Record<string, string>[] = [
      { 'x-forwarded-for': '203.0.113.7' },
      { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      { 'x-forwarded-for': '  203.0.113.7  ' },
      { 'x-forwarded-for': '' },
      { 'x-real-ip': '198.51.100.9' },
      { 'x-forwarded-for': 'a'.repeat(500) },
      { 'x-forwarded-for': '<script>' },
      {},
    ];
    for (const headers of cases) {
      const request = { headers };
      const fromTs = clientIpFromHeaders((name) => headers[name as keyof typeof headers]);
      expect(generated.rateClientIp(request), JSON.stringify(headers)).toBe(fromTs);
    }
  });
});

describe('限流策略 · 同一序列下判定一致', () => {
  const T0 = 1_700_000_000_000;

  /** 让两份实现跑同一串请求，逐条比对。 */
  function runBoth(steps: { ip: string; token: string; cost: number; at: number }[]) {
    resetRateLimits();
    const generated = makeGeneratedLimiter();
    const results: { ts: Verdict; js: Verdict }[] = [];
    for (const step of steps) {
      const ts = checkRequestBudget({ ip: step.ip, token: step.token, cost: step.cost, now: step.at });
      const js = generated.checkRateBudget(step.ip, step.token, step.cost, step.at);
      results.push({
        ts: { allowed: ts.allowed, retryAfterSeconds: ts.retryAfterSeconds, scope: ts.scope },
        js: { allowed: js.allowed, retryAfterSeconds: js.retryAfterSeconds, scope: js.scope },
      });
    }
    return results;
  }

  it('单个 IP 反复触发生成 → 到点被挡，且两份给出同样的 Retry-After', () => {
    // 不带令牌，隔离出 IP 桶：400 单位 / 每次 20 单位 → 第 20 次刚好用满。
    const steps = Array.from({ length: 40 }, () => ({
      ip: '203.0.113.7',
      token: '',
      cost: 20,
      at: T0,
    }));
    const results = runBoth(steps);
    for (const [index, result] of results.entries()) {
      expect(result.js, `第 ${index + 1} 次`).toEqual(result.ts);
    }
    expect(results[19]!.ts.allowed).toBe(true);
    expect(results[20]!.ts.allowed).toBe(false);
    expect(results[20]!.ts.scope).toBe('ip');
  });

  it('单个令牌的分钟配额比 IP 更紧（防单浏览器独占）', () => {
    // 200 单位 / 每次 20 单位 → 第 10 次用满；IP 桶此时还有余量。
    const steps = Array.from({ length: 12 }, () => ({
      ip: '203.0.113.7',
      token: 'acct.1700000000000',
      cost: 20,
      at: T0,
    }));
    const results = runBoth(steps);
    expect(results[9]!.ts.allowed).toBe(true);
    expect(results[10]!.ts.allowed).toBe(false);
    expect(results[10]!.ts.scope).toBe('token');
    for (const result of results) expect(result.js).toEqual(result.ts);
  });

  it('不同 IP 各自独立', () => {
    const steps = [
      ...Array.from({ length: 25 }, () => ({
        ip: '203.0.113.7',
        token: '',
        cost: 20,
        at: T0,
      })),
      { ip: '198.51.100.9', token: '', cost: 20, at: T0 },
    ];
    const results = runBoth(steps);
    expect(results.at(-1)!.ts.allowed).toBe(true);
    for (const result of results) expect(result.js).toEqual(result.ts);
  });

  it('换令牌不能绕过 IP 桶（这是这套设计的核心）', () => {
    // 每个请求都换一个「新身份」——如果限流以令牌为键，这里会全部放行。
    const steps = Array.from({ length: 25 }, (_, index) => ({
      ip: '203.0.113.7',
      token: `acct-${index}.1700000000000`,
      cost: 20,
      at: T0,
    }));
    const results = runBoth(steps);
    expect(results.some((item) => !item.ts.allowed)).toBe(true);
    for (const result of results) expect(result.js).toEqual(result.ts);
  });

  it('分钟窗口滑过后恢复', () => {
    const steps = [
      ...Array.from({ length: 21 }, () => ({
        ip: '203.0.113.7',
        token: '',
        cost: 20,
        at: T0,
      })),
      { ip: '203.0.113.7', token: '', cost: 20, at: T0 + 60_000 },
    ];
    const results = runBoth(steps);
    expect(results.at(-1)!.ts.allowed).toBe(true);
    for (const result of results) expect(result.js).toEqual(result.ts);
  });

  it('全局每日预算耗尽后熔断，scope 为 global', () => {
    // 400 单位 × 60 个不同 IP = 24000 > 20000，最后一两个会被全局桶挡下。
    const steps = Array.from({ length: 60 }, (_, index) => ({
      ip: `203.0.113.${index}`,
      token: '',
      cost: 400,
      at: T0,
    }));
    const results = runBoth(steps);
    expect(results.some((item) => item.ts.scope === 'global')).toBe(true);
    for (const result of results) expect(result.js).toEqual(result.ts);
  });
});
