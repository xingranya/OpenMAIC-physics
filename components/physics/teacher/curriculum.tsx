'use client';

/**
 * 教师端 · 课程项目矩阵。
 *
 * 章节 × 项目案例的映射表，按模块与建设状态筛选；
 * 每一章同时给出校内实验与课程思政锚点。
 */

import * as React from 'react';
import { FlaskConical, Network } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { CHAPTER_MAPPINGS, PROJECTS } from '@/lib/physics/data';
import { getProjectById } from '@/lib/physics/data';
import { getIdeologyPoint, getLabsForChapter, getSchoolChapterMeta } from '@/lib/school';
import { CHAPTER_STATUS_LABELS } from '@/lib/school';
import Link from 'next/link';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  成熟案例: 'secondary',
  重点建设: 'default',
  拓展案例: 'outline',
};

export function TeacherCurriculum() {
  const { state } = usePhysicsState();
  const [module, setModule] = React.useState('全部');
  const [status, setStatus] = React.useState('全部');

  const modules = ['全部', ...Array.from(new Set(CHAPTER_MAPPINGS.map((item) => item.module)))];
  const statuses = ['全部', ...Object.values(CHAPTER_STATUS_LABELS)];

  const chapters = CHAPTER_MAPPINGS.filter(
    (chapter) =>
      (module === '全部' || chapter.module === module) &&
      (status === '全部' || chapter.status === status),
  );

  const localProjects = state.localProjects;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="课程项目矩阵"
        description="章节与项目案例的映射，是课程设计的底稿。每个章节同时标注校内实验项目与课程思政锚点。"
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="按模块筛选">
          {modules.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setModule(item)}
              aria-pressed={module === item}
              className={
                module === item
                  ? 'rounded-full border border-primary bg-primary px-2.5 py-1 text-[11.5px] text-primary-foreground'
                  : 'rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50'
              }
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="按建设状态筛选">
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              aria-pressed={status === item}
              className={
                status === item
                  ? 'rounded-full border border-primary bg-primary px-2.5 py-1 text-[11.5px] text-primary-foreground'
                  : 'rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50'
              }
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <SectionCard title="章节 × 项目" description={`共 ${chapters.length} 章`}>
        <ul className="flex flex-col gap-2">
          {chapters.map((chapter) => {
            const primary = getProjectById(chapter.primary);
            const labs = getLabsForChapter(chapter.no);
            const meta = getSchoolChapterMeta(chapter.no);
            const ideology = meta ? getIdeologyPoint(meta.ideologyKey) : undefined;
            return (
              <li key={chapter.no} className="rounded-lg border border-border/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border text-[10.5px] text-muted-foreground">
                        {chapter.no}
                      </span>
                      {chapter.title}
                      <Badge variant={STATUS_VARIANT[chapter.status]} className="font-normal">
                        {chapter.status}
                      </Badge>
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {chapter.volume} · {chapter.module} · {chapter.hours} 学时 · 产出「
                      {chapter.output}」
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {primary ? (
                      <Badge variant="secondary" className="font-normal">
                        {primary.title}
                      </Badge>
                    ) : null}
                    {chapter.alternatives.map((alternative) => {
                      const alt = getProjectById(alternative);
                      return alt ? (
                        <Badge key={alternative} variant="outline" className="font-normal">
                          备选 {alt.title}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Network className="size-3" aria-hidden="true" />
                    {chapter.concepts.join(' · ')}
                  </span>
                  {labs.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <FlaskConical className="size-3" aria-hidden="true" />
                      {labs.map((lab) => lab.name).join('、')}
                    </span>
                  ) : null}
                  {ideology ? (
                    <span className="inline-flex items-center gap-1">思政 · {ideology.theme}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard
        title="项目案例库"
        description={`内置 ${PROJECTS.length} 个 + 本地新增 ${localProjects.length} 个`}
      >
        <ul className="flex flex-col gap-1.5">
          {[...PROJECTS, ...localProjects].map((project) => (
            <li
              key={project.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2"
            >
              <span className="min-w-0 truncate text-[12.5px] font-medium">{project.title}</span>
              <span className="flex flex-wrap gap-1">
                <Badge variant="outline" className="font-normal">
                  {project.level}
                </Badge>
                {project.dims.map((dim) => (
                  <Badge key={dim} variant="secondary" className="font-normal">
                    {dim}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <HintBar>
        章节学时、教材版本与实验项目清单为<strong>示例数据（待教务核对）</strong>；
        本地新增项目仅保存在当前浏览器。
      </HintBar>

      <Button asChild variant="outline">
        <Link href="/teacher/evaluation">去评价复核</Link>
      </Button>
    </div>
  );
}
