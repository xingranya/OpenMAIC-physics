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

export type {
  PresetClassroom,
  PresetScene,
  PresetQuiz,
  PresetDiscussion,
  PresetPbl,
} from './types';
