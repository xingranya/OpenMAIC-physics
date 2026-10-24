'use client';

/**
 * 学生端 · 学习报告。
 *
 * 报告汇总的是过程证据（诊断、闯关、实验、提问），而不是单一分数。
 * 支持导出 Markdown / JSON 与浏览器打印（另存 PDF），导出内容带学校页眉。
 */

import * as React from 'react';
import { Download, FileJson, Printer } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import {
  DimensionBars,
  HintBar,
  MetricTile,
  PageHeader,
  ProgressRow,
  SectionCard,
} from '@/components/physics/shared';
import { getProjectById, TASK_TEMPLATES } from '@/lib/physics/data';
import { calculateTaskProgress, summarizeEvaluation, toJson } from '@/lib/physics/engine';
import { buildStudentReportMarkdown } from '@/lib/physics/report';
import { downloadMarkdown } from '@/lib/physics/download';
import { BRAND_FULL_NAME, COURSE, SCHOOL } from '@/lib/school';

export function StudentReport() {
  const { state, update } = usePhysicsState();
  const progress = calculateTaskProgress(state.taskChecks, TASK_TEMPLATES);
  const summary =
    state.evaluation ??
    summarizeEvaluation({
      diagnosisScore: state.diagnosis?.score,
      taskProgress: progress.percentage,
      labRecords: state.labRecords,
      chatCount: state.chat.length,
    });
  const project = getProjectById(state.projectId);

  // 报告以"生成即固化"的方式落到状态里，后续教师复核以该结果为基准。
  const freeze = () => {
    update({ evaluation: summary });
  };

  const downloadMd = () => {
    const markdown = buildStudentReportMarkdown({
      state,
      project,
      summary,
      generatedAt: new Date(),
    });
    downloadMarkdown(`大学物理学习报告-${SCHOOL.collegeShort}.md`, markdown);
  };

  const downloadJson = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      school: SCHOOL.college,
      course: COURSE.name,
      className: COURSE.className,
      student: state.student ?? null,
      diagnosis: state.diagnosis ?? null,
      project: project ?? null,
      taskProgress: progress,
      labRecords: state.labRecords,
      evaluation: summary,
      notes: state.taskTexts,
    };
    const blob = new Blob([toJson(payload)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `大学物理学习报告-${SCHOOL.collegeShort}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {/* 打印页眉（仅打印时可见） */}
      <div className="physics-print-header">
        <img src={SCHOOL.emblemMarkSrc} alt="" width={62} height={60} className="size-6 shrink-0 object-contain" />
        <div>
          <p className="text-[13px] font-semibold">{BRAND_FULL_NAME}</p>
          <p className="text-[11px] text-muted-foreground">
            {COURSE.className} · {COURSE.teacher} · {new Date().toLocaleDateString('zh-CN')}
          </p>
        </div>
      </div>

      <PageHeader
        title="学习报告"
        description="报告汇总你的过程证据：诊断结果、闯关记录、实验数据与提问。AI 建议分只是其中一环，教师复核结果始终优先。"
        actions={
          <>
            <Button
              onClick={downloadMd}
              disabled={!state.diagnosis && state.labRecords.length === 0}
            >
              <Download className="size-4" />
              下载 Markdown
            </Button>
            <Button variant="outline" onClick={downloadJson}>
              <FileJson className="size-4" />
              下载 JSON
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" />
              打印 / 另存 PDF
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="综合评定"
          value={summary.final}
          unit="/100"
          hint={summary.grade}
          tone={summary.final >= 85 ? 'success' : summary.final >= 60 ? 'warning' : 'danger'}
        />
        <MetricTile label="任务完成" value={progress.percentage} unit="%" />
        <MetricTile label="实验记录" value={state.labRecords.length} unit="次" />
        <MetricTile
          label="提问次数"
          value={state.chat.filter((m) => m.role === 'user').length}
          unit="次"
        />
      </div>

      <SectionCard
        title="四阶能力"
        description="按校本量表评定（知识理解 / 专业应用 / 创新实践 / 协同创生）"
      >
        <div className="flex flex-col gap-2.5">
          <ProgressRow label="知识理解" value={summary.knowledge} />
          <ProgressRow label="专业应用" value={summary.application} />
          <ProgressRow label="创新实践" value={summary.innovation} />
          <ProgressRow label="协同创生" value={summary.collaboration} />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="font-normal">
            最强 {summary.strongestDimension}
          </Badge>
          <Badge variant="outline" className="font-normal">
            最弱 {summary.weakestDimension}
          </Badge>
        </div>
      </SectionCard>

      <SectionCard title="知识维度" description="来自最近一次学情诊断">
        <DimensionBars dimensions={state.diagnosis?.dimensions ?? {}} />
      </SectionCard>

      <SectionCard title="过程证据" description="每一条都是可复核的过程记录">
        <ul className="flex flex-col gap-2 text-[12.5px]">
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2">
            <span>学情诊断</span>
            <span className="text-muted-foreground">
              {state.diagnosis
                ? `${state.diagnosis.score} 分 · ${state.diagnosis.level}`
                : '未完成'}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2">
            <span>项目匹配</span>
            <span className="text-muted-foreground">{project ? project.title : '未选择'}</span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2">
            <span>五阶任务</span>
            <span className="text-muted-foreground">
              {progress.completed} / {progress.total} 项检查
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2">
            <span>虚拟实验</span>
            <span className="text-muted-foreground">
              {state.labRecords.length
                ? `${state.labRecords.length} 组数据，最近误差 ${(
                    state.labRecords.at(-1)?.errorPercent ?? 0
                  ).toFixed(2)}%`
                : '无记录'}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2">
            <span>闯关笔记</span>
            <span className="text-muted-foreground">
              {Object.values(state.taskTexts).filter((text) => text.trim().length > 0).length} /{' '}
              {TASK_TEMPLATES.length} 关
            </span>
          </li>
        </ul>
      </SectionCard>

      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" onClick={freeze}>
          固化当前评定结果
        </Button>
        <Button variant="ghost" onClick={() => window.print()}>
          <Printer className="size-4" />
          打印
        </Button>
      </div>

      <HintBar>
        报告中的评定由本地规则引擎生成，供教师复核时参考；教师复核后的结果会覆盖它。
        班级数据与评价量表为课程示例数据，非真实教务数据。
      </HintBar>
    </div>
  );
}
