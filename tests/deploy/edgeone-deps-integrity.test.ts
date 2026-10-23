import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isInside, outsideRepoTemp } from '@/scripts/edgeone-temp.mjs';
import { extractMissingPackages } from '@/scripts/verify-edgeone-runtime.mjs';
import { hasJsEntryForTest, listPackageDirs } from '@/scripts/verify-edgeone-deps.mjs';

/**
 * 「探针必须放在仓库之外」这道护栏的回归。
 *
 * ## 为什么它值得单独守
 *
 * 探针一旦落在仓库里，Node 沿父目录向上找 node_modules 就会找到仓库根的
 * 那一份，把**产物里缺失的文件全给补上**。于是：
 *
 *   - 本地门禁全绿；
 *   - 线上却是空体 500。
 *
 * 这不是假设：本项目就栽在这上面，而且**长期**栽着——受限环境里 TMPDIR
 * 常常被指到仓库内的临时目录，`os.tmpdir()` 于是返回仓库内的路径，
 * 「仓库外的探针」其实一直在仓库内。
 */
describe('outsideRepoTemp', () => {
  it('产出的目录一定不在仓库内', () => {
    const repo = mkdtempSync(join(tmpdir(), 'repo-sim-'));
    const dir = outsideRepoTemp('probe', repo);
    expect(isInside(repo, dir)).toBe(false);
  });

  it('即使 TMPDIR 指向仓库内，也必须绕开它', () => {
    const repo = mkdtempSync(join(tmpdir(), 'repo-sim-'));
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = repo;
    try {
      const dir = outsideRepoTemp('probe', repo);
      expect(isInside(repo, dir)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  });

  it('isInside 能区分「同级目录」与「真子目录」', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
  });
});

/**
 * 运行期错误 → 「缺哪个包」。
 *
 * 这条映射是补包循环的输入：认错了就补错包（或者该补的不补）。
 */
describe('extractMissingPackages', () => {
  it('认得出 "Cannot find package \'x\'" 形态', () => {
    const lines = [
      "Failed to load external module @earendil-works/pi-agent-core-5d2: Error: Cannot find package 'yaml' imported from /x/y.js",
    ];
    expect(extractMissingPackages(lines)).toEqual(['yaml']);
  });

  it('认得出 "Cannot find module \'…/deps/<pkg>/…\'" 形态', () => {
    const lines = [
      "Failed to load external module postcss-9745: Error: Cannot find module '/tmp/pkg/deps/nanoid/non-secure/index.js'",
    ];
    expect(extractMissingPackages(lines)).toEqual(['nanoid']);
  });

  it('作用域包的路径形态也能认出来', () => {
    const lines = [
      "Failed to load external module x: Error: Cannot find module '/tmp/pkg/deps/@scope/inner/lib.js'",
    ];
    expect(extractMissingPackages(lines)).toEqual(['@scope/inner']);
  });

  it('与缺包无关的错误不产出包名', () => {
    const lines = [
      'Failed to load external module sharp-20c: Error: Could not load the "sharp" module using the darwin-arm64 runtime',
    ];
    expect(extractMissingPackages(lines)).toEqual([]);
  });
});

/**
 * 依赖完整性校验的判定基础：原生二进制包（没有 JS 入口）不算「装不上」。
 */
describe('listPackageDirs / hasJsEntryForTest', () => {
  it('列出顶层包，并正确处理 @scope 两级结构', () => {
    const root = mkdtempSync(join(tmpdir(), 'deps-sim-'));
    mkdirSync(join(root, 'plain'), { recursive: true });
    mkdirSync(join(root, '@scope', 'inner'), { recursive: true });
    writeFileSync(join(root, 'plain', 'package.json'), '{"name":"plain"}');
    writeFileSync(join(root, '@scope', 'inner', 'package.json'), '{"name":"@scope/inner"}');

    const names = listPackageDirs(root)
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(['@scope/inner', 'plain']);
  });

  it('没有 JS 入口的原生包不算有 JS 入口', () => {
    const root = mkdtempSync(join(tmpdir(), 'native-sim-'));
    mkdirSync(join(root, 'sharp-linux-x64'), { recursive: true });
    writeFileSync(join(root, 'sharp-linux-x64', 'package.json'), '{"name":"@img/sharp-linux-x64"}');
    expect(hasJsEntryForTest(join(root, 'sharp-linux-x64'))).toBe(false);

    const withJs = mkdtempSync(join(tmpdir(), 'js-sim-'));
    mkdirSync(join(withJs, 'pkg'), { recursive: true });
    writeFileSync(join(withJs, 'pkg', 'package.json'), '{"name":"pkg","main":"index.js"}');
    expect(hasJsEntryForTest(join(withJs, 'pkg'))).toBe(true);
  });
});
