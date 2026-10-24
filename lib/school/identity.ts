/**
 * 校本身份配置 —— 长江大学文理学院 · 大学物理 AI 智慧课堂
 *
 * 全站所有校名、班级、教师、账号、课程名称都必须经由此处读取，
 * 任何组件都不得再硬编码这些字面量。
 *
 * 真实性红线：下列信息中，无法通过公开渠道核实的条目一律以
 * "示例" 标注，并在界面上同步提示；不得虚构真实学生成绩、
 * 真实班级数据或真实教务数据。
 */

/** 学校与学院信息。 */
export interface SchoolIdentity {
  /** 学校全称。 */
  university: string;
  /** 学院全称。 */
  college: string;
  /** 院系简称，用于紧凑位置。 */
  collegeShort: string;
  /** 校徽资源路径（public/brand/college-brand.png）。 */
  emblemSrc: string;
  /**
   * **方形校徽**（public/brand/college-emblem.png，从整幅品牌图裁出的圆章）。
   *
   * 为什么需要两个：`college-brand.png` 是 260×60 的横幅（圆章 + 书法校名 + 英文名），
   * 只适合**大尺寸、浅色背景**（登录页、导出页眉）。放到 24–32px 的图标位时，
   * 书法笔画糊成一团、英文行完全不可读；在**深色主题**下深色书法还会整片消失。
   * 所以小尺寸与深色场景一律用这张方形圆章 + 文字渲染校名。
   */
  emblemMarkSrc: string;
  /** 登录页背景图资源路径。 */
  loginBackgroundSrc: string;
  /** 校园所在城市。 */
  city: string;
}

/** 课程信息。 */
export interface CourseIdentity {
  /** 课程全名。 */
  name: string;
  /** 课程简称。 */
  shortName: string;
  /** 课程代码（示例，待教务核对）。 */
  code: string;
  /** 学分（示例，待教务核对）。 */
  credits: number;
  /** 适用专业。 */
  major: string;
  /** 授课教师。 */
  teacher: string;
  /** 演示班级。 */
  className: string;
  /** 教材版本（示例，待教务核对）。 */
  textbook: string;
}

/** 平台系统信息。 */
export interface PlatformIdentity {
  /** 平台正式名称，用于标题栏、导出页眉与作品说明书。 */
  systemName: string;
  /** 平台简称，用于侧栏与徽标。 */
  systemShortName: string;
  /** 一句话定位。 */
  tagline: string;
}

/** 演示账号。 */
export interface DemoIdentity {
  /** 学生登录名。 */
  studentUsername: string;
  /** 教师登录名。 */
  teacherUsername: string;
  /** 统一初始密码。 */
  password: string;
  /** 演示学生姓名。 */
  studentName: string;
  /** 演示学生学号（示例）。 */
  studentId: string;
  /** 演示学生班级。 */
  studentClassName: string;
  /** 演示学生专业。 */
  studentMajor: string;
}

export const SCHOOL: SchoolIdentity = {
  university: '长江大学',
  college: '长江大学文理学院',
  collegeShort: '文理学院',
  emblemSrc: '/brand/college-brand.png',
  emblemMarkSrc: '/brand/college-emblem.png',
  loginBackgroundSrc: '/brand/teaching-login-bg.jpg',
  city: '湖北荆州',
};

export const COURSE: CourseIdentity = {
  name: '大学物理',
  shortName: '大学物理',
  code: 'PHYS-1001（示例）',
  credits: 3,
  major: '物理学',
  teacher: '顿老师',
  className: '物理学 2601 班',
  textbook: '《大学物理》通用本科教程（示例，待教务核对）',
};

export const PLATFORM: PlatformIdentity = {
  systemName: '大学物理 AI 智慧课堂',
  systemShortName: '物理 AI 课堂',
  tagline: '诊断 · 匹配 · 闯关 · 实验 · 课堂 —— 过程证据驱动的大学物理学习闭环',
};

export const DEMO: DemoIdentity = {
  studentUsername: 'student',
  teacherUsername: 'teacher',
  password: 'dunzhongwan',
  studentName: '陈思远',
  studentId: '2026010118（示例）',
  studentClassName: '物理学 2601 班',
  studentMajor: '物理学',
};

/** 品牌全称：用于页眉页脚、PPTX 导出与作品说明书。 */
export const BRAND_FULL_NAME = `${SCHOOL.college} · ${PLATFORM.systemName}`;

/** 上下文条用短标识：学校 / 班级 / 课程。 */
export const CONTEXT_LABEL = `${SCHOOL.collegeShort} · ${COURSE.className} · ${COURSE.name}`;

/**
 * 数据来源声明。所有不具备公开可核验来源的展示数据都挂在这里，
 * 界面渲染时据此显示"示例数据"提示。
 */
export const DATA_DISCLAIMER = {
  /** 班级画像与学生成绩为课程示例数据，非真实教务数据。 */
  classRoster: '示例数据',
  /** 章节学时与教材信息待教务核对。 */
  syllabus: '示例数据（待教务核对）',
  /** AI 建议分由本地规则引擎生成，非真实模型推理日志。 */
  aiScore: '本地规则引擎',
} as const;
