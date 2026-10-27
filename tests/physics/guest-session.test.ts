// @vitest-environment jsdom
/**
 * 「未登录点进入课堂」这条路的回归护栏。
 *
 * ## 守的是什么
 *
 * 线上真实反馈：首页输入主题、点「生成 / 进入课堂」，弹一句
 * 「请先登录，右上角『登录』」——而首页右上角当时只有主题与设置两个按钮，
 * **根本没有登录入口**。提示指向一个不存在的地方，用户被彻底卡住：
 * 既进不了课堂，也找不到登录页。
 *
 * 修复分三块，这里各守一块：
 *
 * 1. `ensureGuestSession` 能就地下发一个**服务端认形状**的会话 Cookie
 *    （`<userId>.<时间戳>`），让「访客开始」真的能过门禁；
 * 2. 已有会话时只补写 Cookie、**不换账号**——否则访客会把已登录用户顶掉；
 * 3. `safeReturnTo` 只放行站内路径，挡住登录页的开放重定向。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { isSessionCookieValue, SESSION_COOKIE_NAME } from '@/lib/physics/account-store';
import { ensureGuestSession, loginHref, safeReturnTo } from '@/lib/physics/guest';
import { SESSION_KEY } from '@/lib/physics/session';

/** 读出会话 Cookie 的值（jsdom 里 `document.cookie` 是字符串）。 */
function sessionCookieValue(): string | null {
  const hit = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!hit) return null;
  return decodeURIComponent(hit.slice(SESSION_COOKIE_NAME.length + 1));
}

function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE_NAME}=; path=/; max-age=0`;
}

describe('访客会话', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSessionCookie();
  });

  it('没有会话时下发演示会话，并写入服务端认形状的 Cookie', () => {
    const session = ensureGuestSession('student');

    expect(session.userId).toBe('demo-student');
    expect(session.role).toBe('student');

    const cookie = sessionCookieValue();
    expect(cookie).not.toBeNull();
    // 服务端只验形状：`<账号 id>.<10~16 位时间戳>`。写错一个字符就是恒 401。
    expect(isSessionCookieValue(cookie as string)).toBe(true);

    // 会话本身也要落到 localStorage，刷新后仍认得这个人。
    expect(localStorage.getItem(SESSION_KEY)).toContain('demo-student');
  });

  it('已有会话时补写 Cookie，但不换账号', () => {
    const teacher = ensureGuestSession('teacher');
    clearSessionCookie();
    expect(sessionCookieValue()).toBeNull();

    const again = ensureGuestSession('student');

    // 关键：不能因为「这次是学生入口」就把教师会话顶成学生。
    expect(again.userId).toBe(teacher.userId);
    expect(again.role).toBe('teacher');
    expect(sessionCookieValue()).not.toBeNull();
  });
});

describe('登录回跳地址', () => {
  it('登录页地址带上编码后的 returnTo', () => {
    expect(loginHref('/')).toBe('/login?returnTo=%2F');
    expect(loginHref('/classroom/abc')).toBe('/login?returnTo=%2Fclassroom%2Fabc');
  });

  it('只放行站内绝对路径', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/classroom/abc?x=1')).toBe('/classroom/abc?x=1');
    // 协议相对地址是开放重定向的经典写法。
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('https://evil.example')).toBeNull();
    expect(safeReturnTo('javascript:alert(1)')).toBeNull();
    expect(safeReturnTo('')).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
  });

  it('不把登录页自己当成回跳目标（否则登录成功又落回登录页）', () => {
    expect(safeReturnTo('/login')).toBeNull();
    expect(safeReturnTo('/login?returnTo=%2F')).toBeNull();
    expect(safeReturnTo('/login/')).toBeNull();
  });
});
