'use client';

/**
 * 学生端 · 课后：过程性评价。
 *
 * 对应「三诊」的第三诊与「五环」里的**评**。
 *
 * ## 这一页要回答的不是「我多少分」
 *
 * 是「这个分是怎么算出来的，我下一步补什么」。所以四项能力下面必须能看到
 * **原始贡献值**（课前诊断 / 课中参与 / 任务完成 / 团队合作），
 * 以及历次评价的**轨迹**。只给一个综合分，过程性评价就退化成了期末成绩单——
 * 那正是申请书要改掉的东西。
 *
 * ## 缺数据不伪造
 *
 * 没有实验记录时，专业能力按任务完成度估算，并在建议里明说「实验数据不足」。
 * 硬凑一个好看的分数，教师复核时第一个就会问「这个数从哪来的」，
 * 而答不上来的评分表在评审现场是负分项。
 */

import * as React from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import { useSharedReviewSync } from '@/components/physics/use-shared-review-sync';
import {
  AckBar,
  EmptyState,
  HintBar,
  MetricTile,
  PageHeader,
  ProgressRow,
  ReviewNote,
  RubricTable,
  SectionCard,
  SimpleBarChart,
  StageLoop,
  formatDateTime,
} from '@/components/physics/shared';
import { publishPostClass } from '@/lib/physics/submissions';
import { levelLabelOf } from '@/lib/physics/quant-rubric';
import {
  ABILITY_HINTS,
  ABILITY_LABELS,
  buildPostClassRecord,
  gradeOf,
  overallScore,
} from '@/lib/physics/stages';
import type { FourAbility } from '@/lib/physics/types';

const ABILITIES: readonly FourAbility[] = [
  'knowledge',
  'application',
  'innovation',
  'collaboration',
];

const CONTRIBUTION_LABELS: Readonly<Record<'preClass' | 'inClass' | 'task' | 'teamwork', string>> = {
  preClass: '课前诊断',
  inClass: '课中参与',
  task: '任务完成',
  teamwork: '团队合作',
};

export function StudentPostClass() {
  const { state, update, session } = usePhysicsState();
  useSharedReviewSync();

  const studentId = session?.userId ?? state.student?.id ?? 'demo-student';
  const studentName = state.student?.name ?? session?.displayName ?? '演示学生';

  const record = state.postClass ?? null;
  const reviewed = Boolean(record?.teacher);
  const total = record ? overallScore(record.abilities) : 0;
  // 教师修正分优先：这正是「教师复核覆盖 AI 建议」在界面上的落点。
  const finalScore = record?.teacher?.score ?? total;

  const generate = () => {
    const next = buildPostClassRecord({ state });
    update({ postClass: next });
    publishPostClass({ studentId, studentName, record: next });
  };

  const acknowledge = (accepted: boolean, note: string) => {
    if (!record) return;
    const ack = { accepted, note: note || undefined, at: new Date().toISOString() };
    update({ postClass: { ...record, ack } });
    // 课后的认可同样写回共享键，教师下次打开审核台能看到「学生仍有疑问」。
    // 不写回去的话，教师只会看到自己通过了，永远不知道学生不认。
    const shared = { ...record, ack };
    publishPostClass({ studentId, studentName, record: shared });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="课后：过程性评价"
        description="四阶能力由课前诊断、课中参与、任务完成与团队合作加权得出，每一项的贡献值都列在下面。教师修正后的分数优先。"
        actions={
          <Button onClick={generate} disabled={!state.diagnosis}>
            <RefreshCw className="size-4" />
            {record ? '重新生成评价' : '生成过程性评价'}
          </Button>
        }
      />

      {!state.diagnosis ? (
        <EmptyState
          title="还没有可用的学习数据"
          description="过程性评价要用诊断分、任务进度与课中问答。先完成学情诊断，这一页才有可算的东西。"
        />
      ) : !record ? (
        <EmptyState
          title="还没有生成过评价"
          description="点右上角「生成过程性评价」，会按当前数据算一次四阶能力，并记入轨迹。每生成一次记一条，便于看到变化。"
          action={<Button onClick={generate}>立即生成</Button>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex flex-col gap-5">
            <SectionCard
              title="四阶能力"
              description="梯度发展：不是一次性达标，而是每次评价比上一次高一点。"
              action={
                <Badge variant={finalScore >= 80 ? 'default' : 'secondary'} className="font-normal">
                  {gradeOf(finalScore)}
                </Badge>
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MetricTile label="综合分" value={finalScore} unit="/100" />
                <MetricTile
                  label="AI 建议"
                  value={total}
                  unit="/100"
                  tone="default"
                  hint="按公开权重算出的原始分"
                />
                <MetricTile
                  label="教师修正"
                  value={record.teacher ? record.teacher.score : '—'}
                  tone={record.teacher ? 'success' : 'default'}
                  hint={record.teacher ? '以修正分为准' : '教师尚未修正'}
                />
              </div>

              <div className="mt-4 flex flex-col gap-2.5">
                {ABILITIES.map((ability) => (
                  <ProgressRow
                    key={ability}
                    label={ABILITY_LABELS[ability]}
                    value={record.abilities[ability]}
                  />
                ))}
              </div>

              <div className="mt-4">
                <SimpleBarChart
                  caption="四阶能力当前值"
                  data={ABILITIES.map((ability) => ({
                    label: ABILITY_LABELS[ability],
                    value: record.abilities[ability],
                  }))}
                />
              </div>

              {/* 分数对到层级上：光有 82 分看不出水平，对到「进阶水平」才有意义。 */}
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {ABILITIES.map((ability) => (
                  <li key={ability}>
                    <Badge variant="outline" className="font-normal">
                      {ABILITY_LABELS[ability]}：{levelLabelOf(record.abilities[ability])}
                    </Badge>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard
              title="分数是怎么来的"
              description="四个来源的原始贡献值。教师复核时逐项对得上，学生也知道该补哪一块。"
            >
              <ul className="flex flex-col gap-2.5">
                {(
                  ['preClass', 'inClass', 'task', 'teamwork'] as const
                ).map((key) => (
                  <li key={key}>
                    <ProgressRow
                      label={CONTRIBUTION_LABELS[key]}
                      value={record.contributions[key]}
                    />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                知识 = 诊断 55% + 课中 25% + 任务 20%；专业 = 实验 45% + 任务 35% + 课中 20%；
                创新 = 任务 50% + 实验 30% + 诊断 20%；团队合作 = 课中参与 65% + 任务 35%。
              </p>
            </SectionCard>

            <SectionCard
              title="改进建议"
              description="按最弱的两项生成，最多三条——多了就成了正确的废话。"
            >
              <ol className="flex flex-col gap-2">
                {record.advice.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] leading-relaxed">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>

            <SectionCard
              title="评价标准（四阶能力量化评价表）"
              description="每一项分数都对应到具体指标、AI 做的事、层级行为描述与证据来源。"
            >
              <RubricTable compact />
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                维度内权重之和为 100%。低于 60 分记为「未达标」——那是需要重点干预的状态，
                不属于任何一层。
              </p>
            </SectionCard>
          </div>

          <div className="flex flex-col gap-5">
            <SectionCard title="闭环进度" description="三步都完成，这份评价才算生效。">
              <div className="flex flex-col gap-3">
                <StageLoop reviewed={reviewed} acknowledged={Boolean(record.ack)} />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={reviewed ? 'default' : 'secondary'}
                    className="font-normal"
                    data-review-status={reviewed ? 'adjusted' : 'pending'}
                  >
                    {reviewed ? '教师已修正' : '待教师审核'}
                  </Badge>
                  <span className="text-[11.5px] text-muted-foreground">
                    生成于 {formatDateTime(record.generatedAt)}
                  </span>
                </div>
                {record.teacher ? (
                  <ReviewNote
                    review={{
                      status: 'adjusted',
                      note: record.teacher.note,
                      at: record.teacher.at,
                    }}
                  />
                ) : null}
                <AckBar
                  ack={record.ack}
                  onAck={acknowledge}
                  question="你认可这份过程性评价吗？"
                />
              </div>
            </SectionCard>

            <SectionCard
              title="能力轨迹"
              description={`已记录 ${record.trajectory.length} 次，最多保留最近 8 次。`}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <caption className="sr-only">历次四阶能力评价</caption>
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-2 font-medium">
                        次数
                      </th>
                      {ABILITIES.map((ability) => (
                        <th key={ability} scope="col" className="py-1.5 pr-2 font-medium">
                          {ABILITY_LABELS[ability]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {record.trajectory.map((point) => (
                      <tr key={`${point.label}-${point.at}`} className="border-t border-border/60">
                        <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                          {point.label}
                        </th>
                        {ABILITIES.map((ability) => (
                          <td key={ability} className="py-1.5 pr-2 tabular-nums">
                            {point.scores[ability]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                每一次「重新生成评价」都会新增一行，用于看趋势而不是看单点。
              </p>
            </SectionCard>

            <HintBar>
              {ABILITIES.map((ability) => (
                <span key={ability} className="block">
                  <strong>{ABILITY_LABELS[ability]}</strong>：{ABILITY_HINTS[ability]}
                </span>
              ))}
            </HintBar>
          </div>
        </div>
      )}
    </div>
  );
}
