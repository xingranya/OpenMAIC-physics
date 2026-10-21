/**
 * 校本课程层 —— 长江大学文理学院 · 大学物理
 *
 * 基础章节矩阵（标题、知识点、项目映射、难度、学时、产出、状态）由
 * `lib/physics/data.ts` 的 CHAPTER_MAPPINGS 提供，是移植自教师既有
 * 教学闭环的领域数据；本文件只做"校本扩展"，不重复定义基础内容：
 * 教材章节号、校内实验项目、思政锚点、模块周次与实验开设情况。
 *
 * 真实性红线：学时、周次、实验项目编号若无公开可核验来源，
 * 一律标注为"示例"（见 `isVerified` 字段），界面上同步提示。
 */

import type { ChapterStatus, DiagnosticDimension, ProjectLevel, QuizQuestion } from '@/lib/physics/types';
import { QUIZ_QUESTIONS } from '@/lib/physics/data';

/** 章节的校本扩展信息。 */
export interface SchoolChapterMeta {
  /** 对应章节矩阵中的章号。 */
  no: number;
  /** 教材章节号（示例，待教务核对）。 */
  textbookSection: string;
  /** 关联的校内实验项目。 */
  labIds: readonly string[];
  /** 课程思政锚点 key，对应 `lib/school/ideology.ts`。 */
  ideologyKey: string;
  /** 教学周次（示例）。 */
  weeks: string;
  /** 该章信息是否已获公开来源核验。 */
  isVerified: boolean;
}

/** 校内实验项目。 */
export interface SchoolLab {
  id: string;
  /** 实验名称。 */
  name: string;
  /** 所属知识维度。 */
  dimension: DiagnosticDimension;
  /** 建议学时。 */
  hours: string;
  /** 器材要点。 */
  apparatus: string;
  /** 主要测量量。 */
  measurand: string;
  /** 在平台内对应的虚拟实验标识。 */
  virtualLab: string;
  /** 是否已获公开来源核验。 */
  isVerified: boolean;
}

/** 教学模块的周次与学时分配（示例，待教务核对）。 */
export interface SchoolModulePlan {
  module: string;
  volume: '上册' | '下册';
  /** 周次区间描述。 */
  weeks: string;
  /** 理论学时。 */
  theoryHours: number;
  /** 实验学时。 */
  labHours: number;
}

/** 章节的校本扩展（按章号索引）。 */
export const SCHOOL_CHAPTER_META: Readonly<Record<number, SchoolChapterMeta>> = {
  1: { no: 1, textbookSection: '第 1 章（示例）', labIds: ['lab-error'], ideologyKey: 'rigor', weeks: '第 1-2 周', isVerified: false },
  2: { no: 2, textbookSection: '第 2 章（示例）', labIds: [], ideologyKey: 'model', weeks: '第 3-4 周', isVerified: false },
  3: { no: 3, textbookSection: '第 3 章（示例）', labIds: ['lab-incline'], ideologyKey: 'model', weeks: '第 5-7 周', isVerified: false },
  4: { no: 4, textbookSection: '第 4 章（示例）', labIds: ['lab-energy'], ideologyKey: 'energy', weeks: '第 8-9 周', isVerified: false },
  5: { no: 5, textbookSection: '第 5 章（示例）', labIds: [], ideologyKey: 'model', weeks: '第 10 周', isVerified: false },
  6: { no: 6, textbookSection: '第 6 章（示例）', labIds: ['lab-rotation'], ideologyKey: 'craft', weeks: '第 11-12 周', isVerified: false },
  7: { no: 7, textbookSection: '第 7 章（示例）', labIds: ['lab-oscillation'], ideologyKey: 'craft', weeks: '第 13-14 周', isVerified: false },
  8: { no: 8, textbookSection: '第 8 章（示例）', labIds: ['lab-ultrasonic'], ideologyKey: 'service', weeks: '第 15-16 周', isVerified: false },
  9: { no: 9, textbookSection: '第 9 章（示例）', labIds: ['lab-ideal-gas'], ideologyKey: 'rigor', weeks: '第 17 周', isVerified: false },
  10: { no: 10, textbookSection: '第 10 章（示例）', labIds: [], ideologyKey: 'energy', weeks: '第 18 周', isVerified: false },
  11: { no: 11, textbookSection: '第 11 章（示例）', labIds: ['lab-field'], ideologyKey: 'service', weeks: '第 19-20 周', isVerified: false },
  12: { no: 12, textbookSection: '第 12 章（示例）', labIds: ['lab-circuit'], ideologyKey: 'craft', weeks: '第 21-22 周', isVerified: false },
  13: { no: 13, textbookSection: '第 13 章（示例）', labIds: ['lab-magnetic'], ideologyKey: 'craft', weeks: '第 23 周', isVerified: false },
  14: { no: 14, textbookSection: '第 14 章（示例）', labIds: [], ideologyKey: 'service', weeks: '第 24-25 周', isVerified: false },
  15: { no: 15, textbookSection: '第 15 章（示例）', labIds: ['lab-lens'], ideologyKey: 'craft', weeks: '第 26 周', isVerified: false },
  16: { no: 16, textbookSection: '第 16 章（示例）', labIds: ['lab-interference'], ideologyKey: 'rigor', weeks: '第 27-28 周', isVerified: false },
  17: { no: 17, textbookSection: '第 17 章（示例）', labIds: ['lab-photoelectric'], ideologyKey: 'service', weeks: '第 29 周', isVerified: false },
  18: { no: 18, textbookSection: '第 18 章（示例）', labIds: [], ideologyKey: 'model', weeks: '第 30 周', isVerified: false },
};

/** 校内实验项目清单。 */
export const SCHOOL_LABS: readonly SchoolLab[] = [
  {
    id: 'lab-error',
    name: '长度测量与不确定度评定',
    dimension: '实验',
    hours: '2',
    apparatus: '游标卡尺、千分尺、钢直尺（示例器材清单）',
    measurand: '被测长度与读数不确定度',
    virtualLab: 'error-analysis',
    isVerified: false,
  },
  {
    id: 'lab-incline',
    name: '斜面小车运动与受力分析',
    dimension: '力学',
    hours: '2',
    apparatus: '气垫导轨、光电门、砝码（示例器材清单）',
    measurand: '加速度与摩擦系数',
    virtualLab: 'incline-motion',
    isVerified: false,
  },
  {
    id: 'lab-energy',
    name: '弹簧振子能量转换',
    dimension: '力学',
    hours: '2',
    apparatus: '气垫导轨、光电门、弹簧（示例器材清单）',
    measurand: '速度与弹性势能',
    virtualLab: 'spring-energy',
    isVerified: false,
  },
  {
    id: 'lab-rotation',
    name: '刚体转动惯量测定',
    dimension: '力学',
    hours: '3',
    apparatus: '刚体转动实验仪、光电门（示例器材清单）',
    measurand: '转动惯量与角加速度',
    virtualLab: 'rigid-rotation',
    isVerified: false,
  },
  {
    id: 'lab-oscillation',
    name: '单摆与受迫振动',
    dimension: '波动',
    hours: '2',
    apparatus: '单摆装置、电磁激振器（示例器材清单）',
    measurand: '周期、固有频率与共振曲线',
    virtualLab: 'pendulum-resonance',
    isVerified: false,
  },
  {
    id: 'lab-ultrasonic',
    name: '超声波测距实验',
    dimension: '波动',
    hours: '3',
    apparatus: '超声波收发换能器、示波器、游标卡尺（示例器材清单）',
    measurand: '回波时延与被测距离',
    virtualLab: 'ultrasonic-ranging',
    isVerified: false,
  },
  {
    id: 'lab-ideal-gas',
    name: '理想气体状态方程验证',
    dimension: '热学',
    hours: '2',
    apparatus: '气缸、压力传感器、温度计（示例器材清单）',
    measurand: 'P-V-T 三态参量',
    virtualLab: 'ideal-gas',
    isVerified: false,
  },
  {
    id: 'lab-field',
    name: '静电场分布与电势测量',
    dimension: '电磁学',
    hours: '3',
    apparatus: '静电场探针、导电纸（示例器材清单）',
    measurand: '电势分布与电场强度',
    virtualLab: 'electrostatic-field',
    isVerified: false,
  },
  {
    id: 'lab-circuit',
    name: '基尔霍夫定律与电功率',
    dimension: '电磁学',
    hours: '3',
    apparatus: '直流稳压电源、数字万用表（示例器材清单）',
    measurand: '支路电流与功率耗散',
    virtualLab: 'dc-circuit',
    isVerified: false,
  },
  {
    id: 'lab-magnetic',
    name: '磁感应强度与漏磁检测',
    dimension: '电磁学',
    hours: '2',
    apparatus: '霍尔探头、蹄形磁铁（示例器材清单）',
    measurand: '磁感应强度分布',
    virtualLab: 'magnetic-field',
    isVerified: false,
  },
  {
    id: 'lab-lens',
    name: '薄透镜成像与光学仪器',
    dimension: '光学',
    hours: '2',
    apparatus: '光具座、透镜组、蜡烛（示例器材清单）',
    measurand: '焦距与像距',
    virtualLab: 'thin-lens',
    isVerified: false,
  },
  {
    id: 'lab-interference',
    name: '迈克尔逊干涉仪条纹计数',
    dimension: '光学',
    hours: '3',
    apparatus: '迈克尔逊干涉仪、光学计数装置（示例器材清单）',
    measurand: '条纹数与光程差',
    virtualLab: 'michelson-interference',
    isVerified: false,
  },
  {
    id: 'lab-photoelectric',
    name: '光电效应与普朗克常量测定',
    dimension: '近代物理',
    hours: '3',
    apparatus: '光电效应实验仪、光电管（示例器材清单）',
    measurand: '截止电压与普朗克常量',
    virtualLab: 'photoelectric',
    isVerified: false,
  },
];

/** 教学模块的周次与学时分配。 */
export const SCHOOL_MODULE_PLAN: readonly SchoolModulePlan[] = [
  { module: '力学', volume: '上册', weeks: '第 1-12 周', theoryHours: 25, labHours: 11 },
  { module: '振动与波', volume: '上册', weeks: '第 13-16 周', theoryHours: 11, labHours: 7 },
  { module: '热学', volume: '上册', weeks: '第 17-18 周', theoryHours: 10, labHours: 4 },
  { module: '电磁学', volume: '下册', weeks: '第 19-25 周', theoryHours: 24, labHours: 12 },
  { module: '光学', volume: '下册', weeks: '第 26-28 周', theoryHours: 11, labHours: 7 },
  { module: '近代物理', volume: '下册', weeks: '第 29-30 周', theoryHours: 9, labHours: 5 },
];

/** 章节对应的思政 key 列表（供课件与报告引用）。 */
export const CHAPTER_IDEOLOGY_KEYS: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(SCHOOL_CHAPTER_META).map(([no, meta]) => [Number(no), meta.ideologyKey]),
);

/** 取得某章的校本扩展信息。 */
export function getSchoolChapterMeta(no: number): SchoolChapterMeta | undefined {
  return SCHOOL_CHAPTER_META[no];
}

/** 取得某章关联的校内实验。 */
export function getLabsForChapter(no: number): SchoolLab[] {
  const meta = SCHOOL_CHAPTER_META[no];
  if (!meta) return [];
  return SCHOOL_LABS.filter((lab) => meta.labIds.includes(lab.id));
}

/** 取得某实验对应的章节号。 */
export function getChapterForLab(labId: string): number | undefined {
  const entry = Object.entries(SCHOOL_CHAPTER_META).find(([, meta]) => meta.labIds.includes(labId));
  return entry ? Number(entry[0]) : undefined;
}

/** 难度 → 状态的中文标签映射，供课程矩阵筛选使用。 */
export const CHAPTER_STATUS_LABELS: Readonly<Record<ChapterStatus, string>> = {
  成熟案例: '成熟案例',
  重点建设: '重点建设',
  拓展案例: '拓展案例',
};

/** 难度标签。 */
export const PROJECT_LEVEL_LABELS: Readonly<Record<ProjectLevel, string>> = {
  基础: '基础',
  中等: '中等',
  较高: '较高',
};

/**
 * 校本课前诊断题集：8 题覆盖全部 7 个知识维度。
 *
 * `lib/physics/data.ts` 的 QUIZ_QUESTIONS 是移植自教师既有闭环的原始题库，
 * 本身保持逐字不变；它只考查 5 个维度，热学与近代物理没有题目，
 * 因此"8 道题覆盖 7 个知识维度"这一产品口径在原始题库上并不成立。
 *
 * 本文件按学校"每学期第一周摸底"的实际需要重新选编：
 *  - 保留 6 题原始题目（力学 / 波动 / 电磁学 / 光学 / 实验 ×2）；
 *  - 校本补写 2 题（热学 / 近代物理），用于覆盖本校大纲中这两个模块；
 *  - 8 题恰好覆盖 7 个维度，其中"实验"维度考查 2 题（多次测量与误差分析），
 *    呼应本校超声测距实验对实验素养的要求。
 *
 * 题目内容为课程示例，用于课堂摸底，不作为成绩。
 */
const SCHOOL_OWNED_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: 'ideal-gas-law',
    question: '一定质量的理想气体在温度不变时体积增大，压强将如何变化？',
    options: ['压强增大', '压强减小', '压强不变', '先增大后减小'],
    correctIndex: 1,
    dimension: '热学',
    q: '一定质量的理想气体在温度不变时体积增大，压强将如何变化？',
    opts: ['压强增大', '压强减小', '压强不变', '先增大后减小'],
    a: 1,
    dim: '热学',
  },
  {
    id: 'photoelectric-effect',
    question: '光电效应中，在入射光频率不变时增大光强，光电子的最大初动能？',
    options: ['增大', '减小', '保持不变', '先增大后减小'],
    correctIndex: 2,
    dimension: '近代物理',
    q: '光电效应中，在入射光频率不变时增大光强，光电子的最大初动能？',
    opts: ['增大', '减小', '保持不变', '先增大后减小'],
    a: 2,
    dim: '近代物理',
  },
];

/** 校本课前诊断题集中被舍弃的原始题目 id（原始题库本身不变）。 */
const SCHOOL_EXCLUDED_QUESTION_IDS: readonly string[] = ['energy-conservation', 'wave-relation'];

/** 校本课前诊断题集（8 题 / 7 维）。 */
export const SCHOOL_DIAGNOSIS_QUESTIONS: readonly QuizQuestion[] = [
  ...QUIZ_QUESTIONS.filter(
    (question) => !SCHOOL_EXCLUDED_QUESTION_IDS.includes(question.id),
  ),
  ...SCHOOL_OWNED_QUESTIONS,
];

/** 校本诊断题实际考查的知识维度（用于区分"未考查"与"得 0 分"）。 */
export const SCHOOL_DIAGNOSIS_DIMENSIONS: readonly DiagnosticDimension[] = Array.from(
  new Set(SCHOOL_DIAGNOSIS_QUESTIONS.map((question) => question.dimension)),
);
