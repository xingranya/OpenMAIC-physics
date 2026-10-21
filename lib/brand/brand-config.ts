/**
 * Brand configuration.
 *
 * The reference (live deployment) resolves the brand per vendor from the
 * desktop shell's User-Agent token. This workspace has no vendor shell: the
 * product ships with its own single brand, so the config is static and the
 * desktop flag is always off. The shape is kept so surfaces that read the
 * brand (home hero, workspace rail, site header) keep one source of truth.
 */

import { PLATFORM } from '@/lib/school/identity';

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

/**
 * The default brand.
 *
 * 平台显示名不在这里另写一份——统一取 `lib/school/identity.ts` 的
 * `PLATFORM`，避免"改了一处、另一处没改"的双真值来源。
 */
export const DEFAULT_BRAND: BrandConfig = {
  productName: PLATFORM.systemName,
  shortName: PLATFORM.systemShortName,
  logoSrc: '/brand/college-brand.png',
  logoHasWordmark: false,
  markSrc: '/brand/college-brand.png',
  themeColor: '#0369a1',
};
