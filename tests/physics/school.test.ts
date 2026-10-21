import { describe, expect, it } from 'vitest';

import {
  BRAND_FULL_NAME,
  BRAND_TOKENS,
  COURSE,
  DEMO,
  IDEOLOGY_POINTS,
  PLATFORM,
  RUBRIC,
  SCHOOL,
  SCHOOL_CHAPTER_META,
  SCHOOL_DIAGNOSIS_DIMENSIONS,
  SCHOOL_DIAGNOSIS_QUESTIONS,
  SCHOOL_LABS,
  buildCampusContext,
  buildIdeologyConstraint,
  buildPersonaSummary,
  buildRubricSummary,
  describeBand,
  getIdeologyPoint,
  getIdeologyPointForDimension,
  getLabsForChapter,
  getSchoolChapterMeta,
} from '@/lib/school';
import { DIAGNOSTIC_DIMENSIONS, QUIZ_QUESTIONS } from '@/lib/physics/data';

describe('校本身份层', () => {
  it('校名与学院名不含硬编码散落（全站唯一出口）', () => {
    expect(SCHOOL.college).toBe('长江大学文理学院');
    expect(SCHOOL.university).toBe('长江大学');
    expect(COURSE.className).toBe('物理学 2601 班');
    expect(COURSE.teacher).toBe('顿老师');
    expect(DEMO.studentName).toBe('陈思远');
  });

  it('品牌全称由学院与系统名组成', () => {
    expect(BRAND_FULL_NAME).toBe('长江大学文理学院 · 大学物理 AI 智慧课堂');
    expect(PLATFORM.systemName).toBe('大学物理 AI 智慧课堂');
  });

  it('校色为天蓝，取代上游默认紫色', () => {
    expect(BRAND_TOKENS.primary).toBe('#0369a1');
    expect(BRAND_TOKENS.primary).not.toBe('#722ed1');
  });

  it('演示账号密码统一且非空', () => {
    expect(DEMO.password.length).toBeGreaterThan(0);
    expect(DEMO.studentUsername).toBe('student');
    expect(DEMO.teacherUsername).toBe('teacher');
  });
});

describe('课程矩阵扩展', () => {
  it('为 18 个章节都提供了校本扩展', () => {
    expect(Object.keys(SCHOOL_CHAPTER_META)).toHaveLength(18);
    Object.values(SCHOOL_CHAPTER_META).forEach((meta) => {
      expect(meta.ideologyKey).toBeTruthy();
      expect(getIdeologyPoint(meta.ideologyKey)).toBeDefined();
      expect(meta.textbookSection).toBeTruthy();
      expect(meta.weeks).toBeTruthy();
    });
  });

  it('超声测距是校内实验项目，并挂在第 8 章', () => {
    const lab = SCHOOL_LABS.find((item) => item.id === 'lab-ultrasonic');
    expect(lab).toBeDefined();
    expect(lab?.virtualLab).toBe('ultrasonic-ranging');
    expect(getLabsForChapter(8).map((item) => item.id)).toContain('lab-ultrasonic');
  });

  it('未核验的条目带 isVerified=false（示例数据）', () => {
    expect(SCHOOL_LABS.every((lab) => lab.isVerified === false)).toBe(true);
    expect(getSchoolChapterMeta(1)?.isVerified).toBe(false);
  });

  it('未知章号返回空实验列表', () => {
    expect(getLabsForChapter(99)).toEqual([]);
    expect(getSchoolChapterMeta(99)).toBeUndefined();
  });
});

describe('课程思政锚点', () => {
  it('每个锚点都有主题、说明与讨论引导', () => {
    expect(IDEOLOGY_POINTS.length).toBeGreaterThan(0);
    IDEOLOGY_POINTS.forEach((point) => {
      expect(point.theme).toBeTruthy();
      expect(point.summary).toBeTruthy();
      expect(point.discussionPrompt).toBeTruthy();
    });
  });

  it('按维度取用的锚点存在', () => {
    expect(getIdeologyPointForDimension('电磁学')).toBeDefined();
    expect(getIdeologyPointForDimension('不存在的维度')).toBeUndefined();
    expect(getIdeologyPoint('rigor')?.theme).toBe('严谨求实');
  });

  it('摘要文本可用于提示词注入', () => {
    expect(buildIdeologyConstraint()).toContain('严谨求实');
  });
});

describe('四阶能力量表', () => {
  it('四个能力阶都有分段锚点且区间连续覆盖 0-100', () => {
    expect(RUBRIC).toHaveLength(4);
    RUBRIC.forEach((dimension) => {
      const sorted = [...dimension.anchors].sort((left, right) => left.min - right.min);
      expect(sorted[0].min).toBe(0);
      expect(sorted[sorted.length - 1].max).toBe(100);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index].min).toBe(sorted[index - 1].max + 1);
      }
    });
  });

  it('describeBand 返回对应分段', () => {
    expect(describeBand('concept', 90)).toBe('扎实');
    expect(describeBand('concept', 60)).toBe('有缺口');
    expect(describeBand('concept', 10)).toBe('需重建');
  });

  it('量表摘要可注入提示词', () => {
    expect(buildRubricSummary()).toContain('知识理解');
  });
});

describe('校内语境与智能体人格', () => {
  it('人格含教师与两名同学，且有行为准则', () => {
    const summary = buildPersonaSummary();
    expect(summary).toContain('AI 助教');
    expect(summary).toContain('同学 A');
    expect(summary).toContain('同学 B');
    expect(summary).toContain('量纲');
  });

  it('校内语境含学校、课程与班级', () => {
    const context = buildCampusContext();
    expect(context).toContain('长江大学文理学院');
    expect(context).toContain('物理学 2601 班');
  });
});

describe('校本课前诊断题集', () => {
  it('恰好 8 题并覆盖全部 7 个知识维度', () => {
    expect(SCHOOL_DIAGNOSIS_QUESTIONS).toHaveLength(8);
    expect(new Set(SCHOOL_DIAGNOSIS_QUESTIONS.map((question) => question.dimension))).toEqual(
      new Set(DIAGNOSTIC_DIMENSIONS),
    );
  });

  it('题目 id 不重复，且每题都有合法选项与唯一正确答案', () => {
    const ids = SCHOOL_DIAGNOSIS_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    SCHOOL_DIAGNOSIS_QUESTIONS.forEach((question) => {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThan(question.options.length);
      expect(question.question.length).toBeGreaterThan(0);
    });
  });

  it('补齐了原始题库缺失的热学与近代物理维度', () => {
    const originalDimensions = new Set(QUIZ_QUESTIONS.map((question) => question.dimension));
    expect(originalDimensions.has('热学')).toBe(false);
    expect(originalDimensions.has('近代物理')).toBe(false);
    expect(SCHOOL_DIAGNOSIS_DIMENSIONS).toContain('热学');
    expect(SCHOOL_DIAGNOSIS_DIMENSIONS).toContain('近代物理');
  });

  it('原始题库保持 8 题不被改写', () => {
    expect(QUIZ_QUESTIONS).toHaveLength(8);
  });
});
