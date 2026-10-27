'use client';

/**
 * 物理工作台状态容器。
 *
 * 领域逻辑全部来自移植的纯函数层（`@/lib/physics/engine`），
 * 这里只负责 React 状态与浏览器持久化（localStorage 版本化包络）。
 * 破坏性动作走 24 小时可恢复快照（`@/lib/physics/undo`）。
 *
 * ## 学习数据按账号分区
 *
 * 有真正的账号系统之后，「一份学习数据」不再成立。存储键带 `userId`：
 * `physicsAISystem:<userId>`。**切换账号必须切换数据**，否则 A 的诊断分
 * 会出现在 B 的界面上——那是串数据，不只是不美观。
 *
 * 因此加载与保存都跟着 `session.userId` 走，并且**加载完成前不保存**
 * （否则会把上一个账号的旧状态写进新账号的键里）。
 */

import * as React from 'react';
import { toast } from 'sonner';

import {
  browserAccountDeps,
  clearSessionCookie,
  LocalAccountRepository,
  setSessionCookie,
} from '@/lib/physics/account-store';
import {
  createAccountSession,
  loginAccount,
  registerAccount,
  type AccountDeps,
  type AccountErrorCode,
  type AccountRepository,
} from '@/lib/physics/accounts';
import {
  clearDiagnosisResult,
  createInitialState,
  loadState,
  resetProjectProgress,
  resetStudentProgress,
  saveStateWithReason,
  updateState,
  type SaveFailureReason,
} from '@/lib/physics/local-store';
import {
  authenticate,
  clearSession,
  createDemoSession,
  getSession,
  setSession,
  type PhysicsSession,
} from '@/lib/physics/session';
import { clearSubmission } from '@/lib/physics/submissions';
import {
  clearUndoSnapshot,
  readUndoMeta,
  readUndoSnapshot,
  writeUndoSnapshot,
  type UndoMeta,
} from '@/lib/physics/undo';
import type { AppState, UserRole } from '@/lib/physics/types';

/** 注册表单输入。 */
export interface RegisterInput {
  username: string;
  password: string;
  displayName?: string;
  role: UserRole;
}

/**
 * 登录/注册的结果。
 *
 * `error` 是可区分的错误码，由界面映射成文案；
 * 成功时把**会话**一并返回——调用方要按会话里的角色决定落到哪一端
 * （教师该进驾驶舱，不是学生首页）。
 */
export type AuthOutcome =
  | { ok: true; session: PhysicsSession }
  | { ok: false; error: AccountErrorCode };

interface PhysicsStateContextValue {
  /** 当前学习/教学状态。 */
  state: AppState;
  /** 合并式更新状态（自动持久化）。 */
  update: (patch: Partial<AppState>) => void;
  /** 破坏性动作：先写快照再清空。 */
  reset: (reason: string) => void;
  /** 切换项目：先写快照，再只清空项目级进度（保留学情画像与教师复核）。 */
  resetProject: (reason: string, projectId: string | null) => void;
  /** 重新诊断：先写快照，再只清空诊断结果（保留项目进度与实验记录）。 */
  resetDiagnosis: (reason: string) => void;
  /** 学生侧重置：先写快照，再只清空学生自己的学习过程（保留教师复核成果）。 */
  resetStudent: (reason: string) => void;
  /** 回滚到最近一次快照。 */
  rollback: () => boolean;
  /** 最近一次可撤销操作的元信息。 */
  lastUndo: UndoMeta | null;
  /** 当前登录会话。 */
  session: PhysicsSession | null;
  /** 登录（账号系统主路径）。 */
  signIn: (username: string, password: string) => Promise<AuthOutcome>;
  /** 注册并登录。 */
  register: (input: RegisterInput) => Promise<AuthOutcome>;
  /** 一键进入（访客体验：以演示身份直接进入，不校验口令）。 */
  enterAsDemo: (role: UserRole) => void;
  /** 退出登录。 */
  signOut: () => void;
  /**
   * 是否已完成浏览器存储的首次读取。
   *
   * 服务端渲染阶段拿不到 localStorage / sessionStorage，若在渲染期直接读取，
   * 服务端 HTML 与客户端首次渲染就会不一致（React 水合错误 #418）。
   * 因此首帧统一使用空状态，挂载后再补齐真实数据。
   */
  hydrated: boolean;
  /**
   * 最近一次保存失败的原因；`null` 表示当前写入正常。
   *
   * 暴露出来是为了让界面能挂一条**常驻**提示——toast 会消失，
   * 而「存储已满」是一个用户不处理就不会自己好的状态。
   */
  persistIssue: SaveFailureReason | null;
}

const PhysicsStateContext = React.createContext<PhysicsStateContextValue | null>(null);

/** 持久化失败提示的固定 id：同一条提示反复触发时合并，不会堆成一屏。 */
const PERSIST_TOAST_ID = 'physics-persist-failed';

/** 快照写不进去时的那条提示。 */
const UNDO_TOAST_ID = 'physics-undo-unavailable';

function persistFailureTitle(reason: SaveFailureReason): string {
  return reason === 'quota' ? '浏览器存储已满，学习进度没能保存' : '学习进度没能保存';
}

function persistFailureHint(reason: SaveFailureReason): string {
  if (reason === 'quota') {
    return '请到浏览器设置里清理本站数据，或退出无痕模式后重试。当前这一节课的进度仍在页面里，刷新后会丢失。';
  }
  if (reason === 'unavailable') {
    return '当前浏览器不允许本站写入本地存储（无痕模式或隐私设置）。这一节课可以照常进行，但刷新后进度不会保留。';
  }
  return '写入本地存储时出错。这一节课可以照常进行，但刷新后进度可能不会保留。';
}

export function PhysicsStateProvider({ children }: { children: React.ReactNode }) {
  // 首帧必须与服务端渲染结果一致：空状态 + 未登录 + 无快照。
  const [state, setState] = React.useState<AppState>(() => createInitialState());
  const [session, setSessionState] = React.useState<PhysicsSession | null>(null);
  const [lastUndo, setLastUndo] = React.useState<UndoMeta | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [persistIssue, setPersistIssue] = React.useState<SaveFailureReason | null>(null);
  /** 已经加载过数据的账号 id。用来判断「当前状态属于哪个账号」。 */
  const [loadedScope, setLoadedScope] = React.useState<string | undefined>(undefined);

  // 账号仓库与加密依赖：浏览器适配层的具体实现。
  const accountRepo = React.useMemo<AccountRepository>(() => new LocalAccountRepository(), []);
  const accountDeps = React.useMemo<AccountDeps>(() => browserAccountDeps(), []);

  /** 当前存储作用域 = 会话里的账号 id。未登录时没有作用域。 */
  const scope = session?.userId;

  // 挂载后再读取浏览器存储：服务端没有这些数据，只能延后到客户端。
  React.useEffect(() => {
    const current = getSession();
    setSessionState(current);
    setState(loadState(undefined, current?.userId));
    setLastUndo(readUndoMeta(current?.userId));
    setHydrated(true);
  }, []);

  // 账号变了 → 换成那个账号的数据。**必须先加载完再允许保存**，
  // 否则会把上一个账号的状态写进新账号的键里。
  React.useEffect(() => {
    if (!hydrated) return;
    if (loadedScope === scope) return;
    setState(loadState(undefined, scope));
    setLastUndo(readUndoMeta(scope));
    setLoadedScope(scope);
  }, [hydrated, scope, loadedScope]);

  // 持久化：状态变化即写入版本化 localStorage 包络（首次读取完成前不写，避免清空已有数据）。
  //
  // 写入**必须检查结果**。原来这里把返回值直接丢掉：localStorage 写满
  // （5 MB 上限、Safari 无痕、用户禁用存储）时，闯关进度、诊断结果、
  // 实验记录全部丢失而界面上一个字都没有——学生会以为「已经保存了」，
  // 第二天回来一切归零。这是最坏的一类 bug：数据没了，人还以为在。
  React.useEffect(() => {
    if (!hydrated) return;
    if (!scope) return;
    if (loadedScope !== scope) return;

    const outcome = saveStateWithReason(state, undefined, scope);
    const nextIssue = outcome.ok ? null : outcome.reason;
    if (nextIssue === persistIssue) return;

    setPersistIssue(nextIssue);
    if (nextIssue === null) {
      // 恢复：撤掉那条常驻提示。
      toast.dismiss(PERSIST_TOAST_ID);
      return;
    }
    toast.error(persistFailureTitle(nextIssue), {
      id: PERSIST_TOAST_ID,
      description: persistFailureHint(nextIssue),
      // 不自动消失：这是「不处理就不会自己好」的状态，
      // 飘走之后用户就再也看不到「数据正在丢」这件事了。
      duration: Infinity,
      closeButton: true,
    });
  }, [state, hydrated, scope, loadedScope, persistIssue]);

  const update = React.useCallback((patch: Partial<AppState>) => {
    setState((previous) => updateState(previous, patch));
  }, []);

  /**
   * 写快照，并**在写不进去时明确告知**。
   *
   * 这四个动作都会清掉数据。原来的写法是先写快照、再用 `readUndoMeta` 回读，
   * 失败时 `lastUndo` 停在 `null`——界面上只是「没有撤销按钮」，
   * 而用户刚刚已经点掉了自己的记录。也就是说「破坏性动作必须可逆」这条
   * 承诺在存储写满时会**静默失效**，恰恰是最需要它的时候。
   */
  const snapshotOrWarn = React.useCallback(
    (reason: string): UndoMeta | null => {
      const meta = writeUndoSnapshot(state, reason, scope);
      setLastUndo(meta);
      if (!meta) {
        toast.error('无法创建撤销快照，本次操作不可恢复', {
          id: UNDO_TOAST_ID,
          description: '浏览器存储写入失败（常见原因是存储已满）。这次清空之后没有退路。',
          duration: Infinity,
          closeButton: true,
        });
      }
      return meta;
    },
    [state, scope],
  );

  const reset = React.useCallback(
    (reason: string) => {
      snapshotOrWarn(reason);
      setState(createInitialState());
      // 本地清空了，共享提交键里的那一份也要撤掉——否则教师端还挂着
      // 一份「学生已经删掉」的结论，审核台看起来像没生效。
      clearSubmission(scope ?? '');
    },
    [snapshotOrWarn, scope],
  );

  const resetProject = React.useCallback(
    (reason: string, projectId: string | null) => {
      snapshotOrWarn(reason);
      setState(resetProjectProgress(state, projectId));
    },
    [snapshotOrWarn, state],
  );

  const resetDiagnosis = React.useCallback(
    (reason: string) => {
      snapshotOrWarn(reason);
      setState(clearDiagnosisResult(state));
    },
    [snapshotOrWarn, state],
  );

  const resetStudent = React.useCallback(
    (reason: string) => {
      snapshotOrWarn(reason);
      setState(resetStudentProgress(state));
      // 三诊记录也被清空了，共享键里那份一并撤掉（理由同 `reset`）。
      clearSubmission(scope ?? '');
    },
    [snapshotOrWarn, state, scope],
  );

  const rollback = React.useCallback(() => {
    const snapshot = readUndoSnapshot(scope);
    if (!snapshot) return false;
    setState(snapshot);
    clearUndoSnapshot(scope);
    setLastUndo(null);
    return true;
  }, [scope]);

  const signIn = React.useCallback(
    async (username: string, password: string): Promise<AuthOutcome> => {
      // 先走账号系统（注册出来的账号），再退回演示账号（访客体验的旧路径）。
      const result = await loginAccount(accountRepo, username, password, accountDeps);
      if (result.ok) {
        const next = createAccountSession(result.value, accountDeps.now());
        setSession(next);
        setSessionState(next);
        setSessionCookie(next);
        return { ok: true, session: next };
      }
      const demo = authenticate(username, password);
      if (demo) {
        setSession(demo);
        setSessionState(demo);
        setSessionCookie(demo);
        return { ok: true, session: demo };
      }
      return { ok: false, error: result.error };
    },
    [accountRepo, accountDeps],
  );

  const register = React.useCallback(
    async (input: RegisterInput): Promise<AuthOutcome> => {
      const result = await registerAccount(accountRepo, input, accountDeps);
      if (!result.ok) return { ok: false, error: result.error };
      const next = createAccountSession(result.value, accountDeps.now());
      setSession(next);
      setSessionState(next);
      setSessionCookie(next);
      return { ok: true, session: next };
    },
    [accountRepo, accountDeps],
  );

  const enterAsDemo = React.useCallback((role: UserRole) => {
    const demo = createDemoSession(role);
    setSession(demo);
    setSessionState(demo);
    setSessionCookie(demo);
  }, []);

  const signOut = React.useCallback(() => {
    clearSession();
    clearSessionCookie();
    setSessionState(null);
  }, []);

  const value = React.useMemo<PhysicsStateContextValue>(
    () => ({
      state,
      update,
      reset,
      resetProject,
      resetDiagnosis,
      resetStudent,
      rollback,
      lastUndo,
      session,
      signIn,
      register,
      enterAsDemo,
      signOut,
      hydrated,
      persistIssue,
    }),
    [
      state,
      update,
      reset,
      resetProject,
      resetDiagnosis,
      resetStudent,
      rollback,
      lastUndo,
      session,
      signIn,
      register,
      enterAsDemo,
      signOut,
      hydrated,
      persistIssue,
    ],
  );

  return <PhysicsStateContext.Provider value={value}>{children}</PhysicsStateContext.Provider>;
}

export function usePhysicsState(): PhysicsStateContextValue {
  const context = React.useContext(PhysicsStateContext);
  if (!context) {
    throw new Error('usePhysicsState 必须在 PhysicsStateProvider 内使用');
  }
  return context;
}
