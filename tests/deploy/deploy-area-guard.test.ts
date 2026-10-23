/**
 * 「加速区域」门禁的回归测试（第十二轮独立复审 I-1 / I-2）。
 *
 * ## 这个门禁为什么必须**真的跑一遍**才算测过
 *
 * 上一轮独立复审用 mock API 复现出：设 `EDGEONE_PROJECT_AREA=global` 后，
 * 部署脚本照样用 `CreatePagesProject` 建出了 `Area:"global"`（**含中国大陆**）的项目，
 * 门禁**照样放行**，还恒定打印「（无大陆节点）✔」——一句**假断言**。
 *
 * 所以这里的断言全部落在**行为**上，而不是「源码里有没有某个字符串」：
 *   - **真的调用** `ensureOverseasProject()`（脚本导出的纯函数）；
 *   - 用 **mock 的 Pages API** 驱动它（不打真实腾讯云，不产生任何线上副作用）；
 *   - 观察三件事：**有没有发出 API 调用**、**有没有打印「✔」**、**错误信息有没有说人话**。
 *
 * 特别提醒（仓库里踩过的坑）：**不要**用正则去匹配源码字符串来断言
 * 「某函数被调用了」——注释里的同形代码会让断言恒真。这里一律用行为断言。
 */
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_PROJECT_AREA,
  assertOverseasArea,
  ensureOverseasProject,
} from '../../scripts/deploy-edgeone.mjs';

const PROJECT_NAME = 'physics-ai-classroom-global';

type MockCall = { action: string; body: Record<string, unknown>; auth: string };

/**
 * 造一个 mock 的 Pages API：按 Action 返回预设响应，并**记录每次调用**。
 *
 * 记录调用次数是这里最关键的断言手段：非法取值下**一次调用都不该有**。
 */
function createMockApi(handlers: Record<string, (body: any) => any>) {
  const calls: MockCall[] = [];
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ action: body.Action, body, auth: init.headers.Authorization });
    const handler = handlers[body.Action];
    const payload = handler
      ? handler(body)
      : { Error: { Code: 'UnexpectedAction', Message: String(body.Action) } };
    return { json: async () => ({ Data: { Response: payload } }) };
  };
  return { calls, fetchImpl };
}

type GuardOptions = {
  projectArea?: string;
  handlers: Record<string, (body: any) => any>;
  /** 显式给令牌；传 null 表示「没有令牌」。 */
  token?: string | null;
  /** edgeone CLI 本地凭据里能读到的令牌。 */
  localToken?: string | null;
};

/**
 * 跑一次门禁。
 *
 * 刻意**不同步**返回：promise 在同一 tick 内就被断言接住，
 * 避免「先创建、后断言」中间那一拍出现 unhandled rejection。
 */
function runGuard(options: GuardOptions) {
  const { calls, fetchImpl } = createMockApi(options.handlers);
  const logs: string[] = [];
  const warnings: string[] = [];
  const promise = ensureOverseasProject({
    projectArea: options.projectArea ?? REQUIRED_PROJECT_AREA,
    projectName: PROJECT_NAME,
    token: options.token === undefined ? 'test-token' : options.token,
    readLocalToken: async () => options.localToken ?? null,
    fetchImpl,
    log: (message: string) => logs.push(message),
    warn: (message: string) => warnings.push(message),
  });
  return { promise, calls, logs, warnings };
}

describe('加速区域白名单（I-1）', () => {
  it('只认 overseas：global / 空串 / 乱填 一律中止，且一次 API 都不发', async () => {
    for (const bad of ['global', '', 'OVERSEAS', 'overseas ', 'overseas,global', 'undefined']) {
      const run = runGuard({ projectArea: bad, handlers: {} });
      await expect(run.promise).rejects.toThrow(/加速区域取值非法/);
      // 关键断言：**一次 API 调用都没有发** —— 非法取值下不可能建出项目。
      expect(run.calls).toEqual([]);
      expect(run.logs.join('\n')).not.toContain('✔');
    }
  });

  it('错误信息要说清「只允许 overseas」与「global = 含中国大陆」', async () => {
    const run = runGuard({ projectArea: 'global', handlers: {} });
    await expect(run.promise).rejects.toThrow(/只允许 "overseas"/);
    await expect(run.promise).rejects.toThrow(/含中国大陆/);
  });

  it('白名单函数本身：overseas 放行，其它取值抛错', () => {
    expect(REQUIRED_PROJECT_AREA).toBe('overseas');
    expect(assertOverseasArea('overseas')).toBe('overseas');
    expect(() => assertOverseasArea('global')).toThrow(/加速区域取值非法/);
    expect(() => assertOverseasArea('')).toThrow(/加速区域取值非法/);
  });
});

describe('加速区域核对以「读回的 Area」为准（I-1）', () => {
  it('项目已存在且 Area=overseas：放行并打印 ✔', async () => {
    const run = runGuard({
      handlers: {
        DescribePagesProjects: () => ({ Projects: [{ Name: PROJECT_NAME, Area: 'overseas' }] }),
      },
    });
    const project = await run.promise;
    expect(project?.Area).toBe('overseas');
    expect(run.calls.map((call) => call.action)).toEqual(['DescribePagesProjects']);
    expect(run.logs.join('\n')).toContain('（无大陆节点）✔');
  });

  it('项目已存在但 Area=global（含大陆）：中止，且**不打印 ✔**', async () => {
    const run = runGuard({
      handlers: {
        DescribePagesProjects: () => ({ Projects: [{ Name: PROJECT_NAME, Area: 'global' }] }),
      },
    });
    await expect(run.promise).rejects.toThrow(/global/);
    expect(run.logs.join('\n')).not.toContain('✔');
  });

  it('读不回 Area 字段：中止，且**不打印 ✔**', async () => {
    const run = runGuard({
      handlers: {
        // 项目在列表里，但**没有** Area 字段（平台少给一个字段就足以致命）。
        DescribePagesProjects: () => ({
          Projects: [{ Name: PROJECT_NAME, ProjectId: 'makers-x' }],
        }),
      },
    });
    await expect(run.promise).rejects.toThrow(/读不到/);
    expect(run.logs.join('\n')).not.toContain('✔');
  });

  it('建项目后必须**读回**：创建接口回包的 Area 不可信，读回的才作数', async () => {
    let describeCount = 0;
    const run = runGuard({
      handlers: {
        DescribePagesProjects: () => {
          describeCount += 1;
          // 第一次查：项目还不存在；第二次查：读回真实 Area。
          return describeCount === 1
            ? { Projects: [] }
            : { Projects: [{ Name: PROJECT_NAME, Area: 'overseas' }] };
        },
        // 创建接口的回包**故意**给一个错的 Area：真实平台甚至可能不返回它。
        CreatePagesProject: () => ({ ProjectId: 'makers-new', Area: 'global' }),
      },
    });
    const project = await run.promise;
    expect(project?.Area).toBe('overseas');
    expect(run.calls.map((call) => call.action)).toEqual([
      'DescribePagesProjects',
      'CreatePagesProject',
      'DescribePagesProjects',
    ]);
    // 关键断言：建项目时请求的 Area 是白名单里的那个值。
    const created = run.calls.find((call) => call.action === 'CreatePagesProject');
    expect(created?.body.Area).toBe('overseas');
    expect(run.logs.join('\n')).toContain('（无大陆节点）✔');
  });

  it('平台无视我们请求的 Area（读回仍是 global）：中止，且**不打印 ✔**', async () => {
    let describeCount = 0;
    const run = runGuard({
      handlers: {
        DescribePagesProjects: () => {
          describeCount += 1;
          return describeCount === 1
            ? { Projects: [] }
            : { Projects: [{ Name: PROJECT_NAME, Area: 'global' }] };
        },
        CreatePagesProject: () => ({ ProjectId: 'makers-new' }),
      },
    });
    await expect(run.promise).rejects.toThrow(/global/);
    expect(run.logs.join('\n')).not.toContain('✔');
    // **溯源断言**：日志里那个 Area 必须就是 API 读回来的值（global），
    // 而不是本地常量（overseas）——旧代码正是把本地常量当成「读回值」，
    // 于是在项目被建成含大陆的那一档时照样打印「（无大陆节点）✔」。
    expect(run.logs.join('\n')).toContain('读回加速区域 = global');
    expect(run.logs.join('\n')).not.toContain('读回加速区域 = overseas');
  });
});

describe('令牌缺失时的行为（I-2）', () => {
  it('没有令牌（环境变量与 CLI 本地凭据都没有）：显式告警「未核对加速区域」并中止', async () => {
    const run = runGuard({ token: null, localToken: null, handlers: {} });
    await expect(run.promise).rejects.toThrow(/未核对加速区域/);
    // 告警必须打到 stderr 通道（warn），而不是只混在普通日志里。
    expect(run.warnings.join('\n')).toContain('未核对加速区域');
    // 没有令牌 = 一次 API 调用都发不出去。
    expect(run.calls).toEqual([]);
    expect(run.logs.join('\n')).not.toContain('✔');
  });

  it('环境变量没有令牌时，改用 edgeone CLI 的本地凭据**继续核对**（不是跳过）', async () => {
    const run = runGuard({
      token: null,
      localToken: 'local-token-from-~/.edgeone',
      handlers: {
        DescribePagesProjects: () => ({ Projects: [{ Name: PROJECT_NAME, Area: 'overseas' }] }),
      },
    });
    const project = await run.promise;
    expect(project?.Area).toBe('overseas');
    // 真的发了 API 请求（而不是「跳过核对」）。
    expect(run.calls.map((call) => call.action)).toEqual(['DescribePagesProjects']);
    // 而且用的是本地凭据里的那个令牌。
    expect(run.calls[0].auth).toBe('Bearer local-token-from-~/.edgeone');
    expect(run.logs.join('\n')).toContain('（无大陆节点）✔');
  });

  it('本地凭据也查不动（API 报错）：明确标注「未核对」并中止', async () => {
    const run = runGuard({
      token: null,
      localToken: 'stale-token',
      handlers: {
        DescribePagesProjects: () => ({ Error: { Code: 'AuthFailure', Message: 'token expired' } }),
      },
    });
    await expect(run.promise).rejects.toThrow(/AuthFailure/);
    await expect(run.promise).rejects.toThrow(/未核对加速区域/);
    expect(run.logs.join('\n')).not.toContain('✔');
  });
});
