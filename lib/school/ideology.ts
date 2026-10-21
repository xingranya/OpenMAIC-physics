/**
 * 课程思政映射 —— 长江大学文理学院 · 大学物理
 *
 * 每一章挂载一条思政锚点，在 AI 课堂课件、章节知识图谱与学习报告中呈现，
 * 把"物理原理"与"工程伦理 / 科技报国 / 严谨求实"等价值引导连起来。
 *
 * 原则：思政点必须从该章的真实物理内容自然生长，不做生硬贴标签。
 */

/** 思政锚点。 */
export interface IdeologyPoint {
  /** 锚点 key，与 `lib/school/curriculum.ts` 的 ideologyKey 对应。 */
  key: string;
  /** 主题标签。 */
  theme: string;
  /** 一句话说明。 */
  summary: string;
  /** 与物理内容的结合点（2-3 句）。 */
  integration: string;
  /** 课堂讨论引导语。 */
  discussionPrompt: string;
}

export const IDEOLOGY_POINTS: readonly IdeologyPoint[] = [
  {
    key: 'rigor',
    theme: '严谨求实',
    summary: '尊重数据、如实报告误差，是工程实践的底线。',
    integration:
      '测量不确定度一章让学生亲手面对"读数永远有误差"这一事实：有效数字不足、仪器未校准、系统误差被误当成随机误差，都会在结论里留下痕迹。' +
      '把结论建立在误差分析之上，而不是建立在"看起来对"之上，是工程师最基本的职业操守。',
    discussionPrompt:
      '如果你为了让报告好看而把一个偏差很大的数据点删掉，量纲自洽的报告还有意义吗？',
  },
  {
    key: 'model',
    theme: '科学方法',
    summary: '模型是现实的近似，近似必须有边界、有适用范围。',
    integration:
      '质点模型、理想气体模型、匀强电场模型，每一个都在简化现实。教学的重点不是记住结论，而是会说清"在什么条件下这个模型成立、超出后为什么失效"。' +
      '这与工程中做近似、留安全裕量的思维方式完全同源。',
    discussionPrompt: '模型失效的那一刻，是物理的失败还是模型的失败？',
  },
  {
    key: 'energy',
    theme: '节能与绿色发展',
    summary: '能量守恒是物理定律，也是能源利用的约束条件。',
    integration:
      '从太阳能热水器效率优化、无线传能效率曲线到工业能耗问题，能量流图把"效率"从一个数字变成一张可诊断的图。' +
      '任何"永动机"式的设想都会在同一张图上暴露矛盾——物理定律是技术乐观主义的边界，也是它的护栏。',
    discussionPrompt: '如果效率提升到了 100%，你还认为这属于"能源"问题吗？',
  },
  {
    key: 'craft',
    theme: '工匠精神',
    summary: '把一件事做到可靠，靠的是规范、复现和迭代。',
    integration:
      '刚体转动惯量测定、迈克尔逊条纹计数这类实验，真正训练的是"按同一套流程重复做，结果应该一致"。' +
      '当学生发现自己的计数与人工计数对不上时，如何定位误差来源、如何改进操作而不是归咎于仪器——这是从"做实验"到"做可靠的事"的分水岭。',
    discussionPrompt: '一次实验做砸了，你的第一反应是怀疑仪器还是怀疑流程？',
  },
  {
    key: 'service',
    theme: '科技报国与工程伦理',
    summary: '技术要回到真实的人身上：导盲测距、漏磁检测、无线供能，都服务于具体的人。',
    integration:
      '超声波测距用于导盲与结构探伤，无线能量传输面向传感器供能。把物理量换算成"能帮到谁"的那一刻，' +
      '量纲、精度、误报率就不再是抽象数字，而是关系到使用者是否安全、是否被尊重。工程伦理由此变得可计算。',
    discussionPrompt: '一个测距装置把误差从 1cm 放大到 10cm，谁会最先受到伤害？',
  },
];

const INDEX = new Map(IDEOLOGY_POINTS.map((point) => [point.key, point]));

/** 知识维度 → 思政锚点的默认映射（项目案例按其覆盖维度取用）。 */
const DIMENSION_IDEOLOGY: Record<string, string> = {
  力学: 'model',
  波动: 'craft',
  热学: 'energy',
  电磁学: 'service',
  光学: 'rigor',
  近代物理: 'model',
  实验: 'rigor',
};

/** 按知识维度取得思政锚点。 */
export function getIdeologyPointForDimension(dimension: string): IdeologyPoint | undefined {
  const key = DIMENSION_IDEOLOGY[dimension];
  return key ? INDEX.get(key) : undefined;
}

/** 按 key 取得思政锚点。 */
export function getIdeologyPoint(key: string): IdeologyPoint | undefined {
  return INDEX.get(key);
}

/** 供 AI 课堂提示词使用的思政约束摘要。 */
export function buildIdeologyConstraint(): string {
  return IDEOLOGY_POINTS.map((point) => `- 【${point.theme}】${point.summary}`).join('\n');
}
