/**
 * 量化评价表与成绩登记总表的护栏。
 *
 * 重点钉三件事：
 * 1. 维度内权重之和必须是 1（手写数据最容易错一位小数）；
 * 2. 层级边界 60 / 75 / 90 与申请书一致；
 * 3. 总分是**归一化加权**——三个阶段权重和是 110%，直接相加会算出 110 分。
 */
import { describe, expect, it } from 'vitest';

import { DEMO_STUDENTS } from '@/lib/physics/data';
import {
  BELOW_BASIC_LINE,
  RUBRIC_ROWS,
  dimensionScore,
  indicatorWeightSum,
  levelLabelOf,
  levelOf,
  rubricRowFor,
} from '@/lib/physics/quant-rubric';
import {
  ABILITY_WEIGHTS,
  SHEET_ABILITIES,
  SHEET_STAGES,
  buildRow,
  buildSheet,
  demoStudentId,
  emptyEntry,
  seedEntry,
  sheetColumns,
  sheetToRows,
  stageScore,
  totalScore,
} from '@/lib/physics/score-sheet';
import type { ScoreEntry } from '@/lib/physics/types';

function entryWith(value: number): ScoreEntry {
  const stage = {
    knowledge: value,
    application: value,
    innovation: value,
    collaboration: value,
  };
  return { prepare: stage, implement: stage, close: stage };
}

describe('量化评价表', () => {
  it('每个维度的三项指标权重之和为 1', () => {
    for (const row of RUBRIC_ROWS) {
      expect(indicatorWeightSum(row)).toBeCloseTo(1, 10);
    }
  });

  it('四个能力维度齐全，且都能按能力取到', () => {
    expect(RUBRIC_ROWS).toHaveLength(4);
    for (const ability of ['knowledge', 'application', 'innovation', 'collaboration'] as const) {
      expect(rubricRowFor(ability)?.ability).toBe(ability);
    }
  });

  it('层级边界：60 / 75 / 90', () => {
    expect(BELOW_BASIC_LINE).toBe(60);
    expect(levelOf(59.9)).toBeNull();
    expect(levelOf(60)).toBe('basic');
    expect(levelOf(74.9)).toBe('basic');
    expect(levelOf(75)).toBe('applied');
    expect(levelOf(89.9)).toBe('applied');
    expect(levelOf(90)).toBe('challenge');
    expect(levelOf(100)).toBe('challenge');
    expect(levelLabelOf(42)).toContain('未达标');
  });

  it('维度分按权重合成；缺项不按 0 计，而是重新归一化', () => {
    const row = rubricRowFor('knowledge')!;
    // 三项全给 80 → 80
    expect(
      dimensionScore(row, { 概念诊断正确率: 80, 原理阐释评分: 80, 情境计算得分率: 80 }),
    ).toBe(80);
    // 只给了权重 0.4 的那一项 90 → 仍然是 90，而不是 90×0.4=36
    expect(dimensionScore(row, { 概念诊断正确率: 90 })).toBe(90);
    // 一项都没给 → null，由调用方决定怎么显示
    expect(dimensionScore(row, {})).toBeNull();
  });
});

describe('成绩登记总表', () => {
  it('三个阶段权重与手册一致（30 / 50 / 30）', () => {
    expect(SHEET_STAGES.map((stage) => Math.round(stage.weight * 100))).toEqual([30, 50, 30]);
  });

  it('列顺序与纸质表一致：知识 / 创新 / 专业 / 团队', () => {
    expect(SHEET_ABILITIES.map((item) => item.ability)).toEqual([
      'knowledge',
      'innovation',
      'application',
      'collaboration',
    ]);
  });

  it('阶段内部权重之和为 1', () => {
    const sum = Object.values(ABILITY_WEIGHTS).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('阶段得分按四项能力加权', () => {
    const entry: ScoreEntry = {
      prepare: { knowledge: 100, application: 80, innovation: 60, collaboration: 40 },
      implement: { knowledge: 0, application: 0, innovation: 0, collaboration: 0 },
      close: { knowledge: 0, application: 0, innovation: 0, collaboration: 0 },
    };
    // 100×0.25 + 80×0.3 + 60×0.25 + 40×0.2 = 25 + 24 + 15 + 8 = 72
    expect(stageScore(entry, 'prepare')).toBe(72);
  });

  it('满分是 100 而不是 110（权重和 110% 要归一化）', () => {
    expect(totalScore(entryWith(100))).toBe(100);
    expect(totalScore(entryWith(0))).toBe(0);
  });

  it('总分按阶段权重加权', () => {
    const entry: ScoreEntry = {
      prepare: { knowledge: 100, application: 100, innovation: 100, collaboration: 100 },
      implement: { knowledge: 0, application: 0, innovation: 0, collaboration: 0 },
      close: { knowledge: 0, application: 0, innovation: 0, collaboration: 0 },
    };
    // (100×0.3 + 0 + 0) / 1.1 = 27.27 → 27.3
    expect(totalScore(entry)).toBe(27.3);
  });

  it('学号由姓名稳定生成，不随刷新变化', () => {
    expect(demoStudentId('陈酒酉')).toBe(demoStudentId('陈酒酉'));
    expect(demoStudentId('陈酒酉')).not.toBe(demoStudentId('侯梦阳'));
    expect(demoStudentId('陈酒酉')).toMatch(/^2023\d{7}$/);
  });

  it('默认表按演示学生逐行生成，每行都有总分；录入值优先于示例值', () => {
    const rows = buildSheet();
    expect(rows).toHaveLength(DEMO_STUDENTS.length);
    for (const row of rows) {
      expect(row.total).toBeGreaterThan(0);
      expect(row.total).toBeLessThanOrEqual(100);
    }

    const target = rows[0]!;
    const custom = entryWith(88);
    const overridden = buildSheet({ [target.studentId]: custom });
    expect(overridden[0]?.total).toBe(88);
  });

  it('示例值不会越界', () => {
    for (let score = 0; score <= 100; score += 10) {
      for (let progress = 0; progress <= 100; progress += 10) {
        const entry = seedEntry({ score, progress, seed: `s-${score}-${progress}` });
        for (const stage of SHEET_STAGES) {
          for (const ability of SHEET_ABILITIES) {
            const value = entry[stage.key][ability.ability];
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('导出列与行一一对应', () => {
    const columns = sheetColumns();
    expect(columns).toHaveLength(2 + SHEET_STAGES.length * SHEET_ABILITIES.length + 1);
    const rows = sheetToRows([buildRow('20230000001', '张三', emptyEntry())]);
    expect(Object.keys(rows[0]!)).toEqual(columns);
  });
});
