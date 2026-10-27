/**
 * 「三诊」引擎：课前分层配对、课中贡献度、课后过程性评价与四阶能力轨迹。
 *
 * ## 为什么这些逻辑要独立成一层
 *
 * 申请书里三个环节的结论都要**可复核**：教师看到「该生属于应用提升型、
 * 推荐案例 A/B/C」，必须能问出「凭什么」。所以分层与配对的每一步都写成
 * 纯函数、不读时间不读随机数（时间与随机种子由调用方传入），
 * 单元测试可以逐条钉住判定边界。
 *
 * ## 为什么能力分是加权公式而不是模型打分
 *
 * 「从结果评分向过程性评价转换」是这份课题的核心主张。过程性评价要能被
 * 质疑、被重算，就必须把**权重写在代码里**、把**原始贡献值单独存下来**。
 * 黑箱打分恰恰是过程性评价的反面。
 */

import type {
  AbilityPoint,
  AbilityTier,
  AppState,
  DiagnosticDimension,
  DiagnosisResult,
  FourAbility,
  InClassExchange,
  PostClassRecord,
  PreClassPlan,
  Project,
  ProjectLevel,
  ProjectMatch,
  StudentProfile,
} from './types';
import { matchProjects, taskProgressPercentage } from './engine';

/** 三层的展示名。 */
export const TIER_LABELS: Readonly<Record<AbilityTier, string>> = {
  basic: '基础巩固型',
  applied: '应用提升型',
  challenge: '创新挑战型',
};

/** 三层各自对应梯度案例库的哪一档。 */
export const TIER_PROJECT_LEVEL: Readonly<Record<AbilityTier, ProjectLevel>> = {
  basic: '基础',
  applied: '中等',
  challenge: '较高',
};

/** 三层的判定说明，界面上要显示「为什么是这一层」。 */
export const TIER_RULES: Readonly<Record<AbilityTier, string>> = {
  basic: '诊断总分低于 70，或三个以上知识维度低于 60：先把核心概念与基本计算补稳。',
  applied: '诊断总分 70–84，薄弱维度不超过两个：已具备知识基础，进入迁移应用。',
  challenge: '诊断总分 85 以上且薄弱维度不超过两个：可直接进入创新挑战任务。',
};

/** 四阶能力的展示名。 */
export const ABILITY_LABELS: Readonly<Record<FourAbility, string>> = {
  knowledge: '知识能力',
  application: '专业能力',
  innovation: '创新能力',
  collaboration: '团队合作',
};

/** 四阶能力的简短说明（用在图表图例与报告里）。 */
export const ABILITY_HINTS: Readonly<Record<FourAbility, string>> = {
  knowledge: '概念理解与基本计算，主要看课前诊断与课中问答',
  application: '知识迁移与实验实施，主要看实验记录与任务完成度',
  innovation: '方案设计与改进，主要看任务完成质量与方案完整度',
  collaboration: '小组分工与贡献，主要看课中参与与组内承担',
};

const FOUR_ABILITIES: readonly FourAbility[] = [
  'knowledge',
  'application',
  'innovation',
  'collaboration',
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 取某个诊断的维度分数（兼容 `dims` 别名）。 */
function dimensionScoresOf(diagnosis: DiagnosisResult): Record<DiagnosticDimension, number> {
  return (diagnosis.dimensions ?? diagnosis.dims) as Record<DiagnosticDimension, number>;
}

/** 薄弱维度：低于 60 的按分数升序取前 N 个；一个都没有时取最低的那个。 */
export function weakDimensionsOf(
  diagnosis: DiagnosisResult,
  limit = 2,
): DiagnosticDimension[] {
  const entries = Object.entries(dimensionScoresOf(diagnosis)) as [DiagnosticDimension, number][];
  const sorted = [...entries].sort((left, right) => left[1] - right[1]);
  const weak = sorted.filter(([, value]) => value < 60);
  return (weak.length > 0 ? weak : sorted).slice(0, limit).map(([dimension]) => dimension);
}

/**
 * 学情分层。
 *
 * 除了总分，还看**薄弱维度的个数**：一个总分 88 但三个维度都在 55 左右的
 * 学生，直接丢进创新挑战任务大概率做不动。所以薄弱的维度多了要降一档。
 */
export function tierFromDiagnosis(diagnosis: DiagnosisResult | undefined): AbilityTier {
  if (!diagnosis) return 'basic';
  const scores = Object.values(dimensionScoresOf(diagnosis));
  const weakCount = scores.filter((value) => value < 60).length;
  let tier: AbilityTier = diagnosis.score >= 85 ? 'challenge' : diagnosis.score >= 70 ? 'applied' : 'basic';
  if (weakCount >= 3) {
    tier = tier === 'challenge' ? 'applied' : 'basic';
  }
  return tier;
}

/** 分层理由（给界面用，避免只显示一个标签）。 */
export function tierReason(diagnosis: DiagnosisResult | undefined): string {
  if (!diagnosis) return '尚未完成学情诊断，暂按基础巩固型准备。';
  const scores = Object.values(dimensionScoresOf(diagnosis));
  const weakCount = scores.filter((value) => value < 60).length;
  return `诊断总分 ${diagnosis.score}，薄弱维度 ${weakCount} 个。${TIER_RULES[tierFromDiagnosis(diagnosis)]}`;
}

/**
 * 按分层从梯度案例库配对。
 *
 * 先用通用匹配（薄弱维度 / 学习方式 / 能力目标）排序，再**只保留与当前层级
 * 同档的案例**。若同档案例不足 3 个，用相邻档补齐——宁可给一个略高或略低的
 * 案例，也不要让学生看不到任何可做的事。
 */
export function recommendProjects(input: {
  tier: AbilityTier;
  diagnosis?: DiagnosisResult;
  student?: StudentProfile;
  projects: readonly Project[];
  limit?: number;
}): ProjectMatch[] {
  const { tier, diagnosis, student, projects, limit = 3 } = input;
  const ranked = matchProjects(diagnosis, student, projects);
  const targetLevel = TIER_PROJECT_LEVEL[tier];
  const sameLevel = ranked.filter((item) => item.project.level === targetLevel);
  const others = ranked.filter((item) => item.project.level !== targetLevel);

  const picked = [...sameLevel, ...others].slice(0, limit);
  return picked.map((item) => ({
    ...item,
    reasons: [
      item.project.level === targetLevel
        ? `与「${TIER_LABELS[tier]}」对应的${targetLevel}层案例一致`
        : `同层案例不足，补充${item.project.level}层案例`,
      ...item.reasons,
    ],
  }));
}

/** 稳定哈希：同一个学生每次看到的分组必须一致，所以不能用 Math.random。 */
function stableHash(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** 各层的小组分工模板。 */
const GROUP_ROLES: Readonly<Record<AbilityTier, readonly string[]>> = {
  basic: ['概念梳理与记录', '实验操作与数据采集', '结果校核与汇报'],
  applied: ['建模与推导', '实验设计与实施', '数据分析与可视化', '成果整合与汇报'],
  challenge: ['方案创新与可行性论证', '关键技术攻关', '实验验证与迭代', '成果凝练与答辩'],
};

const TIER_GROUP_LETTER: Readonly<Record<AbilityTier, string>> = {
  basic: 'A',
  applied: 'B',
  challenge: 'C',
};

/** 分组与组内分工（由学生 id 稳定推导，刷新不变）。 */
export function assignGroup(
  tier: AbilityTier,
  seed: string,
): { groupId: string; groupRole: string } {
  const hash = stableHash(`${tier}:${seed}`);
  const roles = GROUP_ROLES[tier];
  return {
    groupId: `${TIER_GROUP_LETTER[tier]}${(hash % 4) + 1} 组`,
    groupRole: roles[hash % roles.length]!,
  };
}

/** 生成课前方案。 */
export function buildPreClassPlan(input: {
  diagnosis?: DiagnosisResult;
  student?: StudentProfile;
  projects: readonly Project[];
  seed: string;
  now?: number;
}): PreClassPlan {
  const { diagnosis, student, projects, seed, now = Date.now() } = input;
  const tier = tierFromDiagnosis(diagnosis);
  const { groupId, groupRole } = assignGroup(tier, seed);
  const scores = diagnosis ? dimensionScoresOf(diagnosis) : ({} as Record<DiagnosticDimension, number>);

  return {
    tier,
    dimensionScores: scores,
    weakDimensions: diagnosis ? weakDimensionsOf(diagnosis) : [],
    matches: recommendProjects({ tier, diagnosis, student, projects }),
    groupId,
    groupRole,
    submittedAt: new Date(now).toISOString(),
    review: { status: 'pending' },
  };
}

/**
 * 课中参与度：0–100。
 *
 * 只看**真实发生过的问答**：一轮都没有就是 0，不拿诊断分去顶替——
 * 那样「课中参与」这一项永远不为零，也就永远发现不了「这个学生一节课没说话」。
 */
export function inClassScore(exchanges: readonly InClassExchange[]): number {
  if (exchanges.length === 0) return 0;
  const weight: Record<InClassExchange['errorKind'], number> = {
    correct: 100,
    unit: 70,
    model: 55,
    incomplete: 50,
    concept: 30,
  };
  const total = exchanges.reduce((sum, item) => sum + weight[item.errorKind], 0);
  const accuracy = total / exchanges.length;
  // 参与轮次本身也计入：答错但愿意继续追问，比答对一次就走更有价值。
  const depth = Math.min(100, 40 + exchanges.length * 15);
  return clampScore(accuracy * 0.7 + depth * 0.3);
}

/** 实验记录折算成 0–100（与 `summarizeEvaluation` 同一口径）。 */
function labScoreOf(state: AppState): number | null {
  if (state.labRecords.length === 0) return null;
  const averageError =
    state.labRecords.reduce((sum, record) => {
      const error = typeof record.errorPercent === 'number' ? record.errorPercent : (record.error ?? 0);
      return sum + error;
    }, 0) / state.labRecords.length;
  return Math.max(60, 100 - Math.min(40, averageError * 4));
}

/**
 * 课后过程性评价。
 *
 * ## 权重是公开的
 *
 * 四阶能力各自的构成写在下面每个 `clampScore(...)` 里，教师复核时能逐项对上。
 * 缺数据的项**不伪造**：没有实验记录就用任务完成度顶，并在建议里点明
 * 「实验数据不足，专业能力按任务完成度估算」。
 */
export function buildPostClassRecord(input: {
  state: AppState;
  now?: number;
}): PostClassRecord {
  const { state, now = Date.now() } = input;
  const diagnosisScore = state.diagnosis?.score ?? 0;
  const progress = taskProgressPercentage(state.taskChecks);
  const labScore = labScoreOf(state);
  const inClass = inClassScore(state.inClass);
  const hasInClass = state.inClass.length > 0;

  const preClass = clampScore(diagnosisScore);
  const task = clampScore(progress);
  const teamworkSource = hasInClass ? inClass : clampScore(progress * 0.6);

  const knowledge = clampScore(
    preClass * 0.55 + (hasInClass ? inClass : preClass) * 0.25 + task * 0.2,
  );
  const application = clampScore(
    (labScore ?? task) * 0.45 + task * 0.35 + (hasInClass ? inClass : preClass) * 0.2,
  );
  const innovation = clampScore(task * 0.5 + (labScore ?? task) * 0.3 + preClass * 0.2);
  const collaboration = clampScore(teamworkSource * 0.65 + task * 0.35);

  const abilities: Record<FourAbility, number> = {
    knowledge,
    application,
    innovation,
    collaboration,
  };

  const previous = state.postClass;
  const label = nextEvaluationLabel(previous?.trajectory);
  const point: AbilityPoint = {
    label,
    at: new Date(now).toISOString(),
    scores: abilities,
  };
  const trajectory = [...(previous?.trajectory ?? []), point].slice(-8);

  return {
    abilities,
    contributions: { preClass, inClass: clampScore(inClass), task, teamwork: clampScore(teamworkSource) },
    advice: buildAdvice({ abilities, hasInClass, hasLab: labScore !== null, progress }),
    trajectory,
    generatedAt: new Date(now).toISOString(),
    ...(previous?.teacher ? { teacher: previous.teacher } : {}),
  };
}

/**
 * 下一次评价的序号。
 *
 * 不能直接用 `trajectory.length + 1`：轨迹只保留最近 8 条，第 9 次生成时
 * 长度仍是 8，序号会卡在「第 9 次」反复出现，界面上看起来像没生效。
 * 所以从最后一条的标签里读序号，读不出来（旧数据、手工改过）再退回长度。
 */
function nextEvaluationLabel(trajectory: readonly AbilityPoint[] | undefined): string {
  const last = trajectory?.at(-1);
  const matched = last?.label.match(/第\s*(\d+)\s*次/);
  const previous = matched ? Number(matched[1]) : (trajectory?.length ?? 0);
  return `第 ${(Number.isFinite(previous) ? previous : 0) + 1} 次评价`;
}

/** 综合分：四阶能力加权（权重与 `summarizeEvaluation` 保持一致）。 */
export function overallScore(abilities: Readonly<Record<FourAbility, number>>): number {
  return clampScore(
    abilities.knowledge * 0.25 +
      abilities.application * 0.3 +
      abilities.innovation * 0.25 +
      abilities.collaboration * 0.2,
  );
}

/** 等级文案。 */
export function gradeOf(score: number): string {
  if (score >= 90) return '卓越';
  if (score >= 80) return '良好';
  if (score >= 70) return '达标';
  if (score >= 60) return '基本达标';
  return '需重点改进';
}

/** 按最弱的两项生成改进建议（最多 3 条，避免变成一屏正确的废话）。 */
export function buildAdvice(input: {
  abilities: Readonly<Record<FourAbility, number>>;
  hasInClass: boolean;
  hasLab: boolean;
  progress: number;
}): string[] {
  const { abilities, hasInClass, hasLab, progress } = input;
  const advice: string[] = [];

  if (!hasInClass) {
    advice.push('课中还没有产生问答记录。下次课至少回答一道课中题——课中参与占团队合作的一半权重。');
  }
  if (!hasLab) {
    advice.push('实验记录为空，专业能力暂时按任务完成度估算。完成一次虚拟实验能把这一项补实。');
  }

  const ordered = FOUR_ABILITIES.map((ability) => ({ ability, value: abilities[ability] })).sort(
    (left, right) => left.value - right.value,
  );

  for (const { ability, value } of ordered) {
    if (advice.length >= 3) break;
    if (value >= 80) continue;
    advice.push(adviceFor(ability, value));
  }

  if (advice.length === 0) {
    advice.push('四项能力都在 80 以上。下一步可以挑一个创新挑战层案例，把方案做成可复现的完整成果。');
  }
  if (progress < 100 && advice.length < 3) {
    advice.push(`任务完成度 ${Math.round(progress)}%，先把当前项目的剩余检查项做完，比开新项目更划算。`);
  }
  return advice.slice(0, 3);
}

function adviceFor(ability: FourAbility, value: number): string {
  switch (ability) {
    case 'knowledge':
      return `知识能力 ${value}：回到课前诊断里得分最低的维度，把该章的概念与两道典型题重做一遍。`;
    case 'application':
      return `专业能力 ${value}：挑一个与薄弱维度对应的梯度案例，把「实验方案—数据—结论」三步写完整。`;
    case 'innovation':
      return `创新能力 ${value}：在现有方案上做一次改进（换材料、换参数或换测量方法），并说明改进前后差在哪。`;
    default:
      return `团队合作 ${value}：和组内成员确认分工是否落实，把本轮自己承担的部分写进过程记录。`;
  }
}
