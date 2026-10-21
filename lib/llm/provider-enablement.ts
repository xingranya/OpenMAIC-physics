/**
 * LLM provider 的「管理员已停用」信号。
 *
 * 与 `lib/audio/asr-enablement.ts` 同一套模式：能力段（TTS / ASR / PDF / image /
 * video / webSearch）早已有 `serverDisabled` 通路，LLM 段此前没有——
 * 运维把某个 LLM provider 关掉之后，客户端设置页仍把它当���普通可配置项，
 * 用户填的 Key 会被服务端静默丢弃，最后只看到一个语焉不详的 401。
 *
 * 这里补上 LLM 段的对称语义：服务端把 `disabled: true` 随 provider 列表一起
 * 下发，客户端存进 `serverDisabled`，界面显灰并提示，服务端在解析模型时
 * 也会给出明确的报错，而不是让用户以为是自己的 Key 有问题。
 */

export interface LLMProviderServerControl {
  /** 管理员在服务端强制停用了这个 provider。 */
  serverDisabled?: boolean;
}

/** 停用提示文案（与 ASR 的同类提示保持同样的表达方式）。 */
export const LLM_PROVIDER_SERVER_DISABLED_MESSAGE =
  'This LLM provider is disabled by the server administrator';

/** 客户端侧：命中停用标记时返回提示文案。 */
export function getLLMProviderServerDisabledError(
  config?: LLMProviderServerControl,
): string | undefined {
  return config?.serverDisabled ? LLM_PROVIDER_SERVER_DISABLED_MESSAGE : undefined;
}
