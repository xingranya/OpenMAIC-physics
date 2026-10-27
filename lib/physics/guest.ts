/**
 * 访客会话：让「进入课堂」不被登录流程挡住。
 *
 * ## 为什么需要它
 *
 * 生成课堂会调用模型，服务端（`/api/generate/*`）要求请求带会话 Cookie。
 * 首页过去只做了一件事：发现没有会话就弹一句「请先登录，右上角『登录』」——
 * 而首页右上角当时**根本没有登录入口**（只有主题与设置），提示指向一个
 * 不存在的地方，用户除了清空输入重来没有别的出路。这是线上真实反馈的问题。
 *
 * 现在的分工：
 * - 右上角提供真实的登录入口（`HomeAccount`）；
 * - 未登录点「生成 / 进入课堂」时，先问一次「访客开始还是登录」；
 * - 选访客就地下发演示会话并写 `physics_session`，请求随即合法。
 *
 * ## 为什么访客会话复用演示身份
 *
 * 账号体系不接数据库，服务端只验 Cookie 形状（无签名）。访客拿到的
 * 就是 `demo-student` 这个稳定身份：好处是刷新后进度仍在，
 * 代价是**同一浏览器的访客共享演示学生的进度**。这是明确的取舍——
 * 登录后数据按自己的 `userId` 分区，互不影响。
 */
import { setSessionCookie } from './account-store';
import { createDemoSession, getSession, setSession, type PhysicsSession } from './session';
import type { UserRole } from './types';

/** 当前浏览器的会话（只看 localStorage，不判 Cookie 是否还在）。 */
export function currentSession(): PhysicsSession | null {
  return getSession();
}

/**
 * 登录页地址。`returnTo` 让登录后回到触发登录的那一页。
 *
 * 放在这里而不是组件里：它是纯字符串函数，谁都能用，
 * 也不需要为了拿到它去 import 一个 `'use client'` 组件。
 */
export function loginHref(returnTo = '/'): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * 过滤登录后的回跳地址。
 *
 * ## 为什么要过滤
 *
 * `returnTo` 来自 URL，任何人都能改。放行 `//evil.com` 这类协议相对地址，
 * 就等于在登录页开了一个**开放重定向**——而登录页正是最容易被拿来骗取
 * 信任的那一页，登录成功后把人送去站外尤其危险。
 *
 * 因此只接受**站内绝对路径**：以单个 `/` 开头，且不指回登录页自身
 * （否则登录成功会再次落到登录页，形成死循环）。
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return null;
  return raw;
}

/**
 * 确保存在一个可用会话，并返回它。
 *
 * 已有会话时**顺手补写 Cookie**：会话本身存在 localStorage 里，Cookie 可能
 * 被浏览器清掉或超过 7 天有效期。只看 localStorage 就下结论，会让
 * 「明明登录过」的请求在服务端拿到 401——这正是先前线上那个
 * 「带会话仍 401」的近亲问题，这里从源头堵住。
 */
export function ensureGuestSession(role: UserRole = 'student'): PhysicsSession {
  const existing = getSession();
  if (existing) {
    setSessionCookie(existing);
    return existing;
  }
  const guest = createDemoSession(role);
  setSession(guest);
  setSessionCookie(guest);
  return guest;
}
