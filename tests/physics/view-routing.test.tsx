import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * 工作台视图切换的回归护栏。
 *
 * 背景：Next.js 15+ 的动态路由客户端跳转一定要拉一次该路由的 RSC payload，
 * 断网时这次拉取失败，Next 会把整页换成路由错误页——实测断网后点侧栏
 * 「学情诊断」直接白屏。而工作台的 8 个学生视图、5 个教师视图其实都是
 * 同一个客户端组件按视图 id 挑出来的，内容根本不需要网络。
 *
 * 所以视图 id 必须来自**本地状态**（`components/physics/view-context.tsx`），
 * 路由只负责把地址栏同步过去。这条测试守住这个约定：路由器读的是上下文
 * 里的视图 id，不是路径。
 */

// 把每个视图替换成一个带标记的桩组件。
vi.mock('@/components/physics/student/overview', () => ({
  StudentOverview: () => createElement('div', null, 'VIEW:overview'),
}));
vi.mock('@/components/physics/student/diagnosis', () => ({
  StudentDiagnosis: () => createElement('div', null, 'VIEW:diagnosis'),
}));
vi.mock('@/components/physics/student/curriculum', () => ({
  StudentCurriculum: () => createElement('div', null, 'VIEW:curriculum'),
}));
vi.mock('@/components/physics/student/projects', () => ({
  StudentProjects: () => createElement('div', null, 'VIEW:projects'),
}));
vi.mock('@/components/physics/student/tasks', () => ({
  StudentTasks: () => createElement('div', null, 'VIEW:tasks'),
}));
vi.mock('@/components/physics/student/assistant', () => ({
  StudentAssistant: () => createElement('div', null, 'VIEW:assistant'),
}));
vi.mock('@/components/physics/student/lab', () => ({
  StudentLab: () => createElement('div', null, 'VIEW:lab'),
}));
vi.mock('@/components/physics/student/report', () => ({
  StudentReport: () => createElement('div', null, 'VIEW:report'),
}));
vi.mock('@/components/physics/teacher/dashboard', () => ({
  TeacherDashboard: () => createElement('div', null, 'VIEW:dashboard'),
}));
vi.mock('@/components/physics/teacher/class', () => ({
  TeacherClass: () => createElement('div', null, 'VIEW:class'),
}));
vi.mock('@/components/physics/teacher/curriculum', () => ({
  TeacherCurriculum: () => createElement('div', null, 'VIEW:teacher-curriculum'),
}));
vi.mock('@/components/physics/teacher/evaluation', () => ({
  TeacherEvaluation: () => createElement('div', null, 'VIEW:evaluation'),
}));
vi.mock('@/components/physics/teacher/insights', () => ({
  TeacherInsights: () => createElement('div', null, 'VIEW:insights'),
}));

import { StudentViewRouter } from '@/components/physics/student-router';
import { TeacherViewRouter } from '@/components/physics/teacher-router';
import { PhysicsViewProvider } from '@/components/physics/view-context';

function renderWithView(node: React.ReactNode, view: string) {
  return renderToStaticMarkup(
    createElement(PhysicsViewProvider, { value: { view, setView: () => undefined } }, node),
  );
}

describe('工作台视图由本地状态驱动（断网可切换）', () => {
  it('学生端按上下文里的视图 id 渲染', () => {
    for (const view of [
      'overview',
      'diagnosis',
      'curriculum',
      'projects',
      'tasks',
      'assistant',
      'lab',
      'report',
    ]) {
      expect(renderWithView(createElement(StudentViewRouter), view)).toContain(`VIEW:${view}`);
    }
  });

  it('教师端按上下文里的视图 id 渲染', () => {
    // 学生端与教师端都有 'curriculum'，桩组件的标记要能区分开。
    const expected: Record<string, string> = {
      dashboard: 'VIEW:dashboard',
      class: 'VIEW:class',
      curriculum: 'VIEW:teacher-curriculum',
      evaluation: 'VIEW:evaluation',
      insights: 'VIEW:insights',
    };
    for (const [view, marker] of Object.entries(expected)) {
      expect(renderWithView(createElement(TeacherViewRouter), view)).toContain(marker);
    }
  });

  it('视图 id 与路径解耦：上下文说 diagnosis 就渲染诊断页', () => {
    // 路径此时仍然是 /physics/overview——这正是断网时的情形：
    // 地址栏没跟上，但内容必须是对的。
    expect(renderWithView(createElement(StudentViewRouter), 'diagnosis')).toContain(
      'VIEW:diagnosis',
    );
  });
});
