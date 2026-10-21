import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PPTX 导出链路的**接线**护栏。
 *
 * 背景（第五轮独立复审 N1）：`tests/physics/pptx-branding.test.ts` 验的是
 * 「装饰之后产物里有没有页眉页脚」，但它自己调 `decorateSlidesWithBrand`
 * 再把结果喂给 `buildPptxBlob` —— 而 `buildPptxBlob` **内部并不做装饰**。
 *
 * 于是形成了一个真实的覆盖缺口：把导出 hook 里的
 * `decorateSlidesWithBrand(slides, {…})` 换成 `slides`（模拟"导出不再调用
 * 装饰"这一回归），`pptx-branding.test.ts` 依然 **3 passed 全绿**——
 * 门禁没有守住它声称守住的性质。
 *
 * 为什么用源码级断言而不是改造导出链路：
 * - 若把装饰挪进 `buildPptxBlob` 内部，hook 现有的调用就会变成**双重装饰**
 *   （同一页出现两条页眉）；
 * - 若在 `buildPptxBlob` 里做「已装饰则跳过」的判断，又会引入第二套真值来源。
 *
 * 所以保持"hook 负责装饰、`buildPptxBlob` 只负责渲染"的单点结构，
 * 并用一条**源码级**断言守住这条接线关系（与
 * `tests/media/video-media-resolution-boundary.test.ts` 用同一手法）。
 */
describe('PPTX 导出的品牌装饰接线', () => {
  const exportSource = readFileSync(join(process.cwd(), 'lib/export/use-export-pptx.ts'), 'utf8');

  it('导出 hook 调用共享的装饰实现 decorateSlidesWithBrand', () => {
    expect(exportSource).toMatch(
      /import\s+\{[^}]*\bdecorateSlidesWithBrand\b[^}]*\}\s+from\s+'@\/lib\/export\/slide-branding'/,
    );
    // 必须是**赋值形式**：`const brandedSlides = decorateSlidesWithBrand(slides, …)`。
    // 只断言"文件里出现过这个调用"会被"调用还在、结果被丢弃"的变异绕过。
    expect(exportSource).toMatch(
      /const\s+brandedSlides\s*=\s*decorateSlidesWithBrand\(\s*slides\s*,/,
    );
  });

  it('导出 hook 不再自行拼装装饰元素（避免两处实现分叉）', () => {
    // buildBrandElements 是底层构造器；导出链路只应通过共享入口调用它。
    expect(exportSource).not.toMatch(/import\s+\{[^}]*\bbuildBrandElements\b[^}]*\}/);
    expect(exportSource).not.toMatch(/\bbuildBrandElements\s*\(/);
  });

  it('装饰结果仍被传给 PPTX 渲染器（接线末端没有断）', () => {
    // brandedSlides 必须出现在 PPTX 产物构建的调用里。
    expect(exportSource).toMatch(/brandedSlides/);
    expect(exportSource).toMatch(/buildPptxBlob\([\s\S]{0,200}?brandedSlides/);
  });
});
