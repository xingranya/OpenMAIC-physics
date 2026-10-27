/**
 * 四阶能力梯度发展量化评价表。
 *
 * 这张表是把课题申请书里「一核」（四阶能力梯度发展）落到**可评分**的一步：
 * 每个能力维度给出三项量化指标与维度内权重、AI 在每个环节做什么、
 * 三个水平层级的行为描述、以及评价证据从哪来、什么时候采。
 *
 * ## 与 `lib/school/rubric.ts` 的分工
 *
 * 那个文件是**评分分段的行为锚点**（「扎实 / 基本掌握 / 有缺口 / 需重建」），
 * 用在教师复核对话框里解释「这个 82 分意味着什么」。本文件是**量化评价表**
 * 本身（指标、权重、AI 功能、证据、采集时点），用在与文档对齐的那张表上。
 * 两者用途不同，所以没有合并：合并会让复核对话框被迫加载一整张表，
 * 也会让这张表的权重改动牵动评分锚点的语义。
 *
 * ## 为什么权重必须写死在代码里
 *
 * 过程性评价要能被质疑、被重算。指标权重一旦只存在于某份 Word 文档里，
 * 系统算出来的分就和文档对不上；教师复核时问一句「这个 40% 是哪来的」，
 * 答不上来就说明这套评价还不能用。所以权重、层级边界、证据清单全部在这里，
 * 界面与文档都从这一份数据渲染。
 *
 * ## 层级边界为什么是 60 / 75 / 90
 *
 * 与申请书一致：基础水平 60≤S<75、进阶水平 75≤S<90、高阶水平 90≤S≤100。
 * 低于 60 单独作为「未达标」——它是**需要干预**的状态，不是第四层，
 * 混进层级里会让「分层」变成「分等」。
 */

import type { AbilityTier, FourAbility } from './types';

/** 一个量化指标与它在维度内的权重（0–1）。 */
export interface RubricIndicator {
  label: string;
  weight: number;
}

/**
 * AI 功能的标签，对应「五环」+ 核验。
 *
 * 申请书里五环是诊—配—导—创—评；核验是这套评价能不能站住的前提，
 * 所以单独列一个标签，而不是塞进「评」里。
 */
export type RubricAiTag = '诊' | '配' | '导' | '创' | '评' | '核验';

export interface RubricAiFunction {
  tag: RubricAiTag;
  text: string;
}

/** 一行评价表。 */
export interface RubricRow {
  ability: FourAbility;
  /** 能力维度展示名。 */
  label: string;
  /** 成绩登记总表里用的列名（与量化评价表的维度名不完全一致，见文件末注释）。 */
  sheetLabel: string;
  indicators: readonly RubricIndicator[];
  aiFunctions: readonly RubricAiFunction[];
  /** 三个水平层级的行为描述。 */
  levels: Readonly<Record<AbilityTier, string>>;
  /** 评价证据。 */
  evidence: readonly string[];
  /** 采集时点。 */
  collectAt: string;
}

/** 层级展示名（与 `stages.ts` 的 TIER_LABELS 同一套语义）。 */
export const LEVEL_LABELS: Readonly<Record<AbilityTier, string>> = {
  basic: '基础水平',
  applied: '进阶水平',
  challenge: '高阶水平',
};

/** 层级分数区间（闭开区间写法，便于界面直接显示）。 */
export const LEVEL_BANDS: Readonly<Record<AbilityTier, { min: number; max: number; text: string }>> =
  {
    basic: { min: 60, max: 74, text: '60 ≤ S < 75' },
    applied: { min: 75, max: 89, text: '75 ≤ S < 90' },
    challenge: { min: 90, max: 100, text: '90 ≤ S ≤ 100' },
  };

/** 未达标线：低于这个分数不属于任何一层，需要单独干预。 */
export const BELOW_BASIC_LINE = 60;

/**
 * 分数落在哪一层。
 *
 * 返回 `null` 表示未达标。刻意不用「基础水平以下」这种说法：
 * 60 分以下不是「第四层」，是**还没进入层级**。
 */
export function levelOf(score: number): AbilityTier | null {
  if (!Number.isFinite(score) || score < BELOW_BASIC_LINE) return null;
  if (score >= 90) return 'challenge';
  if (score >= 75) return 'applied';
  return 'basic';
}

/** 层级文案；未达标时给出明确提示。 */
export function levelLabelOf(score: number): string {
  const level = levelOf(score);
  return level ? LEVEL_LABELS[level] : '未达标（需重点干预）';
}

/** 四阶能力的量化评价表。顺序与申请书、成绩表一致：知识 → 专业 → 创新 → 团队。 */
export const RUBRIC_ROWS: readonly RubricRow[] = [
  {
    ability: 'knowledge',
    label: '知识能力',
    sheetLabel: '知识理解与应用',
    indicators: [
      { label: '概念诊断正确率', weight: 0.4 },
      { label: '原理阐释评分', weight: 0.3 },
      { label: '情境计算得分率', weight: 0.3 },
    ],
    aiFunctions: [
      { tag: '诊', text: '分析前测与问答，标记概念误区' },
      { tag: '配', text: '推荐分层练习' },
      { tag: '导', text: '生成递进追问' },
      { tag: '评', text: '输出知识掌握图' },
      { tag: '核验', text: '诊断一致率' },
    ],
    levels: {
      basic: '识别基本概念，在提示下解释主要物理关系，完成基础计算。',
      applied: '独立解释物理规律，正确选择公式，解决变式情境问题。',
      challenge: '辨析易错概念，说明模型适用条件，综合运用知识解释复杂问题。',
    },
    evidence: ['前后测卷答', 'AI 问答与诊断记录', '教师复核表'],
    collectAt: '每个知识模块前后各测 1 次。',
  },
  {
    ability: 'application',
    label: '专业能力',
    sheetLabel: '专业实践能力',
    indicators: [
      { label: '物理建模评分', weight: 0.3 },
      { label: '实验实施评分', weight: 0.4 },
      { label: '数据分析与迁移评分', weight: 0.3 },
    ],
    aiFunctions: [
      { tag: '配', text: '按专业与基础推荐项目' },
      { tag: '导', text: '提示建模约束、实验步骤和异常数据' },
      { tag: '评', text: '生成数据分析建议' },
      { tag: '核验', text: '任务匹配适切率' },
    ],
    levels: {
      basic: '依据模板建立简单模型，在指导下完成实验操作及基础数据整理。',
      applied: '独立完成建模、实验设计与数据分析，将物理知识用于本专业任务。',
      challenge: '处理复杂约束，分析误差与模型局限，将方法迁移至新情境并验证。',
    },
    evidence: ['项目推荐与调整记录', '模型说明', '实验报告'],
    collectAt: '项目中期与结项各评 1 次。',
  },
  {
    ability: 'innovation',
    label: '创新能力',
    sheetLabel: '创新思维能力',
    indicators: [
      { label: '问题与方案新颖性评分', weight: 0.3 },
      { label: '方案可行性评分', weight: 0.3 },
      { label: '验证与迭代评分', weight: 0.4 },
    ],
    aiFunctions: [
      { tag: '创', text: '辅助检索、比较备选方案，追踪作品修改' },
      { tag: '评', text: '按量表提示方案优缺点，生成迭代建议' },
      { tag: '核验', text: '反馈改进完成率' },
    ],
    levels: {
      basic: '提出至少 1 项有依据的改进建议，说明实现条件并开展初步验证。',
      applied: '比较至少 2 种可行思路，完成至少 1 轮有数据支撑的验证改进。',
      challenge: '形成原创或实质改进方案，完成至少 2 轮验证迭代，用对照数据说明成效与局限。',
    },
    evidence: ['AI 建议及采纳说明', '方案比较表', '作品版本和测试数据'],
    collectAt: '立项至结项持续记录。',
  },
  {
    ability: 'collaboration',
    label: '团队合作能力',
    sheetLabel: '团队协作能力',
    indicators: [
      { label: '个人任务履约率', weight: 0.4 },
      { label: '协同解决问题评分', weight: 0.3 },
      { label: '个人贡献评价', weight: 0.3 },
    ],
    aiFunctions: [
      { tag: '导', text: '汇总分工与进度，提示延期及协作问题' },
      { tag: '评', text: '关联任务、作品版本和互评，输出个人贡献证据摘要' },
      { tag: '核验', text: '贡献证据可追溯率' },
    ],
    levels: {
      basic: '完成基础分工，参与讨论，保留可核验的个人工作记录。',
      applied: '按约完成关键任务，主动共享信息，协助解决至少 1 项合作问题。',
      challenge: '履约并主动协调进度与分歧，支持成员完成困难任务，形成可追溯的协作成果。',
    },
    evidence: ['分工表', '任务日志', '作品版本', '匿名互评及 AI 证据摘要'],
    collectAt: '任务逐次记录，中期与结项评价。',
  },
];

/** 按能力取一行。 */
export function rubricRowFor(ability: FourAbility): RubricRow | undefined {
  return RUBRIC_ROWS.find((row) => row.ability === ability);
}

/**
 * 维度内权重之和。
 *
 * 这是给测试用的**自检**：权重和必须是 1，否则「维度得分」会系统性偏高或偏低。
 * 表格是手写数据，最容易出的错就是某一项权重写错一位小数。
 */
export function indicatorWeightSum(row: RubricRow): number {
  return row.indicators.reduce((sum, item) => sum + item.weight, 0);
}

/**
 * 按维度内权重把三项指标合成一个维度分。
 *
 * 缺项的指标**不按 0 计**，而是把它的权重去掉后重新归一化——
 * 「还没采到证据」和「该项得 0 分」是两件事，前者不该把学生拖下去。
 * 一个都没采到时返回 `null`，让调用方去决定怎么显示，而不是悄悄给 0。
 */
export function dimensionScore(
  row: RubricRow,
  values: Readonly<Record<string, number | undefined>>,
): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const indicator of row.indicators) {
    const value = values[indicator.label];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    weighted += Math.max(0, Math.min(100, value)) * indicator.weight;
    totalWeight += indicator.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weighted / totalWeight) * 10) / 10;
}
