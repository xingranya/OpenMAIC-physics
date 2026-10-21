'use client';

/**
 * 教师端视图路由：按当前视图渲染 5 个视图之一。
 *
 * 与学生端同理：视图 id 来自本地状态而非路径，断网时切换照样生效。
 * 详见 `components/physics/view-context.tsx`。
 */

import * as React from 'react';

import { usePhysicsView } from './view-context';
import { TeacherClass } from './teacher/class';
import { TeacherCurriculum } from './teacher/curriculum';
import { TeacherDashboard } from './teacher/dashboard';
import { TeacherEvaluation } from './teacher/evaluation';
import { TeacherInsights } from './teacher/insights';

export function TeacherViewRouter() {
  const { view } = usePhysicsView();

  switch (view) {
    case 'class':
      return <TeacherClass />;
    case 'curriculum':
      return <TeacherCurriculum />;
    case 'evaluation':
      return <TeacherEvaluation />;
    case 'insights':
      return <TeacherInsights />;
    case 'dashboard':
    default:
      return <TeacherDashboard />;
  }
}
