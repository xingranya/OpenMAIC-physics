import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * 函数超时预算：路由声明的 `maxDuration` 不得超过平台上限。
 *
 * ## 为什么需要这条测试
 *
 * 线上平台（EdgeOne Pages）的 `cloudFunctions.maxDuration` 是 **120 秒**，
 * 部署脚本 `scripts/deploy-edgeone.mjs` 的 `assertFunctionMaxDuration` 也
 * 拒绝大于 120 的值。但**路由文件里的 `export const maxDuration` 完全是
 * 另一回事**——它只是给支持该字段的平台（Vercel）看的提示，EdgeOne 不看。
 *
 * 于是出现过这样的状态：12 个路由写着 `300`，平台实际 120 秒就切断。
 * 症状是 SSE 流「说到一半停住」、长任务没有错误码地消失，而本地与
 * Vercel 都复现不了。声明与实际能力不一致，比声明得小更糟——
 * 后者会让人早点想办法，前者让人以为还有 180 秒可用。
 *
 * 所以这里把「声明 ≤ 平台上限」钉成契约。要放宽必须先改 `edgeone.json`
 * 与部署脚本，那时这条测试会提醒你同步路由。
 */

const ROOT = join(__dirname, '..', '..');
const API_DIR = join(ROOT, 'app', 'api');

/** 平台上限，与 `edgeone.json` 的 `cloudFunctions.maxDuration` 同源。 */
const PLATFORM_MAX_SECONDS = 120;

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function declaredDurations(): { file: string; seconds: number }[] {
  const found: { file: string; seconds: number }[] = [];
  for (const file of listRouteFiles(API_DIR)) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/export const maxDuration\s*=\s*(\d+)\s*;/);
    if (match) {
      found.push({ file: relative(ROOT, file), seconds: Number(match[1]) });
    }
  }
  return found;
}

describe('API 路由的超时声明', () => {
  const durations = declaredDurations();

  it('确实扫到了路由文件（防空匹配假绿）', () => {
    // 正则一旦写错，`durations` 会是空数组，后面每条断言都会「通过」。
    // 这个下限就是用来让那种情况变红的。
    expect(durations.length).toBeGreaterThanOrEqual(20);
  });

  it('没有任何路由声明超过平台上限', () => {
    const over = durations.filter((item) => item.seconds > PLATFORM_MAX_SECONDS);
    expect(over, `这些路由声明了超过 ${PLATFORM_MAX_SECONDS} 秒：${JSON.stringify(over)}`).toEqual(
      [],
    );
  });

  it('每个声明都是正整数秒', () => {
    for (const item of durations) {
      expect(Number.isInteger(item.seconds), `${item.file} 的 maxDuration 不是整数`).toBe(true);
      expect(item.seconds, `${item.file} 的 maxDuration 不是正数`).toBeGreaterThan(0);
    }
  });

  it('edgeone.json 的上限与测试常量一致', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'edgeone.json'), 'utf8')) as {
      cloudFunctions?: { maxDuration?: number };
    };
    expect(manifest.cloudFunctions?.maxDuration).toBe(PLATFORM_MAX_SECONDS);
  });

  it('vercel.json 的函数超时同样不超过上限', () => {
    // 同一份代码两个部署目标。Vercel 允许 300，但线上是 EdgeOne 的 120，
    // 两边口径不一致会让「本地/Vercel 正常、线上截断」这类问题重新长出来。
    const manifest = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      functions?: Record<string, { maxDuration?: number }>;
    };
    const values = Object.values(manifest.functions ?? {}).map((fn) => fn.maxDuration ?? 0);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toBeLessThanOrEqual(PLATFORM_MAX_SECONDS);
    }
  });
});
