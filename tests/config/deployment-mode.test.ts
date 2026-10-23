import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkDeploymentConfig, detectDeploymentMode } from '@/lib/config/deployment-mode';

/**
 * 部署形态断言。
 *
 * ## 它为什么要有测试
 *
 * `checkDeploymentConfig()` 此前**一条测试都没有**——这意味着它「大声失败」
 * 的承诺全靠人工自觉：一旦有人重构时把某个分支删了，没有任何东西会变红。
 *
 * 第十三轮独立复审还发现它**漏了一个开关**：`NEXT_PUBLIC_PERSISTENCE`
 * 一旦被误设为 `'1'`，浏览器端会把课程与学生记录指向 `/api/persistence`，
 * 而本项目是「无数据库」形态、该路由已删除 —— 客户端会静默 404，
 * 现场表现是「导入预置包之后什么都没有」。所以补了断言，也补了这条测试。
 */
const ENV_KEYS = [
  'DATABASE_URL',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'NEXT_PUBLIC_PERSISTENCE',
] as const;

describe('部署形态断言', () => {
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originals.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originals.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('无数据库、无任何开关时判定为边缘形态并通过检查', () => {
    expect(detectDeploymentMode()).toBe('edge');
    expect(checkDeploymentConfig('edge')).toEqual({ ok: true });
  });

  it('边缘形态下开启 NEXT_PUBLIC_PERSISTENCE 必须报错', () => {
    process.env.NEXT_PUBLIC_PERSISTENCE = '1';
    const check = checkDeploymentConfig('edge');
    expect(check.ok).toBe(false);
    expect(check.message).toContain('NEXT_PUBLIC_PERSISTENCE');
  });

  it('边缘形态下开启 Workbench 必须报错', () => {
    process.env.NEXT_PUBLIC_PRO_WORKBENCH_ENABLED = '1';
    const check = checkDeploymentConfig('edge');
    expect(check.ok).toBe(false);
    expect(check.message).toContain('NEXT_PUBLIC_PRO_WORKBENCH_ENABLED');
  });

  it('边缘形态下开启 Agent runtime 必须报错', () => {
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = '1';
    const check = checkDeploymentConfig('edge');
    expect(check.ok).toBe(false);
    expect(check.message).toContain('OPENMAIC_AGENT_RUNTIME_ENABLED');
  });

  it('边缘形态下配置 DATABASE_URL 必须报错', () => {
    process.env.DATABASE_URL = 'postgres://example/db';
    const check = checkDeploymentConfig('edge');
    expect(check.ok).toBe(false);
    expect(check.message).toContain('DATABASE_URL');
  });

  it('NEXT_PUBLIC_PERSISTENCE 设为非 1 时不算开启', () => {
    process.env.NEXT_PUBLIC_PERSISTENCE = '0';
    expect(checkDeploymentConfig('edge')).toEqual({ ok: true });
  });
});
