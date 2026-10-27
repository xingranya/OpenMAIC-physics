/**
 * 分层练习库：知识能力维度里「配」这一环的落点。
 *
 * ## 为什么练习要和项目分开
 *
 * 申请书给知识能力配的 AI 功能是「**推荐分层练习**」，给专业能力配的才是
 * 「按专业与基础推荐项目」。两者不是一回事：项目是几周的综合任务，练习是
 * 当天就能做完的一次训练。把练习塞进项目列表里，学生会以为「配给我一个
 * 项目」就是「配给我一套练习」，于是项目库被当成题库用。
 *
 * ## 分层的依据
 *
 * 层级不按「题难不难」分，按**要求学生做哪一类认知动作**分：
 *
 * - 基础：认出概念、套用公式（对应基础水平「在提示下解释」）；
 * - 进阶：解释规律、选择模型、解变式题（对应进阶水平「独立解释」）；
 * - 挑战：辨析易错概念、说明适用条件、迁移到新情境（对应高阶水平）。
 *
 * 这样分的好处是：学生升层时，看到的不只是「题变难了」，而是**要求变了**。
 * 只按难度分层的题库，升层等于换一批数字更大的题，能力并不会真的往上走。
 */

import type { AbilityTier, DiagnosticDimension } from './types';

/** 练习的三个层级，与量化评价表的三级水平一一对应。 */
export type ExerciseLevel = '基础' | '进阶' | '挑战';

export interface Exercise {
  id: string;
  dimension: DiagnosticDimension;
  level: ExerciseLevel;
  /** 知识锚点：对应章节与核心概念。 */
  anchor: string;
  /** 题干（可当堂完成，不需要设备）。 */
  task: string;
  /** 自查点：做完之后逐条对，对不上就是没做到。 */
  selfCheck: readonly string[];
}

/** 层级 → 项目层级 / 练习层级的对应。 */
export const EXERCISE_LEVEL_OF_TIER: Readonly<Record<AbilityTier, ExerciseLevel>> = {
  basic: '基础',
  applied: '进阶',
  challenge: '挑战',
};

/**
 * 题库。五个板块各三级，另加三道实验通用题。
 *
 * 题量刻意不大：分层练习的价值在「当天做完并自查」，不在刷题量。
 * 一次配 3 道，做不完的学生会直接跳过——那比不配还糟。
 */
export const EXERCISES: readonly Exercise[] = [
  /* ── 力学 ── */
  {
    id: 'mech-basic',
    dimension: '力学',
    level: '基础',
    anchor: '第 2 章 · 牛顿运动定律',
    task: '质量 4 kg 的物体在水平面上受 12 N 水平拉力，摩擦系数 0.1。求加速度，并画出受力图。',
    selfCheck: ['四个力都画了吗（重力、支持力、拉力、摩擦力）', '摩擦力用 f = μN 且 N = mg 吗', '结果单位写成 m/s² 了吗'],
  },
  {
    id: 'mech-applied',
    dimension: '力学',
    level: '进阶',
    anchor: '第 3 章 · 功能关系',
    task: '同一物体从斜面顶端滑下，斜面粗糙。分别用牛顿定律和动能定理求底端速度，比较两法的工作量与适用条件。',
    selfCheck: ['两种方法的结果一致吗', '动能定理里有没有漏掉摩擦力做的负功', '说清了「什么时候用哪种」吗'],
  },
  {
    id: 'mech-challenge',
    dimension: '力学',
    level: '挑战',
    anchor: '第 3 章 · 机械能守恒的适用条件',
    task: '举一个「机械能看起来守恒但其实不守恒」的实例，说明是哪一步判断错了，并给出正确的解法。',
    selfCheck: ['指出了具体是哪个力做了功', '说明了为什么容易被忽略', '正确解法与错误解法给出了数值差异吗'],
  },

  /* ── 振动与波 ── */
  {
    id: 'wave-basic',
    dimension: '波动',
    level: '基础',
    anchor: '第 6 章 · 简谐振动',
    task: '弹簧振子振幅 5 cm、周期 0.4 s。写出位移表达式，并求 t = 0.1 s 时的位移。',
    selfCheck: ['用了 x = A cos(ωt + φ) 且 ω = 2π/T 吗', '振幅单位换成米了吗', '相位取的是哪个初相，说清了吗'],
  },
  {
    id: 'wave-applied',
    dimension: '波动',
    level: '进阶',
    anchor: '第 7 章 · 波速与振动速度',
    task: '一列简谐波沿 x 轴传播，说明「波速」与「质点振动速度」的区别，并各求一个数值。',
    selfCheck: ['波速由介质决定、振动速度由相位决定，说清了吗', '两个数值的量级差异解释了吗', '没有把 v = λf 用到质点速度上吗'],
  },
  {
    id: 'wave-challenge',
    dimension: '波动',
    level: '挑战',
    anchor: '第 7 章 · 驻波与边界条件',
    task: '同一根弦，两端固定与一端固定一端自由，基频相差多少倍？从边界条件推导，不要只背结论。',
    selfCheck: ['用了边界条件而不是套公式吗', '推导出 1/2 这个倍数了吗', '说明了「自由端是波腹」吗'],
  },

  /* ── 电磁学 ── */
  {
    id: 'em-basic',
    dimension: '电磁学',
    level: '基础',
    anchor: '第 9 章 · 库仑定律与场强',
    task: '两个点电荷相距 0.2 m，电量分别为 +3 μC 与 −2 μC。求相互作用力大小与方向。',
    selfCheck: ['电量换算成库仑了吗（μC = 10⁻⁶ C）', '方向说的是「相互吸引」还是给了矢量', '结果单位是 N 吗'],
  },
  {
    id: 'em-applied',
    dimension: '电磁学',
    level: '进阶',
    anchor: '第 10 章 · 高斯定理',
    task: '分别求均匀带电球壳内部与外部的场强，说明为什么球壳内部场强为零。',
    selfCheck: ['选了合适的闭合曲面吗', '内部那段是用高斯定理还是用叠加说明的', '有没有把「场强为零」和「电势为零」混起来'],
  },
  {
    id: 'em-challenge',
    dimension: '电磁学',
    level: '挑战',
    anchor: '第 11 章 · 电磁感应与楞次定律',
    task: '设计一个实验：让线圈中的感应电流方向改变两次，说明每一步磁通量怎么变。',
    selfCheck: ['每次方向变化都对应磁通量增减的翻转吗', '说明了「阻碍变化」而不是「阻碍磁场」吗', '装置参数写清了吗'],
  },

  /* ── 光学 ── */
  {
    id: 'opt-basic',
    dimension: '光学',
    level: '基础',
    anchor: '第 13 章 · 折射定律',
    task: '光从空气以 45° 入射到水中（n = 1.33），求折射角。',
    selfCheck: ['用了 n₁sinθ₁ = n₂sinθ₂ 吗', '角度与正弦值没有混用吗', '结果小于 45° 吗（该小于）'],
  },
  {
    id: 'opt-applied',
    dimension: '光学',
    level: '进阶',
    anchor: '第 14 章 · 双缝干涉',
    task: '双缝间距 0.2 mm、屏距 1 m、波长 600 nm。求相邻明纹间距，并说明间距随哪些量变化。',
    selfCheck: ['用了 Δx = λD/d 且单位统一成米了吗', '三个量的依赖关系都说到了吗', '量级合理吗（毫米级）'],
  },
  {
    id: 'opt-challenge',
    dimension: '光学',
    level: '挑战',
    anchor: '第 14 章 · 干涉与衍射的判据',
    task: '同一装置下，什么条件下看到的是干涉条纹、什么条件下是衍射图样？给出判据并估算临界缝宽。',
    selfCheck: ['判据用的是缝宽与波长比较吗', '临界值估出来了吗', '说明了为什么两者常同时出现吗'],
  },

  /* ── 热学 ── */
  {
    id: 'thermo-basic',
    dimension: '热学',
    level: '基础',
    anchor: '第 12 章 · 理想气体状态方程',
    task: '2 mol 理想气体在 300 K、100 kPa 下体积是多少？再升温到 600 K（等压）体积变多少？',
    selfCheck: ['用了 pV = nRT 吗', '温度用开尔文吗', '等压时体积与温度成正比，说清了吗'],
  },
  {
    id: 'thermo-applied',
    dimension: '热学',
    level: '进阶',
    anchor: '第 12 章 · 热力学第一定律',
    task: '等温、等压、绝热三种过程各举一例，分别写出 Q、W、ΔU 的符号。',
    selfCheck: ['三个过程的符号都判对了吗', '等温为什么 ΔU = 0，说清了吗', '绝热为什么 Q = 0，说清了吗'],
  },
  {
    id: 'thermo-challenge',
    dimension: '热学',
    level: '挑战',
    anchor: '第 12 章 · 熵与不可逆',
    task: '两杯不同温度的水混合，求总熵变，并说明为什么这个过程不可逆。',
    selfCheck: ['用了 dS = mc ln(T₂/T₁) 且温度用开尔文吗', '总熵变为正算出来了吗', '「不可逆」是用熵增判据说的，不是用「做不到」说的'],
  },

  /* ── 实验（通用维度） ── */
  {
    id: 'lab-basic',
    dimension: '实验',
    level: '基础',
    anchor: '实验基础 · 误差与有效数字',
    task: '用米尺（最小分度 1 mm）测长度，记录结果时应保留几位小数？为什么？',
    selfCheck: ['估读到分度值的下一位了吗', '说明了「估读位」的含义吗', '没有把有效数字和 decimal 位数混为一谈吗'],
  },
  {
    id: 'lab-applied',
    dimension: '实验',
    level: '进阶',
    anchor: '实验基础 · 误差传递',
    task: '用单摆测 g，T 与 L 各有 1% 误差，g 的相对误差大约多少？说明哪一项更敏感。',
    selfCheck: ['用了 g ∝ L/T² 的幂次关系吗', 'T 的贡献是 L 的两倍，说到了吗', '结论是「优先改进计时」吗'],
  },
  {
    id: 'lab-challenge',
    dimension: '实验',
    level: '挑战',
    anchor: '实验基础 · 异常数据判据',
    task: '一组 10 个数据里有一个明显偏大，如何判断它是异常值而不是真实波动？给出判据与处置方式。',
    selfCheck: ['给了定量判据（如 3σ 或格拉布斯）吗', '说明了「不能随手删」吗', '处置方式写了「记录并说明」吗'],
  },
];

/**
 * 按层级与薄弱维度配练习。
 *
 * 排序规则：同层级优先 → 薄弱维度优先 → 保持题库原序（稳定，刷新不变）。
 * 不按「匹配分」排序：练习不像项目那样需要多目标权衡，可预测比"更聪明"重要。
 */
export function recommendExercises(input: {
  tier: AbilityTier;
  weakDimensions?: readonly DiagnosticDimension[];
  limit?: number;
}): Exercise[] {
  const { tier, weakDimensions = [], limit = 3 } = input;
  const target = EXERCISE_LEVEL_OF_TIER[tier];
  const weak = new Set(weakDimensions);
  return [...EXERCISES]
    .map((exercise, index) => ({
      exercise,
      index,
      sameLevel: exercise.level === target ? 1 : 0,
      hitWeak: weak.has(exercise.dimension) ? 1 : 0,
    }))
    .sort(
      (left, right) =>
        right.sameLevel - left.sameLevel ||
        right.hitWeak - left.hitWeak ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map((item) => item.exercise);
}

/** 配练习的理由（界面要能说清为什么是这三道）。 */
export function exerciseReason(exercise: Exercise, tier: AbilityTier): string {
  const target = EXERCISE_LEVEL_OF_TIER[tier];
  return exercise.level === target
    ? `与当前层级（${target}）对应的认知动作一致`
    : `同层题量不足，补一道${exercise.level}题保持手感`;
}
