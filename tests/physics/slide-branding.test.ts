import { describe, expect, it } from 'vitest';

import {
  SLIDE_BRAND_FOOTER_ID_PREFIX,
  SLIDE_BRAND_HEADER_ID_PREFIX,
  buildBrandElements,
  hasInlineBrandElement,
} from '@/lib/export/slide-branding';
import { buildPresetClassroom, buildUltrasonicLabHtml, getPresetById } from '@/lib/physics/presets';
import { COURSE, SCHOOL } from '@/lib/school/identity';

/**
 * 宽松的画布形状：DSL 的 `Slide` 泛型很宽，测试按运行时形状读取。
 */
interface LooseSlide {
  id: string;
  elements: { id: string }[];
  viewportSize?: number;
  viewportRatio?: number;
  theme?: { fontColor?: string } | null;
}

const OPTIONS = {
  chapter: '牛顿运动定律与圆周运动',
  teacher: COURSE.teacher,
  viewportSize: 960,
  viewportRatio: 0.5625,
};

describe('导出幻灯片的校本页眉页脚', () => {
  it('普通画布同时得到贴顶页眉与贴底页脚，两端都带校名', () => {
    const { header, footer } = buildBrandElements(
      { id: 'slide-1', elements: [{ id: 'slide-1-title' }] },
      OPTIONS,
    );

    expect(header?.id).toBe(`${SLIDE_BRAND_HEADER_ID_PREFIX}slide-1`);
    expect(footer?.id).toBe(`${SLIDE_BRAND_FOOTER_ID_PREFIX}slide-1`);

    expect(header?.content).toContain(SCHOOL.college);
    expect(header?.content).toContain(COURSE.name);
    expect(header?.content).toContain(OPTIONS.chapter);

    expect(footer?.content).toContain(SCHOOL.college);
    expect(footer?.content).toContain(COURSE.name);
    expect(footer?.content).toContain(COURSE.teacher);

    // 页眉在顶部、页脚在底部，两者不重叠
    expect(header?.top).toBeLessThan(60);
    expect(footer?.top).toBeGreaterThan(400);
    expect((header?.top ?? 0) + (header?.height ?? 0)).toBeLessThan(footer?.top ?? 0);
  });

  it('装饰是幂等的：画布已含本校页眉/页脚时不再重复添加', () => {
    // 第八轮复审实测：导出链路上若把**已装饰**的画布又送进渲染器一次，
    // 产物会出现**两条页眉**，而当时没有任何测试能发现（"hook 传已装饰画布"
    // 这个变异，失败集合与零变异对照组逐条相同）。
    // 做成幂等后，双重装饰在结构上不可能发生。
    const first = buildBrandElements(
      { id: 'slide-idem', elements: [{ id: 'slide-idem-title' }] },
      OPTIONS,
    );
    expect(first.header).toBeTruthy();
    expect(first.footer).toBeTruthy();

    const second = buildBrandElements(
      {
        id: 'slide-idem',
        elements: [{ id: 'slide-idem-title' }, { id: first.header!.id }, { id: first.footer!.id }],
      },
      OPTIONS,
    );
    expect(second.header, '已含页眉的画布不应再加页眉').toBeNull();
    expect(second.footer, '已含页脚的画布不应再加页脚').toBeNull();
  });

  it('画布已自带贴底校名标识时不再重复加页脚', () => {
    const { header, footer } = buildBrandElements(
      { id: 'slide-2', elements: [{ id: 'slide-2-title' }, { id: 'slide-2-brand' }] },
      OPTIONS,
    );

    expect(header).toBeTruthy();
    expect(footer).toBeNull();
    expect(hasInlineBrandElement(['slide-2-brand'])).toBe(true);
    expect(hasInlineBrandElement(['slide-2-title'])).toBe(false);
  });

  it('预置课堂包的每一页都有且只有一条底部校名标识（页脚不会重复）', () => {
    const preset = getPresetById('preset-mechanics-03');
    expect(preset).toBeTruthy();

    const classroom = buildPresetClassroom(preset!);
    const slideScenes = classroom.scenes.filter((scene) => scene.content.type === 'slide');
    expect(slideScenes.length).toBeGreaterThan(0);

    for (const scene of slideScenes) {
      const canvas = (scene.content as { canvas: LooseSlide }).canvas;
      const inlineBrands = canvas.elements.filter((element) => element.id.endsWith('-brand'));
      // 预置画布自带一条底部标识
      expect(inlineBrands.length).toBe(1);

      const { header, footer } = buildBrandElements(canvas, OPTIONS);
      // 页眉照常加，页脚跳过 → 最终每页恰好一条顶部标识 + 一条底部标识
      expect(header).toBeTruthy();
      expect(footer).toBeNull();
    }
  });
});

describe('离线单文件 HTML 的校本页眉页脚', () => {
  const html = buildUltrasonicLabHtml();

  it('页眉含学校与课程，页脚含班级与示例数据声明', () => {
    expect(html).toContain('class="brand-bar"');
    expect(html).toContain('class="brand-foot"');
    expect(html).toContain(SCHOOL.college);
    expect(html).toContain(COURSE.name);
    expect(html).toContain(COURSE.className);
    expect(html).toContain('课程示例数据');
  });

  it('仍然是零外部依赖的自包含文件（断网可用）', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });
});
