'use client';

/**
 * 物理工作台外壳：侧栏 + 上下文条 + 视图路由 + 命令面板 + 快捷键。
 *
 * 与 OpenMAIC 的 AI 课堂共用品牌与账号；工作台侧栏提供「AI 智能课堂」
 * 入口，把两个能力域连成一条演示动线。
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Atom,
  Bot,
  ClipboardCheck,
  FileBarChart,
  FlaskConical,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListChecks,
  LogOut,
  Network,
  RotateCcw,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CommandPalette } from '@/components/physics/command-palette';
import { PhysicsViewProvider } from '@/components/physics/view-context';
import { usePhysicsState } from '@/components/physics/state-provider';
import { BRAND_FULL_NAME, CONTEXT_LABEL, COURSE, DEMO, PLATFORM, SCHOOL } from '@/lib/school';
import {
  STUDENT_ROUTE_PREFIX,
  TEACHER_ROUTE_PREFIX,
  findShortcutsForPalette,
  resolveDeepLinkRoleGate,
  routeFor,
  type ShortcutBinding,
  type StudentView,
  type TeacherView,
} from '@/lib/physics/shortcuts';
import { useShortcuts } from '@/lib/physics/use-shortcuts';
import { formatUndoRemaining } from '@/lib/physics/undo';
import { cn } from '@/lib/utils';

interface NavItem {
  id: StudentView | TeacherView;
  label: string;
  icon: LucideIcon;
}

const STUDENT_NAV: NavItem[] = [
  { id: 'overview', label: '学习总览', icon: LayoutDashboard },
  { id: 'diagnosis', label: '学情诊断', icon: ClipboardCheck },
  { id: 'curriculum', label: '章节与知识图谱', icon: Network },
  { id: 'projects', label: '项目匹配', icon: Library },
  { id: 'tasks', label: '任务闯关', icon: ListChecks },
  { id: 'assistant', label: 'AI 助教', icon: Bot },
  { id: 'lab', label: '虚拟实验', icon: FlaskConical },
  { id: 'report', label: '学习报告', icon: FileBarChart },
];

const TEACHER_NAV: NavItem[] = [
  { id: 'dashboard', label: '教学驾驶舱', icon: LayoutDashboard },
  { id: 'class', label: '班级画像', icon: Users },
  { id: 'curriculum', label: '课程项目矩阵', icon: Network },
  { id: 'evaluation', label: '评价复核', icon: ClipboardCheck },
  { id: 'insights', label: '教学洞察', icon: Lightbulb },
];

const STUDENT_VIEWS = new Set<string>(STUDENT_NAV.map((item) => item.id));
const TEACHER_VIEWS = new Set<string>(TEACHER_NAV.map((item) => item.id));

/** 从路径解析角色与视图。 */
export function parseWorkbenchPath(
  pathname: string,
): { role: 'student' | 'teacher'; view: StudentView | TeacherView } | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [prefix, view] = segments;
  if (prefix === 'physics' && STUDENT_VIEWS.has(view)) {
    return { role: 'student', view: view as StudentView };
  }
  if (prefix === 'teacher' && TEACHER_VIEWS.has(view)) {
    return { role: 'teacher', view: view as TeacherView };
  }
  return null;
}

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, hydrated, signOut, reset, resetStudent, rollback, lastUndo } = usePhysicsState();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  // 破坏性动作先确认再执行：命令面板一按回车就清库的体验既危险又无法撤回。
  const [resetTarget, setResetTarget] = React.useState<'student' | 'all' | null>(null);

  const parsed = parseWorkbenchPath(pathname);
  const role = session?.role ?? null;
  const nav = role === 'teacher' ? TEACHER_NAV : STUDENT_NAV;

  /**
   * **路径前缀决定渲染哪个角色的内容**：`app/teacher/[view]` 渲染教师组件、
   * `app/physics/[view]` 渲染学生组件——而路径是任何人都能手输的。
   *
   * in-app 切换已被 `navigate()` 里的 allowed 集合挡住（纵深防御），
   * 但**首屏深链接**原来没挡：学生直接打开 `/teacher/evaluation`，
   * 看到的是教师端内容，侧栏却还是学生导航——地址栏与内容错配，
   * 「学生进不了教师端」这句话也就不成立了。
   *
   * 这里把跨角色深链接送回自己角色的首页；并且**在跳转完成前不渲染别角色的内容**
   * ——children 是按路由渲染的，不挡一下就会闪一帧教师端界面。
   */
  const parsedRole = parsed?.role ?? null;
  const roleGate = resolveDeepLinkRoleGate(parsedRole, role);

  React.useEffect(() => {
    if (!hydrated || !roleGate.blocked || !roleGate.redirectTo) return;
    router.replace(roleGate.redirectTo);
  }, [hydrated, roleGate.blocked, roleGate.redirectTo, router]);

  // 当前视图放在本地状态里：断网时 Next 的动态路由跳转必然失败（要拉 RSC
  // payload），但工作台的内容全是客户端组件，不该被网络拖住。
  // 详见 `components/physics/view-context.tsx`。
  const [view, setView] = React.useState<string>(parsed?.view ?? '');

  // 路径被外部改变（首屏深链接、浏览器前进后退）时同步回来。
  React.useEffect(() => {
    if (parsed?.view) setView(parsed.view);
  }, [parsed?.view]);

  const navigate = React.useCallback(
    (route: string) => {
      const nextView = route.split('/').filter(Boolean)[1];
      // 只允许切到**当前角色**的视图。纵深防御：即便某天命令面板又混进了
      // 跨角色条目，或目标路径拼错，也不能让地址栏与内容错配
      // （URL 变成 /teacher/evaluation、内容仍是学生工作台）。
      const allowed = role === 'teacher' ? TEACHER_VIEWS : STUDENT_VIEWS;
      if (!nextView || !allowed.has(nextView)) return;
      // 先切内容。
      setView(nextView);
      // 再更新地址栏——但**不走 Next 的路由跳转**。Next.js 15+ 的动态路由客户端
      // 跳转一定要拉一次该路由的 RSC payload；断网时这次拉取失败，Next 会把
      // 整页换成路由错误页（实测：页面直接白屏），而工作台的内容根本不需要网络。
      // 这里用原生 History API 改地址栏：Next 的 App Router 会与之同步，
      // 地址栏、深链接、前进后退都照常工作，只是不触发任何网络请求。
      window.history.pushState(null, '', route);
    },
    [role],
  );

  const onCommand = React.useCallback(
    (id: string) => {
      if (id === 'logout') {
        signOut();
        router.push('/login');
        return;
      }
      if (id === 'reset-student') {
        setResetTarget('student');
        return;
      }
      if (id === 'reset-all') {
        setResetTarget('all');
        return;
      }
      if (id === 'open-shortcuts-help') {
        setHelpOpen(true);
        return;
      }
      if (id === 'goto-ai-classroom') {
        router.push('/');
        return;
      }
    },
    [reset, router, signOut],
  );

  const confirmReset = React.useCallback(() => {
    if (resetTarget === 'student') {
      resetStudent('从命令面板重置我的学习记录');
    } else if (resetTarget === 'all') {
      reset('从命令面板清空本地全部数据');
    }
    setResetTarget(null);
  }, [reset, resetStudent, resetTarget]);

  const { open, setOpen, shortcuts } = useShortcuts({
    role,
    navigate,
    onCommand,
    onShowHelp: () => setHelpOpen(true),
  });

  React.useEffect(() => {
    if (open) setPaletteOpen(true);
  }, [open]);

  // 视图变化时收起侧栏（移动端）。
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // 未登录：引导到登录页。Effect 必须在早退之前声明，避免 Hooks 顺序违规。
  // hydrated 之前不做判断：会话存在 sessionStorage 里，挂载前读不到，
  // 此时跳转会误伤正常刷新。
  React.useEffect(() => {
    if (!hydrated) return;
    if (!session) router.replace('/login');
  }, [router, session, hydrated]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6 text-[13px] text-muted-foreground">
        正在加载工作台…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6 text-[13px] text-muted-foreground">
        正在跳转登录页…
      </div>
    );
  }

  // 跨角色深链接：先别渲染别角色的内容，等上面的 effect 把地址栏带回去。
  if (roleGate.blocked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6 text-[13px] text-muted-foreground">
        正在返回{role === 'teacher' ? '教师' : '学生'}工作台…
      </div>
    );
  }

  const displayName = role === 'student' ? DEMO.studentName : COURSE.teacher;

  const paletteItems = findShortcutsForPalette(role);

  return (
    <PhysicsViewProvider value={{ view, setView: (next: string) => setView(next) }}>
      <div className="flex min-h-[100dvh] w-full bg-muted/40">
        {/* ═══ 侧栏 ═══ */}
        <aside
          data-physics-sidebar
          data-sidebar
          className={cn(
            'physics-sidebar fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-white/5 transition-transform md:static md:translate-x-0',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-4">
            <img
              src={SCHOOL.emblemSrc}
              alt={`${SCHOOL.college} 校徽`}
              width={260}
              height={60}
              className="h-8 w-auto shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-white">
                {PLATFORM.systemShortName}
              </p>
              <p className="truncate text-[10px] text-[var(--school-sidebar-muted)]">
                {SCHOOL.collegeShort} · {COURSE.name}
              </p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="工作台导航">
            <ul className="flex flex-col gap-0.5">
              {nav.map((item) => {
                const active = view === item.id;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    {/* 用 button 而不是 Link：视图切换由本地状态驱动（断网也生效），
                      避免原生跳转在断网时把整页换成浏览器的错误页。 */}
                    <button
                      type="button"
                      onClick={() =>
                        navigate(routeFor(role === 'teacher' ? 'teacher' : 'student', item.id))
                      }
                      data-nav-item
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-[var(--school-sidebar-muted)] transition-colors hover:text-white',
                        active && 'text-white',
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 border-t border-white/8 pt-3">
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--school-sidebar-muted)]">
                AI 智能课堂
              </p>
              <Link
                href="/"
                data-nav-item
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[var(--school-sidebar-muted)] transition-colors hover:text-white"
              >
                <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">生成 / 进入课堂</span>
              </Link>
            </div>
          </nav>

          <div className="border-t border-white/8 px-3 py-3 text-[11px] text-[var(--school-sidebar-muted)]">
            <p className="truncate">{BRAND_FULL_NAME}</p>
            <p className="mt-0.5 truncate">演示账号 · {displayName}</p>
          </div>
        </aside>

        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="关闭导航"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        {/* ═══ 主区域 ═══ */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 md:px-6">
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="打开导航"
                onClick={() => setMobileNavOpen(true)}
              >
                <ListChecks className="size-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <Atom className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{BRAND_FULL_NAME}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="打开命令面板"
                >
                  <span className="hidden sm:inline">命令面板</span>
                  <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                    ⌘K
                  </kbd>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="退出登录"
                  onClick={() => {
                    signOut();
                    router.push('/login');
                  }}
                >
                  <LogOut className="size-4" />
                </Button>
              </div>
            </div>
            <div className="physics-context-bar px-4 py-1.5 text-[11px] text-muted-foreground md:px-6">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{SCHOOL.college}</span>
                <span aria-hidden="true">·</span>
                <span>{COURSE.className}</span>
                <span aria-hidden="true">·</span>
                <span>{displayName}</span>
                <span aria-hidden="true">·</span>
                <span>{role === 'teacher' ? '教师工作台' : '学生工作台'}</span>
              </span>
            </div>
          </header>

          {lastUndo ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-[var(--school-primary-softer)] px-4 py-2 text-[12px] md:px-6 dark:bg-primary/10"
            >
              <span className="min-w-0 flex-1 truncate">
                已执行「{lastUndo.reason}」，{formatUndoRemaining(lastUndo)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // 不调用 `router.refresh()`：撤销快照已经完全在本地
                  // （`rollback()` 内部 `setState`，内容立刻重渲染），
                  // 而 refresh 会向服务端要一次当前路由的 RSC payload——
                  // 断网时这一步失败，Next 会把整页换成路由错误页。
                  rollback();
                }}
              >
                <RotateCcw className="size-3.5" />
                撤销到上一状态
              </Button>
            </div>
          ) : null}

          <main className="flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>

          <footer className="border-t border-border/70 px-4 py-4 text-[11px] text-muted-foreground md:px-6">
            <p>{BRAND_FULL_NAME} · 班级与成绩为课程示例数据，非真实教务数据</p>
          </footer>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          role={role}
          shortcuts={paletteItems}
          onSelect={(binding: ShortcutBinding) => {
            if (binding.action.type === 'navigate') {
              navigate(routeFor(binding.action.role, binding.action.view));
            } else {
              onCommand(binding.action.id);
            }
          }}
        />

        <AlertDialog
          open={resetTarget !== null}
          onOpenChange={(open) => !open && setResetTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {resetTarget === 'all' ? '清空本地全部数据？' : '重置我的学习记录？'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {resetTarget === 'all'
                  ? '将清空浏览器本地的全部工作台数据，包括学情诊断、闯关记录、实验数据与教师复核记录。操作前会自动生成 24 小时可恢复快照，你可以在工作台顶部横幅中一键撤销。'
                  : '将清空你本人的诊断结果、闯关进度、实验记录与笔记，并回到未选择项目的状态。教师的复核记录与学情画像都会保留。操作前会自动生成 24 小时可恢复快照，你可以在工作台顶部横幅中一键撤销。'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={confirmReset}>确认重置</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {helpOpen ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
            role="dialog"
            aria-modal="true"
            aria-label="快捷键帮助"
            onClick={() => setHelpOpen(false)}
          >
            {' '}
            <div
              className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="text-[15px] font-semibold">键盘快捷键</h2>
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {shortcuts
                  .filter((binding) => binding.combo)
                  .map((binding) => (
                    <li key={binding.label} className="flex items-center justify-between gap-3">
                      <span>{binding.label}</span>
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        {binding.combo.split('').join(' ')}
                      </kbd>
                    </li>
                  ))}
              </ul>
              <p className="mt-4 text-[12px] text-muted-foreground">
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                  ⌘K
                </kbd>{' '}
                打开命令面板 ·
                <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                  ?
                </kbd>{' '}
                打开本帮助
              </p>
              <Button className="mt-4 w-full" variant="outline" onClick={() => setHelpOpen(false)}>
                关闭
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </PhysicsViewProvider>
  );
}
