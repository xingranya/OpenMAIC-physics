/**
 * 品牌状态页：404 / 500 / 全局错误共用的视觉与文案。
 *
 * ## 为什么要有它
 *
 * Next.js 的默认错误页只有一句 "404 | This page could not be found"，
 * 对**参赛现场**来说是最不该出现的东西：评委随手点错一个链接，
 * 屏幕上就弹出一页没有校名、没有院徽的英文默认页——整个「专属产品」的印象当场垮掉。
 *
 * 所以三个错误出口（not-found / error / global-error）统一走这里：
 * 校徽 + 校名 + 班级 + 可回首页的入口。
 */
import Link from 'next/link';

import { BRAND_FULL_NAME, CONTEXT_LABEL, SCHOOL } from '@/lib/school/identity';

export interface BrandStatusPageProps {
  /** 大号状态码，如 404 / 500。 */
  code: string;
  /** 一句话说明。 */
  title: string;
  /** 补充说明：这个错误对用户意味着什么、下一步该做什么。 */
  description: string;
  /** 附加操作区（错误页要能「重试」）。 */
  action?: React.ReactNode;
}

export function BrandStatusPage({ code, title, description, action }: BrandStatusPageProps) {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center"
      style={{ background: 'var(--school-primary-softer, #f0f8fd)' }}
    >
      <img
        src={SCHOOL.emblemMarkSrc}
        alt={`${SCHOOL.college} 院徽`}
        width={62}
        height={60}
        className="size-24 object-contain"
      />

      <div className="flex flex-col items-center gap-2">
        <p
          className="text-6xl font-bold tabular-nums"
          style={{ color: 'var(--school-primary-strong, #075985)' }}
        >
          {code}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className="flex items-center gap-3">
        {action}
        <Link
          href="/"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{ background: 'var(--school-primary-strong, #075985)', color: '#fff' }}
        >
          返回物理学习门户
        </Link>
      </div>

      <footer className="mt-2 flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <span>{BRAND_FULL_NAME}</span>
        <span>{CONTEXT_LABEL}</span>
      </footer>
    </main>
  );
}
