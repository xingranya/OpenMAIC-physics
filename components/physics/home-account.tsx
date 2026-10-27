'use client';

/**
 * 首页右上角的账号入口。
 *
 * ## 为什么必须有它
 *
 * 首页的「生成 / 进入课堂」会先判会话，没有会话时提示「右上角『登录』」。
 * 但工具栏此前只有主题与设置两个按钮——提示指向的位置是空的，
 * 用户点完只会看到一句无法执行的错误，既进不去课堂，也找不到登录页。
 * 这个组件把那个「不存在的按钮」补上，并让已登录的人能看见自己是谁。
 *
 * ## 首帧为什么渲染占位
 *
 * 会话存在 localStorage，服务端渲染时读不到。若首帧直接按「未登录」渲染，
 * 已登录用户会先看到「登录」再跳成头像（水合不一致 + 视觉闪烁）。
 * 因此挂载前只渲染等宽占位，挂载后再决定显示哪一种。
 */
import * as React from 'react';
import { ChevronDown, LayoutDashboard, LogIn, LogOut } from 'lucide-react';

import { clearSessionCookie } from '@/lib/physics/account-store';
import { loginHref } from '@/lib/physics/guest';
import { clearSession, getSession, type PhysicsSession } from '@/lib/physics/session';
import { ROLE_HOME_VIEW, routeFor } from '@/lib/physics/shortcuts';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<PhysicsSession['role'], string> = {
  student: '学生',
  teacher: '教师',
};

export function HomeAccount({ className }: { className?: string }) {
  const [session, setSession] = React.useState<PhysicsSession | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSession(getSession());
    setHydrated(true);
  }, []);

  // 点击别处收起菜单：菜单不是模态的，用户点输入框就该关掉它。
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const signOut = React.useCallback(() => {
    clearSession();
    clearSessionCookie();
    setSession(null);
    setOpen(false);
  }, []);

  // 服务端与首帧：等宽占位，避免「登录 ↔ 头像」闪一下。
  if (!hydrated) {
    return <div className={cn('h-8 w-[74px]', className)} aria-hidden="true" />;
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => window.location.assign(loginHref('/'))}
        className={cn(
          'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium',
          'text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm',
          'dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
          className,
        )}
        aria-label="登录或注册账号"
      >
        <LogIn className="h-4 w-4" />
        登录
      </button>
    );
  }

  const initial = session.displayName.trim().slice(0, 1) || ROLE_LABEL[session.role];

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 rounded-full py-1 pr-2 pl-1 transition-all',
          'hover:bg-white hover:shadow-sm dark:hover:bg-gray-700',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前账号 ${session.displayName}`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-[11px] font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[88px] truncate text-[12.5px] font-medium text-gray-700 sm:inline dark:text-gray-200">
          {session.displayName}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-[196px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="border-b border-gray-100 px-3 py-2.5 dark:border-gray-700">
            <p className="truncate text-[12.5px] font-medium text-gray-900 dark:text-gray-100">
              {session.displayName}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-gray-400">
              {ROLE_LABEL[session.role]} · {session.username}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // 整页导航：工作台是另一套客户端页面，硬跳比等 RSC 快且稳。
              window.location.assign(routeFor(session.role, ROLE_HOME_VIEW[session.role]));
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            进入工作台
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
