import { describe, expect, it } from 'vitest';

import {
  AI_GATEWAY_API_KEY_ENV,
  AI_GATEWAY_BASE_URL_ENV,
  MAKERS_MODELS_BASE_URL,
  MAKERS_MODELS_BUILTIN_MODEL,
  MAKERS_MODELS_KEY_ENV,
  readMakersModelsConfig,
  resolveMakersDefaultModel,
} from '@/lib/config/makers-models';
import {
  MAKERS_MODELS_BASE_URL as SCRIPT_BASE_URL,
  MAKERS_MODELS_BUILTIN_MODEL as SCRIPT_BUILTIN_MODEL,
  MAKERS_MODELS_PROVIDER_ID as SCRIPT_PROVIDER_ID,
} from '../../scripts/makers-models.constants.mjs';

describe('EdgeOne Makers Models 统一网关适配', () => {
  it('未配置 Makers Key 时不启用', () => {
    expect(readMakersModelsConfig({})).toBeUndefined();
    expect(readMakersModelsConfig({ [MAKERS_MODELS_KEY_ENV]: '   ' })).toBeUndefined();
    expect(resolveMakersDefaultModel({})).toBeUndefined();
  });

  it('只配置 Key 时使用官方统一端点', () => {
    const config = readMakersModelsConfig({ [MAKERS_MODELS_KEY_ENV]: 'mk-123' });
    expect(config?.apiKey).toBe('mk-123');
    expect(config?.baseUrl).toBe(MAKERS_MODELS_BASE_URL);
  });

  it('平台模板部署注入的 AI_GATEWAY_API_KEY 也能启用（官方文档 132759）', () => {
    const config = readMakersModelsConfig({ [AI_GATEWAY_API_KEY_ENV]: 'gw-123' });
    expect(config?.apiKey).toBe('gw-123');
    expect(config?.baseUrl).toBe(MAKERS_MODELS_BASE_URL);
    expect(resolveMakersDefaultModel({ [AI_GATEWAY_API_KEY_ENV]: 'gw-123' })).toBe(
      `openai:${MAKERS_MODELS_BUILTIN_MODEL}`,
    );
  });

  it('原生变量名优先于模板注入的 AI_GATEWAY_API_KEY', () => {
    const config = readMakersModelsConfig({
      [MAKERS_MODELS_KEY_ENV]: 'mk-123',
      [AI_GATEWAY_API_KEY_ENV]: 'gw-123',
    });
    expect(config?.apiKey).toBe('mk-123');
  });

  it('AI_GATEWAY_BASE_URL 覆盖统一端点，但不超过 OPENAI_BASE_URL', () => {
    expect(
      readMakersModelsConfig({
        [MAKERS_MODELS_KEY_ENV]: 'mk-123',
        [AI_GATEWAY_BASE_URL_ENV]: 'https://gw.internal/v1',
      })?.baseUrl,
    ).toBe('https://gw.internal/v1');

    expect(
      readMakersModelsConfig({
        [MAKERS_MODELS_KEY_ENV]: 'mk-123',
        [AI_GATEWAY_BASE_URL_ENV]: 'https://gw.internal/v1',
        OPENAI_BASE_URL: 'https://explicit.internal/v1',
      })?.baseUrl,
    ).toBe('https://explicit.internal/v1');
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

  it('Node 脚本里的常量镜像与 TypeScript 模块保持一致', () => {
    // scripts/check-makers-models.mjs 走 .mjs 镜像，避免 Node 直接 import TS。
    expect(SCRIPT_BASE_URL).toBe(MAKERS_MODELS_BASE_URL);
    expect(SCRIPT_BUILTIN_MODEL).toBe(MAKERS_MODELS_BUILTIN_MODEL);
    expect(SCRIPT_PROVIDER_ID).toBe('openai');
  });

  it('只配 Key 也能推导出带 provider 前缀的默认模型', () => {
    // 这是"配了 Key 却说没有可用模型"的修复点：
    // DEFAULT_MODEL 必须带 provider 前缀，否则解析不出 providerId。
    const config = readMakersModelsConfig({ [MAKERS_MODELS_KEY_ENV]: 'mk-123' });
    expect(config?.models).toEqual([MAKERS_MODELS_BUILTIN_MODEL]);
    expect(config?.defaultModel).toBe(`openai:${MAKERS_MODELS_BUILTIN_MODEL}`);
    expect(resolveMakersDefaultModel({ [MAKERS_MODELS_KEY_ENV]: 'mk-123' })).toBe(
      `openai:${MAKERS_MODELS_BUILTIN_MODEL}`,
    );
  });

  it('白名单存在时默认模型取白名单第一项', () => {
    expect(
      resolveMakersDefaultModel({
        [MAKERS_MODELS_KEY_ENV]: 'mk-123',
        MAKERS_MODELS: '@makers/first, @makers/second',
      }),
    ).toBe('openai:@makers/first');
  });

  it('运维自备 OpenAI 密钥时 Makers 不接管默认模型', () => {
    expect(
      resolveMakersDefaultModel({
        [MAKERS_MODELS_KEY_ENV]: 'mk-123',
        OPENAI_API_KEY: 'sk-ops-own-key',
      }),
    ).toBeUndefined();
  });
});
