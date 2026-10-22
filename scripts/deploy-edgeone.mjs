#!/usr/bin/env node
/**
 * 一键部署到腾讯云 EdgeOne Pages（生产环境）。
 *
 * 为什么需要这个脚本，而不是直接 `edgeone makers deploy`：
 *
 * 1. **函数包 128MiB 硬上限。** EdgeOne 的 Cloud SSR Node 函数包解包后超过
 *    128MiB 平台直接拒收（部署状态 Failed / 错误码 30，原始报错
 *    `Cloud SSR Node functions package size exceeds 128MiB limit`）。
 *    本项目打包后约 255MiB，必须先裁剪（见 prune-edgeone-function.mjs）
 *    再上传，否则部署永远失败。
 *
 * 2. **裁剪必须在构建之后、上传之前。** CLI 没有暴露这个钩子，但当待部署
 *    目录里**只有 .edgeone 与 edgeone.json** 时，CLI 会判定「产物已就绪」
 *    并跳过本地构建（见 CLI 的 Qee()/build 判定）。所以流程是：
 *        构建 → 裁剪 → 挪进只有 .edgeone 的暂存目录 → 从暂存目录 deploy。
 *
 * 3. **构建期不能用 corepack 默认的 pnpm。** 受限环境里 corepack 缓存可能
 *    没有 packageManager 指定的那个 pnpm 版本，构建第一步就会挂。
 *    这里显式给出 InstallCommand，指向仓库内可用的 pnpm 与内容寻址 store。
 *
 * 用法：
 *   node scripts/deploy-edgeone.mjs                # 完整流程（构建→裁剪→部署）
 *   node scripts/deploy-edgeone.mjs --dry-run      # 只跑构建+裁剪并报告体积
 *   node scripts/deploy-edgeone.mjs --skip-build   # 复用已有 .edgeone 产物
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EDGEONE_DIR = join(ROOT, '.edgeone');
const STAGE_DIR = join(ROOT, '.tmp', 'edgeone-stage');
const PROJECT_NAME = process.env.EDGEONE_PROJECT_NAME || 'physics-ai-classroom';
const AREA = process.env.EDGEONE_AREA || 'global';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BUILD = process.argv.includes('--skip-build');

/** 函数包体积上限（EdgeOne 平台对 Cloud SSR Node 函数的硬限制）。 */
const LIMIT_MIB = 128;

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`命令失败（退出码 ${result.status}）：${command} ${args.join(' ')}`);
  }
}

/** 递归统计目录体积（字节，与平台口径一致：按文件字节求和）。 */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
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
          /* 并发移除 */
        }
      }
    }
  }
  return total;
}

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);

// ---------------------------------------------------------------- 1. 构建
if (!SKIP_BUILD) {
  console.log('=== 1/3 构建 EdgeOne 产物 ===');
  // Next.js 在构建期会重写 tsconfig.json（补齐它自己的选项、压成一行 JSON，
  // 并追加 cloud-functions/node-functions 等排除项）。那不是我们想要的
  // 仓库状态，会让 prettier --check 与 git diff 变脏，所以构建后还原。
  const tsconfigPath = join(ROOT, 'tsconfig.json');
  const tsconfigBefore = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, 'utf8') : null;
  try {
    run('edgeone', ['pages', 'build', '--mode', 'prod'], {
      env: {
        // 受限环境的 corepack 缓存可能没有 packageManager 指定的 pnpm；
        // 显式指定安装命令，绕开 corepack 并固定到仓库内的内容寻址 store。
        InstallCommand:
          process.env.InstallCommand ||
          'pnpm install --frozen-lockfile --ignore-scripts --package-import-method=hardlink --store-dir=' +
            join(ROOT, '.pnpm-store'),
        CI: 'true',
      },
    });
  } finally {
    if (tsconfigBefore !== null && readFileSync(tsconfigPath, 'utf8') !== tsconfigBefore) {
      writeFileSync(tsconfigPath, tsconfigBefore);
      console.log('[deploy-edgeone] 已还原构建期被改写的 tsconfig.json');
    }
  }
} else {
  console.log('=== 1/3 跳过构建（复用现有 .edgeone） ===');
}

if (!existsSync(EDGEONE_DIR)) {
  throw new Error(`没有构建产物：${EDGEONE_DIR}`);
}

// ---------------------------------------------------------------- 2. 裁剪
console.log('\n=== 2/3 裁剪云函数包 ===');
run('node', ['scripts/prune-edgeone-function.mjs', '--yes']);

const fnDir = join(EDGEONE_DIR, 'cloud-functions', 'ssr-node');
const fnSize = dirSize(fnDir);
console.log(`\n函数包体积：${mib(fnSize)} MiB（平台上限 ${LIMIT_MIB} MiB）`);
if (fnSize / 1024 / 1024 > LIMIT_MIB) {
  throw new Error(
    `函数包仍超限（${mib(fnSize)} MiB > ${LIMIT_MIB} MiB）。需要继续削减内容，见 deploy/README.md §8.1d。`,
  );
}

if (DRY_RUN) {
  console.log('\n--dry-run：到此为止，不上传。');
  process.exit(0);
}

// ---------------------------------------------------------------- 3. 部署
console.log('\n=== 3/3 部署到生产环境 ===');
mkdirSync(STAGE_DIR, { recursive: true });
// CLI 判定「目录里只有 .edgeone」时会跳过本地构建，直接上传既有产物。
if (existsSync(join(STAGE_DIR, '.edgeone'))) {
  rmSync(join(STAGE_DIR, '.edgeone'), { recursive: true, force: true });
}
renameSync(EDGEONE_DIR, join(STAGE_DIR, '.edgeone'));
cpSync(join(ROOT, 'edgeone.json'), join(STAGE_DIR, 'edgeone.json'));

try {
  run(
    'edgeone',
    ['makers', 'deploy', '.', '-n', PROJECT_NAME, '-e', 'production', '--area', AREA, '--json'],
    {
      cwd: STAGE_DIR,
    },
  );
} finally {
  // 把产物挪回仓库根（保持 .edgeone/ 依旧是仓库内的构建产物）。
  if (existsSync(join(STAGE_DIR, '.edgeone'))) {
    if (existsSync(EDGEONE_DIR)) rmSync(EDGEONE_DIR, { recursive: true, force: true });
    renameSync(join(STAGE_DIR, '.edgeone'), EDGEONE_DIR);
  }
}
