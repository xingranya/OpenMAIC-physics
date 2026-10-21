/**
 * 物理领域约束 —— 注入 AI 课堂的生成管线。
 *
 * 这是二开 OpenMAIC 的关键接入点：不改动上游 `@openmaic/generation` 的
 * 任何模板，而是在应用层把"大学物理"的领域约束拼进用户需求文本，
 * 使一次约束同时作用于全部场景类型（Slides / Quiz / Interactive / PBL）。
 *
 * 约束分四类：符号与量纲规范、常见误区、实验安全、课程思政落点。
 */

import { buildCampusContext, buildIdeologyConstraint, buildPersonaSummary } from '@/lib/school';
import { SCHOOL_SLIDE_THEMES } from '@/lib/school';

/** 符号与量纲规范。 */
export const SYMBOL_CONVENTIONS = `
## 符号与量纲规范（必须遵守）

- 物理量用规范符号：质量 m、加速度 a、速度 v、时间 t、位移 s、力 F、功 W、能量 E、
  压强 p、电荷 q、电场强度 E、磁感应强度 B、频率 f、周期 T、波长 λ、声速 v_snd。
- 区分同名不同义的符号：电场强度 E 与能量 E，在同一场景中改用 E_field / E_kin 区分并加注说明。
- 每个含公式的页面都要做一次量纲检查；量纲不匹配的公式不得出现在课件中。
- 数值必须带单位，量级用科学记数法（1.2×10³ m/s），有效数字与题目给定量级一致。
- 下标含义明确：初态 v_0、末态 v_n、极大值 v_max、角速度 ω、角加速度 α。
`.trim();

/** 常见误区。 */
export const COMMON_MISCONCEPTIONS = `
## 常见误区（每章至少澄清 1 条）

- "力是维持物体运动的原因" → 错。力是改变运动状态的原因。
- "重的物体下落更快" → 错（忽略空气阻力时加速度相同）。
- "波传播时介质质点随波迁移" → 错。波传播的是能量与相位，质点只在平衡位置附近振动。
- "电流表串联、电压表并联" → 记反。电流表内阻极小应串联，电压表内阻极大应并联。
- "温度高的物体热量一定多" → 错。热量取决于比热容、质量与温度变化量。
- "看到参考系不同就矛盾" → 错。应先统一参考系再比较。
`.trim();

/** 实验安全。 */
export const LAB_SAFETY = `
## 实验与安全（涉及实验内容时必须显式说明）

- 任何涉及高压、强光、激光、高温或转动部件的步骤，必须单独写明防护措施。
- 超声、激光、射频类实验要提示"不得直视发射端"与"先关电源再拆线"。
- 涉及可燃物、高温或化学试剂的步骤要提示通风与个人防护。
- 不得给出可导致设备损坏或人身伤害的具体参数组合。
`.trim();

/** 课程思政落点。 */
export const IDEOLOGY_DIRECTIVE = `
## 课程思政（每章至少落 1 条，不要生硬贴标签）

${buildIdeologyConstraint()}
`.trim();

/** 智能体人格。 */
export const PERSONA_DIRECTIVE = `
## 课堂角色设定

${buildPersonaSummary()}
`.trim();

/** 校内上下文。 */
export const SCHOOL_DIRECTIVE = `
## 授课上下文

${buildCampusContext()}
`.trim();

/** 课件主题。 */
export const THEME_DIRECTIVE = `
## 课件主题

使用「${SCHOOL_SLIDE_THEMES[0].name}」配色：背景 ${SCHOOL_SLIDE_THEMES[0].background}，
文字 ${SCHOOL_SLIDE_THEMES[0].fontColor}，主色 ${SCHOOL_SLIDE_THEMES[0].colors.join('、')}。
`.trim();

/** 物理领域约束的完整文本。 */
export const PHYSICS_CONSTRAINTS = [
  SYMBOL_CONVENTIONS,
  COMMON_MISCONCEPTIONS,
  LAB_SAFETY,
  IDEOLOGY_DIRECTIVE,
  PERSONA_DIRECTIVE,
  SCHOOL_DIRECTIVE,
  THEME_DIRECTIVE,
].join('\n\n');

/**
 * 把物理领域约束拼进用户需求。
 *
 * 用户的原始需求排在最前，约束作为"补充要求"追加，避免模型把约束
 * 当成课程主题。
 */
export function buildPhysicsRequirement(requirement: string): string {
  const text = String(requirement ?? '').trim();
  if (!text) return text;
  return `${text}

---

以下是本课程（大学物理）必须遵守的补充要求，请贯穿所有场景（课件、测验、仿真、PBL）执行：

${PHYSICS_CONSTRAINTS}`;
}

/** 判断一段需求是否已经包含物理领域约束（避免重复拼接）。 */
export function hasPhysicsConstraints(requirement: string): boolean {
  return String(requirement ?? '').includes('符号与量纲规范');
}
