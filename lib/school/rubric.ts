/**
 * 校本四阶能力评价量表 —— 长江大学文理学院 · 大学物理
 *
 * 与教师端"评价复核"面板共用：AI 只产出建议分与理由，最终分始终由教师覆盖。
 * 本量表提供每一阶的评分锚点与判定说明，使 AI 建议分有可解释的依据，
 * 也让教师复核时能快速判断建议分是否合理。
 */

import type { LearningTarget } from '@/lib/physics/types';

/** 能力阶的评分锚点。 */
export interface RubricAnchor {
  /** 该分段的语义标签。 */
  band: string;
  /** 分数下界（含）。 */
  min: number;
  /** 分数上界（含）。 */
  max: number;
  /** 判定说明。 */
  criterion: string;
}

/** 一个能力阶的完整量表。 */
export interface RubricDimension {
  /** 能力阶 key。 */
  target: LearningTarget;
  /** 能力名称。 */
  label: string;
  /** 该阶的判定问题。 */
  question: string;
  /** 主要证据来源。 */
  evidence: string;
  /** 评分锚点。 */
  anchors: readonly RubricAnchor[];
}

export const RUBRIC: readonly RubricDimension[] = [
  {
    target: 'concept',
    label: '知识理解',
    question: '能否说清物理对象、规律与适用条件？',
    evidence: '学情诊断各维度得分、任务第一关检查项',
    anchors: [
      { band: '扎实', min: 85, max: 100, criterion: '能独立复述概念并主动指出模型的适用边界。' },
      { band: '基本掌握', min: 70, max: 84, criterion: '概念理解正确，边界条件需提示才能说出。' },
      { band: '有缺口', min: 55, max: 69, criterion: '主干概念正确但存在混淆，常把相近概念混用。' },
      { band: '需重建', min: 0, max: 54, criterion: '关键概念缺失，需回到对应章节重新学习。' },
    ],
  },
  {
    target: 'application',
    label: '专业应用',
    question: '能否把规律用于具体问题并完成建模？',
    evidence: '任务第二关检查项、实验记录与误差分析',
    anchors: [
      { band: '扎实', min: 85, max: 100, criterion: '能写出可计算的模型并说明假设与变量控制。' },
      { band: '基本掌握', min: 70, max: 84, criterion: '建模路径正确，变量识别偶有遗漏。' },
      { band: '有缺口', min: 55, max: 69, criterion: '会套用公式但说不清模型为什么这样建。' },
      { band: '需重建', min: 0, max: 54, criterion: '无法把文字描述转成物理模型。' },
    ],
  },
  {
    target: 'innovation',
    label: '创新实践',
    question: '能否设计、验证并迭代一个方案？',
    evidence: '任务第三、四关检查项、实验迭代记录',
    anchors: [
      { band: '扎实', min: 85, max: 100, criterion: '方案有明确指标，且用数据证明改进确实生效。' },
      { band: '基本掌握', min: 70, max: 84, criterion: '方案可行且完成验证，迭代依据较弱。' },
      { band: '有缺口', min: 55, max: 69, criterion: '有方案但缺少验证或缺少一次真正的迭代。' },
      { band: '需重建', min: 0, max: 54, criterion: '尚停留在设想阶段，没有可检验的方案。' },
    ],
  },
  {
    target: 'collaboration',
    label: '协同创生',
    question: '能否在团队中分工、汇报与反思？',
    evidence: '任务第五关检查项、答辩记录与个人反思',
    anchors: [
      {
        band: '扎实',
        min: 85,
        max: 100,
        criterion: '贡献边界清晰，能区分个人与团队成果并提出下一轮方向。',
      },
      { band: '基本掌握', min: 70, max: 84, criterion: '完成分工与汇报，反思较笼统。' },
      { band: '有缺口', min: 55, max: 69, criterion: '参与度不足或汇报与实际工作脱节。' },
      { band: '需重建', min: 0, max: 54, criterion: '缺少团队协作记录。' },
    ],
  },
];

const TARGET_INDEX = new Map(RUBRIC.map((dimension) => [dimension.target, dimension]));

/** 按能力阶取得量表。 */
export function getRubricDimension(target: LearningTarget): RubricDimension | undefined {
  return TARGET_INDEX.get(target);
}

/** 给定分数返回该能力阶的分段标签。 */
export function describeBand(target: LearningTarget, score: number): string {
  const dimension = getRubricDimension(target);
  if (!dimension) return '';
  const anchor = dimension.anchors.find((item) => score >= item.min && score <= item.max);
  return anchor ? anchor.band : '';
}

/** 供 AI 课堂与教师面板使用的量表摘要。 */
export function buildRubricSummary(): string {
  return RUBRIC.map(
    (dimension) =>
      `【${dimension.label}】${dimension.question}（证据：${dimension.evidence}）` +
      dimension.anchors
        .map((anchor) => `${anchor.min}-${anchor.max}：${anchor.criterion}`)
        .join(' '),
  ).join('\n');
}
