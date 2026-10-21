import { PhysicsLogin } from '@/components/physics/login';
import { PhysicsStateProvider } from '@/components/physics/state-provider';

/** 物理工作台登录页（演示账号校验，不连接真实教务系统）。 */
export default function LoginPage() {
  return (
    <PhysicsStateProvider>
      <PhysicsLogin />
    </PhysicsStateProvider>
  );
}
