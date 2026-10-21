import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LLM provider 的运维侧强制关闭开关。
 *
 * 上游原本只对能力段（tts / asr / image / video / webSearch）支持
 * `enabled: false`，LLM 段没有这个开关——但 EdgeOne 会自动注入
 * `MAKERS_MODELS_KEY`，运维需要一条真正能关掉某个 LLM provider 的途径。
 *
 * 本文件用与上游 `tests/server/provider-config.test.ts` 相同的 fs mock 方式
 * 注入 `server-providers.yml`，单独成文件以免改动上游测试基线。
 */
let yamlOverride: string | null = null;

const LLM_ENV_PREFIXES = [
  'OPENAI',
  'AZURE_OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'DEEPSEEK',
  'QWEN',
  'KIMI',
  'MINIMAX',
  'GLM',
  'SILICONFLOW',
  'DOUBAO',
  'OPENROUTER',
  'GROK',
  'TENCENT',
  'TENCENT_HUNYUAN',
  'XIAOMI',
  'MIMO',
  'TOKENDANCE',
  'OLLAMA',
  'BEDROCK',
];

function clearEnv() {
  for (const prefix of LLM_ENV_PREFIXES) {
    delete process.env[`${prefix}_API_KEY`];
    delete process.env[`${prefix}_BASE_URL`];
    delete process.env[`${prefix}_MODELS`];
    delete process.env[`${prefix}_ENABLED`];
  }
  delete process.env.MAKERS_MODELS_KEY;
  delete process.env.MAKERS_MODELS;
  delete process.env.OPENAI_BASE_URL;
}

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isYaml = (p: unknown) => typeof p === 'string' && p.endsWith('server-providers.yml');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
      readFileSync: (p: string, ...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
    },
    existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
    readFileSync: (p: string, ...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
  };
});

describe('LLM provider 的强制关闭开关', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearEnv();
    yamlOverride = null;
  });

  it('YAML 里 enabled:false 的 provider 拿不到任何密钥', async () => {
    yamlOverride = 'providers:\n  openai:\n    enabled: false\n';
    vi.stubEnv('OPENAI_API_KEY', 'sk-server');
    const { resolveApiKey } = await import('@/lib/server/provider-config');
    // 被关闭 ⇒ 管理员所有且不可用：服务端密钥不生效，客户端密钥也不生效。
    expect(resolveApiKey('openai', 'sk-client')).toBe('');
  });

  it('被关闭的 provider 以 disabled 标记回传客户端（而不是被悄悄丢弃）', async () => {
    // 丢弃它会让客户端把它当成"未托管"的 BYOK 项：用户填的 Key 被服务端静默
    // 丢弃，最后只看到一个语焉不详的 401。
    yamlOverride = 'providers:\n  openai:\n    enabled: false\n';
    vi.stubEnv('OPENAI_API_KEY', 'sk-server');
    const { getServerProviders } = await import('@/lib/server/provider-config');
    expect(getServerProviders().openai).toEqual({ disabled: true });
  });

  it('OPENAI_ENABLED=false 同样能关闭（EdgeOne 控制台只能配环境变量）', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-server');
    vi.stubEnv('OPENAI_ENABLED', 'false');
    const { resolveApiKey, getServerProviders } = await import('@/lib/server/provider-config');
    expect(resolveApiKey('openai', 'sk-client')).toBe('');
    expect(getServerProviders().openai).toEqual({ disabled: true });
  });

  it('Makers 自动注入不会复活被关闭的 openai', async () => {
    yamlOverride = 'providers:\n  openai:\n    enabled: false\n';
    vi.stubEnv('MAKERS_MODELS_KEY', 'mk-123');
    const { resolveApiKey, getServerProviders } = await import('@/lib/server/provider-config');
    expect(resolveApiKey('openai')).toBe('');
    expect(getServerProviders().openai).toEqual({ disabled: true });
  });

  it('没有关闭开关时，Makers 的 Key 与内置模型正常生效', async () => {
    vi.stubEnv('MAKERS_MODELS_KEY', 'mk-123');
    const { resolveApiKey, getServerProviders } = await import('@/lib/server/provider-config');
    expect(resolveApiKey('openai')).toBe('mk-123');
    expect(getServerProviders().openai?.models).toEqual(['@makers/deepseek-v4-flash']);
  });

  it('OPENAI_ENABLED=true 显式打开时覆盖 YAML 的关闭（环境变量优先）', async () => {
    yamlOverride = 'providers:\n  openai:\n    enabled: false\n';
    vi.stubEnv('OPENAI_API_KEY', 'sk-server');
    vi.stubEnv('OPENAI_ENABLED', 'true');
    const { resolveApiKey, getServerProviders } = await import('@/lib/server/provider-config');
    expect(resolveApiKey('openai')).toBe('sk-server');
    expect(getServerProviders().openai).toBeDefined();
  });

  it('未设置 _ENABLED 时视为"没有意见"，不会覆盖 YAML 的关闭', async () => {
    yamlOverride = 'providers:\n  openai:\n    enabled: false\n';
    vi.stubEnv('OPENAI_API_KEY', 'sk-server');
    vi.stubEnv('OPENAI_ENABLED', '');
    const { resolveApiKey } = await import('@/lib/server/provider-config');
    expect(resolveApiKey('openai')).toBe('');
  });
});
