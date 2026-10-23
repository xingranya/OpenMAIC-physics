import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readAccessCode, runRuntimeProbe } from '@/scripts/verify-edgeone-runtime.mjs';

/**
 * 访问码的解析。
 *
 * ## 为什么值得单独守
 *
 * 访问码是「课堂门禁」的钥匙。仓库根的 `.env` 被 `.gitignore` 明确排除
 * （`.env*`），意图很清楚：**密钥不进仓库**。
 *
 * 但运行期门禁脚本原先把访问码**硬编码**在源码里——于是它随公开仓库一起
 * 发布，`.env` 的排除形同虚设：任何拿到仓库的人都能直接进课堂。
 *
 * 所以最后一条用例是这道护栏的核心断言：**什么都没配时必须返回空串**。
 * 一旦有人再写回一个硬编码默认值，这条立刻变红。
 */
describe('访问码解析', () => {
  const previous = process.env.ACCESS_CODE;

  beforeEach(() => {
    delete process.env.ACCESS_CODE;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = previous;
  });

  it('显式参数优先于环境变量与 .env', () => {
    process.env.ACCESS_CODE = 'from-env';
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      writeFileSync(join(root, '.env'), 'ACCESS_CODE=from-file\n');
      expect(readAccessCode('from-arg', root)).toBe('from-arg');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('其次读环境变量', () => {
    process.env.ACCESS_CODE = 'from-env';
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      writeFileSync(join(root, '.env'), 'ACCESS_CODE=from-file\n');
      expect(readAccessCode(undefined, root)).toBe('from-env');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('再次读仓库根的 .env，并剥掉引号', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      writeFileSync(join(root, '.env'), '# 注释\nACCESS_CODE="from-file"\nOTHER=1\n');
      expect(readAccessCode(undefined, root)).toBe('from-file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('什么都没配时返回空串——不允许有硬编码的默认访问码', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      expect(readAccessCode(undefined, root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('空白值与缺失的 .env 都算「没有」', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      writeFileSync(join(root, '.env'), 'ACCESS_CODE=   \n');
      expect(readAccessCode(undefined, root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拿不到访问码时，运行期门禁 fail-closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-root-'));
    try {
      // 造一个**最小可用**的产物目录：探针落位的断言要先过，
      // 才能走到凭据检查那一支（顺序本身就是被测行为的一部分）。
      const fnDir = join(root, 'fn');
      mkdirSync(fnDir, { recursive: true });
      writeFileSync(join(fnDir, 'index.mjs'), '// minimal\n');

      // 既没有参数、也没有环境变量、也没有 .env → 必须明确失败。
      // 不能「降级为未授权探测」：那样绝大多数路由返回 401，
      // 门禁只能探到「函数起没起来」，探不到「跑起来会不会炸」。
      await expect(runRuntimeProbe(fnDir, { repoRoot: root })).rejects.toThrow(/拿不到访问码/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
