/**
 * 腾讯云 EdgeOne Makers Models 统一模型网关适配。
 *
 * 官方文档：https://cloud.tencent.com/document/product/1552/132748
 * 配额文档：https://cloud.tencent.com/document/product/1552/132789
 * 模板部署注入的环境变量：https://cloud.tencent.com/document/product/1552/132759
 *
 * Makers Models 是部署在 EdgeOne 边缘节点的统一模型接入服务，对外暴露
 * OpenAI 兼容协议：
 *
 *   端点    https://ai-gateway.edgeone.link/v1
 *   鉴权    Authorization: Bearer <MAKERS_MODELS_KEY>
 *   模型名  @makers/<model>（例如 @makers/deepseek-v4-flash）
 *
 * 价值在于「无需自备厂商密钥」：EdgeOne 控制台签发一个 Makers API Key 即可
 * 调用多家主流大模型，现场演示不必额外准备 DeepSeek / OpenAI 等第三方账号。
 *
 * 本模块只负责「读环境变量 → 解析出接入参数」这一层纯逻辑；
 * 把参数装配进 OpenMAIC 的 provider 表由 `lib/server/provider-config.ts` 完成，
 * 以免领域层依赖服务端装配细节。
 */

/** Makers Models 统一网关的默认端点（OpenAI 兼容）。 */
export const MAKERS_MODELS_BASE_URL = 'https://ai-gateway.edgeone.link/v1';

/** EdgeOne 控制台签发的 Makers API Key 环境变量名。 */
export const MAKERS_MODELS_KEY_ENV = 'MAKERS_MODELS_KEY';

/**
 * 平台「模板部署」自动注入的网关鉴权 Key 变量名。
 *
 * 官方文档 132759 明确：使用模板部署时平台会自动注入
 * `AI_GATEWAY_API_KEY` 与 `AI_GATEWAY_BASE_URL`（默认 `https://ai-gateway.edgeone.link/v1`），
 * 业务代码通过 `context.env` 读取即可。
 *
 * 直接上传（CLI deploy）不会注入这两个变量，Key 由运维在控制台配成
 * `MAKERS_MODELS_KEY`。两种入口都要能跑，所以这里**两个名字都认**，
 * 原生变量名优先。
 */
export const AI_GATEWAY_API_KEY_ENV = 'AI_GATEWAY_API_KEY';

/** 平台模板部署注入的网关地址变量名（与上面的 Key 配套）。 */
export const AI_GATEWAY_BASE_URL_ENV = 'AI_GATEWAY_BASE_URL';

/** 可选的模型白名单环境变量名（逗号分隔）。 */
export const MAKERS_MODELS_ENV = 'MAKERS_MODELS';

/**
 * 官方文档示例使用的内置模型名。
 *
 * 平台「内置模型开箱即用：无需绑定自费厂商密钥即可调用」（132748 核心能力）。
 * 当运维既没有配置 `MAKERS_MODELS` 白名单、也没有显式配置 `DEFAULT_MODEL` 时，
 * 用它兜底，避免出现"配了 Key 却说没有可用模型"。
 */
export const MAKERS_MODELS_BUILTIN_MODEL = '@makers/deepseek-v4-flash';

/** 在 OpenMAIC 的 provider 表里，Makers Models 映射到的 provider id。 */
export const MAKERS_MODELS_PROVIDER_ID = 'openai';

/** 解析出来的 Makers Models 接入参数。 */
export interface MakersModelsConfig {
  /** 网关鉴权 Key。 */
  apiKey: string;
  /** 统一端点。 */
  baseUrl: string;
  /** 可选模型白名单；未配置时回落到官方内置模型。 */
  models?: string[];
  /**
   * 自动推导的默认模型串，形式为 `openai:<model>`。
   *
   * OpenMAIC 的 `DEFAULT_MODEL` 必须带 provider 前缀，否则解析不出
   * providerId，模型解析会直接失败。运维显式配置了 `DEFAULT_MODEL` 时，
   * 以运维的为准，本值仅作兜底。
   */
  defaultModel: string;
}

/**
 * 读取 Makers Models 接入参数。
 *
 * 优先级：
 *  - Key：`MAKERS_MODELS_KEY`（EdgeOne 原生变量名）优先，
 *    其次 `AI_GATEWAY_API_KEY`（平台模板部署注入的变量名，见 132759）。
 *    若运维同时显式配置了 `OPENAI_API_KEY`，交由调用方决定，本函数不越权覆盖。
 *  - 端点：`OPENAI_BASE_URL` → `AI_GATEWAY_BASE_URL` → Makers 统一网关默认端点。
 *  - 模型白名单：`OPENAI_MODELS` 优先，其次 `MAKERS_MODELS`；
 *    两者都没配时回落到官方内置模型，保证"只配 Key"也能跑通。
 *
 * 未配置 Key 时返回 undefined，表示「没有启用 Makers Models」。
 */
export function readMakersModelsConfig(
  env: Record<string, string | undefined> = process.env,
): MakersModelsConfig | undefined {
  // Key：原生变量名优先，其次是平台模板部署注入的 AI_GATEWAY_API_KEY。
  const apiKey = env[MAKERS_MODELS_KEY_ENV]?.trim() || env[AI_GATEWAY_API_KEY_ENV]?.trim();
  if (!apiKey) return undefined;

  const models = (env.OPENAI_MODELS ?? env[MAKERS_MODELS_ENV] ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  const effectiveModels = models.length > 0 ? models : [MAKERS_MODELS_BUILTIN_MODEL];

  return {
    apiKey,
    baseUrl:
      env.OPENAI_BASE_URL?.trim() || env[AI_GATEWAY_BASE_URL_ENV]?.trim() || MAKERS_MODELS_BASE_URL,
    models: effectiveModels,
    defaultModel: `${MAKERS_MODELS_PROVIDER_ID}:${effectiveModels[0]}`,
  };
}

/**
 * 推导默认模型串（`provider:model` 形式）。
 *
 * 供 `DEFAULT_MODEL` 缺省时兜底：只配了 `MAKERS_MODELS_KEY` 也能跑通，
 * 不必再手写一遍 `openai:` 前缀。运维自己配了 `OPENAI_API_KEY` 时，
 * Makers 通道不接管，本函数返回 undefined。
 */
export function resolveMakersDefaultModel(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.OPENAI_API_KEY?.trim()) return undefined;
  return readMakersModelsConfig(env)?.defaultModel;
}
