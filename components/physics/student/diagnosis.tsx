'use client';

/**
 * 学生端 · 学情诊断。
 *
 * 8 题 / 7 个知识维度。诊断结果驱动后续的项目匹配与 AI 课堂讲解深度。
 * 重新诊断属于破坏性动作，需要二次确认并可撤销。
 */

import * as React from 'react';
import { ClipboardCheck, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { usePhysicsState } from '@/components/physics/state-provider';
import { DimensionBars, HintBar, MetricTile, PageHeader, SectionCard } from '@/components/physics/shared';
import { SCHOOL_DIAGNOSIS_DIMENSIONS, SCHOOL_DIAGNOSIS_QUESTIONS } from '@/lib/school';
import { scoreDiagnosis } from '@/lib/physics/engine';
import type { DiagnosticDimension } from '@/lib/physics/types';

export function StudentDiagnosis() {
  const { state, update, resetDiagnosis } = usePhysicsState();
  const [answers, setAnswers] = React.useState<Record<string, number>>({});
  const [result, setResult] = React.useState(state.diagnosis ?? null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const answered = Object.keys(answers).length;
  const total = SCHOOL_DIAGNOSIS_QUESTIONS.length;

  const submit = () => {
    const next = scoreDiagnosis(answers, SCHOOL_DIAGNOSIS_QUESTIONS);
    setResult(next);
    update({ diagnosis: next });
  };

  const resetDiagnosisResult = () => {
    setAnswers({});
    setResult(null);
    // 只清空诊断结果本身，项目进度、实验记录与学习画像都会保留。
    resetDiagnosis('重新进行学情诊断');
  };

  // 只展示本次题集真正考查到的维度，避免把"未考查"显示成"得 0 分"。
  const coveredDimensions = React.useMemo(
    () =>
      SCHOOL_DIAGNOSIS_DIMENSIONS.reduce<Partial<Record<DiagnosticDimension, number>>>(
        (accumulator, dimension) => {
          const score = result?.dimensions[dimension];
          if (score !== undefined) accumulator[dimension] = score;
          return accumulator;
        },
        {},
      ),
    [result],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="学情诊断"
        description="8 道题覆盖 7 个知识维度，用于定位薄弱点并驱动项目匹配。诊断结果只用于学习建议，不作为成绩。"
        actions={
          state.diagnosis ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              <RotateCcw className="size-3.5" />
              重新诊断
            </Button>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard title="课前诊断" description={`已作答 ${answered} / ${total}`}>
          <ol className="flex flex-col gap-5">
            {SCHOOL_DIAGNOSIS_QUESTIONS.map((question, index) => {
              const selected = answers[question.id];
              return (
                <li key={question.id}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium leading-relaxed">
                        {question.question}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        知识维度 · {question.dimension}
                      </p>
                      <div
                        className="mt-2.5 flex flex-col gap-1.5"
                        role="radiogroup"
                        aria-label={question.question}
                      >
                        {question.options.map((option, optionIndex) => {
                          const active = selected === optionIndex;
                          return (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() =>
                                setAnswers((previous) => ({
                                  ...previous,
                                  [question.id]: optionIndex,
                                }))
                              }
                              className={
                                active
                                  ? 'rounded-md border border-primary bg-[var(--school-primary-softer)] px-3 py-2 text-left text-[13px] transition-colors dark:bg-primary/10'
                                  : 'rounded-md border border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground'
                              }
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={answered === 0}>
              <ClipboardCheck className="size-4" />
              {result ? '重新计算' : '提交诊断'}
            </Button>
            <span className="text-[12px] text-muted-foreground">
              {answered === total ? '已作答全部题目' : `还有 ${total - answered} 题未作答，未答题按错误计`}
            </span>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-5">
          <SectionCard title="诊断结果">
            {result ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="总分" value={result.score} unit="/100" />
                  <MetricTile
                    label="等级"
                    value={result.level}
                    tone={result.score >= 85 ? 'success' : result.score >= 60 ? 'warning' : 'danger'}
                  />
                </div>
                <DimensionBars dimensions={coveredDimensions} />
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(coveredDimensions) as DiagnosticDimension[]).map((dimension) => {
                    const score = coveredDimensions[dimension] ?? 0;
                    return (
                      <Badge
                        key={dimension}
                        variant={score >= 80 ? 'default' : score >= 60 ? 'secondary' : 'destructive'}
                        className="font-normal"
                      >
                        {dimension} {score}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                完成题目后提交，这里会显示各维度得分与等级。
              </p>
            )}
          </SectionCard>

          <HintBar>
            诊断只用于生成学习建议。AI 助教给出的分数是<strong>建议分</strong>，
            任课教师复核后的结果始终优先。
          </HintBar>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新进行学情诊断？</AlertDialogTitle>
            <AlertDialogDescription>
              重新诊断只会清除当前诊断结果，任务进度、实验记录与学习画像都会保留。操作前会自动生成 24 小时可恢复快照，
              你可以在工作台顶部横幅中一键撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={resetDiagnosisResult}>确认重置</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
