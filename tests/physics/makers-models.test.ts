import { describe, expect, it } from 'vitest';

import {
  MAKERS_MODELS_BASE_URL,
  MAKERS_MODELS_KEY_ENV,
  readMakersModelsConfig,
} from '@/lib/config/makers-models';

describe('EdgeOne Makers Models 统一网关适配', () => {
  it('未配置 Makers Key 时不启用', () => {
    expect(readMakersModelsConfig({})).toBeUndefined();
    expect(readMakersModelsConfig({ [MAKERS_MODELS_KEY_ENV]: '   ' })).toBeUndefined();
  });

  it('只配置 Key 时使用官方统一端点', () => {
    const config = readMakersModelsConfig({ [MAKERS_MODELS_KEY_ENV]: 'mk-123' });
    expect(config?.apiKey).toBe('mk-123');
    expect(config?.baseUrl).toBe(MAKERS_MODELS_BASE_URL);
    expect(config?.models).toBeUndefined();
  });

  it('显式 baseUrl 优先于官方统一端点', () => {
    const config = readMakersModelsConfig({
      [MAKERS_MODELS_KEY_ENV]: 'mk-123',
      OPENAI_BASE_URL: 'https://example.internal/v1',
    });
    expect(config?.baseUrl).toBe('https://example.internal/v1');
  });

  it('模型白名单支持逗号分隔并去空格', () => {
    const config = readMakersModelsConfig({
      [MAKERS_MODELS_KEY_ENV]: 'mk-123',
      MAKERS_MODELS: '@makers/deepseek-v4-flash, @makers/gpt-oss-120b ',
    });
    expect(config?.models).toEqual(['@makers/deepseek-v4-flash', '@makers/gpt-oss-120b']);
  });

  it('OPENAI_MODELS 优先于 MAKERS_MODELS', () => {
    const config = readMakersModelsConfig({
      [MAKERS_MODELS_KEY_ENV]: 'mk-123',
      MAKERS_MODELS: '@makers/a',
      OPENAI_MODELS: '@makers/b',
    });
    expect(config?.models).toEqual(['@makers/b']);
  });

  it('统一端点是 OpenAI 兼容协议路径', () => {
    expect(MAKERS_MODELS_BASE_URL).toBe('https://ai-gateway.edgeone.link/v1');
  });
});
