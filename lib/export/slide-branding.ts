/**
 * 幻灯片校本标识装饰（PPTX 导出用）。
 *
 * 导出的每一页都贴一条**页眉**（顶），内容是"学校 · 课程 · 章节"。
 * 贴底那条是"学校 · 课程 · 教师"，但**画布自带贴底校名标识**（元素 id 以
 * `-brand` 结尾）时会自动去重——此时贴底的标识由画布自带元素提供，
 * 它只有"学校 · 课程"，不含教师名。
 * 两端都带"学校 · 课程"文字标识：课件进了讲台、传给了学生，出处一眼可辨。
 *
 * 抽成纯函数有两个理由：
 *  1. 可测——"导出到底带不带页眉/页脚"不应该只能靠肉眼打开 PPTX 核对；
 *  2. 幂等——预置课堂包的画布里已经有一条贴底的校名标识（元素 id 以
 *     `-brand` 结尾），导出时若再补一条页脚，两行字会叠在一起。
 *     幂等同时保证"已装饰的画布被再送进来一次"不会变成两条页眉
 *     （第八轮复审实测过这个回归路径）。
 *
 * 装饰只作用在**导出副本**上，不改动课堂存储里的原始画布。
 */
import { buildSlideFooterSpec, buildSlideHeaderSpec } from '@/lib/school';

/** 校本标识文本元素的最小形状（与 DSL 的文本元素对齐）。 */
export interface BrandTextElement {
  id: string;
  type: 'text';
  content: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  defaultFontName: string;
  defaultFontSize: number;
  defaultColor: string;
  fontSize: number;
  textAlign: 'left';
}

/** 页眉元素 id 前缀。 */
export const SLIDE_BRAND_HEADER_ID_PREFIX = 'school-header-';
/** 页脚元素 id 前缀。 */
export const SLIDE_BRAND_FOOTER_ID_PREFIX = 'school-footer-';

/** 画布中可能已经存在的校本标识元素 id 后缀。 */
export const INLINE_BRAND_ID_SUFFIX = '-brand';

/** 一张待装饰的幻灯片的最小形状。 */
export interface BrandedSlideLike {
  id: string;
  elements: readonly { id: string }[];
  viewportSize?: number;
  viewportRatio?: number;
  theme?: { fontColor?: string } | null;
}

/** 装饰参数。 */
export interface SlideBrandOptions {
  /** 章节标题（页眉右侧）。 */
  chapter?: string;
  /** 授课教师（页脚右侧）。 */
  teacher?: string;
  /** 画布未声明视口尺寸时的回退值。 */
  viewportSize: number;
  /** 画布未声明宽高比时的回退值。 */
  viewportRatio: number;
}

/**
 * 判断画布里是否已自带一条贴底的校名标识。
 *
 * 预置课堂包在构建画布时就把「学校 · 课程」写进了元素（id 以 `-brand` 结尾），
 * 导出时再加一条页脚就会重叠，因此这里要跳过重复装饰。
 */
export function hasInlineBrandElement(elementIds: readonly string[]): boolean {
  return elementIds.some((id) => id.endsWith(INLINE_BRAND_ID_SUFFIX));
}

function toTextElement(
  id: string,
  spec: ReturnType<typeof buildSlideHeaderSpec>,
): BrandTextElement {
  return {
    id,
    type: 'text',
    // PPTX 渲染器只读内容里的内联样式（`font-size` / `color`），
    // 元素上的 `fontSize` 字段在导出链路上是死的——不写进内容，
    // 页眉页脚就会退化成与正文同号的固定字号，大视口下明显偏小。
    // 画布渲染器同样以 innerHTML 渲染文本内容，两条链路都吃得下这个 span。
    content: `<span style="font-size:${spec.fontSize}px;color:${spec.color}">${spec.text}</span>`,
    left: spec.left,
    top: spec.top,
    width: spec.width,
    height: spec.height,
    rotate: 0,
    defaultFontName: 'PingFang SC',
    defaultFontSize: spec.fontSize,
    defaultColor: spec.color,
    fontSize: spec.fontSize,
    textAlign: 'left',
  };
}

/**
 * 为一张幻灯片生成校本页眉与页脚文本元素。
 *
 * **幂等**：画布里已经存在本校的页眉/页脚元素时，本次返回 null（不重复添加）。
 * 这条不是锦上添花——第八轮复审实测，导出链路上如果某处把**已装饰**的画布
 * 又送进来一次，产物里就会出现**两条页眉**，而当时的测试完全测不出来
 * （"hook 传已装饰画布"这个变异，失败集合与零变异对照组逐条相同）。
 * 做成幂等之后，双重装饰在结构上不可能发生。
 *
 * @returns 页眉/页脚元素；画布已自带对应标识时为 null。
 */
export function buildBrandElements(
  slide: BrandedSlideLike,
  options: SlideBrandOptions,
): { header: BrandTextElement | null; footer: BrandTextElement | null } {
  const size = slide.viewportSize || options.viewportSize;
  const ratio = slide.viewportRatio || options.viewportRatio;
  const color = slide.theme?.fontColor ?? '#94a3b8';
  const elementIds = slide.elements.map((element) => element.id);

  const header = hasBrandElement(elementIds, SLIDE_BRAND_HEADER_ID_PREFIX)
    ? null
    : toTextElement(
        `${SLIDE_BRAND_HEADER_ID_PREFIX}${slide.id}`,
        buildSlideHeaderSpec(size, color, options.chapter),
      );
  const footer =
    hasInlineBrandElement(elementIds) || hasBrandElement(elementIds, SLIDE_BRAND_FOOTER_ID_PREFIX)
      ? null
      : toTextElement(
          `${SLIDE_BRAND_FOOTER_ID_PREFIX}${slide.id}`,
          buildSlideFooterSpec(size, ratio, color, options.teacher),
        );

  return { header, footer };
}

/** 画布里是否已有以给定前缀命名的本校标识元素。 */
export function hasBrandElement(elementIds: readonly string[], prefix: string): boolean {
  return elementIds.some((id) => id.startsWith(prefix));
}

/** 一张待装饰画布的最小形状（保留元素类型，避免调用方到处强转）。 */
export interface DecoratableSlide {
  id: string;
  /** 只需要元素 id——装饰逻辑据此判断画布是否已自带贴底标识。 */
  elements: readonly { id: string }[];
  viewportSize?: number;
  viewportRatio?: number;
  theme?: { fontColor?: string } | null;
}

/**
 * 为一组画布补上校本页眉页脚（返回新数组，不改动原始画布）。
 *
 * 导出链路与测试**必须**走这一份实现：早前测试自己手工拼了一遍装饰，
 * 于是"导出哪天不再调用装饰"这类回归完全测不出来——测试照样绿，
 * 产物却没了页眉。抽成共享纯函数后，两边用的是同一段代码。
 */
export function decorateSlidesWithBrand<T extends DecoratableSlide>(
  slides: readonly T[],
  options: SlideBrandOptions,
): Array<T & { elements: Array<T['elements'][number] | BrandTextElement> }> {
  return slides.map((slide) => {
    const { header, footer } = buildBrandElements(slide, options);
    return {
      ...slide,
      // header / footer 为 null 表示画布已自带该标识（幂等，不重复添加）。
      elements: [...slide.elements, ...(header ? [header] : []), ...(footer ? [footer] : [])],
    };
  });
}
