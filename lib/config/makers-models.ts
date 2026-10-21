/**
 * 腾讯云 EdgeOne Makers Models 统一模型网关适配。
 *
 * 官方文档：https://cloud.tencent.com/document/product/1552/132748
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

/** 可选的模型白名单环境变量名（逗号分隔）。 */
export const MAKERS_MODELS_ENV = 'MAKERS_MODELS';

/** 解析出来的 Makers Models 接入参数。 */
export interface MakersModelsConfig {
  /** 网关鉴权 Key。 */
  apiKey: string;
  /** 统一端点。 */
  baseUrl: string;
  /** 可选模型白名单；未配置表示不限制。 */
  models?: string[];
}

/**
 * 读取 Makers Models 接入参数。
 *
 * 优先级：
 *  - Key：`MAKERS_MODELS_KEY`（EdgeOne 原生变量名）。
 *    若运维同时显式配置了 `OPENAI_API_KEY`，交由调用方决定，本函数不越权覆盖。
 *  - 端点：`OPENAI_BASE_URL` 优先，其次退回 Makers 统一网关。
 *  - 模型白名单：`OPENAI_MODELS` 优先，其次 `MAKERS_MODELS`。
 *
 * 未配置 Key 时返回 undefined，表示「没有启用 Makers Models」。
 */
export function readMakersModelsConfig(
  env: Record<string, string | undefined> = process.env,
): MakersModelsConfig | undefined {
  const apiKey = env[MAKERS_MODELS_KEY_ENV]?.trim();
  if (!apiKey) return undefined;

  const models = (env.OPENAI_MODELS ?? env[MAKERS_MODELS_ENV] ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return {
    apiKey,
    baseUrl: env.OPENAI_BASE_URL?.trim() || MAKERS_MODELS_BASE_URL,
    models: models.length > 0 ? models : undefined,
  };
}
