/**
 * 三诊提交桥的护栏。
 *
 * 这一层是「教师审核」能真正实施的前提：学习数据按账号分区，
 * 教师读不到学生那份，所以结论必须走共享提交键。
 *
 * 重点钉住**合并的匹配规则**：只有两边对得上号（同一个提交时间 / 同一条记录 id）
 * 才把审核结果并回本地，否则学生重新生成的内容会被旧审核盖掉。
 */
import { describe, expect, it } from 'vitest';

import { createInitialState, normaliseState } from '@/lib/physics/local-store';
import {
  SUBMISSIONS_STORAGE_KEY,
  ackStage,
  clearSubmission,
  correctPostClass,
  mergeSharedIntoState,
  publishInClassExchange,
  publishPostClass,
  publishPreClass,
  readSubmission,
  readSubmissions,
  reviewExchange,
  reviewPreClass,
} from '@/lib/physics/submissions';
import type {
  AppState,
  InClassExchange,
  PostClassRecord,
  PreClassPlan,
  StorageLike,
} from '@/lib/physics/types';

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function plan(submittedAt = '2026-10-27T01:00:00.000Z'): PreClassPlan {
  return {
    tier: 'applied',
    dimensionScores: {} as PreClassPlan['dimensionScores'],
    weakDimensions: ['力学'],
    matches: [],
    groupId: 'B2 组',
    groupRole: '建模与推导',
    submittedAt,
    review: { status: 'pending' },
  };
}

function exchange(id = 'mech-1-1'): InClassExchange {
  return {
    id,
    questionId: 'mech-1',
    answer: '机械能守恒，9.9 m/s',
    errorKind: 'correct',
    evidence: '',
    followUp: '再想一步',
    reference: 'v = √(2gh)',
    anchor: '第 3 章 · 机械能守恒',
    createdAt: '2026-10-27T02:00:00.000Z',
    review: { status: 'pending' },
  };
}

function record(generatedAt = '2026-10-27T03:00:00.000Z'): PostClassRecord {
  return {
    abilities: { knowledge: 80, application: 80, innovation: 80, collaboration: 80 },
    contributions: { preClass: 80, inClass: 0, task: 0, teamwork: 0 },
    advice: [],
    trajectory: [],
    generatedAt,
  };
}

function studentState(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialState(), ...overrides };
}

describe('提交与读取', () => {
  it('学生提交后教师能读到', () => {
    const storage = memoryStorage();
    publishPreClass(
      { studentId: 'u1', studentName: '陈酒酉', plan: plan(), now: 1_700_000_000_000 },
      storage,
    );
    const submissions = readSubmissions(storage);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.studentName).toBe('陈酒酉');
    expect(submissions[0]?.preClass?.tier).toBe('applied');
  });

  it('课中问答按 id 去重，重复提交是覆盖不是追加', () => {
    const storage = memoryStorage();
    publishInClassExchange({ studentId: 'u1', studentName: '甲', exchange: exchange() }, storage);
    publishInClassExchange({ studentId: 'u1', studentName: '甲', exchange: exchange() }, storage);
    expect(readSubmission('u1', storage)?.inClass).toHaveLength(1);
  });

  it('存储写不进去时返回 false，不抛错', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(
      publishPreClass({ studentId: 'u1', studentName: '甲', plan: plan() }, broken),
    ).toBe(false);
  });

  it('损坏的 JSON 当作空表处理', () => {
    const storage = memoryStorage();
    storage.setItem(SUBMISSIONS_STORAGE_KEY, '{ 不是 JSON');
    expect(readSubmissions(storage)).toEqual([]);
  });
});

describe('教师审核', () => {
  it('审核课前方案后，学生端合并得到 approved', () => {
    const storage = memoryStorage();
    const shared = plan();
    publishPreClass({ studentId: 'u1', studentName: '甲', plan: shared }, storage);
    reviewPreClass(
      {
        studentId: 'u1',
        review: { status: 'approved', by: '顿中万', at: '2026-10-27T05:00:00.000Z' },
      },
      storage,
    );

    const local = studentState({ preClass: shared });
    const merged = mergeSharedIntoState(local, 'u1', storage);
    expect(merged.changed).toBe(true);
    expect(merged.state.preClass?.review.status).toBe('approved');
    expect(merged.state.preClass?.review.by).toBe('顿中万');
  });

  it('提交时间对不上时不合并——学生重新生成过方案', () => {
    const storage = memoryStorage();
    publishPreClass(
      { studentId: 'u1', studentName: '甲', plan: plan('2026-10-27T01:00:00.000Z') },
      storage,
    );
    reviewPreClass({ studentId: 'u1', review: { status: 'approved' } }, storage);

    const local = studentState({ preClass: plan('2026-10-27T09:00:00.000Z') });
    const merged = mergeSharedIntoState(local, 'u1', storage);
    expect(merged.changed).toBe(false);
    expect(merged.state.preClass?.review.status).toBe('pending');
  });

  it('审核课中问答后，参考答案在学生端解锁', () => {
    const storage = memoryStorage();
    const item = exchange();
    publishInClassExchange({ studentId: 'u1', studentName: '甲', exchange: item }, storage);
    reviewExchange(
      { studentId: 'u1', exchangeId: item.id, review: { status: 'approved', by: '顿中万' } },
      storage,
    );

    const local = studentState({ inClass: [item] });
    const merged = mergeSharedIntoState(local, 'u1', storage);
    expect(merged.state.inClass[0]?.review.status).toBe('approved');
  });

  it('教师修正课后评价后，学生端拿到修正分', () => {
    const storage = memoryStorage();
    const shared = record();
    publishPostClass({ studentId: 'u1', studentName: '甲', record: shared }, storage);
    correctPostClass(
      { studentId: 'u1', score: 93, note: '课中追问都自己改对了', now: 1_700_000_000_000 },
      storage,
    );

    const local = studentState({ postClass: shared });
    const merged = mergeSharedIntoState(local, 'u1', storage);
    expect(merged.state.postClass?.teacher?.score).toBe(93);
  });
});

describe('学生认可', () => {
  it('认可写回共享键，教师端能看到「有疑问」', () => {
    const storage = memoryStorage();
    const shared = plan();
    publishPreClass({ studentId: 'u1', studentName: '甲', plan: shared }, storage);
    ackStage(
      {
        studentId: 'u1',
        stage: 'preclass',
        ack: { accepted: false, note: '我觉得可以试一下挑战层', at: '2026-10-27T06:00:00.000Z' },
      },
      storage,
    );

    const stored = readSubmission('u1', storage);
    expect(stored?.preClass?.ack?.accepted).toBe(false);
    expect(stored?.preClass?.ack?.note).toContain('挑战层');
  });

  it('课中认可需要指定是哪一条问答', () => {
    const storage = memoryStorage();
    publishInClassExchange({ studentId: 'u1', studentName: '甲', exchange: exchange() }, storage);
    const ok = ackStage(
      {
        studentId: 'u1',
        stage: 'inclass',
        ack: { accepted: true, at: '2026-10-27T06:00:00.000Z' },
      },
      storage,
    );
    // 没给 exchangeId，不该误改任意一条
    expect(ok).toBe(false);

    const okWithId = ackStage(
      {
        studentId: 'u1',
        stage: 'inclass',
        ack: { accepted: true, at: '2026-10-27T06:00:00.000Z' },
        exchangeId: 'mech-1-1',
      },
      storage,
    );
    expect(okWithId).toBe(true);
  });
});

describe('清理', () => {
  it('学生重置学习记录后，教师端不再挂着旧存档', () => {
    const storage = memoryStorage();
    publishPreClass({ studentId: 'u1', studentName: '甲', plan: plan() }, storage);
    expect(readSubmissions(storage)).toHaveLength(1);
    clearSubmission('u1', storage);
    expect(readSubmissions(storage)).toEqual([]);
  });

  it('没有提交记录时合并是空操作', () => {
    const storage = memoryStorage();
    const local = studentState({ preClass: plan() });
    const merged = mergeSharedIntoState(local, 'nobody', storage);
    expect(merged.changed).toBe(false);
    expect(merged.state).toBe(local);
  });

  it('共享键里合法的审核被接受；非法状态退回 pending', () => {
    const storage = memoryStorage();
    storage.setItem(
      SUBMISSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        data: {
          u1: {
            studentId: 'u1',
            studentName: '甲',
            updatedAt: '',
            preClass: {
              ...plan(),
              review: { status: 'approved', by: '顿中万' },
            },
          },
          u2: {
            studentId: 'u2',
            studentName: '乙',
            updatedAt: '',
            preClass: {
              ...plan(),
              // 手工改成不存在的状态：必须退回 pending，不能凭空变成「教师已通过」。
              review: { status: '自己说通过了' },
            },
          },
        },
      }),
    );

    const merged = mergeSharedIntoState(normaliseState({ preClass: plan() }), 'u1', storage);
    expect(merged.state.preClass?.review.status).toBe('approved');

    const hacked = mergeSharedIntoState(normaliseState({ preClass: plan() }), 'u2', storage);
    expect(hacked.changed).toBe(false);
    expect(hacked.state.preClass?.review.status).toBe('pending');
  });
});
