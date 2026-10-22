#!/usr/bin/env node
/**
 * 修 pnpm 内容寻址 store 里被「按文件名拦截」的那一个文件条目。
 *
 * ## 现象
 *
 * `pnpm install` 在某些受限环境（带文件写入网关的沙箱 / 企业终端防护）里会失败：
 *
 *   ERR_PNPM_EPERM  EPERM: operation not permitted, copyfile
 *     '…/.pnpm-store/v10/files/1b/fdd…' →
 *     '…/node_modules/.pnpm/@mixmark-io+domino@2.2.0/node_modules/@mixmark-io/domino_tmp_75133/.gitmodules'
 *
 * 失败的那个文件叫 **`.gitmodules`**——某些防护策略会**按文件名**拦截任何
 * `.gitmodules` 的创建（防 git 子模块劫持），于是 pnpm 往包里写这个文件时
 * 直接拿到 EPERM，整个安装中断。
 *
 * ## 原理
 *
 * pnpm 的 store 里每个包有一份「索引」JSON
 * （`.pnpm-store/v10/index/<xx>/<hash>-<name>@<version>.json`），
 * 里面 `files` 映射列出了这个包要物化到 node_modules 的每个文件。
 * **索引里没有的文件，pnpm 根本不会去写。**
 * 所以把 `.gitmodules` 这一项从索引里删掉，pnpm 就不会再尝试创建它，
 * 安装可以正常完成 —— 这个文件对运行时没有任何作用（它是 npm 上游打包时
 * 混进去的开发期残留）。
 *
 * ## 用法
 *
 * ```bash
 * # 1) 先跑一次安装（会在写 .gitmodules 时失败，但 store 已经填充好了）
 * pnpm install --package-import-method=hardlink
 *
 * # 2) 修 store 索引
 * node scripts/fix-pnpm-store-gitmodules.mjs
 *
 * # 3) 再跑一次安装，这次会成功
 * pnpm install --package-import-method=hardlink
 * ```
 *
 * 脚本是幂等的：没有可修的条目时直接报告并退出 0。
 * 它只改本地 store 缓存（不进版本库），删掉 store 重跑即可复原。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** pnpm store 的可能位置：优先用 npm_config_store_dir，其次仓库内约定目录。 */
const STORE_CANDIDATES = [
  process.env.npm_config_store_dir,
  join(ROOT, '.pnpm-store'),
  join(process.env.HOME || '', 'Library', 'pnpm', 'store'),
  join(process.env.HOME || '', '.pnpm', 'store'),
].filter(Boolean);

const TARGET_FILE = '.gitmodules';

function findStore() {
  for (const candidate of STORE_CANDIDATES) {
    const indexDir = join(candidate, 'v10', 'index');
    if (existsSync(indexDir)) return indexDir;
    const indexDirV = join(candidate, 'index');
    if (existsSync(indexDirV)) return indexDirV;
  }
  return null;
}

const indexDir = findStore();
if (!indexDir) {
  console.error(
    '[fix-pnpm-store-gitmodules] 找不到 pnpm store 索引目录。' +
      '请先用 pnpm install 填充 store，或用 npm_config_store_dir 指定路径。',
  );
  process.exit(1);
}

let patched = 0;
let scanned = 0;

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.json')) continue;
    scanned += 1;
    let json;
    try {
      json = JSON.parse(readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    if (!json.files || !Object.prototype.hasOwnProperty.call(json.files, TARGET_FILE)) continue;
    delete json.files[TARGET_FILE];
    writeFileSync(full, JSON.stringify(json));
    patched += 1;
    console.log(`[fix-pnpm-store-gitmodules] 已摘除 ${TARGET_FILE}：${entry.name}`);
  }
};

walk(indexDir);

console.log(
  patched > 0
    ? `[fix-pnpm-store-gitmodules] 共修 ${patched} 个包索引（扫描 ${scanned} 个）。请重新执行 pnpm install。`
    : `[fix-pnpm-store-gitmodules] 扫描 ${scanned} 个包索引，没有需要修的条目。`,
);
