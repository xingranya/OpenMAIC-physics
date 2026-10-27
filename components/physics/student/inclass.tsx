'use client';

/**
 * 学生端 · 课中：伴随式诊断与追问。
 *
 * 对应「三诊」的第二诊，也是「五环」里的**导**。
 *
 * ## 为什么判定结果不是「对 / 错」
 *
 * 课中追问的价值在于**指出错在哪一类**：概念记反了，该回去重读定义；
 * 模型选错了，该重写「本题用什么定律」；单位漏了，该做量纲检查。
 * 三者的补救动作完全不同，混成一个红叉，学生只知道「我错了」，
 * 不知道该改哪一步——这正是申请书里「从结果评分转向过程性评价」
 * 要解决的问题在课堂层面的样子。
 *
 * ## 参考答案为什么要等教师审核
 *
 * 判定由本地规则引擎给出（命中关键词、关键点、单位），它不是模型推理，
 * 会有误判。直接把参考答案摊开，学生看到的可能是一条判错的结论。
 * 所以参考答案在 `review.status === 'pending'` 时是锁着的——
 * 教师通过或调整后才解锁，这也让「教师审核」这一步有真实的作用，
 * 而不只是流程上的一个勾。
 */

import * as React from 'react';
import { AlertTriangle, Lightbulb, Lock, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePhysicsState } from '@/components/physics/state-provider';
import { useSharedReviewSync } from '@/components/physics/use-shared-review-sync';
import {
  AckBar,
  HintBar,
  PageHeader,
  ReviewBadge,
  ReviewNote,
  SectionCard,
  formatDateTime,
} from '@/components/physics/shared';
import { INCLASS_ERROR_LABELS, INCLASS_QUESTIONS, diagnoseInClassAnswer } from '@/lib/physics/inclass-bank';
import { weakDimensionsOf } from '@/lib/physics/stages';
import { ackStage, publishInClassExchange } from '@/lib/physics/submissions';
import type { InClassErrorKind, InClassExchange } from '@/lib/physics/types';

function errorTone(kind: InClassErrorKind): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (kind === 'correct') return 'default';
  if (kind === 'concept' || kind === 'model') return 'destructive';
  return 'secondary';
}

export function StudentInClass() {
  const { state, update, session } = usePhysicsState();
  useSharedReviewSync();

  const studentId = session?.userId ?? state.student?.id ?? 'demo-student';
  const studentName = state.student?.name ?? session?.displayName ?? '演示学生';

  // 默认挑一道落在薄弱维度上的题：课中时间有限，先问最该问的那道。
  const defaultQuestionId = React.useMemo(() => {
    if (!state.diagnosis) return INCLASS_QUESTIONS[0]?.id ?? '';
    const weak = weakDimensionsOf(state.diagnosis, 1)[0];
    const hit = INCLASS_QUESTIONS.find((item) => item.dimension === weak);
    return hit?.id ?? INCLASS_QUESTIONS[0]?.id ?? '';
  }, [state.diagnosis]);

  const [questionId, setQuestionId] = React.useState(defaultQuestionId);
  const [answer, setAnswer] = React.useState('');
  const [lastId, setLastId] = React.useState<string | null>(null);

  const question =
    INCLASS_QUESTIONS.find((item) => item.id === questionId) ?? INCLASS_QUESTIONS[0];
  const history = [...state.inClass].reverse();
  const last = lastId ? state.inClass.find((item) => item.id === lastId) ?? null : null;

  const submit = () => {
    if (!question || answer.trim().length === 0) return;
    const result = diagnoseInClassAnswer(question, answer);
    const exchange: InClassExchange = {
      id: `${question.id}-${Date.now()}`,
      questionId: question.id,
      answer: answer.trim(),
      errorKind: result.errorKind,
      evidence: result.evidence,
      followUp: result.followUp,
      reference: result.reference,
      anchor: result.anchor,
      createdAt: new Date().toISOString(),
      review: { status: 'pending' },
    };
    update({ inClass: [...state.inClass, exchange] });
    publishInClassExchange({ studentId, studentName, exchange });
    setLastId(exchange.id);
    setAnswer('');
  };

  const acknowledge = (exchange: InClassExchange, accepted: boolean, note: string) => {
    const ack = { accepted, note: note || undefined, at: new Date().toISOString() };
    update({
      inClass: state.inClass.map((item) => (item.id === exchange.id ? { ...item, ack } : item)),
    });
    ackStage({ studentId, stage: 'inclass', ack, exchangeId: exchange.id });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="课中：伴随诊断"
        description="写下你的思路，AI 会指出错在哪一类并给出追问——不是打分。参考答案由教师审核后开放。"
      />

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-5">
          <SectionCard title="选一道题" description="已按你的薄弱维度排在前面">
            <ul className="grid gap-2 sm:grid-cols-2">
              {INCLASS_QUESTIONS.map((item) => {
                const active = item.id === question?.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setQuestionId(item.id)}
                      aria-pressed={active}
                      className={
                        active
                          ? 'h-full w-full rounded-lg border border-primary bg-[var(--school-primary-softer)] px-3 py-2 text-left dark:bg-primary/10'
                          : 'h-full w-full rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary/40'
                      }
                    >
                      <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        <Badge variant="outline" className="font-normal">
                          {item.dimension}
                        </Badge>
                        <span className="truncate">{item.anchor}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[12.5px] leading-relaxed">
                        {item.prompt}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          {question ? (
            <SectionCard title="作答" description={question.prompt}>
              <Textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={5}
                aria-label="课中作答"
                placeholder="把推理过程写出来，不要只写结果。例如：机械能守恒，mgh = ½mv²，质量约去，v = √(2×9.8×5) ≈ 9.9 m/s。"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button onClick={submit} disabled={answer.trim().length === 0}>
                  <Send className="size-4" />
                  提交并请求追问
                </Button>
                <span className="text-[11.5px] text-muted-foreground">
                  判定在本机完成，不联网、不调用模型。
                </span>
              </div>
            </SectionCard>
          ) : null}

          {last ? (
            <SectionCard
              title="AI 判定"
              description={`${last.anchor} · ${formatDateTime(last.createdAt)}`}
              action={<ReviewBadge review={last.review} />}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={errorTone(last.errorKind)} className="font-normal">
                    {INCLASS_ERROR_LABELS[last.errorKind]}
                  </Badge>
                  <span className="text-[11.5px] text-muted-foreground">
                    依据：{last.evidence}
                  </span>
                </div>

                <div className="rounded-lg border border-primary/25 bg-[var(--school-primary-softer)] px-3 py-2.5 dark:bg-primary/10">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium">
                    <Lightbulb className="size-3.5" aria-hidden="true" />
                    追问
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed">{last.followUp}</p>
                </div>

                <ReviewNote review={last.review} />

                {last.review.status === 'pending' ? (
                  <p className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-[12px] text-muted-foreground">
                    <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    参考答案待教师审核后开放。判错一次不要紧，先按追问把思路补完整。
                  </p>
                ) : (
                  <div className="rounded-lg border border-border/70 px-3 py-2.5">
                    <p className="text-[12px] font-medium">参考答案</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {last.reference}
                    </p>
                  </div>
                )}

                <AckBar
                  ack={last.ack}
                  onAck={(accepted, note) => acknowledge(last, accepted, note)}
                  question="这条追问对你有帮助吗？"
                />
              </div>
            </SectionCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard title="本轮记录" description={`共 ${state.inClass.length} 轮问答`}>
            {history.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                还没有作答记录。课中参与占团队合作的一半权重，答错也算参与。
              </p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {history.map((item) => {
                  const source = INCLASS_QUESTIONS.find((q) => q.id === item.questionId);
                  return (
                    <li key={item.id} className="rounded-lg border border-border/70 px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={errorTone(item.errorKind)} className="font-normal">
                          {INCLASS_ERROR_LABELS[item.errorKind]}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {source?.dimension ?? item.anchor}
                        </span>
                        {item.ack ? (
                          <span className="text-[11px] text-muted-foreground">
                            · {item.ack.accepted ? '已认可' : '有疑问'}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {item.answer}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </SectionCard>

          <HintBar>
            课中判定是<strong>本地规则引擎</strong>按关键词与关键点做的，会有误判。
            所以参考答案要等教师审核——判错时以教师意见为准。
          </HintBar>

          {state.inClass.some((item) => item.review.status === 'pending') ? (
            <p className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              有 {state.inClass.filter((item) => item.review.status === 'pending').length}{' '}
              条结论还在等教师审核。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
