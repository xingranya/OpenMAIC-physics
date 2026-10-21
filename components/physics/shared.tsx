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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { DIAGNOSTIC_DIMENSIONS } from '@/lib/physics/data';
import type { DiagnosticDimension, SignalQuality } from '@/lib/physics/types';

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
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
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
        {unit ? <span className="ml-1 text-[12px] font-normal text-muted-foreground">{unit}</span> : null}
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
              <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{row.dimension}</span>
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
