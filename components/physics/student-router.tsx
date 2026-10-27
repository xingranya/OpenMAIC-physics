'use client';

/**
 * 学生端视图路由：按当前视图渲染 11 个视图之一。
 *
 * 视图由 `WorkbenchShell` 的侧栏与快捷键驱动，这里只负责把视图 id 映射到
 * 视图组件。视图 id 来自**本地状态**而不是路径：断网时 Next 的动态路由跳转
 * 会失败，但工作台的内容全是客户端组件，不该被网络拖住。
 * 详见 `components/physics/view-context.tsx`。
 */

import * as React from 'react';

import { usePhysicsView } from './view-context';
import { StudentAssistant } from './student/assistant';
import { StudentCurriculum } from './student/curriculum';
import { StudentDiagnosis } from './student/diagnosis';
import { StudentInClass } from './student/inclass';
import { StudentLab } from './student/lab';
import { StudentOverview } from './student/overview';
import { StudentPostClass } from './student/postclass';
import { StudentPreClass } from './student/preclass';
import { StudentProjects } from './student/projects';
import { StudentReport } from './student/report';
import { StudentTasks } from './student/tasks';

export function StudentViewRouter() {
  const { view } = usePhysicsView();

  switch (view) {
    case 'diagnosis':
      return <StudentDiagnosis />;
    // 三诊：课前 → 课中 → 课后。
    case 'preclass':
      return <StudentPreClass />;
    case 'inclass':
      return <StudentInClass />;
    case 'postclass':
      return <StudentPostClass />;
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
