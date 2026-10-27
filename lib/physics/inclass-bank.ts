/**
 * 课中「伴随诊断」题库与判定引擎。
 *
 * ## 这一层为什么是规则而不是大模型
 *
 * 申请书里写得很明确：「本课题研究不需要大模型平台和高成本的智能系统……
 * 通过轻量化的 AI 教学小助手」。课中环节真正要的是三件事：
 *
 * 1. **认出错在哪一类**（概念 / 单位 / 建模 / 答得太浅）；
 * 2. **生成一个能往下走的追问**；
 * 3. **给一份参考答案，但必须先经教师审核**。
 *
 * 这三件事都不需要生成式模型，需要的是**可解释、可复核、断网可用**的判定。
 * 规则引擎的每一次判定都带 `evidence`（引用学生原话），教师能一眼看出
 * 「AI 为什么这么判」——这正是申请书里「AI 建议 → 教师审核 → 学生认可」
 * 那条链路能成立的前提。生成式模型给一段漂亮话，教师反而无从复核。
 *
 * ## 判定的顺序是有讲究的
 *
 * 先看「概念错」（最严重、最容易带偏后续），再看「建模错」，然后才是
 * 「单位错」与「答得太浅」。顺序反过来的话，一个把机械能守恒记反的学生
 * 会被判成「单位没写」，追问也就跑到格式问题上去了。
 */

import type { DiagnosticDimension, InClassErrorKind } from './types';

/** 一道课中题。 */
export interface InClassQuestion {
  id: string;
  dimension: DiagnosticDimension;
  /** 知识锚点：对应章节与核心概念。 */
  anchor: string;
  prompt: string;
  /**
   * 概念性错误的触发片段。学生答案里出现这些，说明理解反了。
   *
   * 用「片段」而不是正则：题库要能被一线教师直接维护，
   * 让教师写正则等于把维护成本推给他们。
   */
  misconceptions: readonly { patterns: readonly string[]; note: string }[];
  /** 建模错误的触发片段（选错了物理模型/定律）。 */
  modelTraps?: readonly { patterns: readonly string[]; note: string }[];
  /** 参考答案必须覆盖的关键点，用来判断「答得太浅」。 */
  keyPoints: readonly string[];
  /** 期望出现的单位（正则片段）。答案里有数字却没有它 → 判单位错。 */
  expectsUnit?: string;
  /** 参考答案。**教师审核通过后**才对学生展开。 */
  reference: string;
  /** 按错误类型给出的追问。未覆盖的类型由 `defaultFollowUp` 兜底。 */
  followUps?: Partial<Record<InClassErrorKind, string>>;
}

/** 课中判定结果。 */
export interface InClassDiagnosis {
  errorKind: InClassErrorKind;
  /** 判定依据：引用学生原话或缺失的关键点。 */
  evidence: string;
  followUp: string;
  reference: string;
  anchor: string;
  /** 建议的下一步（比追问更进一步的动作）。 */
  nextStep: string;
}

/** 五个板块各 2 题，覆盖申请书里点名的力学、振动与波、电磁学、光学、热学。 */
export const INCLASS_QUESTIONS: readonly InClassQuestion[] = [
  {
    id: 'mech-1',
    dimension: '力学',
    anchor: '第 3 章 · 机械能守恒',
    prompt:
      '一个 2 kg 的滑块从 5 m 高的光滑斜面顶端由静止滑下（不计摩擦与空气阻力）。到达底端时速度是多少？请写出你的推理过程。',
    misconceptions: [
      {
        patterns: ['质量越大速度越大', '重的先到', '重的速度快'],
        note: '把「重力大」等同于「落地快」，忽略了重力加速度与质量无关。',
      },
      {
        patterns: ['速度不变', '匀速下滑'],
        note: '光滑斜面上合力沿斜面方向不为零，速度必然改变。',
      },
    ],
    modelTraps: [
      {
        patterns: ['动量守恒', '用冲量算'],
        note: '本题没有碰撞与相互作用，动量守恒不适用；应从能量角度入手。',
      },
    ],
    keyPoints: ['机械能守恒', '2gh', '9.9', '10'],
    expectsUnit: 'm/s|米/秒|米每秒',
    reference:
      '光滑斜面只有重力做功，机械能守恒：mgh = ½mv²。两边质量 m 约去，得 v = √(2gh) = √(2×9.8×5) ≈ 9.9 m/s。注意质量在等式两边同时出现，所以结果与质量无关——这也是「重的物体落得快」这一直觉错在哪里。',
    followUps: {
      concept:
        '先把问题换成：如果换成 20 kg 的滑块，底端速度会变吗？写出含 m 的式子，看 m 能不能被约掉。',
      model: '这道题里有没有发生碰撞、有没有需要用到「作用时间很短」的条件？如果没有，动量守恒这条路的出发点是什么？',
      incomplete: '你的答案里少了「为什么可以这样列式」这一步。说说看：从顶端到底端，哪些力做了功？',
      correct: '结论对了。再想一步：如果斜面有摩擦，你会在式子的哪一侧补上哪一项？',
    },
  },
  {
    id: 'mech-2',
    dimension: '力学',
    anchor: '第 2 章 · 牛顿运动定律与超重失重',
    prompt: '电梯以 2 m/s² 的加速度竖直向上加速。站在电梯里的人对地板的压力，比他的重力大还是小？为什么？',
    misconceptions: [
      {
        patterns: ['压力等于重力', '一样大', '不变'],
        note: '把「静止时的二力平衡」直接搬到加速情境，漏掉了合力不为零。',
      },
      {
        patterns: ['压力变小', '失重'],
        note: '向上加速对应超重；失重出现在向下加速或向上减速。',
      },
    ],
    keyPoints: ['超重', 'N-mg', 'ma', 'N 大于'],
    expectsUnit: 'N|牛',
    reference:
      '对人受力分析：地板支持力 N 向上，重力 mg 向下，合力向上，所以 N − mg = ma，得 N = m(g + a) > mg。地板对人的支持力与人对地板的压力是一对作用力与反作用力，大小相等，所以压力大于重力——这就是超重。',
    followUps: {
      concept: '静止时 N = mg 是因为合力为零。现在电梯在加速，合力还是零吗？先把合力方向写出来。',
      incomplete: '你说了结论，但没说依据。请把「对人做受力分析」这一步写出来：有哪几个力，方向如何？',
      correct: '如果电梯改为以 2 m/s² 减速上升，压力会怎样？用同一个式子推一遍。',
    },
  },
  {
    id: 'wave-1',
    dimension: '波动',
    anchor: '第 6 章 · 波速、波长与频率的关系',
    prompt: '一列声波从空气进入水中。它的频率、波长、波速分别怎么变化？说明理由。',
    misconceptions: [
      {
        patterns: ['频率变大', '频率改变', '频率变小'],
        note: '频率由波源决定，跨介质传播时不变——这是波动学最容易被记反的一条。',
      },
      { patterns: ['波长不变', '波长一样'], note: '波速变了而频率不变，由 v = λf 可知波长必然改变。' },
    ],
    keyPoints: ['频率不变', '波速变大', '波长变长', 'v=λf'],
    reference:
      '频率由波源决定，进入另一介质后**不变**；声波在水中的波速比空气中大（约 1500 m/s 对 340 m/s）；由 v = λf，f 不变而 v 变大，所以波长变长。',
    followUps: {
      concept: '频率是谁决定的——波源还是介质？先回答这一句，再用 v = λf 推波长。',
      incomplete: '三个量你只说了两个。补上第三个，并写出你用的关系式。',
      correct: '如果声波从水进入钢铁（波速更大），波长还会继续变长吗？用同一关系式判断。',
    },
  },
  {
    id: 'wave-2',
    dimension: '波动',
    anchor: '第 7 章 · 超声测距原理',
    prompt: '超声测距仪测得回波时间为 6 ms，声速取 340 m/s。计算障碍物距离，并解释公式里为什么要除以 2。',
    misconceptions: [
      { patterns: ['因为衰减', '因为损耗', '因为反射'], note: '除以 2 与能量衰减无关，是往返路程的问题。' },
    ],
    keyPoints: ['往返', '单程', '1.02', '1.0'],
    expectsUnit: 'm|米',
    reference:
      '声波从探头出发到障碍物再返回，走的是**两倍**单程距离：2s = v·t，所以 s = v·t/2 = 340 × 0.006 / 2 ≈ 1.02 m。除以 2 是把往返路程折成单程，与信号强弱无关。',
    followUps: {
      concept: '想象你对着墙喊一声：声音走过的总路程，是「你到墙」的几倍？',
      unit: '你的数值方向是对的，但请把单位带上——这道题的量纲能直接暴露有没有把 ms 当成 s。',
      incomplete: '只写结果不够。请把「总路程 = 速度 × 时间」和「单程 = 总路程 ÷ 2」两行都写出来。',
      correct: '如果温度升高使声速变成 350 m/s，同样的回波时间算出的距离会偏大还是偏小？',
    },
  },
  {
    id: 'em-1',
    dimension: '电磁学',
    anchor: '第 10 章 · 电磁感应与动生电动势',
    prompt: '一根长 0.5 m 的导体棒在 0.4 T 的匀强磁场中以 2 m/s 垂直切割磁感线。求感应电动势，并说明它与回路电阻有没有关系。',
    misconceptions: [
      { patterns: ['与电阻有关', '电阻越大电动势越大', '电阻影响电动势'], note: '把电动势与电流混淆：电阻影响电流，不影响电动势本身。' },
    ],
    modelTraps: [
      { patterns: ['楞次定律求大小', '用安培力'], note: '求电动势大小用 ε = BLv；楞次定律判方向，安培力是结果不是原因。' },
    ],
    keyPoints: ['BLv', '0.4', '0.4V', '0.4 V'],
    expectsUnit: 'V|伏',
    reference:
      '动生电动势 ε = BLv = 0.4 × 0.5 × 2 = 0.4 V。电动势由磁场、有效长度、速度决定，与回路电阻无关；电阻决定的是**电流** I = ε/R 与端电压。把两者混在一起，是这一章最常见的错误。',
    followUps: {
      concept: '电动势和电流是两个量。先问自己：如果回路断开（电阻无穷大），还有电动势吗？还有电流吗？',
      model: '题目问的是「电动势」还是「感应电流」？这两个量分别由哪个公式给出来？',
      unit: '请把单位补上。0.4 后面是 V 还是 A，直接对应你算的是电动势还是电流。',
      correct: '如果把导体棒的运动方向改成与磁场成 30°，电动势会变成多少？',
    },
  },
  {
    id: 'em-2',
    dimension: '电磁学',
    anchor: '第 9 章 · 电流的磁场与安培定则',
    prompt: '一根竖直向上的通电直导线，电流方向向上。它右侧某点的磁场方向指向哪里？你是怎么判断的？',
    misconceptions: [
      { patterns: ['右手定则判断力', '用左手', '洛伦兹力'], note: '安培定则（右手螺旋）判磁场方向，左手定则判安培力/洛伦兹力方向。' },
      { patterns: ['指向导线', '沿着导线'], note: '直导线周围的磁感线是以导线为轴的同心圆，与导线垂直。' },
    ],
    keyPoints: ['安培定则', '右手螺旋', '垂直纸面向里', '向里'],
    reference:
      '用安培定则（右手螺旋）：右手握住导线，拇指指向电流方向（向上），四指弯曲方向就是磁感线方向。在导线右侧，四指指向**垂直纸面向里**。磁感线是以导线为中心的同心圆，处处与导线垂直。',
    followUps: {
      concept: '先分清两件事：判断「磁场方向」用哪个定则？判断「受力方向」用哪个定则？',
      incomplete: '你说了方向，但没说用什么定则、怎么放的。请把「拇指指哪、四指绕向哪」写出来。',
      correct: '如果电流反向，右侧那点的磁场方向怎么变？',
    },
  },
  {
    id: 'optics-1',
    dimension: '光学',
    anchor: '第 12 章 · 双缝干涉',
    prompt: '双缝干涉实验中，相邻亮条纹间距与哪些物理量有关？增大双缝间距，条纹会变密还是变疏？',
    misconceptions: [
      { patterns: ['与光强有关', '与亮度有关'], note: '条纹间距由几何与波长决定，与光强无关；光强影响的是明暗对比。' },
      { patterns: ['与缝宽有关'], note: '双缝干涉的间距公式里是缝**间距** d，不是单缝缝宽。' },
    ],
    keyPoints: ['Δx', 'Lλ/d', '变密', '变窄'],
    reference:
      '条纹间距 Δx = Lλ/d（L 为缝到屏距离，λ 为波长，d 为双缝间距）。增大 d，Δx 变小，条纹变密。与光强无关——光强只改变条纹的明暗程度。',
    followUps: {
      concept: '把公式写出来：Δx 在分子还是分母？d 增大时分母变大，Δx 怎么变？',
      incomplete: '你只说了结论。请写出 Δx = Lλ/d，并指出哪个量在分母。',
      correct: '如果把光源从红光换成蓝光（波长更短），条纹间距怎么变？',
    },
  },
  {
    id: 'optics-2',
    dimension: '光学',
    anchor: '第 13 章 · 薄膜干涉与增透膜',
    prompt: '照相机镜头表面的增透膜，厚度为什么通常取光在膜中波长的 1/4？',
    misconceptions: [
      { patterns: ['为了吸收光', '涂层吸光', '折射率匹配就行'], note: '增透靠的是反射光干涉相消，不是吸收。' },
    ],
    keyPoints: ['干涉相消', '反射光', '半波长', '光程差'],
    reference:
      '膜上下表面各反射一束光，两束反射光发生干涉。膜厚取 λ/4 时，往返光程差为 λ/2（外加半波损失），两束反射光相位相反、干涉相消，反射光减弱，透射光增强——这就是增透。核心是**干涉相消**，不是吸收。',
    followUps: {
      concept: '增透膜让「反射光」变弱还是让「光被吸收」？先回答这一句。',
      incomplete: '请把「两束反射光的光程差」这一步写出来：光在膜里走了几倍膜厚？',
      correct: '如果膜厚变成 λ/2，反射光会增强还是减弱？',
    },
  },
  {
    id: 'thermo-1',
    dimension: '热学',
    anchor: '第 8 章 · 热力学第一定律',
    prompt: '一定量的理想气体被绝热压缩，温度为什么会升高？请用热力学第一定律解释。',
    misconceptions: [
      { patterns: ['因为体积变小所以温度高', '压得越紧越热'], note: '体积变小只是现象，要通过「外界做功 → 内能增加」这条链条解释。' },
      { patterns: ['吸收热量', '从外界吸热'], note: '绝热过程 Q = 0，没有热量交换。' },
    ],
    keyPoints: ['Q=0', '外界做功', '内能增加', '做功'],
    reference:
      '热力学第一定律 ΔU = Q + W。绝热过程 Q = 0，外界对气体做正功（W > 0），所以 ΔU > 0，内能增加；理想气体内能只由温度决定，故温度升高。链条是「外界做功 → 内能增加 → 温度升高」，而不是「体积小所以热」。',
    followUps: {
      concept: '绝热意味着 Q 等于多少？先把这个数写出来，再代进 ΔU = Q + W。',
      incomplete: '你说了温度升高，但没说中间那一步。请把「内能」补进因果链里。',
      correct: '如果是绝热**膨胀**，温度会怎么变？用同一个式子推。',
    },
  },
  {
    id: 'thermo-2',
    dimension: '热学',
    anchor: '第 9 章 · 热力学第二定律与热机效率',
    prompt: '有人设计了一台热机，从单一热源吸热并全部转化为功，效率 100%。这台机器能实现吗？为什么？',
    misconceptions: [
      { patterns: ['可以，只要材料好', '摩擦小就行', '技术够先进就行'], note: '限制来自第二定律，不是工艺水平。' },
    ],
    keyPoints: ['第二定律', '冷源', '放热', '不可能'],
    reference:
      '不能。热力学第二定律的开尔文表述：不可能从单一热源吸热使之完全变为功而不产生其他影响。实际热机必须在高温热源与低温冷源之间工作，必然向冷源放热，所以效率 η < 1。卡诺效率 η = 1 − T₂/T₁ 给出了上限，只有冷源温度趋近绝对零度时才趋近 100%，而绝对零度不可达到。',
    followUps: {
      concept: '热机工作时，除了高温热源，还必须有什么？少了它，熵增的要求怎么满足？',
      incomplete: '你说「不能」，但理由不充分。请写出卡诺效率表达式，并说明它为什么永远小于 1。',
      correct: '提高高温热源温度、降低冷源温度，效率会怎么变？现实中哪个更难做到？',
    },
  },
];

/** 按 id 取题。 */
export function getInClassQuestion(id: string): InClassQuestion | undefined {
  return INCLASS_QUESTIONS.find((item) => item.id === id);
}

/** 未显式给出追问时的兜底。 */
function defaultFollowUp(kind: InClassErrorKind, question: InClassQuestion): string {
  switch (kind) {
    case 'concept':
      return `先把这道题涉及的核心概念用自己的话说一遍（${question.anchor}），再回头看你的答案和它是否一致。`;
    case 'model':
      return '先判断这道题该用哪条物理定律：有没有碰撞？有没有能量转化？有没有磁场变化？选定模型再列式。';
    case 'unit':
      return '你的数量关系大致对了，但单位没写全。把每个物理量的单位标出来，量纲对不上的地方往往就是错的地方。';
    case 'incomplete':
      return '结论先放一边，把推理的每一步写出来：已知什么、要求什么、中间用哪条关系式连接。';
    default:
      return '结论成立。再往前一步：改变题目中的一个条件，结论还成立吗？';
  }
}

/** 建议的下一步动作。 */
function nextStepFor(kind: InClassErrorKind): string {
  switch (kind) {
    case 'concept':
      return '回到知识锚点，把概念的定义与适用条件各抄一遍，再重做本题。';
    case 'model':
      return '在草稿纸上先写「本题用什么定律、为什么」，再列式计算。';
    case 'unit':
      return '把所有中间结果补上单位，做一次量纲检查。';
    case 'incomplete':
      return '按「已知—关系式—代入—结果」四行格式重写一遍。';
    default:
      return '尝试改一个条件后重新求解，检验结论的稳健性。';
  }
}

/** 命中任一触发片段时返回该片段。 */
function firstMatch(
  text: string,
  groups: readonly { patterns: readonly string[]; note: string }[] | undefined,
): { pattern: string; note: string } | null {
  if (!groups) return null;
  for (const group of groups) {
    for (const pattern of group.patterns) {
      if (text.includes(pattern)) return { pattern, note: group.note };
    }
  }
  return null;
}

/**
 * 判定一次课中作答。
 *
 * 顺序：概念 → 建模 → 单位 → 太浅 → 正确。顺序理由见文件头注释。
 */
export function diagnoseInClassAnswer(
  question: InClassQuestion,
  answer: string,
): InClassDiagnosis {
  const text = String(answer ?? '').trim();
  const base = {
    reference: question.reference,
    anchor: question.anchor,
  };

  if (text.length < 6) {
    const kind: InClassErrorKind = 'incomplete';
    return {
      ...base,
      errorKind: kind,
      evidence: '答案过短，无法判断思路。',
      followUp: question.followUps?.incomplete ?? defaultFollowUp(kind, question),
      nextStep: nextStepFor(kind),
    };
  }

  const concept = firstMatch(text, question.misconceptions);
  if (concept) {
    const kind: InClassErrorKind = 'concept';
    return {
      ...base,
      errorKind: kind,
      evidence: `你的答案里出现了「${concept.pattern}」——${concept.note}`,
      followUp: question.followUps?.concept ?? defaultFollowUp(kind, question),
      nextStep: nextStepFor(kind),
    };
  }

  const model = firstMatch(text, question.modelTraps);
  if (model) {
    const kind: InClassErrorKind = 'model';
    return {
      ...base,
      errorKind: kind,
      evidence: `你选用的方法是「${model.pattern}」——${model.note}`,
      followUp: question.followUps?.model ?? defaultFollowUp(kind, question),
      nextStep: nextStepFor(kind),
    };
  }

  // 有数字却没有任何单位痕迹 → 单位/量纲问题。
  if (question.expectsUnit && /\d/.test(text) && !new RegExp(question.expectsUnit).test(text)) {
    const kind: InClassErrorKind = 'unit';
    return {
      ...base,
      errorKind: kind,
      evidence: '答案里出现了数值，但没有给出单位，无法确认量纲是否正确。',
      followUp: question.followUps?.unit ?? defaultFollowUp(kind, question),
      nextStep: nextStepFor(kind),
    };
  }

  const hits = question.keyPoints.filter((point) => text.includes(point));
  if (hits.length === 0) {
    const kind: InClassErrorKind = 'incomplete';
    return {
      ...base,
      errorKind: kind,
      evidence: `没有覆盖到本题的关键点（${question.keyPoints.slice(0, 2).join('、')}…）。`,
      followUp: question.followUps?.incomplete ?? defaultFollowUp(kind, question),
      nextStep: nextStepFor(kind),
    };
  }

  return {
    ...base,
    errorKind: 'correct',
    evidence: `命中关键点：${hits.join('、')}。`,
    followUp: question.followUps?.correct ?? defaultFollowUp('correct', question),
    nextStep: nextStepFor('correct'),
  };
}

/** 错误类型的展示名与配色语义。 */
export const INCLASS_ERROR_LABELS: Readonly<Record<InClassErrorKind, string>> = {
  concept: '概念性错误',
  unit: '单位/量纲',
  model: '模型选择',
  incomplete: '思路不完整',
  correct: '未发现明显错误',
};
