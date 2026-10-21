'use client';

/**
 * 教师端 · 评价复核。
 *
 * 核心原则：AI 只产出建议分与理由，教师的复核结果始终覆盖之。
 * 复核记录写入本地状态，并在学习报告中体现为最终分。
 */

import * as React from 'react';
import { CheckCircle2, ClipboardCheck, Download, Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, RiskBadge, SectionCard } from '@/components/physics/shared';
import { DEMO_STUDENTS } from '@/lib/physics/data';
import { summarizeEvaluation } from '@/lib/physics/engine';
import { buildTeacherReviewDetailMarkdown } from '@/lib/physics/report';
import { downloadMarkdown } from '@/lib/physics/download';
import { describeBand, RUBRIC } from '@/lib/school';
import { COURSE, SCHOOL } from '@/lib/school';

const FILTERS = ['全部', '优秀', '正常', '关注', '高风险'] as const;

export function TeacherEvaluation() {
  const { state, update } = usePhysicsState();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('全部');
  const [active, setActive] = React.useState<string | null>(null);
  const [score, setScore] = React.useState(70);
  const [reason, setReason] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  const students = DEMO_STUDENTS.filter((student) => filter === '全部' || student.risk === filter);
  const current = DEMO_STUDENTS.find((student) => student.name === active) ?? null;

  // AI 建议分：由规则引擎基于诊断分、进度与实验记录生成（仅作参考）。
  const aiSuggestion = current
    ? summarizeEvaluation({
        diagnosisScore: current.score,
        taskProgress: current.progress,
        labRecords: [],
        chatCount: 0,
      })
    : null;

  React.useEffect(() => {
    if (!current) return;
    const existing = state.evaluationReviews[current.name];
    setScore(existing?.score ?? aiSuggestion?.final ?? current.score);
    setReason(existing?.reason ?? '');
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const save = () => {
    if (!current) return;
    update({
      evaluationReviews: {
        ...state.evaluationReviews,
        [current.name]: {
          score,
          reason: reason.trim(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
    setSaved(true);
  };

  const exportReviews = () => {
    const markdown = buildTeacherReviewDetailMarkdown({
      className: COURSE.className,
      reviewer: COURSE.teacher,
      rows: DEMO_STUDENTS.map((student) => {
        const suggestion = summarizeEvaluation({
          diagnosisScore: student.score,
          taskProgress: student.progress,
          labRecords: [],
          chatCount: 0,
        });
        const review = state.evaluationReviews[student.name];
        return {
          name: student.name,
          aiScore: suggestion.final,
          finalScore: review?.score,
          reason: review?.reason,
          weakDimension: student.weakDimension,
          project: student.project,
          progress: student.progress,
          risk: student.risk,
        };
      }),
      generatedAt: new Date(),
    });
    downloadMarkdown(`教学评价复核-${SCHOOL.collegeShort}.md`, markdown);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="评价复核"
        description="AI 给出建议分与理由，最终分由你决定并覆盖建议值。复核结果会写回学习报告。"
        actions={
          <Button variant="outline" size="sm" onClick={exportReviews}>
            <Download className="size-3.5" />
            导出复核汇总
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按风险筛选">
        <Filter className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            aria-pressed={filter === item}
            className={
              filter === item
                ? 'rounded-full border border-primary bg-primary px-2.5 py-1 text-[11.5px] text-primary-foreground'
                : 'rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50'
            }
          >
            {item}
          </button>
        ))}
      </div>

      <SectionCard title="学生卡片" description="点击卡片进入复核">
        <ul className="grid gap-3 sm:grid-cols-2">
          {students.map((student) => {
            const review = state.evaluationReviews[student.name];
            const suggestion = summarizeEvaluation({
              diagnosisScore: student.score,
              taskProgress: student.progress,
              labRecords: [],
              chatCount: 0,
            });
            return (
              <li key={student.name}>
                <button
                  type="button"
                  onClick={() => setActive(student.name)}
                  className="flex h-full w-full flex-col gap-2 rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/50 hover:bg-[var(--school-primary-softer)] dark:hover:bg-primary/10"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium">{student.name}</span>
                    <RiskBadge risk={student.risk} />
                    {review ? (
                      <Badge variant="outline" className="font-normal">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        已复核
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    薄弱维度 {student.weakDimension} · 项目「{student.project}」· 进度{' '}
                    {student.progress}%
                  </span>
                  <span className="mt-auto flex items-baseline gap-3 border-t border-border/60 pt-2">
                    <span>
                      <span className="block text-[10.5px] text-muted-foreground">AI 建议</span>
                      <span className="text-[15px] font-semibold tabular-nums text-muted-foreground">
                        {suggestion.final}
                      </span>
                    </span>
                    <span>
                      <span className="block text-[10.5px] text-muted-foreground">复核最终分</span>
                      <span className="text-[17px] font-semibold tabular-nums text-primary">
                        {review ? review.score : '—'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <HintBar>
        AI 建议分由<strong>本地规则引擎</strong>生成（不是真实模型推理日志）；
        教师复核后的分数始终覆盖建议分，学习报告中以复核分为准。
      </HintBar>

      <Dialog open={current !== null} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>复核 {current?.name}</DialogTitle>
            <DialogDescription>
              拖动滑块确定最终分并填写理由。理由会随学习报告一起导出，供学生看到改进方向。
            </DialogDescription>
          </DialogHeader>

          {current && aiSuggestion ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border/70 px-3 py-2">
                  <p className="text-[10.5px] text-muted-foreground">AI 建议分</p>
                  <p className="text-[20px] font-semibold tabular-nums text-muted-foreground">
                    {aiSuggestion.final}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 px-3 py-2">
                  <p className="text-[10.5px] text-muted-foreground">诊断分</p>
                  <p className="text-[20px] font-semibold tabular-nums">{current.score}</p>
                </div>
                <div className="rounded-lg border border-primary/40 bg-[var(--school-primary-softer)] px-3 py-2 dark:bg-primary/10">
                  <p className="text-[10.5px] text-muted-foreground">复核最终分</p>
                  <p className="text-[20px] font-semibold tabular-nums text-primary">{score}</p>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label htmlFor="review-score" className="text-[12px] font-medium">
                    最终分
                  </label>
                  <span className="text-[11.5px] text-muted-foreground">
                    {RUBRIC.map((dimension) => {
                      const band = describeBand(dimension.target, score);
                      return band ? `${dimension.label}：${band}` : null;
                    })
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <Slider
                  id="review-score"
                  value={[score]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(next) => {
                    setScore(next[0] ?? score);
                    setSaved(false);
                  }}
                  aria-label="复核最终分"
                />
              </div>

              <div>
                <label htmlFor="review-reason" className="mb-1.5 block text-[12px] font-medium">
                  复核理由
                </label>
                <Textarea
                  id="review-reason"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setSaved(false);
                  }}
                  rows={4}
                  placeholder="例如：诊断中电磁学概念混淆明显，但实验操作认真、误差分析到位，综合上调。"
                />
              </div>

              <p className="text-[11.5px] text-muted-foreground">
                建议理由（规则引擎生成，仅供参考）：{aiSuggestion.grade} · 最强{' '}
                {aiSuggestion.strongestDimension} · 最弱 {aiSuggestion.weakestDimension}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              关闭
            </Button>
            <Button onClick={save}>
              <ClipboardCheck className="size-4" />
              {saved ? '已保存' : '保存复核'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
