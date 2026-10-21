import { describe, expect, it } from 'vitest';

import {
  buildStudentReportMarkdown,
  buildTeacherBatchReviewMarkdown,
  buildTeacherReviewDetailMarkdown,
} from '@/lib/physics/report';
import { downloadMarkdown } from '@/lib/physics/download';
import { createInitialState } from '@/lib/physics/local-store';
import { summarizeEvaluation } from '@/lib/physics/engine';
import { BRAND_FULL_NAME, COURSE } from '@/lib/school/identity';

describe('buildStudentReportMarkdown', () => {
  it('渲染必备章节与学生姓名', () => {
    const state = createInitialState();
    state.student = {
      name: '陈思远',
      id: 'demo',
      major: '物理学',
      style: 'practice',
      target: 'application',
      className: '物理学 2601 班',
    };
    state.diagnosis = {
      score: 78,
      dimensions: { 力学: 80, 波动: 70, 热学: 75, 电磁学: 78, 光学: 76, 近代物理: 74, 实验: 82 },
      dims: { 力学: 80, 波动: 70, 热学: 75, 电磁学: 78, 光学: 76, 近代物理: 74, 实验: 82 },
      level: '良好',
      answeredCount: 8,
      totalQuestions: 8,
    };
    const summary = summarizeEvaluation({
      diagnosisScore: 78,
      taskProgress: 50,
      labRecords: [],
      chatCount: 3,
    });

    const md = buildStudentReportMarkdown({ state, project: null, summary });

    expect(md).toContain('# 大学物理学习报告 · 陈思远');
    expect(md).toContain('综合得分');
    expect(md).toContain('AI 教学建议');
    expect(md).toContain('知识理解');
    expect(md).toContain('陈思远');
  });

  it('在缺少诊断时仍能生成结构', () => {
    const state = createInitialState();
    const summary = summarizeEvaluation({
      diagnosisScore: undefined,
      taskProgress: 0,
      labRecords: [],
      chatCount: 0,
    });
    const md = buildStudentReportMarkdown({ state, project: null, summary });
    expect(md).toContain('尚未完成 AI 学情诊断');
  });
});

describe('导出报告的校本标识与数据来源声明', () => {
  it('学习报告带校名全称与班级，不出现旧品牌名', () => {
    const state = createInitialState();
    state.student = {
      name: '陈思远',
      id: 'demo',
      major: '物理学',
      style: 'practice',
      target: 'application',
      className: COURSE.className,
    };
    const summary = summarizeEvaluation({
      diagnosisScore: 78,
      taskProgress: 50,
      labRecords: [],
      chatCount: 3,
    });
    const md = buildStudentReportMarkdown({ state, project: null, summary });

    expect(md).toContain(BRAND_FULL_NAME);
    expect(md).toContain(COURSE.className);
    expect(md).not.toContain('大学物理 AI 智慧教学系统');
  });

  it('学习报告标注示例数据来源', () => {
    const state = createInitialState();
    const summary = summarizeEvaluation({
      diagnosisScore: 70,
      taskProgress: 20,
      labRecords: [],
      chatCount: 1,
    });
    const md = buildStudentReportMarkdown({ state, project: null, summary });

    expect(md).toContain('示例数据');
    expect(md).toContain('未连接远程大模型或教务系统');
  });

  it('教师批量复核记录带校名并标注示例数据', () => {
    const md = buildTeacherBatchReviewMarkdown({
      className: COURSE.className,
      selectedNames: ['陈思远'],
      defaultScore: 78,
      defaultReason: '结合 AI 建议与课堂表现',
      reviewer: COURSE.teacher,
    });
    expect(md).toContain(BRAND_FULL_NAME);
    expect(md).toContain('示例数据');
    expect(md).not.toContain('大学物理 AI 智慧教学系统');
  });

  it('教师逐人复核明细带校名并标注 AI 建议分来源', () => {
    const md = buildTeacherReviewDetailMarkdown({
      className: COURSE.className,
      reviewer: COURSE.teacher,
      rows: [{ name: '陈思远', aiScore: 78, finalScore: 82, reason: '课堂表现好' }],
    });
    expect(md).toContain(BRAND_FULL_NAME);
    expect(md).toContain('本地规则引擎');
    expect(md).not.toContain('大学物理 AI 智慧教学系统');
  });
});

describe('buildTeacherBatchReviewMarkdown', () => {
  it('列出批量复核名单与默认分', () => {
    const md = buildTeacherBatchReviewMarkdown({
      className: '物理学 2601 班',
      selectedNames: ['陈思远', '李同学', '王同学'],
      defaultScore: 78,
      defaultReason: '结合 AI 建议与课堂表现',
      reviewer: '顿老师',
    });
    expect(md).toContain('# 教师批量复核记录');
    expect(md).toContain('陈思远');
    expect(md).toContain('王同学');
    expect(md).toContain('78');
  });
});

describe('downloadMarkdown', () => {
  it('在浏览器外调用是 no-op', () => {
    expect(() => downloadMarkdown('x.md', 'hello')).not.toThrow();
  });
});
