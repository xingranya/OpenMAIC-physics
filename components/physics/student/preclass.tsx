'use client';

/**
 * 学生端 · 课前：诊断 → 分层 → 梯度配对 → 分组。
 *
 * 对应申请书「五环」里的**诊—配**两环，是「三诊」的第一诊。
 *
 * ## 这一页为什么不是「诊断结果的另一种展示」
 *
 * 诊断页回答「我多少分」，这一页回答「所以我现在该做什么」。两者的区别
 * 全在**可执行**三个字上：层级要说清依据，案例要能一键采用，分组与分工
 * 要具体到「你在组里负责什么」。只显示一个「应用提升型」的标签，
 * 等于把分层的判断成本推回给学生。
 *
 * ## 提交之后发生什么
 *
 * 方案提交进共享提交键，教师端「三诊审核」里立刻能看到；教师通过或调整后，
 * 这里会显示审核意见（`useSharedReviewSync` 负责把结果并回来）。
 * 学生再点「认可 / 有疑问」，三步闭环才真正走完。
 */

import * as React from 'react';
import { ArrowRight, Sparkles, Users } from 'lucide-react';

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
import { usePhysicsView } from '@/components/physics/view-context';
import { useSharedReviewSync } from '@/components/physics/use-shared-review-sync';
import {
  AckBar,
  EmptyState,
  HintBar,
  PageHeader,
  ReviewBadge,
  ReviewNote,
  SectionCard,
  StageLoop,
  formatDateTime,
} from '@/components/physics/shared';
import { PROJECTS } from '@/lib/physics/data';
import { EXERCISE_LEVEL_OF_TIER, exerciseReason, recommendExercises } from '@/lib/physics/exercise-bank';
import { buildEvidence, publishEvidence, publishPreClass, ackStage } from '@/lib/physics/submissions';
import {
  TIER_LABELS,
  TIER_PROJECT_LEVEL,
  TIER_RULES,
  buildPreClassPlan,
  tierFromDiagnosis,
  tierReason,
  weakDimensionsOf,
} from '@/lib/physics/stages';
import type { AbilityTier, Project } from '@/lib/physics/types';

const TIER_ORDER: readonly AbilityTier[] = ['basic', 'applied', 'challenge'];

export function StudentPreClass() {
  const { state, update, session, resetProject } = usePhysicsState();
  const { setView } = usePhysicsView();
  useSharedReviewSync();

  const [pendingProject, setPendingProject] = React.useState<Project | null>(null);

  const diagnosis = state.diagnosis;
  const plan = state.preClass ?? null;
  const tier = tierFromDiagnosis(diagnosis);

  const projects = React.useMemo(
    () => [...PROJECTS, ...state.localProjects],
    [state.localProjects],
  );

  const studentId = session?.userId ?? state.student?.id ?? 'demo-student';
  const studentName = state.student?.name ?? session?.displayName ?? '演示学生';

  /** 生成（或重新生成）课前方案，并提交给教师。 */
  const generate = () => {
    const next = buildPreClassPlan({
      diagnosis,
      student: state.student,
      projects,
      // 用学生 id 做种子：同一个人每次生成的分组必须一致，
      // 否则刷新一次就换一个组，教师那边的名单也跟着变。
      seed: studentId,
    });
    update({ preClass: next });
    publishPreClass({ studentId, studentName, plan: next });
    // 分工刚生成，证据快照里的「组内分工」这一格要跟着变成已具备。
    publishEvidence({
      studentId,
      studentName,
      evidence: buildEvidence({ ...state, preClass: next }),
    });
  };

  const acknowledge = (accepted: boolean, note: string) => {
    if (!plan) return;
    const ack = { accepted, note: note || undefined, at: new Date().toISOString() };
    update({ preClass: { ...plan, ack } });
    ackStage({ studentId, stage: 'preclass', ack });
  };

  const reviewed = plan ? plan.review.status !== 'pending' : false;
  const stale = plan !== null && diagnosis !== undefined && plan.tier !== tier;

  // 练习只有 18 道，现算即可——为它加 useMemo 反而要处理数组身份变化。
  const exercises = recommendExercises({
    tier,
    weakDimensions: plan?.weakDimensions ?? (diagnosis ? weakDimensionsOf(diagnosis) : []),
    limit: 3,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="课前：诊断与精准配对"
        description="诊断结果先定层级，再从梯度案例库里配同档案例，最后落到小组分工。AI 给出的每一项都可以被教师改，也可以由你提出疑问。"
        actions={
          <Button onClick={generate} disabled={!diagnosis}>
            <Sparkles className="size-4" />
            {plan ? '重新生成方案' : '生成课前方案'}
          </Button>
        }
      />

      {!diagnosis ? (
        <EmptyState
          title="还没有学情诊断结果"
          description="课前分层要用诊断分与各维度得分。先花 3 分钟做完 8 道诊断题，这一页才会给出层级与配对结果。"
          action={
            <Button onClick={() => setView('diagnosis')}>
              去完成学情诊断
              <ArrowRight className="size-4" />
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
          <div className="flex flex-col gap-5">
            <SectionCard
              title="学情分层"
              description="总分与薄弱维度个数共同决定层级：总分够但三个以上维度偏低，仍然先补基础。"
              action={
                <Badge variant={tier === 'challenge' ? 'default' : 'secondary'} className="font-normal">
                  {TIER_LABELS[tier]}
                </Badge>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {tierReason(diagnosis)}
                </p>

                <ul className="flex flex-col gap-2">
                  {TIER_ORDER.map((item) => {
                    const active = item === tier;
                    return (
                      <li
                        key={item}
                        className={
                          active
                            ? 'rounded-lg border border-primary/50 bg-[var(--school-primary-softer)] px-3 py-2.5 dark:bg-primary/10'
                            : 'rounded-lg border border-border/70 px-3 py-2.5'
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium">{TIER_LABELS[item]}</span>
                          <Badge variant="outline" className="font-normal">
                            对应{TIER_PROJECT_LEVEL[item]}层案例
                          </Badge>
                          {active ? (
                            <span className="text-[11px] text-primary">你当前在这一层</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          {TIER_RULES[item]}
                        </p>
                      </li>
                    );
                  })}
                </ul>

                {plan ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 px-3 py-2.5">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-[13px] font-medium">{plan.groupId}</span>
                    <span className="text-[12px] text-muted-foreground">
                      组内分工：{plan.groupRole}
                    </span>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    点右上角「生成课前方案」，会同时算出分组与组内分工。
                  </p>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="梯度案例配对"
              description="先按薄弱维度、学习方式与能力目标排序，再只保留与当前层级同档的案例。"
            >
              {plan ? (
                <ul className="flex flex-col gap-3">
                  {plan.matches.map((match) => {
                    const selected = state.projectId === match.project.id;
                    return (
                      <li
                        key={match.project.id}
                        className="rounded-lg border border-border/70 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                              {match.project.title}
                              <Badge variant="outline" className="font-normal">
                                {match.project.level}
                              </Badge>
                              {selected ? (
                                <Badge className="font-normal" variant="secondary">
                                  已采用
                                </Badge>
                              ) : null}
                            </p>
                            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                              {match.project.intro}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={selected ? 'ghost' : 'outline'}
                            disabled={selected}
                            onClick={() => setPendingProject(match.project)}
                          >
                            {selected ? '已选' : '采用'}
                          </Button>
                        </div>
                        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                          {match.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>· {reason}</li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  生成方案后，这里会列出与你的层级匹配的案例与匹配理由。
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="分层练习"
              description={`当前层级对应的认知动作是「${EXERCISE_LEVEL_OF_TIER[tier]}」。练习与项目分开：项目是几周的综合任务，练习是当天就能做完的一次训练。`}
            >
              <ol className="flex flex-col gap-3">
                {exercises.map((exercise) => (
                  <li key={exercise.id} className="rounded-lg border border-border/70 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-normal">
                        {exercise.level}
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        {exercise.dimension}
                      </Badge>
                      <span className="text-[11.5px] text-muted-foreground">{exercise.anchor}</span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed">{exercise.task}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      自查：{exercise.selfCheck.join('；')}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {exerciseReason(exercise, tier)}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                三道题按「同层级 → 薄弱维度 → 题库原序」挑，不按匹配分排序——
                练习要可预测，学生才知道今天做完这几道就够。
              </p>
            </SectionCard>
          </div>

          <div className="flex flex-col gap-5">
            <SectionCard title="闭环进度" description="三步都完成，这条结论才算生效。">
              {plan ? (
                <div className="flex flex-col gap-3">
                  <StageLoop reviewed={reviewed} acknowledged={Boolean(plan.ack)} />
                  <div className="flex flex-wrap items-center gap-2">
                    <ReviewBadge review={plan.review} />
                    <span className="text-[11.5px] text-muted-foreground">
                      提交于 {formatDateTime(plan.submittedAt)}
                    </span>
                  </div>
                  <ReviewNote review={plan.review} />
                  <AckBar
                    ack={plan.ack}
                    onAck={acknowledge}
                    question="你认可这个分层、配对与分工吗？"
                  />
                  {stale ? (
                    <p className="rounded-md border border-[var(--school-warning)]/40 bg-[var(--school-warning)]/8 px-2.5 py-2 text-[12px] leading-relaxed">
                      诊断结果已经变化，这份方案是按旧诊断算的。点右上角「重新生成方案」。
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  还没有生成课前方案。生成后可以在这里看到教师的审核状态。
                </p>
              )}
            </SectionCard>

            <SectionCard title="薄弱维度" description="配对时优先照顾这几个维度。">
              {plan && plan.weakDimensions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {plan.weakDimensions.map((dimension) => (
                    <Badge key={dimension} variant="destructive" className="font-normal">
                      {dimension}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">生成方案后显示。</p>
              )}
            </SectionCard>

            <HintBar>
              分层是<strong>配对依据</strong>，不是标签。它决定你现在做哪一档案例，
              做完之后可以往上一层走——下一层的门槛写在上面那张对照表里。
            </HintBar>
          </div>
        </div>
      )}

      <AlertDialog open={pendingProject !== null} onOpenChange={(open) => !open && setPendingProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>采用「{pendingProject?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              采用新案例会清空当前项目的闯关进度、实验记录与 AI 对话，学情诊断与三诊记录都会保留。
              操作前会自动生成 24 小时可恢复快照，可在工作台顶部横幅一键撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingProject) return;
                resetProject(`采用案例「${pendingProject.title}」`, pendingProject.id);
                // 采用结果要写进证据快照：教师端的「任务匹配适切率」正是
                // 用「最终采用的项目是否落在 AI 推荐前 3」来算的。
                publishEvidence({
                  studentId,
                  studentName,
                  evidence: buildEvidence({ ...state, projectId: pendingProject.id }, pendingProject.id),
                });
                setPendingProject(null);
              }}
            >
              确认采用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
