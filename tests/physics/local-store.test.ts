import { describe, expect, it } from 'vitest';

import {
  clearDiagnosisResult,
  createInitialState,
  resetProjectProgress,
  updateState,
} from '@/lib/physics/local-store';
import type { AppState } from '@/lib/physics/types';

function seededState(): AppState {
  const base = createInitialState();
  return updateState(base, {
    role: 'student',
    student: {
      name: '陈思远',
      id: 'demo',
      major: '物理学',
      className: '物理学 2601 班',
      style: 'practice',
      target: 'application',
    },
    diagnosis: {
      score: 88,
      dimensions: { 力学: 90, 波动: 85, 热学: 88, 电磁学: 86, 光学: 90, 近代物理: 84, 实验: 92 },
      dims: { 力学: 90, 波动: 85, 热学: 88, 电磁学: 86, 光学: 90, 近代物理: 84, 实验: 92 },
      level: '基础扎实',
      answeredCount: 8,
      totalQuestions: 8,
    },
    projectId: 'project-a',
    activeTask: 3,
    taskChecks: { 'task-0': true },
    taskTexts: { 'task-0': '学生笔记' },
    chat: [{ role: 'user', text: '超声回波怎么算距离' }],
    labRecords: [
      {
        distanceM: 2,
        speedMps: 343,
        reflectivity: 0.8,
        noisePercent: 5,
        echoTimeMs: 11.66,
        measuredDistanceM: 2,
        errorPercent: 0,
        quality: '良好',
        waveform: { time: [0], amplitude: [0], sampleRateHz: 100000, totalMs: 1 },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
    evaluationReviews: {
      '陈思远': { score: 88, reason: '教师复核', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
    localProjects: [
      {
        id: 'local-1',
        title: '教师自建项目',
        level: '基础',
        dims: ['力学'],
        styles: ['practice'],
        targets: ['application'],
        intro: '教师在课程矩阵中自建的项目',
        ability: '能力路径',
      },
    ],
  });
}

describe('作用域化重置', () => {
  it('切换项目只清空项目级进度，保留学情画像与教师复核', () => {
    const before = seededState();
    const after = resetProjectProgress(before, 'project-b');

    // 项目级进度被清空
    expect(after.projectId).toBe('project-b');
    expect(after.activeTask).toBe(0);
    expect(after.taskChecks).toEqual({});
    expect(after.taskTexts).toEqual({});
    expect(after.chat).toEqual([]);
    expect(after.labRecords).toEqual([]);
    expect(after.evaluation).toBeUndefined();

    // 学情画像与教师侧数据必须保留
    expect(after.student?.name).toBe('陈思远');
    expect(after.diagnosis?.score).toBe(88);
    expect(after.evaluationReviews['陈思远']?.score).toBe(88);
    expect(after.localProjects).toHaveLength(1);
  });

  it('切换项目不会连带清掉教师复核记录', () => {
    const before = seededState();
    const after = resetProjectProgress(before, 'project-b');
    expect(Object.keys(after.evaluationReviews)).toEqual(['陈思远']);
  });

  it('重新诊断只清空诊断结果，保留项目进度与实验记录', () => {
    const before = seededState();
    const after = clearDiagnosisResult(before);

    expect(after.diagnosis).toBeUndefined();
    expect(after.projectId).toBe('project-a');
    expect(after.activeTask).toBe(3);
    expect(after.taskChecks).toEqual({ 'task-0': true });
    expect(after.chat).toHaveLength(1);
    expect(after.labRecords).toHaveLength(1);
    expect(after.student?.name).toBe('陈思远');
    expect(after.evaluationReviews['陈思远']?.score).toBe(88);
  });

  it('重置不会修改传入的旧状态（保持不可变）', () => {
    const before = seededState();
    resetProjectProgress(before, 'project-b');
    clearDiagnosisResult(before);
    expect(before.projectId).toBe('project-a');
    expect(before.diagnosis?.score).toBe(88);
    expect(before.activeTask).toBe(3);
  });
});
