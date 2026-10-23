/**
 * 按**运行期反馈**补齐函数包缺失的依赖。
 *
 * ## 为什么是「反馈驱动」而不是静态闭包
 *
 * 静态闭包（产物引用的包 + 它们的全部传递依赖）是**过近似**：它会把
 * typebox / @smithy/core / @aws-sdk/* 这些**运行期根本不会加载**的包
 * 也算进来。实测把它们逐个实体化要多塞好几 MiB——而函数包有 128 MiB 硬上限，
 * 为了「静态全绿」把包撑爆是本末倒置。
 *
 * 运行期才是判据：仓库外把函数包跑起来，它报「Cannot find package 'yaml'」
 * 就说明 yaml 真的要补。补完再跑一遍，直到不再报错。
 *
 * 流程：
 *   1. 在仓库外启动函数包，打全部路由（scripts/verify-edgeone-runtime.mjs）；
 *   2. 从 stderr 里认出缺哪些包；
 *   3. 从工作区把这些包按「入口 + 相对 require 闭包」实体化进 deps/；
 *   4. 回到 1，直到没有「缺包」为止（最多若干轮，避免死循环）。
 *
 * 用法：node scripts/repair-edgeone-runtime-deps.mjs [fnDir] [nodeBin]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { copyRuntimeGraph, resolveWorkspacePackageDir } from './edgeone-deps-lib.mjs';
import { extractMissingPackages, runRuntimeProbe } from './verify-edgeone-runtime.mjs';

const FN_DIR = resolve(
  process.argv[2] || join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node'),
);
const NODE_BIN = process.argv[3] || process.execPath;
const WORKSPACE = process.cwd();
const MAX_ROUNDS = Number(process.env.REPAIR_MAX_ROUNDS || 6);

/** 产物里某个包的 manifest（能给出真包名，穿过 Turbopack 哈希别名）。 */
function readArtifactManifest(depsDir, name) {
  try {
    return JSON.parse(readFileSync(join(depsDir, name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 找到一个包在工作区里的实体源。
 * 别名（`postcss-<hash>`）在工作区不存在——顺着产物里 manifest 的真名找。
 */
function findSource(name) {
  const direct = resolveWorkspacePackageDir(WORKSPACE, name);
  if (direct) return direct;
  const artifact = readArtifactManifest(join(FN_DIR, 'deps'), name);
  const realName = artifact && typeof artifact.name === 'string' ? artifact.name : null;
  if (realName && realName !== name) {
    return resolveWorkspacePackageDir(WORKSPACE, realName);
  }
  return null;
}

/** 把一个包补进产物。 */
function repairPackage(name) {
  const depsDir = join(FN_DIR, 'deps');
  const dest = join(depsDir, name);
  const source = findSource(name);
  if (!source) return { ok: false, reason: '工作区里找不到源' };
  const result = copyRuntimeGraph(source, dest);
  const bytes = dirSize(dest);
  return { ok: true, files: result.files, bytes, missing: result.missing };
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* 忽略读不到的文件 */
        }
      }
    }
  }
  return total;
}

async function main() {
  if (!existsSync(FN_DIR)) {
    console.error(`[repair-edgeone-runtime-deps] 找不到函数包：${FN_DIR}`);
    process.exit(2);
  }

  let totalRepaired = 0;
  let totalBytes = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    let result;
    try {
      result = await runRuntimeProbe(FN_DIR, { nodeBin: NODE_BIN });
    } catch (error) {
      // 探针落进仓库这类断言失败，必须显式失败：
      // 补包循环复用同一个探针，探针一旦失效，它会认为「什么都不缺」而空转。
      console.error(`[repair-edgeone-runtime-deps] ${error.message}`);
      process.exit(1);
    }
    if (!result.up) {
      console.error('[repair-edgeone-runtime-deps] 函数包起不来，无法据此补包：');
      console.error(result.stderr.slice(-3000));
      process.exit(1);
    }
    const missing = extractMissingPackages(result.loadErrors);
    if (missing.length === 0) {
      console.log(
        `[repair-edgeone-runtime-deps] 第 ${round} 轮：运行期不再缺包` +
          `（累计补 ${totalRepaired} 个包 / ${(totalBytes / 1048576).toFixed(1)} MiB）。`,
      );
      if (result.failures.length > 0) {
        console.log(
          `[repair-edgeone-runtime-deps] ⚠ 仍有 ${result.failures.length} 条 5xx，` +
            '但不是「缺包」造成的，需要另行定位。',
        );
      }
      process.exit(0);
    }

    console.log(`[repair-edgeone-runtime-deps] 第 ${round} 轮：运行期缺 ${missing.join('、')}`);
    let repairedThisRound = 0;
    const failed = [];
    for (const name of missing) {
      const outcome = repairPackage(name);
      if (outcome.ok) {
        repairedThisRound += 1;
        totalRepaired += 1;
        totalBytes += outcome.bytes;
        console.log(
          `  ✓ ${name}（补入 ${outcome.files} 个运行期文件，${(outcome.bytes / 1048576).toFixed(2)} MiB）`,
        );
      } else {
        failed.push(`${name}(${outcome.reason})`);
      }
    }
    if (repairedThisRound === 0) {
      console.error(
        `[repair-edgeone-runtime-deps] 无法补齐以下包：${failed.join('、')}。` +
          '它们在平台运行期会变成 Cannot find package。',
      );
      process.exit(1);
    }
  }

  console.error(
    `[repair-edgeone-runtime-deps] 补了 ${MAX_ROUNDS} 轮仍未跑干净，请检查是否有循环依赖。`,
  );
  process.exit(1);
}

await main();
