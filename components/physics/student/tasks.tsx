'use client';

/**
 * 学生端 · 任务闯关。
 *
 * 五阶递进：情境认知 → 原理建模 → 方案设计 → 实验验证 → 协同创生。
 * 每阶都有可勾选的检查项与一句引导提问，进度实时汇总进学习报告。
 */

import * as React from 'react';
import { CheckCircle2, Circle, ListChecks, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePhysicsState } from '@/components/physics/state-provider';
import { EmptyState, HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { TASK_TEMPLATES, getProjectById } from '@/lib/physics/data';
import { calculateTaskProgress } from '@/lib/physics/engine';
import { getIdeologyPointForDimension } from '@/lib/school';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export function StudentTasks() {
  const { state, update } = usePhysicsState();
  // 状态容器首帧是空状态，挂载后才补齐浏览器里的数据。
  // 这里用 override 承接"用户刚刚切了哪一关"，持久化的 activeTask 作为回落：
  // 若把初值缓存进 useState，刷新后会永远停在第 1 关。
  const [activeOverride, setActiveOverride] = React.useState<number | null>(null);
  const active = activeOverride ?? state.activeTask ?? 0;

  const progress = calculateTaskProgress(state.taskChecks, TASK_TEMPLATES);
  const project = getProjectById(state.projectId);
  const template = TASK_TEMPLATES[active];
  const completedInStage = template
    ? template.checks.filter((_, checkIndex) => state.taskChecks[`${active}-${checkIndex}`]).length
    : 0;

  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <PageHeader title="任务闯关" />
        <EmptyState
          title="先选择一个项目"
          description="任务闯关依附于已选项目。请先在「项目匹配」中选择一个案例，再回来逐关完成。"
          action={
            <Button asChild>
              <Link href="/physics/projects">去匹配项目</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const toggleCheck = (checkIndex: number) => {
    const key = `${active}-${checkIndex}`;
    update({
      taskChecks: { ...state.taskChecks, [key]: !state.taskChecks[key] },
      activeTask: active,
    });
  };

  const ideology = project.dims.length ? getIdeologyPointForDimension(project.dims[0]) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="任务闯关"
        description={`项目：${project.title} · 五阶递进，每一阶留下可解释的过程证据。`}
        actions={
          <Badge variant="secondary" className="font-normal">
            总进度 {progress.percentage}%
          </Badge>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* 阶段梯 */}
        <SectionCard title="五阶任务">
          <ol className="flex flex-col gap-1">
            {TASK_TEMPLATES.map((item, index) => {
              const done = item.checks.filter(
                (_, checkIndex) => state.taskChecks[`${index}-${checkIndex}`],
              ).length;
              const complete = done === item.checks.length;
              const isActive = index === active;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveOverride(index);
                      update({ activeTask: index });
                    }}
                    aria-current={isActive ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      isActive
                        ? 'bg-[var(--school-primary-softer)] text-foreground dark:bg-primary/10'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {complete ? (
                      <CheckCircle2
                        className="size-4 shrink-0 text-[var(--school-success)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle className="size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{item.name}</span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        {done} / {item.checks.length}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </SectionCard>

        {/* 当前关卡 */}
        {template ? (
          <div className="flex flex-col gap-5">
            <SectionCard
              title={template.name}
              description={template.goal}
              action={
                <Badge variant="outline" className="font-normal">
                  {template.ability}
                </Badge>
              }
            >
              <ul className="flex flex-col gap-2">
                {template.checks.map((check, checkIndex) => {
                  const key = `${active}-${checkIndex}`;
                  const checked = Boolean(state.taskChecks[key]);
                  return (
                    <li key={check}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors',
                          checked
                            ? 'border-primary/40 bg-[var(--school-primary-softer)] dark:bg-primary/10'
                            : 'border-border/70 hover:border-primary/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCheck(checkIndex)}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                        />
                        <span className={cn(checked ? 'text-muted-foreground line-through' : '')}>
                          {check}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 rounded-lg border border-dashed border-primary/30 bg-[var(--school-primary-softer)] p-3 dark:bg-primary/10">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  教练提示
                </p>
                <p className="mt-1 text-[13px] leading-relaxed">{template.prompt}</p>
                {ideology ? (
                  <p className="mt-2.5 border-t border-primary/20 pt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">课程思政 · {ideology.theme}</span>
                    <span className="mt-0.5 block">{ideology.discussionPrompt}</span>
                  </p>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard title="本关笔记" description="你的思考会随学习报告一起导出">
              <Textarea
                value={state.taskTexts[template.id] ?? ''}
                onChange={(event) =>
                  update({
                    taskTexts: { ...state.taskTexts, [template.id]: event.target.value },
                  })
                }
                placeholder={`记录「${template.name}」的过程与结论…`}
                rows={5}
                aria-label={`${template.name} 笔记`}
              />
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                本关已完成 {completedInStage} / {template.checks.length} 项检查。
              </p>
            </SectionCard>
          </div>
        ) : null}
      </div>

      <HintBar>
        闯关进度与笔记会自动保存到浏览器本地，退出登录不会清除；重置学习记录需要二次确认， 且 24
        小时内可撤销。
      </HintBar>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/physics/lab">
            <ListChecks className="size-4" />
            去虚拟实验
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/physics/report">查看学习报告</Link>
        </Button>
      </div>
    </div>
  );
}
