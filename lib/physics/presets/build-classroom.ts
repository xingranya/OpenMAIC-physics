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

import type { PPTElement, Scene, Slide, Stage } from '@openmaic/dsl';

import { BRAND_TOKENS, COURSE, FONT_STACK, SCHOOL, SCHOOL_SLIDE_THEMES } from '@/lib/school';
import { AGENT_PERSONAS } from '@/lib/school';
import { buildSceneActions } from './actions';
import { buildPblProject } from './pbl';
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

/** 去掉句尾已有的句号，避免拼进旁白后出现「。。」。 */
function trimTrailingPeriod(text: string): string {
  return text.replace(/[。.！!？?]+$/, '');
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
    textElement(`${slideId}-brand`, `${SCHOOL.college} · ${COURSE.name}`, {
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
  const coverNarration = `${preset.subtitle}。本节课的目标是：${preset.objectives.join('；')}。`;
  const coverSlide = buildSlide(
    stageId,
    {
      title: preset.title,
      bullets: preset.objectives,
      narration: coverNarration,
    },
    0,
    theme,
  );
  const coverSceneId = makeId('scene', preset.id);
  scenes.push({
    id: coverSceneId,
    stageId,
    title: '课程封面',
    order: 0,
    type: 'slide',
    content: { type: 'slide', canvas: coverSlide },
    actions: buildSceneActions({ sceneId: coverSceneId, narration: coverNarration }),
    whiteboards: [],
  } as unknown as Scene);

  // 讲授场景：带旁白、白板演算与讨论动作
  preset.scenes.forEach((scene, index) => {
    const slide = buildSlide(stageId, scene, index + 1, theme);
    const sceneId = makeId('scene', preset.id);
    // 讨论引导语挂到该章节的最后一个讲授场景，避免同一场景里连续两次讨论。
    const isLastLecture = index === preset.scenes.length - 1;
    const discussion = isLastLecture ? preset.discussion[0] : undefined;
    const actions = buildSceneActions({
      sceneId,
      narration: scene.narration,
      whiteboard: scene.whiteboard,
      discussionPrompt: discussion?.prompt,
      discussionAgentId: discussion?.agentId,
    });

    scenes.push({
      id: sceneId,
      stageId,
      title: scene.title,
      order: scenes.length,
      type: 'slide',
      content: { type: 'slide', canvas: slide },
      actions,
      whiteboards: [],
      ...(discussion
        ? {
            multiAgent: {
              enabled: true,
              agentIds: [discussion.agentId, 'physics-teacher'],
              directorPrompt:
                '请围绕本场景的物理问题组织讨论：先让指定同学给出直觉判断，' +
                '再由物理教师追问其成立条件，最后收束到可复核的结论。',
            },
          }
        : {}),
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

  // PBL 项目场景：结构与真实生成的课堂完全一致（roleplay + 里程碑 + 情境角色）
  if (preset.pbl) {
    const sceneId = makeId('scene', preset.id);
    const project = buildPblProject(preset.id, preset.pbl, {
      now: new Date(now).toISOString(),
      characters: preset.discussion.map((discussion) => ({
        id: discussion.agentId,
        name: discussion.agentId === 'physics-teacher' ? '物理教师' : '同学',
        // 课堂播放器的 PBL 可运行性校验要求至少一个 instructor 角色。
        roleType:
          discussion.agentId === 'physics-teacher'
            ? ('instructor' as const)
            : ('collaborator' as const),
        persona:
          discussion.agentId === 'physics-teacher'
            ? '你是本节课的物理教师，严谨、强调量纲自检与模型边界条件。'
            : '你是同班同学，关注"为什么这一步成立"与"怎么用数据验证"。',
        situation: discussion.prompt,
      })),
    });

    scenes.push({
      id: sceneId,
      stageId,
      title: `项目任务 · ${preset.pbl.title}`,
      order: scenes.length,
      type: 'pbl',
      content: { type: 'pbl', projectV2: project },
      actions: buildSceneActions({
        sceneId,
        narration: `本项目的角色是${preset.pbl.role}。目标是${trimTrailingPeriod(preset.pbl.goal)}`,
      }),
    } as unknown as Scene);
  }

  const stage: Stage = {
    id: stageId,
    name: `${preset.title} · ${preset.subtitle}`,
    description: `${SCHOOL.college}《${COURSE.name}》预置课堂包。目标：${preset.objectives.join('；')}。`,
    createdAt: now,
    updatedAt: now,
    languageDirective: '全程使用简体中文讲授，物理量使用规范符号，每个公式给出量纲检查。',
    style: '学术讲授风格，浅色天蓝主题，课件页脚标注学校与课程。',
    // 课堂级智能体名册：用本校的三个人格替换通用智能体，
    // 使讨论与圆桌里的发言者是"我们学校"的老师与同学。
    generatedAgentConfigs: buildSchoolAgentRoster(preset),
  };

  return { stage, scenes, currentSceneId: scenes[0]?.id ?? '' };
}

/**
 * 由剧本构造课堂级智能体名册。
 *
 * 上游的 `stage.generatedAgentConfigs` 正是"这个课堂用哪几位智能体"的落点：
 * 生成管线会把选中的智能体写在这里，课堂加载时按它覆盖注册表。
 * 预置包用同一机制把本校人格装进课堂，因此讨论、圆桌与点名回答
 * 用的都是本校教师与同学，而不是上游的通用角色。
 */
function buildSchoolAgentRoster(preset: PresetClassroom) {
  const teacher = AGENT_PERSONAS.find((persona) => persona.id === 'physics-teacher');
  const peers = AGENT_PERSONAS.filter((persona) => persona.role === 'peer');

  const roster = [
    {
      id: 'physics-teacher',
      name: teacher?.name ?? '物理教师',
      role: 'teacher',
      persona: teacher?.persona ?? '',
      avatar: '/brand/college-brand.png',
      color: BRAND_TOKENS.primary,
      priority: 10,
    },
    ...peers.map((peer, index) => ({
      id: peer.id,
      name: peer.name,
      role: 'student',
      persona: peer.persona,
      avatar: '/brand/college-brand.png',
      color:
        SCHOOL_SLIDE_THEMES[0].colors[index % SCHOOL_SLIDE_THEMES[0].colors.length] ?? '#1c7c59',
      priority: 7 - index,
    })),
  ];

  // 只保留剧本实际用到的智能体，避免名册里出现闲人。
  const used = new Set(preset.discussion.map((discussion) => discussion.agentId));
  used.add('physics-teacher');
  return roster.filter((agent) => used.has(agent.id));
}

/** 预置包可直接用于 PPTX 导出的字体说明。 */
export const PRESET_FONT_STACK = FONT_STACK;
