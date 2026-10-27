/**
 * 四项核验指标：量化评价表里「核验」这一列的落点。
 *
 * ## 为什么这四项必须真的算出来
 *
 * 量化评价表每一行的最后一格都写着「核验：诊断一致率 / 任务匹配适切率 /
 * 反馈改进完成率 / 贡献证据可追溯率」。如果这四项只出现在表格文字里、
 * 界面上算不出来，那整张表就是**装饰**——评委只要问一句
 * 「一致率现在是多少」，就露了。
 *
 * 更要紧的是它决定了这套东西**可不可信**：AI 分层和教师判断差得多，
 * 说明分层规则要改；推荐的案例学生几乎不采纳，说明匹配算法有问题；
 * 追问之后没人改答案，说明追问没问到点上；证据覆盖率低，说明评价
 * 其实还是凭印象。四项都是**用来质疑自己的**，不是用来好看的。
 *
 * ## 口径比数值重要
 *
 * 四个指标都没有唯一正确的定义，所以每个都带 `basis`（口径说明），
 * 界面上必须原样显示。一个不写口径的「一致率 87%」在评审现场等于
 * 「随便编的 87%」。
 *
 * ## 分母为 0 时返回 null，不返回 0
 *
 * 「还没有人提交」和「提交了但一条都没对上」是两件完全不同的事。
 * 都显示成 0%，前者会被误读成「系统烂」，后者才是真问题。
 */

import type { StageSubmission } from './submissions';

/** 一个比率指标。`value` 为 null 表示**没有可统计的数据**。 */
export interface Ratio {
  /** 0–1；无数据时为 null。 */
  value: number | null;
  numerator: number;
  denominator: number;
  /** 口径说明：这个数是怎么数出来的。 */
  basis: string;
}

/** 一名学生的证据缺口（教师据此去催，而不是笼统地说「证据不足」）。 */
export interface EvidenceGap {
  studentId: string;
  studentName: string;
  missing: readonly string[];
}

export interface VerificationReport {
  /** 知识能力 · 核验：AI 分层与教师判断的一致程度。 */
  diagnosisConsistency: Ratio;
  /** 专业能力 · 核验：AI 推荐的项目与学生最终采用的项目是否吻合。 */
  matchFitness: Ratio;
  /** 创新能力 · 核验：被追问之后是否真的补答了。 */
  improvementCompletion: Ratio;
  /** 团队合作 · 核验：四类贡献证据的覆盖程度。 */
  evidenceTraceability: Ratio;
  /** 逐人缺口，按缺口多少倒序。 */
  gaps: readonly EvidenceGap[];
  /** 参与统计的提交数（分母为 0 时界面要能解释「为什么是空的」）。 */
  submissionCount: number;
}

function ratio(numerator: number, denominator: number, basis: string): Ratio {
  return {
    value: denominator > 0 ? numerator / denominator : null,
    numerator,
    denominator,
    basis,
  };
}

/**
 * 计算四项核验指标。
 *
 * 纯函数：输入是共享键里的提交快照，不读 localStorage，便于测试。
 */
export function buildVerification(
  submissions: readonly StageSubmission[],
): VerificationReport {
  const usable = submissions.filter((item) => item && item.studentId);

  // ── 1. 诊断一致率 ──
  // 只统计**教师已处理**的课前方案：教师点「通过」视为与 AI 一致，
  // 点「调整并说明」视为不一致。pending 不进分母——没审的不能算不一致。
  let reviewed = 0;
  let agreed = 0;
  usable.forEach((item) => {
    const review = item.preClass?.review;
    if (!review || review.status === 'pending') return;
    reviewed += 1;
    if (review.status === 'approved') agreed += 1;
  });

  // ── 2. 任务匹配适切率 ──
  // 分母：既有课前配对、又有「最终采用了哪个项目」的学生。
  // 分子：最终采用的项目出现在 AI 推荐前 3 里的次数。
  //
  // 学生改用别的项目不一定是错——可能是兴趣变了。所以这个指标看的是
  // **趋势**：长期偏低说明推荐确实不贴人，而不是某个人不听话。
  let matched = 0;
  let adopted = 0;
  usable.forEach((item) => {
    const adoptedId = item.evidence?.adoptedProjectId;
    const matches = item.preClass?.matches ?? [];
    if (!adoptedId || matches.length === 0) return;
    adopted += 1;
    if (matches.some((match) => match.project.id === adoptedId)) matched += 1;
  });

  // ── 3. 反馈改进完成率 ──
  // 按「题」统计而不是按「轮」：同一道题被追问三次只算一次机会，
  // 否则一个反复试错的学生会把分母刷大，把比率拉低。
  let questioned = 0;
  let improved = 0;
  usable.forEach((item) => {
    const byQuestion = new Map<string, typeof item.inClass>();
    item.inClass.forEach((exchange) => {
      const list = byQuestion.get(exchange.questionId);
      if (list) list.push(exchange);
      else byQuestion.set(exchange.questionId, [exchange]);
    });
    byQuestion.forEach((list) => {
      const needsImprovement = list.some((exchange) => exchange.errorKind !== 'correct');
      if (!needsImprovement) return;
      questioned += 1;
      // 同一道题出现两条以上记录 = 学生看过追问后又答了一次。
      if (list.length >= 2) improved += 1;
    });
  });

  // ── 4. 贡献证据可追溯率 ──
  // 四类证据各算一格：分工、任务日志、作品版本、互评。
  // 分母是「学生数 × 4」，所以这个数同时反映覆盖面与完整度。
  let evidenceSlots = 0;
  let evidenceFilled = 0;
  const gaps: EvidenceGap[] = [];
  usable.forEach((item) => {
    const missing: string[] = [];
    const hasRole = item.evidence?.hasRole ?? Boolean(item.preClass?.groupRole);
    const hasTasks = (item.evidence?.taskCompleted ?? 0) > 0;
    const hasVersions = (item.evidence?.versionCount ?? 0) > 0;
    const hasPeer = (item.evidence?.peerReviewCount ?? 0) > 0;
    if (!hasRole) missing.push('组内分工');
    if (!hasTasks) missing.push('任务日志');
    if (!hasVersions) missing.push('作品版本');
    if (!hasPeer) missing.push('组内互评');
    evidenceSlots += 4;
    evidenceFilled += 4 - missing.length;
    if (missing.length > 0) {
      gaps.push({ studentId: item.studentId, studentName: item.studentName, missing });
    }
  });

  return {
    diagnosisConsistency: ratio(
      agreed,
      reviewed,
      '分母为教师已处理的课前方案数；「通过」计一致，「调整并说明」计不一致，未审核不计入。',
    ),
    matchFitness: ratio(
      matched,
      adopted,
      '分母为既完成课前配对、又记录了最终采用项目的学生数；采用项目落在 AI 推荐前 3 内计为适切。',
    ),
    improvementCompletion: ratio(
      improved,
      questioned,
      '分母为「出现过非正确判定」的题目数；同一题出现两条以上记录（看过追问后重答）计为已改进。',
    ),
    evidenceTraceability: ratio(
      evidenceFilled,
      evidenceSlots,
      '每名学生计四格证据（分工 / 任务日志 / 作品版本 / 组内互评），分母为人数 × 4。',
    ),
    gaps: gaps.sort((left, right) => right.missing.length - left.missing.length),
    submissionCount: usable.length,
  };
}

/** 比率转百分数文本；无数据时给「—」而不是「0%」。 */
export function ratioText(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * 给一项指标一句人话判断。
 *
 * 阈值不是「合格线」，是**该不该去看一眼**的提示：四项都用来质疑自己，
 * 所以宁可早提示，也不要等到评审现场才发现。
 */
export function ratioVerdict(key: keyof Omit<VerificationReport, 'gaps' | 'submissionCount'>, value: number | null): string {
  if (value === null) return '还没有可统计的数据';
  const percent = value * 100;
  if (key === 'diagnosisConsistency') {
    if (percent >= 80) return '分层规则与教师判断基本吻合';
    if (percent >= 60) return '存在系统性偏差，建议复核分层阈值';
    return '偏差较大，先修分层规则再扩大试点';
  }
  if (key === 'matchFitness') {
    if (percent >= 70) return '推荐与学生的实际选择吻合';
    if (percent >= 50) return '部分推荐不贴人，检查维度权重';
    return '推荐基本不被采纳，匹配算法需要重做';
  }
  if (key === 'improvementCompletion') {
    if (percent >= 70) return '追问有效，学生愿意改';
    if (percent >= 40) return '追问偏难或偏泛，学生改不动';
    return '追问没有形成改进，检查追问是否问到点上';
  }
  if (percent >= 75) return '四类证据基本齐全';
  if (percent >= 50) return '证据有缺口，评价仍偏印象';
  return '证据严重不足，过程性评价无从复核';
}
