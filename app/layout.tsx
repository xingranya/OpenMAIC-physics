import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { StorageHealthNotice } from '@/components/storage-health-notice';

// The UI font is loaded from @fontsource's stylesheet rather than next/font,
// because only the stylesheet carries the per-subset `unicode-range`
// declarations. Pointing next/font at `inter-latin-wght-normal.woff2` loaded
// exactly one subset, so every character outside Latin — Cyrillic for ru-RU,
// tone-marked letters for vi-VN — fell back to an arbitrary OS font and
// rendered in a different typeface mid-word.
//
// Declaring the other subset files as sibling faces of the same family does not
// fix it either: faces with identical descriptors and no `unicode-range` do not
// fall through per glyph, so the browser simply picks one.
//
// `--font-sans` moves to globals.css since the family no longer comes from
// next/font's generated class.
import '@fontsource-variable/inter';

import { BRAND_FULL_NAME, COURSE, PLATFORM, SCHOOL } from '@/lib/school/identity';

export const metadata: Metadata = {
  title: `${PLATFORM.systemName} · ${SCHOOL.college}`,
  // 描述里**不出现上游产品名**：本产品是「长江大学文理学院 · 大学物理 AI 智慧课堂」，
  // 面向学生与教师；开源归属声明放在 NOTICE 与《许可与致谢》里（许可合规的要求
  // 落在分发材料上，不需要出现在每一页的 meta 里）。
  description: `${SCHOOL.college}${COURSE.name}课程智慧教学工作台。融合多智能体 AI 课堂与"诊断→匹配→闯关→实验→报告"教学闭环，面向${COURSE.className}。`,
  // 分享卡片：统一校徽 + 校名 + 班级的静态 OG 图（public/brand/og-card.png）。
  // 不用运行期动态生成（next/og 依赖 satori + resvg，会明显增大函数包体积，
  // 而函数包只剩 3.6 MiB 余量），静态图足够且稳定。
  openGraph: {
    title: `${PLATFORM.systemName} · ${SCHOOL.college}`,
    description: `${COURSE.className} · 诊断 → 匹配 → 闯关 → 实验 → 报告`,
    images: [{ url: '/brand/og-card.png', width: 1200, height: 630, alt: BRAND_FULL_NAME }],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PLATFORM.systemName} · ${SCHOOL.college}`,
    description: `${COURSE.className} · 诊断 → 匹配 → 闯关 → 实验 → 报告`,
    images: ['/brand/og-card.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 本产品是**中文单语**（上游的多语言外壳在 M9-C 已删），
    // lang 必须是 zh-CN——写成 en 会让读屏软件用英文语音朗读中文页面。
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            <ServerProvidersInit />
            {children}
            <Toaster position="top-center" />
            {/* After the Toaster: this one raises a toast on mount when
                persistence is already broken, and a toast raised before its
                host exists has nowhere to go. */}
            <StorageHealthNotice />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
