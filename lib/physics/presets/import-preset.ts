'use client';

/**
 * 预置课堂包 —— 导入到浏览器课堂库。
 *
 * 导入路径与"生成课堂"完全一致：写入浏览器文档库（IndexedDB），
 * 因此导入后的课堂与真实生成的课堂在播放、讨论、导出上没有任何差别。
 *
 * 这条路径是"零配额、零网络"演示的保底：没有模型 Key 或现场断网时，
 * 评委依然能完整走一遍「进入课堂 → 听讲 → 答题 → 导出」。
 */

import { saveStageData } from '@/lib/utils/stage-storage';
import { buildPresetClassroom } from './build-classroom';
import type { PresetClassroom } from './types';

/** 导入结果。 */
export interface ImportPresetResult {
  /** 导入成功的课堂 id。 */
  stageId: string;
  /** 场景数量。 */
  sceneCount: number;
}

/**
 * 把一份预置课堂剧本导入浏览器课堂库。
 *
 * @param preset 预置包
 * @param onProgress 可选进度回调
 */
export async function importPresetClassroom(
  preset: PresetClassroom,
  onProgress?: (stage: 'building' | 'saving' | 'done') => void,
): Promise<ImportPresetResult> {
  onProgress?.('building');
  const { stage, scenes, currentSceneId } = buildPresetClassroom(preset);

  onProgress?.('saving');
  // epoch 0 = 该课堂尚未被删除，浏览器文档库据此接受首次写入。
  await saveStageData(
    stage.id,
    {
      stage,
      scenes,
      currentSceneId,
      chats: [],
    },
    0,
  );

  onProgress?.('done');
  return { stageId: stage.id, sceneCount: scenes.length };
}

/**
 * 检查某个预置包是否已经导入过。
 *
 * 重复导入会产生重复课堂，界面上据此提示"已导入"。
 */
export async function isPresetImported(preset: PresetClassroom): Promise<boolean> {
  const { listStages } = await import('@/lib/utils/stage-storage');
  const stages = await listStages();
  return stages.some((stage) => stage.name.startsWith(preset.title));
}
