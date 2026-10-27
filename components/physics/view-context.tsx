'use client';

/**
 * 工作台视图上下文。
 *
 * 为什么需要它：Next.js 15+ 的 App Router 里，**动态路由**的客户端跳转
 * （`router.push('/physics/diagnosis')`）一定要拉一次该路由的 RSC payload
 * （`text/x-component`）。断网时这次拉取必然失败，视图就切不过去——
 * 而工作台的 11 个学生视图、8 个教师视图其实都是**同一个客户端组件**按路径
 * 挑出来的，内容本身并不需要网络。
 *
 * 所以把"当前视图"提到本地状态：
 *  - 切视图时**先**改本地状态，内容立刻就位；
 *  - 再用**浏览器原生 History API**（`window.history.pushState`）同步地址栏：
 *    全程不发任何请求，联网断网行为一致，地址栏也必然跟上
 *    （Next 的 App Router 会与之同步，深链接与前进后退照常工作）。
 *
 * 早期版本这里写的是"再调一次 `router.push`"，但那条路断网时会把整页换成
 * 路由错误页——实测断网点侧栏直接白屏。现在不再调用 `router.push`。
 *
 * 这条不是锦上添花：验收清单 G 节写着「断网后：物理工作台全部视图仍可用」，
 * 而这是现场保命项。
 */
import * as React from 'react';

export interface PhysicsViewContextValue {
  /** 当前视图 id（学生端如 'diagnosis'，教师端如 'insights'）。 */
  view: string;
  /**
   * 切换视图：立即切换本地视图，并用原生 History API 同步地址栏。
   *
   * 不发网络请求，所以断网时地址栏与内容都照常更新。
   */
  setView: (view: string) => void;
}

const PhysicsViewContext = React.createContext<PhysicsViewContextValue | null>(null);

export function PhysicsViewProvider({
  value,
  children,
}: {
  value: PhysicsViewContextValue;
  children?: React.ReactNode;
}) {
  return <PhysicsViewContext.Provider value={value}>{children}</PhysicsViewContext.Provider>;
}

export function usePhysicsView(): PhysicsViewContextValue {
  const context = React.useContext(PhysicsViewContext);
  if (!context) {
    throw new Error('usePhysicsView 必须在 PhysicsViewProvider 内使用');
  }
  return context;
}
