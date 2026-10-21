/**
 * 预置课堂包 —— 课堂动作（旁白 / 白板演算 / 讨论）。
 *
 * 动作是课堂播放的"剧本"：旁白由 TTS 朗读，白板动作让 AI 教师实时演算，
 * 讨论动作把某位同学点名发言。这些动作让预置包与真实生成的课堂
 * 在播放体验上完全一致——**不依赖任何模型调用**。
 *
 * 坐标约定沿用上游白板画布：x ∈ [0, 1000]，y ∈ [0, 562]。
 */

import type { Action } from '@openmaic/dsl';

/** 白板画布宽。 */
const BOARD_WIDTH = 1000;
/** 白板画布高（16:9）。 */
const BOARD_HEIGHT = 562;

/** 白板演算的一步。 */
export interface WhiteboardStep {
  /** 公式（LaTeX）。 */
  latex: string;
  /** 这一步的说明（以白板文本形式出现在公式旁）。 */
  note?: string;
}

/** 动作构建上下文。 */
export interface ActionBuildContext {
  /** 场景 id，用于生成稳定且唯一的动作 id。 */
  sceneId: string;
  /** 旁白稿。 */
  narration: string;
  /** 白板演算步骤。 */
  whiteboard?: readonly WhiteboardStep[];
  /** 讨论引导语。 */
  discussionPrompt?: string;
  /** 发言的智能体 id。 */
  discussionAgentId?: string;
}

/**
 * 为一个场景构建动作序列。
 *
 * 顺序：旁白 → （有白板步骤时）开板 → 逐步演算 → 关板 → （有讨论时）讨论。
 * 动作 id 由场景 id 与序号派生，保证重复导入同一份包时动作 id 稳定。
 */
export function buildSceneActions(context: ActionBuildContext): Action[] {
  const actions: Action[] = [];
  let index = 0;
  const nextId = (suffix: string) => `act-${context.sceneId}-${suffix}-${index++}`;

  if (context.narration) {
    actions.push({
      id: nextId('speech'),
      type: 'speech',
      text: context.narration,
    });
  }

  const steps = context.whiteboard ?? [];
  if (steps.length > 0) {
    actions.push({ id: nextId('wb_open'), type: 'wb_open' });

    let y = 70;
    steps.forEach((step, stepIndex) => {
      // 公式在左，注释在右，纵向依次排开。
      actions.push({
        id: nextId('wb_latex'),
        type: 'wb_draw_latex',
        elementId: `wb-${context.sceneId}-formula-${stepIndex}`,
        latex: step.latex,
        x: 90,
        y,
        width: 430,
        height: 70,
        color: '#0f172a',
      });
      if (step.note) {
        actions.push({
          id: nextId('wb_text'),
          type: 'wb_draw_text',
          elementId: `wb-${context.sceneId}-note-${stepIndex}`,
          content: step.note,
          x: 560,
          y: y + 12,
          width: 380,
          height: 60,
          fontSize: 20,
          color: '#334155',
        });
      }
      y += 96;
      if (y > BOARD_HEIGHT - 120) y = 70;
    });

    actions.push({ id: nextId('wb_close'), type: 'wb_close' });
  }

  if (context.discussionPrompt) {
    actions.push({
      id: nextId('discussion'),
      type: 'discussion',
      topic: context.discussionPrompt,
      agentId: context.discussionAgentId,
    });
  }

  return actions;
}

/** 白板画布尺寸，供构建器计算元素位置。 */
export const WHITEBOARD_SIZE = { width: BOARD_WIDTH, height: BOARD_HEIGHT } as const;
