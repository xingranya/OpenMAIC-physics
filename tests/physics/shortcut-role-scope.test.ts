import { describe, expect, it } from 'vitest';

import { findShortcutsForPalette } from '@/lib/physics/shortcuts';

/**
 * 命令面板的角色可见性回归护栏。
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
