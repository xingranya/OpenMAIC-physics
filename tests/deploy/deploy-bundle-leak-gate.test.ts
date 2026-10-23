/**
 * 产物泄露门禁的回归测试（第十二轮独立复审 建议项 1）。
 *
 * ## 为什么这一条也要测
 *
 * 门禁的 fail-closed 分支（产物里找不到 edge 函数 bundle）用 `relative()`
 * 拼错误信息，而上一轮复审发现**顶部并没有从 `node:path` 导入 `relative`**：
 * 一旦真的走到 fail-closed，抛出来的是
 * `ReferenceError: relative is not defined`，
 * 把「产物路径不对」这个真实诊断**掩盖**成了「脚本自己坏了」。
 *
 * 断言方式：**真的调用** `assertBundleHasNoEnvLeak()`，
 * 看它抛出的错误里有没有那条**相对路径**——
 * `relative` 没导入的话，这里拿到的是 ReferenceError，断言直接红。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBundleHasNoEnvLeak } from '../../scripts/deploy-edgeone.mjs';

/** 造一个临时目录当「仓库根」，避免依赖仓库里真实的构建产物。 */
function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'eo-leak-gate-'));
}

describe('产物泄露门禁（fail-closed）', () => {
  it('产物缺失：抛错并给出**相对路径**（relative 必须真的被导入）', () => {
    const root = createTempRoot();
    try {
      const missing = join(root, 'edge-functions', 'index.js');
      expect(() => assertBundleHasNoEnvLeak(missing, { root })).toThrow(
        /产物泄露门禁找不到 edge 函数产物：edge-functions[/\\]index\.js/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('产物里有白名单外的环境变量名：中止', () => {
    const root = createTempRoot();
    try {
      const bundle = join(root, 'index.js');
      writeFileSync(bundle, '{"WEKNORA_API_KEY":"x"}');
      expect(() => assertBundleHasNoEnvLeak(bundle, { root, env: {} })).toThrow(
        /白名单外的环境变量 WEKNORA_API_KEY/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('产物里有本机凭据的取值：中止', () => {
    const root = createTempRoot();
    try {
      const bundle = join(root, 'index.js');
      const secret = 'super-secret-token-value-123456';
      writeFileSync(bundle, `const t = "${secret}";\n`);
      expect(() =>
        assertBundleHasNoEnvLeak(bundle, { root, env: { MY_CREDENTIAL_TOKEN: secret } }),
      ).toThrow(/环境变量 MY_CREDENTIAL_TOKEN 的取值/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('干净的产物：放行', () => {
    const root = createTempRoot();
    try {
      const bundle = join(root, 'index.js');
      writeFileSync(bundle, '{"PATH":"/usr/bin","ACCESS_CODE":"xxxx"}');
      const result = assertBundleHasNoEnvLeak(bundle, { root, env: {} });
      expect(result.bundledNames).toContain('ACCESS_CODE');
      expect(result.bundledNames).not.toContain('WEKNORA_API_KEY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
