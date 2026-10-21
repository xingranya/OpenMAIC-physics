/**
 * 校本层统一出口。
 *
 * 全站任何需要"学校 / 课程 / 班级 / 教师 / 校徽 / 校色 / 课程思政 / 评价量表"
 * 的地方，一律从 `@/lib/school` 取值，不允许在组件中硬编码字面量。
 */

export {
  SCHOOL,
  COURSE,
  PLATFORM,
  DEMO,
  BRAND_FULL_NAME,
  CONTEXT_LABEL,
  DATA_DISCLAIMER,
  type SchoolIdentity,
  type CourseIdentity,
  type PlatformIdentity,
  type DemoIdentity,
} from './identity';

export {
  BRAND_TOKENS,
  FONT_STACK,
  FONT_SCALE,
  RADIUS_SCALE,
  SCHOOL_SLIDE_THEMES,
  PRINT_STYLESHEET,
  buildExportFooter,
  buildSlideFooterSpec,
  type BrandTokens,
  type SchoolSlideTheme,
  type SlideFooterSpec,
} from './branding';

export {
  SCHOOL_CHAPTER_META,
  SCHOOL_LABS,
  SCHOOL_MODULE_PLAN,
  CHAPTER_IDEOLOGY_KEYS,
  CHAPTER_STATUS_LABELS,
  PROJECT_LEVEL_LABELS,
  getSchoolChapterMeta,
  getLabsForChapter,
  getChapterForLab,
  type SchoolChapterMeta,
  type SchoolLab,
  type SchoolModulePlan,
} from './curriculum';

export {
  IDEOLOGY_POINTS,
  getIdeologyPoint,
  getIdeologyPointForDimension,
  buildIdeologyConstraint,
  type IdeologyPoint,
} from './ideology';

export {
  RUBRIC,
  getRubricDimension,
  describeBand,
  buildRubricSummary,
  type RubricDimension,
  type RubricAnchor,
} from './rubric';

export {
  CAMPUS_SCENES,
  AGENT_PERSONAS,
  getTeacherPersona,
  getPeerPersonas,
  buildPersonaSummary,
  buildCampusContext,
  type CampusScene,
  type AgentPersona,
} from './campus';
