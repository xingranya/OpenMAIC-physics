import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertProbeOutsideRepo,
  detectRepoRoot,
  findNodeModulesAncestor,
  isInside,
  outsideRepoTemp,
  pickOutsideRepoTemp,
} from '@/scripts/edgeone-temp.mjs';
import { runRuntimeProbe } from '@/scripts/verify-edgeone-runtime.mjs';

/**
 * 「运行期探针必须真的在仓库之外」这道护栏的回归。
 *
 * ## 它为什么是阻断级
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
 *
 * ## 为什么断言打在 runRuntimeProbe 上，而不是只测工具函数
 *
 * 只测 `outsideRepoTemp()` 是**测不到失守点**的：真正的失守在**调用点**
 * ——有人把 `outsideRepoTemp('edgeone-runtime')` 换成
 * `join(process.cwd(), '.tmp', …)` 时，工具函数根本不会执行，
 * 而原来的三份部署门禁测试 **24/24 全绿**，门禁还照样打印
 * 「通过：仓库外运行无 5xx」。
 *
 * 所以下面第 6、7 条用例直接调用 `runRuntimeProbe`，注入不合规的探针目录，
 * 要求它**拒绝执行**。删掉调用点的断言，这两条立刻变红——这就是「有牙齿」。
 *
 * ## 为什么按关键字分别断言，而不是笼统匹配「仓库外」
 *
 * 仓库根本来就装着 node_modules，所以「在仓库内」几乎必然同时触发
 * 「向上有 node_modules」。若错误消息只笼统说「不在仓库外」，把其中一道
 * 判据改坏时另一道会替它挡刀，测试照样全绿——护栏就成了摆设。
 *
 * 因此每道判据有独立关键字（`不在仓库内` / `向上存在 node_modules`），
 * 下面每条用例只认自己的那一个。
 */

/** 造一个「向上带 node_modules、但不在给定 repoRoot 内」的探针目录。 */
function makeProbeUnderNodeModules() {
  // TMPDIR 指向仓库内 .tmp，所以这个目录可删；repoRoot 用一个非祖先路径，
  // 从而把「向上存在 node_modules」这一道判据**单独**触发。
  const base = mkdtempSync(join(tmpdir(), 'nm-ancestor-'));
  mkdirSync(join(base, 'node_modules'), { recursive: true });
  return {
    // base 自身存在，可直接当候选（realpathSync 要求路径存在）；
    // probeDir 则用于纯路径判据（assertProbeOutsideRepo）。
    base,
    probeDir: join(base, 'probe'),
    // 非祖先：isInside(fakeRepo, base) === false
    fakeRepo: join(base, 'fake-repo-root'),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe('探针必须在仓库之外', () => {
  it('仓库根能被稳定定位（不依赖 cwd）', () => {
    const root = detectRepoRoot();
    expect(root).toMatch(/\/[^/]+$/);
    // 从子目录出发也必须定位到同一个仓库根
    expect(detectRepoRoot(join(root, 'scripts'))).toBe(root);
  });

  it('outsideRepoTemp 产出的目录：不在仓库内，且向上无 node_modules', () => {
    const root = detectRepoRoot();
    const dir = outsideRepoTemp('probe-iso', root);
    try {
      expect(isInside(root, dir)).toBe(false);
      expect(findNodeModulesAncestor(dir)).toBeNull();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 沙箱可能不允许删仓库外的目录 */
      }
    }
  });

  it('向上带 node_modules 的目录会被认出来（绝对判据）', () => {
    const { probeDir, cleanup } = makeProbeUnderNodeModules();
    try {
      expect(findNodeModulesAncestor(probeDir)).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('第 1 道判据（不在仓库内）能被单独证伪', () => {
    const root = detectRepoRoot();
    // 仓库根装着 node_modules，两道判据都会触发；
    // 这里只断言**第 1 道**那条消息在——把它改坏就会变红。
    let message = '';
    try {
      assertProbeOutsideRepo(join(root, '.tmp', 'probe-inside'), root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('不在仓库内');
  });

  it('第 2 道判据（向上无 node_modules）能被单独证伪', () => {
    const { probeDir, fakeRepo, cleanup } = makeProbeUnderNodeModules();
    try {
      let message = '';
      try {
        // fakeRepo 不是 probeDir 的祖先 → 第 1 道不触发，只剩第 2 道
        assertProbeOutsideRepo(probeDir, fakeRepo);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('向上存在 node_modules');
      expect(message).not.toContain('不在仓库内');
    } finally {
      cleanup();
    }
  });

  /**
   * 候选筛选里的两道判据也必须能被**分别**证伪。
   *
   * 只看「最终挑了谁」是测不出来的：仓库根装着 node_modules，
   * 「在仓库内」的候选几乎必然也命中第 2 道——把第 1 道改坏时第 2 道会替它
   * 挡刀，测试照样全绿。所以断言的是**拒绝原因**（reason）。
   */
  it('候选筛选：仓库内候选被以 in-repo 拒绝（第 1 道判据）', () => {
    const root = detectRepoRoot();
    const inside = join(root, '.tmp', `inside-candidate-${process.pid}`);
    mkdirSync(inside, { recursive: true });
    try {
      const { dir, rejected } = pickOutsideRepoTemp([inside], root, 'probe');
      expect(dir).toBeNull();
      expect(rejected.map((r) => r.reason)).toContain('in-repo');
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  });

  it('候选筛选：向上带 node_modules 的候选被以 node-modules 拒绝（第 2 道判据）', () => {
    const { base, fakeRepo, cleanup } = makeProbeUnderNodeModules();
    try {
      const { dir, rejected } = pickOutsideRepoTemp([base], fakeRepo, 'probe');
      expect(dir).toBeNull();
      expect(rejected.map((r) => r.reason)).toContain('node-modules');
    } finally {
      cleanup();
    }
  });

  it('runRuntimeProbe 注入仓库内探针目录时必须拒绝执行（断言打在真正调用点）', async () => {
    const root = detectRepoRoot();
    const inside = join(root, '.tmp', 'probe-inside-never-created');
    // fnDir 故意指向不存在的路径：断言必须**先于**任何拷贝动作失败，
    // 否则这条用例就变成了「因为 ENOENT 才失败」，测不到护栏本身。
    await expect(
      runRuntimeProbe(join(root, 'no-such-function-package'), { workDir: inside, repoRoot: root }),
    ).rejects.toThrow(/不在仓库内/);
  });

  it('runRuntimeProbe 注入「向上带 node_modules」的探针目录时同样必须拒绝', async () => {
    const { probeDir, fakeRepo, cleanup } = makeProbeUnderNodeModules();
    try {
      await expect(
        runRuntimeProbe(join(fakeRepo, 'no-such-function-package'), {
          workDir: probeDir,
          repoRoot: fakeRepo,
        }),
      ).rejects.toThrow(/向上存在 node_modules/);
    } finally {
      cleanup();
    }
  });
});
