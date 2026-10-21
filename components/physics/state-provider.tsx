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
  createInitialState,
  loadState,
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
}

const PhysicsStateContext = React.createContext<PhysicsStateContextValue | null>(null);

export function PhysicsStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>(() => loadState());
  const [session, setSessionState] = React.useState<PhysicsSession | null>(() => getSession());
  const [lastUndo, setLastUndo] = React.useState<UndoMeta | null>(() => readUndoMeta());

  // 持久化：状态变化即写入版本化 localStorage 包络。
  React.useEffect(() => {
    saveState(state);
  }, [state]);

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
    () => ({ state, update, reset, rollback, lastUndo, session, signIn, signOut }),
    [state, update, reset, rollback, lastUndo, session, signIn, signOut],
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
