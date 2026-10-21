/**
 * 校本视觉规范 —— 长江大学文理学院
 *
 * 颜色与字体沿用教师已确认的"浅色学术工作台"方向：主色天蓝（学术理性），
 * 灰白背景，避免营销式饱和配色。所有颜色同时给出浅色/深色两套，
 * 以便在 OpenMAIC 的深色模式下维持 WCAG AA 对比度。
 *
 * 本文件是纯数据，不依赖 React / DOM，可被服务端导出链路（PPTX、离线 HTML）
 * 与客户端界面同时引用。
 */
import { COURSE, SCHOOL } from './identity';

/** 颜色令牌。 */
export interface BrandTokens {
  /** 主色：校徽主色，学术理性。 */
  primary: string;
  /** 主色深阶：悬停与强调文字。 */
  primaryStrong: string;
  /** 主色浅阶：浅色填充背景。 */
  primarySoft: string;
  /** 主色极浅阶：页面分区背景。 */
  primarySofter: string;
  /** 主色上的前景文字色。 */
  primaryForeground: string;
  /** 成功态。 */
  success: string;
  /** 警告态。 */
  warning: string;
  /** 危险态。 */
  danger: string;
  /** 侧栏底色。 */
  sidebar: string;
  /** 侧栏前景色。 */
  sidebarForeground: string;
  /** 侧栏次要文字色。 */
  sidebarMuted: string;
  /** 页面背景（浅色模式）。 */
  surface: string;
  /** 页面背景（深色模式）。 */
  surfaceDark: string;
}

export const BRAND_TOKENS: BrandTokens = {
  primary: '#0369a1',
  primaryStrong: '#075985',
  primarySoft: '#e0f2fe',
  primarySofter: '#f0f8fd',
  primaryForeground: '#ffffff',
  success: '#1c7c59',
  warning: '#a96519',
  danger: '#b54444',
  sidebar: '#082f49',
  sidebarForeground: '#e6f2fb',
  sidebarMuted: '#9cc8e8',
  surface: '#f8fafc',
  surfaceDark: '#020617',
};

/** 字体栈：中文优先苹方/微软雅黑，西文回落到系统 sans。 */
export const FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** 字号阶梯（像素）。 */
export const FONT_SCALE = {
  display: 32,
  metricLarge: 26,
  metric: 20,
  body: 15,
  small: 13,
  micro: 11,
} as const;

/** 圆角阶梯（rem）。 */
export const RADIUS_SCALE = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.625rem',
  xl: '0.75rem',
} as const;

/**
 * 幻灯片主题（导出 PPTX 与课堂播放共用）。
 * 选取品牌色系的浅底/深底两套，保证投影环境下白字黑字均可读。
 */
export interface SchoolSlideTheme {
  name: string;
  background: string;
  fontColor: string;
  borderColor: string;
  colors: string[];
}

export const SCHOOL_SLIDE_THEMES: SchoolSlideTheme[] = [
  {
    name: '文理学院 · 天蓝',
    background: '#ffffff',
    fontColor: '#1e293b',
    borderColor: '#0369a1',
    colors: ['#0369a1', '#1c7c59', '#a96519', '#b54444', '#7c3aed', '#0891b2'],
  },
  {
    name: '文理学院 · 深海',
    background: '#082f49',
    fontColor: '#e6f2fb',
    borderColor: '#38bdf8',
    colors: ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'],
  },
];

/**
 * 打印样式：隐藏导航与交互控件，强制白底黑字，
 * 并在页眉打印学校与课程标识。
 */
export const PRINT_STYLESHEET = `
@media print {
  .no-print { display: none !important; }
  body { background: #ffffff !important; }
  [data-sidebar] { display: none !important; }
  main { padding: 0 !important; }
  * { box-shadow: none !important; text-shadow: none !important; }
  a { color: inherit !important; text-decoration: none !important; }
  .print-header {
    display: block !important;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
}
.print-header { display: none; }
`;

/**
 * 导出页眉页脚：PPTX 与离线 HTML 共用。
 *
 * 页眉贴顶、页脚贴底，两端都带"学校 · 课程"文字标识：课件进了讲台、
 * 传给了学生，出处一眼可辨。
 */
export interface ExportBrandText {
  /** 固定标识：学校 · 课程。 */
  left: string;
  /** 场景信息：页眉为章节，页脚为授课教师；可为空。 */
  right: string;
}

/**
 * 导出页眉文案（贴顶）。
 * @param chapter 章节标题
 */
export function buildExportHeader(chapter?: string): ExportBrandText {
  return { left: `${SCHOOL.college} · ${COURSE.name}`, right: chapter ?? '' };
}

/**
 * 导出页脚文案（贴底）。
 * @param teacher 授课教师
 */
export function buildExportFooter(teacher?: string): ExportBrandText {
  return { left: `${SCHOOL.college} · ${COURSE.name}`, right: teacher ?? '' };
}

/** 幻灯片页眉/页脚的排版规格（与 DSL 无关，由导出层转换）。 */
export interface SlideBrandSpec {
  /** 文字内容。 */
  text: string;
  /** 左边距（px）。 */
  left: number;
  /** 上边距（px）。 */
  top: number;
  /** 宽度（px）。 */
  width: number;
  /** 高度（px）。 */
  height: number;
  /** 字号（px）。 */
  fontSize: number;
  /** 文字颜色。 */
  color: string;
}

/** 把固定标识与场景信息拼成一行。 */
function joinBrandText(brand: ExportBrandText): string {
  return brand.right ? `${brand.left} · ${brand.right}` : brand.left;
}

/**
 * 生成幻灯片页眉规格（贴顶）。
 *
 * 放在标题元素之上：预置课堂包的标题位于 top=56，页眉占 14~38，互不遮挡。
 */
export function buildSlideHeaderSpec(
  viewportSize: number,
  color: string,
  chapter?: string,
): SlideBrandSpec {
  const margin = Math.round(viewportSize * 0.07);
  const height = Math.round(viewportSize * 0.045);
  return {
    text: joinBrandText(buildExportHeader(chapter)),
    left: margin,
    top: Math.round(viewportSize * 0.015),
    width: viewportSize - margin * 2,
    height,
    fontSize: Math.max(10, Math.round(viewportSize * 0.016)),
    color,
  };
}

/**
 * 生成幻灯片页脚规格（贴底）。
 *
 * 位置按视口比例计算，因此在 16:9 与 4:3 下都贴底。
 */
export function buildSlideFooterSpec(
  viewportSize: number,
  viewportRatio: number,
  color: string,
  teacher?: string,
): SlideBrandSpec {
  const margin = Math.round(viewportSize * 0.07);
  const height = Math.round(viewportSize * 0.045);
  return {
    text: joinBrandText(buildExportFooter(teacher)),
    left: margin,
    top: Math.round(viewportSize * viewportRatio) - height - Math.round(viewportSize * 0.02),
    width: viewportSize - margin * 2,
    height,
    fontSize: Math.max(10, Math.round(viewportSize * 0.016)),
    color,
  };
}
