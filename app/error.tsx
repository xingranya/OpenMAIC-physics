'use client';

import { useEffect } from 'react';

import { BrandStatusPage } from '@/components/physics/brand-status-page';

/**
 * 路由级错误页（500）。
 *
 * 覆盖 Next.js 的默认英文错误页，并给出「重试」入口——
 * 演示现场遇到偶发错误时，评委能自己点一下重试，而不是盯着一句英文报错。
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 留在控制台里，方便现场排障（页面本身不暴露堆栈）。
    console.error('[classroom] 路由级错误：', error);
  }, [error]);

  return (
    <BrandStatusPage
      code="500"
      title="这个页面暂时出错了"
      description="可以先重试一次；如果仍然失败，回到物理学习门户继续演示其余环节——预置课程包与本地数据不依赖该页面。"
      action={
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          style={{
            borderColor: 'var(--school-primary-strong, #075985)',
            color: 'var(--school-primary-strong, #075985)',
          }}
        >
          重试
        </button>
      }
    />
  );
}
