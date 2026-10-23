/**
 * Verify that iframes rendering inline HTML (srcDoc) never combine
 * `allow-scripts` with `allow-same-origin` in their sandbox attribute.
 *
 * Per the HTML spec, the combination of allow-scripts + allow-same-origin on a
 * srcDoc iframe effectively negates the sandbox — the embedded document is
 * treated as same-origin with the parent, so any script inside can reach the
 * parent's cookies, localStorage, and DOM.
 *
 * ## 为什么改成「扫描仓库」而不是硬编码文件清单
 *
 * 早期版本逐个硬编码文件路径（`components/...`、`lib/video-export/...`）。
 * 删掉一个上游外壳，那条用例就读不到文件了——报错是 ENOENT，
 * 看起来像环境坏了，而不是「被守护的性质变了」；更糟的是它**不再守护任何东西**，
 * 却仍留在测试报告里冒充一条护栏。
 *
 * 现在反过来：**扫描仓库里所有同时出现 `srcDoc` 与 `sandbox=` 的源文件**，
 * 逐个断言它们的 sandbox 字符串没有同时出现两个危险 token。
 * 新增或删除发射器，这条护栏都自动跟着走。
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.edgeone',
  '.tmp',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** Extract all `sandbox="..."` attribute values from a source file. */
function extractSandboxValues(filePath: string): string[] {
  const src = readFileSync(filePath, 'utf-8');
  const matches = [...src.matchAll(/sandbox=["'`]([^"'`]+)["'`]/g)];
  return matches.map((m) => m[1]);
}

/**
 * Returns true if the sandbox value is dangerous for srcDoc content:
 * both allow-scripts AND allow-same-origin.
 */
function isDangerousSandbox(sandbox: string): boolean {
  const tokens = sandbox.split(/\s+/);
  return tokens.includes('allow-scripts') && tokens.includes('allow-same-origin');
}

/** 递归收集仓库里的源文件（跳过依赖与构建产物目录）。 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') && entry !== '.') continue;
    const full = join(dir, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

/** 找出所有「既渲染 srcDoc、又设置了 sandbox」的源文件。 */
function findSrcDocSandboxEmitters(): string[] {
  return collectSourceFiles(ROOT).filter((file) => {
    const src = readFileSync(file, 'utf-8');
    return src.includes('srcDoc') && /sandbox=["'`]/.test(src);
  });
}

describe('iframe sandbox safety', () => {
  test('InteractiveIframeHost does not combine allow-scripts + allow-same-origin', () => {
    const sandboxes = extractSandboxValues(
      join(ROOT, 'components/scene-renderers/InteractiveIframeHost.tsx'),
    );
    expect(sandboxes.length).toBeGreaterThan(0);
    for (const sandbox of sandboxes) {
      expect(isDangerousSandbox(sandbox)).toBe(false);
    }
  });

  test('ThumbnailInteractive does not combine allow-scripts + allow-same-origin', () => {
    const sandboxes = extractSandboxValues(
      join(ROOT, 'components/slide-renderer/components/ThumbnailInteractive/index.tsx'),
    );
    expect(sandboxes.length).toBeGreaterThan(0);
    for (const sandbox of sandboxes) {
      expect(isDangerousSandbox(sandbox)).toBe(false);
    }
  });

  test('every srcDoc + sandbox emitter in the repository stays null-origin', () => {
    const emitters = findSrcDocSandboxEmitters();
    // 至少要有发射器被扫到，否则这条断言是空的（恒真）。
    expect(emitters.length).toBeGreaterThan(0);
    // 关键的两个发射器必须落在扫描结果里。
    const names = emitters.map((file) => relative(ROOT, file));
    expect(names).toContain('components/scene-renderers/InteractiveIframeHost.tsx');
    expect(names).toContain('components/slide-renderer/components/ThumbnailInteractive/index.tsx');

    const offenders: string[] = [];
    for (const file of emitters) {
      for (const sandbox of extractSandboxValues(file)) {
        if (isDangerousSandbox(sandbox)) offenders.push(`${relative(ROOT, file)}: ${sandbox}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
