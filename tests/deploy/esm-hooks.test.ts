/**
 * ESM 解析钩子的回归测试。
 *
 * 这个钩子是线上 5xx 的关键修复：EdgeOne Pages 剥离 `node_modules`，
 * 而 Turbopack 的 `externalImport` 走的是原生 `await import(id)`，
 * ESM 又不认 `NODE_PATH` —— 没有钩子就必然
 * `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg-<hash>'`。
 *
 * ## 为什么用「子进程 + 真 import」而不是直接调函数
 *
 * 断言必须打在**真正的匹配源**上：
 * 钩子的作用是让 Node 的 ESM 解析器在默认解析失败时找到 `deps/` 下的包。
 * 直接调用 `resolve()` 只能验证它「返回了一个看起来对的 URL」，
 * 验证不了「Node 真的会用它加载」。
 * 所以这里起一个**独立子进程**（工作目录放在仓库之外，
 * 默认解析找不到任何 `node_modules`），注册钩子后真 `import()`，
 * 再看进程退出码与输出。
 *
 * 这也顺带验证了「钩子在没有 node_modules 的环境里确实起作用」——
 * 这正是平台上的情形。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const HOOK_SOURCE = join(REPO_ROOT, 'scripts', 'edgeone-esm-hooks.mjs');

/** 搭一个「像函数包」的目录：deps/ 下有若干包，钩子与包同级。 */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'eo-esm-hooks-'));
  const deps = join(root, 'deps');

  // 1) 普通 CJS 包（main 入口）
  mkdirSync(join(deps, 'plain-pkg'), { recursive: true });
  writeFileSync(
    join(deps, 'plain-pkg', 'package.json'),
    JSON.stringify({ name: 'plain-pkg', version: '1.0.0', main: 'index.js' }),
  );
  writeFileSync(join(deps, 'plain-pkg', 'index.js'), 'module.exports = { ok: "plain" };\n');

  // 2) ESM 包（exports["."].import）
  mkdirSync(join(deps, 'esm-pkg', 'dist'), { recursive: true });
  writeFileSync(
    join(deps, 'esm-pkg', 'package.json'),
    JSON.stringify({
      name: 'esm-pkg',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './dist/index.js' } },
    }),
  );
  writeFileSync(join(deps, 'esm-pkg', 'dist', 'index.js'), 'export const ok = "esm";\n');

  // 3) 带**哈希别名**的包 + exports 子路径（Turbopack 的真实形态）
  mkdirSync(join(deps, 'pg-587764f78a6c7a9c', 'dist'), { recursive: true });
  writeFileSync(
    join(deps, 'pg-587764f78a6c7a9c', 'package.json'),
    JSON.stringify({
      name: 'pg-587764f78a6c7a9c',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { import: './dist/index.js' },
        './node': { import: './dist/node.js' },
      },
    }),
  );
  writeFileSync(
    join(deps, 'pg-587764f78a6c7a9c', 'dist', 'index.js'),
    'export const ok = "alias";\n',
  );
  writeFileSync(
    join(deps, 'pg-587764f78a6c7a9c', 'dist', 'node.js'),
    'export const ok = "alias-subpath";\n',
  );

  // 4) scoped 包
  mkdirSync(join(deps, '@scope', 'pkg'), { recursive: true });
  writeFileSync(
    join(deps, '@scope', 'pkg', 'package.json'),
    JSON.stringify({ name: '@scope/pkg', version: '1.0.0', main: 'index.js' }),
  );
  writeFileSync(join(deps, '@scope', 'pkg', 'index.js'), 'module.exports = { ok: "scoped" };\n');

  cpSync(HOOK_SOURCE, join(root, 'esm-hooks.mjs'));
  return root;
}

/** 在子进程里注册钩子并 import 若干裸标识符，返回结果与退出码。 */
function runProbe(root: string, specs: string[]): { code: number; stdout: string; stderr: string } {
  const probeFile = join(root, 'probe.mjs');
  writeFileSync(
    probeFile,
    [
      "import { register } from 'node:module';",
      "import { pathToFileURL } from 'node:url';",
      `register(pathToFileURL(${JSON.stringify(join(root, 'esm-hooks.mjs'))}).href);`,
      'const failures = [];',
      'const loaded = [];',
      'for (const spec of ' + JSON.stringify(specs) + ') {',
      '  try {',
      '    const mod = await import(spec);',
      '    // CJS 包被 ESM 导入时，具名导出在 default 上；ESM 包直接是具名导出。',
      '    const value = mod.ok ?? mod.default?.ok ?? null;',
      "    loaded.push(spec + ':' + JSON.stringify(value));",
      '  } catch (error) {',
      "    failures.push(spec + ':' + (error && error.code ? error.code : String(error)));",
      '  }',
      '}',
      "console.log('LOADED ' + JSON.stringify(loaded));",
      "console.log('FAILED ' + JSON.stringify(failures));",
      '',
    ].join('\n'),
    'utf-8',
  );
  const result = spawnSync(process.execPath, [probeFile], {
    // 工作目录在仓库之外：默认解析找不到任何 node_modules，只剩 deps/ 一条路。
    cwd: root,
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseSection(stdout: string, label: string): string[] {
  const match = stdout.match(new RegExp(`${label} (\\[.*?\\])`));
  return match ? (JSON.parse(match[1]) as string[]) : [];
}

describe('ESM 解析钩子（EdgeOne Pages 云函数）', () => {
  it('默认解析失败时把裸标识符解析到 deps/ 下的同名包', () => {
    const root = createFixture();
    try {
      const result = runProbe(root, ['plain-pkg', 'esm-pkg', 'pg-587764f78a6c7a9c', '@scope/pkg']);
      const failures = parseSection(result.stdout, 'FAILED');
      expect(failures).toEqual([]);
      const loaded = parseSection(result.stdout, 'LOADED');
      expect(loaded.join(' ')).toContain('plain-pkg:"plain"');
      expect(loaded.join(' ')).toContain('esm-pkg:"esm"');
      expect(loaded.join(' ')).toContain('pg-587764f78a6c7a9c:"alias"');
      expect(loaded.join(' ')).toContain('@scope/pkg:"scoped"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('支持 exports 子路径（Turbopack 别名的 <别名>/<子路径> 形态）', () => {
    const root = createFixture();
    try {
      const result = runProbe(root, ['pg-587764f78a6c7a9c/node']);
      expect(parseSection(result.stdout, 'FAILED')).toEqual([]);
      expect(parseSection(result.stdout, 'LOADED').join(' ')).toContain('"alias-subpath"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('deps/ 里没有的包仍然按默认语义失败（钩子不吞错、不静默放行）', () => {
    const root = createFixture();
    try {
      const result = runProbe(root, ['not-installed-anywhere']);
      const failures = parseSection(result.stdout, 'FAILED');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
