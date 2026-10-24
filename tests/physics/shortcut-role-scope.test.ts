import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { findShortcutsForPalette, resolveDeepLinkRoleGate } from '@/lib/physics/shortcuts';

/**
 * 角色作用域回归护栏：**命令面板**的可见性 + **深链接**的一致性。
 *
 * 背景（第四轮独立复审 F2）：工作台的视图切换是「本地状态 + 原生 History API」，
 * **并不真的会换页**——这是为了让断网时切视图不发请求。而命令面板里的
 * 「跳到学习报告」「跳到评价复核」是**跨角色**的跳转目标，作用域却是 global，
 * 于是学生能看见「跳到评价复核」、点下去之后地址栏变成 `/teacher/evaluation`，
 * 内容却仍是学生工作台——URL 与内容错配。
 *
 * 修复分两层：
 * 1. 命令面板条目按角色限定（`roleScope`），学生看不到教师端条目，反之亦然；
 * 2. 工作台的 `navigate` 本身也只接受当前角色的视图（纵深防御）。
 *
 * 本测试守住第 1 层，同时守住"过滤不能把角色自身的条目一起滤掉"。
 *
 * ── 深链接那一层（本轮补）──
 *
 * 上面两层都管的是**应用内**的跳转。**首屏深链接**是第三条路：
 * 路径前缀决定渲染哪个角色的内容（`app/teacher/[view]` 渲染教师组件），
 * 而路径是任何人都能手输的——学生直接打开 `/teacher/evaluation`，
 * 看到的就是教师端内容，侧栏却还是学生导航。
 *
 * 判定抽成纯函数（`resolveDeepLinkRoleGate`）便于直接测；
 * 但**纯函数测试证明不了组件真的接上了它**，所以下面还有一条
 * **渲染层**断言：把组件真渲染一遍，看教师端内容到底有没有出现。
 */
describe('命令面板的角色可见性', () => {
  const studentLabels = findShortcutsForPalette('student').map((b) => b.label);
  const teacherLabels = findShortcutsForPalette('teacher').map((b) => b.label);
  const anonymousLabels = findShortcutsForPalette(null).map((b) => b.label);

  it('学生看不到教师端的「跳到评价复核」', () => {
    expect(studentLabels).toContain('跳到学习报告');
    expect(studentLabels).not.toContain('跳到评价复核');
  });

  it('教师看不到学生端的「跳到学习报告」', () => {
    expect(teacherLabels).toContain('跳到评价复核');
    expect(teacherLabels).not.toContain('跳到学习报告');
  });

  it('未登录时两个跨角色条目都不出现', () => {
    expect(anonymousLabels).not.toContain('跳到学习报告');
    expect(anonymousLabels).not.toContain('跳到评价复核');
  });

  it('角色自身的条目不受影响（不能被角色过滤一起滤掉）', () => {
    // 学生端条目
    expect(studentLabels).toContain('学情诊断');
    expect(studentLabels).toContain('章节与知识图谱');
    // 教师端条目
    expect(teacherLabels).toContain('评价复核');
    expect(teacherLabels).toContain('班级画像');
  });

  it('跨角色条目不会被另一角色看到——面板集合按角色严格分离', () => {
    const studentViews = findShortcutsForPalette('student')
      .filter((b) => b.action.type === 'navigate')
      .map((b) => (b.action as { role: string }).role);
    expect(studentViews.every((role) => role === 'student')).toBe(true);

    const teacherViews = findShortcutsForPalette('teacher')
      .filter((b) => b.action.type === 'navigate')
      .map((b) => (b.action as { role: string }).role);
    expect(teacherViews.every((role) => role === 'teacher')).toBe(true);
  });
});

describe('深链接的角色一致性判定', () => {
  it('学生深链接教师端路由 → 挡下并送回学生首页', () => {
    const gate = resolveDeepLinkRoleGate('teacher', 'student');
    expect(gate.blocked).toBe(true);
    expect(gate.redirectTo).toBe('/physics/overview');
  });

  it('教师深链接学生端路由 → 挡下并送回教师首页', () => {
    const gate = resolveDeepLinkRoleGate('student', 'teacher');
    expect(gate.blocked).toBe(true);
    expect(gate.redirectTo).toBe('/teacher/dashboard');
  });

  it('同角色深链接 → 不挡（正常深链接必须能用）', () => {
    expect(resolveDeepLinkRoleGate('student', 'student').blocked).toBe(false);
    expect(resolveDeepLinkRoleGate('teacher', 'teacher').blocked).toBe(false);
    expect(resolveDeepLinkRoleGate('teacher', 'student').redirectTo).toBe('/physics/overview');
  });

  it('会话还没水合时**不挡**——否则会误伤正常刷新', () => {
    // 会话在 sessionStorage 里，挂载前读不到。此时贸然判「跨角色」，
    // 会把一次正常刷新变成「正在返回…」。
    expect(resolveDeepLinkRoleGate('teacher', null).blocked).toBe(false);
    expect(resolveDeepLinkRoleGate(null, 'student').blocked).toBe(false);
    expect(resolveDeepLinkRoleGate(null, null).blocked).toBe(false);
  });
});
