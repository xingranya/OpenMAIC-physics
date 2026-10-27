'use client';

/**
 * 教师端 · 成绩登记总表。
 *
 * 与教学工作手册里那张纸质表一一对应：学号 / 姓名 / 三个阶段各四项能力 / 总分。
 *
 * ## 为什么每个格子都能改
 *
 * 系统算出来的是**建议值**（由诊断分与任务进度推出），而成绩是要签字归档的。
 * 不能改的表在教务那里不能用：一次课堂表现加分、一次补考，都得落在这张表上。
 * 所以每个学生的 12 个格子都可编辑，改完存在本地，刷新后仍在。
 *
 * ## 总分不是简单相加
 *
 * 三个阶段权重 30% / 50% / 30%，和是 110%。所以总分按「加权后除以权重之和」
 * 归一化——直接相加会算出 110 分的满分。公式写在 `score-sheet.ts` 里，
 * 表头把权重显式标出来，教师一眼能对上手册。
 */

import * as React from 'react';
import { Download, Pencil, RotateCcw } from 'lucide-react';

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
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { toCsv } from '@/lib/physics/engine';
import { downloadText } from '@/lib/physics/download';
import {
  SHEET_ABILITIES,
  SHEET_STAGES,
  buildRow,
  buildSheet,
  emptyEntry,
  sheetColumns,
  sheetToRows,
  type SheetRow,
} from '@/lib/physics/score-sheet';
import { COURSE, SCHOOL } from '@/lib/school';
import type { FourAbility, ScoreEntry, SheetStageKey } from '@/lib/physics/types';

/** 手册表头里的课程信息。学时与学期是示例值，与教务核对后可直接改这里。 */
const SHEET_META = {
  hours: 48,
  term: '2024—2025 学年 第一学期',
  assessment: '过程考核 + 课堂考核 + 学生自评',
};

export function TeacherScores() {
  const { state, update } = usePhysicsState();
  const [editing, setEditing] = React.useState<SheetRow | null>(null);
  const [draft, setDraft] = React.useState<ScoreEntry>(() => emptyEntry());

  const rows = React.useMemo(() => buildSheet(state.scoreSheet), [state.scoreSheet]);

  const openEditor = (row: SheetRow) => {
    setEditing(row);
    setDraft(row.entry);
  };

  const setCell = (stage: SheetStageKey, ability: FourAbility, value: number) => {
    const next = Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
    setDraft((previous) => ({
      ...previous,
      [stage]: { ...previous[stage], [ability]: next },
    }));
  };

  const save = () => {
    if (!editing) return;
    update({ scoreSheet: { ...state.scoreSheet, [editing.studentId]: draft } });
    setEditing(null);
  };

  const resetOne = () => {
    if (!editing) return;
    const next = { ...state.scoreSheet };
    delete next[editing.studentId];
    update({ scoreSheet: next });
    setEditing(null);
  };

  const exportCsv = () => {
    const csv = toCsv(sheetToRows(rows), sheetColumns());
    downloadText(`成绩登记总表-${SCHOOL.collegeShort}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const draftRow = editing ? buildRow(editing.studentId, editing.name, draft) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="成绩登记总表"
        description="三个阶段各四项能力，总分按 30% / 50% / 30% 归一化加权。格子可改，导出即为手册附表。"
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-3.5" />
            导出 CSV
          </Button>
        }
      />

      <SectionCard contentClassName="pt-4">
        <div className="grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
          <Meta label="课程" value={COURSE.name} />
          <Meta label="学时" value={`${SHEET_META.hours}（示例）`} />
          <Meta label="学分" value={String(COURSE.credits)} />
          <Meta label="教师签名" value={COURSE.teacher} />
          <Meta label="系（部）" value={SCHOOL.college} />
          <Meta label="专业" value={COURSE.major} />
          <Meta label="班级" value={COURSE.className} />
          <Meta label="考核形式" value={SHEET_META.assessment} />
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">{SHEET_META.term}</p>
      </SectionCard>

      <SectionCard
        title="学生成绩"
        description="点击任一学生的「录入」可改 12 个格子；未录入的学生按诊断分与任务进度给出建议值。"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
            <caption className="sr-only">学生成绩登记总表</caption>
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th scope="col" rowSpan={2} className="border border-border/70 px-1.5 py-1.5 font-medium">
                  学号
                </th>
                <th scope="col" rowSpan={2} className="border border-border/70 px-1.5 py-1.5 font-medium">
                  姓名
                </th>
                {SHEET_STAGES.map((stage) => (
                  <th
                    key={stage.key}
                    scope="colgroup"
                    colSpan={SHEET_ABILITIES.length}
                    className="border border-border/70 px-1.5 py-1.5 font-medium"
                  >
                    {stage.label}
                    <span className="ml-1 font-normal text-[10px]">
                      （权重 {Math.round(stage.weight * 100)}%）
                    </span>
                  </th>
                ))}
                <th
                  scope="col"
                  rowSpan={2}
                  className="border border-border/70 bg-[var(--school-primary-softer)] px-1.5 py-1.5 font-medium dark:bg-primary/10"
                >
                  总分
                </th>
                <th scope="col" rowSpan={2} className="border border-border/70 px-1.5 py-1.5 font-medium">
                  操作
                </th>
              </tr>
              <tr className="bg-muted/30 text-muted-foreground">
                {SHEET_STAGES.flatMap((stage) =>
                  SHEET_ABILITIES.map((ability) => (
                    <th
                      key={`${stage.key}-${ability.ability}`}
                      scope="col"
                      className="border border-border/70 px-1 py-1 font-normal"
                    >
                      {ability.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.studentId} className="hover:bg-muted/30">
                  <td className="border border-border/60 px-1.5 py-1 tabular-nums">{row.studentId}</td>
                  <th scope="row" className="border border-border/60 px-1.5 py-1 text-left font-medium">
                    {row.name}
                  </th>
                  {SHEET_STAGES.flatMap((stage) =>
                    SHEET_ABILITIES.map((ability) => {
                      const value = row.entry[stage.key][ability.ability];
                      return (
                        <td
                          key={`${stage.key}-${ability.ability}`}
                          className="border border-border/60 px-1 py-1 text-center tabular-nums"
                        >
                          <span
                            className={
                              value < 60
                                ? 'text-[var(--school-danger)]'
                                : value >= 90
                                  ? 'text-[var(--school-success)]'
                                  : undefined
                            }
                          >
                            {value}
                          </span>
                        </td>
                      );
                    }),
                  )}
                  <td className="border border-border/60 px-1.5 py-1 text-center font-semibold tabular-nums">
                    {row.total}
                  </td>
                  <td className="border border-border/60 px-1 py-1 text-center">
                    <Button size="sm" variant="ghost" onClick={() => openEditor(row)}>
                      <Pencil className="size-3" />
                      录入
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          总分 = Σ(阶段权重 × 阶段得分) ÷ Σ阶段权重。阶段得分 = 四项能力按
          知识 25% / 专业 30% / 创新 25% / 团队 20% 加权，与「课后：过程评价」同一口径。
          学号为示例编号，不对应真实学籍。
        </p>
      </SectionCard>

      <HintBar>
        表格里的数值是<strong>建议值</strong>：由诊断分与任务进度推出，用于演示公式与导出。
        真实成绩请点「录入」逐格改，改完保存在本机，刷新不丢。
      </HintBar>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>录入 {editing?.name}</DialogTitle>
            <DialogDescription>
              学号 {editing?.studentId}。每格 0–100，改完点保存；总分与阶段分自动重算。
            </DialogDescription>
          </DialogHeader>

          {draftRow ? (
            <div className="flex flex-col gap-3">
              {SHEET_STAGES.map((stage) => (
                <div key={stage.key}>
                  <p className="mb-1.5 flex items-baseline justify-between text-[12px] font-medium">
                    <span>
                      {stage.label}
                      <span className="ml-1 font-normal text-muted-foreground">
                        （权重 {Math.round(stage.weight * 100)}%）
                      </span>
                    </span>
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      阶段得分 {draftRow.stageScores[stage.key]}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SHEET_ABILITIES.map((ability) => (
                      <label key={ability.ability} className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">{ability.label}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={draft[stage.key][ability.ability]}
                          onChange={(event) =>
                            setCell(stage.key, ability.ability, Number(event.target.value))
                          }
                          className="rounded-md border border-border bg-background px-2 py-1 text-[13px] tabular-nums"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <p className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-[12px]">
                <span>总分（归一化加权）</span>
                <Badge variant="secondary" className="text-[13px] tabular-nums">
                  {draftRow.total}
                </Badge>
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={resetOne}>
              <RotateCcw className="size-3.5" />
              恢复建议值
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className="min-w-0 truncate">{value}</span>
    </p>
  );
}
