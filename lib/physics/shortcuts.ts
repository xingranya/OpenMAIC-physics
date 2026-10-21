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
  | 'curriculum'
  | 'projects'
  | 'tasks'
  | 'assistant'
  | 'lab'
  | 'report';

export type TeacherView = 'dashboard' | 'class' | 'curriculum' | 'evaluation' | 'insights';

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
    action: { type: 'navigate', role: 'student', view: 'report' },
  },
  {
    label: '跳到评价复核',
    hint: 'evaluation',
    requiresSession: true,
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
    (binding) => binding.scope === 'global' || (role !== null && binding.scope === role),
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
