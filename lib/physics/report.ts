/**
 * 学习报告 / 教师复核报告的纯文本生成器。
 *
 * 输出 Markdown——既可以由浏览器直接下载，也可以用 window.print() 转 PDF。
 * 全部逻辑保持在纯函数层，不依赖 React，便于单元测试和未来扩展（PDF 模板、邮件等）。
 */
import type { AppState, LabRecord, Project } from "./types"

export interface ReportInput {
  state: AppState
  project?: Project | null
  summary: {
    final: number
    grade: string
    strongestDimension: string
    weakestDimension: string
    knowledge: number
    application: number
    innovation: number
    collaboration: number
  }
  generatedAt?: Date
}

export interface MarkdownSection {
  heading: string
  body: string
}

const HEAD = (level: 1 | 2 | 3, text: string) => `${"#".repeat(level)} ${text}`

function safe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return String(value)
}

function bullet(items: string[]): string {
  if (items.length === 0) return "（暂无）"
  return items.map((item) => `- ${item}`).join("\n")
}

function progressBar(value: number, width = 24): string {
  const ratio = Math.max(0, Math.min(1, value / 100))
  const filled = Math.round(ratio * width)
  const empty = width - filled
  return `\`[${"█".repeat(filled)}${"·".repeat(empty)}]\` ${value}`
}

function joinLabRow(record: LabRecord): string {
  return `| ${record.time ?? record.timestamp} | ${record.distanceM.toFixed(2)} m | ${record.measuredDistanceM.toFixed(3)} m | ${record.errorPercent.toFixed(2)}% | ${record.quality} |`
}

export function buildStudentReportMarkdown(input: ReportInput): string {
  const { state, project, summary } = input
  const now = input.generatedAt ?? new Date()
  const generatedAt = now.toLocaleString("zh-CN")
  const student = state.student ?? { name: "陈思远" } as AppState["student"]
  const diagnosis = state.diagnosis

  const sections: MarkdownSection[] = []

  sections.push({
    heading: "封面",
    body: [
      `> 大学物理 AI 智慧教学系统 · 大学物理学习报告`,
      ``,
      `**学生**：${safe(student?.name)}`,
      `**班级**：物理学 2601 班`,
      `**课程模块**：上学期力学模块`,
      `**报告生成时间**：${generatedAt}`,
    ].join("\n"),
  })

  sections.push({
    heading: "综合得分",
    body: [
      `# ${summary.final} · ${summary.grade}`,
      ``,
      `- 优势维度：${summary.strongestDimension}`,
      `- 下一步重点：${summary.weakestDimension}`,
    ].join("\n"),
  })

  sections.push({
    heading: "诊断画像",
    body: diagnosis
      ? [
          `前测得分：**${diagnosis.score} 分** · ${diagnosis.level}`,
          ``,
          bullet(
            (Object.entries(diagnosis.dimensions) as Array<[string, number]>).map(
              ([dimension, value]) => `${dimension}：${value} 分`,
            ),
          ),
        ].join("\n")
      : "尚未完成 AI 学情诊断，报告基于已有任务与实验数据生成。",
  })

  sections.push({
    heading: "项目与任务",
    body: project
      ? [
          `当前项目：**${project.title}**（${project.level}）`,
          `能力路径：${project.ability}`,
          ``,
          `- 任务进度：${state.activeTask !== undefined ? `${state.activeTask + 1}/5` : "0/5"}`,
          `- 五阶段闯关记录：${Object.keys(state.taskTexts ?? {}).length} 段`,
        ].join("\n")
      : "尚未选择项目。",
  })

  sections.push({
    heading: "四阶能力结果",
    body: [
      bullet([
        progressBar(summary.knowledge) + " · 知识理解",
        progressBar(summary.application) + " · 专业应用",
        progressBar(summary.innovation) + " · 创新实践",
        progressBar(summary.collaboration) + " · 团队协作",
      ]),
    ].join("\n"),
  })

  if (state.labRecords.length > 0) {
    const recent = state.labRecords.slice(-10).reverse()
    sections.push({
      heading: "实验记录",
      body: [
        `共 ${state.labRecords.length} 条，最近 ${recent.length} 条：` + "\n",
        `| 时间 | 距离 | 测量值 | 误差 | 质量 |`,
        `| --- | --- | --- | --- | --- |`,
        recent.map(joinLabRow).join("\n"),
      ].join("\n"),
    })
  }

  sections.push({
    heading: "AI 教学建议",
    body: `当前相对薄弱维度为「${summary.weakestDimension}」。建议下一轮项目保留一个可观察、可记录的专项任务，并用前后数据验证改进效果。`,
  })

  sections.push({
    heading: "操作痕迹",
    body: bullet([
      `AI 助教对话 ${state.chat.length} 条`,
      `项目匹配：基于 ${diagnosis ? `${diagnosis.score} 分前测` : "未诊断"} 排序`,
      `本地持久化：所有数据保存在浏览器 localStorage，跨刷新保留`,
    ]),
  })

  return [
    `<!-- 大学物理 AI 智慧教学系统 · 学习报告 -->`,
    `# 大学物理学习报告 · ${safe(student?.name)}`,
    ``,
    `_生成时间 ${generatedAt} | 来源：大学物理 AI 智慧教学系统（演示版）_`,
    ``,
    `---`,
    ``,
    sections
      .map((section) => `${HEAD(2, section.heading)}\n\n${section.body}`)
      .join("\n\n---\n\n"),
    ``,
    `---`,
    ``,
    `_本报告由本地浏览器根据学习过程生成，未连接远程大模型或教务系统。_`,
  ].join("\n")
}

export interface TeacherBatchReviewInput {
  className: string
  selectedNames: string[]
  defaultScore: number
  defaultReason: string
  reviewer: string
  generatedAt?: Date
}

export function buildTeacherBatchReviewMarkdown(input: TeacherBatchReviewInput): string {
  const now = input.generatedAt ?? new Date()
  const generatedAt = now.toLocaleString("zh-CN")
  return [
    `<!-- 大学物理 AI 智慧教学系统 · 教师批量复核记录 -->`,
    `# 教师批量复核记录`,
    ``,
    `_生成时间 ${generatedAt} | 复核人：${input.reviewer}_`,
    ``,
    `## 复核对象`,
    `- 班级：${input.className}`,
    `- 本次复核人数：${input.selectedNames.length}`,
    bullet(input.selectedNames),
    ``,
    `## 默认复核分 / 理由`,
    `- 复核分：${input.defaultScore}`,
    `- 复核理由：${input.defaultReason.trim() || "（未填写）"}`,
    ``,
    `> 本记录由本地操作生成，不替代逐人 Sheet 复核中的细化分与理由；可在「评价复核 → 批量复核」中按需调整。`,
  ].join("\n")
}

/** 教师逐人复核明细的输入。 */
export interface TeacherReviewDetailInput {
  className: string
  reviewer: string
  rows: readonly {
    name: string
    aiScore: number
    finalScore?: number
    reason?: string
    weakDimension?: string
    project?: string
    progress?: number
    risk?: string
  }[]
  generatedAt?: Date
}

/**
 * 生成教师逐人复核明细。
 *
 * 与 `buildTeacherBatchReviewMarkdown` 的区别：这里输出每名学生的
 * AI 建议分、教师最终分与理由，便于评审时逐条核对"教师保留了最终判断权"。
 */
export function buildTeacherReviewDetailMarkdown(input: TeacherReviewDetailInput): string {
  const now = input.generatedAt ?? new Date()
  const generatedAt = now.toLocaleString("zh-CN")
  const rows = input.rows.map((row) => {
    const final = row.finalScore === undefined ? "未复核" : String(row.finalScore)
    const reason = row.reason?.trim() || "（未填写）"
    const detail = [row.weakDimension, row.project, row.progress === undefined ? undefined : `进度 ${row.progress}%`]
      .filter(Boolean)
      .join(" · ")
    return `| ${row.name} | ${row.aiScore} | ${final} | ${row.risk ?? "—"} | ${detail} | ${reason} |`
  })

  return [
    `<!-- 长江大学文理学院 · 大学物理 AI 智慧课堂 · 教师复核明细 -->`,
    `# 教师复核明细`,
    ``,
    `_生成时间 ${generatedAt} | 复核人：${input.reviewer} | 班级：${input.className}_`,
    ``,
    `> AI 只产出建议分与理由；下表"最终分"一列为教师复核结果，始终优先。`,
    ``,
    `| 学生 | AI 建议分 | 最终分 | 风险 | 学情摘要 | 复核理由 |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows,
    ``,
    `> 本记录由本地操作生成，不含真实教务数据。`,
  ].join("\n")
}
