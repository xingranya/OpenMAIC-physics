'use client';

import { useEffect } from 'react';

import { BRAND_FULL_NAME, CONTEXT_LABEL, SCHOOL } from '@/lib/school/identity';

/**
 * 根级错误边界（layout 之外的异常）。
 *
 * Next.js 要求这个组件**自己渲染 `<html>` / `<body>`**（它替换整个文档根），
 * 所以这里不能复用 `BrandStatusPage`（那个组件只渲染 `<main>`）。
 * 样式仍然保持同一套：院徽 + 校名 + 班级。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[classroom] 根级错误：', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          fontFamily:
            '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif',
          background: '#f0f8fd',
          color: '#0f172a',
          textAlign: 'center',
          padding: '48px 24px',
        }}
      >
        <img src={SCHOOL.emblemSrc} alt={`${SCHOOL.college} 院徽`} width={96} height={96} />
        <p style={{ fontSize: 56, fontWeight: 700, color: '#075985', margin: 0 }}>500</p>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>这个页面暂时出错了</h1>
        <p style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.7, color: '#475569', margin: 0 }}>
          可以先重试一次；如果仍然失败，回到物理学习门户继续演示其余环节——
          预置课程包与本地数据不依赖该页面。
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              borderRadius: 8,
              border: '1px solid #075985',
              background: '#fff',
              color: '#075985',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          <a
            href="/"
            style={{
              padding: '8px 16px',
              fontSize: 14,
              borderRadius: 8,
              background: '#075985',
              color: '#fff',
              textDecoration: 'none',
            }}
          >
            返回物理学习门户
          </a>
        </div>
        <footer
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
            color: '#64748b',
          }}
        >
          <span>{BRAND_FULL_NAME}</span>
          <span>{CONTEXT_LABEL}</span>
        </footer>
      </body>
    </html>
  );
}
