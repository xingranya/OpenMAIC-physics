'use client';

import { useEffect } from 'react';
import { installSessionHeaderBridge } from '@/lib/physics/session-header';

/**
 * 把会话令牌接到 `x-physics-session` 请求头上的挂载点。
 *
 * ## 为什么在模块顶层就装
 *
 * 水合期间（`ServerProvidersInit` 的 effect 里）就会有 `/api/` 请求发出。
 * 只放在 `useEffect` 里装的话，**第一批请求会漏掉这条通道**——
 * 表现是「刚打开页面偶尔 401，刷新一下又好了」。
 * 客户端组件模块在浏览器里是**先求值、后渲染**的，所以在顶层装最早。
 *
 * SSR 阶段这段代码也会执行，但 `installSessionHeaderBridge` 在没有
 * `window` 时直接返回，不会污染服务端。
 */
installSessionHeaderBridge();

export function SessionBridge() {
  // 幂等兜底：模块顶层那一次若发生在 `window` 就绪之前（例如被内联进
  // 早期的预渲染脚本），effect 里再装一次；已经装过就直接复用。
  useEffect(() => {
    installSessionHeaderBridge();
  }, []);

  return null;
}
