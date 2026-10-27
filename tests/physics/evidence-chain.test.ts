/**
 * 证据链与分层练习的回归护栏。
 *
 * 三类东西共用一条判据：**能不能被复核**。
 * - 分组推导必须稳定（刷新一次换一个组，教师手上的名单就作废了）；
 * - 互评必须带依据（没有依据的互评在复核时没有价值）；
 * - 练习必须按层级给（升层只看题变难，能力不会真的往上走）。
 */
import { describe, expect, it } from 'vitest';

import {
  EXERCISE_LEVEL_OF_TIER,
  EXERCISES,
  exerciseReason,
  recommendExercises,
} from '@/lib/physics/exercise-bank';
import {
  groupMembersOf,
  peerReviewCoverage,
  summarisePeerReviews,
  validatePeerReview,
} from '@/lib/physics/peer-review';
import { assignGroup } from '@/lib/physics/stages';
import type { PeerReview } from '@/lib/physics/types';

describe('分层练习', () => {
  it('三个层级都有题，五个板块都覆盖到', () => {
    const levels = new Set(EXERCISES.map((item) => item.level));
    expect(levels).toEqual(new Set(['基础', '进阶', '挑战']));
    const dimensions = new Set(EXERCISES.map((item) => item.dimension));
    ['力学', '波动', '电磁学', '光学', '热学'].forEach((dimension) => {
      expect(dimensions.has(dimension as never)).toBe(true);
    });
  });

  it('层级与认知动作一一对应', () => {
    expect(EXERCISE_LEVEL_OF_TIER.basic).toBe('基础');
    expect(EXERCISE_LEVEL_OF_TIER.applied).toBe('进阶');
    expect(EXERCISE_LEVEL_OF_TIER.challenge).toBe('挑战');
  });

  it('配题优先同层级，再优先薄弱维度', () => {
    const picked = recommendExercises({
      tier: 'basic',
      weakDimensions: ['电磁学'],
      limit: 2,
    });
    expect(picked).toHaveLength(2);
    expect(picked.every((item) => item.level === '基础')).toBe(true);
    expect(picked[0]?.dimension).toBe('电磁学');
  });

  it('同样的输入配出同样的题（可预测比"更聪明"重要）', () => {
    const first = recommendExercises({ tier: 'challenge', limit: 3 }).map((item) => item.id);
    const second = recommendExercises({ tier: 'challenge', limit: 3 }).map((item) => item.id);
    expect(first).toEqual(second);
  });

  it('每道题都有自查点，否则学生不知道做没做到', () => {
    EXERCISES.forEach((exercise) => {
      expect(exercise.selfCheck.length).toBeGreaterThan(0);
      expect(exercise.task.length).toBeGreaterThan(10);
    });
  });

  it('配题理由区分同层与补题', () => {
    const same = EXERCISES.find((item) => item.level === '基础')!;
    const other = EXERCISES.find((item) => item.level === '挑战')!;
    expect(exerciseReason(same, 'basic')).toContain('一致');
    expect(exerciseReason(other, 'basic')).toContain('补一道');
  });
});

describe('组内成员推导', () => {
  const roster = [
    { id: 's1', name: '甲' },
    { id: 's2', name: '乙' },
    { id: 's3', name: '丙' },
    { id: 's4', name: '丁' },
  ];

  it('同一个人每次算出来的组号一致', () => {
    const first = groupMembersOf({ studentId: 's1', studentName: '甲', tier: 'applied', roster });
    const second = groupMembersOf({ studentId: 's1', studentName: '甲', tier: 'applied', roster });
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
  });

  it('成员一定与本人同组，且包含本人', () => {
    const members = groupMembersOf({ studentId: 's1', studentName: '甲', tier: 'applied', roster });
    const selfGroup = assignGroup('applied', 's1').groupId;
    expect(members.some((item) => item.isSelf)).toBe(true);
    members.forEach((member) => {
      expect(assignGroup('applied', member.id).groupId).toBe(selfGroup);
    });
  });

  it('重复 id 只算一次', () => {
    const members = groupMembersOf({
      studentId: 's1',
      studentName: '甲',
      tier: 'basic',
      roster: [
        { id: 's1', name: '甲' },
        { id: 's1', name: '甲' },
      ],
    });
    expect(members).toHaveLength(1);
  });

  it('已评过的成员会被标出来', () => {
    const members = groupMembersOf({ studentId: 's1', studentName: '甲', tier: 'applied', roster });
    const peer = members.find((item) => !item.isSelf);
    if (!peer) return;
    const reviews: PeerReview[] = [
      {
        id: 'r1',
        targetId: peer.id,
        targetName: peer.name,
        contribution: 80,
        cooperation: 80,
        note: '承担了数据采集',
        at: '2026-10-01T00:00:00.000Z',
      },
    ];
    const withReview = groupMembersOf({
      studentId: 's1',
      studentName: '甲',
      tier: 'applied',
      roster,
      reviews,
    });
    expect(withReview.find((item) => item.id === peer.id)?.reviewed).toBe(true);
  });
});

describe('互评校验与汇总', () => {
  it('没写依据不给过', () => {
    expect(validatePeerReview({ contribution: 80, cooperation: 80, note: '  ' })).not.toBeNull();
    expect(validatePeerReview({ contribution: 80, cooperation: 80, note: '写了依据' })).toBeNull();
  });

  it('分数越界不给过', () => {
    expect(validatePeerReview({ contribution: 101, cooperation: 80, note: '依据够长' })).not.toBeNull();
    expect(validatePeerReview({ contribution: 80, cooperation: -1, note: '依据够长' })).not.toBeNull();
  });

  it('汇总按被评人聚合，平均分四舍五入', () => {
    const reviews: PeerReview[] = [
      { id: 'r1', targetId: 's2', targetName: '乙', contribution: 80, cooperation: 70, note: 'a', at: '' },
      { id: 'r2', targetId: 's2', targetName: '乙', contribution: 91, cooperation: 81, note: 'b', at: '' },
      { id: 'r3', targetId: 's3', targetName: '丙', contribution: 60, cooperation: 60, note: 'c', at: '' },
    ];
    const summary = summarisePeerReviews(reviews);
    expect(summary[0]?.targetId).toBe('s2');
    expect(summary[0]?.count).toBe(2);
    expect(summary[0]?.avgContribution).toBe(86);
    expect(summary[0]?.avgCooperation).toBe(76);
    expect(summary[0]?.notes).toEqual(['a', 'b']);
  });

  it('完成度只算同组同学，不算自己', () => {
    const members = [
      { id: 's1', name: '甲', role: 'a', isSelf: true, reviewed: false },
      { id: 's2', name: '乙', role: 'b', isSelf: false, reviewed: true },
      { id: 's3', name: '丙', role: 'c', isSelf: false, reviewed: false },
    ];
    expect(peerReviewCoverage(members)).toEqual({ done: 1, total: 2 });
  });
});
