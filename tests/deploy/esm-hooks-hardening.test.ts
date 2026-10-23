/**
 * ESM 解析钩子的加固回归测试（第十二轮独立复审 建议项 2 / 建议项 3）。
 *
 * ## 建议项 2：注册失败不能「静默崩溃」
 *
 * 函数入口（函数包里的 index.mjs）需要注册本钩子。裸调 `module.register()`
 * 一旦抛错（Node < 20.6 没有这个 API、钩子文件路径不对、钩子线程起不来……），
 * 异常会在**入口最前面**抛出，函数直接崩掉，平台侧只看到「函数起不来」。
 * 所以入口应该调用本文件导出的 `registerEsmHooks()`：它把异常接住、
 * 打印可读诊断、并返回 `{ok:false}`，让入口能给出可读的错误。
 *
 * ## 建议项 3：字段优先级必须对齐 Node 的 ESM 解析
 *
 * Node 只认 `exports` → `import` → `main`，**根本不读 `module`**。
 * 钩子之前把 `module` 排在 `main` 前面，等于「拿 bundler 的规矩解析 Node 的 import」。
 *
 * ## 断言为什么用「子进程 + 真 import」
 *
 * 钩子的作用是让 Node 的 ESM 解析器在默认解析失败时找到 `deps/` 下的包。
 * 直接调函数只能验证「它返回了一个看起来对的 URL」，验证不了
 * 「Node 真的会加载它」。所以这里起**独立子进程**（工作目录在仓库之外，
 * 默认解析找不到任何 node_modules），注册钩子后真 `import()`，
 * 再看进程退出码与输出——和 tests/deploy/esm-hooks.test.ts 同一套路。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerEsmHooks } from '../../scripts/edgeone-esm-hooks.mjs';

const REPO_ROOT = process.cwd();
const HOOK_SOURCE = join(REPO_ROOT, 'scripts', 'edgeone-esm-hooks.mjs');

/**
 * 搭一个「像函数包」的目录：deps/ 下有若干包，钩子与包同级。
 *
 * 两个包是冲着字段优先级去的：
 *   - `exports-pkg`：同时有 exports / main / module 三个字段；
 *   - `main-first-pkg`：**没有** exports，只有 main / module。
 */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'eo-esm-priority-'));
  const deps = join(root, 'deps');

  // (1) exports / main / module 三个入口都存在 → 必须是 **exports** 赢。
  const exportsPkg = join(deps, 'exports-pkg');
  mkdirSync(join(exportsPkg, 'dist'), { recursive: true });
  writeFileSync(
    join(exportsPkg, 'package.json'),
    JSON.stringify({
      name: 'exports-pkg',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './dist/exports.js' } },
      main: './main.js',
      module: './module.js',
    }),
  );
  writeFileSync(join(exportsPkg, 'dist', 'exports.js'), 'export const ok = "exports";\n');
  writeFileSync(join(exportsPkg, 'main.js'), 'export const ok = "main";\n');
  writeFileSync(join(exportsPkg, 'module.js'), 'export const ok = "module";\n');

  // (2) 只有 main / module（没有 exports）→ 必须是 **main** 赢（Node 语义）。
  const mainFirst = join(deps, 'main-first-pkg');
  mkdirSync(mainFirst, { recursive: true });
  writeFileSync(
    join(mainFirst, 'package.json'),
    JSON.stringify({
      name: 'main-first-pkg',
      version: '1.0.0',
      main: './main.js',
      module: './module.mjs',
    }),
  );
  writeFileSync(join(mainFirst, 'main.js'), 'module.exports = { ok: "main" };\n');
  writeFileSync(join(mainFirst, 'module.mjs'), 'export const ok = "module";\n');

  cpSync(HOOK_SOURCE, join(root, 'esm-hooks.mjs'));
  return root;
}

/** 在子进程里注册钩子并 import 若干裸标识符，返回结果与退出码。 */
function runProbe(root: string, specs: string[]) {
  const probeFile = join(root, 'probe.mjs');
  writeFileSync(
    probeFile,
    [
      "import { register } from 'node:module';",
      `register(${JSON.stringify(pathToFileURL(join(root, 'esm-hooks.mjs')).href)});`,
      'const failures = [];',
      'const loaded = [];',
      `for (const spec of ${JSON.stringify(specs)}) {`,
      '  try {',
      '    const mod = await import(spec);',
      '    // CJS 包被 ESM 导入时具名导出在 default 上；ESM 包直接是具名导出。',
      '    const value = mod.ok ?? mod.default?.ok ?? null;',
      '    loaded.push(spec + ":" + JSON.stringify(value));',
      '  } catch (error) {',
      '    failures.push(spec + ":" + (error && error.code ? error.code : String(error)));',
      '  }',
      '}',
      'console.log("LOADED " + JSON.stringify(loaded));',
      'console.log("FAILED " + JSON.stringify(failures));',
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

describe('ESM 钩子的字段优先级（建议项 3）', () => {
  it('exports / main / module 同时存在时，走 **exports**', () => {
    const root = createFixture();
    try {
      const result = runProbe(root, ['exports-pkg']);
      expect(parseSection(result.stdout, 'FAILED')).toEqual([]);
      expect(parseSection(result.stdout, 'LOADED').join(' ')).toContain('"exports"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('没有 exports、只有 main / module 时，走 **main**（Node 的 ESM 语义）', () => {
    const root = createFixture();
    try {
      const result = runProbe(root, ['main-first-pkg']);
      expect(parseSection(result.stdout, 'FAILED')).toEqual([]);
      // 关键断言：不是 "module"——`module` 字段 Node 根本不认。
      expect(parseSection(result.stdout, 'LOADED').join(' ')).toContain('"main"');
      expect(parseSection(result.stdout, 'LOADED').join(' ')).not.toContain('"module"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ESM 钩子的注册兜底（建议项 2）', () => {
  it('注册抛错时不崩：打印可读诊断并返回 ok:false', async () => {
    const logs: string[] = [];
    const result = await registerEsmHooks({
      register: () => {
        throw new Error('boom: hooks thread died');
      },
      log: (message: string) => logs.push(message),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
    const text = logs.join('\n');
    // 诊断必须说清「钩子没注册上 → 裸标识符会 ERR_MODULE_NOT_FOUND」。
    expect(text).toContain('ESM 解析钩子注册失败');
    expect(text).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('注册成功时返回 ok:true 并打印已注册', async () => {
    const logs: string[] = [];
    const seen: unknown[][] = [];
    const result = await registerEsmHooks({
      register: (...args: unknown[]) => {
        seen.push(args);
      },
      log: (message: string) => logs.push(message),
    });
    expect(result.ok).toBe(true);
    expect(logs.join('\n')).toContain('ESM 解析钩子已注册');
    // 钩子文件与父模块 URL 都要传给 register。
    expect(seen).toHaveLength(1);
    expect(String(seen[0][0])).toContain('edgeone-esm-hooks.mjs');
  });

  it('默认路径（真调 module.register）在子进程里跑得通', () => {
    // 放在子进程里跑：真在 vitest worker 里注册钩子会影响同进程后续的 import。
    const root = mkdtempSync(join(tmpdir(), 'eo-esm-register-'));
    try {
      const probeFile = join(root, 'probe.mjs');
      writeFileSync(
        probeFile,
        [
          `import { registerEsmHooks } from ${JSON.stringify(pathToFileURL(HOOK_SOURCE).href)};`,
          'const result = await registerEsmHooks();',
          "console.log('OK ' + result.ok);",
          '',
        ].join('\n'),
        'utf-8',
      );
      const result = spawnSync(process.execPath, [probeFile], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('OK true');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
