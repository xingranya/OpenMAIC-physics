'use client';

/**
 * 学生端 · 项目匹配。
 *
 * 匹配结果来自移植的规则引擎（诊断维度 + 学习方式 + 能力目标），
 * 每个项目附带可读的匹配理由。切换项目属于破坏性动作，需二次确认。
 */

import * as React from 'react';
import { Library, Sparkles, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
import { usePhysicsState } from '@/components/physics/state-provider';
import { EmptyState, HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { LEARNING_STYLE_LABELS, LEARNING_TARGET_LABELS } from '@/lib/physics/data';
import { matchProjects } from '@/lib/physics/engine';
import { getProjectById } from '@/lib/physics/data';
import Link from 'next/link';

export function StudentProjects() {
  const { state, update, reset } = usePhysicsState();
  const [pending, setPending] = React.useState<{ id: string; title: string } | null>(null);

  const student = state.student ?? {
    name: '陈思远',
    id: 'demo',
    major: '物理学',
    className: '物理学 2601 班',
    style: 'practice' as const,
    target: 'application' as const,
  };

  const matches = React.useMemo(
    () => matchProjects(state.diagnosis, student, undefined),
    [state.diagnosis, student],
  );

  const current = getProjectById(state.projectId);
  const featured = matches[0];

  const confirmSwitch = () => {
    if (!pending) return;
    reset(`切换项目到「${pending.title}」`);
    update({ projectId: pending.id });
    setPending(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="项目匹配"
        description="按学情诊断结果、学习方式与能力目标匹配项目案例。匹配分与理由全部可解释，不存在黑箱推荐。"
        actions={
          current ? (
            <Badge variant="secondary" className="font-normal">
              当前项目：{current.title}
            </Badge>
          ) : null
        }
      />

      {!state.diagnosis ? (
        <EmptyState
          title="还没有学情画像"
          description="先完成学情诊断，匹配引擎才能给出个性化项目与理由。诊断只需 8 题。"
          action={
            <Button asChild>
              <Link href="/physics/diagnosis">去做诊断</Link>
            </Button>
          }
        />
      ) : null}

      {featured ? (
        <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-[var(--school-primary-softer)] to-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="font-normal">
              <Sparkles className="size-3" aria-hidden="true" />
              推荐项目
            </Badge>
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              匹配度 {featured.score}
            </span>
          </div>
          <h2 className="mt-2 text-[19px] font-semibold tracking-tight">{featured.project.title}</h2>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            {featured.project.intro}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-normal">
              难度 {featured.project.level}
            </Badge>
            {featured.project.dims.map((dim) => (
              <Badge key={dim} variant="secondary" className="font-normal">
                {dim}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-[12.5px]">
            <span className="text-muted-foreground">能力路径：</span>
            {featured.project.ability}
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {featured.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                <Target className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                {reason}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button
              onClick={() => setPending({ id: featured.project.id, title: featured.project.title })}
              disabled={state.projectId === featured.project.id}
            >
              <Library className="size-4" />
              {state.projectId === featured.project.id ? '已选择该项目' : '选择该项目'}
            </Button>
          </div>
        </section>
      ) : null}

      <SectionCard title="项目案例库" description="按匹配度由高到低排列">
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li
              key={match.project.id}
              className="rounded-lg border border-border/70 p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{match.project.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {match.project.intro}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[15px] font-semibold tabular-nums text-primary">
                    {match.score}
                  </span>
                  <Button
                    size="sm"
                    variant={state.projectId === match.project.id ? 'ghost' : 'outline'}
                    disabled={state.projectId === match.project.id}
                    onClick={() =>
                      setPending({ id: match.project.id, title: match.project.title })
                    }
                  >
                    {state.projectId === match.project.id ? '已选' : '选择'}
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-normal">
                  {match.project.level}
                </Badge>
                {match.project.dims.map((dim) => (
                  <Badge key={dim} variant="secondary" className="font-normal">
                    {dim}
                  </Badge>
                ))}
                {match.reasons.map((reason) => (
                  <span key={reason} className="text-[11px] text-muted-foreground">
                    · {reason}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <HintBar>
        学习方式「{LEARNING_STYLE_LABELS[student.style]}」· 能力目标「
        {LEARNING_TARGET_LABELS[student.target]}」——这两项来自学情画像，直接影响匹配排序。
      </HintBar>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换到「{pending?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              切换项目会清空当前的任务进度与实验记录。操作前会自动生成 24 小时可恢复快照，
              可在工作台顶部横幅中撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>确认切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
