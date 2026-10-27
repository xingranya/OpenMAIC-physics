import { PhysicsStateProvider } from '@/components/physics/state-provider';
import { StudentViewRouter } from '@/components/physics/student-router';
import { WorkbenchShell } from '@/components/physics/workbench';
import { STUDENT_VIEW_IDS } from '@/lib/physics/shortcuts';

/**
 * 预渲染 11 个学生视图。
 *
 * 变成静态页之后，客户端路由缓存里就有它们的 RSC payload：从首页跳进
 * 工作台、以及在断网时跨页面跳转，都不必再向服务端要一次数据。
 * 页面本身不依赖 [view]（视图由客户端组件按上下文挑），所以预渲染
 * 不会带来任何按视图定制的内容差异。
 */
export function generateStaticParams() {
  return STUDENT_VIEW_IDS.map((view) => ({ view }));
}

/**
 * 未列出的视图一律 404。
 *
 * 没有这一行时，`/physics/not-a-view` 会返回 **200**：服务端先渲染
 * 「正在加载工作台…」，客户端再跳回首页。用户拿到的是一个「正常但不对」的
 * 页面，比 404 更困惑，爬虫也会把它当成有效页面收录。
 *
 * 加了这个之后，非法视图在**服务端**就被拒掉，`workbench.tsx` 里那套
 * 角色跳转仍然保留——它对直接渲染 Shell 的场景（单测）依旧是必要的。
 */
export const dynamicParams = false;

/** 学生端物理工作台：按 [view] 渲染 11 个视图之一。 */
export default function StudentViewPage() {
  return (
    <PhysicsStateProvider>
      <WorkbenchShell>
        <StudentViewRouter />
      </WorkbenchShell>
    </PhysicsStateProvider>
  );
}
