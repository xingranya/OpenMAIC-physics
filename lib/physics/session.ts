/**
 * 物理工作台登录会话。
 *
 * ## 会话里为什么带 `userId`
 *
 * 学习数据按账号分区（见 `lib/physics/local-store.ts` 的作用域参数）：
 * A 账号的诊断分、实验记录不能出现在 B 账号的界面上。
 * 分区的依据就是会话里的 `userId`。
 *
 * ## 账号有两条来路
 *
 * 1. **注册 + 登录**（主路径）：账号存在浏览器本地，口令用 PBKDF2 校验；
 * 2. **一键进入**（访客体验）：以预置演示身份直接进入，不校验口令。
 *    两条来路拿到的都是同一种会话，演示身份有**稳定的 userId**，
 *    所以它的学习记录在切换与刷新后都还在。
 *
 * 账号与口令都只作用于本产品，不连接真实教务系统或数据库。
 */
import { COURSE, DEMO } from '@/lib/school';
import { DEMO_ACCOUNTS } from './data';
import type { AccountSession } from './accounts';
import type { UserRole } from './types';

/** 会话在 localStorage 里的键。 */
export const SESSION_KEY = 'physics-ai-session';

/** 会话内容。 */
export type PhysicsSession = AccountSession;

/** 演示学生的稳定账号 id。 */
export const DEMO_STUDENT_USER_ID = 'demo-student';

/** 演示教师的稳定账号 id。 */
export const DEMO_TEACHER_USER_ID = 'demo-teacher';

/** 演示身份对应的稳定 userId。 */
export function demoUserId(role: UserRole): string {
  return role === 'teacher' ? DEMO_TEACHER_USER_ID : DEMO_STUDENT_USER_ID;
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
    // userId / username 是账号分区的前提，缺了就当作没有会话。
    if (typeof parsed.userId !== 'string' || !parsed.userId) return null;
    if (typeof parsed.username !== 'string' || !parsed.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写入会话。 */
export function setSession(session: PhysicsSession): PhysicsSession {
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

/**
 * 演示账号口令登录（`student` / `teacher` + 公开口令）。
 *
 * 这是**访客体验**的一部分，不是账号系统的主路径——主路径是「注册 + 登录」。
 * 它保留下来是因为现场演示与应急动线都依赖它。
 */
export function authenticate(
  username: string,
  password: string,
  now: number = Date.now(),
): PhysicsSession | null {
  const normalized = String(username ?? '')
    .trim()
    .toLowerCase();
  if (!normalized || password !== DEMO.password) return null;
  const account = DEMO_ACCOUNTS.find(
    (item) => item.username.toLowerCase() === normalized && item.password === password,
  );
  if (!account) return null;
  return {
    userId: demoUserId(account.role),
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    at: now,
  };
}

/** 一键进入：以演示身份直接建立会话（不校验口令）。 */
export function createDemoSession(role: UserRole, now: number = Date.now()): PhysicsSession {
  const account = DEMO_ACCOUNTS.find((item) => item.role === role);
  return {
    userId: demoUserId(role),
    username:
      account?.username ?? (role === 'teacher' ? DEMO.teacherUsername : DEMO.studentUsername),
    displayName: account?.displayName ?? (role === 'teacher' ? COURSE.teacher : DEMO.studentName),
    role,
    at: now,
  };
}

/** 演示账号提示（登录页展示）。 */
export const DEMO_HINT = [
  {
    role: 'student' as const,
    label: '学生',
    username: DEMO.studentUsername,
    name: DEMO.studentName,
  },
  { role: 'teacher' as const, label: '教师', username: DEMO.teacherUsername, name: COURSE.teacher },
];
