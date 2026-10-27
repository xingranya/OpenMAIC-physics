/**
 * 大学物理 AI 智慧课堂的领域类型。
 *
 * 这些类型只描述数据形状，不依赖 React、浏览器或持久化实现，便于在
 * 页面、服务端渲染和单元测试之间共享。
 */

export type UserRole = 'student' | 'teacher';

export type LearningStyle = 'practice' | 'visual' | 'discussion' | 'reading';

export type LearningTarget = 'concept' | 'application' | 'innovation' | 'collaboration';

/** 诊断题和项目使用的知识维度。实验是贯穿各模块的通用维度。 */
export type DiagnosticDimension =
  | '力学'
  | '波动'
  | '热学'
  | '电磁学'
  | '光学'
  | '近代物理'
  | '实验';

export type PhysicsDimension = Exclude<DiagnosticDimension, '实验'>;

export type ProjectLevel = '基础' | '中等' | '较高';

export type ChapterStatus = '成熟案例' | '重点建设' | '拓展案例';

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
  volume: '上册' | '下册';
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

export type SignalQuality = '良好' | '一般' | '较差';

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
  labRecords?: readonly Pick<LabRecord, 'errorPercent' | 'error'>[];
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
  role: 'ai' | 'user';
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
  /** 课前：诊断 → 分层 → 梯度配对 → 分组，提交教师审核。 */
  preClass?: PreClassPlan;
  /** 课中：每一轮「作答 → AI 追问」都留档，供教师审核与课后评价引用。 */
  inClass: InClassExchange[];
  /** 课后：过程性评价档案（含四阶能力轨迹）。 */
  postClass?: PostClassRecord;
  /**
   * 成绩登记总表的教师录入值，按学生 id 归档。
   *
   * 没有录入的学生走 `seedEntry` 的示例值——一张全 0 的表既看不出公式对不对，
   * 也没法演示导出。教师改过的值存在这里，刷新后仍在。
   */
  scoreSheet: Record<string, ScoreEntry>;
  /**
   * 作品版本记录（创新能力·创 的证据）。
   *
   * 与 `taskTexts` 分开存：笔记是「想了什么」，版本是「交了哪一版」，
   * 教师复核创新能力时要看的是后者。
   */
  versions: ArtifactVersion[];
  /** 组内互评（团队合作·评 的证据）。 */
  peerReviews: PeerReview[];
}

/* ══════════════════════════════════════════════════════════════════════
 * 成绩登记总表
 *
 * 三个阶段的权重是 30% / 50% / 30%（和教学工作手册那张纸质表一致），
 * 三者之和是 110%，所以总分要按「加权后除以权重之和」归一化，
 * 详见 `score-sheet.ts` 的 `totalScore`。
 * ══════════════════════════════════════════════════════════════════════ */

/** 项目三阶段。 */
export type SheetStageKey = 'prepare' | 'implement' | 'close';

/** 一个阶段内四项能力的得分。 */
export type StageScores = Readonly<Record<FourAbility, number>>;

/** 一名学生在三个阶段的录入值。 */
export type ScoreEntry = Readonly<Record<SheetStageKey, StageScores>>;

/* ══════════════════════════════════════════════════════════════════════
 * 证据链：作品版本 + 组内互评
 *
 * 量化评价表的「评价证据与采集时点」一列点名了四类证据：分工表、任务日志、
 * 作品版本、匿名互评。前两类原本就有（`preClass.groupRole`、`taskChecks`），
 * 后两类没有载体——于是「贡献证据可追溯率」这一项核验指标根本无从计算。
 * 下面两个结构就是给那两类证据补的载体。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 一次作品版本。
 *
 * 创新能力要看的不是「最终交了什么」，而是**改了几轮、每轮改了什么**。
 * 只留最新版，教师复核时无法判断迭代是否真实发生。
 */
export interface ArtifactVersion {
  id: string;
  /** 版本标签，如「v1 · 方案初稿」。 */
  label: string;
  /** 这一版改了什么（一句话）。 */
  note: string;
  at: string;
}

/**
 * 一条组内互评。
 *
 * 互评对**同组同学**匿名，对**教师**实名——这两件事必须分开：
 * 学生之间看得到名字，评价就会变成人情分；教师看不到名字，
 * 就无法在复核时追问「这条为什么给这么低」。
 */
export interface PeerReview {
  id: string;
  /** 被评同学的 id。 */
  targetId: string;
  targetName: string;
  /** 贡献度 0–100。 */
  contribution: number;
  /** 协作表现 0–100。 */
  cooperation: number;
  /** 一句话依据（必填：没有依据的互评在复核时没有价值）。 */
  note: string;
  at: string;
}

/**
 * 提交时一并写进共享键的证据快照。
 *
 * 教师端读不到学生的分区数据，四项核验指标又都需要「这个学生有没有
 * 留下证据」，所以把计数随提交一起送过去。只送计数，不送明细：
 * 明细留在学生自己的键里，教师需要时再按提交内容追问。
 */
export interface SubmissionEvidence {
  /** 学生最终采用的项目 id（算「任务匹配适切率」用）。 */
  adoptedProjectId?: string;
  taskCompleted: number;
  taskTotal: number;
  /** 作品版本条数。 */
  versionCount: number;
  /** 组内互评条数（本人发出的）。 */
  peerReviewCount: number;
  /** 是否已有组内分工（`preClass.groupRole` 非空）。 */
  hasRole: boolean;
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
  risk: '正常' | '关注' | '高风险' | '优秀';
}

export interface TeachingPlan {
  id: string;
  title: string;
  content: string;
}

/* ══════════════════════════════════════════════════════════════════════
 * 「三诊」：课前诊断 → 课中伴随 → 课后评价
 *
 * 对应课题申请书里的「一核三诊五环」：AI 在课前、课中、课后三个关键环节
 * 做诊断和记录，每个环节都必须走「AI 建议 → 教师审核 → 学生认可」，
 * 所以下面每一类记录都带一个 `review` 字段。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 学情分层：基础巩固型 / 应用提升型 / 创新挑战型。
 *
 * 申请书里这三个层次对应梯度案例库的三个层级（基础 / 发展 / 挑战），
 * 分层的目的是**配对**，不是给学生贴标签——所以界面上始终同时显示
 * 「当前层级」与「下一层需要补什么」。
 */
export type AbilityTier = 'basic' | 'applied' | 'challenge';

/** 四阶能力：知识、专业（迁移应用）、创新、团队合作。 */
export type FourAbility = 'knowledge' | 'application' | 'innovation' | 'collaboration';

/** 审核状态。`adjusted` 表示教师改过 AI 的建议（而不是简单通过）。 */
export type ReviewStatus = 'pending' | 'approved' | 'adjusted';

export interface StageReview {
  status: ReviewStatus;
  /** 教师给出的说明/修正理由。 */
  note?: string;
  /** 审核人展示名。 */
  by?: string;
  at?: string;
}

/**
 * 学生对一条 AI/教师结论的认可。
 *
 * 申请书把每个环节都写成「AI 建议 → 教师审核 → 学生认可」三步。前两步
 * 只是把结论送到学生面前；**没有认可这一步，评价仍然是单向的**——
 * 学生既不认账，也不知道下一步补什么，过程性评价就退化成了通知。
 *
 * 所以这里单独记「认可 / 有疑问」与理由，而不是塞进 `StageReview`：
 * 审核人是教师，认可是学生，两者可能同时存在且互相矛盾
 * （教师通过、学生仍有疑问），合成一个字段就分不清了。
 */
export interface StudentAck {
  /** true = 认可，false = 有疑问（需要教师再看一眼）。 */
  accepted: boolean;
  /** 学生的说明。有疑问时应当填。 */
  note?: string;
  at: string;
}

/** 课前：诊断结论 + 梯度配对 + 分组分工。 */
export interface PreClassPlan {
  tier: AbilityTier;
  dimensionScores: Readonly<Record<DiagnosticDimension, number>>;
  weakDimensions: readonly DiagnosticDimension[];
  /** 梯度案例库配对结果（前 3 个）。 */
  matches: readonly ProjectMatch[];
  /** 小组编号，如「B 组」。 */
  groupId: string;
  /** 组内分工，如「建模与推导」。 */
  groupRole: string;
  submittedAt: string;
  review: StageReview;
  /** 学生对分层、配对与分工的认可。 */
  ack?: StudentAck;
}

/**
 * 课中 AI 对一次作答的判定类型。
 *
 * 刻意不用「对/错」二分：课中追问的价值在于**指出错在哪一类**，
 * 学生才知道下一步补什么。
 */
export type InClassErrorKind =
  /** 概念性错误：把结论记反了、张冠李戴。 */
  | 'concept'
  /** 单位/数量级错误：算得出式子但量纲或换算错。 */
  | 'unit'
  /** 建模错误：物理模型选错（如该用能量却用牛顿第二定律）。 */
  | 'model'
  /** 答得太浅，看不出思路。 */
  | 'incomplete'
  /** 没有发现明显错误。 */
  | 'correct';

/** 课中的一轮问答：学生作答 + AI 的错误识别/追问/参考答案。 */
export interface InClassExchange {
  id: string;
  questionId: string;
  answer: string;
  errorKind: InClassErrorKind;
  /** AI 判断依据（引用学生原话中的片段）。 */
  evidence: string;
  /** 生成的追问。 */
  followUp: string;
  /** 参考答案（教师采纳后才对学生「解锁」展示）。 */
  reference: string;
  /** 知识锚点：对应章节与概念。 */
  anchor: string;
  createdAt: string;
  review: StageReview;
  /** 学生对这次追问/参考答案的认可。 */
  ack?: StudentAck;
}

/** 四阶能力在某个时间点上的取值，用于画梯度轨迹。 */
export interface AbilityPoint {
  /** 横轴标签，如「第 1 次评价」。 */
  label: string;
  at: string;
  scores: Readonly<Record<FourAbility, number>>;
}

/** 课后：过程性评价档案。 */export interface PostClassRecord {
  /** 四阶能力当前值（0–100）。 */
  abilities: Readonly<Record<FourAbility, number>>;
  /**
   * 四个来源的原始贡献值（0–100）。
   *
   * 单独存下来是为了让评价**可追溯**：教师复核时要能看到综合分是
   * 由哪几项算出来的，而不是只看到一个数字。
   */
  contributions: {
    preClass: number;
    inClass: number;
    task: number;
    teamwork: number;
  };
  /** 个性化改进意见（按最弱维度生成，最多 3 条）。 */
  advice: readonly string[];
  /** 历次评价的时间序列，用于画梯度轨迹。 */
  trajectory: readonly AbilityPoint[];
  generatedAt: string;
  /** 教师修正。有值时学生端显示「教师修正后」。 */
  teacher?: { score: number; note: string; at: string };
  /** 学生对这份过程性评价的认可。 */
  ack?: StudentAck;
}
