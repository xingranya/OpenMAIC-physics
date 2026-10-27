/**
 * 学生成绩登记总表。
 *
 * 结构与教学工作手册里那张纸质表一一对应：
 *
 *   学号 | 姓名 | 项目准备阶段（30%）四项 | 项目实施阶段（50%）四项 | 项目结项阶段（30%）四项 | 总分
 *
 * ## 总分公式是**归一化加权**，不是直接相加
 *
 * 三个阶段权重 30% / 50% / 30% 之和是 **110%**。直接按权重相加，满分学生
 * 会算出 110 分。这不是笔误——手册里的表就是 30/50/30，因为三个阶段的
 * 「分量」是按教学投入定的，不是按数学上凑 100 定的。
 *
 * 所以这里按 `Σ(阶段权重 × 阶段得分) / Σ阶段权重` 计算，等价于把权重
 * 归一化后再加权。好处是：手册上的权重可以随时改（比如下学期调成 20/50/30），
 * 总分照样落在 0–100 内，不用同时改两处。
 *
 * ## 阶段得分内部的四项权重
 *
 * 取 `stages.ts` 里 `overallScore` 的同一套权重（知识 25 / 专业 30 / 创新 25 /
 * 团队 20），而不是简单平均。理由：课后过程性评价与这张成绩表必须是**同一个
 * 口径**，否则学生在「课后：过程评价」里看到 82 分，成绩表上却是 78 分，
 * 两边都要解释一遍。
 */

import { DEMO_STUDENTS } from './data';
import type { FourAbility, ScoreEntry, SheetStageKey, StageScores } from './types';

/** 阶段定义与权重（与教学工作手册一致）。 */
export const SHEET_STAGES: readonly {
  key: SheetStageKey;
  label: string;
  weight: number;
}[] = [
  { key: 'prepare', label: '项目准备阶段', weight: 0.3 },
  { key: 'implement', label: '项目实施阶段', weight: 0.5 },
  { key: 'close', label: '项目结项阶段', weight: 0.3 },
];

/**
 * 成绩表的列顺序。
 *
 * 刻意与量化评价表的「知识 → 专业 → 创新 → 团队」不同：手册里的表就是
 * 知识理解与应用 / 创新思维能力 / 专业实践能力 / 团队协作能力。
 * 表要能直接对照纸质版填写，顺序不一致会被当成两张不同的表。
 */
export const SHEET_ABILITIES: readonly { ability: FourAbility; label: string }[] = [
  { ability: 'knowledge', label: '知识理解与应用' },
  { ability: 'innovation', label: '创新思维能力' },
  { ability: 'application', label: '专业实践能力' },
  { ability: 'collaboration', label: '团队协作能力' },
];

/** 阶段内部四项能力的权重（与 `overallScore` 同口径）。 */
export const ABILITY_WEIGHTS: Readonly<Record<FourAbility, number>> = {
  knowledge: 0.25,
  application: 0.3,
  innovation: 0.25,
  collaboration: 0.2,
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 空白录入值（全 0）。 */
export function emptyEntry(): ScoreEntry {
  const blank = (): StageScores => ({
    knowledge: 0,
    application: 0,
    innovation: 0,
    collaboration: 0,
  });
  return { prepare: blank(), implement: blank(), close: blank() };
}

/** 阶段得分：四项能力按权重合成，保留一位小数。 */
export function stageScore(entry: ScoreEntry, stage: SheetStageKey): number {
  const scores = entry[stage];
  const weighted = (Object.keys(ABILITY_WEIGHTS) as FourAbility[]).reduce(
    (sum, ability) => sum + clamp(scores[ability]) * ABILITY_WEIGHTS[ability],
    0,
  );
  return round1(weighted);
}

/** 总分：阶段得分按阶段权重加权，再除以权重之和（归一化）。 */
export function totalScore(entry: ScoreEntry): number {
  const weightSum = SHEET_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
  if (weightSum === 0) return 0;
  const weighted = SHEET_STAGES.reduce(
    (sum, stage) => sum + stageScore(entry, stage.key) * stage.weight,
    0,
  );
  return round1(weighted / weightSum);
}

/** 一名学生的整行数据。 */
export interface SheetRow {
  studentId: string;
  name: string;
  entry: ScoreEntry;
  stageScores: Record<SheetStageKey, number>;
  total: number;
}

/** 由录入值算出整行（阶段分与总分都算好，界面只负责显示）。 */
export function buildRow(
  studentId: string,
  name: string,
  entry: ScoreEntry,
): SheetRow {
  return {
    studentId,
    name,
    entry,
    stageScores: {
      prepare: stageScore(entry, 'prepare'),
      implement: stageScore(entry, 'implement'),
      close: stageScore(entry, 'close'),
    },
    total: totalScore(entry),
  };
}

/**
 * 示例学生的学号。
 *
 * 手册上的学号是真实的，系统里不能照抄——那会把真实学籍信息写进演示仓库。
 * 所以按姓名做一个稳定哈希生成 `2023xxxxxxx`：同一个名字每次得到同一个学号，
 * 刷新不变、导出不乱，但**不对应任何真实学生**。
 */
export function demoStudentId(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 131 + name.charCodeAt(index)) | 0;
  }
  const digits = String(Math.abs(hash) % 10000000).padStart(7, '0');
  return `2023${digits}`;
}

/**
 * 由演示学生的诊断分与进度推出一份**示例**录入值。
 *
 * 为什么要有它：一张全 0 的成绩表既看不出公式对不对，也没法演示排序与导出。
 * 但必须说清楚这是示例——所以三个阶段的取法都写在下面，且每个格子都能改：
 * 准备阶段贴近诊断分（刚开课，主要看基础），实施阶段贴近任务进度
 * （做多少算多少），结项阶段在两者之间（有修正也有收敛）。
 */
export function seedEntry(input: { score: number; progress: number; seed: string }): ScoreEntry {
  const { score, progress, seed } = input;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  const jitter = (offset: number): number => (Math.abs(hash >> offset) % 7) - 3;

  const around = (base: number, offset: number, delta: number): number =>
    clamp(base + delta + jitter(offset));

  const prepareBase = score * 0.6 + 40;
  const implementBase = progress * 0.5 + score * 0.5;
  const closeBase = (prepareBase + implementBase) / 2;

  return {
    prepare: {
      knowledge: around(prepareBase, 0, 4),
      application: around(prepareBase, 2, 0),
      innovation: around(prepareBase, 4, -4),
      collaboration: around(prepareBase, 6, 2),
    },
    implement: {
      knowledge: around(implementBase, 8, 2),
      application: around(implementBase, 10, -2),
      innovation: around(implementBase, 12, -5),
      collaboration: around(implementBase, 14, 3),
    },
    close: {
      knowledge: around(closeBase, 16, 3),
      application: around(closeBase, 18, 0),
      innovation: around(closeBase, 20, -3),
      collaboration: around(closeBase, 22, 4),
    },
  };
}

/** 默认成绩表：演示学生 + 已录入值（有录入值的用录入值）。 */
export function buildSheet(
  overrides: Readonly<Record<string, ScoreEntry>> = {},
  students: readonly { name: string; score: number; progress: number }[] = DEMO_STUDENTS,
): SheetRow[] {
  return students.map((student) => {
    const studentId = demoStudentId(student.name);
    const entry =
      overrides[studentId] ??
      seedEntry({ score: student.score, progress: student.progress, seed: student.name });
    return buildRow(studentId, student.name, entry);
  });
}

/** 导出的 CSV 表头（与手册一致）。 */
export function sheetColumns(): string[] {
  const columns = ['学号', '姓名'];
  for (const stage of SHEET_STAGES) {
    for (const ability of SHEET_ABILITIES) {
      columns.push(`${stage.label}-${ability.label}`);
    }
  }
  columns.push('总分');
  return columns;
}

/** 导出为行数组（供 `toCsv` 使用）。 */
export function sheetToRows(rows: readonly SheetRow[]): Record<string, string | number>[] {
  return rows.map((row) => {
    const record: Record<string, string | number> = {
      学号: row.studentId,
      姓名: row.name,
    };
    for (const stage of SHEET_STAGES) {
      for (const ability of SHEET_ABILITIES) {
        record[`${stage.label}-${ability.label}`] = row.entry[stage.key][ability.ability];
      }
    }
    record['总分'] = row.total;
    return record;
  });
}
