/**
 * Prompt loader for packaged Markdown templates and snippets.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedPrompt, PromptId, PromptVariableDefaults, SnippetId } from './types.js';

/**
 * 定位提示词模板目录（`templates/` 与 `snippets/` 的父目录）。
 *
 * ## 为什么不能只按 `import.meta.url` 推
 *
 * 本地与「以包的形式运行」时，`dist/prompts/loader.js` 往上两层就是包根，
 * 模板就在那里。但**被打包器内联进应用产物后**，`import.meta.url` 指向的是
 * 应用自己的 chunk（例如 `.../server/chunks/xxx.js`），往上两层是产物目录，
 * 根本没有 `templates/` —— 于是 `loadPrompt()` 返回 null，接口报
 * `Prompt template not found`。
 *
 * 这个故障**只在产物里出现**：本地跑源码时路径恰好是对的。
 * EdgeOne 上实测踩过（生成课堂 500）。
 *
 * ## 做法
 *
 * 依次尝试候选目录，取第一个真的含 `templates/` 的：
 *   1. 模块自身位置（包形态，本地与 deps/ 实体化后都对）；
 *   2. `<cwd>/deps/@openmaic/generation`（EdgeOne 函数包把依赖改名放在 deps/）；
 *   3. `<cwd>/node_modules/@openmaic/generation`（本地/常规 node 部署）。
 *
 * 都不命中时回落到 (1)，让 `loadPrompt` 照旧返回 null（行为与以前一致，不静默猜路径）。
 */
function resolvePromptsDir(): string {
  const fromModule = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const candidates = [
    fromModule,
    join(process.cwd(), 'deps', '@openmaic', 'generation'),
    join(process.cwd(), 'node_modules', '@openmaic', 'generation'),
  ];
  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, 'templates'))) return dir;
    } catch {
      /* 访问受限就当这个候选不可用 */
    }
  }
  return fromModule;
}

const DEFAULT_PROMPTS_DIR = resolvePromptsDir();

const PROMPT_VARIABLE_DEFAULTS = {
  'pbl-actions': {
    projectSummary:
      '(No generated milestones are available; introduce the project topic without inventing any.)',
  },
} satisfies PromptVariableDefaults;

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Load a snippet by ID. */
export function loadSnippet(
  snippetId: SnippetId,
  promptsDir: string = DEFAULT_PROMPTS_DIR,
): string {
  const snippetPath = join(promptsDir, 'snippets', `${snippetId}.md`);

  try {
    return readFileSync(snippetPath, 'utf-8').trim();
  } catch {
    // Fail loud rather than silently shipping `{{snippet:foo}}` to the model.
    throw new Error(`Snippet not found: ${snippetId}`);
  }
}

/** Replace snippet includes with their file content. */
export function processSnippets(
  template: string,
  promptsDir: string = DEFAULT_PROMPTS_DIR,
): string {
  return template.replace(/\{\{snippet:(\w[\w-]*)\}\}/g, (_, snippetId) => {
    return loadSnippet(snippetId as SnippetId, promptsDir);
  });
}

/** Include or remove non-nested conditional blocks according to truthiness. */
export function processConditionalBlocks(
  template: string,
  conditions: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, conditionName: string, content: string) => {
      return conditions[conditionName] ? content : '';
    },
  );
}

/** Load a prompt by ID. */
export function loadPrompt(
  promptId: PromptId,
  promptsDir: string = DEFAULT_PROMPTS_DIR,
): LoadedPrompt | null {
  const promptDir = join(promptsDir, 'templates', promptId);
  const systemPath = join(promptDir, 'system.md');
  let systemPrompt: string;

  try {
    systemPrompt = readFileSync(systemPath, 'utf-8').trim();
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  systemPrompt = processSnippets(systemPrompt, promptsDir);

  const userPath = join(promptDir, 'user.md');
  let userPromptTemplate = '';
  try {
    userPromptTemplate = readFileSync(userPath, 'utf-8').trim();
  } catch (error) {
    // user.md is optional, but only when it is genuinely absent.
    if (!isMissingFileError(error)) throw error;
  }
  userPromptTemplate = processSnippets(userPromptTemplate, promptsDir);

  return {
    id: promptId,
    systemPrompt,
    userPromptTemplate,
  };
}

/** Replace camelCase or snake_case placeholders with supplied values. */
export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  // `\w+` leaves kebab-case placeholders untouched by design.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined) return match;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

function applyPromptVariableDefaults(
  promptId: PromptId,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = PROMPT_VARIABLE_DEFAULTS[promptId as keyof typeof PROMPT_VARIABLE_DEFAULTS];
  if (!defaults) return variables;

  const resolved = { ...variables };
  for (const [key, value] of Object.entries(defaults)) {
    if (resolved[key] === undefined) resolved[key] = value;
  }
  return resolved;
}

/**
 * Build a complete prompt in this order: snippets, conditionals, variables.
 */
export function buildPrompt(
  promptId: PromptId,
  variables: Record<string, unknown>,
  promptsDir: string = DEFAULT_PROMPTS_DIR,
): { system: string; user: string } | null {
  const prompt = loadPrompt(promptId, promptsDir);
  if (!prompt) return null;
  const resolvedVariables = applyPromptVariableDefaults(promptId, variables);

  return {
    system: interpolateVariables(
      processConditionalBlocks(prompt.systemPrompt, resolvedVariables),
      resolvedVariables,
    ),
    user: interpolateVariables(
      processConditionalBlocks(prompt.userPromptTemplate, resolvedVariables),
      resolvedVariables,
    ),
  };
}
