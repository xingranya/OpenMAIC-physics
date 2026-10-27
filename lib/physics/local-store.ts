import { DEMO_ACCOUNTS, PHYSICS_AI_PASSWORD } from './data';
import type {
  AbilityPoint,
  AbilityTier,
  AppState,
  ChatMessage,
  DemoAccount,
  DiagnosisResult,
  EvaluationSummary,
  EvaluationReview,
  FourAbility,
  InClassErrorKind,
  InClassExchange,
  LabRecord,
  PostClassRecord,
  PreClassPlan,
  Project,
  ProjectMatch,
  ReviewStatus,
  ScoreEntry,
  SheetStageKey,
  StageReview,
  StageScores,
  StorageEnvelope,
  StorageLike,
  StudentAck,
  StudentProfile,
  TeacherProfile,
  UserRole,
} from './types';

export type { StorageLike } from './types';

/**
 * 持久化版本。
 *
 * v2：加入「三诊」字段（`preClass` / `inClass` / `postClass`）。
 * 旧包络（v1）读进来仍然有效——`normaliseState` 会逐字段补齐缺失的部分，
 * 所以升级不需要写迁移函数，也不会把已有学习数据丢掉。
 */
export const STORAGE_VERSION = 2;
export const PERSISTENCE_VERSION = STORAGE_VERSION;
/** 继续使用原型键，升级后的包络格式不会丢失已有学习数据。 */
export const PHYSICS_STORAGE_KEY = 'physicsAISystem';
export const STORAGE_KEY = PHYSICS_STORAGE_KEY;
export const LEGACY_STORAGE_KEY = PHYSICS_STORAGE_KEY;

const MODERN_STORAGE_KEY = 'physics-ai-teaching-system';

/**
 * 学习数据的存储作用域——**按账号分区**。
 *
 * ## 为什么必须分区
 *
 * 有了真正的账号系统之后，「一份学习数据」不再成立：A 账号的诊断分、
 * 实验记录、教师复核**不能**出现在 B 账号的界面上。分区依据是会话里的
 * `userId`，所以键名带上它：`physicsAISystem:<userId>`。
 *
 * ## 旧数据怎么办
 *
 * 升级前只有**一份**无作用域的数据，它属于当时的演示身份。
 * 所以旧键只作为**演示学生**的种子被继承一次（`LEGACY_STORAGE_SCOPE`），
 * 其余账号从空状态开始——宁可让新账号看不到旧数据，也不能让两个账号互相看到。
 */
export type StorageScope = string;

/** 旧版无作用域数据的归属账号（演示学生）。 */
export const LEGACY_STORAGE_SCOPE = 'demo-student';

/** 按作用域拼出存储键。 */
export function storageKeyForScope(scope: StorageScope | undefined): string {
  return scope ? `${PHYSICS_STORAGE_KEY}:${scope}` : PHYSICS_STORAGE_KEY;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 创建相互独立的初始状态，避免测试或多个标签页共享数组引用。 */
export function createInitialState(): AppState {
  return {
    role: 'student',
    projectId: null,
    activeTask: 0,
    taskChecks: {},
    taskTexts: {},
    chat: [],
    labRecords: [],
    evaluationReviews: {},
    localProjects: [],
    inClass: [],
    scoreSheet: {},
  };
}

export const DEFAULT_APP_STATE = createInitialState();

function getDefaultStorage(): StorageLike | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

function validRole(value: unknown): value is UserRole {
  return value === 'student' || value === 'teacher';
}

function normaliseStudent(value: unknown): StudentProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<StudentProfile>;
  if (
    typeof source.name !== 'string' ||
    typeof source.id !== 'string' ||
    typeof source.major !== 'string'
  )
    return undefined;
  const style =
    source.style === 'practice' ||
    source.style === 'visual' ||
    source.style === 'discussion' ||
    source.style === 'reading'
      ? source.style
      : 'practice';
  const target =
    source.target === 'concept' ||
    source.target === 'application' ||
    source.target === 'innovation' ||
    source.target === 'collaboration'
      ? source.target
      : 'application';
  return {
    name: source.name,
    id: source.id,
    major: source.major,
    className: typeof source.className === 'string' ? source.className : undefined,
    style,
    target,
  };
}

function normaliseTeacher(value: unknown): TeacherProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<TeacherProfile>;
  if (typeof source.name !== 'string') return undefined;
  return {
    name: source.name,
    id: typeof source.id === 'string' ? source.id : undefined,
    department: typeof source.department === 'string' ? source.department : undefined,
  };
}

function normaliseDiagnosis(value: unknown): DiagnosisResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<DiagnosisResult> & { dims?: Record<string, unknown> };
  if (typeof source.score !== 'number') return undefined;
  const dimensions = {
    ...(source.dimensions ?? source.dims ?? {}),
  } as DiagnosisResult['dimensions'];
  return {
    score: source.score,
    dimensions,
    dims: dimensions,
    level: typeof source.level === 'string' ? source.level : '',
    answeredCount: typeof source.answeredCount === 'number' ? source.answeredCount : 0,
    totalQuestions: typeof source.totalQuestions === 'number' ? source.totalQuestions : 0,
  };
}

function normaliseChat(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const source = message as Partial<ChatMessage>;
    if ((source.role !== 'ai' && source.role !== 'user') || typeof source.text !== 'string')
      return [];
    return [{ role: source.role, text: source.text }];
  });
}

function normaliseLabRecord(value: unknown): LabRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<LabRecord> & Record<string, unknown>;
  const distanceM =
    typeof source.distanceM === 'number'
      ? source.distanceM
      : typeof source.distance === 'number'
        ? source.distance
        : undefined;
  const measuredDistanceM =
    typeof source.measuredDistanceM === 'number'
      ? source.measuredDistanceM
      : typeof source.measured === 'number'
        ? source.measured
        : undefined;
  const errorPercent =
    typeof source.errorPercent === 'number'
      ? source.errorPercent
      : typeof source.error === 'number'
        ? source.error
        : undefined;
  if (distanceM === undefined || measuredDistanceM === undefined || errorPercent === undefined)
    return undefined;
  const speedMps =
    typeof source.speedMps === 'number'
      ? source.speedMps
      : typeof source.speed === 'number'
        ? source.speed
        : 343;
  const reflectivity =
    typeof source.reflectivity === 'number'
      ? source.reflectivity
      : typeof source.reflect === 'number'
        ? source.reflect
        : 85;
  const noisePercent =
    typeof source.noisePercent === 'number'
      ? source.noisePercent
      : typeof source.noise === 'number'
        ? source.noise
        : 3;
  const timestamp =
    typeof source.timestamp === 'string'
      ? source.timestamp
      : typeof source.time === 'string'
        ? source.time
        : '';
  const quality =
    source.quality === '良好' || source.quality === '一般' || source.quality === '较差'
      ? source.quality
      : '一般';
  const echoTimeMs =
    typeof source.echoTimeMs === 'number' ? source.echoTimeMs : (2 * distanceM * 1000) / speedMps;
  return {
    distanceM,
    speedMps,
    reflectivity,
    noisePercent,
    echoTimeMs,
    measuredDistanceM,
    errorPercent,
    quality,
    measured: measuredDistanceM,
    error: errorPercent,
    timestamp,
    time: timestamp,
    reflect: reflectivity,
    noise: noisePercent,
    waveform: { time: [], amplitude: [], sampleRateHz: 0, totalMs: 0 },
  };
}

function normaliseLabRecords(value: unknown): LabRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record) => {
    const normalised = normaliseLabRecord(record);
    return normalised ? [normalised] : [];
  });
}

function normaliseEvaluationReviews(value: unknown): Record<string, EvaluationReview> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, EvaluationReview>>(
    (result, [name, item]) => {
      if (!item || typeof item !== 'object') return result;
      const source = item as Partial<EvaluationReview>;
      const score =
        typeof source.score === 'number' && Number.isFinite(source.score)
          ? Math.max(0, Math.min(100, source.score))
          : undefined;
      if (score === undefined || typeof source.reason !== 'string') return result;
      result[name] = {
        score,
        reason: source.reason,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
      };
      return result;
    },
    {},
  );
}

/** 校验并补齐一个项目对象；字段不全时返回 `undefined`（宁可丢掉也不要渲染半截）。 */
function normaliseProject(value: unknown): Project | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const project = value as Partial<Project>;
  if (
    typeof project.id !== 'string' ||
    typeof project.title !== 'string' ||
    typeof project.intro !== 'string' ||
    !Array.isArray(project.dims) ||
    !Array.isArray(project.styles) ||
    !Array.isArray(project.targets) ||
    typeof project.ability !== 'string'
  )
    return undefined;
  return {
    ...project,
    level:
      project.level === '基础' || project.level === '中等' || project.level === '较高'
        ? project.level
        : '基础',
  } as Project;
}

function normaliseLocalProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const project = normaliseProject(item);
    return project ? [project] : [];
  });
}

/* ══════════════════════════════════════════════════════════════════════
 * 「三诊」记录的归一化
 *
 * 这一层的立场：**审核状态宁可退回 pending，也不要凭空变成 approved**。
 * 手工改过的 localStorage、旧版本残留、跨端同步过来的半截对象都可能出现，
 * 而 `approved` 意味着「教师已经看过并认可」——伪造出这个状态，
 * 比丢掉一条记录严重得多。
 * ══════════════════════════════════════════════════════════════════════ */

export function normaliseReview(value: unknown): StageReview {
  const source = (value ?? {}) as Partial<StageReview>;
  const status: ReviewStatus =
    source.status === 'approved' || source.status === 'adjusted' ? source.status : 'pending';
  return {
    status,
    ...(typeof source.note === 'string' && source.note ? { note: source.note } : {}),
    ...(typeof source.by === 'string' && source.by ? { by: source.by } : {}),
    ...(typeof source.at === 'string' && source.at ? { at: source.at } : {}),
  };
}

export function normaliseAck(value: unknown): StudentAck | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<StudentAck>;
  if (typeof source.accepted !== 'boolean') return undefined;
  return {
    accepted: source.accepted,
    ...(typeof source.note === 'string' && source.note ? { note: source.note } : {}),
    at: typeof source.at === 'string' ? source.at : '',
  };
}

function normaliseProjectMatch(value: unknown): ProjectMatch | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<ProjectMatch>;
  const project = normaliseProject(source.project);
  if (!project) return undefined;
  return {
    project,
    score: typeof source.score === 'number' && Number.isFinite(source.score) ? source.score : 0,
    reasons: Array.isArray(source.reasons)
      ? source.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [],
  };
}

const TIERS: readonly AbilityTier[] = ['basic', 'applied', 'challenge'];

export function normalisePreClass(value: unknown): PreClassPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<PreClassPlan>;
  const tier = TIERS.includes(source.tier as AbilityTier) ? (source.tier as AbilityTier) : 'basic';
  const ack = normaliseAck(source.ack);
  const dimensionScores: Record<string, number> = {};
  if (source.dimensionScores && typeof source.dimensionScores === 'object') {
    Object.entries(source.dimensionScores as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item === 'number' && Number.isFinite(item)) dimensionScores[key] = item;
    });
  }
  return {
    tier,
    dimensionScores: dimensionScores as PreClassPlan['dimensionScores'],
    weakDimensions: Array.isArray(source.weakDimensions)
      ? source.weakDimensions.filter(
          (item): item is PreClassPlan['weakDimensions'][number] => typeof item === 'string',
        )
      : [],
    matches: Array.isArray(source.matches)
      ? source.matches.flatMap((item) => {
          const match = normaliseProjectMatch(item);
          return match ? [match] : [];
        })
      : [],
    groupId: typeof source.groupId === 'string' ? source.groupId : '',
    groupRole: typeof source.groupRole === 'string' ? source.groupRole : '',
    submittedAt: typeof source.submittedAt === 'string' ? source.submittedAt : '',
    review: normaliseReview(source.review),
    ...(ack ? { ack } : {}),
  };
}

const ERROR_KINDS: readonly InClassErrorKind[] = [
  'concept',
  'unit',
  'model',
  'incomplete',
  'correct',
];

export function normaliseInClassExchange(value: unknown): InClassExchange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<InClassExchange>;
  if (typeof source.id !== 'string' || typeof source.questionId !== 'string') return undefined;
  const errorKind = ERROR_KINDS.includes(source.errorKind as InClassErrorKind)
    ? (source.errorKind as InClassErrorKind)
    : 'incomplete';
  const ack = normaliseAck(source.ack);
  return {
    id: source.id,
    questionId: source.questionId,
    answer: typeof source.answer === 'string' ? source.answer : '',
    errorKind,
    evidence: typeof source.evidence === 'string' ? source.evidence : '',
    followUp: typeof source.followUp === 'string' ? source.followUp : '',
    reference: typeof source.reference === 'string' ? source.reference : '',
    anchor: typeof source.anchor === 'string' ? source.anchor : '',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
    review: normaliseReview(source.review),
    ...(ack ? { ack } : {}),
  };
}

export function normaliseInClass(value: unknown): InClassExchange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const exchange = normaliseInClassExchange(item);
    return exchange ? [exchange] : [];
  });
}

const FOUR_ABILITIES: readonly FourAbility[] = [
  'knowledge',
  'application',
  'innovation',
  'collaboration',
];

function normaliseAbilityRecord(value: unknown): Record<FourAbility, number> {
  const source = (value ?? {}) as Record<string, unknown>;
  const result = {} as Record<FourAbility, number>;
  for (const ability of FOUR_ABILITIES) {
    const item = source[ability];
    result[ability] =
      typeof item === 'number' && Number.isFinite(item)
        ? Math.max(0, Math.min(100, Math.round(item)))
        : 0;
  }
  return result;
}

function normaliseAbilityPoints(value: unknown): AbilityPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Partial<AbilityPoint>;
    if (typeof source.label !== 'string') return [];
    return [
      {
        label: source.label,
        at: typeof source.at === 'string' ? source.at : '',
        scores: normaliseAbilityRecord(source.scores),
      },
    ];
  });
}

export function normalisePostClass(value: unknown): PostClassRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<PostClassRecord>;
  const contributions = (source.contributions ?? {}) as Record<string, unknown>;
  const contribution = (key: string): number => {
    const item = contributions[key];
    return typeof item === 'number' && Number.isFinite(item)
      ? Math.max(0, Math.min(100, Math.round(item)))
      : 0;
  };
  const teacher = source.teacher;
  const ack = normaliseAck(source.ack);
  return {
    abilities: normaliseAbilityRecord(source.abilities),
    contributions: {
      preClass: contribution('preClass'),
      inClass: contribution('inClass'),
      task: contribution('task'),
      teamwork: contribution('teamwork'),
    },
    advice: Array.isArray(source.advice)
      ? source.advice.filter((item): item is string => typeof item === 'string')
      : [],
    trajectory: normaliseAbilityPoints(source.trajectory),
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : '',
    ...(teacher && typeof teacher === 'object' && typeof teacher.score === 'number'
      ? {
          teacher: {
            score: Math.max(0, Math.min(100, Math.round(teacher.score))),
            note: typeof teacher.note === 'string' ? teacher.note : '',
            at: typeof teacher.at === 'string' ? teacher.at : '',
          },
        }
      : {}),
    ...(ack ? { ack } : {}),
  };
}

const SHEET_STAGES: readonly SheetStageKey[] = ['prepare', 'implement', 'close'];

function normaliseScoreEntry(value: unknown): ScoreEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  // 一个阶段都没有的对象视为无效——全空录入值没有意义，丢掉比留着干净。
  if (!SHEET_STAGES.some((key) => source[key] && typeof source[key] === 'object')) {
    return undefined;
  }
  const stage = (key: SheetStageKey): StageScores => normaliseAbilityRecord(source[key]);
  return { prepare: stage('prepare'), implement: stage('implement'), close: stage('close') };
}

function normaliseScoreSheet(value: unknown): Record<string, ScoreEntry> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, ScoreEntry> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const entry = normaliseScoreEntry(item);
    if (entry) result[key] = entry;
  });
  return result;
}

/** 将本地数据限制在已知字段，避免旧版本或手工篡改数据污染页面。 */
export function normaliseState(value: unknown): AppState {
  const base = createInitialState();
  if (!value || typeof value !== 'object') return base;
  const source = value as Partial<AppState> & Record<string, unknown>;
  const role = validRole(source.role) ? source.role : base.role;
  const taskChecks: Record<string, boolean> = {};
  if (source.taskChecks && typeof source.taskChecks === 'object') {
    Object.entries(source.taskChecks as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item === 'boolean') taskChecks[key] = item;
    });
  }
  const taskTexts: Record<string, string> = {};
  if (source.taskTexts && typeof source.taskTexts === 'object') {
    Object.entries(source.taskTexts as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item === 'string') taskTexts[key] = item;
    });
  }
  const activeTask =
    typeof source.activeTask === 'number' &&
    Number.isInteger(source.activeTask) &&
    source.activeTask >= 0
      ? source.activeTask
      : 0;
  return {
    role,
    student: normaliseStudent(source.student),
    teacher: normaliseTeacher(source.teacher),
    diagnosis: normaliseDiagnosis(source.diagnosis),
    projectId:
      typeof source.projectId === 'string'
        ? source.projectId
        : source.projectId === null
          ? null
          : base.projectId,
    activeTask,
    taskChecks,
    taskTexts,
    chat: normaliseChat(source.chat),
    labRecords: normaliseLabRecords(source.labRecords),
    evaluation:
      source.evaluation && typeof source.evaluation === 'object'
        ? clone(source.evaluation as EvaluationSummary)
        : undefined,
    evaluationReviews: normaliseEvaluationReviews(source.evaluationReviews),
    localProjects: normaliseLocalProjects(source.localProjects),
    preClass: normalisePreClass(source.preClass),
    inClass: normaliseInClass(source.inClass),
    postClass: normalisePostClass(source.postClass),
    scoreSheet: normaliseScoreSheet(source.scoreSheet),
  };
}

function parseEnvelope(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const envelope = parsed as Partial<StorageEnvelope<AppState>> & { state?: AppState };
    if (typeof envelope.version === 'number') {
      if (envelope.version > STORAGE_VERSION) return undefined;
      return envelope.data ?? envelope.state;
    }
    // 兼容旧版直接保存 AppState 的格式。
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * 从 localStorage 读取版本化状态；浏览器禁用存储或 JSON 损坏时返回初始状态。
 *
 * `scope` 是账号 id：不同账号读不同的键，互不可见。
 * 演示学生会**继承**升级前那份无作用域数据（只继承一次，继承后写入自己的键）。
 */
export function loadState(
  storage: StorageLike | undefined = getDefaultStorage(),
  scope?: StorageScope,
): AppState {
  if (!storage) return createInitialState();
  try {
    const key = storageKeyForScope(scope);
    let raw = storage.getItem(key);
    if (!raw && scope === LEGACY_STORAGE_SCOPE) {
      // 升级前的数据只有一份，它属于演示身份。
      raw = storage.getItem(PHYSICS_STORAGE_KEY) ?? storage.getItem(MODERN_STORAGE_KEY);
    }
    return normaliseState(parseEnvelope(raw));
  } catch {
    return createInitialState();
  }
}

export const loadPersistedState = loadState;
export const readState = loadState;

/** 保存失败的原因。调用方据此给出不同的提示，而不是笼统一句「保存失败」。 */
export type SaveFailureReason =
  /** 环境里没有可用的 storage（服务端渲染、用户禁用存储、无痕模式）。 */
  | 'unavailable'
  /** 配额写满（localStorage 通常 5 MB）。这是最常见、也最需要用户动手的一种。 */
  | 'quota'
  /** 其他写入异常（序列化失败、storage 实现抛错）。 */
  | 'unknown';

export type SaveOutcome = { ok: true } | { ok: false; reason: SaveFailureReason };

/**
 * 判断一个异常是不是「配额写满」。
 *
 * 浏览器之间不统一：Chrome/Safari 抛 `QuotaExceededError`，
 * 老 Firefox 用 `NS_ERROR_DOM_QUOTA_REACHED`，还有的实现只给 `code` 22 / 1014。
 * 三种都要认，否则最常见的那种失败会被归到 `unknown`，提示就变成
 * 「未知错误，请联系管理员」——对「存储满了」这种用户自己能解决的事毫无帮助。
 */
function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return true;
    }
    return error.code === 22 || error.code === 1014;
  }
  const candidate = error as { name?: string; code?: number } | null;
  return (
    candidate?.name === 'QuotaExceededError' ||
    candidate?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate?.code === 22 ||
    candidate?.code === 1014
  );
}

/**
 * 保存版本化包络，并**说明失败原因**。
 *
 * 这是 `saveState` 的判别式版本。加它是因为原来只返回 `boolean`，
 * 调用方（`state-provider.tsx`）把返回值直接丢掉了：localStorage 写满时
 * 学生的闯关进度、诊断结果、实验记录全部丢失，界面上**一个字都没有**，
 * 学生会以为「已经保存了」，第二天回来一切归零。
 */
export function saveStateWithReason(
  state: AppState,
  storage: StorageLike | undefined = getDefaultStorage(),
  scope?: StorageScope,
): SaveOutcome {
  if (!storage) return { ok: false, reason: 'unavailable' };
  const envelope: StorageEnvelope<AppState> = {
    version: STORAGE_VERSION,
    data: normaliseState(state),
  };
  try {
    storage.setItem(storageKeyForScope(scope), JSON.stringify(envelope));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unknown' };
  }
}

/** 保存版本化包络，不向 storage 写入类实例或函数。 */
export function saveState(
  state: AppState,
  storage: StorageLike | undefined = getDefaultStorage(),
  scope?: StorageScope,
): boolean {
  return saveStateWithReason(state, storage, scope).ok;
}

export const persistState = saveState;
export const writeState = saveState;

/**
 * 清空学习数据。
 *
 * 带 `scope` 时**只清这个账号的**数据（别人的记录不受影响）；
 * 不带 `scope` 时清掉全部旧键（升级前的用法与测试）。
 */
export function clearState(
  storage: StorageLike | undefined = getDefaultStorage(),
  scope?: StorageScope,
): boolean {
  if (!storage) return false;
  try {
    if (scope) {
      storage.removeItem(storageKeyForScope(scope));
      return true;
    }
    storage.removeItem(PHYSICS_STORAGE_KEY);
    storage.removeItem(MODERN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export const resetState = clearState;

/** 以不可变方式应用状态补丁，页面可直接用于 React setState。 */
export function updateState(state: AppState, patch: Partial<AppState>): AppState {
  return normaliseState({ ...state, ...patch });
}

export const patchState = updateState;

/**
 * 切换项目时的作用域化重置：只清空「当前项目」的进度。
 *
 * 学情画像（role / student / teacher / diagnosis）、教师复核记录
 * （evaluationReviews）与教师自建项目（localProjects）不属于项目进度，
 * 必须原样保留，否则学生会话会清掉教师的复核成果，学情画像也会被抹掉。
 */
export function resetProjectProgress(state: AppState, projectId: string | null = null): AppState {
  return normaliseState({
    ...state,
    projectId,
    activeTask: 0,
    taskChecks: {},
    taskTexts: {},
    chat: [],
    labRecords: [],
    evaluation: undefined,
  });
}

/**
 * 重新诊断时的作用域化重置：清空诊断结果与由它算出的固化评价。
 * 项目进度、实验记录与学情画像（学生信息）都不受影响。
 *
 * `evaluation` 是基于诊断分、任务进度与实验记录算出的**派生快照**：
 * 诊断结果一旦作废，这份快照就不再成立，继续留着会让学习报告沿用
 * 旧诊断分数算出的评定，与新的诊断结果自相矛盾。
 *
 * 同一理由也适用于三诊里的两处：`preClass`（分层、配对、分组都由诊断分推出）
 * 与 `postClass`（四阶能力里知识/专业/创新三项都含诊断分权重）。诊断换了，
 * 这两份结论就不再成立。**课中问答（`inClass`）保留**——那是学生真实答过的
 * 内容，与诊断分无关。
 */
export function clearDiagnosisResult(state: AppState): AppState {
  return normaliseState({
    ...state,
    diagnosis: undefined,
    evaluation: undefined,
    preClass: undefined,
    postClass: undefined,
  });
}

/**
 * 学生侧的作用域化重置：清空学生自己的学习过程数据。
 *
 * 与切项目（`resetProjectProgress`）、重诊断（`clearDiagnosisResult`）并列的
 * 第三种作用域。**教师复核记录（evaluationReviews）与教师自建项目
 * （localProjects）不属于学生数据，必须原样保留**——否则学生在命令面板里
 * 执行一次"重置我的学习记录"，就能把教师批改到一半的复核成果清空。
 *
 * 学情画像（role / student / teacher）保留：它是身份信息，不是学习过程。
 *
 * 三诊记录（`preClass` / `inClass` / `postClass`）**一并清空**：它们全部由
 * 诊断、任务、实验与课中作答派生，上面这些源头都被清掉了，留着就是三份
 * 与当前状态对不上的旧结论——学生重新开始时看到「上一次的分层与评价」，
 * 只会以为重置没生效。
 */
export function resetStudentProgress(state: AppState): AppState {
  return normaliseState({
    ...state,
    diagnosis: undefined,
    projectId: null,
    activeTask: 0,
    taskChecks: {},
    taskTexts: {},
    chat: [],
    labRecords: [],
    evaluation: undefined,
    preClass: undefined,
    inClass: [],
    postClass: undefined,
  });
}

/** 校验内置账号，密码和用户名均不会写入持久化状态。 */
export function authenticate(
  username: string,
  password: string,
  accounts: readonly DemoAccount[] = DEMO_ACCOUNTS,
): DemoAccount | null {
  const normalizedUsername = String(username ?? '')
    .trim()
    .toLowerCase();
  if (!normalizedUsername || password !== PHYSICS_AI_PASSWORD) return null;
  return (
    accounts.find(
      (account) =>
        account.username.toLowerCase() === normalizedUsername && account.password === password,
    ) ?? null
  );
}

export const login = authenticate;
export const authenticateDemoAccount = authenticate;

export function accountForRole(
  role: UserRole,
  accounts: readonly DemoAccount[] = DEMO_ACCOUNTS,
): DemoAccount | undefined {
  return accounts.find((account) => account.role === role);
}
