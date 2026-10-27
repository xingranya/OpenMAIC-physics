'use client';

/**
 * 教师端 · 三诊审核台。
 *
 * ## 这一页解决的是「审核根本没法实施」的问题
 *
 * 学习数据按账号分区（`physicsAISystem:<userId>`），教师登录后读不到学生那份。
 * 所以学生的三诊结论会先写进共享提交键（`lib/physics/submissions.ts`），
 * 教师在这里读、在这里审，审完写回去，学生端再把结果并回自己的状态。
 *
 * ## 审核能改什么、不能改什么
 *
 * 只能改**结论**：通过 / 调整 + 意见，课后多一个修正分。
 * **不能改学生答了什么**——这是过程性评价的底线。教师把学生的答案改漂亮了，
 * 那份记录就不再是「学习过程」的证据，而是一份写好的材料。
 *
 * ## 适用范围要写在界面上
 *
 * 共享提交键只覆盖**同一浏览器内的两个账号**：评委在一台电脑上先以学生身份
 * 提交、退出、再以教师身份审核。跨设备需要服务端，而本平台目前是文件模式。
 * 这件事必须写出来，否则会被当成「已支持多端协同」——评审现场一问就露。
 */

import * as React from 'react';
import { CheckCircle2, ClipboardList, Info, RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { usePhysicsState } from '@/components/physics/state-provider';
import {
  EmptyState,
  HintBar,
  PageHeader,
  SectionCard,
  formatDateTime,
} from '@/components/physics/shared';
import { INCLASS_ERROR_LABELS } from '@/lib/physics/inclass-bank';
import {
  correctPostClass,
  readSubmissions,
  reviewExchange,
  reviewPreClass,
  type StageKey,
  type StageSubmission,
} from '@/lib/physics/submissions';
import { ABILITY_LABELS, TIER_LABELS, overallScore } from '@/lib/physics/stages';
import type { FourAbility, StageReview } from '@/lib/physics/types';

const TABS: readonly { key: StageKey; label: string }[] = [
  { key: 'preclass', label: '课前' },
  { key: 'inclass', label: '课中' },
  { key: 'postclass', label: '课后' },
];

const ABILITIES: readonly FourAbility[] = [
  'knowledge',
  'application',
  'innovation',
  'collaboration',
];

/** 通过 / 调整两个动作 + 一句意见。三个环节共用，所以抽出来。 */
function ReviewActions({
  review,
  onReview,
}: {
  review: StageReview;
  onReview: (status: 'approved' | 'adjusted', note: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState(review.note ?? '');

  if (review.status !== 'pending') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
        <Badge variant="default" className="font-normal">
          <CheckCircle2 className="size-3" aria-hidden="true" />
          {review.status === 'approved' ? '已通过' : '已调整'}
        </Badge>
        <span>
          {review.by ?? '教师'} · {formatDateTime(review.at)}
        </span>
        {review.note ? <span className="w-full">意见：{review.note}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onReview('approved', note.trim())}>
          通过
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          调整并说明
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            aria-label="审核意见"
            placeholder="例如：分层判到应用提升型偏高了，先做一层基础案例更稳。"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={note.trim().length === 0}
              onClick={() => onReview('adjusted', note.trim())}
            >
              提交调整
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">「调整」必须写一句理由，学生端会看到。</p>
        </div>
      ) : null}
    </div>
  );
}

export function TeacherReviews() {
  const { state, session } = usePhysicsState();
  const teacherName = state.teacher?.name ?? session?.displayName ?? '任课教师';

  const [submissions, setSubmissions] = React.useState<StageSubmission[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<StageKey>('preclass');
  const [score, setScore] = React.useState(80);
  const [postNote, setPostNote] = React.useState('');

  const refresh = React.useCallback(() => {
    setSubmissions(readSubmissions());
  }, []);

  React.useEffect(() => {
    refresh();
    // 学生可能在**另一个标签页**里提交，storage 事件能让我们立刻看到；
    // 同标签页切换账号则靠 focus。
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const active = submissions.find((item) => item.studentId === activeId) ?? submissions[0] ?? null;

  // 学生换了之后，修正分要跟着换到他那份的当前值上，否则会带着上一个人的分数。
  // 依赖刻意只放「谁的、哪一次生成」：把 abilities 也放进依赖会在拖动滑块后
  // 把分数重置回 AI 建议值（滑块自己改的就是 score）。
  React.useEffect(() => {
    if (!active?.postClass) return;
    setScore(active.postClass.teacher?.score ?? overallScore(active.postClass.abilities));
    setPostNote(active.postClass.teacher?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.studentId, active?.postClass?.generatedAt]);

  const pendingCount = (item: StageSubmission, stage: StageKey): number => {
    if (stage === 'preclass') return item.preClass?.review.status === 'pending' ? 1 : 0;
    if (stage === 'postclass') return item.postClass && !item.postClass.teacher ? 1 : 0;
    return item.inClass.filter((exchange) => exchange.review.status === 'pending').length;
  };

  const review = (status: 'approved' | 'adjusted', note: string): StageReview => ({
    status,
    note: note || undefined,
    by: teacherName,
    at: new Date().toISOString(),
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="三诊审核"
        description="课前分层配对、课中追问结论、课后过程性评价，都在这里逐条过一遍。审核结果学生端立刻可见。"
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" />
            刷新提交
          </Button>
        }
      />

      {submissions.length === 0 ? (
        <EmptyState
          title="还没有学生提交三诊记录"
          description="让演示学生登录后，在「课前：诊断与配对」「课中：伴随诊断」「课后：过程评价」里各提交一次，这里就会出现。"
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <SectionCard title="学生" description={`${submissions.length} 人已提交`}>
            <ul className="flex flex-col gap-1.5">
              {submissions.map((item) => {
                const isActive = active?.studentId === item.studentId;
                const pending =
                  pendingCount(item, 'preclass') +
                  pendingCount(item, 'inclass') +
                  pendingCount(item, 'postclass');
                return (
                  <li key={item.studentId}>
                    <button
                      type="button"
                      onClick={() => setActiveId(item.studentId)}
                      aria-pressed={isActive}
                      className={
                        isActive
                          ? 'w-full rounded-md border border-primary bg-[var(--school-primary-softer)] px-2.5 py-2 text-left dark:bg-primary/10'
                          : 'w-full rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:border-primary/40'
                      }
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium">{item.studentName}</span>
                        {pending > 0 ? (
                          <Badge variant="destructive" className="font-normal">
                            {pending}
                          </Badge>
                        ) : (
                          <CheckCircle2
                            className="size-3.5 text-[var(--school-success)]"
                            aria-label="已审完"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="选择环节">
              {TABS.map((item) => {
                const count = active ? pendingCount(active, item.key) : 0;
                const isActive = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(item.key)}
                    className={
                      isActive
                        ? 'rounded-full border border-primary bg-primary px-3 py-1 text-[12px] text-primary-foreground'
                        : 'rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/50'
                    }
                  >
                    {item.label}
                    {count > 0 ? ` · 待审 ${count}` : ''}
                  </button>
                );
              })}
            </div>

            {!active ? null : tab === 'preclass' ? (
              <SectionCard
                title="课前：分层与配对"
                description={`${active.studentName} · 提交于 ${formatDateTime(active.preClass?.submittedAt)}`}
              >
                {active.preClass ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-normal">
                        {TIER_LABELS[active.preClass.tier]}
                      </Badge>
                      <span className="text-[12px] text-muted-foreground">
                        {active.preClass.groupId} · 分工「{active.preClass.groupRole}」
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {active.preClass.matches.map((match) => (
                        <li
                          key={match.project.id}
                          className="rounded-md border border-border/70 px-2.5 py-1.5 text-[12px]"
                        >
                          <span className="font-medium">{match.project.title}</span>
                          <span className="ml-2 text-muted-foreground">{match.project.level}</span>
                        </li>
                      ))}
                    </ul>
                    {active.preClass.weakDimensions.length > 0 ? (
                      <p className="text-[12px] text-muted-foreground">
                        薄弱维度：{active.preClass.weakDimensions.join('、')}
                      </p>
                    ) : null}
                    {active.preClass.ack ? (
                      <p className="text-[12px] text-muted-foreground">
                        学生{active.preClass.ack.accepted ? '已认可' : '有疑问'}
                        {active.preClass.ack.note ? `：${active.preClass.ack.note}` : ''}
                      </p>
                    ) : null}
                    <ReviewActions
                      review={active.preClass.review}
                      onReview={(status, note) => {
                        reviewPreClass({
                          studentId: active.studentId,
                          review: review(status, note),
                        });
                        refresh();
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">该生还没有生成课前方案。</p>
                )}
              </SectionCard>
            ) : tab === 'inclass' ? (
              <SectionCard
                title="课中：追问结论"
                description="通过后，学生端的参考答案才会解锁。"
              >
                {active.inClass.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">该生还没有课中作答记录。</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {[...active.inClass].reverse().map((exchange) => (
                      <li
                        key={exchange.id}
                        className="rounded-lg border border-border/70 px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={exchange.errorKind === 'correct' ? 'default' : 'secondary'}
                            className="font-normal"
                          >
                            {INCLASS_ERROR_LABELS[exchange.errorKind]}
                          </Badge>
                          <span className="text-[11.5px] text-muted-foreground">
                            {exchange.anchor} · {formatDateTime(exchange.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed">
                          学生答：{exchange.answer}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          AI 依据：{exchange.evidence}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          追问：{exchange.followUp}
                        </p>
                        {exchange.ack ? (
                          <p className="mt-1 text-[11.5px] text-muted-foreground">
                            学生{exchange.ack.accepted ? '已认可' : '有疑问'}
                            {exchange.ack.note ? `：${exchange.ack.note}` : ''}
                          </p>
                        ) : null}
                        <div className="mt-2">
                          <ReviewActions
                            review={exchange.review}
                            onReview={(status, note) => {
                              reviewExchange({
                                studentId: active.studentId,
                                exchangeId: exchange.id,
                                review: review(status, note),
                              });
                              refresh();
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </SectionCard>
            ) : (
              <SectionCard
                title="课后：过程性评价"
                description={`${active.studentName} · 生成于 ${formatDateTime(active.postClass?.generatedAt)}`}
              >
                {active.postClass ? (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ABILITIES.map((ability) => (
                        <div
                          key={ability}
                          className="rounded-md border border-border/70 px-2.5 py-2"
                        >
                          <p className="text-[10.5px] text-muted-foreground">
                            {ABILITY_LABELS[ability]}
                          </p>
                          <p className="text-[18px] font-semibold tabular-nums">
                            {active.postClass?.abilities[ability]}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      AI 综合分 {overallScore(active.postClass.abilities)} · 课前诊断{' '}
                      {active.postClass.contributions.preClass} · 课中参与{' '}
                      {active.postClass.contributions.inClass} · 任务完成{' '}
                      {active.postClass.contributions.task}
                    </p>

                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <label htmlFor="post-score" className="text-[12px] font-medium">
                          修正分
                        </label>
                        <span className="text-[13px] font-semibold tabular-nums text-primary">
                          {score}
                        </span>
                      </div>
                      <Slider
                        id="post-score"
                        value={[score]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(next) => setScore(next[0] ?? score)}
                        aria-label="修正分"
                      />
                    </div>

                    <Textarea
                      value={postNote}
                      onChange={(event) => setPostNote(event.target.value)}
                      rows={3}
                      aria-label="修正理由"
                      placeholder="例如：课中两轮追问都自己改对了，团队合作上调 5 分。"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          correctPostClass({
                            studentId: active.studentId,
                            score,
                            note: postNote.trim(),
                          });
                          refresh();
                        }}
                      >
                        <ShieldCheck className="size-3.5" />
                        保存修正
                      </Button>
                      {active.postClass.teacher ? (
                        <span className="text-[11.5px] text-muted-foreground">
                          上次修正 {active.postClass.teacher.score} 分 ·{' '}
                          {formatDateTime(active.postClass.teacher.at)}
                        </span>
                      ) : null}
                    </div>

                    {active.postClass.ack ? (
                      <p className="text-[12px] text-muted-foreground">
                        学生{active.postClass.ack.accepted ? '已认可' : '有疑问'}
                        {active.postClass.ack.note ? `：${active.postClass.ack.note}` : ''}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">该生还没有生成课后评价。</p>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      )}

      <HintBar>
        <span className="flex items-start gap-2">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            提交与审核走<strong>同一浏览器内的共享键</strong>：学生提交后退出、以教师身份登录即可审核。
            跨设备需要服务端，而本平台目前是文件模式，课堂数据不保证跨实例保留。
          </span>
        </span>
      </HintBar>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ClipboardList className="size-3.5" aria-hidden="true" />
        审核只能改结论与意见，不能改学生答了什么。
      </p>
    </div>
  );
}
