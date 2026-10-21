'use client';

/**
 * 学生端 · 学习总览。
 *
 * 一次只呈现一个主任务（当前最该做的一步）+ 一个次任务（最近一次行动），
 * 避免学生同时面对过多决策点。
 */

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ClipboardCheck,
  FileBarChart,
  FlaskConical,
  Library,
  ListChecks,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePhysicsState } from '@/components/physics/state-provider';
import {
  DimensionBars,
  HintBar,
  MetricTile,
  ProgressRow,
  SectionCard,
} from '@/components/physics/shared';
import { calculateTaskProgress, summarizeEvaluation } from '@/lib/physics/engine';
import { TASK_TEMPLATES } from '@/lib/physics/data';
import { COURSE, DEMO, SCHOOL } from '@/lib/school';
import { routeFor } from '@/lib/physics/shortcuts';

const LEARNING_PATH = [
  { key: 'diagnosis', label: '学情诊断', hint: '8 题定位薄弱维度', view: 'diagnosis' as const },
  { key: 'projects', label: '项目匹配', hint: '按画像推荐项目', view: 'projects' as const },
  { key: 'tasks', label: '任务闯关', hint: '五阶递进闯关', view: 'tasks' as const },
  { key: 'lab', label: '虚拟实验', hint: '超声测距实测', view: 'lab' as const },
  { key: 'report', label: '学习报告', hint: '过程证据汇总', view: 'report' as const },
];

export function StudentOverview() {
  const { state } = usePhysicsState();
  const diagnosis = state.diagnosis;
  const progress = calculateTaskProgress(state.taskChecks, TASK_TEMPLATES);
  const evaluation =
    state.evaluation ??
    summarizeEvaluation({
      diagnosisScore: diagnosis?.score,
      taskProgress: progress.percentage,
      labRecords: state.labRecords,
      chatCount: state.chat.length,
    });

  const currentStep = diagnosis
    ? state.projectId
      ? progress.completed < progress.total
        ? 'tasks'
        : 'report'
      : 'projects'
    : 'diagnosis';

  const nextStep = LEARNING_PATH.find((step) => step.key === currentStep) ?? LEARNING_PATH[0];
  const lastLab = state.labRecords.at(-1);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Hero */}
      <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-[var(--school-primary-softer)] to-card p-6 dark:from-primary/10">
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {SCHOOL.collegeShort} · {COURSE.className} · {COURSE.name}
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">
          {DEMO.studentName}，今天从
          <span className="mx-1 text-primary">{nextStep.label}</span>
          开始
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {nextStep.hint}。平台记录的是过程证据而不是最终分数——每一步留下的记录都会汇总进学习报告，
          供你与任课教师共同复核。
        </p>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            学习路径
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {LEARNING_PATH.map((step, index) => {
              const done =
                (step.key === 'diagnosis' && Boolean(diagnosis)) ||
                (step.key === 'projects' && Boolean(state.projectId)) ||
                (step.key === 'tasks' && progress.completed > 0) ||
                (step.key === 'lab' && state.labRecords.length > 0) ||
                (step.key === 'report' && state.labRecords.length > 0 && progress.completed > 0);
              const active = step.key === currentStep;
              return (
                <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={
                      active
                        ? 'grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground'
                        : done
                          ? 'grid size-6 shrink-0 place-items-center rounded-full bg-[var(--school-success)] text-[11px] font-semibold text-white'
                          : 'grid size-6 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground'
                    }
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={
                        active
                          ? 'block truncate text-[12.5px] font-medium text-foreground'
                          : 'block truncate text-[12.5px] text-muted-foreground'
                      }
                    >
                      {step.label}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {step.hint}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link href={routeFor('student', nextStep.view)}>
              {nextStep.label}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <Sparkles className="size-4" />
              AI 智能课堂
            </Link>
          </Button>
        </div>
      </section>

      {/* 指标 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="学习指标">
        <MetricTile
          label="诊断总分"
          value={diagnosis ? diagnosis.score : '—'}
          unit={diagnosis ? '/100' : undefined}
          hint={diagnosis ? diagnosis.level : '尚未诊断'}
        />
        <MetricTile
          label="任务完成"
          value={progress.completed}
          unit={`/ ${progress.total}`}
          hint={`${progress.percentage}%`}
          tone={progress.percentage >= 80 ? 'success' : 'default'}
        />
        <MetricTile
          label="实验记录"
          value={state.labRecords.length}
          unit="次"
          hint={lastLab ? `最近误差 ${lastLab.errorPercent.toFixed(1)}%` : '尚无记录'}
        />
        <MetricTile
          label="综合评定"
          value={evaluation.final}
          unit="/100"
          hint={evaluation.grade}
          tone={evaluation.final >= 85 ? 'success' : evaluation.final >= 60 ? 'warning' : 'danger'}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="知识维度" description="来自最近一次学情诊断">
          <DimensionBars dimensions={diagnosis?.dimensions ?? {}} />
        </SectionCard>

        <SectionCard title="任务进度" description="五阶闯关的完成情况">
          <div className="flex flex-col gap-2.5">
            {TASK_TEMPLATES.map((template, index) => {
              const done = template.checks.filter(
                (_, checkIndex) => state.taskChecks[`${index}-${checkIndex}`],
              ).length;
              return (
                <ProgressRow
                  key={template.id}
                  label={template.name.replace(/^第.关：/, '')}
                  value={done}
                  max={template.checks.length}
                />
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={routeFor('student', 'tasks')}>
                <ListChecks className="size-3.5" />
                继续闯关
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={routeFor('student', 'diagnosis')}>
                <ClipboardCheck className="size-3.5" />
                重新诊断
              </Link>
            </Button>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="快捷入口">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: '项目匹配', hint: '按画像推荐案例', icon: Library, view: 'projects' as const },
            { label: '虚拟实验', hint: '超声测距实测', icon: FlaskConical, view: 'lab' as const },
            {
              label: '学习报告',
              hint: '导出 Markdown / PDF',
              icon: FileBarChart,
              view: 'report' as const,
            },
            {
              label: 'AI 助教',
              hint: '随时追问知识点',
              icon: Sparkles,
              view: 'assistant' as const,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.view} href={routeFor('student', item.view)}>
                <div className="h-full rounded-lg border border-border/70 p-3 transition-colors hover:border-primary/50 hover:bg-[var(--school-primary-softer)] dark:hover:bg-primary/10">
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  <p className="mt-2 text-[13px] font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </SectionCard>

      <HintBar>
        本平台的班级画像、成绩与评价量表为<strong>课程示例数据</strong>，非真实教务数据； AI
        建议分由本地规则引擎生成，教师复核结果始终优先于建议分。
      </HintBar>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">四阶能力量表</Badge>
        <Badge variant="outline">破坏性动作可撤销</Badge>
        <Badge variant="outline">本地优先 · 可离线</Badge>
      </div>
    </div>
  );
}
