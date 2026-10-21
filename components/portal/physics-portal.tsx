'use client';

/**
 * 物理学习门户（首页顶部）。
 *
 * 把两个能力域接成一条演示动线：
 * - 「AI 智能课堂」：本页，生成并上课；
 * - 「物理学习工作台」：学情诊断到学习报告的完整教学闭环。
 *
 * 章节快捷入口直接把课程主题填入需求框，减少现场演示的输入成本。
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, GraduationCap, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CHAPTER_MAPPINGS } from '@/lib/physics/data';
import {
  PRESET_CLASSROOMS,
  importPresetClassroom,
  type PresetClassroom,
} from '@/lib/physics/presets';
import { BRAND_FULL_NAME, COURSE, SCHOOL } from '@/lib/school';

export interface PhysicsPortalProps {
  /** 把一个章节主题填入需求输入框。 */
  onTopic: (topic: string) => void;
}

/** 门户上展示的快捷章节（取自教学矩阵，优先成熟案例）。 */
const FEATURED_CHAPTERS = CHAPTER_MAPPINGS.filter((chapter) => chapter.status === '成熟案例').slice(
  0,
  6,
);

export function PhysicsPortal({ onTopic }: PhysicsPortalProps) {
  const router = useRouter();
  const [importing, setImporting] = React.useState<string | null>(null);

  const importPreset = async (preset: PresetClassroom) => {
    setImporting(preset.id);
    try {
      const result = await importPresetClassroom(preset);
      toast.success(`已导入「${preset.title}」，共 ${result.sceneCount} 个场景。正在进入课堂…`);
      router.push(`/classroom/${result.stageId}`);
    } catch (error) {
      toast.error(`导入失败：${error instanceof Error ? error.message : '未知错误'}`, {
        description: '预置课堂包保存在浏览器本地，请检查浏览器是否禁用了 IndexedDB。',
      });
    } finally {
      setImporting(null);
    }
  };

  return (
    <section
      aria-label="物理学习门户"
      className="mb-6 w-full max-w-[800px] rounded-2xl border border-border/70 bg-card/80 p-4 text-left shadow-sm backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal">
          {SCHOOL.collegeShort} · {COURSE.name}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{BRAND_FULL_NAME}</span>
      </div>

      <h2 className="mt-2.5 text-[16px] font-semibold tracking-tight">两条学习动线</h2>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => router.push('/physics/overview')}
          className="group flex items-start gap-2.5 rounded-xl border border-primary/30 bg-[var(--school-primary-softer)] p-3 text-left transition-colors hover:border-primary/60 dark:bg-primary/10"
        >
          <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">物理学习工作台</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
              学情诊断 → 项目匹配 → 任务闯关 → 虚拟实验 → 学习报告
            </span>
          </span>
          <ArrowRight
            className="ml-auto mt-0.5 size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        </button>

        <div className="flex items-start gap-2.5 rounded-xl border border-border/70 p-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">AI 智能课堂</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
              多智能体授课 · 白板演算 · 课堂讨论 · PPTX 导出（本页）
            </span>
          </span>
        </div>
      </div>

      <div className="mt-3.5">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          快捷开讲
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FEATURED_CHAPTERS.map((chapter) => (
            <button
              key={chapter.no}
              type="button"
              onClick={() =>
                onTopic(
                  `大学物理 ${chapter.volume} ${chapter.module}模块：${chapter.title}（第 ${chapter.no} 章）`,
                )
              }
              className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {chapter.no}. {chapter.title}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          点击后会把章节主题填入下方输入框，可直接生成课堂。
        </p>
      </div>

      <div className="mt-3.5 border-t border-border/70 pt-3.5">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          离线课堂包（零配额可演示）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_CLASSROOMS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={importing === preset.id}
              onClick={() => void importPreset(preset)}
              className="rounded-full border border-primary/40 bg-[var(--school-primary-softer)] px-2.5 py-1 text-[11.5px] text-primary transition-colors hover:border-primary disabled:opacity-60 dark:bg-primary/10"
            >
              {importing === preset.id ? '正在导入…' : preset.title}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          预置包内含讲演页、课堂测验与自包含交互仿真，无需模型 Key、无需网络，
          导入后与真实生成的课堂一样可播放与导出。
        </p>
      </div>
    </section>
  );
}
