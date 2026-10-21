import { CHAPTER_MAPPINGS, DIAGNOSTIC_DIMENSIONS, PROJECTS, QUIZ_QUESTIONS, TASK_TEMPLATES, getProjectById } from "./data";
import type {
  ChapterMapping,
  DiagnosticDimension,
  DiagnosisResult,
  EvaluationInputs,
  EvaluationSummary,
  ExportRow,
  LabRecord,
  Project,
  ProjectMatch,
  QuizQuestion,
  SignalQuality,
  StudentProfile,
  TaskProgress,
  TaskTemplate,
  UltrasonicMeasurement,
  UltrasonicMeasurementInput,
  UltrasonicWaveform,
} from "./types";

export const DEFAULT_SOUND_SPEED_MPS = 343;
/** 超声波测距默认载波频率，单位 Hz，对应常见 40 kHz 超声波探头。 */
export const DEFAULT_ULTRASONIC_CARRIER_HZ = 40_000;
/** 波形仿真的默认采样率，单位 Hz。100 kHz 对 40 kHz 载波满足奈奎斯特。 */
export const DEFAULT_ULTRASONIC_SAMPLE_RATE_HZ = 100_000;

const EMPTY_DIMENSIONS: Record<DiagnosticDimension, number> = {
  力学: 0,
  波动: 0,
  热学: 0,
  电磁学: 0,
  光学: 0,
  近代物理: 0,
  实验: 0,
};

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number): number {
  return Math.round(value);
}

function questionCorrectIndex(question: QuizQuestion): number {
  return question.correctIndex ?? question.a ?? -1;
}

function questionDimension(question: QuizQuestion): DiagnosticDimension {
  return question.dimension ?? question.dim ?? "实验";
}

type AnswerValue = number | null | undefined;
type DiagnosisAnswers =
  | readonly AnswerValue[]
  | Readonly<Record<string, AnswerValue>>
  | Readonly<Record<number, AnswerValue>>;

function answerAt(answers: DiagnosisAnswers, question: QuizQuestion, index: number): AnswerValue {
  if (Array.isArray(answers)) return answers[index];
  const indexedAnswers = answers as Readonly<Record<string, AnswerValue>>;
  const byId = indexedAnswers[question.id];
  if (byId !== undefined) return byId;
  return indexedAnswers[String(index)];
}

/**
 * 按答题结果生成可解释的诊断分数和各知识维度得分。
 * 未作答或超出选项范围的题目会被视为错误，但不会让诊断流程抛异常。
 */
export function scoreDiagnosis(
  answers: DiagnosisAnswers,
  questions: readonly QuizQuestion[] = QUIZ_QUESTIONS,
): DiagnosisResult {
  const dimensions: Record<DiagnosticDimension, number> = { ...EMPTY_DIMENSIONS };
  const totals: Record<DiagnosticDimension, number> = { ...EMPTY_DIMENSIONS };
  let correct = 0;
  let answeredCount = 0;

  questions.forEach((question, index) => {
    const dimension = questionDimension(question);
    totals[dimension] += 1;
    const answer = answerAt(answers, question, index);
    if (typeof answer === "number" && Number.isInteger(answer)) {
      answeredCount += 1;
      if (answer === questionCorrectIndex(question)) {
        correct += 1;
        dimensions[dimension] += 1;
      }
    }
  });

  const totalQuestions = questions.length;
  const score = totalQuestions === 0 ? 0 : rounded((correct / totalQuestions) * 100);
  DIAGNOSTIC_DIMENSIONS.forEach((dimension) => {
    const total = totals[dimension];
    dimensions[dimension] = total === 0 ? 0 : rounded((dimensions[dimension] / total) * 100);
  });

  const readonlyDimensions = dimensions;
  return {
    score,
    dimensions: readonlyDimensions,
    dims: readonlyDimensions,
    level: diagnosisLevel(score),
    answeredCount,
    totalQuestions,
  };
}

export const calculateDiagnosis = scoreDiagnosis;
export const calculateDiagnosisScore = scoreDiagnosis;
export const diagnoseStudent = scoreDiagnosis;

/** 将诊断总分转换为界面使用的中文等级。 */
export function diagnosisLevel(score: number): string {
  const value = clamp(score);
  if (value >= 85) return "基础扎实";
  if (value >= 70) return "基础良好";
  if (value >= 60) return "基本达标";
  return "需要补强";
}

export const getDiagnosisLevel = diagnosisLevel;

function isDiagnosis(value: unknown): value is DiagnosisResult {
  return Boolean(value && typeof value === "object" && "score" in value && ("dimensions" in value || "dims" in value));
}

function isStudentProfile(value: unknown): value is StudentProfile {
  return Boolean(value && typeof value === "object" && "style" in value && "target" in value);
}

function levelBonus(level: Project["level"]): number {
  return level === "基础" ? 0 : level === "中等" ? 4 : 8;
}

/** 计算单个项目的匹配分，公式与原型中的薄弱维度、偏好和目标权重一致。 */
export function calculateProjectMatchScore(
  project: Project,
  diagnosis?: DiagnosisResult,
  student?: StudentProfile,
): number {
  if (!diagnosis || !student) return 48 + levelBonus(project.level);
  const dimensions = diagnosis.dimensions ?? diagnosis.dims;
  const weakDimensions = Object.entries(dimensions)
    .filter((entry): entry is [DiagnosticDimension, number] => entry[1] !== undefined)
    .sort((left, right) => left[1] - right[1])
    .slice(0, 2)
    .map(([dimension]) => dimension);

  let score = 48;
  project.dims.forEach((dimension) => {
    if (weakDimensions.includes(dimension)) score += 14;
  });
  if (project.styles.includes(student.style)) score += 14;
  if (project.targets.includes(student.target)) score += 14;
  if (diagnosis.score < 60 && project.level === "基础") score += 12;
  if (diagnosis.score >= 80 && project.level === "较高") score += 8;
  return Math.min(98, score);
}

export const fitProject = calculateProjectMatchScore;
export const projectMatchScore = calculateProjectMatchScore;

function parseMatchArguments(
  first?: DiagnosisResult | StudentProfile | { diagnosis?: DiagnosisResult; student?: StudentProfile; profile?: StudentProfile },
  second?: StudentProfile | DiagnosisResult | readonly Project[],
  third?: readonly Project[],
): { diagnosis?: DiagnosisResult; student?: StudentProfile; projects: readonly Project[] } {
  let diagnosis: DiagnosisResult | undefined;
  let student: StudentProfile | undefined;
  let projects = third ?? PROJECTS;

  if (Array.isArray(second)) {
    projects = second;
  } else if (isDiagnosis(second)) {
    diagnosis = second;
  } else if (isStudentProfile(second)) {
    student = second;
  }

  if (isDiagnosis(first)) diagnosis = first;
  else if (isStudentProfile(first)) student = first;
  else if (first && typeof first === "object") {
    diagnosis = first.diagnosis;
    student = first.student ?? first.profile;
  }

  return { diagnosis, student, projects };
}

/**
 * 根据学情画像返回由高到低排列的项目匹配结果。
 * 支持 `matchProjects(diagnosis, student)`、`matchProjects(student, diagnosis)`
 * 和 `matchProjects({ diagnosis, student })` 三种调用方式，方便页面迁移。
 */
export function matchProjects(
  first?: DiagnosisResult | StudentProfile | { diagnosis?: DiagnosisResult; student?: StudentProfile; profile?: StudentProfile },
  second?: StudentProfile | DiagnosisResult | readonly Project[],
  third?: readonly Project[],
): readonly ProjectMatch[] {
  const { diagnosis, student, projects } = parseMatchArguments(first, second, third);
  return projects
    .map((project) => {
      const score = calculateProjectMatchScore(project, diagnosis, student);
      const reasons: string[] = [];
      if (diagnosis && student) {
        const weak = Object.entries(diagnosis.dimensions ?? diagnosis.dims)
          .sort((left, right) => left[1] - right[1])
          .slice(0, 2)
          .map(([dimension]) => dimension);
        if (project.dims.some((dimension) => weak.includes(dimension))) reasons.push("覆盖当前薄弱知识维度");
        if (project.styles.includes(student.style)) reasons.push("符合学习方式偏好");
        if (project.targets.includes(student.target)) reasons.push("贴合能力目标");
        if (diagnosis.score < 60 && project.level === "基础") reasons.push("适合先补强基础");
        if (diagnosis.score >= 80 && project.level === "较高") reasons.push("适合挑战进阶任务");
      } else {
        reasons.push("等待完成学情诊断后生成个性化匹配");
      }
      return { project, score, reasons };
    })
    .sort((left, right) => right.score - left.score || left.project.id.localeCompare(right.project.id));
}

export const rankProjects = matchProjects;
export const getProjectMatches = matchProjects;

/** 计算章节与学生画像的匹配分，用于章节项目矩阵排序。 */
export function calculateChapterMatchScore(
  chapter: ChapterMapping,
  diagnosis?: DiagnosisResult,
  student?: StudentProfile,
): number {
  let score = 82;
  if (diagnosis) {
    const dimensionByModule: Record<string, DiagnosticDimension> = {
      力学: "力学",
      "振动与波": "波动",
      热学: "实验",
      电磁学: "电磁学",
      光学: "光学",
      近代物理: "实验",
    };
    const dimension = dimensionByModule[chapter.module];
    const value = dimension ? (diagnosis.dimensions ?? diagnosis.dims)[dimension] : undefined;
    if (typeof value === "number") score += rounded((100 - value) * 0.12);
    const project = getProjectById(chapter.primary);
    if (project && student?.style && project.styles.includes(student.style)) score += 5;
    if (project && student?.target && project.targets.includes(student.target)) score += 5;
  }
  return Math.min(98, score);
}

export const chapterPersonalScore = calculateChapterMatchScore;

type CompletedChecks =
  | Readonly<Record<string, boolean>>
  | Readonly<Record<number, boolean>>
  | ReadonlySet<string>
  | readonly string[]
  | readonly boolean[];

function isCompleted(checks: CompletedChecks, key: string, flatIndex: number): boolean {
  if (checks instanceof Set) return checks.has(key);
  if (Array.isArray(checks)) {
    if (checks.every((item) => typeof item === "boolean")) return checks[flatIndex] === true;
    return checks.includes(key);
  }
  const indexedChecks = checks as Readonly<Record<string | number, boolean>>;
  return indexedChecks[key] === true || indexedChecks[flatIndex] === true;
}

/** 汇总五阶任务的完成数量和百分比。 */
export function calculateTaskProgress(
  completedChecks: CompletedChecks,
  templates: readonly TaskTemplate[] = TASK_TEMPLATES,
): TaskProgress {
  let total = 0;
  let completed = 0;
  const completedKeys: string[] = [];
  let flatIndex = 0;

  templates.forEach((template, taskIndex) => {
    template.checks.forEach((_, checkIndex) => {
      const key = `${taskIndex}-${checkIndex}`;
      total += 1;
      if (isCompleted(completedChecks, key, flatIndex)) {
        completed += 1;
        completedKeys.push(key);
      }
      flatIndex += 1;
    });
  });

  return {
    completed,
    total,
    percentage: total === 0 ? 0 : rounded((completed / total) * 100),
    completedKeys,
  };
}

export function taskProgressPercentage(
  completedChecks: CompletedChecks,
  templates: readonly TaskTemplate[] = TASK_TEMPLATES,
): number {
  return calculateTaskProgress(completedChecks, templates).percentage;
}

export const getTaskProgress = calculateTaskProgress;
export const getTaskProgressPercentage = taskProgressPercentage;
export const taskProgress = taskProgressPercentage;

/** 根据超声波回波时间计算目标距离，时间单位为毫秒。 */
export function calculateUltrasonicDistance(
  echoTimeMsOrInput: number | { echoTimeMs: number; speedMps?: number },
  speedMps = DEFAULT_SOUND_SPEED_MPS,
): number {
  const echoTimeMs = typeof echoTimeMsOrInput === "number" ? echoTimeMsOrInput : echoTimeMsOrInput.echoTimeMs;
  const actualSpeed = typeof echoTimeMsOrInput === "number" ? speedMps : echoTimeMsOrInput.speedMps ?? speedMps;
  if (!Number.isFinite(echoTimeMs) || echoTimeMs < 0) throw new RangeError("回波时间必须是非负有限数");
  if (!Number.isFinite(actualSpeed) || actualSpeed <= 0) throw new RangeError("声速必须是正数");
  return (actualSpeed * echoTimeMs) / 2000;
}

export const ultrasonicDistance = calculateUltrasonicDistance;
export const calculateDistanceFromEcho = calculateUltrasonicDistance;

/** 根据目标距离计算往返回波时间，返回毫秒。 */
export function calculateUltrasonicEchoTime(distanceM: number, speedMps = DEFAULT_SOUND_SPEED_MPS): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new RangeError("距离必须是非负有限数");
  if (!Number.isFinite(speedMps) || speedMps <= 0) throw new RangeError("声速必须是正数");
  return (2 * distanceM * 1000) / speedMps;
}

export const calculateEchoTime = calculateUltrasonicEchoTime;

export function signalQuality(reflectivity: number, noisePercent: number): SignalQuality {
  const reflect = clamp(reflectivity);
  const noise = clamp(noisePercent);
  if (reflect >= 70 && noise <= 5) return "良好";
  if (reflect >= 45 && noise <= 10) return "一般";
  return "较差";
}

export const getSignalQuality = signalQuality;

/** 生成一次可重复注入随机源的超声测距记录。 */
export function simulateUltrasonicWaveform(input: UltrasonicMeasurementInput & { carrierHz?: number; sampleRateHz?: number }): UltrasonicWaveform {
  if (!Number.isFinite(input.distanceM) || input.distanceM < 0) throw new RangeError("距离必须是非负有限数");
  const speedMps = input.speedMps ?? DEFAULT_SOUND_SPEED_MPS;
  if (!Number.isFinite(speedMps) || speedMps <= 0) throw new RangeError("声速必须是正数");
  const reflectivity = clamp(input.reflectivity ?? 85);
  const noisePercent = clamp(input.noisePercent ?? 3);
  const carrierHz = input.carrierHz ?? DEFAULT_ULTRASONIC_CARRIER_HZ;
  const sampleRateHz = input.sampleRateHz ?? DEFAULT_ULTRASONIC_SAMPLE_RATE_HZ;
  const echoTimeMs = calculateUltrasonicEchoTime(input.distanceM, speedMps);

  const totalMs = Math.max(8, echoTimeMs + 4);
  const totalSamples = Math.max(64, Math.ceil((totalMs / 1000) * sampleRateHz));
  const dt = 1000 / sampleRateHz;

  const txCenterMs = 0.10;
  const txSigmaMs = 0.06;
  const rxSigmaMs = 0.06;
  const baseAmp = 0.85;
  const rxAmp = baseAmp * (reflectivity / 100);
  const noiseAmp = (noisePercent / 100) * 0.45;

  const time: number[] = new Array(totalSamples);
  const amplitude: number[] = new Array(totalSamples);
  const random = input.random ?? Math.random;
  for (let i = 0; i < totalSamples; i++) {
    const ti = i * dt;
    const envTx = Math.exp(-Math.pow((ti - txCenterMs) / txSigmaMs, 2));
    const envRx = Math.exp(-Math.pow((ti - echoTimeMs) / rxSigmaMs, 2));
    const carrier = Math.sin(2 * Math.PI * (carrierHz / 1000) * ti);
    const noise = (random() * 2 - 1) * noiseAmp;
    time[i] = Math.round(ti * 1000) / 1000;
    amplitude[i] = Math.max(-1, Math.min(1, envTx * baseAmp * carrier + envRx * rxAmp * carrier + noise));
  }
  return { time, amplitude, sampleRateHz, totalMs: Math.round(totalMs * 100) / 100 };
}

export function simulateUltrasonicMeasurement(input: UltrasonicMeasurementInput): UltrasonicMeasurement {
  if (!Number.isFinite(input.distanceM) || input.distanceM < 0) throw new RangeError("距离必须是非负有限数");
  const speedMps = input.speedMps ?? DEFAULT_SOUND_SPEED_MPS;
  if (!Number.isFinite(speedMps) || speedMps <= 0) throw new RangeError("声速必须是正数");
  const reflectivity = clamp(input.reflectivity ?? 85);
  const noisePercent = clamp(input.noisePercent ?? 3);
  const random = input.random ?? Math.random;
  const randomValue = clamp(random(), 0, 1);
  const randomOffset = (randomValue * 2 - 1) * (noisePercent / 100);
  const measuredDistanceM = input.distanceM * (1 + randomOffset + (100 - reflectivity) / 1000);
  const errorPercent = input.distanceM === 0
    ? measuredDistanceM === 0
      ? 0
      : 100
    : (Math.abs(measuredDistanceM - input.distanceM) / input.distanceM) * 100;

  const waveform = simulateUltrasonicWaveform({ ...input, reflectivity, noisePercent, random });

  return {
    distanceM: input.distanceM,
    speedMps,
    reflectivity,
    noisePercent,
    echoTimeMs: calculateUltrasonicEchoTime(input.distanceM, speedMps),
    measuredDistanceM,
    errorPercent,
    quality: signalQuality(reflectivity, noisePercent),
    waveform,
    measured: measuredDistanceM,
    error: errorPercent,
  };
}

export const runUltrasonicMeasurement = simulateUltrasonicMeasurement;

function scoreInput(value: number | undefined, fallback = 0): number {
  return clamp(value ?? fallback);
}

function labError(record: Pick<LabRecord, "errorPercent" | "error">): number {
  return Math.max(0, record.errorPercent ?? record.error ?? 0);
}

/**
 * 根据诊断、任务、实验和教师量规汇总四阶能力。
 * 计算过程不读取当前时间、不修改输入，适合在教师端复核前反复计算。
 */
export function summarizeEvaluation(inputs: EvaluationInputs = {}): EvaluationSummary {
  const diagnosis = scoreInput(inputs.diagnosisScore, 60);
  const progress = scoreInput(inputs.taskProgress);
  const experimentRecords = inputs.labRecords ?? [];
  const averageError = experimentRecords.length === 0
    ? 0
    : experimentRecords.reduce((sum, record) => sum + labError(record), 0) / experimentRecords.length;
  const labScore = experimentRecords.length === 0 ? 60 : Math.max(60, 100 - Math.min(40, averageError * 4));
  const chatScore = inputs.chatCount && inputs.chatCount > 0 ? 82 : 65;
  const participation = scoreInput(inputs.participation);
  const teamwork = scoreInput(inputs.teamwork ?? inputs.team);
  const design = scoreInput(inputs.design);
  const experiment = scoreInput(inputs.experiment);
  const presentation = scoreInput(inputs.presentation ?? inputs.present);
  const reflection = scoreInput(inputs.reflection ?? inputs.reflect);

  const knowledge = rounded(diagnosis * 0.55 + chatScore * 0.2 + progress * 0.25);
  const application = rounded(experiment * 0.35 + design * 0.25 + labScore * 0.25 + progress * 0.15);
  const innovation = rounded(design * 0.35 + experiment * 0.25 + reflection * 0.25 + progress * 0.15);
  const collaboration = rounded(teamwork * 0.45 + participation * 0.25 + presentation * 0.2 + reflection * 0.1);
  const dimensions = { 知识理解: knowledge, 专业应用: application, 创新实践: innovation, 团队协作: collaboration };
  const ordered = Object.entries(dimensions).sort((left, right) => right[1] - left[1]);
  const final = rounded(knowledge * 0.25 + application * 0.3 + innovation * 0.25 + collaboration * 0.2);
  const grade = final >= 90 ? "卓越" : final >= 80 ? "良好" : final >= 70 ? "达标" : final >= 60 ? "基本达标" : "需重点改进";

  return {
    knowledge,
    application,
    innovation,
    collaboration,
    final,
    grade,
    weakestDimension: ordered.at(-1)?.[0] ?? "知识理解",
    strongestDimension: ordered[0]?.[0] ?? "知识理解",
  };
}

export const aggregateEvaluation = summarizeEvaluation;
export const calculateEvaluation = summarizeEvaluation;

/** AI 助教的规则回复：只给提示、追问和验证路径，不替学生提交答案。 */
export function aiReply(question: string): string {
  const text = String(question ?? "").toLowerCase();
  if (text.includes("超声") || text.includes("测距")) {
    return "先建立物理链条：发射→传播→反射→接收→计时。你可以先回答两个问题：\n1. 为什么距离公式中需要除以 2？\n2. 声速变化会怎样影响结果？\n提示：测距的核心关系是“往返路程 = 声速 × 时间”。";
  }
  if (text.includes("误差") || text.includes("数据") || text.includes("波动")) {
    return "请按“仪器—方法—环境—人为—模型”五类检查：\n① 传感器分辨率和零点；② 控制变量是否一致；③ 温度、振动、电磁干扰；④ 操作重复性；⑤ 理论假设是否满足。\n建议先画散点图、计算平均值和离散程度，再判断是随机误差还是系统误差。";
  }
  if (text.includes("牛顿") || text.includes("力")) {
    return "不要只套 F=ma。先画受力图，再选择研究对象和方向，明确哪些力是真实相互作用、哪些量是测量值。你可以把项目中的运动状态变化与合外力联系起来，然后检查模型是否忽略了摩擦、阻力或约束。";
  }
  if (text.includes("方案") || text.includes("合理")) {
    return "用四个问题审查方案：\n1. 物理原理是否成立？\n2. 关键量是否可测？\n3. 是否设置对照与重复实验？\n4. 评价指标能否判断方案优劣？\n请把你的方案用“输入—过程—输出—评价指标”四栏写出来，我再帮你逐项检查。";
  }
  if (text.includes("谐振") || text.includes("无线")) {
    return "谐振能增强发射端与接收端之间的能量交换。建议从固有频率、耦合强度和品质因数三个角度分析。进一步想一想：线圈发生偏移时，互感和有效磁通量为什么会下降？";
  }
  if (text.includes("光") || text.includes("透镜") || text.includes("干涉")) {
    return "请先判断当前问题属于几何光学还是波动光学。几何光学重点看物距、像距、焦距与光路；波动光学重点看相位差、光程差和相干条件。把已知量和要测量的量列出来，会更容易选择模型。";
  }
  return "我会用“追问—提示—验证”帮助你，而不是直接替你完成。请补充三点：\n1. 你正在研究哪个项目或知识点？\n2. 你已经尝试了什么？\n3. 你具体卡在哪一步？";
}

export const getAiReply = aiReply;
export const generateAiReply = aiReply;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 将对象列表序列化为 RFC 4180 风格 CSV，保留中文列名。 */
export function toCsv(rows: readonly ExportRow[], columns?: readonly string[]): string {
  if (rows.length === 0) return "";
  const headers = columns ? [...columns] : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.map(csvCell).join(",")];
  rows.forEach((row) => lines.push(headers.map((header) => csvCell(row[header])).join(",")));
  return lines.join("\r\n");
}

export const serializeCsv = toCsv;
export const buildCsv = toCsv;

/** 将学习数据序列化为可下载或复制的格式化 JSON。 */
export function toJson(value: unknown, pretty = true): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

export const serializeJson = toJson;
export const buildJson = toJson;

/** 为导出文件补充 UTF-8 BOM，避免中文在旧版表格软件中乱码。 */
export function withUtf8Bom(content: string): string {
  return content.startsWith("\ufeff") ? content : `\ufeff${content}`;
}

export function projectMatchesForChapter(
  chapter: ChapterMapping,
  diagnosis?: DiagnosisResult,
  student?: StudentProfile,
): ProjectMatch | undefined {
  const project = getProjectById(chapter.primary);
  if (!project) return undefined;
  const score = calculateProjectMatchScore(project, diagnosis, student);
  return { project, score, reasons: ["章节主项目"] };
}

// 保留这些名称，便于旧页面迁移时逐步替换原型中的全局函数。
export const projects = PROJECTS;
export const quizData = QUIZ_QUESTIONS;
export const taskTemplates = TASK_TEMPLATES;
export const chapterMappings = CHAPTER_MAPPINGS;
