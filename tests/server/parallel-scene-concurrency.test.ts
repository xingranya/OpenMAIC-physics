import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MAKERS_PARALLEL_SCENE_CONCURRENCY,
  getParallelSceneConcurrency,
} from '@/lib/server/provider-config';

/**
 * `getParallelSceneConcurrency` 决定「逐场景内容」能不能并行抓取。
 *
 * 上游默认 0（串行），本项目在 Makers 托管下默认 4 —— 这条差异是**性能承诺**
 * 的一部分（15 场景课堂从 20 分钟降到约 5 分钟），所以用测试钉住：
 * 谁把默认值改回 0、或让显式配置失效，这里就会红。
 */
describe('并行场景生成 · 并发度解析', () => {
  const saved = {
    concurrency: process.env.PARALLEL_SCENE_CONCURRENCY,
    makersKey: process.env.MAKERS_MODELS_KEY,
  };

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    delete process.env.PARALLEL_SCENE_CONCURRENCY;
    delete process.env.MAKERS_MODELS_KEY;
  });

  afterEach(() => {
    restore('PARALLEL_SCENE_CONCURRENCY', saved.concurrency);
    restore('MAKERS_MODELS_KEY', saved.makersKey);
  });

  it('既没有 Makers 也没有显式配置时，保持上游的串行默认（0）', () => {
    expect(getParallelSceneConcurrency()).toBe(0);
  });

  it('Makers 托管且未显式配置时，默认开并行', () => {
    process.env.MAKERS_MODELS_KEY = 'test-key';
    expect(getParallelSceneConcurrency()).toBe(DEFAULT_MAKERS_PARALLEL_SCENE_CONCURRENCY);
    expect(DEFAULT_MAKERS_PARALLEL_SCENE_CONCURRENCY).toBeGreaterThan(1);
  });

  it('显式 0 能关掉并行（现场想退回串行不用改代码）', () => {
    process.env.MAKERS_MODELS_KEY = 'test-key';
    process.env.PARALLEL_SCENE_CONCURRENCY = '0';
    expect(getParallelSceneConcurrency()).toBe(0);
  });

  it('显式值优先于 Makers 默认值', () => {
    process.env.MAKERS_MODELS_KEY = 'test-key';
    process.env.PARALLEL_SCENE_CONCURRENCY = '8';
    expect(getParallelSceneConcurrency()).toBe(8);
  });

  it('超过 10 会被夹到 10（防止无上限扇出）', () => {
    process.env.PARALLEL_SCENE_CONCURRENCY = '20';
    expect(getParallelSceneConcurrency()).toBe(10);
  });

  it('空串 / 非数字按「未配置」处理，不炸也不返回 NaN', () => {
    process.env.PARALLEL_SCENE_CONCURRENCY = '   ';
    expect(getParallelSceneConcurrency()).toBe(0);

    process.env.MAKERS_MODELS_KEY = 'test-key';
    process.env.PARALLEL_SCENE_CONCURRENCY = 'abc';
    expect(getParallelSceneConcurrency()).toBe(0);
  });
});
