#!/usr/bin/env node
/**
 * 清理本仓库残留的本地开发进程。
 *
 * 为什么需要：反复调试会在本机留下一堆 `next start` / 代理进程。它们不只是
 * 占端口，还会让验证**测到错误的实例**——详见 `deploy/README.md` §8.5。
 * 本仓库长期在受限沙箱里开发（`kill` 被禁），无法自动回收，所以提供这个
 * 脚本把「列出」和「结束」两件事标准化。
 *
 * 用法：
 *   node scripts/cleanup-local-dev.mjs            # 只列出（dry-run，默认）
 *   node scripts/cleanup-local-dev.mjs --yes      # 真正结束
 *   node scripts/cleanup-local-dev.mjs --port 3540  # 只处理指定端口
 *
 * 安全约束：
 * - 只处理 **cwd 位于本仓库** 的进程，绝不碰其它项目的进程；
 * - 只处理 **node** 可执行文件；
 * - 默认 dry-run，必须显式 `--yes` 才会发信号；
 * - 跳过当前脚本自己的进程。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { sep } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const portArgIndex = args.indexOf('--port');
const ONLY_PORT = portArgIndex >= 0 ? Number(args[portIndex + 1]) : null;

/** 解析 `lsof -nP -iTCP -sTCP:LISTEN` 的输出。 */
function listListening() {
  let stdout = '';
  try {
    stdout = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    // lsof 在"没有匹配项"时以退出码 1 结束，但 stdout 仍有内容。
    if (typeof error.stdout === 'string') stdout = error.stdout;
    else {
      console.error('无法执行 lsof（macOS 自带，若缺失请手动清理）。');
      process.exit(1);
    }
  }
  const rows = [];
  for (const line of stdout.split('\n').slice(1)) {
    if (!line.trim()) continue;
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const [, pid, , , , , , , nodeName] = parts;
    const portMatch = /:(\d+)$/.exec(nodeName);
    if (!portMatch) continue;
    rows.push({ command: parts[0], pid: Number(pid), port: Number(portMatch[1]) });
  }
  return rows;
}

/** 取进程的 cwd（用于判断是否属于本仓库）。 */
function cwdOf(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = /^n(.*)$/m.exec(out);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/** 取进程的可执行文件名（确认是 node）。 */
function commandOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

const selfPid = process.pid;
const candidates = [];

for (const entry of listListening()) {
  if (entry.pid === selfPid) continue;
  if (ONLY_PORT !== null && entry.port !== ONLY_PORT) continue;
  if (!/node/i.test(entry.command)) continue;
  const cwd = cwdOf(entry.pid);
  // 注意不能用 `startsWith(ROOT)`：那样会把**兄弟目录**
  // （例如 `.../openmaic-physics-e2e`）也算成仓库内进程，与本脚本的承诺矛盾。
  // 必须要求"完全相同"或"仓库路径 + 分隔符"。
  if (!(cwd === ROOT || cwd.startsWith(ROOT + sep))) continue;
  // ps 在受限环境里可能不可用；lsof 的 COMMAND 字段已经够用了。
  const command = commandOf(entry.pid) || entry.command || 'node';
  candidates.push({ ...entry, cwd, command });
}

if (candidates.length === 0) {
  console.log('没有发现属于本仓库的残留监听进程，干净。');
  process.exit(0);
}

console.log(`发现 ${candidates.length} 个属于本仓库的残留进程：\n`);
for (const item of candidates.sort((a, b) => a.port - b.port)) {
  console.log(
    `  PID ${String(item.pid).padEnd(7)} 端口 ${String(item.port).padEnd(6)} ${item.command}`,
  );
}

if (!APPLY) {
  console.log('\n以上为 dry-run 结果（未结束任何进程）。');
  console.log('确认无误后执行：node scripts/cleanup-local-dev.mjs --yes');
  console.log('（只处理某个端口：node scripts/cleanup-local-dev.mjs --port 3540 --yes）');
  process.exit(0);
}

console.log('\n正在结束……');
let killed = 0;
let failed = 0;
for (const item of candidates) {
  const result = spawnSync('kill', ['-TERM', String(item.pid)], { encoding: 'utf8' });
  if (result.status === 0) {
    killed += 1;
  } else {
    failed += 1;
    console.error(`  结束失败 PID ${item.pid}：${result.stderr || result.error || '未知原因'}`);
  }
}

console.log(`\n已结束 ${killed} 个${failed > 0 ? `，失败 ${failed} 个` : ''}。`);
console.log('复查：lsof -nP -iTCP -sTCP:LISTEN | grep node');
