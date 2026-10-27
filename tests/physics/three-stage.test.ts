/**
 * 「三诊」引擎的回归护栏。
 *
 * 这一层全是纯函数，所以能逐条钉住判定边界：分层阈值、配对层级、
 * 分组稳定性、课中判定的**顺序**、课后权重与轨迹。
 *
 * 为什么要钉这么细：这些数字会直接出现在教师审核台与学生的评价页上，
 * 一个阈值写错，整班的分层就偏一层，而界面上看起来完全正常。
 */
import { describe, expect, it } from 'vitest';

import { PROJECTS } from '@/lib/physics/data';
import {
  INCLASS_QUESTIONS,
  diagnoseInClassAnswer,
  getInClassQuestion,
} from '@/lib/physics/inclass-bank';
import { createInitialState, normaliseState, STORAGE_VERSION } from '@/lib/physics/local-store';
import {
  TIER_PROJECT_LEVEL,
  assignGroup,
  buildPostClassRecord,
  buildPreClassPlan,
  gradeOf,
  inClassScore,
  overallScore,
  recommendProjects,
  tierFromDiagnosis,
  weakDimensionsOf,
} from '@/lib/physics/stages';
import type {
  AppState,
  DiagnosisResult,
  DiagnosticDimension,
  InClassExchange,
} from '@/lib/physics/types';

const ALL_DIMENSIONS: readonly DiagnosticDimension[] = [
  '力学',
  '波动',
  '热学',
  '电磁学',
  '光学',
  '近代物理',
  '实验',
];

/** 造一个诊断结果：给定总分与若干维度分，未指定的维度按 80 补。 */
function diagnosis(
  score: number,
  overrides: Partial<Record<DiagnosticDimension, number>> = {},
): DiagnosisResult {
  const dims = {} as Record<DiagnosticDimension, number>;
  for (const dimension of ALL_DIMENSIONS) dims[dimension] = overrides[dimension] ?? 80;
  return {
    score,
    dimensions: dims,
    dims,
    level: '',
    answeredCount: 8,
    totalQuestions: 8,
  };
}

function exchange(errorKind: InClassExchange['errorKind'], id = 'x1'): InClassExchange {
  return {
    id,
    questionId: 'mech-1',
    answer: '答案',
    errorKind,
    evidence: '',
    followUp: '',
    reference: '',
    anchor: '',
    createdAt: '2026-10-27T00:00:00.000Z',
    review: { status: 'pending' },
  };
}

describe('学情分层', () => {
  it('按总分卡 70 / 85 两条线', () => {
    expect(tierFromDiagnosis(diagnosis(69))).toBe('basic');
    expect(tierFromDiagnosis(diagnosis(70))).toBe('applied');
    expect(tierFromDiagnosis(diagnosis(84))).toBe('applied');
    expect(tierFromDiagnosis(diagnosis(85))).toBe('challenge');
  });

  it('三个以上维度低于 60 时降一档', () => {
    // 总分够高，但三个维度都塌了：直接丢进创新挑战任务大概率做不动。
    const weak = diagnosis(88, { 力学: 55, 波动: 52, 光学: 48 });
    expect(tierFromDiagnosis(weak)).toBe('applied');

    // 挑战层再降就落到应用层，不会一次掉两级。
    const weaker = diagnosis(92, { 力学: 55, 波动: 52, 光学: 48 });
    expect(tierFromDiagnosis(weaker)).toBe('applied');
  });

  it('没有诊断结果时按基础层处理，不抛错', () => {
    expect(tierFromDiagnosis(undefined)).toBe('basic');
  });

  it('薄弱维度优先取低于 60 的，按分数升序', () => {
    const result = diagnosis(80, { 力学: 58, 波动: 40, 光学: 52 });
    expect(weakDimensionsOf(result, 2)).toEqual(['波动', '光学']);
  });

  it('没有低于 60 的维度时退回最低的那几个', () => {
    const result = diagnosis(90, { 力学: 86, 波动: 72, 光学: 74 });
    expect(weakDimensionsOf(result, 1)).toEqual(['波动']);
  });
});

describe('梯度配对', () => {
  it('同层案例够用时，只给同层案例', () => {
    for (const tier of ['basic', 'applied', 'challenge'] as const) {
      const matches = recommendProjects({ tier, projects: PROJECTS });
      expect(matches).toHaveLength(3);
      for (const match of matches) {
        expect(match.project.level).toBe(TIER_PROJECT_LEVEL[tier]);
      }
    }
  });

  it('同层案例不足时用相邻档补齐，并说明原因', () => {
    const onlyBasic = PROJECTS.filter((project) => project.level === '基础');
    const matches = recommendProjects({ tier: 'challenge', projects: onlyBasic, limit: 3 });
    // 库里一个「较高」都没有，只能全用基础层补，但理由必须写明。
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.reasons[0]).toContain('同层案例不足');
  });
});

describe('分组', () => {
  it('同一学生每次得到同一个组与分工', () => {
    const first = assignGroup('applied', 'student-42');
    const second = assignGroup('applied', 'student-42');
    expect(first).toEqual(second);
  });

  it('不同层级落在不同字母组', () => {
    expect(assignGroup('basic', 's1').groupId.startsWith('A')).toBe(true);
    expect(assignGroup('applied', 's1').groupId.startsWith('B')).toBe(true);
    expect(assignGroup('challenge', 's1').groupId.startsWith('C')).toBe(true);
  });
});

describe('课前方案', () => {
  it('未审核时状态是 pending，并带上时间戳', () => {
    const plan = buildPreClassPlan({
      diagnosis: diagnosis(78),
      projects: PROJECTS,
      seed: 's1',
      now: 1_700_000_000_000,
    });
    expect(plan.review.status).toBe('pending');
    expect(plan.tier).toBe('applied');
    expect(plan.submittedAt).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('课中判定顺序', () => {
  const mech1 = getInClassQuestion('mech-1')!;

  it('概念错优先于其它一切', () => {
    // 同时含「质量越大速度越大」（概念错）与没有单位（单位错）。
    const result = diagnoseInClassAnswer(mech1, '质量越大速度越大，大概是 9.9');
    expect(result.errorKind).toBe('concept');
    expect(result.evidence).toContain('质量越大速度越大');
  });

  it('建模错优先于单位错', () => {
    const result = diagnoseInClassAnswer(mech1, '用动量守恒算，得到 9.9');
    expect(result.errorKind).toBe('model');
  });

  it('有数字没单位 → 单位错', () => {
    const result = diagnoseInClassAnswer(mech1, '机械能守恒，v 等于 9.9');
    expect(result.errorKind).toBe('unit');
  });

  it('太短的答案直接判思路不完整', () => {
    expect(diagnoseInClassAnswer(mech1, '9.9').errorKind).toBe('incomplete');
  });

  it('命中关键点且带单位 → 未发现明显错误', () => {
    const result = diagnoseInClassAnswer(
      mech1,
      '光滑斜面机械能守恒，mgh = ½mv²，质量约去，v = √(2gh) ≈ 9.9 m/s',
    );
    expect(result.errorKind).toBe('correct');
    expect(result.followUp.length).toBeGreaterThan(0);
  });

  it('题库每道题都自洽：指标权重无关，但关键点与参考答案不能为空', () => {
    for (const question of INCLASS_QUESTIONS) {
      expect(question.keyPoints.length).toBeGreaterThan(0);
      expect(question.reference.length).toBeGreaterThan(20);
      expect(question.anchor.length).toBeGreaterThan(0);
    }
  });
});

describe('课中参与度', () => {
  it('一轮都没有就是 0，不拿诊断分顶替', () => {
    expect(inClassScore([])).toBe(0);
  });

  it('答对一轮也能拿到参与分', () => {
    // 100 × 0.7 + (40 + 15) × 0.3 = 86.5 → 87
    expect(inClassScore([exchange('correct')])).toBe(87);
  });

  it('答错但继续追问，比答一次就走分高', () => {
    const oneConcept = inClassScore([exchange('concept', 'a')]);
    const threeConcept = inClassScore([
      exchange('concept', 'a'),
      exchange('concept', 'b'),
      exchange('concept', 'c'),
    ]);
    expect(threeConcept).toBeGreaterThan(oneConcept);
  });
});

describe('课后过程性评价', () => {
  function stateWith(overrides: Partial<AppState>): AppState {
    return { ...createInitialState(), ...overrides };
  }

  it('轨迹每次生成追加一条，最多保留 8 条', () => {
    let state = stateWith({ diagnosis: diagnosis(80) });
    for (let index = 0; index < 10; index += 1) {
      state = { ...state, postClass: buildPostClassRecord({ state, now: 1_700_000_000_000 }) };
    }
    expect(state.postClass?.trajectory).toHaveLength(8);
    expect(state.postClass?.trajectory.at(-1)?.label).toBe('第 10 次评价');
  });

  it('重新生成时保留教师修正', () => {
    const teacher = { score: 91, note: '课中表现好', at: '2026-10-27T00:00:00.000Z' };
    const state = stateWith({
      diagnosis: diagnosis(80),
      postClass: {
        abilities: { knowledge: 70, application: 70, innovation: 70, collaboration: 70 },
        contributions: { preClass: 80, inClass: 0, task: 0, teamwork: 0 },
        advice: [],
        trajectory: [],
        generatedAt: '2026-10-26T00:00:00.000Z',
        teacher,
      },
    });
    const next = buildPostClassRecord({ state, now: 1_700_000_000_000 });
    expect(next.teacher).toEqual(teacher);
  });

  it('没有课中记录时给出明确建议，而不是伪造参与分', () => {
    const state = stateWith({ diagnosis: diagnosis(80) });
    const record = buildPostClassRecord({ state, now: 1_700_000_000_000 });
    expect(record.contributions.inClass).toBe(0);
    expect(record.advice.join('')).toContain('课中还没有产生问答记录');
  });

  it('综合分与等级', () => {
    const abilities = { knowledge: 80, application: 90, innovation: 70, collaboration: 60 };
    // 80×0.25 + 90×0.3 + 70×0.25 + 60×0.2 = 76.5 → 77
    expect(overallScore(abilities)).toBe(77);
    expect(gradeOf(77)).toBe('达标');
    expect(gradeOf(90)).toBe('卓越');
    expect(gradeOf(59)).toBe('需重点改进');
  });
});

describe('持久化兼容', () => {
  it('版本号已升到 2', () => {
    expect(STORAGE_VERSION).toBe(2);
  });

  it('旧包络（v1，没有三诊字段）读进来不报错，补齐默认值', () => {
    const legacy = {
      role: 'student',
      projectId: null,
      activeTask: 0,
      taskChecks: {},
      taskTexts: {},
      chat: [],
      labRecords: [],
      evaluationReviews: {},
      localProjects: [],
    };
    const state = normaliseState(legacy);
    expect(state.inClass).toEqual([]);
    expect(state.scoreSheet).toEqual({});
    expect(state.preClass).toBeUndefined();
    expect(state.postClass).toBeUndefined();
  });

  it('被篡改成 approved 的审核状态：保留审核，但非法状态退回 pending', () => {
    const state = normaliseState({
      preClass: {
        tier: 'applied',
        matches: [],
        groupId: 'B2 组',
        groupRole: '建模与推导',
        submittedAt: '2026-10-27T00:00:00.000Z',
        review: { status: 'hacked' },
      },
      inClass: [
        {
          id: 'a',
          questionId: 'mech-1',
          errorKind: '不存在的类型',
          review: { status: 'approved', by: '顿中万' },
        },
      ],
    });
    expect(state.preClass?.review.status).toBe('pending');
    expect(state.inClass[0]?.errorKind).toBe('incomplete');
    expect(state.inClass[0]?.review.status).toBe('approved');
  });

  it('成绩表录入值越界会被夹回 0–100', () => {
    const state = normaliseState({
      scoreSheet: {
        s1: {
          prepare: { knowledge: 120, application: -5, innovation: 88.6, collaboration: 90 },
          implement: { knowledge: 80, application: 80, innovation: 80, collaboration: 80 },
          close: { knowledge: 80, application: 80, innovation: 80, collaboration: 80 },
        },
      },
    });
    const entry = state.scoreSheet.s1!;
    expect(entry.prepare.knowledge).toBe(100);
    expect(entry.prepare.application).toBe(0);
    expect(entry.prepare.innovation).toBe(89);
  });
});
