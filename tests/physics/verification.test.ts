/**
 * 四项核验指标的回归护栏。
 *
 * 这四项是量化评价表里「核验」一列的全部内容。它们最容易被写成
 * 「看起来在算、其实恒等于某个好看数字」——所以每条用例都钉住
 * **分子与分母**，而不只是比率本身：比率对了但分母错，说明口径已经漂了。
 */
import { describe, expect, it } from 'vitest';

import type { StageSubmission } from '@/lib/physics/submissions';
import {
  buildVerification,
  ratioText,
  ratioVerdict,
  type VerificationReport,
} from '@/lib/physics/verification';
import type {
  InClassExchange,
  PreClassPlan,
  Project,
  StageReview,
} from '@/lib/physics/types';

const PROJECT: Project = {
  id: 'p1',
  title: '示例项目',
  level: '中等',
  dims: ['力学'],
  styles: ['practice'],
  targets: ['application'],
  intro: '',
  ability: '',
};

const PROJECT_OTHER: Project = { ...PROJECT, id: 'p2', title: '另一个项目' };

function review(status: StageReview['status']): StageReview {
  return { status, by: '教师', at: '2026-10-01T00:00:00.000Z' };
}

function plan(overrides: Partial<PreClassPlan> = {}): PreClassPlan {
  return {
    tier: 'applied',
    dimensionScores: { 力学: 80, 波动: 80, 热学: 80, 电磁学: 80, 光学: 80, 近代物理: 80, 实验: 80 },
    weakDimensions: ['力学'],
    matches: [
      { project: PROJECT, score: 90, reasons: [] },
      { project: PROJECT_OTHER, score: 80, reasons: [] },
    ],
    groupId: 'B1 组',
    groupRole: '建模与推导',
    submittedAt: '2026-10-01T00:00:00.000Z',
    review: review('pending'),
    ...overrides,
  };
}

function exchange(id: string, questionId: string, errorKind: InClassExchange['errorKind']): InClassExchange {
  return {
    id,
    questionId,
    answer: '',
    errorKind,
    evidence: '',
    followUp: '',
    reference: '',
    anchor: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    review: review('pending'),
  };
}

function submission(overrides: Partial<StageSubmission> = {}): StageSubmission {
  return {
    studentId: 's1',
    studentName: '张三',
    updatedAt: '2026-10-01T00:00:00.000Z',
    inClass: [],
    ...overrides,
  };
}

describe('分母为 0 时返回 null 而不是 0', () => {
  it('没有任何提交', () => {
    const report = buildVerification([]);
    expect(report.diagnosisConsistency.value).toBeNull();
    expect(report.matchFitness.value).toBeNull();
    expect(report.improvementCompletion.value).toBeNull();
    expect(report.evidenceTraceability.value).toBeNull();
    expect(report.submissionCount).toBe(0);
    expect(ratioText(null)).toBe('—');
  });

  it('有提交但什么证据都没有', () => {
    const report = buildVerification([submission()]);
    // 证据这一项的分母是「人数 × 4」，所以它不会是 0/0。
    expect(report.evidenceTraceability.value).toBe(0);
    expect(report.evidenceTraceability.denominator).toBe(4);
    // 其余三项仍然无数据。
    expect(report.diagnosisConsistency.value).toBeNull();
    expect(report.matchFitness.value).toBeNull();
    expect(report.improvementCompletion.value).toBeNull();
  });
});

describe('诊断一致率', () => {
  it('未审核不进分母', () => {
    const report = buildVerification([submission({ preClass: plan() })]);
    expect(report.diagnosisConsistency.denominator).toBe(0);
    expect(report.diagnosisConsistency.value).toBeNull();
  });

  it('通过计一致、调整计不一致', () => {
    const report = buildVerification([
      submission({ studentId: 'a', preClass: plan({ review: review('approved') }) }),
      submission({ studentId: 'b', preClass: plan({ review: review('approved') }) }),
      submission({ studentId: 'c', preClass: plan({ review: review('adjusted') }) }),
      submission({ studentId: 'd', preClass: plan({ review: review('pending') }) }),
    ]);
    expect(report.diagnosisConsistency.numerator).toBe(2);
    expect(report.diagnosisConsistency.denominator).toBe(3);
    expect(report.diagnosisConsistency.value).toBeCloseTo(2 / 3, 5);
  });
});

describe('任务匹配适切率', () => {
  it('采用的项目在推荐里计适切，不在则计不适切', () => {
    const report = buildVerification([
      submission({
        studentId: 'a',
        preClass: plan(),
        evidence: { adoptedProjectId: 'p1', taskCompleted: 0, taskTotal: 5, versionCount: 0, peerReviewCount: 0, hasRole: true },
      }),
      submission({
        studentId: 'b',
        preClass: plan(),
        evidence: { adoptedProjectId: 'p9', taskCompleted: 0, taskTotal: 5, versionCount: 0, peerReviewCount: 0, hasRole: true },
      }),
    ]);
    expect(report.matchFitness.numerator).toBe(1);
    expect(report.matchFitness.denominator).toBe(2);
  });

  it('没有记录采用项目的不进分母', () => {
    const report = buildVerification([submission({ preClass: plan() })]);
    expect(report.matchFitness.denominator).toBe(0);
    expect(report.matchFitness.value).toBeNull();
  });
});

describe('反馈改进完成率', () => {
  it('同一题出现两条记录才算改进，且按题计不按轮计', () => {
    const report = buildVerification([
      submission({
        studentId: 'a',
        inClass: [
          exchange('e1', 'q1', 'concept'),
          exchange('e2', 'q1', 'concept'),
          exchange('e3', 'q1', 'correct'), // 同一题三轮，只算一次机会
          exchange('e4', 'q2', 'unit'), // 只答了一次，没改进
          exchange('e5', 'q3', 'correct'), // 一次答对，不进分母
        ],
      }),
    ]);
    expect(report.improvementCompletion.denominator).toBe(2);
    expect(report.improvementCompletion.numerator).toBe(1);
  });
});

describe('贡献证据可追溯率', () => {
  it('每名学生四格，缺什么就少一格', () => {
    const report = buildVerification([
      submission({
        studentId: 'a',
        evidence: { taskCompleted: 3, taskTotal: 5, versionCount: 2, peerReviewCount: 1, hasRole: true },
      }),
      submission({
        studentId: 'b',
        evidence: { taskCompleted: 0, taskTotal: 5, versionCount: 0, peerReviewCount: 0, hasRole: false },
      }),
    ]);
    expect(report.evidenceTraceability.denominator).toBe(8);
    expect(report.evidenceTraceability.numerator).toBe(4);
    expect(report.evidenceTraceability.value).toBe(0.5);
  });

  it('缺口按缺得多的排前面，并写清缺哪几类', () => {
    const report = buildVerification([
      submission({
        studentId: 'a',
        studentName: '甲',
        evidence: { taskCompleted: 1, taskTotal: 5, versionCount: 0, peerReviewCount: 0, hasRole: true },
      }),
      submission({
        studentId: 'b',
        studentName: '乙',
        evidence: { taskCompleted: 0, taskTotal: 5, versionCount: 0, peerReviewCount: 0, hasRole: false },
      }),
    ]);
    expect(report.gaps[0]?.studentName).toBe('乙');
    expect(report.gaps[0]?.missing).toHaveLength(4);
    expect(report.gaps[1]?.missing).toEqual(['作品版本', '组内互评']);
  });

  it('没有 evidence 时退回课前分工字段判断', () => {
    const report = buildVerification([submission({ preClass: plan() })]);
    // 分工来自 preClass.groupRole，其余三格仍然空。
    expect(report.evidenceTraceability.numerator).toBe(1);
  });
});

describe('口径与人话判断', () => {
  it('每项指标都带口径说明', () => {
    const report: VerificationReport = buildVerification([]);
    const keys = [
      'diagnosisConsistency',
      'matchFitness',
      'improvementCompletion',
      'evidenceTraceability',
    ] as const;
    keys.forEach((key) => {
      expect(report[key].basis.length).toBeGreaterThan(10);
    });
  });

  it('无数据时判断语不说「0%」', () => {
    expect(ratioVerdict('diagnosisConsistency', null)).toContain('还没有可统计的数据');
  });

  it('阈值分档', () => {
    expect(ratioVerdict('diagnosisConsistency', 0.9)).toContain('基本吻合');
    expect(ratioVerdict('diagnosisConsistency', 0.3)).toContain('偏差较大');
    expect(ratioVerdict('evidenceTraceability', 0.2)).toContain('严重不足');
  });
});
