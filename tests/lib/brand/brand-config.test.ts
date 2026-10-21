import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';
import { BRAND_FULL_NAME, SCHOOL } from '@/lib/school';

describe('DEFAULT_BRAND (校本品牌)', () => {
  it('使用本校产品身份与校色', () => {
    expect(DEFAULT_BRAND.productName).toBe('大学物理 AI 智慧课堂');
    expect(DEFAULT_BRAND.shortName).toBe('物理 AI 课堂');
    expect(DEFAULT_BRAND.markSrc).toBe('/brand/college-brand.png');
    // 校色天蓝，取代上游默认紫色。
    expect(DEFAULT_BRAND.themeColor).toBe('#0369a1');
  });

  it('横版标识使用校徽，且不携带上游字标', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(false);
    expect(DEFAULT_BRAND.logoSrc).toBe('/brand/college-brand.png');
  });

  it('品牌全称由学校与系统名组成', () => {
    expect(BRAND_FULL_NAME).toBe(`${SCHOOL.college} · 大学物理 AI 智慧课堂`);
  });
});
