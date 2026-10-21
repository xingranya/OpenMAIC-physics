'use client';

/**
 * 教师端视图路由：按当前路径渲染 5 个视图之一。
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { TeacherClass } from './teacher/class';
import { TeacherCurriculum } from './teacher/curriculum';
import { TeacherDashboard } from './teacher/dashboard';
import { TeacherEvaluation } from './teacher/evaluation';
import { TeacherInsights } from './teacher/insights';

export function TeacherViewRouter() {
  const pathname = usePathname();
  const view = pathname.split('/').filter(Boolean)[1] ?? 'dashboard';

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
