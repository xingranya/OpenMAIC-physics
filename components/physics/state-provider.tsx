'use client';

/**
 * 物理工作台状态容器。
 *
 * 领域逻辑全部来自移植的纯函数层（`@/lib/physics/engine`），
 * 这里只负责 React 状态与浏览器持久化（localStorage 版本化包络）。
 * 破坏性动作走 24 小时可恢复快照（`@/lib/physics/undo`）。
 */

import * as React from 'react';

import {
  clearDiagnosisResult,
  createInitialState,
  loadState,
  resetProjectProgress,
  saveState,
  updateState,
} from '@/lib/physics/local-store';
import {
  authenticate,
  clearSession,
  getSession,
  setSession,
  type PhysicsSession,
} from '@/lib/physics/session';
import {
  clearUndoSnapshot,
  readUndoMeta,
  readUndoSnapshot,
  writeUndoSnapshot,
  type UndoMeta,
} from '@/lib/physics/undo';
import type { AppState } from '@/lib/physics/types';

interface PhysicsStateContextValue {
  /** 当前学习/教学状态。 */
  state: AppState;
  /** 合并式更新状态（自动持久化）。 */
  update: (patch: Partial<AppState>) => void;
  /** 破坏性动作：先写快照再清空。 */
  reset: (reason: string) => void;
  /** 切换项目：先写快照，再只清空项目级进度（保留学情画像与教师复核）。 */
  resetProject: (reason: string, projectId: string | null) => void;
  /** 重新诊断：先写快照，再只清空诊断结果（保留项目进度与实验记录）。 */
  resetDiagnosis: (reason: string) => void;
  /** 回滚到最近一次快照。 */
  rollback: () => boolean;
  /** 最近一次可撤销操作的元信息。 */
  lastUndo: UndoMeta | null;
  /** 当前登录会话。 */
  session: PhysicsSession | null;
  /** 登录；成功返回 true。 */
  signIn: (username: string, password: string) => boolean;
  /** 退出登录。 */
  signOut: () => void;
  /**
   * 是否已完成浏览器存储的首次读取。
   *
   * 服务端渲染阶段拿不到 localStorage / sessionStorage，若在渲染期直接读取，
   * 服务端 HTML 与客户端首次渲染就会不一致（React 水合错误 #418）。
   * 因此首帧统一使用空状态，挂载后再补齐真实数据。
   */
  hydrated: boolean;
}

const PhysicsStateContext = React.createContext<PhysicsStateContextValue | null>(null);

export function PhysicsStateProvider({ children }: { children: React.ReactNode }) {
  // 首帧必须与服务端渲染结果一致：空状态 + 未登录 + 无快照。
  const [state, setState] = React.useState<AppState>(() => createInitialState());
  const [session, setSessionState] = React.useState<PhysicsSession | null>(null);
  const [lastUndo, setLastUndo] = React.useState<UndoMeta | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  // 挂载后再读取浏览器存储：服务端没有这些数据，只能延后到客户端。
  React.useEffect(() => {
    setState(loadState());
    setSessionState(getSession());
    setLastUndo(readUndoMeta());
    setHydrated(true);
  }, []);

  // 持久化：状态变化即写入版本化 localStorage 包络（首次读取完成前不写，避免清空已有数据）。
  React.useEffect(() => {
    if (!hydrated) return;
    saveState(state);
  }, [state, hydrated]);

  const update = React.useCallback((patch: Partial<AppState>) => {
    setState((previous) => updateState(previous, patch));
  }, []);

  const reset = React.useCallback((reason: string) => {
    setState((previous) => {
      writeUndoSnapshot(previous, reason);
      setLastUndo(readUndoMeta());
      return createInitialState();
    });
  }, []);

  const resetProject = React.useCallback((reason: string, projectId: string | null) => {
    setState((previous) => {
      writeUndoSnapshot(previous, reason);
      setLastUndo(readUndoMeta());
      return resetProjectProgress(previous, projectId);
    });
  }, []);

  const resetDiagnosis = React.useCallback((reason: string) => {
    setState((previous) => {
      writeUndoSnapshot(previous, reason);
      setLastUndo(readUndoMeta());
      return clearDiagnosisResult(previous);
    });
  }, []);

  const rollback = React.useCallback(() => {
    const snapshot = readUndoSnapshot();
    if (!snapshot) return false;
    setState(snapshot);
    clearUndoSnapshot();
    setLastUndo(null);
    return true;
  }, []);

  const signIn = React.useCallback((username: string, password: string) => {
    const result = authenticate(username, password);
    if (!result) return false;
    const next = setSession(result.role, result.displayName);
    setSessionState(next);
    return true;
  }, []);

  const signOut = React.useCallback(() => {
    clearSession();
    setSessionState(null);
  }, []);

  const value = React.useMemo<PhysicsStateContextValue>(
    () => ({ state, update, reset, resetProject, resetDiagnosis, rollback, lastUndo, session, signIn, signOut, hydrated }),
    [state, update, reset, resetProject, resetDiagnosis, rollback, lastUndo, session, signIn, signOut, hydrated],
  );

  return <PhysicsStateContext.Provider value={value}>{children}</PhysicsStateContext.Provider>;
}

export function usePhysicsState(): PhysicsStateContextValue {
  const context = React.useContext(PhysicsStateContext);
  if (!context) {
    throw new Error('usePhysicsState 必须在 PhysicsStateProvider 内使用');
  }
  return context;
}
