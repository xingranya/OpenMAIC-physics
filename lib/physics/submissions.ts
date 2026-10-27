/**
 * 「三诊」提交桥：让教师账号真的能审到学生账号的结论。
 *
 * ## 为什么必须单独有这一层
 *
 * 学习数据是**按账号分区**存的（`physicsAISystem:<userId>`，见 `local-store.ts`）。
 * 这个设计是对的——A 的诊断分不该出现在 B 的界面上。但它同时意味着：
 * 教师登录后，自己的键里只有自己的数据，**读不到学生那份**。
 *
 * 于是「教师审核」这件事在纯客户端 + 分区存储的前提下，天然断成两截。
 * 断着的话，三个环节都只能停在「AI 给了建议」——申请书要的
 * 「AI 建议 → 教师审核 → 学生认可」闭环根本没有走完。
 *
 * 所以这里加一条**显式的、不分区的通道**：学生提交时把结论写进
 * `physicsAISystem:submissions`（一个共享键，按 `studentId` 归档），
 * 教师从这个键里读、把审核结果写回去，学生端再把审核结果并回自己的状态。
 *
 * ## 这条通道的能力边界（界面上也要说清楚）
 *
 * 它只解决**同一浏览器内的两个账号**：评委/老师在一台电脑上先以学生身份
 * 提交，再退出、以教师身份登录审核，回到学生身份就能看到审核结果。
 * **跨设备、跨浏览器不成立**——那需要服务端，而本平台目前是文件模式，
 * 课堂数据本来就不保证跨实例保留。这不是「偷懒的实现」，是刻意把
 * 部署边界写进代码注释和界面提示，避免被当成「已支持多端协同」。
 *
 * ## 为什么写入要整体覆盖而不是逐字段合并
 *
 * 共享键里存的是**学生的提交快照**，不是学生的实时状态。教师读到的应该是
 * 「学生最后一次提交时的结论」，所以学生每次提交都整条覆盖；
 * 教师的审核则只改 `review` / `teacher` / `ack` 这几个字段——
 * 教师无权改学生答了什么。
 */

import { TASK_TEMPLATES } from './data';
import { calculateTaskProgress } from './engine';
import {
  normaliseAck,
  normaliseInClass,
  normalisePostClass,
  normalisePreClass,
  normaliseReview,
} from './local-store';
import type {
  AppState,
  InClassExchange,
  PostClassRecord,
  PreClassPlan,
  StageReview,
  StorageLike,
  StudentAck,
  SubmissionEvidence,
} from './types';

/** 共享提交键。**不带 userId**——它本来就是跨账号的那一条通道。 */
export const SUBMISSIONS_STORAGE_KEY = 'physicsAISystem:submissions';

/** 提交包络版本。结构变了就递增，读时按版本决定是否丢弃。 */
export const SUBMISSIONS_VERSION = 1;

/** 三个环节的标识。 */
export type StageKey = 'preclass' | 'inclass' | 'postclass';

/** 一名学生当前的三诊提交。 */
export interface StageSubmission {
  studentId: string;
  studentName: string;
  /** 最近一次提交/更新的时间（ISO）。教师端按它排序与显示「多久之前」。 */
  updatedAt: string;
  preClass?: PreClassPlan;
  inClass: InClassExchange[];
  postClass?: PostClassRecord;
  /**
   * 证据快照（作品版本数、互评数、任务进度等）。
   *
   * 四项核验指标都要「这个学生有没有留下证据」，而教师读不到学生的分区数据，
   * 所以让学生随提交把**计数**送过来。只送计数不送明细：明细留在学生自己的
   * 键里，教师需要时按提交内容追问。
   */
  evidence?: SubmissionEvidence;
}

interface SubmissionEnvelope {
  version: number;
  data: Record<string, StageSubmission>;
}

function getDefaultStorage(): StorageLike | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

/** 读整个提交表。损坏或版本过新时返回空表，不抛错（读不该让页面崩）。 */
function readMap(storage: StorageLike | undefined): Record<string, StageSubmission> {
  if (!storage) return {};
  let raw: string | null = null;
  try {
    raw = storage.getItem(SUBMISSIONS_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const envelope = parsed as Partial<SubmissionEnvelope>;
    if (typeof envelope.version === 'number' && envelope.version > SUBMISSIONS_VERSION) return {};
    const data = envelope.data;
    if (!data || typeof data !== 'object') return {};

    const result: Record<string, StageSubmission> = {};
    Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const source = value as Partial<StageSubmission>;
      const studentId = typeof source.studentId === 'string' ? source.studentId : key;
      if (!studentId) return;
      const evidence = normaliseEvidence(source.evidence);
      result[studentId] = {
        studentId,
        studentName: typeof source.studentName === 'string' ? source.studentName : studentId,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
        preClass: normalisePreClass(source.preClass),
        inClass: normaliseInClass(source.inClass),
        postClass: normalisePostClass(source.postClass),
        ...(evidence ? { evidence } : {}),
      };
    });
    return result;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, StageSubmission>, storage: StorageLike | undefined): boolean {
  if (!storage) return false;
  try {
    const envelope: SubmissionEnvelope = { version: SUBMISSIONS_VERSION, data: map };
    storage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    // 写不进去（配额满 / 无痕）时返回 false，由调用方决定要不要提示。
    return false;
  }
}

/** 读全部提交，按最近更新倒序。教师端直接用这个。 */export function readSubmissions(
  storage: StorageLike | undefined = getDefaultStorage(),
): StageSubmission[] {
  return Object.values(readMap(storage)).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

/** 读单个学生的提交。 */
export function readSubmission(
  studentId: string,
  storage: StorageLike | undefined = getDefaultStorage(),
): StageSubmission | undefined {
  if (!studentId) return undefined;
  return readMap(storage)[studentId];
}

/** 读出、改一条、写回。返回是否写成功。 */
function mutate(
  studentId: string,
  storage: StorageLike | undefined,
  patch: (current: StageSubmission) => StageSubmission | null,
): boolean {
  if (!studentId) return false;
  const map = readMap(storage);
  const current = map[studentId];
  if (!current) return false;
  const next = patch(current);
  if (!next) return false;
  map[studentId] = next;
  return writeMap(map, storage);
}

function blankSubmission(studentId: string, studentName: string, at: string): StageSubmission {
  return { studentId, studentName, updatedAt: at, inClass: [] };
}

/** 证据快照的归一化：计数一律取非负整数，缺省 0。 */function normaliseEvidence(value: unknown): SubmissionEvidence | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<SubmissionEvidence>;
  const count = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
  return {
    ...(typeof source.adoptedProjectId === 'string' && source.adoptedProjectId
      ? { adoptedProjectId: source.adoptedProjectId }
      : {}),
    taskCompleted: count(source.taskCompleted),
    taskTotal: count(source.taskTotal),
    versionCount: count(source.versionCount),
    peerReviewCount: count(source.peerReviewCount),
    hasRole: source.hasRole === true,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 学生侧：提交
 * ══════════════════════════════════════════════════════════════════════ */

export function publishPreClass(
  input: { studentId: string; studentName: string; plan: PreClassPlan; now?: number },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, studentName, plan, now = Date.now() } = input;
  if (!studentId) return false;
  const map = readMap(storage);
  const current = map[studentId] ?? blankSubmission(studentId, studentName, nowIso(now));
  map[studentId] = {
    ...current,
    studentName,
    updatedAt: nowIso(now),
    preClass: plan,
  };
  return writeMap(map, storage);
}

/** 提交一轮课中问答。同一 id 重复提交则覆盖（学生改了答案重交）。 */
export function publishInClassExchange(
  input: {
    studentId: string;
    studentName: string;
    exchange: InClassExchange;
    now?: number;
  },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, studentName, exchange, now = Date.now() } = input;
  if (!studentId) return false;
  const map = readMap(storage);
  const current = map[studentId] ?? blankSubmission(studentId, studentName, nowIso(now));
  const others = current.inClass.filter((item) => item.id !== exchange.id);
  map[studentId] = {
    ...current,
    studentName,
    updatedAt: nowIso(now),
    inClass: [...others, exchange],
  };
  return writeMap(map, storage);
}

export function publishPostClass(
  input: { studentId: string; studentName: string; record: PostClassRecord; now?: number },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, studentName, record, now = Date.now() } = input;
  if (!studentId) return false;
  const map = readMap(storage);
  const current = map[studentId] ?? blankSubmission(studentId, studentName, nowIso(now));
  map[studentId] = {
    ...current,
    studentName,
    updatedAt: nowIso(now),
    postClass: record,
  };
  return writeMap(map, storage);
}

/* ══════════════════════════════════════════════════════════════════════
 * 学生侧：证据快照
 *
 * 与三诊提交分开成一个函数，是因为它的更新时机不同：三诊是「生成一次提一次」，
 * 证据是「每加一版作品 / 每写一条互评就要更新」。合在一起会让教师端
 * 频繁看到「刚提交」的错觉。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 从当前状态生成证据快照。
 *
 * `adoptedProjectId` 显式传入而不从 `state.projectId` 读：采用案例的那一步
 * 刚改完 `projectId`，调用方手里的 `state` 还是旧的。让调用方说清「最终
 * 采用哪个」，比让这个函数猜更可靠。
 */
export function buildEvidence(state: AppState, adoptedProjectId?: string): SubmissionEvidence {
  const progress = calculateTaskProgress(state.taskChecks, TASK_TEMPLATES);
  return {
    ...(adoptedProjectId ?? state.projectId
      ? { adoptedProjectId: adoptedProjectId ?? state.projectId ?? undefined }
      : {}),
    taskCompleted: progress.completed,
    taskTotal: progress.total,
    versionCount: state.versions.length,
    peerReviewCount: state.peerReviews.length,
    hasRole: Boolean(state.preClass?.groupRole),
  };
}

export function publishEvidence(
  input: {
    studentId: string;
    studentName: string;
    evidence: SubmissionEvidence;
    now?: number;
  },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, studentName, evidence, now = Date.now() } = input;
  if (!studentId) return false;
  const map = readMap(storage);
  const current = map[studentId] ?? blankSubmission(studentId, studentName, nowIso(now));
  map[studentId] = {
    ...current,
    studentName,
    updatedAt: nowIso(now),
    evidence,
  };
  return writeMap(map, storage);
}

/* ══════════════════════════════════════════════════════════════════════
 * 教师侧：审核
 *
 * 审核只改「结论」，不改学生答了什么——所以每个函数都只动
 * `review` / `teacher` 这几处，其余字段原样保留。
 * ══════════════════════════════════════════════════════════════════════ */

export function reviewPreClass(
  input: { studentId: string; review: StageReview; now?: number },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, review } = input;
  return mutate(studentId, storage, (current) =>
    current.preClass ? { ...current, preClass: { ...current.preClass, review } } : null,
  );
}

export function reviewExchange(
  input: { studentId: string; exchangeId: string; review: StageReview },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, exchangeId, review } = input;
  return mutate(studentId, storage, (current) => {
    if (!current.inClass.some((item) => item.id === exchangeId)) return null;
    return {
      ...current,
      inClass: current.inClass.map((item) =>
        item.id === exchangeId ? { ...item, review } : item,
      ),
    };
  });
}

/** 教师对课后评价的修正：给一个最终分 + 理由。 */
export function correctPostClass(
  input: { studentId: string; score: number; note: string; now?: number },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, score, note, now = Date.now() } = input;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return mutate(studentId, storage, (current) =>
    current.postClass
      ? {
          ...current,
          postClass: {
            ...current.postClass,
            teacher: { score: clamped, note, at: nowIso(now) },
          },
        }
      : null,
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * 学生侧：认可（第三步）
 *
 * 认可写在共享键里，教师下一次打开审核台就能看到「学生仍有疑问」——
 * 这是闭环真正合上的地方。只存在学生本地的话，教师永远不知道
 * 自己通过的那条结论学生其实不认。
 * ══════════════════════════════════════════════════════════════════════ */

export function ackStage(
  input: { studentId: string; stage: StageKey; ack: StudentAck; exchangeId?: string },
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  const { studentId, stage, ack, exchangeId } = input;
  if (stage === 'preclass') {
    return mutate(studentId, storage, (current) =>
      current.preClass ? { ...current, preClass: { ...current.preClass, ack } } : null,
    );
  }
  if (stage === 'postclass') {
    return mutate(studentId, storage, (current) =>
      current.postClass ? { ...current, postClass: { ...current.postClass, ack } } : null,
    );
  }
  if (!exchangeId) return false;
  return mutate(studentId, storage, (current) => {
    if (!current.inClass.some((item) => item.id === exchangeId)) return null;
    return {
      ...current,
      inClass: current.inClass.map((item) =>
        item.id === exchangeId ? { ...item, ack } : item,
      ),
    };
  });
}

/** 学生重置学习记录时清掉自己在共享键里的存档，避免教师端还挂着一份旧结论。 */
export function clearSubmission(
  studentId: string,
  storage: StorageLike | undefined = getDefaultStorage(),
): boolean {
  if (!studentId) return false;
  const map = readMap(storage);
  if (!(studentId in map)) return true;
  delete map[studentId];
  return writeMap(map, storage);
}

/* ══════════════════════════════════════════════════════════════════════
 * 学生侧：把审核结果并回本地状态
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 审核结果以共享键为准，但**只在两边能对上号时合并**。
 *
 * 对号依据是提交时写下的时间戳 / 记录 id：
 * - 课前方案比 `submittedAt`：学生重新生成过方案，旧审核就作废；
 * - 课中问答比 `id`：每一轮问答是独立的一条；
 * - 课后评价比 `generatedAt`：重新生成后旧修正不再适用。
 *
 * 对不上号时**保留本地**。这一步很关键：否则学生刚重新生成的内容会被
 * 上一次的旧审核结果盖掉，看起来像「改了半天没变」。
 */
export function mergeSharedIntoState(
  state: AppState,
  studentId: string | undefined,
  storage: StorageLike | undefined = getDefaultStorage(),
): { state: AppState; changed: boolean } {
  if (!studentId) return { state, changed: false };
  const shared = readSubmission(studentId, storage);
  if (!shared) return { state, changed: false };

  let changed = false;

  // ── 课前 ──
  let preClass = state.preClass;
  if (preClass && shared.preClass && shared.preClass.submittedAt === preClass.submittedAt) {
    const review = preferReview(preClass.review, shared.preClass.review);
    const ack = shared.preClass.ack ?? preClass.ack;
    if (!sameReview(review, preClass.review) || !sameAck(ack, preClass.ack)) {
      preClass = { ...preClass, review, ...(ack ? { ack } : {}) };
      changed = true;
    }
  }

  // ── 课中 ──
  let inClass = state.inClass;
  if (shared.inClass.length > 0) {
    const byId = new Map(shared.inClass.map((item) => [item.id, item]));
    let touched = false;
    const next = state.inClass.map((item) => {
      const counterpart = byId.get(item.id);
      if (!counterpart) return item;
      const review = preferReview(item.review, counterpart.review);
      const ack = counterpart.ack ?? item.ack;
      if (sameReview(review, item.review) && sameAck(ack, item.ack)) return item;
      touched = true;
      return { ...item, review, ...(ack ? { ack } : {}) };
    });
    if (touched) {
      inClass = next;
      changed = true;
    }
  }

  // ── 课后 ──
  let postClass = state.postClass;
  if (
    postClass &&
    shared.postClass &&
    shared.postClass.generatedAt === postClass.generatedAt
  ) {
    const teacher = shared.postClass.teacher ?? postClass.teacher;
    const ack = shared.postClass.ack ?? postClass.ack;
    const teacherChanged = JSON.stringify(teacher) !== JSON.stringify(postClass.teacher);
    if (teacherChanged || !sameAck(ack, postClass.ack)) {
      postClass = { ...postClass, ...(teacher ? { teacher } : {}), ...(ack ? { ack } : {}) };
      changed = true;
    }
  }

  if (!changed) return { state, changed: false };
  return {
    state: { ...state, preClass, inClass, postClass },
    changed: true,
  };
}

/** 审核结果优先取「已经审过」的那一份；两边都没审就用本地。 */
function preferReview(local: StageReview, incoming: StageReview | undefined): StageReview {
  if (!incoming) return local;
  if (incoming.status === 'pending' && local.status !== 'pending') return local;
  return incoming;
}

function sameReview(left: StageReview, right: StageReview | undefined): boolean {
  if (!right) return false;
  return (
    left.status === right.status &&
    (left.note ?? '') === (right.note ?? '') &&
    (left.by ?? '') === (right.by ?? '') &&
    (left.at ?? '') === (right.at ?? '')
  );
}

function sameAck(left: StudentAck | undefined, right: StudentAck | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.accepted === right.accepted && (left.note ?? '') === (right.note ?? '');
}

/** 导出给界面用：判断一条审核是否已经处理过。 */
export function isReviewed(review: StageReview | undefined): boolean {
  return review !== undefined && review.status !== 'pending';
}

/** 供测试与界面复用：把任意对象收敛成合法审核。 */
export { normaliseAck, normaliseReview };
