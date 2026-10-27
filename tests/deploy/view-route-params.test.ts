import { describe, expect, it } from 'vitest';
import * as physicsPage from '@/app/physics/[view]/page';
import * as teacherPage from '@/app/teacher/[view]/page';
import { STUDENT_VIEW_IDS, TEACHER_VIEW_IDS } from '@/lib/physics/shortcuts';
import { parseWorkbenchPath } from '@/components/physics/workbench';

/**
 * 视图路由的静态参数契约。
 *
 * ## 两个各自能出事的断言
 *
 * 1. **`dynamicParams === false`**：没有它，`/physics/not-a-view` 返回 200，
 *    服务端渲染「正在加载工作台…」，客户端再跳首页。用户看到的是一个
 *    「正常但不对」的页面，爬虫会把它当有效页面收录。
 * 2. **预渲染集合与侧栏导航一致**：`dynamicParams=false` 之后，凡是不在
 *    `generateStaticParams` 里的视图都会 404。如果侧栏（`workbench.tsx`
 *    里的 `STUDENT_NAV`）比它多一个 id，那个导航项点下去就是 404——
 *    从「多一个视图」变成「坏一个入口」，比原来的软 404 更严重。
 *
 * 第 2 点用 `parseWorkbenchPath` 来验，而不是去读私有常量：它正是运行时
 * 真正决定「这个路径算不算合法视图」的那个函数，验它等于验了调用点。
 */
describe('学生端视图路由', () => {
  it('未知视图走 404 而不是软 404', () => {
    expect(physicsPage.dynamicParams).toBe(false);
  });

  it('预渲染集合等于视图枚举', () => {
    const params = physicsPage.generateStaticParams().map((item) => item.view);
    expect([...params].sort()).toEqual([...STUDENT_VIEW_IDS].sort());
  });

  it('每个合法学生视图都能被工作台解析出来', () => {
    for (const view of STUDENT_VIEW_IDS) {
      expect(parseWorkbenchPath(`/physics/${view}`), `/physics/${view} 解析失败`).toEqual({
        role: 'student',
        view,
      });
    }
  });
});

describe('教师端视图路由', () => {
  it('未知视图走 404 而不是软 404', () => {
    expect(teacherPage.dynamicParams).toBe(false);
  });

  it('预渲染集合等于视图枚举', () => {
    const params = teacherPage.generateStaticParams().map((item) => item.view);
    expect([...params].sort()).toEqual([...TEACHER_VIEW_IDS].sort());
  });

  it('每个合法教师视图都能被工作台解析出来', () => {
    for (const view of TEACHER_VIEW_IDS) {
      expect(parseWorkbenchPath(`/teacher/${view}`), `/teacher/${view} 解析失败`).toEqual({
        role: 'teacher',
        view,
      });
    }
  });
});
