/**
 * 物理工作台登录会话。
 *
 * 账号用于当前产品的登录校验，不连接真实教务系统或数据库。
 * 密码只在校验时比对，不写入持久化状态。
 */

import { COURSE, DEMO } from '@/lib/school';
import { DEMO_ACCOUNTS } from './data';
import type { UserRole } from './types';

const SESSION_KEY = 'physics-ai-session';

/** 会话内容。 */
export interface PhysicsSession {
  role: UserRole;
  displayName: string;
  /** 登录时间戳。 */
  at: number;
}

function getStorage(): Storage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

/** 读取当前会话；无会话或数据损坏时返回 null。 */
export function getSession(): PhysicsSession | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PhysicsSession;
    if (parsed?.role !== 'student' && parsed?.role !== 'teacher') return null;
    if (typeof parsed.displayName !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写入会话。 */
export function setSession(role: UserRole, displayName: string): PhysicsSession {
  const session: PhysicsSession = { role, displayName, at: Date.now() };
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* 忽略：写不进会话时仍允许本次会话在内存中生效 */
    }
  }
  return session;
}

/** 清除会话。 */
export function clearSession(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 校验登录。账号与密码均来自校本层的演示账号配置。 */
export function authenticate(
  username: string,
  password: string,
): { role: UserRole; displayName: string } | null {
  const normalized = String(username ?? '').trim().toLowerCase();
  if (!normalized || password !== DEMO.password) return null;
  const account = DEMO_ACCOUNTS.find(
    (item) => item.username.toLowerCase() === normalized && item.password === password,
  );
  if (!account) return null;
  return { role: account.role, displayName: account.displayName };
}

/** 演示账号提示（登录页展示）。 */
export const DEMO_HINT = [
  { role: 'student' as const, label: '学生', username: DEMO.studentUsername, name: DEMO.studentName },
  { role: 'teacher' as const, label: '教师', username: DEMO.teacherUsername, name: COURSE.teacher },
];
