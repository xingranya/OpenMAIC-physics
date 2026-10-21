/**
 * 预置课堂包 —— 统一出口。
 */

export {
  PRESET_CLASSROOMS,
  getPresetByChapter,
  getPresetById,
} from './recipes';

export { buildPresetClassroom, PRESET_FONT_STACK } from './build-classroom';

export { buildUltrasonicLabHtml } from './ultrasonic-lab';

export { importPresetClassroom, isPresetImported } from './import-preset';

export { buildSceneActions, WHITEBOARD_SIZE } from './actions';
export type { ActionBuildContext, WhiteboardStep } from './actions';

export { buildPblProject } from './pbl';

export type {
  PresetClassroom,
  PresetScene,
  PresetQuiz,
  PresetDiscussion,
  PresetPbl,
  PresetWhiteboardStep,
} from './types';
