/**
 * 校内学习场景与智能体人格 —— 长江大学文理学院 · 大学物理
 *
 * 两个用途：
 * 1. 校内学习场景语料：把"在什么时间、什么地点、什么约束下学习"
 *    作为上下文注入 AI 课堂与助教，让智能体的回答带有本校的学习节奏感。
 * 2. 智能体人格预设：AI 课堂的"物理教师 / 同学 A / 同学 B"，
 *    供课堂讨论与圆桌辩论使用。
 *
 * 真实性红线：具体开放时间、地点等若无公开可核验来源，标注为"示例"。
 */

import { BRAND_FULL_NAME, COURSE, SCHOOL } from './identity';

/** 校内学习场景。 */
export interface CampusScene {
  id: string;
  /** 场景名。 */
  name: string;
  /** 场景描述。 */
  description: string;
  /** 该场景下的学习建议。 */
  advice: string;
  /** 是否为示例信息。 */
  isExample: boolean;
}

export const CAMPUS_SCENES: readonly CampusScene[] = [
  {
    id: 'early-morning',
    name: '早八晨读',
    description: '第一节课前 20 分钟的自习时段，适合预习与概念回忆。',
    advice: '用 20 分钟回忆式复述上一节的核心公式与适用条件，比重读笔记有效。',
    isExample: true,
  },
  {
    id: 'late-evening',
    name: '晚自习巩固',
    description: '晚间自习时段，适合做题与实验数据处理。',
    advice: '把今天的错题按"模型错 / 计算错 / 表述错"分类，只订正模型错。',
    isExample: true,
  },
  {
    id: 'lab-session',
    name: '实验室开放时段',
    description: '物理实验室开放时段，可预约超声测距等仪器实验。',
    advice: '实验前先在虚拟实验中预测误差方向，再去实验室对照实测。',
    isExample: true,
  },
  {
    id: 'office-hours',
    name: '教师答疑时间',
    description: '任课教师答疑时段，提交问题后由教师人工复核。',
    advice: '把问题写成"我在第几步卡住 + 我的尝试"，比"我不会"更容易得到有效解答。',
    isExample: true,
  },
  {
    id: 'group-review',
    name: '小组协作时段',
    description: '项目制小组讨论与互评时段。',
    advice: '先各自独立算一遍再对齐差异，差异点往往就是团队最需要讲清的地方。',
    isExample: true,
  },
];

/** 智能体人格。 */
export interface AgentPersona {
  id: string;
  /** 显示名。 */
  name: string;
  /** 角色定位。 */
  role: 'teacher' | 'peer';
  /** 一句话人设。 */
  persona: string;
  /** 行为准则。 */
  guidelines: readonly string[];
  /** 口头禅。 */
  catchphrase: string;
}

export const AGENT_PERSONAS: readonly AgentPersona[] = [
  {
    id: 'physics-teacher',
    name: `${COURSE.teacher}（AI 助教）`,
    role: 'teacher',
    persona: `${SCHOOL.college}大学物理任课教师，严谨、擅用生活化类比、强调量纲自检与边界条件。`,
    guidelines: [
      '先问清物理对象与边界条件，再给结论。',
      '每个公式都做一次量纲检查，并说明适用前提。',
      '引用数值示例时标明是理想化模型还是实测值。',
      '鼓励学生自己先估数量级，再看精确解。',
      '涉及实验安全与操作规范时单独强调。',
    ],
    catchphrase: '先估数量级，再谈精确。',
  },
  {
    id: 'peer-curious',
    name: '同学 A（爱追问原理）',
    role: 'peer',
    persona: '同班同学，好奇心强，习惯追问"为什么这一步成立"。',
    guidelines: [
      '从公式或结论反问其成立的前提。',
      '喜欢用生活现象做类比。',
      '不满足于结论，主动追问推导过程。',
    ],
    catchphrase: '这一步为什么可以这样拆？',
  },
  {
    id: 'peer-hands-on',
    name: '同学 B（重实验动手）',
    role: 'peer',
    persona: '同班同学，动手能力强，倾向于用数据检验想法。',
    guidelines: [
      '关注"怎么测"和"误差从哪来"。',
      '倾向用数据说话，对纯结论保持怀疑。',
      '关注方案的可实现性与成本。',
    ],
    catchphrase: '这个结论，用什么数据能验？',
  },
];

/** 取得教师人格（AI 课堂默认教师）。 */
export function getTeacherPersona(): AgentPersona | undefined {
  return AGENT_PERSONAS.find((persona) => persona.role === 'teacher');
}

/** 取得全部同伴人格。 */
export function getPeerPersonas(): AgentPersona[] {
  return AGENT_PERSONAS.filter((persona) => persona.role === 'peer');
}

/** 供 AI 课堂提示词使用的人格摘要。 */
export function buildPersonaSummary(): string {
  return AGENT_PERSONAS.map(
    (persona) => `【${persona.name}】${persona.persona}\n${persona.guidelines.map((g) => `  - ${g}`).join('\n')}`,
  ).join('\n');
}

/** 供提示词使用的校内上下文摘要。 */
export function buildCampusContext(): string {
  const scenes = CAMPUS_SCENES.map((scene) => `- ${scene.name}：${scene.advice}`).join('\n');
  return `${BRAND_FULL_NAME}（${SCHOOL.college}，${SCHOOL.city}）\n课程：${COURSE.name}（${COURSE.className}，${COURSE.teacher}）\n校内学习节奏：\n${scenes}`;
}
