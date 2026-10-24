#!/usr/bin/env node
/**
 * 登录 / 注册 / 使用 的**全链路验收**（真实浏览器，不是单元测试）。
 *
 * ## 为什么要有它
 *
 * 单测能证明判定逻辑对，证明不了「页面上点得通」：按钮文案、跳转目标、
 * Cookie 是否真的下发、刷新会不会被踢回登录页——这些只有真跑一遍才知道。
 * 本轮就是靠这类检查发现了「学生能打开 `/teacher/foo` 看到教师驾驶舱」。
 *
 * ## 两个必须遵守的编排约定（都是踩过的坑）
 *
 * 1. **账号存在浏览器 localStorage 里，每个新 context 都是空的。**
 *    所以「注册一个账号 → 换一个 context 去登录它」必然失败。
 *    需要账号的检查必须在**同一个 context** 里连续做完。
 * 2. **不要用固定 sleep 等跳转。** 注册要走 PBKDF2（21 万次迭代），
 *    实测点击到跳转约 2 秒，机器忙时更久。一律 `waitForURL`，
 *    否则「功能正常」会被误判成「没有跳转」。
 *
 * ## 用法
 *
 *   node scripts/check-auth-flow.mjs --base-url https://dun.xran.uk
 *
 * 需要本机有 Chrome（`channel: 'chrome'` 调系统浏览器，不额外下载 Chromium）。
 * **不纳入 `pnpm test`**：它连的是真站点，交付前手动跑一次即可。
 *
 * 退出码：全部通过 0；有 FAIL 为 1；脚本自身异常为 2。
 */
import process from 'node:process';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = flag('--base-url', 'https://dun.xran.uk').replace(/\/$/, '');
const PASSWORD = 'probe-pass-2026';
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function skip(name, detail) {
  process.stdout.write(`[SKIP] ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/** 生成本次运行专用账号名，避免与历史账号冲突。 */
function accountName(prefix) {
  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

/** 开一个干净的浏览器上下文（等价于无痕窗口，localStorage 为空）。 */
async function freshPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 160));
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 160)}`));
  return { context, page, errors };
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1200);
}

/** 等地址栏落到期望路径；超时返回 false，由调用方断言。 */
async function waitForPath(page, predicate, timeout = 25_000) {
  try {
    await page.waitForURL((url) => predicate(url.pathname), { timeout });
    return true;
  } catch {
    return false;
  }
}

/** 在登录页切到「注册新账号」并提交。`expectRedirect=false` 用于预期失败的用例。 */
async function register(
  page,
  { username, password = PASSWORD, role = 'student', expectRedirect = true },
) {
  await goto(page, '/login');
  await page.getByRole('tab', { name: '注册新账号' }).click();
  await page.fill('#physics-username', username);
  await page.fill('#physics-password', password);
  if (role === 'teacher') await page.getByRole('button', { name: '教师', exact: true }).click();
  await page.getByRole('button', { name: /注册并进入/ }).click();
  if (expectRedirect) {
    await waitForPath(
      page,
      (path) => path === '/physics/overview' || path === '/teacher/dashboard',
    );
    await page.waitForTimeout(600);
  } else {
    await page.waitForTimeout(1500);
  }
}

/** 在登录页用账号密码登录。`expectRedirect=false` 用于预期失败的用例。 */
async function login(page, { username, password = PASSWORD, expectRedirect = true }) {
  await goto(page, '/login');
  await page.fill('#physics-username', username);
  await page.fill('#physics-password', password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if (expectRedirect) {
    await waitForPath(
      page,
      (path) => path === '/physics/overview' || path === '/teacher/dashboard',
    );
    await page.waitForTimeout(600);
  } else {
    await page.waitForTimeout(1500);
  }
}

async function alertText(page) {
  const alert = page.locator('[role="alert"]');
  return (await alert.count()) > 0 ? ((await alert.first().textContent()) ?? '').trim() : '';
}

async function sessionUserId(page) {
  return page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('physics-ai-session');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.userId ?? parsed?.state?.session?.userId ?? '';
    } catch {
      return '';
    }
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const student = accountName('stu');
  const teacher = accountName('tea');
  try {
    // ── A. 注册学生（**这个上下文保留**，后面的会话检查都用它）──────────
    const primary = await freshPage(browser);
    const studentPage = primary.page;
    await register(studentPage, { username: student });
    const cookie = await studentPage.evaluate(() => document.cookie);
    record(
      '注册学生 → 进入学生工作台',
      studentPage.url().endsWith('/physics/overview') && cookie.includes('physics_session='),
      `${studentPage.url()}${cookie.includes('physics_session=') ? '（会话 Cookie 已下发）' : '（缺少会话 Cookie）'}`,
    );

    // ── B. 注册教师 ──────────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await register(page, { username: teacher, role: 'teacher' });
      record('注册教师 → 进入教师驾驶舱', page.url().endsWith('/teacher/dashboard'), page.url());
      await context.close();
    }

    // ── C. 重复用户名（**同一上下文**：注册 → 退出 → 再注册同名）────────
    {
      const { context, page } = await freshPage(browser);
      const duplicated = accountName('dup');
      await register(page, { username: duplicated });
      await page.getByRole('button', { name: '退出登录' }).click();
      await waitForPath(page, (path) => path === '/login');
      await register(page, { username: duplicated, expectRedirect: false });
      const text = await alertText(page);
      record('重复用户名被拒', text.includes('已被占用'), text || '（没有出现提示）');
      await context.close();
    }

    // ── D. 演示账号名保留 ────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await register(page, { username: 'student', expectRedirect: false });
      const text = await alertText(page);
      record(
        '注册 student 被拒（演示账号保留）',
        text.includes('演示账号'),
        text || '（没有出现提示）',
      );
      await context.close();
    }

    // ── E. 密码过短 ──────────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await register(page, {
        username: accountName('short'),
        password: '123456',
        expectRedirect: false,
      });
      const text = await alertText(page);
      record('密码不足 8 位被拒', text.includes('至少 8 位'), text || '（没有出现提示）');
      await context.close();
    }

    // ── F. 错误口令 ──────────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await login(page, {
        username: student,
        password: 'wrong-password-2026',
        expectRedirect: false,
      });
      const text = await alertText(page);
      record('错误口令 → 统一提示', text.includes('账号或密码不正确'), text || '（没有出现提示）');
      await context.close();
    }

    // ── G. 演示账号登录（代码级账号，任何上下文都可用）────────────────
    {
      const { context, page } = await freshPage(browser);
      await login(page, { username: 'student', password: 'dunzhongwan' });
      record('演示账号 student 仍可登录', page.url().endsWith('/physics/overview'), page.url());
      await context.close();
    }

    // ── H. 一键进入 ──────────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await goto(page, '/login?demo=teacher');
      await waitForPath(page, (path) => path === '/teacher/dashboard');
      record('一键进入教师视角', page.url().endsWith('/teacher/dashboard'), page.url());
      await context.close();
    }

    // ── I. 会话 / 门禁 / 刷新 / 退出重登（复用 A 的上下文）──────────────
    {
      const firstUserId = await sessionUserId(studentPage);

      await goto(studentPage, '/teacher/evaluation');
      await waitForPath(studentPage, (path) => path === '/physics/overview');
      record(
        '学生开 /teacher/evaluation 被送回学生端',
        studentPage.url().endsWith('/physics/overview'),
        studentPage.url(),
      );

      await goto(studentPage, '/teacher/foo');
      await waitForPath(studentPage, (path) => path === '/physics/overview');
      record(
        '学生开 /teacher/foo 被送回学生端（本轮修复）',
        studentPage.url().endsWith('/physics/overview'),
        studentPage.url(),
      );

      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await waitForPath(studentPage, (path) => path === '/physics/overview');
      record('刷新不掉登录', studentPage.url().endsWith('/physics/overview'), studentPage.url());

      await studentPage.getByRole('button', { name: '退出登录' }).click();
      await waitForPath(studentPage, (path) => path === '/login');
      const afterSignOut = studentPage.url();
      await login(studentPage, { username: student });
      const secondUserId = await sessionUserId(studentPage);
      record(
        '退出后重登同账号',
        afterSignOut.endsWith('/login') &&
          studentPage.url().endsWith('/physics/overview') &&
          firstUserId !== '' &&
          firstUserId === secondUserId,
        `退出→${afterSignOut}；重登→${studentPage.url()}；userId 一致=${firstUserId === secondUserId}`,
      );

      record(
        '学生会话全程 0 console error',
        primary.errors.length === 0,
        primary.errors.slice(0, 3).join(' | '),
      );
      await primary.context.close();
    }

    // ── J. 13 个视图逐页可渲染（演示账号，新上下文）──────────────────
    {
      const { context, page, errors } = await freshPage(browser);
      await login(page, { username: 'student', password: 'dunzhongwan' });
      const studentViews = [
        'overview',
        'diagnosis',
        'curriculum',
        'projects',
        'tasks',
        'assistant',
        'lab',
        'report',
      ];
      const failed = [];
      for (const view of studentViews) {
        await goto(page, `/physics/${view}`);
        const text = (await page.textContent('body')) ?? '';
        if (!page.url().endsWith(`/physics/${view}`) || text.length < 500) failed.push(view);
      }
      record(
        '学生端 8 视图全部可渲染',
        failed.length === 0,
        failed.length ? `失败：${failed}` : '8/8',
      );

      await login(page, { username: 'teacher', password: 'dunzhongwan' });
      const teacherViews = ['dashboard', 'class', 'curriculum', 'evaluation', 'insights'];
      const teacherFailed = [];
      for (const view of teacherViews) {
        await goto(page, `/teacher/${view}`);
        const text = (await page.textContent('body')) ?? '';
        if (!page.url().endsWith(`/teacher/${view}`) || text.length < 500) teacherFailed.push(view);
      }
      record(
        '教师端 5 视图全部可渲染',
        teacherFailed.length === 0,
        teacherFailed.length ? `失败：${teacherFailed}` : '5/5',
      );
      record('13 视图 0 console error', errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }

    // ── K. 预置课堂包导入 ────────────────────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await goto(page, '/');
      const preset = page.getByRole('button', { name: '牛顿运动定律与圆周运动', exact: true });
      if ((await preset.count()) === 0) {
        record('预置课堂包可导入', false, '首页找不到预置包按钮');
      } else {
        await preset.click();
        try {
          await page.waitForURL((url) => url.pathname.includes('/classroom/'), { timeout: 30_000 });
        } catch {
          /* 交给下面的断言报错 */
        }
        record('预置课堂包可导入并进入课堂', page.url().includes('/classroom/'), page.url());
      }
      await context.close();
    }

    // ── L. 模型供给（有 Key 才谈得上生成）────────────────────────────
    {
      const { context, page } = await freshPage(browser);
      await goto(page, '/');
      const providers = await page.evaluate(async () => {
        const response = await fetch('/api/server-providers');
        const json = await response.json();
        return Object.keys(json?.providers ?? {});
      });
      if (providers.length === 0) {
        skip('模型供给已配置', 'providers 为空——零额度可演示，但「生成课堂」不可用');
      } else {
        record('模型供给已配置', true, `providers: ${providers.join(', ')}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item.ok);
  process.stdout.write(
    `\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(
      `失败项：\n${failed.map((item) => `  - ${item.name}：${item.detail}`).join('\n')}\n`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('验收脚本异常：', error?.message ?? error);
  process.exit(2);
});
