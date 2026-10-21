/**
 * Makers Models 常量的 .mjs 镜像。
 *
 * `lib/config/makers-models.ts` 是 TypeScript 模块，Node 脚本直接 import
 * 需要类型剥离；这里镜像同一组常量，让纯 Node 脚本零依赖运行。
 * 两处数值必须保持一致（由 tests/physics/makers-models.test.ts 校验）。
 */
export const MAKERS_MODELS_BASE_URL = 'https://ai-gateway.edgeone.link/v1';
export const MAKERS_MODELS_PROVIDER_ID = 'openai';
export const MAKERS_MODELS_KEY_ENV = 'MAKERS_MODELS_KEY';
export const MAKERS_MODELS_BUILTIN_MODEL = '@makers/deepseek-v4-flash';
