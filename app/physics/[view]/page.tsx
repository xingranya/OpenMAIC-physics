import { PhysicsStateProvider } from '@/components/physics/state-provider';
import { StudentViewRouter } from '@/components/physics/student-router';
import { WorkbenchShell } from '@/components/physics/workbench';
import { STUDENT_VIEW_IDS } from '@/lib/physics/shortcuts';

/**
 * 预渲染 8 个学生视图。
 *
 * 变成静态页之后，客户端路由缓存里就有它们的 RSC payload：从首页跳进
 * 工作台、以及在断网时跨页面跳转，都不必再向服务端要一次数据。
 * 页面本身不依赖 [view]（视图由客户端组件按上下文挑），所以预渲染
 * 不会带来任何按视图定制的内容差异。
 */
export function generateStaticParams() {
  return STUDENT_VIEW_IDS.map((view) => ({ view }));
}

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
