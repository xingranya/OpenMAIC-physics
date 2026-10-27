'use client';

/**
 * 物理工作台共享展示组件。
 *
 * 全部为无业务副作用的展示层组件，供学生端 8 视图与教师端 5 视图复用。
 * 图表一律带 `role="img"` + `aria-label`，并提供可访问数据表 fallback，
 * 补齐旧项目"图表无数据表 fallback"的已知不足。
 */

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { DIAGNOSTIC_DIMENSIONS } from '@/lib/physics/data';
import { LEVEL_BANDS, LEVEL_LABELS, RUBRIC_ROWS } from '@/lib/physics/quant-rubric';
import type {
  DiagnosticDimension,
  SignalQuality,
  StageReview,
  StudentAck,
} from '@/lib/physics/types';

/** 页面标题区。 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 通用分区卡片。 */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('border-border/70 shadow-xs', className)}>
      {title ? (
        <CardHeader className="gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>
              {description ? (
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {action}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className={cn(title ? '' : 'pt-5', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** 指标瓦片。 */
export function MetricTile({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-[var(--school-success)]',
    warning: 'text-[var(--school-warning)]',
    danger: 'text-[var(--school-danger)]',
  }[tone];

  return (
    <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1 text-[26px] font-semibold leading-none tracking-tight', toneClass)}>
        {value}
        {unit ? (
          <span className="ml-1 text-[12px] font-normal text-muted-foreground">{unit}</span>
        ) : null}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** 能力维度的分项条形图（带可访问数据表）。 */
export function DimensionBars({
  dimensions,
  caption = '各知识维度得分',
  max = 100,
}: {
  dimensions: Partial<Record<DiagnosticDimension, number>>;
  caption?: string;
  max?: number;
}) {
  const rows = DIAGNOSTIC_DIMENSIONS.filter((dimension) => dimensions[dimension] !== undefined).map(
    (dimension) => ({ dimension, value: dimensions[dimension] ?? 0 }),
  );

  if (rows.length === 0) {
    return <p className="text-[13px] text-muted-foreground">尚无诊断数据，先完成学情诊断。</p>;
  }

  return (
    <figure className="m-0">
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const ratio = Math.max(0, Math.min(1, row.value / max));
          return (
            <div key={row.dimension} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-[12px] text-muted-foreground">
                {row.dimension}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${ratio * 100}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums">
                {row.value}
              </span>
            </div>
          );
        })}
      </div>
      <table className="physics-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">维度</th>
            <th scope="col">得分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimension}>
              <th scope="row">{row.dimension}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 通用柱状图（SVG），带可访问数据表 fallback。 */
export function SimpleBarChart({
  data,
  caption,
  height = 150,
  unit = '',
}: {
  data: readonly { label: string; value: number }[];
  caption: string;
  height?: number;
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const barWidth = data.length ? 100 / data.length : 100;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={caption}
        className="h-[150px] w-full"
      >
        {data.map((item, index) => {
          const barHeight = (item.value / max) * (height - 24);
          return (
            <g key={item.label}>
              <rect
                x={index * barWidth + barWidth * 0.18}
                y={height - 20 - barHeight}
                width={barWidth * 0.64}
                height={Math.max(1, barHeight)}
                rx={1.5}
                className="fill-primary"
              />
            </g>
          );
        })}
        <line
          x1={0}
          x2={100}
          y1={height - 20}
          y2={height - 20}
          className="stroke-border"
          strokeWidth={0.6}
        />
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {data.map((item) => (
          <li key={item.label}>
            {item.label} · {item.value}
            {unit}
          </li>
        ))}
      </ul>
      <table className="physics-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">项目</th>
            <th scope="col">数值{unit}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.label}>
              <th scope="row">{item.label}</th>
              <td>{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 进度条（带数值）。 */
export function ProgressRow({
  label,
  value,
  max = 100,
  className,
}: {
  label: string;
  value: number;
  max?: number;
  className?: string;
}) {
  const ratio = Math.max(0, Math.min(1, value / max));
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="w-24 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <Progress value={ratio * 100} className="h-2 flex-1" aria-label={label} />
      <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  );
}

/** 风险徽章。 */
export function RiskBadge({ risk }: { risk: '正常' | '关注' | '高风险' | '优秀' }) {
  const variant =
    risk === '高风险'
      ? 'destructive'
      : risk === '关注'
        ? 'secondary'
        : risk === '优秀'
          ? 'default'
          : 'outline';
  return (
    <Badge variant={variant} className="font-normal">
      {risk}
    </Badge>
  );
}

/** 信号质量徽章。 */
export function QualityBadge({ quality }: { quality: SignalQuality }) {
  const tone =
    quality === '良好'
      ? 'text-[var(--school-success)]'
      : quality === '较差'
        ? 'text-[var(--school-danger)]'
        : 'text-[var(--school-warning)]';
  return (
    <span className={cn('text-[12px] font-medium', tone)} aria-label={`信号质量 ${quality}`}>
      {quality}
    </span>
  );
}

/** 空状态。 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** 说明性提示条。 */
export function HintBar({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-md border border-primary/20 bg-[var(--school-primary-softer)] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground dark:bg-primary/10"
    >
      {children}
    </p>
  );
}

/**
 * ISO 时间 → 「10-27 14:05」。
 *
 * 解析失败时返回 `—` 而不是 `Invalid Date`：审核时间是从 localStorage 读回来的，
 * 手工改过或旧版本残留都可能不是合法时间，界面上直接印出 `Invalid Date`
 * 比不显示更糟——它看起来像 bug，实际只是脏数据。
 */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ══════════════════════════════════════════════════════════════════════
 * 三诊共用：审核状态与「学生认可」
 *
 * 申请书把每个环节都写成三步：AI 建议 → 教师审核 → 学生认可。
 * 这两个组件就是把后两步固定在界面上的东西——缺了它们，
 * 「AI 建议」看起来和「最终结论」长得一模一样，学生和老师都分不清
 * 哪一句还没被人看过。
 * ══════════════════════════════════════════════════════════════════════ */

/** 审核状态徽章。未审核时必须显眼——它表示「这条结论还没人负责」。 */
export function ReviewBadge({ review }: { review?: StageReview }) {
  const status = review?.status ?? 'pending';
  const label =
    status === 'approved' ? '教师已通过' : status === 'adjusted' ? '教师已调整' : '待教师审核';
  const variant = status === 'pending' ? 'secondary' : 'default';
  return (
    <Badge variant={variant} className="font-normal" data-review-status={status}>
      {label}
    </Badge>
  );
}

/** 审核意见（教师写了才显示）。 */
export function ReviewNote({ review }: { review?: StageReview }) {
  if (!review || review.status === 'pending' || !review.note) return null;
  return (
    <p className="rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">教师意见</span>
      {review.by ? `（${review.by}）` : ''}：{review.note}
    </p>
  );
}

/**
 * 学生认可条。
 *
 * 刻意做成「认可 / 有疑问」二选一而不是一个确认按钮：只给「已阅」的话，
 * 学生点一下就过，教师端收到的全是绿色，等于没有反馈渠道。
 * 选「有疑问」要求写一句理由——那句话正是教师下一轮要处理的东西。
 */
export function AckBar({
  ack,
  onAck,
  disabled,
  question = '你认可这条结论吗？',
}: {
  ack?: StudentAck;
  onAck: (accepted: boolean, note: string) => void;
  disabled?: boolean;
  question?: string;
}) {
  const [note, setNote] = React.useState('');
  const [open, setOpen] = React.useState(false);

  if (ack) {
    return (
      <p
        className={cn(
          'rounded-md border px-2.5 py-2 text-[12px] leading-relaxed',
          ack.accepted
            ? 'border-[var(--school-success)]/40 bg-[var(--school-success)]/8 text-foreground'
            : 'border-[var(--school-warning)]/40 bg-[var(--school-warning)]/8 text-foreground',
        )}
        data-student-ack={ack.accepted ? 'accepted' : 'questioned'}
      >
        <span className="font-medium">{ack.accepted ? '你已认可这条结论' : '你标记了疑问'}</span>
        {ack.note ? `：${ack.note}` : ''}
        <span className="ml-1 text-muted-foreground">教师端可见。</span>
      </p>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border px-2.5 py-2">
      <p className="text-[12px] text-muted-foreground">{question}</p>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            aria-label="疑问说明"
            placeholder="哪一步对不上？例如：我算出来是 9.9，但不知道自己漏了哪个条件。"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => onAck(false, note.trim())}
              disabled={disabled || note.trim().length === 0}
            >
              提交疑问
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">填一句理由再提交，教师才知道该看哪一步。</p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onAck(true, '')} disabled={disabled}>
            认可
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={disabled}>
            有疑问
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 四阶能力梯度发展量化评价表。
 *
 * 表格数据全部来自 `lib/physics/quant-rubric.ts`，界面不写死任何一个权重或
 * 层级描述——文档与界面必须同源，否则改了一处另一处就悄悄过期。
 *
 * 七个列在窄屏上必然放不下，所以外面套一层横向滚动，而不是把内容压成
 * 竖排或砍掉某一列：这张表的价值恰恰在「指标—AI 功能—层级—证据」四者
 * 并列，少一列就只剩下一个看不出因果的分数表。
 */
export function RubricTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className={cn('w-full border-collapse text-left', compact ? 'text-[11.5px]' : 'text-[12px]')}>
        <caption className="sr-only">四阶能力梯度发展量化评价表</caption>
        <thead>
          <tr className="bg-muted/50 text-muted-foreground">
            <th scope="col" className="min-w-[72px] border-b border-border/70 px-2 py-2 font-medium">
              能力维度
            </th>
            <th scope="col" className="min-w-[150px] border-b border-border/70 px-2 py-2 font-medium">
              量化指标及维度内权重
            </th>
            <th scope="col" className="min-w-[160px] border-b border-border/70 px-2 py-2 font-medium">
              AI 功能与数据输出
            </th>
            {(['basic', 'applied', 'challenge'] as const).map((level) => (
              <th
                key={level}
                scope="col"
                className="min-w-[150px] border-b border-border/70 px-2 py-2 font-medium"
              >
                {LEVEL_LABELS[level]}
                <span className="ml-1 font-normal text-[10px]">{LEVEL_BANDS[level].text}</span>
              </th>
            ))}
            <th scope="col" className="min-w-[150px] border-b border-border/70 px-2 py-2 font-medium">
              评价证据与采集时点
            </th>
          </tr>
        </thead>
        <tbody>
          {RUBRIC_ROWS.map((row) => (
            <tr key={row.ability} className="align-top">
              <th scope="row" className="border-b border-border/60 px-2 py-2 font-medium">
                {row.label}
              </th>
              <td className="border-b border-border/60 px-2 py-2">
                <ul className="flex flex-col gap-0.5">
                  {row.indicators.map((indicator) => (
                    <li key={indicator.label} className="flex justify-between gap-2">
                      <span>{indicator.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {Math.round(indicator.weight * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="border-b border-border/60 px-2 py-2">
                <ul className="flex flex-col gap-0.5">
                  {row.aiFunctions.map((item) => (
                    <li key={`${item.tag}-${item.text}`}>
                      <span className="mr-1 rounded border border-border px-1 text-[10px] text-muted-foreground">
                        {item.tag}
                      </span>
                      {item.text}
                    </li>
                  ))}
                </ul>
              </td>
              {(['basic', 'applied', 'challenge'] as const).map((level) => (
                <td
                  key={level}
                  className="border-b border-border/60 px-2 py-2 leading-relaxed text-muted-foreground"
                >
                  {row.levels[level]}
                </td>
              ))}
              <td className="border-b border-border/60 px-2 py-2 text-muted-foreground">
                <p>{row.evidence.join('、')}</p>
                <p className="mt-1">采集：{row.collectAt}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 三步闭环的当前进度条：AI 建议 → 教师审核 → 学生认可。 */
export function StageLoop({
  reviewed,
  acknowledged,
}: {
  reviewed: boolean;
  acknowledged: boolean;
}) {
  const steps = [
    { label: 'AI 建议', done: true },
    { label: '教师审核', done: reviewed },
    { label: '学生认可', done: acknowledged },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="三诊闭环进度">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-1.5">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px]',
              step.done
                ? 'border-primary/40 bg-[var(--school-primary-softer)] text-foreground dark:bg-primary/10'
                : 'border-border text-muted-foreground',
            )}
            aria-current={step.done ? 'step' : undefined}
          >
            {index + 1}. {step.label}
          </span>
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="text-[10px] text-muted-foreground">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
