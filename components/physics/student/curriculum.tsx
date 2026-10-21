'use client';

/**
 * 学生端 · 章节与知识图谱。
 *
 * 章节矩阵按"与当前学情的匹配度"排序；每个章节展示校内实验项目与
 * 课程思政锚点，让知识结构与学校课程层连起来。
 */

import * as React from 'react';
import { FlaskConical, Network, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { CHAPTER_MAPPINGS, KNOWLEDGE_NODES } from '@/lib/physics/data';
import { calculateChapterMatchScore, projectMatchesForChapter } from '@/lib/physics/engine';
import { getIdeologyPoint } from '@/lib/school';
import { getLabsForChapter, getSchoolChapterMeta } from '@/lib/school';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  成熟案例: 'secondary',
  重点建设: 'default',
  拓展案例: 'outline',
};

export function StudentCurriculum() {
  const { state } = usePhysicsState();
  const [selected, setSelected] = React.useState<number | null>(null);

  const ranked = React.useMemo(
    () =>
      [...CHAPTER_MAPPINGS]
        .map((chapter) => ({
          chapter,
          match: calculateChapterMatchScore(chapter, state.diagnosis, state.student),
        }))
        .sort((left, right) => right.match - left.match),
    [state.diagnosis, state.student],
  );

  const active = selected ?? ranked[0]?.chapter.no ?? null;
  const activeChapter = active ? CHAPTER_MAPPINGS.find((item) => item.no === active) : undefined;
  const labs = active ? getLabsForChapter(active) : [];
  const meta = active ? getSchoolChapterMeta(active) : undefined;
  const ideology = meta ? getIdeologyPoint(meta.ideologyKey) : undefined;
  const matches = activeChapter
    ? projectMatchesForChapter(activeChapter, state.diagnosis)
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="章节与知识图谱"
        description="18 章教学矩阵 + 知识模块图谱。章节按与你当前学情的匹配度排序，右侧展开该章的校内实验与课程思政锚点。"
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title="教学章节矩阵"
          description={state.diagnosis ? '按学情匹配度排序' : '完成诊断后将按匹配度排序'}
        >
          <ul className="flex flex-col gap-1.5">
            {ranked.map(({ chapter, match }) => {
              const isActive = chapter.no === active;
              return (
                <li key={chapter.no}>
                  <button
                    type="button"
                    onClick={() => setSelected(chapter.no)}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-primary/50 bg-[var(--school-primary-softer)] dark:bg-primary/10'
                        : 'border-border/70 hover:border-primary/30',
                    )}
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground">
                      {chapter.no}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{chapter.title}</span>
                        <Badge variant={STATUS_VARIANT[chapter.status]} className="font-normal">
                          {chapter.status}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {chapter.volume} · {chapter.module} · {chapter.hours} 学时 · 产出：
                        {chapter.output}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold tabular-nums text-primary">
                        {match}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">匹配度</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionCard>

        <div className="flex flex-col gap-5">
          {activeChapter ? (
            <SectionCard
              title={`第 ${activeChapter.no} 章 · ${activeChapter.title}`}
              description={activeChapter.ability}
              action={
                <Badge variant="outline" className="font-normal">
                  {activeChapter.difficulty}
                </Badge>
              }
            >
              <dl className="flex flex-col gap-2 text-[12.5px]">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">核心概念</dt>
                  <dd className="min-w-0 flex-1">{activeChapter.concepts.join(' · ')}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">思政锚点</dt>
                  <dd className="min-w-0 flex-1">
                    {ideology ? (
                      <>
                        <span className="font-medium">{ideology.theme}</span>
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {ideology.summary}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {ideology ? (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">讨论引导</dt>
                    <dd className="min-w-0 flex-1 text-muted-foreground">
                      {ideology.discussionPrompt}
                    </dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">教学周次</dt>
                  <dd className="min-w-0 flex-1">{meta?.weeks ?? '—'}</dd>
                </div>
              </dl>

              {labs.length > 0 ? (
                <div className="mt-4 border-t border-border/70 pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    <FlaskConical className="size-3.5" aria-hidden="true" />
                    校内实验项目
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {labs.map((lab) => (
                      <li key={lab.id} className="text-[12.5px]">
                        <span className="font-medium">{lab.name}</span>
                        <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                          {lab.hours} 学时 · {lab.apparatus} · 测量量：{lab.measurand}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {matches ? (
                <div className="mt-4 border-t border-border/70 pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    章节主项目
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="font-normal">
                      {matches.project.title}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      匹配度 {matches.score}
                    </Badge>
                  </div>
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          <SectionCard title="知识图谱" description="六大模块与关键概念节点">
            <ul className="flex flex-col gap-2">
              {KNOWLEDGE_NODES.slice(1, 7).map((node) => (
                <li key={node.id} className="rounded-lg border border-border/70 p-2.5">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <Network className="size-3.5 text-primary" aria-hidden="true" />
                    {node.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {node.description}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    推荐案例：{node.recommendations}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>

          <HintBar>
            章节学时、教材版本与实验项目清单为
            <strong>示例数据（待教务核对）</strong>，可在作品说明书中查证其标注方式。
          </HintBar>

          <Button asChild variant="outline" className="w-full">
            <Link href="/">
              <Sparkles className="size-4" />用 AI 课堂讲这一章
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
