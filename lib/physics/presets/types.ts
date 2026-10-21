/**
 * 预置课堂包 —— 数据契约。
 *
 * 预置包是"零配额、零网络"演示的保险：即使没有配置任何模型 Key、
 * 或现场断网，也能完整演示「生成 → 上课 → 导出」全流程。
 *
 * 每个包是一份**课堂剧本**（纯数据），由 `build-classroom.ts` 的纯函数
 * 翻译成 OpenMAIC 的 Stage DSL 文档。
 */

/** 讲演场景。 */
export interface PresetScene {
  /** 场景标题。 */
  title: string;
  /** 讲授要点。 */
  bullets: readonly string[];
  /** 关键公式（以纯文本呈现，不依赖 LaTeX 渲染）。 */
  formula?: string;
  /** 旁白稿。 */
  narration: string;
}

/** 测验题。 */
export interface PresetQuiz {
  question: string;
  options: readonly string[];
  /** 正确选项下标。 */
  correctIndex: number;
  /** 解析。 */
  analysis: string;
}

/** 讨论引导。 */
export interface PresetDiscussion {
  /** 发言角色 id。 */
  agentId: string;
  /** 引导语。 */
  prompt: string;
}

/** PBL 任务。 */
export interface PresetPbl {
  /** 任务名。 */
  title: string;
  /** 学生角色。 */
  role: string;
  /** 任务目标。 */
  goal: string;
  /** 里程碑。 */
  milestones: readonly string[];
}

/** 一份预置课堂剧本。 */
export interface PresetClassroom {
  /** 稳定的包 id（用于去重与版本管理）。 */
  id: string;
  /** 对应教学矩阵的章号。 */
  chapterNo: number;
  /** 课程标题。 */
  title: string;
  /** 副标题。 */
  subtitle: string;
  /** 教学目标。 */
  objectives: readonly string[];
  /** 场景脚本。 */
  scenes: readonly PresetScene[];
  /** 测验题。 */
  quiz: readonly PresetQuiz[];
  /** 讨论引导。 */
  discussion: readonly PresetDiscussion[];
  /** PBL 任务。 */
  pbl?: PresetPbl;
  /** 课程思政锚点 key。 */
  ideologyKey: string;
  /** 是否包含自包含的交互仿真场景。 */
  hasInteractive?: boolean;
}
