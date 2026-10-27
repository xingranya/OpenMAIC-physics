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
import { GitBranch, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
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
import { buildEvidence, publishEvidence, publishPostClass } from '@/lib/physics/submissions';
import { levelLabelOf } from '@/lib/physics/quant-rubric';
import {
  groupMembersOf,
  peerReviewCoverage,
  validatePeerReview,
  type GroupMember,
} from '@/lib/physics/peer-review';
import {
  ABILITY_HINTS,
  ABILITY_LABELS,
  buildPostClassRecord,
  gradeOf,
  overallScore,
  tierFromDiagnosis,
} from '@/lib/physics/stages';
import type { AbilityPoint, ArtifactVersion, FourAbility } from '@/lib/physics/types';

const ABILITIES: readonly FourAbility[] = [
  'knowledge',
  'application',
  'innovation',
  'collaboration',
];

/** 四条线的区分不靠色相，靠不透明度——深浅主题下都不会有一条线消失。 */
const ABILITY_OPACITY: Readonly<Record<FourAbility, number>> = {
  knowledge: 1,
  application: 0.72,
  innovation: 0.48,
  collaboration: 0.28,
};

/**
 * 能力梯度轨迹图。
 *
 * 表格能看数值，看不出「在往上走还是在原地打转」。申请书要的是
 * 「按时间顺序呈现出各个能力梯度发展的轨迹图」，所以这一块必须是图。
 */
function TrajectoryChart({ points }: { points: readonly AbilityPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-[12px] text-muted-foreground">
        再生成一次评价，这里才会出现轨迹线（至少两次才能比较）。
      </p>
    );
  }
  const width = 100;
  const height = 40;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const y = (value: number) => height - (Math.max(0, Math.min(100, value)) / 100) * (height - 6) - 3;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="四阶能力梯度轨迹"
        className="h-[120px] w-full"
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeWidth={0.25}
          />
        ))}
        {ABILITIES.map((ability) => (
          <polyline
            key={ability}
            fill="none"
            className="stroke-primary"
            strokeWidth={1}
            strokeOpacity={ABILITY_OPACITY[ability]}
            points={points
              .map((point, index) => `${index * step},${y(point.scores[ability])}`)
              .join(' ')}
          />
        ))}
      </svg>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {ABILITIES.map((ability) => (
          <li key={ability} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[2px] w-4 rounded bg-primary"
              style={{ opacity: ABILITY_OPACITY[ability] }}
            />
            {ABILITY_LABELS[ability]}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">
        横轴为评价次序：{points[0]?.label} → {points.at(-1)?.label}。
      </p>
    </figure>
  );
}

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
    publishEvidence({ studentId, studentName, evidence: buildEvidence(state) });
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

  /* ── 作品版本：创新能力「创」的证据 ── */
  const [versionOpen, setVersionOpen] = React.useState(false);
  const [versionLabel, setVersionLabel] = React.useState('');
  const [versionNote, setVersionNote] = React.useState('');

  const addVersion = () => {
    const label = versionLabel.trim();
    if (!label) return;
    const next: ArtifactVersion = {
      id: `v-${Date.now()}`,
      label,
      note: versionNote.trim(),
      at: new Date().toISOString(),
    };
    const versions = [...state.versions, next];
    update({ versions });
    publishEvidence({ studentId, studentName, evidence: buildEvidence({ ...state, versions }) });
    setVersionOpen(false);
    setVersionLabel('');
    setVersionNote('');
  };

  const removeVersion = (id: string) => {
    const versions = state.versions.filter((item) => item.id !== id);
    update({ versions });
    publishEvidence({ studentId, studentName, evidence: buildEvidence({ ...state, versions }) });
  };

  /* ── 组内互评：团队合作「评」的证据 ── */
  const tier = tierFromDiagnosis(state.diagnosis);
  const members = groupMembersOf({
    studentId,
    studentName,
    tier,
    reviews: state.peerReviews,
  });
  const coverage = peerReviewCoverage(members);

  const [peerTarget, setPeerTarget] = React.useState<GroupMember | null>(null);
  const [contribution, setContribution] = React.useState(80);
  const [cooperation, setCooperation] = React.useState(80);
  const [peerNote, setPeerNote] = React.useState('');
  const [peerError, setPeerError] = React.useState<string | null>(null);

  const openPeer = (member: GroupMember) => {
    const existing = state.peerReviews.find((item) => item.targetId === member.id);
    setPeerTarget(member);
    setContribution(existing?.contribution ?? 80);
    setCooperation(existing?.cooperation ?? 80);
    setPeerNote(existing?.note ?? '');
    setPeerError(null);
  };

  const savePeer = () => {
    if (!peerTarget) return;
    const error = validatePeerReview({ contribution, cooperation, note: peerNote });
    if (error) {
      setPeerError(error);
      return;
    }
    const next = {
      id: `peer-${peerTarget.id}`,
      targetId: peerTarget.id,
      targetName: peerTarget.name,
      contribution,
      cooperation,
      note: peerNote.trim(),
      at: new Date().toISOString(),
    };
    const peerReviews = [
      ...state.peerReviews.filter((item) => item.targetId !== peerTarget.id),
      next,
    ];
    update({ peerReviews });
    publishEvidence({ studentId, studentName, evidence: buildEvidence({ ...state, peerReviews }) });
    setPeerTarget(null);
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
              title="作品版本"
              description="每改一版记一条。创新能力看的不是最终交了什么，而是改了几轮、每轮改了什么。"
              action={
                <Button size="sm" variant="outline" onClick={() => setVersionOpen(true)}>
                  <Plus className="size-3.5" />
                  记录新版本
                </Button>
              }
            >
              {state.versions.length === 0 ? (
                <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <GitBranch className="size-4" aria-hidden="true" />
                  还没有版本记录。第一版哪怕是草稿也记一条——没有 v1 就没有「迭代」。
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {state.versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium">{version.label}</p>
                        {version.note ? (
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                            {version.note}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {formatDateTime(version.at)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`删除版本 ${version.label}`}
                        onClick={() => removeVersion(version.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
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
              <TrajectoryChart points={record.trajectory} />
              <div className="mt-3 overflow-x-auto">
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

            <SectionCard
              title="组内互评"
              description={`对同组同学匿名、对教师实名。本组应评 ${coverage.total} 人，已完成 ${coverage.done} 人。`}
            >
              <ul className="flex flex-col gap-2">
                {members
                  .filter((member) => !member.isSelf)
                  .map((member) => {
                    const existing = state.peerReviews.find((item) => item.targetId === member.id);
                    return (
                      <li
                        key={member.id}
                        className="flex items-start justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium">
                            {member.name}
                            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                              {member.role}
                            </span>
                          </p>
                          {existing ? (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                              贡献 {existing.contribution} · 协作 {existing.cooperation} · {existing.note}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">尚未评价</p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openPeer(member)}>
                          {existing ? '修改' : '写互评'}
                        </Button>
                      </li>
                    );
                  })}
              </ul>
              {coverage.total === 0 ? (
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  还没有同组同学。先在「课前：诊断与配对」生成方案，分组才会定下来。
                </p>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                互评不是打分游戏：没有一句依据的互评在复核时没有价值，所以提交前必须写清「你看到对方做了什么」。
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

      {/* 作品版本录入 */}
      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录一个新版本</DialogTitle>
            <DialogDescription>
              写清这一版改了什么。教师复核创新能力时，看的就是「改了几轮、每轮动了哪里」。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[12.5px]">
              版本标签
              <Input
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                placeholder="例如：v1 · 方案初稿 / v2 · 补充误差分析"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px]">
              这一版改了什么
              <Textarea
                value={versionNote}
                onChange={(event) => setVersionNote(event.target.value)}
                rows={3}
                placeholder="例如：把原来的匀速假设改成考虑摩擦，重算了制动距离。"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVersionOpen(false)}>
              取消
            </Button>
            <Button onClick={addVersion} disabled={versionLabel.trim().length === 0}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 组内互评录入 */}
      <Dialog open={peerTarget !== null} onOpenChange={(open) => !open && setPeerTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>评价 {peerTarget?.name}</DialogTitle>
            <DialogDescription>
              分数会与其他组员的评价一起汇总，只给教师看；同学之间看不到是谁给的。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span>贡献度</span>
                <span className="tabular-nums text-muted-foreground">{contribution}</span>
              </div>
              <Slider
                value={[contribution]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setContribution(value[0] ?? 0)}
                aria-label="贡献度"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span>协作表现</span>
                <span className="tabular-nums text-muted-foreground">{cooperation}</span>
              </div>
              <Slider
                value={[cooperation]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setCooperation(value[0] ?? 0)}
                aria-label="协作表现"
              />
            </div>
            <label className="flex flex-col gap-1.5 text-[12.5px]">
              依据（必填）
              <Textarea
                value={peerNote}
                onChange={(event) => setPeerNote(event.target.value)}
                rows={3}
                placeholder="例如：主动承担了数据采集，实验那天提前一小时到实验室调设备。"
              />
            </label>
            {peerError ? (
              <p className="text-[12px] text-[var(--school-danger)]">{peerError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPeerTarget(null)}>
              取消
            </Button>
            <Button onClick={savePeer}>提交互评</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
