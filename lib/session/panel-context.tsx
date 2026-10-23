'use client';

/**
 * "This classroom is hosted inside the workbench panel" — ambient context.
 *
 * 上游的 Pro 工作台（`/workspace`）已删除，课堂不再有「被工作台面板托管」
 * 的第二种形态：这个 Context 的默认值就是「不在工作台里」，面板 Provider
 * 也随之消失——留着它就等于给一个已删除的入口留后门。
 *
 * 保留 `useInWorkbenchPanel` 这个读接口，是因为画布 / 编辑器 chrome 仍在
 * 用它区分「独立课堂」与「托管课堂」；删掉工作台之后它恒为 `false`，
 * 读它的那些分支自然落到独立课堂这一侧。
 */
import { createContext, useContext } from 'react';

export interface WorkbenchPanelState {
  readonly hosted: boolean;
  /** Whether the classroom column is actually visible in the workspace. */
  readonly visible: boolean;
  /** Whether the hosted classroom is in full-screen learning playback. */
  readonly playback: boolean;
  /**
   * The pane's chrome lock: the hosted classroom is EDIT, full stop.
   */
  readonly editPinned: boolean;
}

const OUTSIDE_WORKBENCH: WorkbenchPanelState = {
  hosted: false,
  visible: true,
  playback: false,
  editPinned: false,
};

const WorkbenchPanelContext = createContext<WorkbenchPanelState>(OUTSIDE_WORKBENCH);

export function useInWorkbenchPanel(): boolean {
  return useContext(WorkbenchPanelContext).hosted;
}

/**
 * View state supplied by the workspace pane itself.
 */
export function useWorkbenchPanelState(): WorkbenchPanelState {
  return useContext(WorkbenchPanelContext);
}
