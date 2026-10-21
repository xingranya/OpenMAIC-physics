import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { buildPptxBlob } from '@/lib/export/use-export-pptx';
import {
  buildBrandElements,
  decorateSlidesWithBrand,
  hasInlineBrandElement,
} from '@/lib/export/slide-branding';
import { buildPresetClassroom, getPresetById } from '@/lib/physics/presets';
import { SCHOOL, COURSE } from '@/lib/school/identity';

/**
 * 导出文件本体核对。
 *
 * 前面 `tests/physics/slide-branding.test.ts` 验的是**装饰函数**产出了什么；
 * 这一条验的是**真正的 .pptx 文件里**有没有那两条标识、位置对不对。
 * 「材料里说每页都有校名页眉」这种话，只有打开文件本体才算数。
 *
 * 第四轮独立复审指出这里的断言曾是**恒真**的（两条都过，但去掉装饰照样过）：
 * - 「每页含校名」恒成立，因为预置画布自带一条贴底的 `-brand` 标识，
 *   它本来就有校名；
 * - 「页眉贴顶」恒成立，因为原始画布的最小 y 偏移本来就远小于最大 y 的 1/4；
 * - 断言用的是测试自己手工拼的装饰，导出链路哪天不调装饰也测不出来。
 *
 * 现在改成：
 * 1. 走**与导出链路共用的** `decorateSlidesWithBrand`；
 * 2. 用**章节名**定位页眉（`-brand` 里没有章节名，两者不会混淆），
 *    断言"含章节名的文本块存在，且它的 y 偏移是全页最小的"；
 * 3. 断言贴底那条（不含章节名、含校名）的 y 偏移是全页最大的；
 * 4. 补一条"画布自带 `-brand` 时不再重复贴页脚"的显式断言。
 */

interface LooseSlideScene {
  type: string;
  content: { type: string; canvas?: { id: string; elements: { id: string }[] } };
}

/** 取出预置课堂里的讲演页场景与其画布。 */
function presetSlides() {
  const preset = getPresetById('preset-mechanics-03');
  expect(preset).toBeTruthy();
  const classroom = buildPresetClassroom(preset!);
  const scenes = classroom.scenes as unknown as LooseSlideScene[];
  const slideScenes = scenes.filter((scene) => scene.content.type === 'slide');
  expect(slideScenes.length).toBeGreaterThan(0);
  return { slideScenes, canvases: slideScenes.map((scene) => scene.content.canvas!) };
}

/** 页面里的一段文本及其 y 偏移（EMU）。 */
interface TextBlock {
  text: string;
  offsetY: number;
}

/**
 * 从 slide XML 里拆出每个形状的文本与 y 偏移。
 *
 * PPTX 的每个形状是 `<p:sp>…</p:sp>`，文本在 `<a:t>` 里，位置在
 * 第一个 `<a:off x=".." y=".."/>` 里。逐块扫描比"全局找最小/最大偏移"
 * 有意义得多：前者能定位到**具体是哪一条标识**在贴顶、哪一条在贴底。
 */
function textBlocks(xml: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const shapePattern = /<p:sp>[\s\S]*?<\/p:sp>/g;
  let shape: RegExpExecArray | null;
  while ((shape = shapePattern.exec(xml)) !== null) {
    const body = shape[0];
    const texts: string[] = [];
    const textPattern = /<a:t>([\s\S]*?)<\/a:t>/g;
    let text: RegExpExecArray | null;
    while ((text = textPattern.exec(body)) !== null) texts.push(text[1]);
    const offset = /<a:off x="-?\d+" y="(-?\d+)"/.exec(body);
    if (texts.length === 0) continue;
    blocks.push({
      text: texts.join(''),
      offsetY: offset ? Number(offset[1]) : Number.NaN,
    });
  }
  return blocks;
}

const CHAPTER = '牛顿运动定律与圆周运动';

describe('导出的 PPTX 文件本体', () => {
  it('每页都真的写进了校名页眉与页脚，位置一顶一底', async () => {
    const { slideScenes, canvases } = presetSlides();

    const viewportSize = 1000;
    const viewportRatio = 0.5625;
    const ratioPx2Inch = 96 * (viewportSize / 960);
    const ratioPx2Pt = (96 / 72) * (viewportSize / 960);

    // 走与导出链路**共用**的装饰实现（不是测试自己拼一遍）。
    const brandedSlides = decorateSlidesWithBrand(canvases, {
      chapter: CHAPTER,
      teacher: COURSE.teacher,
      viewportSize,
      viewportRatio,
    });

    const blob = await buildPptxBlob(
      brandedSlides as never,
      slideScenes as never,
      viewportRatio,
      viewportSize,
      ratioPx2Inch,
      ratioPx2Pt,
      'stage-preset-mechanics-03-1',
    );
    expect(blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort();
    expect(slideFiles.length).toBe(slideScenes.length);

    for (const name of slideFiles) {
      const xml = await zip.file(name)!.async('string');
      const blocks = textBlocks(xml);

      // ① 页眉：**同时**含校名与章节名的那一条。
      //    （预置画布的标题元素也含章节名，所以必须再加上校名才能唯一定位页眉；
      //      `-brand` 贴底标识只有校名、没有章节名，两者不会混淆。）
      const header = blocks.find(
        (block) => block.text.includes(SCHOOL.college) && block.text.includes(CHAPTER),
      );
      expect(header, `${name} 缺少校本页眉`).toBeTruthy();
      expect(header!.text).toContain(COURSE.name);

      // ② 贴底那条：含校名但**不含**章节名。
      const footer = blocks.find(
        (block) => block.text.includes(SCHOOL.college) && !block.text.includes(CHAPTER),
      );
      expect(footer, `${name} 缺少贴底的校本标识`).toBeTruthy();

      // ③ 一顶一底：页眉的 y 偏移必须是全页最小的，贴底那条必须是最大的。
      const offsets = blocks
        .map((block) => block.offsetY)
        .filter((y) => Number.isFinite(y) && y !== 0);
      expect(offsets.length).toBeGreaterThan(0);
      const minY = Math.min(...offsets);
      const maxY = Math.max(...offsets);
      expect(header!.offsetY).toBe(minY);
      expect(footer!.offsetY).toBe(maxY);
      // 页眉确实在顶部、贴底标识确实在底部（不是两个都挤在上方）。
      expect(minY).toBeLessThan(maxY / 4);
    }
  }, 120_000);

  it('画布自带贴底标识时不再重复贴页脚', () => {
    const { canvases } = presetSlides();
    const canvas = canvases[0];

    // 预置画布自带 `-brand` 贴底标识 → 装饰层必须跳过页脚，避免两行字叠在一起。
    expect(hasInlineBrandElement(canvas.elements.map((element) => element.id))).toBe(true);
    const { header, footer } = buildBrandElements(canvas, {
      chapter: CHAPTER,
      teacher: COURSE.teacher,
      viewportSize: 1000,
      viewportRatio: 0.5625,
    });
    expect(header).toBeTruthy();
    expect(footer).toBeNull();

    // 反之：没有 `-brand` 的画布必须补上贴底页脚。
    const bare = { id: 'bare-slide', elements: [{ id: 'title' }] };
    const bareResult = buildBrandElements(bare, {
      chapter: CHAPTER,
      teacher: COURSE.teacher,
      viewportSize: 1000,
      viewportRatio: 0.5625,
    });
    expect(bareResult.footer).toBeTruthy();
    // 页脚贴底：top 接近画布底（viewportSize * ratio - 页脚高度 - 间距）。
    expect(bareResult.footer!.top).toBeGreaterThan(1000 * 0.5625 - 100);
  });

  it('PPTX 元数据带学校、课程与授课教师', async () => {
    const { slideScenes, canvases } = presetSlides();
    const viewportSize = 1000;
    const viewportRatio = 0.5625;

    const blob = await buildPptxBlob(
      canvases as never,
      slideScenes as never,
      viewportRatio,
      viewportSize,
      96 * (viewportSize / 960),
      (96 / 72) * (viewportSize / 960),
      'stage-preset-mechanics-03-1',
    );

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const core = await zip.file('docProps/core.xml')!.async('string');
    const app = await zip.file('docProps/app.xml')!.async('string');
    expect(`${core}${app}`).toContain(SCHOOL.college);
    expect(`${core}${app}`).toContain(COURSE.teacher);
  }, 120_000);
});
