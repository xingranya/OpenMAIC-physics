import { PhysicsStateProvider } from '@/components/physics/state-provider';
import { StudentViewRouter } from '@/components/physics/student-router';
import { WorkbenchShell } from '@/components/physics/workbench';

/** 学生端物理工作台：按 [view] 渲染 8 个视图之一。 */
export default function StudentViewPage() {
  return (
    <PhysicsStateProvider>
      <WorkbenchShell>
        <StudentViewRouter />
      </WorkbenchShell>
    </PhysicsStateProvider>
  );
}
