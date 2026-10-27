/**
 * 键盘快捷键 + 命令面板路由表（物理工作台）。
 *
 * 约定：
 * - 顶层快捷键由 `useShortcuts` 监听，避开 input / textarea / contenteditable 焦点。
 * - 命令面板（⌘K / Ctrl+K / "?"）展示可执行动作，回车即跳转或执行。
 * - 不依赖 React 渲染，便于单元测试。
 */
import type { UserRole } from './types';

export type StudentView =
  | 'overview'
  | 'diagnosis'
  /** 课前：分层 → 梯度配对 → 分组，提交教师审核。 */
  | 'preclass'
  /** 课中：伴随式判定与追问。 */
  | 'inclass'
  /** 课后：过程性评价与四阶能力轨迹。 */
  | 'postclass'
  | 'curriculum'
  | 'projects'
  | 'tasks'
  | 'assistant'
  | 'lab'
  | 'report';

export type TeacherView =
  | 'dashboard'
  | 'class'
  | 'curriculum'
  | 'evaluation'
  | 'insights'
  | 'reviews'
  /** 成绩登记总表（与教学工作手册附表一致）。 */
  | 'scores'
  /** 质量核验：四项核验指标（诊断一致率 / 匹配适切率 / 改进完成率 / 证据可追溯率）。 */
  | 'verify';

export type CommandScope = 'global' | 'student' | 'teacher';

export interface ShortcutBinding {
  /** 描述提示中可见的中文标签 */
  label: string;
  /** 用于显示与匹配（拼音首字母/小写） */
  hint: string;
  /** 例如 "g o" — 序列键 */
  combo: string;
  /** 作用域，避免学生/教师混合 */
  scope: CommandScope;
  /**
   * 角色限定：仅在当前登录角色与之相同时可见。
   *
   * 与 `scope` 的区别：`scope` 决定这条绑定属于哪一端的**快捷键集合**，
   * 而 `roleScope` 决定它作为**命令面板条目**时给谁看。
   *
   * 为什么需要它：「跳到学习报告」与「跳到评价复核」是跨角色跳转目标，
   * 学生不该看到教师端的「评价复核」、教师也不该看到学生端的「学习报告」。
   * 工作台的视图切换是**本地状态 + 原生 History API**（断网可用），
   * 并不真的会换页——跨角色目标若被点下去，地址栏会变成 `/teacher/evaluation`
   * 而内容仍是学生工作台，造成 URL 与内容错配。
   */
  roleScope?: UserRole;
  /** 是否需要当前登录态 */
  requiresSession?: boolean;
  /** 跳转或动作 */
  action:
    | { type: 'navigate'; role: UserRole; view: StudentView | TeacherView }
    | { type: 'command'; id: string };
}

/** 学生端路由前缀。 */
export const STUDENT_ROUTE_PREFIX = '/physics';
/** 教师端路由前缀。 */
export const TEACHER_ROUTE_PREFIX = '/teacher';

/** 由角色与视图拼出路由。 */
export function routeFor(role: UserRole, view: StudentView | TeacherView): string {
  const prefix = role === 'student' ? STUDENT_ROUTE_PREFIX : TEACHER_ROUTE_PREFIX;
  return `${prefix}/${view}`;
}

/** 跨角色深链接被挡下后，送回自己角色的哪个视图。 */
export const ROLE_HOME_VIEW: Record<UserRole, StudentView | TeacherView> = {
  student: 'overview',
  teacher: 'dashboard',
};

/**
 * **深链接**的角色一致性判定。
 *
 * ## 为什么需要它
 *
 * 路径前缀决定渲染哪个角色的内容——`app/teacher/[view]` 渲染教师组件、
 * `app/physics/[view]` 渲染学生组件——而**路径是任何人都能手输的**。
 *
 * in-app 切换已经被 `navigate()` 里的 allowed 集合挡住（纵深防御），
 * 但**首屏深链接**是另一条路：学生直接打开 `/teacher/evaluation`，
 * 看到的是教师端内容，侧栏却还是学生导航——地址栏与内容错配，
 * 「学生进不了教师端」这句话也就不成立了。
 *
 * 命令面板那条路另有 `roleScope` 兜着（见 `ShortcutBinding.roleScope`），
 * 深链接这条路以前没人管。
 *
 * ## 判定是纯函数
 *
 * 不碰 React / DOM，所以能直接单测；组件里只负责执行后果
 * （不渲染别角色的内容 + 把地址栏带回去）。
 */
export function resolveDeepLinkRoleGate(
  pathRole: UserRole | null,
  sessionRole: UserRole | null,
): { blocked: boolean; redirectTo: string | null } {
  // 会话还没水合（读 sessionStorage）时不做判定：那时还不知道是谁，
  // 贸然拦会误伤正常刷新。
  if (!pathRole || !sessionRole) return { blocked: false, redirectTo: null };
  if (pathRole === sessionRole) return { blocked: false, redirectTo: null };
  return {
    blocked: true,
    redirectTo: routeFor(sessionRole, ROLE_HOME_VIEW[sessionRole]),
  };
}

/**
 * 工作台深链接的**完整**判定：角色一致性 + 视图是否存在。
 *
 * ## 为什么不能只看 `parseWorkbenchPath`
 *
 * `parseWorkbenchPath` 只认已知视图，`/teacher/foo` 会被解析成 `null`。
 * 旧判定在 `!pathRole` 时直接放行，而教师路由的 `switch` 有 `default`
 * → **学生打开 `/teacher/foo` 能看到教师驾驶舱**（实测确认）。
 * 「视图名不认识」不等于「不知道这是哪个角色的路径」——前缀已经把角色说清楚了。
 *
 * ## 两类后果分开处理
 *
 * - 跨角色（学生开 `/teacher/*`，或反过来）→ 送回**自己角色**首页；
 * - 同角色但视图不存在（含 `/physics` 这种缺视图的路径）→ 也送回自己角色首页，
 *   而不是让路由的 `default` 顶上一个「看起来正常」的页面——地址栏与内容错配
 *   比直接回首页更难排查。
 *
 * 会话未水合时不判定，避免刷新被误伤（与 `resolveDeepLinkRoleGate` 同一口径）。
 */
export function resolveWorkbenchRedirect(
  pathname: string,
  sessionRole: UserRole | null,
): { blocked: boolean; redirectTo: string | null } {
  const segments = String(pathname ?? '')
    .split('/')
    .filter(Boolean);
  const prefix = segments[0] ?? '';
  const view = segments[1] ?? '';

  const pathRole: UserRole | null =
    prefix === STUDENT_ROUTE_PREFIX.slice(1)
      ? 'student'
      : prefix === TEACHER_ROUTE_PREFIX.slice(1)
        ? 'teacher'
        : null;

  if (!pathRole || !sessionRole) return { blocked: false, redirectTo: null };

  const home = routeFor(sessionRole, ROLE_HOME_VIEW[sessionRole]);
  if (pathRole !== sessionRole) return { blocked: true, redirectTo: home };

  const known = (
    sessionRole === 'student' ? STUDENT_VIEW_IDS : TEACHER_VIEW_IDS
  ) as readonly string[];
  return known.includes(view)
    ? { blocked: false, redirectTo: null }
    : { blocked: true, redirectTo: home };
}

const studentShortcutSet: Array<Omit<ShortcutBinding, 'scope'>> = [
  {
    label: '总览',
    hint: 'gai lan / overview',
    combo: 'g o',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'overview' },
  },
  {
    label: '学情诊断',
    hint: 'xue qing zhen duan / diagnosis',
    combo: 'g d',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'diagnosis' },
  },
  {
    label: '课前诊断与配对',
    hint: 'ke qian / preclass',
    combo: 'g k',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'preclass' },
  },
  {
    label: '课中伴随诊断',
    hint: 'ke zhong ban sui / inclass',
    combo: 'g b',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'inclass' },
  },
  {
    label: '课后过程性评价',
    hint: 'ke hou ping jia / postclass',
    combo: 'g j',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'postclass' },
  },
  {
    label: '章节与知识图谱',
    hint: 'zhang jie',
    combo: 'g c',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'curriculum' },
  },
  {
    label: '项目匹配',
    hint: 'xiang mu',
    combo: 'g p',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'projects' },
  },
  {
    label: '任务闯关',
    hint: 'ren wu chuang guan',
    combo: 'g t',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'tasks' },
  },
  {
    label: 'AI 助教',
    hint: 'AI zhu jiao',
    combo: 'g a',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'assistant' },
  },
  {
    label: '虚拟实验',
    hint: 'xu ni shi yan',
    combo: 'g l',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'lab' },
  },
  {
    label: '学习报告',
    hint: 'xue xi bao gao',
    combo: 'g r',
    requiresSession: true,
    action: { type: 'navigate', role: 'student', view: 'report' },
  },
  // 重置必须按角色分开：学生侧只清自己的学习过程，教师侧才允许清空全量数据
  // （含教师复核记录）。两者混成一条命令时，学生的一次误操作就会抹掉
  // 教师已经批改到一半的复核成果。
  {
    label: '重置我的学习记录',
    hint: 'reset',
    combo: '',
    requiresSession: true,
    action: { type: 'command', id: 'reset-student' },
  },
];

const teacherShortcutSet: Array<Omit<ShortcutBinding, 'scope'>> = [
  {
    label: '教师驾驶舱',
    hint: 'jiao shi jia shi cang',
    combo: 'g o',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'dashboard' },
  },
  {
    label: '班级画像',
    hint: 'ban ji hua xiang',
    combo: 'g c',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'class' },
  },
  {
    label: '章节项目矩阵',
    hint: 'zhang jie xiang mu',
    combo: 'g m',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'curriculum' },
  },
  {
    label: '评价复核',
    hint: 'ping jia fu he',
    combo: 'g e',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'evaluation' },
  },
  {
    label: '教学洞察',
    hint: 'jiao xue dong cha',
    combo: 'g i',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'insights' },
  },
  {
    label: '三诊审核',
    hint: 'san zhen shen he / reviews',
    combo: 'g r',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'reviews' },
  },
  {
    label: '成绩登记总表',
    hint: 'cheng ji biao / scores',
    combo: 'g s',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'scores' },
  },
  {
    label: '质量核验',
    hint: 'zhi liang he yan / verify',
    combo: 'g v',
    requiresSession: true,
    action: { type: 'navigate', role: 'teacher', view: 'verify' },
  },
  {
    label: '清空本地全部数据',
    hint: 'reset all',
    combo: '',
    requiresSession: true,
    action: { type: 'command', id: 'reset-all' },
  },
];

const commandPaletteSet: Array<Omit<ShortcutBinding, 'scope' | 'combo'>> = [
  {
    label: '查看操作快捷键',
    hint: 'shortcuts',
    requiresSession: false,
    action: { type: 'command', id: 'open-shortcuts-help' },
  },
  {
    label: '前往 AI 智能课堂',
    hint: 'AI classroom',
    requiresSession: false,
    action: { type: 'command', id: 'goto-ai-classroom' },
  },
  {
    label: '退出登录',
    hint: 'logout',
    requiresSession: true,
    action: { type: 'command', id: 'logout' },
  },
  {
    label: '跳到学习报告',
    hint: 'report',
    requiresSession: true,
    roleScope: 'student',
    action: { type: 'navigate', role: 'student', view: 'report' },
  },
  {
    label: '跳到评价复核',
    hint: 'evaluation',
    requiresSession: true,
    roleScope: 'teacher',
    action: { type: 'navigate', role: 'teacher', view: 'evaluation' },
  },
];

export const shortcuts: ShortcutBinding[] = [
  ...studentShortcutSet.map((binding) => ({ ...binding, scope: 'student' as CommandScope })),
  ...teacherShortcutSet.map((binding) => ({ ...binding, scope: 'teacher' as CommandScope })),
  ...commandPaletteSet.map((binding) => ({
    ...binding,
    scope: 'global' as CommandScope,
    combo: '',
  })),
];

/**
 * 学生端全部视图 id。
 *
 * 与 `components/physics/workbench.tsx` 的侧栏一一对应；放在这里是为了让
 * 路由文件（`app/physics/[view]/page.tsx`）能拿到同一份清单做静态化，
 * 而不必把整个工作台组件拖进服务端构建。
 */
export const STUDENT_VIEW_IDS: readonly StudentView[] = [
  'overview',
  'diagnosis',
  'preclass',
  'inclass',
  'postclass',
  'curriculum',
  'projects',
  'tasks',
  'assistant',
  'lab',
  'report',
];

/** 教师端全部视图 id（与 `components/physics/workbench.tsx` 的侧栏一一对应）。 */
export const TEACHER_VIEW_IDS: readonly TeacherView[] = [
  'dashboard',
  'class',
  'curriculum',
  'evaluation',
  'insights',
  'reviews',
  'scores',
  'verify',
];

export function findShortcutByCombo(
  role: UserRole | null,
  combo: string,
): ShortcutBinding | undefined {
  return shortcuts.find(
    (binding) =>
      binding.combo === combo &&
      (binding.scope === 'global' || (role !== null && binding.scope === role)),
  );
}

export function findShortcutsForPalette(role: UserRole | null): ShortcutBinding[] {
  return shortcuts.filter(
    (binding) =>
      (binding.scope === 'global' || (role !== null && binding.scope === role)) &&
      // 角色限定的命令面板条目只给对应角色看（跨角色跳转会造成 URL 与内容错配）。
      (binding.roleScope === undefined || (role !== null && binding.roleScope === role)),
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
