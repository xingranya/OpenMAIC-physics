/**
 * Brand configuration.
 *
 * The reference (live deployment) resolves the brand per vendor from the
 * desktop shell's User-Agent token. This workspace has no vendor shell: the
 * product ships with its own single brand, so the config is static and the
 * desktop flag is always off. The shape is kept so surfaces that read the
 * brand (home hero, workspace rail, site header) keep one source of truth.
 */

export interface BrandConfig {
  /** Full product name (page titles, logo alt text). */
  productName: string;
  /** Short name for space-constrained spots. */
  shortName: string;
  /** Horizontal logo asset under `public/`. */
  logoSrc: string;
  /** Whether `logoSrc` already carries the product wordmark. */
  logoHasWordmark: boolean;
  /** Square brand mark under `public/` (favicon, workspace header). */
  markSrc: string;
  /** Browser theme color (`<meta name="theme-color">` / PWA). */
  themeColor: string;
}

/** The default brand: 长江大学文理学院 · 大学物理 AI 智慧课堂. */
export const DEFAULT_BRAND: BrandConfig = {
  productName: '大学物理 AI 智慧课堂',
  shortName: '物理 AI 课堂',
  logoSrc: '/brand/college-brand.png',
  logoHasWordmark: false,
  markSrc: '/brand/college-brand.png',
  themeColor: '#0369a1',
};
