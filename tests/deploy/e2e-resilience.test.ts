/**
 * 端到端自检的**抗抖动**回归测试。
 *
 * ## 这条测试守的是什么
 *
 * 自检是从本机打向 EdgeOne 海外边缘的一串请求，连接层会间歇性失败
 * （`UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET`）。那是**本机网络**的问题，
 * 不是站点的问题——但自检是门禁，门禁要测的是站点。
 *
 * 修之前：重试一旦用尽，异常一路逃出 `main()`，顶层变成**未捕获的
 * Promise rejection**——脚本带着 Node 栈崩掉，后面的检查一项都跑不了。
 * 那种崩法与「站点真的坏了」长得完全一样，看报告的人分不清该查本机还是查站点。
 *
 * 修之后要成立两个性质：
 *
 * 1. **一项检查挂掉不打断整轮** —— 记一条 FAIL，后面的检查照跑，末尾照常出总数；
 * 2. **绝不以未捕获异常收场** —— 顶层有兜底，输出里没有 Node 栈。
 *
 * ## 为什么用「起一个会断连的本地服务」而不是断言源码结构
 *
 * 源码结构断言会被注释骗过（正则匹配到的是注释里的同一行，真实代码改回原样
 * 门禁照样全绿）。所以这里**真的把脚本跑起来**：本地 HTTP 服务对某条路由
 * 直接 `socket.destroy()`，制造真实的 `ECONNRESET`，然后看脚本的实际行为。
 *
 * 断言打在**输出与退出码**上——也就是门禁真正被消费的方式。
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectErrorCodes,
  describeCheckFailure,
  errorText,
  guardCheck,
  isConnectionFailure,
  toFailureRecord,
} from '../../scripts/e2e-resilience-lib.mjs';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-physics-e2e.mjs');

/** 自检脚本按 `process.cwd()` 找仓库根；给它一个空目录，行为才确定（与本机
 *  有没有 `.next/BUILD_ID`、有没有 `docs/` 无关）。放在仓库内的 `.tmp` 下——
 *  仓库外目录在本机删不掉，会永久残留。 */
function makeWorkDir(name: string): string {
  const dir = join(REPO_ROOT, '.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * 起一个子进程跑自检脚本，并收集输出。
 *
 * **必须用异步 spawn**：本地 HTTP 服务与测试同进程，`spawnSync` 会把事件循环
 * 堵死，服务永远应答不了，脚本只会一路超时——那测到的是「事件循环被堵」，
 * 不是「脚本的抗抖动行为」。第一版就是栽在这里。
 *
 * **输出必须落盘再读**：实测在**全量** vitest（704 个文件并行、机器满载）下
 * 出现过一次子进程 stdout 只收到表头、后面的输出全丢——管道 + 满载的事件循环
 * 会让「子进程写了但父进程没收到」变成偶发失败（同一份代码单独跑 10/10 全绿）。
 * 落盘就没有这个窗口：子进程退出后读文件，拿到的必然是完整输出。
 * 这也和「日志落盘 + 退出码」的纪律一致：退出码要靠 `echo EXIT=$?` 拿，
 * 不能靠管道（管道会把退出码换成最后一个命令的）。
 */
function runScript(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve) => {
    const outPath = join(cwd, 'e2e-out.log');
    const fd = openSync(outPath, 'w');
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      // stdout 与 stderr 合并落同一个文件：断言本来就看合并内容，
      // 分成两个管道只会多两个可能丢输出的口子。
      stdio: ['ignore', fd, fd],
    });
    const killer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (status) => {
      clearTimeout(killer);
      closeSync(fd);
      let output = '';
      try {
        output = readFileSync(outPath, 'utf8');
      } catch {
        output = '';
      }
      resolve({ stdout: output, stderr: '', status });
    });
  });
}

describe('e2e 抗抖动 · 连接层失败的判定', () => {
  it('undici 的连接层错误藏在 cause 里，也要能认出来', () => {
    // 这正是真实形态：TypeError: fetch failed → cause.code = UND_ERR_CONNECT_TIMEOUT
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });
    expect(collectErrorCodes(error)).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(isConnectionFailure(error)).toBe(true);
    expect(describeCheckFailure(error)).toContain('本机连不上目标站点');
  });

  it('ECONNRESET / ECONNREFUSED / AggregateError 同样算连接层失败', () => {
    expect(isConnectionFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isConnectionFailure(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);

    const aggregate = Object.assign(new AggregateError([]), {
      errors: [Object.assign(new Error('y'), { code: 'ECONNRESET' })],
    });
    expect(isConnectionFailure(aggregate)).toBe(true);
  });

  it('站点自己的错误**不能**被当成连接层失败', () => {
    // 否则文案会把「站点返回了坏答案」说成「本机连不上」，把排查方向带偏。
    expect(isConnectionFailure(new Error('目标站点不可达（HTTP 500）'))).toBe(false);
    expect(isConnectionFailure(new Error('boom'))).toBe(false);
    expect(isConnectionFailure(null)).toBe(false);
    expect(describeCheckFailure(new Error('boom'))).toContain('检查执行失败');
    expect(describeCheckFailure(new Error('boom'))).not.toContain('本机连不上');
  });

  it('错误文本要带出 cause 与错误码，便于判断责任方', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });
    const text = errorText(error);
    expect(text).toContain('fetch failed');
    expect(text).toContain('UND_ERR_CONNECT_TIMEOUT');
  });
});

describe('e2e 抗抖动 · guardCheck 的契约', () => {
  it('检查抛异常时：记一条 FAIL，且**不把异常抛出去**', async () => {
    const recorded: Array<[string, boolean, string]> = [];
    const outcome = await guardCheck(
      '示例检查',
      async () => {
        throw new Error('模拟失败');
      },
      (name, ok, detail) => recorded.push([name, ok, detail ?? '']),
    );

    expect(outcome.ok).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(recorded[0][0]).toBe('示例检查');
    expect(recorded[0][1]).toBe(false);
    expect(recorded[0][2]).toContain('检查执行失败');
  });

  it('检查正常完成时：一律不记（不能凭空多出一条 FAIL）', async () => {
    const recorded: Array<[string, boolean, string]> = [];
    const outcome = await guardCheck(
      '示例检查',
      async () => 'ok',
      (name, ok, detail) => recorded.push([name, ok, detail ?? '']),
    );
    expect(outcome.ok).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  it('失败记录的形状与脚本里的 record 产出一致', () => {
    const failure = toFailureRecord('示例检查', new Error('boom'));
    expect(failure).toEqual({
      name: '示例检查',
      ok: false,
      detail: expect.stringContaining('检查执行失败'),
    });
  });
});

describe('e2e 抗抖动 · 端到端行为（真跑脚本）', () => {
  const HTML =
    '<!doctype html><html><head><title>大学物理 AI 智慧课堂</title></head>' +
    '<body><div>长江大学文理学院 · 大学物理 · 正在加载工作台</div></body></html>';

  /** 拆掉 socket，制造真实的 ECONNRESET（不是 5xx）。 */
  function dropConnection(res: ServerResponse): void {
    const socket = res.socket;
    if (!socket) throw new Error('响应没有关联 socket，无法制造断连');
    socket.destroy();
  }

  it('瞬时断连（前 4 次失败、第 5 次成功）不该被当成失败', async () => {
    // 这一条钉住**连接层重试次数**：单次 p≈0.2 时，3 次重试的累计失败率
    // （0.8%/次 × 几十个请求）会把网络抖动报成站点故障；5 次才降到 0.03%。
    // 断言落在**行为**上：注入 4 次失败后，第 5 次成功 → 脚本拿到的是**响应**，
    // 而不是「连不上目标站点」。
    let attempts = 0;
    const server = await startServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/api/chat')) {
        attempts += 1;
        if (attempts <= 4) {
          dropConnection(res);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (url.startsWith('/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'ok' }));
        return;
      }
      if (url.startsWith('/api/server-providers')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, providers: {} }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    });

    const workDir = makeWorkDir('e2e-resilience-transient');
    let stdout = '';
    try {
      const result = await runScript(['--base-url', `http://127.0.0.1:${server.port}`], workDir);
      stdout = result.stdout;
    } finally {
      await server.close();
      rmSync(workDir, { recursive: true, force: true });
    }

    expect(attempts).toBeGreaterThanOrEqual(5);
    // 重试到位了：脚本拿到的是响应（200），不是「本机连不上」。
    expect(stdout).not.toContain('本机连不上目标站点');
    expect(stdout).toContain('[FAIL] 会话门禁 · 未登录调用高耗能接口被拦截');
  }, 120_000);

  it('站点侧 5xx：该项判 FAIL、**不重试**、且不说成「本机连不上」', async () => {
    // 独立复审 M6 变异：把 5xx 也重试，这条测试必须变红。
    // HTTP 层的状态码是**站点自己的答案**，重试只会把真实故障糊过去。
    let hits = 0;
    const server = await startServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/api/chat')) {
        hits += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'boom' }));
        return;
      }
      if (url.startsWith('/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'ok' }));
        return;
      }
      if (url.startsWith('/api/server-providers')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, providers: {} }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    });

    const workDir = makeWorkDir('e2e-resilience-5xx');
    let stdout = '';
    let status: number | null = null;
    try {
      const result = await runScript(['--base-url', `http://127.0.0.1:${server.port}`], workDir);
      stdout = result.stdout;
      status = result.status;
    } finally {
      await server.close();
      rmSync(workDir, { recursive: true, force: true });
    }

    // ① **只被请求 3 次**：会话门禁有三项检查各打一次 `/api/chat`
    //    （未登录 / 带会话 Cookie / 带会话请求头），HTTP 层不重试。
    //    若把 5xx 也重试（重试次数 5），这里会是 15 次。
    //    **这条断言的口径是「每项检查只打一次」**：新增检查项要同步这个数，
    //    否则「不重试」这条性质就没人守了。
    expect(hits).toBe(3);

    // ② 该项判 FAIL（门禁拦得住），且说清是服务端 5xx，
    //    **不是**「本机连不上」——责任方说反了会把人引到错误方向。
    expect(status).toBe(1);
    expect(stdout).toContain('[FAIL] 会话门禁 · 未登录调用高耗能接口被拦截');
    expect(stdout).toContain('实际 500');
    expect(stdout).not.toContain('本机连不上目标站点');
  }, 120_000);

  it('某条路由**一直**断连时：该项记 FAIL、**后续检查照跑**、末尾有总数、且无 Node 栈', async () => {
    // 对 /api/chat 每次都断开连接 → 客户端拿到 ECONNRESET。
    // 这是「本机连不上」的确定性复现，不依赖外网稳定性。
    const server = await startServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/api/chat')) {
        dropConnection(res);
        return;
      }
      if (url.startsWith('/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'ok' }));
        return;
      }
      if (url.startsWith('/api/server-providers')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, providers: {} }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    });

    const workDir = makeWorkDir('e2e-resilience-test');
    let stdout = '';
    let stderr = '';
    let status: number | null = null;
    try {
      const result = await runScript(['--base-url', `http://127.0.0.1:${server.port}`], workDir);
      stdout = result.stdout;
      stderr = result.stderr;
      status = result.status;
    } finally {
      await server.close();
      rmSync(workDir, { recursive: true, force: true });
    }

    // 有失败项 → 退出码 1（门禁该拦就拦）
    expect(status).toBe(1);

    // 断连的那一项被记成了 FAIL，且文案说的是「本机连不上」而不是「访问码错」
    expect(stdout).toContain('[FAIL] 会话门禁');
    expect(stdout).toContain('本机连不上目标站点');

    // **关键**：后面的检查照跑了 —— 这一条是「per-check 兜底」的牙齿。
    // 只加顶层兜底（没有 per-check guard）时，这里会看不到模型那项。
    expect(stdout).toContain('模型供给可查询');

    // 末尾照常有总数
    expect(stdout).toContain('合计 ');

    // 绝不能以未捕获异常收场：Node 栈一旦出现，人就得自己猜是哪一层坏了
    const combined = `${stdout}\n${stderr}`;
    expect(combined).not.toContain('triggerUncaughtException');
    expect(combined).not.toContain('node:internal');
    // 120s：脚本对断连的那条路由要做 5 次连接层重试（含退避），本机跑要十几秒。
  }, 120_000);

  it('整个站点都连不上时：顶层兜底要接住，仍然出总数，且无 Node 栈', async () => {
    // 这一条钉住**顶层兜底**。上一条测不到它：per-check guard 已经把异常吃掉了，
    // `main()` 根本不会抛，顶层 catch 永远走不到——两道判据互相掩护。
    // 这里让 `main()` 自身抛（换取平台 Cookie 时连不上），顶层兜底才成为唯一防线。
    const server = await startServer(() => {
      /* 占位：马上关掉，只为拿到一个「确定没人监听」的端口 */
    });
    const deadPort = server.port;
    await server.close();

    const workDir = makeWorkDir('e2e-resilience-dead');
    let stdout = '';
    let stderr = '';
    let status: number | null = null;
    try {
      const result = await runScript(
        ['--base-url', `http://127.0.0.1:${deadPort}`, '--site-query', 'eo_token=fake&eo_time=1'],
        workDir,
      );
      stdout = result.stdout;
      stderr = result.stderr;
      status = result.status;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    expect(status).toBe(1);
    // 顶层兜底把异常收敛成了一条结构化 FAIL，而不是让它逃出去
    expect(stdout).toContain('[FAIL] 自检整体执行');
    expect(stdout).toContain('合计 ');
    const combined = `${stdout}\n${stderr}`;
    expect(combined).not.toContain('triggerUncaughtException');
    expect(combined).not.toContain('node:internal');
  }, 120_000);
});
