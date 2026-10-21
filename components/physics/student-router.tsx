'use client';

/**
 * 学生端视图路由：按当前路径渲染 8 个视图之一。
 *
 * 路由由 `WorkbenchShell` 的侧栏与快捷键驱动，这里只负责把路径映射到视图组件。
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { StudentAssistant } from './student/assistant';
import { StudentCurriculum } from './student/curriculum';
import { StudentDiagnosis } from './student/diagnosis';
import { StudentLab } from './student/lab';
import { StudentOverview } from './student/overview';
import { StudentProjects } from './student/projects';
import { StudentReport } from './student/report';
import { StudentTasks } from './student/tasks';

export function StudentViewRouter() {
  const pathname = usePathname();
  const view = pathname.split('/').filter(Boolean)[1] ?? 'overview';

  switch (view) {
    case 'diagnosis':
      return <StudentDiagnosis />;
    case 'curriculum':
      return <StudentCurriculum />;
    case 'projects':
      return <StudentProjects />;
    case 'tasks':
      return <StudentTasks />;
    case 'assistant':
      return <StudentAssistant />;
    case 'lab':
      return <StudentLab />;
    case 'report':
      return <StudentReport />;
    case 'overview':
    default:
      return <StudentOverview />;
  }
}
