'use client';

/**
 * 教师端 · 质量核验。
 *
 * ## 这一页存在的理由
 *
 * 量化评价表每一行最后都有「核验」一格，写着诊断一致率 / 任务匹配适切率 /
 * 反馈改进完成率 / 贡献证据可追溯率。如果这四个数算不出来，那张表就只是
 * 一张印得好看的纸——评委问一句「你们的一致率是多少」就答不上。
 *
 * 更要紧的是：这四个数是**用来自我质疑**的。AI 分层和教师判断差得多，
 * 说明分层阈值该改；推荐的案例学生几乎不采纳，说明匹配算法有问题；
 * 追问之后没人重答，说明追问没问到点上；证据覆盖率低，说明评价仍凭印象。
 *
 * ## 口径必须显示
 *
 * 四个指标都没有唯一正确的定义，所以每张卡片都把「分子 / 分母怎么数」
 * 写在同一行。一个不写口径的「87%」在评审现场等于「随便编的 87%」。
 *
 * ## 分母为 0 时显示「—」
 *
 * 「还没人提交」与「提交了但一条都没对上」是两件不同的事。都写成 0%
 * 会把前者误读成「系统烂」。
 */

import * as React from 'react';
import { AlertTriangle, ClipboardCheck, Info, RefreshCw, ShieldCheck, Target, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, HintBar, MetricTile, PageHeader, SectionCard } from '@/components/physics/shared';
import { cn } from '@/lib/utils';
import { readSubmissions, type StageSubmission } from '@/lib/physics/submissions';
import {
  buildVerification,
  ratioText,
  ratioVerdict,
  type Ratio,
  type VerificationReport,
} from '@/lib/physics/verification';

type MetricKey = 'diagnosisConsistency' | 'matchFitness' | 'improvementCompletion' | 'evidenceTraceability';

const METRICS: readonly {
  key: MetricKey;
  title: string;
  ability: string;
  hint: string;
}[] = [
  {
    key: 'diagnosisConsistency',
    title: '诊断一致率',
    ability: '知识能力',
    hint: 'AI 分到哪一层，教师认不认。',
  },
  {
    key: 'matchFitness',
    title: '任务匹配适切率',
    ability: '专业能力',
    hint: '推荐的项目，学生最后真的用了吗。',
  },
  {
    key: 'improvementCompletion',
    title: '反馈改进完成率',
    ability: '创新能力',
    hint: '被追问之后，有没有再答一次。',
  },
  {
    key: 'evidenceTraceability',
    title: '贡献证据可追溯率',
    ability: '团队合作',
    hint: '分工、日志、版本、互评，四类证据齐不齐。',
  },
];

function RatioCard({
  title,
  ability,
  hint,
  ratio,
  verdict,
}: {
  title: string;
  ability: string;
  hint: string;
  ratio: Ratio;
  verdict: string;
}) {
  const value = ratio.value;
  const tone = value === null ? 'default' : value >= 0.75 ? 'success' : value >= 0.5 ? 'warning' : 'danger';
  // 徽标只写状态词，不重复右上角已经显示过的百分比——
  // 同一个数字在一张卡片里出现两次，读的人会以为是两个不同的数。
  const status = value === null ? '无数据' : value >= 0.75 ? '达标' : value >= 0.5 ? '待改进' : '需干预';
  const toneClass = {
    default: 'text-foreground',
    success: 'text-[var(--school-success)]',
    warning: 'text-[var(--school-warning)]',
    danger: 'text-[var(--school-danger)]',
  }[tone];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{ability}</p>
        </div>
        <Badge variant="outline" className="shrink-0 font-normal">
          {status}
        </Badge>
      </div>
      <p className="text-[20px] font-semibold leading-none tabular-nums">
        {ratioText(value)}
        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
          {ratio.denominator > 0 ? `${ratio.numerator} / ${ratio.denominator}` : ''}
        </span>
      </p>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>
      <p className={cn('text-[11.5px] leading-relaxed', toneClass)}>{verdict}</p>
      <p className="border-t border-border/60 pt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        口径：{ratio.basis}
      </p>
    </div>
  );
}

export function TeacherVerify() {
  const [submissions, setSubmissions] = React.useState<StageSubmission[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  const refresh = React.useCallback(() => {
    setSubmissions(readSubmissions());
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    refresh();
    // 学生可能在另一个标签页里提交，storage 事件能立刻反映；
    // 同标签页切换账号靠 focus。
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const report: VerificationReport = React.useMemo(
    () => buildVerification(submissions),
    [submissions],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="质量核验"
        description="量化评价表里「核验」一列的四项指标。它们不是成绩，是用来判断这套 AI 建议可不可信的依据。"
        actions={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="size-4" />
            重新统计
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="参与统计的学生" value={report.submissionCount} unit="人" />
        <MetricTile
          label="已审核课前方案"
          value={report.diagnosisConsistency.denominator}
          unit="份"
          hint="未审核的不计入一致率"
        />
        <MetricTile
          label="有证据缺口的学生"
          value={report.gaps.length}
          unit="人"
          tone={report.gaps.length > 0 ? 'warning' : 'success'}
        />
        <MetricTile
          label="证据格子"
          value={`${report.evidenceTraceability.numerator}/${report.evidenceTraceability.denominator}`}
          hint="每名学生四格"
        />
      </div>

      {loaded && report.submissionCount === 0 ? (
        <EmptyState
          title="还没有学生提交"
          description="四项核验指标都建立在学生提交的三诊记录与证据快照上。先以学生身份走完课前 → 课中 → 课后，这里才有可统计的数据。"
        />
      ) : (
        <SectionCard
          title="四项核验指标"
          description="每张卡片下方写着口径——同一份数据按不同口径算出来可以差很多，所以口径必须跟数字一起出现。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {METRICS.map((metric) => (
              <RatioCard
                key={metric.key}
                title={metric.title}
                ability={metric.ability}
                hint={metric.hint}
                ratio={report[metric.key]}
                verdict={ratioVerdict(metric.key, report[metric.key].value)}
              />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="证据缺口"
        description="按缺得多的排前面。催证据时能指名道姓，比笼统说一句「证据不足」有用。"
      >
        {report.gaps.length === 0 ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden="true" />
            四类证据都已齐备。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <caption className="sr-only">学生证据缺口</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">学生</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">缺口</th>
                  <th scope="col" className="py-1.5 font-medium">还差什么</th>
                </tr>
              </thead>
              <tbody>
                {report.gaps.map((gap) => (
                  <tr key={gap.studentId} className="border-t border-border/60">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {gap.studentName}
                    </th>
                    <td className="py-1.5 pr-3 tabular-nums">{gap.missing.length} / 4</td>
                    <td className="py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {gap.missing.map((item) => (
                          <Badge key={item} variant="outline" className="font-normal">
                            {item}
                          </Badge>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="这四项怎么用"
        description="四个数一起看，才能判断该改哪一环。"
      >
        <ul className="flex flex-col gap-2.5 text-[12.5px] leading-relaxed">
          <li className="flex gap-2">
            <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>一致率低</strong>：先查分层阈值（60 / 75 / 90 与薄弱维度个数），
              再查诊断题是否被学生敷衍作答——不要先去调 AI 措辞，那是最后一环。
            </span>
          </li>
          <li className="flex gap-2">
            <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>适切率低</strong>：检查维度权重（薄弱维度 14 / 学习方式 14 / 能力目标 14 /
              专业亲和 10）。专业权重刻意低于薄弱维度，否则基础差的学生会被一直推本专业的高阶案例。
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>改进完成率低</strong>：多半是追问太泛（「再想想」）或太陡（一步跳到新模型）。
              课中题库的 `followUps` 可以逐题改，改完这一项会立刻反映出来。
            </span>
          </li>
          <li className="flex gap-2">
            <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>可追溯率低</strong>：缺的通常是作品版本与组内互评——这两类证据要学生自己动手，
              所以要在课堂上留出时间，而不是指望课后补。
            </span>
          </li>
        </ul>
      </SectionCard>

      <HintBar>
        <span className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            统计口径基于同一浏览器内的提交快照（共享键 `physicsAISystem:submissions`）。
            跨设备、跨浏览器的数据不在此列——那需要服务端，本平台目前是文件模式。
          </span>
        </span>
      </HintBar>
    </div>
  );
}
