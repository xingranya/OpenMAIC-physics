/**
 * 工作台**深链接**的角色门禁：渲染层回归护栏。
 *
 * ## 为什么要有这一条（纯函数测试不够）
 *
 * 判定抽成了纯函数 `resolveDeepLinkRoleGate`（见 `lib/physics/shortcuts.ts`），
 * 但**纯函数测试证明不了组件真的接上了它**——把组件里的调用删掉，
 * 纯函数那几条用例照样全绿。这类「调用点才是失守点」的坑，本项目已经踩过两次。
 *
 * 所以这里**真的把组件渲染一遍**，断言的是**渲染结果**：
 * 学生深链接 `/teacher/evaluation` 时，页面上**不能出现教师端内容**。
 *
 * ## 为什么测「渲染结果」而不是「源码里有没有那句调用」
 *
 * 源码结构断言会被注释骗过（正则匹配到的是注释里的同一行，真实代码换回去
 * 门禁照样全绿）。渲染结果没有这个歧义：组件要么挡住教师内容，要么没挡住。
 *
 * ## 事实前提
 *
 * 路径前缀决定渲染哪个角色的内容：`app/teacher/[view]` 渲染教师组件、
 * `app/physics/[view]` 渲染学生组件——而路径是任何人都能手输的。
 * in-app 切换已被 `navigate()` 的 allowed 集合挡住（纵深防御），
 * 首屏深链接是第三条路，原来没人管。
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  pathname: '/teacher/evaluation',
  role: 'student' as 'student' | 'teacher' | null,
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => harness.pathname,
  useRouter: () => ({
    replace: harness.replace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: ReactNode; href?: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/physics/state-provider', () => ({
  usePhysicsState: () => ({
    session: harness.role ? { role: harness.role, displayName: '陈思远' } : null,
    hydrated: true,
    signOut: vi.fn(),
    reset: vi.fn(),
    resetStudent: vi.fn(),
    rollback: vi.fn(),
    lastUndo: null,
  }),
  PhysicsStateProvider: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@/components/physics/command-palette', () => ({
  CommandPalette: () => null,
}));

vi.mock('@/lib/physics/use-shortcuts', () => ({
  // 组件要解构 {open, setOpen, shortcuts}，返回 undefined 会直接崩在解构上。
  useShortcuts: () => ({ open: false, setOpen: vi.fn(), shortcuts: [] }),
}));

vi.mock('@/components/physics/teacher/evaluation', () => ({
  TeacherEvaluation: () => createElement('div', null, 'TEACHER-CONTENT:evaluation'),
}));

vi.mock('@/components/physics/teacher/dashboard', () => ({
  TeacherDashboard: () => createElement('div', null, 'TEACHER-CONTENT:dashboard'),
}));

vi.mock('@/components/physics/student/overview', () => ({
  StudentOverview: () => createElement('div', null, 'STUDENT-CONTENT:overview'),
}));

import { StudentViewRouter } from '@/components/physics/student-router';
import { TeacherViewRouter } from '@/components/physics/teacher-router';
import { WorkbenchShell } from '@/components/physics/workbench';

/**
 * 渲染工作台外壳，并把**该路径本该渲染的视图路由**作为 children 传进去。
 *
 * 这一步不能省：不传 children 的话教师内容压根不会出现在 DOM 里，
 * 「页面里没有教师内容」就成了**恒真断言**——删掉整个门禁它照样绿。
 * 传进去之后，内容**本来是会渲染的**，门禁才有资格把它挡掉。
 */
function renderShell(pathname: string) {
  harness.pathname = pathname;
  const children = pathname.startsWith('/teacher')
    ? createElement(TeacherViewRouter)
    : createElement(StudentViewRouter);
  return renderToStaticMarkup(createElement(WorkbenchShell, null, children));
}

describe('深链接的角色门禁（渲染层）', () => {
  it('学生深链接教师端路由时，教师端内容**不出现**', () => {
    harness.role = 'student';
    const html = renderShell('/teacher/evaluation');
    expect(html).not.toContain('TEACHER-CONTENT:evaluation');
    expect(html).toContain('正在返回学生工作台');
  });

  it('教师深链接学生端路由时，学生端内容**不出现**', () => {
    harness.role = 'teacher';
    const html = renderShell('/physics/overview');
    expect(html).not.toContain('STUDENT-CONTENT:overview');
    expect(html).toContain('正在返回教师工作台');
  });

  it('同角色深链接**照常渲染**（不能把正常深链接一起挡掉）', () => {
    harness.role = 'teacher';
    const html = renderShell('/teacher/evaluation');
    // 这一条同时是前面两条的**对照**：内容在这里是会渲染的，
    // 说明「教师内容不出现」不是因为渲染失败，而是被门禁挡了。
    expect(html).toContain('TEACHER-CONTENT:evaluation');
    expect(html).not.toContain('正在返回');
  });

  it('学生走自己的深链接时，学生端内容照常渲染', () => {
    harness.role = 'student';
    const html = renderShell('/physics/overview');
    expect(html).toContain('STUDENT-CONTENT:overview');
    expect(html).not.toContain('正在返回');
  });
});
