/**
 * 24 小时可恢复快照。
 *
 * 破坏性动作（重置学习记录、重新诊断、切换项目）在执行前把当前状态
 * 写入快照，24 小时内可一键回滚。这是"破坏性动作必须可逆"原则的落地。
 */

import type { AppState } from './types';

const UNDO_KEY = 'physics-ai-undo-snapshot';
const UNDO_META_KEY = 'physics-ai-undo-meta';

/** 快照有效期：24 小时。 */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 快照元信息。 */
export interface UndoMeta {
  /** 触发快照的动作说明。 */
  reason: string;
  /** 写入时间戳。 */
  timestamp: number;
}

function getStorage(): Storage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

/** 读取快照元信息；已过期则清理并返回 null。 */
export function readUndoMeta(): UndoMeta | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(UNDO_META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as UndoMeta;
    if (!meta?.timestamp || Date.now() - meta.timestamp > UNDO_WINDOW_MS) {
      storage.removeItem(UNDO_META_KEY);
      storage.removeItem(UNDO_KEY);
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/** 读取快照内容。 */
export function readUndoSnapshot(): AppState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(UNDO_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

/** 写入快照。 */
export function writeUndoSnapshot(state: AppState, reason: string): UndoMeta | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    storage.setItem(UNDO_KEY, JSON.stringify(state));
    const meta: UndoMeta = { reason, timestamp: Date.now() };
    storage.setItem(UNDO_META_KEY, JSON.stringify(meta));
    return meta;
  } catch {
    return null;
  }
}

/** 清除快照。 */
export function clearUndoSnapshot(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(UNDO_KEY);
    storage.removeItem(UNDO_META_KEY);
  } catch {
    /* 忽略：清理失败不应阻断主流程 */
  }
}

/** 格式化剩余可恢复时间。 */
export function formatUndoRemaining(meta: UndoMeta, now: number = Date.now()): string {
  const remain = Math.max(0, meta.timestamp + UNDO_WINDOW_MS - now);
  const hours = Math.floor(remain / (60 * 60 * 1000));
  const minutes = Math.floor((remain % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) return `${minutes} 分钟内可撤销`;
  return `${hours} 小时 ${minutes} 分内可撤销`;
}
