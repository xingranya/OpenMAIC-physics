import { describe, expect, it } from "vitest";

import {
  CHAPTER_MAPPINGS,
  DEMO_ACCOUNTS,
  PHYSICS_AI_PASSWORD,
  PROJECTS,
  QUIZ_QUESTIONS,
  TASK_TEMPLATES,
} from "@/lib/physics/data";
import {
  aiReply,
  calculateChapterMatchScore,
  calculateDiagnosis,
  calculateEchoTime,
  calculateUltrasonicDistance,
  matchProjects,
  simulateUltrasonicMeasurement,
  summarizeEvaluation,
  taskProgressPercentage,
  toCsv,
} from "@/lib/physics/engine";
import {
  authenticate,
  clearState,
  createInitialState,
  loadState,
  saveState,
  STORAGE_VERSION,
  type StorageLike,
} from "@/lib/physics/local-store";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("领域数据", () => {
  it("提供学生和教师演示账号，并使用统一密码", () => {
    expect(PHYSICS_AI_PASSWORD).toBe("dunzhongwan");
    expect(DEMO_ACCOUNTS.map((account) => account.role)).toEqual(["student", "teacher"]);
    expect(DEMO_ACCOUNTS.every((account) => account.password === PHYSICS_AI_PASSWORD)).toBe(true);
  });

  it("包含完整的诊断题、项目和章节映射种子数据", () => {
    expect(QUIZ_QUESTIONS).toHaveLength(8);
    expect(PROJECTS.length).toBeGreaterThanOrEqual(18);
    expect(CHAPTER_MAPPINGS).toHaveLength(18);
    expect(TASK_TEMPLATES).toHaveLength(5);
    expect(new Set(CHAPTER_MAPPINGS.map((chapter) => chapter.primary)).size).toBeGreaterThan(5);
  });
});

describe("诊断和项目匹配", () => {
  it("按题目答案计算总分和分维度分数", () => {
    const answers = QUIZ_QUESTIONS.map((question) => question.correctIndex);
    const result = calculateDiagnosis(answers);
    expect(result.score).toBe(100);
    expect(result.level).toBe("基础扎实");
    expect(result.answeredCount).toBe(8);
    expect(result.dimensions.力学).toBe(100);
    expect(result.dimensions.实验).toBe(100);
    expect(result.dims).toBe(result.dimensions);
  });

  it("未答题会保留为错误且不产生 NaN", () => {
    const result = calculateDiagnosis([0, null, undefined]);
    expect(result.score).toBe(0);
    expect(result.answeredCount).toBe(1);
    expect(Object.values(result.dimensions).every(Number.isFinite)).toBe(true);
  });

  it("按薄弱维度、学习方式和目标排序项目", () => {
    const diagnosis = calculateDiagnosis([1, 0, 1, 0, 1, 1, 0, 1]);
    const profile = {
      name: "陈泽",
      id: "20260001",
      major: "物理学",
      style: "practice" as const,
      target: "application" as const,
    };
    const matches = matchProjects(diagnosis, profile);
    expect(matches).toHaveLength(PROJECTS.length);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches.at(-1)?.score ?? 0);
    expect(matches[0].reasons.length).toBeGreaterThan(0);
    expect(matches.some((match) => match.project.id === "guide")).toBe(true);
    expect(matchProjects(undefined)[0].score).toBeGreaterThan(0);
  });

  it("支持以画像对象传入项目匹配函数", () => {
    const diagnosis = calculateDiagnosis(QUIZ_QUESTIONS.map(() => 0));
    const profile = {
      name: "演示学生",
      id: "1",
      major: "物理学",
      style: "visual" as const,
      target: "concept" as const,
    };
    const matches = matchProjects({ diagnosis, student: profile });
    expect(matches[0].score).toBeGreaterThanOrEqual(0);
  });

  it("可以计算章节个性化匹配分", () => {
    const diagnosis = calculateDiagnosis(QUIZ_QUESTIONS.map(() => 1));
    const score = calculateChapterMatchScore(CHAPTER_MAPPINGS[7], diagnosis, {
      name: "演示学生",
      id: "1",
      major: "物理学",
      style: "practice",
      target: "application",
    });
    expect(score).toBeGreaterThan(82);
    expect(score).toBeLessThanOrEqual(98);
  });
});

describe("任务、实验和评价", () => {
  it("汇总五阶任务进度", () => {
    const completed = { "0-0": true, "0-1": true, "2-2": true };
    expect(taskProgressPercentage(completed)).toBe(20);
    expect(taskProgressPercentage({})).toBe(0);
    expect(taskProgressPercentage({
      ...Object.fromEntries(TASK_TEMPLATES.flatMap((task, taskIndex) => task.checks.map((_, checkIndex) => [`${taskIndex}-${checkIndex}`, true]))),
    })).toBe(100);
  });

  it("使用往返时间公式计算超声距离", () => {
    expect(calculateEchoTime(1, 343)).toBeCloseTo(5.8309, 3);
    expect(calculateUltrasonicDistance(5.83090379, 343)).toBeCloseTo(1, 6);
    expect(() => calculateUltrasonicDistance(-1)).toThrow(RangeError);
  });

  it("生成确定性的超声测量结果并判断信号质量", () => {
    const result = simulateUltrasonicMeasurement({ distanceM: 1, speedMps: 343, reflectivity: 85, noisePercent: 0, random: () => 0.5 });
    expect(result.echoTimeMs).toBeCloseTo(5.8309, 3);
    expect(result.measuredDistanceM).toBeCloseTo(1.015, 6);
    expect(result.errorPercent).toBeCloseTo(1.5, 6);
    expect(result.quality).toBe("良好");
    expect(result.measured).toBe(result.measuredDistanceM);
  });

  it("按原型权重汇总四维评价", () => {
    const result = summarizeEvaluation({
      diagnosisScore: 100,
      taskProgress: 100,
      chatCount: 2,
      participation: 100,
      teamwork: 100,
      design: 100,
      experiment: 100,
      presentation: 100,
      reflection: 100,
      labRecords: [{ errorPercent: 0 }],
    });
    expect(result).toMatchObject({ knowledge: 96, application: 100, innovation: 100, collaboration: 100, final: 99, grade: "卓越" });
    expect(result.weakestDimension).toBe("知识理解");
    expect(result.strongestDimension).toBe("专业应用");
  });

  it("提供规则化 AI 回复和中文 CSV 导出", () => {
    expect(aiReply("超声波测距误差怎么分析")).toContain("往返路程");
    expect(aiReply("我不知道")).toContain("追问—提示—验证");
    expect(toCsv([{ 姓名: "张三", 分数: 80 }, { 姓名: "李,四", 分数: 90 }])).toBe("姓名,分数\r\n张三,80\r\n\"李,四\",90");
  });
});

describe("版本化本地持久化", () => {
  it("保存为版本化包络并可恢复状态", () => {
    const storage = new MemoryStorage();
    const state = createInitialState();
    state.role = "teacher";
    state.projectId = "guide";
    expect(saveState(state, storage)).toBe(true);
    const envelope = JSON.parse(storage.getItem("physicsAISystem") ?? "null") as { version: number };
    expect(envelope.version).toBe(STORAGE_VERSION);
    expect(loadState(storage)).toMatchObject({ role: "teacher", projectId: "guide" });
  });

  it("兼容旧版裸状态、坏 JSON 和清空操作", () => {
    const storage = new MemoryStorage();
    storage.setItem("physicsAISystem", JSON.stringify({ role: "student", taskChecks: { "0-0": true } }));
    expect(loadState(storage).taskChecks["0-0"]).toBe(true);
    storage.setItem("physicsAISystem", "{bad-json");
    expect(loadState(storage)).toEqual(createInitialState());
    expect(clearState(storage)).toBe(true);
    expect(storage.getItem("physicsAISystem")).toBeNull();
  });

  it("仅接受演示账号的统一密码", () => {
    expect(authenticate("student", PHYSICS_AI_PASSWORD)?.role).toBe("student");
    expect(authenticate("TEACHER", PHYSICS_AI_PASSWORD)?.role).toBe("teacher");
    expect(authenticate("student", "wrong-password")).toBeNull();
  });
});
