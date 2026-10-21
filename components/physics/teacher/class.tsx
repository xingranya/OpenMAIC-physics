'use client';

/**
 * 教师端 · 班级画像。
 *
 * 以学生为单位展示学情快照，并可增改本地项目案例。
 */

import * as React from 'react';
import { Pencil, Plus, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, RiskBadge, SectionCard } from '@/components/physics/shared';
import { DEMO_STUDENTS, PROJECTS } from '@/lib/physics/data';
import type { Project } from '@/lib/physics/types';

export function TeacherClass() {
  const { state, update } = usePhysicsState();
  const [filter, setFilter] = React.useState<'全部' | '优秀' | '正常' | '关注' | '高风险'>('全部');
  const [editing, setEditing] = React.useState<Project | null>(null);
  const [creating, setCreating] = React.useState(false);

  const students = DEMO_STUDENTS.filter((student) => filter === '全部' || student.risk === filter);
  const projects = [...PROJECTS, ...state.localProjects];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="班级画像"
        description="按学生查看学情快照、薄弱维度与当前项目，并维护本课程的项目案例库。"
        actions={
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            新增本地项目
          </Button>
        }
      />

      <SectionCard title="学生名单" description="课程示例名单，非真实教务数据">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['全部', '优秀', '正常', '关注', '高风险'] as const).map((item) => (
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

        <ul className="flex flex-col gap-2">
          {students.map((student) => (
            <li
              key={student.name}
              className="grid gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {student.name}
                  <RiskBadge risk={student.risk} />
                  <Badge variant="outline" className="font-normal">
                    {student.weakDimension}薄弱
                  </Badge>
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  项目「{student.project}」· 进度 {student.progress}%
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[17px] font-semibold tabular-nums">{student.score}</p>
                  <p className="text-[10.5px] text-muted-foreground">诊断分</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="项目案例库"
        description={`共 ${projects.length} 个案例（内置 ${PROJECTS.length} + 本地新增 ${state.localProjects.length}）`}
      >
        <ul className="flex flex-col gap-2">
          {projects.map((project) => {
            const local = state.localProjects.some((item) => item.id === project.id);
            return (
              <li
                key={project.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/70 p-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {project.title}
                    {local ? (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        本地
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {project.intro}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    难度 {project.level} · 能力路径：{project.ability}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(project)}
                  aria-label={`编辑项目 ${project.title}`}
                >
                  <Pencil className="size-3.5" />
                  编辑
                </Button>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <HintBar>
        名单、分数与进度为课程示例数据；新增项目仅保存在本浏览器，不写入任何服务端数据库。
      </HintBar>

      <ProjectDialog
        open={creating || editing !== null}
        project={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={(project) => {
          if (editing) {
            update({
              localProjects: state.localProjects.map((item) =>
                item.id === project.id ? project : item,
              ),
            });
          } else {
            update({ localProjects: [...state.localProjects, project] });
          }
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ProjectDialog({
  open,
  project,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (project: Project) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [intro, setIntro] = React.useState('');
  const [ability, setAbility] = React.useState('');

  React.useEffect(() => {
    if (project) {
      setTitle(project.title);
      setIntro(project.intro);
      setAbility(project.ability);
    } else {
      setTitle('');
      setIntro('');
      setAbility('');
    }
  }, [project, open]);

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      id: project?.id ?? `local-${Date.now().toString(36)}`,
      title: title.trim(),
      level: project?.level ?? '基础',
      dims: project?.dims ?? ['力学'],
      styles: project?.styles ?? ['practice'],
      targets: project?.targets ?? ['application'],
      intro: intro.trim(),
      ability: ability.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? '编辑项目' : '新增本地项目'}</DialogTitle>
          <DialogDescription>
            本地项目只保存在当前浏览器，可立即用于项目匹配与任务闯关。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="project-title" className="mb-1.5 block text-[12px] font-medium">
              项目名称
            </label>
            <Input
              id="project-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：校园噪声监测与隔声优化"
            />
          </div>
          <div>
            <label htmlFor="project-intro" className="mb-1.5 block text-[12px] font-medium">
              项目简介
            </label>
            <Textarea
              id="project-intro"
              value={intro}
              onChange={(event) => setIntro(event.target.value)}
              rows={3}
              placeholder="用一两句话说明这个项目要解决什么问题。"
            />
          </div>
          <div>
            <label htmlFor="project-ability" className="mb-1.5 block text-[12px] font-medium">
              能力路径
            </label>
            <Input
              id="project-ability"
              value={ability}
              onChange={(event) => setAbility(event.target.value)}
              placeholder="例如：情境识别→建模→方案→验证→协作"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
