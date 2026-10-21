import { PhysicsStateProvider } from '@/components/physics/state-provider';
import { TeacherViewRouter } from '@/components/physics/teacher-router';
import { WorkbenchShell } from '@/components/physics/workbench';

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
