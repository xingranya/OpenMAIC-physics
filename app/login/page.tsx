import { Suspense } from 'react';

import { PhysicsLogin } from '@/components/physics/login';
import { PhysicsStateProvider } from '@/components/physics/state-provider';

/**
 * 物理工作台登录页（演示账号校验，不连接真实教务系统）。
 *
 * 组件里用了 useSearchParams 读取 `?demo=student` / `?demo=teacher`
 * 的一键入口，Next.js 要求它位于 Suspense 边界之内，
 * 否则该页无法被静态预渲染。
 */
export default function LoginPage() {
  return (
    <PhysicsStateProvider>
      <Suspense fallback={null}>
        <PhysicsLogin />
      </Suspense>
    </PhysicsStateProvider>
  );
}
