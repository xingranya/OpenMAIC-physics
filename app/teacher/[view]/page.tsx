import { PhysicsStateProvider } from '@/components/physics/state-provider';
import { TeacherViewRouter } from '@/components/physics/teacher-router';
import { WorkbenchShell } from '@/components/physics/workbench';
import { TEACHER_VIEW_IDS } from '@/lib/physics/shortcuts';

/** 预渲染 5 个教师视图（理由同学生端：静态页才能进客户端路由缓存）。 */
export function generateStaticParams() {
  return TEACHER_VIEW_IDS.map((view) => ({ view }));
}

/** 未列出的教师视图一律 404（理由同学生端）。 */
export const dynamicParams = false;

/** 教师端工作台：按 [view] 渲染 5 个视图之一。 */
export default function TeacherViewPage() {
  return (
    <PhysicsStateProvider>
      <WorkbenchShell>
        <TeacherViewRouter />
      </WorkbenchShell>
    </PhysicsStateProvider>
  );
}
