/**
 * 预置课堂包 —— 课堂文档构建器。
 *
 * 纯函数：把一份「课堂剧本」翻译成 OpenMAIC 的 Stage DSL 文档
 * （Stage + Scenes），使预置包可以像真实生成的课堂一样被播放、
 * 参与讨论、导出 PPTX / 离线 HTML。
 *
 * 之所以用纯函数而不是手写 JSON：DSL 的元素坐标、主题、场景顺序
 * 都必须自洽，手写极易与结构漂移；在纯函数里集中构造并配单测，
 * 可以在上游 DSL 升级时快速发现不兼容。
 */

import type {
  PPTElement,
  Scene,
  Slide,
  Stage,
} from '@openmaic/dsl';

import { BRAND_TOKENS, FONT_STACK, SCHOOL_SLIDE_THEMES } from '@/lib/school';
import { buildUltrasonicLabHtml } from './ultrasonic-lab';
import type { PresetClassroom, PresetScene } from './types';

/** 幻灯片视口宽度（与上游生成器保持一致）。 */
const VIEWPORT_SIZE = 1000;
/** 幻灯片视口高宽比 16:9。 */
const VIEWPORT_RATIO = 0.5625;

let counter = 0;

/** 生成一个稳定且唯一的 id。 */
function makeId(prefix: string, seed: string): string {
  counter += 1;
  return `${prefix}-${seed}-${counter.toString(36)}`;
}

/** 构造一个文本元素。 */
function textElement(
  id: string,
  content: string,
  options: {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize?: number;
    color?: string;
    bold?: boolean;
    textType?: 'title' | 'subtitle' | 'content' | 'item';
    align?: 'left' | 'center';
  },
): PPTElement {
  return {
    id,
    type: 'text',
    content,
    left: options.left,
    top: options.top,
    width: options.width,
    height: options.height,
    rotate: 0,
    defaultFontName: 'PingFang SC',
    defaultColor: options.color ?? BRAND_TOKENS.primaryStrong,
    fontSize: options.fontSize ?? 18,
    bold: options.bold ?? false,
    textAlign: options.align ?? 'left',
    textType: options.textType ?? 'content',
  } as unknown as PPTElement;
}

/** 由讲授场景构造一张幻灯片。 */
function buildSlide(
  stageId: string,
  scene: PresetScene,
  index: number,
  theme: (typeof SCHOOL_SLIDE_THEMES)[number],
): Slide {
  const elements: PPTElement[] = [];
  const slideId = makeId('slide', stageId);

  elements.push(
    textElement(`${slideId}-title`, scene.title, {
      left: 70,
      top: 56,
      width: VIEWPORT_SIZE - 140,
      height: 70,
      fontSize: 34,
      bold: true,
      color: theme.fontColor,
      textType: 'title',
    }),
  );

  scene.bullets.forEach((bullet, bulletIndex) => {
    elements.push(
      textElement(`${slideId}-b${bulletIndex}`, `· ${bullet}`, {
        left: 86,
        top: 170 + bulletIndex * 66,
        width: VIEWPORT_SIZE - 180,
        height: 56,
        fontSize: 21,
        color: theme.fontColor,
        textType: 'item',
      }),
    );
  });

  if (scene.formula) {
    elements.push(
      textElement(`${slideId}-formula`, scene.formula, {
        left: 86,
        top: 400,
        width: VIEWPORT_SIZE - 180,
        height: 60,
        fontSize: 26,
        color: theme.colors[0],
        bold: true,
        textType: 'subtitle',
      }),
    );
  }

  elements.push(
    textElement(`${slideId}-brand`, '长江大学文理学院 · 大学物理', {
      left: 70,
      top: VIEWPORT_SIZE * VIEWPORT_RATIO - 46,
      width: VIEWPORT_SIZE - 140,
      height: 30,
      fontSize: 13,
      color: theme.borderColor,
    }),
  );

  return {
    id: slideId,
    viewportSize: VIEWPORT_SIZE,
    viewportRatio: VIEWPORT_RATIO,
    theme: {
      backgroundColor: theme.background,
      themeColors: [...theme.colors],
      fontColor: theme.fontColor,
      fontName: 'PingFang SC',
    },
    elements,
    script: scene.narration,
  } as unknown as Slide;
}

/** 构造课堂文档。 */
export function buildPresetClassroom(
  preset: PresetClassroom,
  now: number = Date.now(),
): { stage: Stage; scenes: Scene[]; currentSceneId: string } {
  const stageId = makeId('stage', preset.id);
  const theme = SCHOOL_SLIDE_THEMES[0];
  const scenes: Scene[] = [];

  // 封面
  const coverSlide = buildSlide(
    stageId,
    {
      title: preset.title,
      bullets: preset.objectives,
      narration: `${preset.subtitle}。本节课的目标是：${preset.objectives.join('；')}。`,
    },
    0,
    theme,
  );
  scenes.push({
    id: makeId('scene', preset.id),
    stageId,
    title: '课程封面',
    order: 0,
    type: 'slide',
    content: { type: 'slide', canvas: coverSlide },
  } as unknown as Scene);

  // 讲授场景
  preset.scenes.forEach((scene, index) => {
    const slide = buildSlide(stageId, scene, index + 1, theme);
    scenes.push({
      id: makeId('scene', preset.id),
      stageId,
      title: scene.title,
      order: scenes.length,
      type: 'slide',
      content: { type: 'slide', canvas: slide },
    } as unknown as Scene);
  });

  // 交互仿真场景（自包含 HTML，无需网络）
  if (preset.hasInteractive) {
    scenes.push({
      id: makeId('scene', preset.id),
      stageId,
      title: '虚拟仿真 · 超声波测距',
      order: scenes.length,
      type: 'interactive',
      content: { type: 'interactive', html: buildUltrasonicLabHtml() },
    } as unknown as Scene);
  }

  // 测验场景
  if (preset.quiz.length > 0) {
    scenes.push({
      id: makeId('scene', preset.id),
      stageId,
      title: '课堂测验',
      order: scenes.length,
      type: 'quiz',
      content: {
        type: 'quiz',
        questions: preset.quiz.map((question, index) => ({
          id: `${preset.id}-q${index}`,
          type: 'single' as const,
          question: question.question,
          options: question.options.map((label, optionIndex) => ({
            label,
            value: String.fromCharCode(65 + optionIndex),
          })),
          answer: [String.fromCharCode(65 + question.correctIndex)],
          analysis: question.analysis,
          hasAnswer: true,
          points: 1,
        })),
      },
    } as unknown as Scene);
  }

  // PBL 任务以讲演页承载（保持与 DSL 的 PBL 契约解耦，避免不必要的耦合）
  if (preset.pbl) {
    const slide = buildSlide(
      stageId,
      {
        title: `项目任务 · ${preset.pbl.title}`,
        bullets: [`角色：${preset.pbl.role}`, `目标：${preset.pbl.goal}`, ...preset.pbl.milestones],
        narration: `本项目的角色是${preset.pbl.role}。目标是${preset.pbl.goal}。`,
      },
      scenes.length,
      theme,
    );
    scenes.push({
      id: makeId('scene', preset.id),
      stageId,
      title: '项目任务',
      order: scenes.length,
      type: 'slide',
      content: { type: 'slide', canvas: slide },
    } as unknown as Scene);
  }

  const stage: Stage = {
    id: stageId,
    name: `${preset.title} · ${preset.subtitle}`,
    description: `长江大学文理学院《大学物理》预置课堂包。目标：${preset.objectives.join('；')}。`,
    createdAt: now,
    updatedAt: now,
    languageDirective: '全程使用简体中文讲授，物理量使用规范符号，每个公式给出量纲检查。',
    style: '学术讲授风格，浅色天蓝主题，课件页脚标注学校与课程。',
  };

  return { stage, scenes, currentSceneId: scenes[0]?.id ?? '' };
}

/** 预置包可直接用于 PPTX 导出的字体说明。 */
export const PRESET_FONT_STACK = FONT_STACK;
