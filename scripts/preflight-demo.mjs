#!/usr/bin/env node
/**
 * 现场演示前置检查（一条命令）。
 *
 * 现场最怕的不是功能坏，而是**测到错误的实例**——本机残留的旧 `next start`
 * 会返回旧 HTML，引用已被新构建删除的 chunk，表现为"页面文字正常、按钮全哑"。
 * 这条脚本把散落在部署手册里的检查收敛成一次执行：
 *
 *   1. 构建产物是否在、BUILD_ID 是否可读；
 *   2. 工作区是否干净（避免演示的是没提交的代码）；
 *   3. 本机是否还有属于本仓库的残留监听进程（提示先清理）；
 *   4. 用**当次构建产物**起一个服务，跑一遍端到端自检；
 *   5. 打印结论：可以上台 / 需要先处理什么。
 *
 * 用法：
 *   node scripts/preflight-demo.mjs
 *   node scripts/preflight-demo.mjs --port 3800
 *
 * 说明：脚本**不会**自动清理残留进程（沙箱里 `kill` 常被禁），只会列出来，
 * 清理请显式执行 `node scripts/cleanup-local-dev.mjs --yes`。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number(argValue('--port', '3800'));

const problems = [];
const notes = [];

console.log('物理 AI 智慧课堂 · 现场演示前置检查\n');

/** 1) 构建产物 */
const buildIdPath = join(ROOT, '.next', 'BUILD_ID');
if (!existsSync(buildIdPath)) {
  problems.push('没有构建产物（.next/BUILD_ID 不存在）——请先跑 EDGEONE=1 next build');
} else {
  const buildId = readFileSync(buildIdPath, 'utf8').trim();
  console.log(`✓ 构建产物就绪，BUILD_ID = ${buildId}`);
}

/** 2) 工作区 */
const status = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
if (status.status === 0 && status.stdout.trim()) {
  notes.push(
    `工作区有 ${status.stdout.trim().split('\n').length} 处未提交改动——演示的是当前工作区内容（确认这是你要的）。`,
  );
} else {
  console.log('✓ 工作区干净');
}

/** 3) 残留进程 */
const leftover = spawnSync(process.execPath, [join(ROOT, 'scripts', 'cleanup-local-dev.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});
const leftoverLines = (leftover.stdout || '').split('\n');
const countLine = leftoverLines.find((line) => line.includes('个属于本仓库的残留进程'));
if (countLine) {
  const count = Number(/发现 (\d+)/.exec(countLine)?.[1] ?? '0');
  if (count > 0) {
    // 残留进程本身只是噪音：本脚本用**新端口**起服务，测的仍是自己拉起的实例。
    // 真正会污染结果的是「目标端口已被占用」——那种情况下 next start 会静默失败，
    // 我们却可能在连到别人的旧实例上。端口占用单独检查。
    notes.push(
      `本机还有 ${count} 个属于本仓库的残留监听进程。建议清理（node scripts/cleanup-local-dev.mjs --yes），` +
        `否则容易误连到旧实例。`,
    );
  } else {
    console.log('✓ 没有残留的本地监听进程');
  }
}

/** 目标端口是否已被占用。 */
function portInUse(port) {
  const probe = spawnSync(
    'curl',
    ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', `http://127.0.0.1:${port}/`],
    {
      encoding: 'utf8',
    },
  );
  return probe.stdout?.trim() === '200';
}

/** 4) 起服务 + 端到端自检 */
if (problems.length === 0) {
  if (portInUse(PORT)) {
    problems.push(`端口 ${PORT} 已被占用——这会让自检连到别人的旧实例。请换一个端口或先清理。`);
  }
}

if (problems.length === 0) {
  console.log(`\n正在用当次构建产物启动服务（端口 ${PORT}）……`);
  const child = spawn(join(ROOT, 'node_modules', '.bin', 'next'), ['start', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, EDGEONE: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // 等服务就绪
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const probe = spawnSync(
      'curl',
      [
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        `--max-time`,
        '3',
        `http://127.0.0.1:${PORT}/`,
      ],
      {
        encoding: 'utf8',
      },
    );
    ready = probe.stdout?.trim() === '200';
  }

  if (!ready) {
    problems.push(`服务在 ${PORT} 端口没能起来（可能端口被占用）。`);
  } else {
    const checkArgs = [
      join(ROOT, 'scripts', 'check-physics-e2e.mjs'),
      '--base-url',
      `http://127.0.0.1:${PORT}`,
    ];
    const check = spawnSync(process.execPath, checkArgs, { cwd: ROOT, encoding: 'utf8' });
    const output = `${check.stdout || ''}${check.stderr || ''}`;
    console.log('\n── 端到端自检 ──');
    console.log(output.trim());
    if (check.status !== 0) {
      problems.push('端到端自检未全部通过——先修好再上台。');
    }
    notes.push(
      `服务已在 http://127.0.0.1:${PORT} 运行（PID ${child.pid}），演示完可用 kill ${child.pid} 结束。`,
    );
  }
}

console.log('\n── 结论 ──');
for (const note of notes) console.log(`· ${note}`);
if (problems.length === 0) {
  console.log('\n✅ 可以上台。');
  process.exit(0);
}
console.log('\n❌ 上台前请先处理：');
for (const problem of problems) console.log(`· ${problem}`);
process.exit(1);
