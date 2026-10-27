'use client';

/**
 * 把教师的审核结果并回学生本地状态。
 *
 * ## 为什么需要这个 Hook
 *
 * 学习数据按账号分区（`physicsAISystem:<userId>`），教师的审核结果写在
 * 共享提交键里（见 `lib/physics/submissions.ts`）。两条数据在**不同的键**上，
 * 谁也不会自动把对方的内容带过来——学生刷新后仍会看到「待教师审核」，
 * 除非有人主动做一次合并。
 *
 * 所以三个三诊视图挂载时都调一次这个 Hook：
 * - 挂载即同步（学生刷新页面 / 从侧栏切进来）；
 * - 监听 `storage` 事件（教师在**另一个标签页**审核完，学生这边立刻跟上）；
 * - 监听 `focus`（同标签页先退出再登录的情况，靠切回窗口触发）。
 *
 * ## 为什么用 ref 而不是把 state 放进依赖
 *
 * 合并成功后要 `update()`，`update` 会改 state，state 又是依赖 → 立刻再合并
 * 一次。虽然第二次会因为「没有变化」而停住，但每次状态变化都多读一次
 * localStorage 是白花的。用 ref 读最新状态、依赖只留 `userId`，就只有
 * 「换账号」和「外部事件」会触发。
 */

import * as React from 'react';

import { usePhysicsState } from './state-provider';
import { mergeSharedIntoState } from '@/lib/physics/submissions';

export function useSharedReviewSync(): void {
  const { state, update, session } = usePhysicsState();
  const userId = session?.userId;

  // 用 ref 读最新状态，避免把 `state` 放进 `sync` 的依赖：
  // 合并成功后会 `update()`，state 一变就又触发合并，虽然第二次会因为
  // 「没有变化」停住，但每次状态变化都多读一次 localStorage 是白花的。
  //
  // 赋值放在 effect 里而不是渲染期：渲染期写 ref 会被 `react-hooks/refs`
  // 拦下（React 19 的编译器规则），而且渲染期写入在并发渲染下本就不安全。
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const sync = React.useCallback(() => {
    if (!userId) return;
    const merged = mergeSharedIntoState(stateRef.current, userId);
    if (!merged.changed) return;
    update({
      preClass: merged.state.preClass,
      inClass: merged.state.inClass,
      postClass: merged.state.postClass,
    });
  }, [userId, update]);

  React.useEffect(() => {
    sync();
  }, [sync]);

  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // 只关心提交键：别的键变化与本 Hook 无关。
      if (event.key && !event.key.startsWith('physicsAISystem:submissions')) return;
      sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
    };
  }, [sync]);
}
