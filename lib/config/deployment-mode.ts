/**
 * 部署模式断言。
 *
 * 本项目部署到腾讯云 EdgeOne Pages，采用「无数据库」形态：
 * - 课程与学生记录保存在浏览器（IndexedDB / localStorage）；
 * - Agent Workbench（依赖 PostgreSQL 的长驻 runner）关闭；
 * - MP4 渲染服务（依赖 Docker + Chromium）不部署，导出自动降级为项目 ZIP。
 *
 * 这些开关由部署环境变量控制。一旦有人误配了 PostgreSQL 或打开了
 * Workbench，这里会**大声失败**而不是静默进入一个半残状态——
 * 上游的 1.2.x 需要长驻进程 + PostgreSQL，而 EdgeOne 是无状态边缘平台，
 * 两者混用会在运行期才暴露问题。
 */

import {
  isAgentRuntimeEnabled,
  isProWorkbenchEnabled,
  isServerPersistenceConfigured,
} from '@/lib/config/feature-flags';

/** 部署形态。 */
export type DeploymentMode = 'edge' | 'server';

/**
 * 当前部署形态。
 *
 * 存在 `DATABASE_URL` 视为服务端形态（自托管 / Docker / 长驻 Node）；
 * 否则为边缘形态（EdgeOne / Vercel Serverless）。
 */
export function detectDeploymentMode(): DeploymentMode {
  return isServerPersistenceConfigured() ? 'server' : 'edge';
}

/** 断言结果。 */
export interface DeploymentCheck {
  ok: boolean;
  /** 不通过时的说明。 */
  message?: string;
}

/**
 * 检查当前部署配置是否自洽。
 *
 * @param mode 期望的部署形态；不传则只检查"不得同时开启 PG 与边缘形态"。
 */
export function checkDeploymentConfig(mode?: DeploymentMode): DeploymentCheck {
  const problems: string[] = [];

  if (isServerPersistenceConfigured() && !process.env.DATABASE_URL?.trim()) {
    problems.push('DATABASE_URL 为空但服务端持久化被判定为已配置。');
  }

  if (mode === 'edge') {
    if (isServerPersistenceConfigured()) {
      problems.push(
        '边缘部署（EdgeOne）不应配置 DATABASE_URL：PostgreSQL 需要长驻进程与固定数据库，' +
          'EdgeOne 是无状态边缘平台。请在 EdgeOne 控制台删除该环境变量。',
      );
    }
    if (isProWorkbenchEnabled()) {
      problems.push(
        '边缘部署不应开启 NEXT_PUBLIC_PRO_WORKBENCH_ENABLED：Agent Workbench 依赖 PostgreSQL ' +
          '的会话租约与心跳，无法在无状态边缘运行时工作。',
      );
    }
    if (isAgentRuntimeEnabled()) {
      problems.push(
        '边缘部署不应开启 OPENMAIC_AGENT_RUNTIME_ENABLED：后台 Agent runner 需要常驻进程。',
      );
    }
  }

  if (problems.length === 0) return { ok: true };
  return { ok: false, message: problems.join('\n') };
}

/**
 * 在服务端启动时校验部署配置。
 *
 * 失败时抛出错误：宁可启动失败，也不要让评委在现场看到"点了没反应"。
 */
export function assertDeploymentConfig(mode?: DeploymentMode): void {
  const check = checkDeploymentConfig(mode);
  if (!check.ok) {
    throw new Error(`[部署配置] ${check.message}`);
  }
}
