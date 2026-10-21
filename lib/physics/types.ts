/**
 * 大学物理 AI 智慧教学系统的领域类型。
 *
 * 这些类型只描述数据形状，不依赖 React、浏览器或持久化实现，便于在
 * 页面、服务端渲染和单元测试之间共享。
 */

export type UserRole = "student" | "teacher";

export type LearningStyle = "practice" | "visual" | "discussion" | "reading";

export type LearningTarget =
  | "concept"
  | "application"
  | "innovation"
  | "collaboration";

/** 诊断题和项目使用的知识维度。实验是贯穿各模块的通用维度。 */
export type DiagnosticDimension =
  | "力学"
  | "波动"
  | "热学"
  | "电磁学"
  | "光学"
  | "近代物理"
  | "实验";

export type PhysicsDimension = Exclude<DiagnosticDimension, "实验">;

export type ProjectLevel = "基础" | "中等" | "较高";

export type ChapterStatus = "成熟案例" | "重点建设" | "拓展案例";

/** 诊断题的统一结构。q、opts、a、dim 是原型数据的兼容别名。 */
export interface QuizQuestion {
  id: string;
  question: string;
  options: readonly string[];
  correctIndex: number;
  dimension: DiagnosticDimension;
  q?: string;
  opts?: readonly string[];
  a?: number;
  dim?: DiagnosticDimension;
}

export interface StudentProfile {
  name: string;
  id: string;
  major: string;
  className?: string;
  style: LearningStyle;
  target: LearningTarget;
}

export interface TeacherProfile {
  name: string;
  id?: string;
  department?: string;
}

export interface DemoAccount {
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  profile: StudentProfile | TeacherProfile;
}

export interface DiagnosisResult {
  score: number;
  dimensions: Readonly<Record<DiagnosticDimension, number>>;
  /** 与原静态原型保持兼容的维度字段别名。 */
  dims: Readonly<Record<DiagnosticDimension, number>>;
  level: string;
  answeredCount: number;
  totalQuestions: number;
}

export interface Project {
  id: string;
  title: string;
  level: ProjectLevel;
  dims: readonly DiagnosticDimension[];
  styles: readonly LearningStyle[];
  targets: readonly LearningTarget[];
  intro: string;
  ability: string;
}

export interface ProjectMatch {
  project: Project;
  score: number;
  reasons: readonly string[];
}

export interface ChapterMapping {
  no: number;
  volume: "上册" | "下册";
  module: string;
  title: string;
  concepts: readonly string[];
  primary: string;
  alternatives: readonly string[];
  difficulty: ProjectLevel;
  hours: string;
  output: string;
  ability: string;
  status: ChapterStatus;
}

export interface TaskTemplate {
  id: string;
  name: string;
  ability: string;
  goal: string;
  checks: readonly string[];
  prompt: string;
}

export interface TaskProgress {
  completed: number;
  total: number;
  percentage: number;
  completedKeys: readonly string[];
}

export type SignalQuality = "良好" | "一般" | "较差";

export interface UltrasonicMeasurementInput {
  distanceM: number;
  speedMps?: number;
  reflectivity?: number;
  noisePercent?: number;
  /** 注入随机数，便于测试；默认使用 Math.random。 */
  random?: () => number;
}

export interface UltrasonicWaveform {
  /** 单位 ms 的等距采样时间轴。 */
  time: readonly number[];
  /** 与 time 等长的归一化电压序列，范围 [-1, 1] 附近。 */
  amplitude: readonly number[];
  sampleRateHz: number;
  totalMs: number;
}

export interface UltrasonicMeasurement {
  distanceM: number;
  speedMps: number;
  reflectivity: number;
  noisePercent: number;
  echoTimeMs: number;
  measuredDistanceM: number;
  errorPercent: number;
  quality: SignalQuality;
  /** 接收器上的回波时域采样，覆盖 TX 脉冲 + 往返传播 + RX 衰减。 */
  waveform: UltrasonicWaveform;
  /** 原型记录字段的兼容别名。 */
  measured?: number;
  error?: number;
}

export interface LabRecord extends UltrasonicMeasurement {
  timestamp: string;
  /** 原型表格中使用的兼容字段。 */
  time?: string;
  reflect?: number;
  noise?: number;
}

export interface EvaluationInputs {
  diagnosisScore?: number;
  taskProgress?: number;
  labRecords?: readonly Pick<LabRecord, "errorPercent" | "error">[];
  chatCount?: number;
  participation?: number;
  teamwork?: number;
  team?: number;
  design?: number;
  experiment?: number;
  presentation?: number;
  present?: number;
  reflection?: number;
  reflect?: number;
}

export interface EvaluationSummary {
  knowledge: number;
  application: number;
  innovation: number;
  collaboration: number;
  final: number;
  grade: string;
  weakestDimension: string;
  strongestDimension: string;
  generatedAt?: string;
}

/** 教师对单名学生的评价复核记录。 */
export interface EvaluationReview {
  score: number;
  reason: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "ai" | "user";
  text: string;
}

export interface AppState {
  role: UserRole;
  student?: StudentProfile;
  teacher?: TeacherProfile;
  diagnosis?: DiagnosisResult;
  projectId?: string | null;
  activeTask: number;
  taskChecks: Record<string, boolean>;
  taskTexts: Record<string, string>;
  chat: ChatMessage[];
  labRecords: LabRecord[];
  evaluation?: EvaluationSummary;
  evaluationReviews: Record<string, EvaluationReview>;
  localProjects: Project[];
}

export interface StorageEnvelope<T> {
  version: number;
  data: T;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ExportRow = Record<string, unknown>;

export interface KnowledgeNode {
  id: string;
  title: string;
  description: string;
  recommendations: string;
}

export interface DemoStudentSnapshot {
  name: string;
  score: number;
  weakDimension: DiagnosticDimension;
  project: string;
  progress: number;
  risk: "正常" | "关注" | "高风险" | "优秀";
}

export interface TeachingPlan {
  id: string;
  title: string;
  content: string;
}
