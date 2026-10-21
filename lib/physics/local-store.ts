import { DEMO_ACCOUNTS, PHYSICS_AI_PASSWORD } from "./data";
import type {
  AppState,
  ChatMessage,
  DemoAccount,
  DiagnosisResult,
  EvaluationSummary,
  EvaluationReview,
  LabRecord,
  Project,
  StorageEnvelope,
  StorageLike,
  StudentProfile,
  TeacherProfile,
  UserRole,
} from "./types";

export type { StorageLike } from "./types";

/** 持久化版本。修改 AppState 结构时请递增并添加迁移逻辑。 */
export const STORAGE_VERSION = 1;
export const PERSISTENCE_VERSION = STORAGE_VERSION;
/** 继续使用原型键，升级后的包络格式不会丢失已有学习数据。 */
export const PHYSICS_STORAGE_KEY = "physicsAISystem";
export const STORAGE_KEY = PHYSICS_STORAGE_KEY;
export const LEGACY_STORAGE_KEY = PHYSICS_STORAGE_KEY;

const MODERN_STORAGE_KEY = "physics-ai-teaching-system";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 创建相互独立的初始状态，避免测试或多个标签页共享数组引用。 */
export function createInitialState(): AppState {
  return {
    role: "student",
    projectId: null,
    activeTask: 0,
    taskChecks: {},
    taskTexts: {},
    chat: [],
    labRecords: [],
    evaluationReviews: {},
    localProjects: [],
  };
}

export const DEFAULT_APP_STATE = createInitialState();

function getDefaultStorage(): StorageLike | undefined {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  return window.localStorage;
}

function validRole(value: unknown): value is UserRole {
  return value === "student" || value === "teacher";
}

function normaliseStudent(value: unknown): StudentProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<StudentProfile>;
  if (typeof source.name !== "string" || typeof source.id !== "string" || typeof source.major !== "string") return undefined;
  const style = source.style === "practice" || source.style === "visual" || source.style === "discussion" || source.style === "reading"
    ? source.style
    : "practice";
  const target = source.target === "concept" || source.target === "application" || source.target === "innovation" || source.target === "collaboration"
    ? source.target
    : "application";
  return {
    name: source.name,
    id: source.id,
    major: source.major,
    className: typeof source.className === "string" ? source.className : undefined,
    style,
    target,
  };
}

function normaliseTeacher(value: unknown): TeacherProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<TeacherProfile>;
  if (typeof source.name !== "string") return undefined;
  return {
    name: source.name,
    id: typeof source.id === "string" ? source.id : undefined,
    department: typeof source.department === "string" ? source.department : undefined,
  };
}

function normaliseDiagnosis(value: unknown): DiagnosisResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<DiagnosisResult> & { dims?: Record<string, unknown> };
  if (typeof source.score !== "number") return undefined;
  const dimensions = { ...(source.dimensions ?? source.dims ?? {}) } as DiagnosisResult["dimensions"];
  return {
    score: source.score,
    dimensions,
    dims: dimensions,
    level: typeof source.level === "string" ? source.level : "",
    answeredCount: typeof source.answeredCount === "number" ? source.answeredCount : 0,
    totalQuestions: typeof source.totalQuestions === "number" ? source.totalQuestions : 0,
  };
}

function normaliseChat(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const source = message as Partial<ChatMessage>;
    if ((source.role !== "ai" && source.role !== "user") || typeof source.text !== "string") return [];
    return [{ role: source.role, text: source.text }];
  });
}

function normaliseLabRecord(value: unknown): LabRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<LabRecord> & Record<string, unknown>;
  const distanceM = typeof source.distanceM === "number" ? source.distanceM : typeof source.distance === "number" ? source.distance : undefined;
  const measuredDistanceM = typeof source.measuredDistanceM === "number" ? source.measuredDistanceM : typeof source.measured === "number" ? source.measured : undefined;
  const errorPercent = typeof source.errorPercent === "number" ? source.errorPercent : typeof source.error === "number" ? source.error : undefined;
  if (distanceM === undefined || measuredDistanceM === undefined || errorPercent === undefined) return undefined;
  const speedMps = typeof source.speedMps === "number" ? source.speedMps : typeof source.speed === "number" ? source.speed : 343;
  const reflectivity = typeof source.reflectivity === "number" ? source.reflectivity : typeof source.reflect === "number" ? source.reflect : 85;
  const noisePercent = typeof source.noisePercent === "number" ? source.noisePercent : typeof source.noise === "number" ? source.noise : 3;
  const timestamp = typeof source.timestamp === "string" ? source.timestamp : typeof source.time === "string" ? source.time : "";
  const quality = source.quality === "良好" || source.quality === "一般" || source.quality === "较差" ? source.quality : "一般";
  const echoTimeMs = typeof source.echoTimeMs === "number" ? source.echoTimeMs : (2 * distanceM * 1000) / speedMps;
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
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, EvaluationReview>>((result, [name, item]) => {
    if (!item || typeof item !== "object") return result;
    const source = item as Partial<EvaluationReview>;
    const score = typeof source.score === "number" && Number.isFinite(source.score) ? Math.max(0, Math.min(100, source.score)) : undefined;
    if (score === undefined || typeof source.reason !== "string") return result;
    result[name] = { score, reason: source.reason, updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "" };
    return result;
  }, {});
}

function normaliseLocalProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Project => {
    if (!item || typeof item !== "object") return false;
    const project = item as Partial<Project>;
    return typeof project.id === "string" && typeof project.title === "string" && typeof project.intro === "string" && Array.isArray(project.dims) && Array.isArray(project.styles) && Array.isArray(project.targets) && typeof project.ability === "string";
  }).map((project) => ({ ...project, level: project.level === "基础" || project.level === "中等" || project.level === "较高" ? project.level : "基础" } as Project));
}

/** 将本地数据限制在已知字段，避免旧版本或手工篡改数据污染页面。 */
export function normaliseState(value: unknown): AppState {
  const base = createInitialState();
  if (!value || typeof value !== "object") return base;
  const source = value as Partial<AppState> & Record<string, unknown>;
  const role = validRole(source.role) ? source.role : base.role;
  const taskChecks: Record<string, boolean> = {};
  if (source.taskChecks && typeof source.taskChecks === "object") {
    Object.entries(source.taskChecks as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item === "boolean") taskChecks[key] = item;
    });
  }
  const taskTexts: Record<string, string> = {};
  if (source.taskTexts && typeof source.taskTexts === "object") {
    Object.entries(source.taskTexts as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item === "string") taskTexts[key] = item;
    });
  }
  const activeTask = typeof source.activeTask === "number" && Number.isInteger(source.activeTask) && source.activeTask >= 0
    ? source.activeTask
    : 0;
  return {
    role,
    student: normaliseStudent(source.student),
    teacher: normaliseTeacher(source.teacher),
    diagnosis: normaliseDiagnosis(source.diagnosis),
    projectId: typeof source.projectId === "string" ? source.projectId : source.projectId === null ? null : base.projectId,
    activeTask,
    taskChecks,
    taskTexts,
    chat: normaliseChat(source.chat),
    labRecords: normaliseLabRecords(source.labRecords),
    evaluation: source.evaluation && typeof source.evaluation === "object" ? clone(source.evaluation as EvaluationSummary) : undefined,
    evaluationReviews: normaliseEvaluationReviews(source.evaluationReviews),
    localProjects: normaliseLocalProjects(source.localProjects),
  };
}

function parseEnvelope(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const envelope = parsed as Partial<StorageEnvelope<AppState>> & { state?: AppState };
    if (typeof envelope.version === "number") {
      if (envelope.version > STORAGE_VERSION) return undefined;
      return envelope.data ?? envelope.state;
    }
    // 兼容旧版直接保存 AppState 的格式。
    return parsed;
  } catch {
    return undefined;
  }
}

/** 从 localStorage 读取版本化状态；浏览器禁用存储或 JSON 损坏时返回初始状态。 */
export function loadState(storage: StorageLike | undefined = getDefaultStorage()): AppState {
  if (!storage) return createInitialState();
  try {
    const raw = storage.getItem(PHYSICS_STORAGE_KEY) ?? storage.getItem(MODERN_STORAGE_KEY);
    return normaliseState(parseEnvelope(raw));
  } catch {
    return createInitialState();
  }
}

export const loadPersistedState = loadState;
export const readState = loadState;

/** 保存版本化包络，不向 storage 写入类实例或函数。 */
export function saveState(state: AppState, storage: StorageLike | undefined = getDefaultStorage()): boolean {
  if (!storage) return false;
  const envelope: StorageEnvelope<AppState> = { version: STORAGE_VERSION, data: normaliseState(state) };
  try {
    storage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export const persistState = saveState;
export const writeState = saveState;

/** 清空学习数据，同时移除旧键，返回是否完成了至少一次删除。 */
export function clearState(storage: StorageLike | undefined = getDefaultStorage()): boolean {
  if (!storage) return false;
  try {
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

/** 校验内置账号，密码和用户名均不会写入持久化状态。 */
export function authenticate(
  username: string,
  password: string,
  accounts: readonly DemoAccount[] = DEMO_ACCOUNTS,
): DemoAccount | null {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  if (!normalizedUsername || password !== PHYSICS_AI_PASSWORD) return null;
  return accounts.find((account) => account.username.toLowerCase() === normalizedUsername && account.password === password) ?? null;
}

export const login = authenticate;
export const authenticateDemoAccount = authenticate;

export function accountForRole(role: UserRole, accounts: readonly DemoAccount[] = DEMO_ACCOUNTS): DemoAccount | undefined {
  return accounts.find((account) => account.role === role);
}
