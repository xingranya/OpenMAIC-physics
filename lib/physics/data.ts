import type {
  ChapterMapping,
  DemoAccount,
  DemoStudentSnapshot,
  DiagnosticDimension,
  KnowledgeNode,
  LearningStyle,
  LearningTarget,
  Project,
  QuizQuestion,
  TaskTemplate,
  TeacherProfile,
  StudentProfile,
  TeachingPlan,
} from "./types";

/** 登录账号统一使用该密码，正式环境不得复用。 */
export const PHYSICS_AI_PASSWORD = "dunzhongwan";
export const DEMO_PASSWORD = PHYSICS_AI_PASSWORD;

const DEMO_STUDENT_PROFILE: StudentProfile = {
  name: "陈思远",
  id: "20260001",
  major: "物理学",
  className: "物理学 2601 班",
  style: "practice",
  target: "application",
};

const DEMO_TEACHER_PROFILE: TeacherProfile = {
  name: "顿老师",
  id: "teacher-001",
  department: "大学物理教研组",
};

/** 内置登录账号，仅用于当前产品的账号校验。 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    username: "student",
    password: PHYSICS_AI_PASSWORD,
    role: "student",
    displayName: "陈思远",
    profile: DEMO_STUDENT_PROFILE,
  },
  {
    username: "teacher",
    password: PHYSICS_AI_PASSWORD,
    role: "teacher",
    displayName: "顿老师",
    profile: DEMO_TEACHER_PROFILE,
  },
];

export const STUDENT_ACCOUNT = DEMO_ACCOUNTS[0];
export const TEACHER_ACCOUNT = DEMO_ACCOUNTS[1];
export const STUDENT_DEMO_ACCOUNT = STUDENT_ACCOUNT;
export const TEACHER_DEMO_ACCOUNT = TEACHER_ACCOUNT;

/** 课前诊断题，答案索引从 0 开始。 */
export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: "circular-velocity",
    question: "匀速圆周运动中，物体的哪一物理量始终改变？",
    options: ["速率", "速度方向", "质量", "周期"],
    correctIndex: 1,
    dimension: "力学",
    q: "匀速圆周运动中，物体的哪一物理量始终改变？",
    opts: ["速率", "速度方向", "质量", "周期"],
    a: 1,
    dim: "力学",
  },
  {
    id: "ultrasonic-reflection",
    question: "超声波遇到障碍物后返回，主要利用什么现象？",
    options: ["反射", "折射", "色散", "干涉"],
    correctIndex: 0,
    dimension: "波动",
    q: "超声波遇到障碍物后返回，主要利用什么现象？",
    opts: ["反射", "折射", "色散", "干涉"],
    a: 0,
    dim: "波动",
  },
  {
    id: "wireless-mechanism",
    question: "无线能量传输装置的关键物理机制是？",
    options: ["电磁感应与谐振", "热传导", "光电效应", "布朗运动"],
    correctIndex: 0,
    dimension: "电磁学",
    q: "无线能量传输装置的关键物理机制是？",
    opts: ["电磁感应与谐振", "热传导", "光电效应", "布朗运动"],
    a: 0,
    dim: "电磁学",
  },
  {
    id: "thin-lens",
    question: "凸透镜成清晰实像时，物距、像距和焦距满足？",
    options: ["薄透镜成像关系", "欧姆定律", "动量守恒", "波速关系"],
    correctIndex: 0,
    dimension: "光学",
    q: "凸透镜成清晰实像时，物距、像距和焦距满足？",
    opts: ["薄透镜成像关系", "欧姆定律", "动量守恒", "波速关系"],
    a: 0,
    dim: "光学",
  },
  {
    id: "repeat-measurement",
    question: "多次测量同一物理量，主要为了？",
    options: ["消除一切误差", "减小随机误差影响", "改变理论值", "使结果完全相同"],
    correctIndex: 1,
    dimension: "实验",
    q: "多次测量同一物理量，主要为了？",
    opts: ["消除一切误差", "减小随机误差影响", "改变理论值", "使结果完全相同"],
    a: 1,
    dim: "实验",
  },
  {
    id: "error-analysis",
    question: "实验数据与理论偏差较大，第一步应该？",
    options: ["删除数据", "分析条件和误差来源", "修改理论", "停止实验"],
    correctIndex: 1,
    dimension: "实验",
    q: "实验数据与理论偏差较大，第一步应该？",
    opts: ["删除数据", "分析条件和误差来源", "修改理论", "停止实验"],
    a: 1,
    dim: "实验",
  },
  {
    id: "energy-conservation",
    question: "机械能守恒需要重点考察？",
    options: ["系统是否存在非保守力做功", "物体颜色", "温度单位", "坐标原点"],
    correctIndex: 0,
    dimension: "力学",
    q: "机械能守恒需要重点考察？",
    opts: ["系统是否存在非保守力做功", "物体颜色", "温度单位", "坐标原点"],
    a: 0,
    dim: "力学",
  },
  {
    id: "wave-relation",
    question: "波速 v、频率 f 和波长 λ 的关系是？",
    options: ["v=fλ", "v=f/λ", "v=λ/f", "v=f+λ"],
    correctIndex: 0,
    dimension: "波动",
    q: "波速v、频率f和波长λ的关系是？",
    opts: ["v=fλ", "v=f/λ", "v=λ/f", "v=f+λ"],
    a: 0,
    dim: "波动",
  },
];

/** 知识图谱节点的课程内容。 */
export const KNOWLEDGE_NODES: readonly KnowledgeNode[] = [
  {
    id: "core",
    title: "大学物理知识核心",
    description: "六大知识模块共同支撑真实问题解决。推荐从学情诊断薄弱点进入相应模块。",
    recommendations: "综合知识图谱、四阶能力图谱、项目案例库",
  },
  {
    id: "mechanics",
    title: "力学",
    description: "研究物体运动规律、力与运动、能量和动量。",
    recommendations: "过山车故障监测、重力加速度测量、康复手套",
  },
  {
    id: "thermal",
    title: "热学",
    description: "研究热运动、热传递和能量转换。",
    recommendations: "太阳能热水器效率优化、光热转换系统",
  },
  {
    id: "em",
    title: "电磁学",
    description: "研究电场、磁场、电路、电磁感应和电磁波。",
    recommendations: "无线能量传输、电机节能、磁探伤",
  },
  {
    id: "wave",
    title: "波动",
    description: "研究振动、机械波、声学传播、反射与衰减。",
    recommendations: "智能导盲眼镜、电缆损伤检测",
  },
  {
    id: "optics",
    title: "光学",
    description: "研究几何光学、干涉衍射和光电探测。",
    recommendations: "智能对焦系统、迈克尔逊干涉仪计数",
  },
  {
    id: "modern",
    title: "近代物理",
    description: "研究量子、原子、相对论及现代技术基础。",
    recommendations: "光电效应测量、传感器与量子实验",
  },
  {
    id: "newton",
    title: "牛顿运动定律",
    description: "从受力分析建立运动模型，是力学项目建模的基础。",
    recommendations: "过山车监测、机械装置动力学",
  },
  {
    id: "energy",
    title: "能量守恒",
    description: "分析系统能量输入、转化、损耗与效率。",
    recommendations: "太阳能、无线传能、机械系统",
  },
  {
    id: "induction",
    title: "电磁感应",
    description: "磁通量变化产生感应电动势，是无线传能与传感的基础。",
    recommendations: "无线充电、漏磁检测",
  },
  {
    id: "circuit",
    title: "电路",
    description: "通过电压、电流、电阻和功率描述电气系统。",
    recommendations: "传感器采集、微弱信号测量",
  },
  {
    id: "sound",
    title: "机械波",
    description: "波由振动传播，涉及波速、频率、波长、反射与衰减。",
    recommendations: "超声导盲、电缆检测",
  },
  {
    id: "resonance",
    title: "共振",
    description: "外驱频率接近固有频率时响应增强。",
    recommendations: "无线传能、振动测试",
  },
  {
    id: "quantum",
    title: "量子",
    description: "微观系统的能量量子化与概率描述。",
    recommendations: "光电效应、量子传感",
  },
  {
    id: "relativity",
    title: "相对论",
    description: "研究高速运动和时空结构。",
    recommendations: "现代物理拓展学习",
  },
];

/** 项目案例库。 */
export const PROJECTS: readonly Project[] = [
  {
    id: "guide",
    title: "基于超声波与 AI 识别的智能导盲眼镜",
    level: "中等",
    dims: ["波动", "实验"],
    styles: ["practice", "visual"],
    targets: ["application", "innovation"],
    intro: "从超声波传播、反射与时间差测距出发，完成避障装置建模、算法设计、实验标定和场景测试。",
    ability: "知识理解→专业应用→创新实践→团队协作",
  },
  {
    id: "cable",
    title: "基于超声波衰减规律的电缆损伤检测",
    level: "较高",
    dims: ["波动", "实验"],
    styles: ["practice", "reading"],
    targets: ["application", "innovation"],
    intro: "利用传播、衰减和缺陷散射规律，建立损伤特征与检测信号之间的联系。",
    ability: "概念迁移→数据分析→方案优化→成果表达",
  },
  {
    id: "wireless",
    title: "LCC-S 强抗偏移型无线能量传输系统",
    level: "较高",
    dims: ["电磁学", "实验"],
    styles: ["practice", "discussion"],
    targets: ["innovation", "collaboration"],
    intro: "探究电磁感应、谐振耦合、线圈偏移和传输效率，设计抗偏移优化方案。",
    ability: "电磁建模→实验验证→系统优化→协同攻关",
  },
  {
    id: "gravity",
    title: "基于微小电场与 AI 模块的重力加速度测量",
    level: "基础",
    dims: ["力学", "实验"],
    styles: ["visual", "practice"],
    targets: ["concept", "application"],
    intro: "利用传感器采集运动数据，通过图像拟合和误差分析测量重力加速度。",
    ability: "规律理解→数据处理→测量改进→科学表达",
  },
  {
    id: "optical",
    title: "迈克尔逊干涉仪智能计数与测量",
    level: "中等",
    dims: ["光学", "实验"],
    styles: ["visual", "practice"],
    targets: ["application", "innovation"],
    intro: "研究干涉条纹、光程差与计数算法，将光学实验与智能识别结合。",
    ability: "光学理解→实验操作→算法融合→成果展示",
  },
  {
    id: "pressure",
    title: "基于光纤微齿模型的弱小压力测量",
    level: "较高",
    dims: ["光学", "实验"],
    styles: ["reading", "practice"],
    targets: ["innovation", "collaboration"],
    intro: "利用光纤传播与微小形变建立压力—信号标定关系，开展弱信号处理。",
    ability: "传感原理→标定建模→灵敏度优化→团队协作",
  },
  {
    id: "motion",
    title: "基于手机传感器的运动轨迹与制动距离分析",
    level: "基础",
    dims: ["力学", "实验"],
    styles: ["visual", "practice"],
    targets: ["concept", "application"],
    intro: "利用手机加速度、速度和位置信息研究直线运动、变速运动与安全制动距离。",
    ability: "运动描述→图像分析→模型验证→安全建议",
  },
  {
    id: "coaster",
    title: "过山车安全运行与向心力监测系统",
    level: "中等",
    dims: ["力学", "实验"],
    styles: ["practice", "discussion"],
    targets: ["application", "innovation"],
    intro: "围绕牛顿定律、圆周运动和向心力，建立过山车关键位置的安全监测模型。",
    ability: "受力分析→动力学建模→监测设计→风险论证",
  },
  {
    id: "solar",
    title: "太阳能光热转换效率优化系统",
    level: "中等",
    dims: ["热学", "实验"],
    styles: ["practice", "visual"],
    targets: ["application", "innovation"],
    intro: "从功、能量守恒、热传递和效率出发，研究吸热结构与保温方案对系统性能的影响。",
    ability: "能量分析→效率测量→结构优化→成果表达",
  },
  {
    id: "collision",
    title: "智能小车碰撞与动量守恒验证",
    level: "基础",
    dims: ["力学", "实验"],
    styles: ["practice", "visual"],
    targets: ["concept", "application"],
    intro: "通过视频或传感器采集碰撞前后速度，验证动量守恒并比较弹性与非弹性碰撞。",
    ability: "动量理解→数据采集→守恒检验→误差反思",
  },
  {
    id: "rotation",
    title: "旋转机械转动惯量与故障振动监测",
    level: "较高",
    dims: ["力学", "实验"],
    styles: ["practice", "reading"],
    targets: ["application", "innovation"],
    intro: "研究转矩、角动量和转动惯量，并利用振动数据识别旋转机械异常。",
    ability: "转动建模→参数测量→故障识别→系统改进",
  },
  {
    id: "vibration",
    title: "结构振动监测与阻尼减振设计",
    level: "中等",
    dims: ["波动", "实验"],
    styles: ["practice", "visual"],
    targets: ["application", "innovation"],
    intro: "研究简谐振动、阻尼和共振，设计结构减振或共振预警方案。",
    ability: "振动规律→参数拟合→减振设计→工程评价",
  },
  {
    id: "gas",
    title: "气体状态参数智能采集与规律拟合",
    level: "基础",
    dims: ["热学", "实验"],
    styles: ["practice", "reading"],
    targets: ["concept", "application"],
    intro: "采集压强、体积和温度数据，检验气体状态规律并分析模型适用条件。",
    ability: "微观认识→参数测量→规律拟合→模型边界",
  },
  {
    id: "thermos",
    title: "智能保温容器热损失监测与优化",
    level: "中等",
    dims: ["热学", "实验"],
    styles: ["practice", "visual"],
    targets: ["application", "innovation"],
    intro: "利用温度传感器记录冷却曲线，分析传导、对流和辐射造成的热损失。",
    ability: "热过程分析→曲线拟合→保温优化→节能评价",
  },
  {
    id: "electrostatic",
    title: "静电除尘效率与电场分布优化",
    level: "较高",
    dims: ["电磁学", "实验"],
    styles: ["visual", "practice"],
    targets: ["application", "innovation"],
    intro: "从电场、电势和带电粒子运动出发，研究电极结构对静电除尘效率的影响。",
    ability: "电场理解→粒子建模→结构优化→环境应用",
  },
  {
    id: "circuitAI",
    title: "微弱电信号采集与智能电工手套",
    level: "中等",
    dims: ["电磁学", "实验"],
    styles: ["practice", "discussion"],
    targets: ["application", "innovation"],
    intro: "围绕电流、电阻、功率和传感电路，完成微弱信号采集、放大与安全预警。",
    ability: "电路分析→信号采集→功能集成→安全论证",
  },
  {
    id: "magnetic",
    title: "基于漏磁效应的钢材损伤智能检测",
    level: "较高",
    dims: ["电磁学", "实验"],
    styles: ["practice", "reading"],
    targets: ["application", "innovation"],
    intro: "利用磁场、磁化与漏磁规律识别钢材缺陷，开展对照实验和灵敏度评价。",
    ability: "磁场建模→特征提取→损伤识别→工程验证",
  },
  {
    id: "autofocus",
    title: "基于计算光学的智能仿生对焦系统",
    level: "中等",
    dims: ["光学", "实验"],
    styles: ["visual", "practice"],
    targets: ["application", "innovation"],
    intro: "利用薄透镜成像和清晰度评价，设计自动搜索最佳像面位置的对焦系统。",
    ability: "成像理解→清晰度测量→算法对焦→系统展示",
  },
  {
    id: "photoelectric",
    title: "光电效应参数测量与智能数据拟合",
    level: "中等",
    dims: ["近代物理", "实验"],
    styles: ["visual", "reading"],
    targets: ["concept", "application"],
    intro: "测量截止电压与光频率关系，理解光量子理论并使用数据拟合估算普朗克常量。",
    ability: "量子理解→实验测量→参数拟合→科学论证",
  },
  {
    id: "gps",
    title: "GPS 定位中的相对论时间修正建模",
    level: "较高",
    dims: ["近代物理", "力学"],
    styles: ["reading", "discussion"],
    targets: ["application", "innovation"],
    intro: "通过数量级估算理解高速运动和引力场对卫星钟的影响，建立科普计算模型。",
    ability: "理论理解→数量级估算→系统建模→跨域表达",
  },
];

/** 教材章节与项目案例的静态映射。 */
export const CHAPTER_MAPPINGS: readonly ChapterMapping[] = [
  { no: 1, volume: "上册", module: "力学", title: "绪论、物理量测量与误差", concepts: ["有效数字", "测量不确定度", "数据拟合"], primary: "gravity", alternatives: ["motion"], difficulty: "基础", hours: "2+2", output: "测量报告、误差分析表", ability: "规范测量→数据处理→方案改进→科学表达", status: "成熟案例" },
  { no: 2, volume: "上册", module: "力学", title: "质点运动学", concepts: ["位移与速度", "加速度", "运动图像"], primary: "motion", alternatives: ["gravity"], difficulty: "基础", hours: "4+2", output: "运动数据图、制动模型", ability: "描述运动→图像分析→模型验证→安全建议", status: "成熟案例" },
  { no: 3, volume: "上册", module: "力学", title: "牛顿运动定律与圆周运动", concepts: ["受力分析", "牛顿第二定律", "向心力"], primary: "coaster", alternatives: ["motion"], difficulty: "中等", hours: "6+3", output: "受力模型、安全阈值方案", ability: "概念解释→动力学建模→监测设计→风险论证", status: "成熟案例" },
  { no: 4, volume: "上册", module: "力学", title: "功、能和机械能守恒", concepts: ["功与功率", "动能定理", "能量守恒"], primary: "solar", alternatives: ["coaster"], difficulty: "中等", hours: "5+3", output: "能量流图、效率优化报告", ability: "能量识别→效率测量→结构优化→成果表达", status: "重点建设" },
  { no: 5, volume: "上册", module: "力学", title: "动量、冲量与碰撞", concepts: ["动量定理", "动量守恒", "碰撞类型"], primary: "collision", alternatives: ["coaster"], difficulty: "基础", hours: "4+2", output: "碰撞视频、守恒验证表", ability: "守恒理解→数据采集→模型检验→误差反思", status: "成熟案例" },
  { no: 6, volume: "上册", module: "力学", title: "刚体转动", concepts: ["转矩", "转动惯量", "角动量"], primary: "rotation", alternatives: ["vibration"], difficulty: "较高", hours: "6+4", output: "转动惯量测量、故障特征图", ability: "转动建模→参数测量→故障识别→系统改进", status: "重点建设" },
  { no: 7, volume: "上册", module: "振动与波", title: "机械振动", concepts: ["简谐振动", "阻尼振动", "受迫振动与共振"], primary: "vibration", alternatives: ["rotation"], difficulty: "中等", hours: "5+3", output: "振动曲线、减振设计", ability: "规律理解→参数拟合→方案设计→工程评价", status: "成熟案例" },
  { no: 8, volume: "上册", module: "振动与波", title: "机械波与声学", concepts: ["波速与波长", "反射与衰减", "多普勒效应"], primary: "guide", alternatives: ["cable"], difficulty: "中等", hours: "6+4", output: "测距装置、衰减实验报告", ability: "波动理解→传感应用→装置创新→协同验证", status: "成熟案例" },
  { no: 9, volume: "上册", module: "热学", title: "气体动理论", concepts: ["理想气体", "微观统计", "状态方程"], primary: "gas", alternatives: ["thermos"], difficulty: "基础", hours: "4+2", output: "P-V-T 数据集、规律拟合", ability: "微观理解→参数测量→规律拟合→模型边界", status: "拓展案例" },
  { no: 10, volume: "上册", module: "热学", title: "热力学基础", concepts: ["热力学第一定律", "热传递", "循环与效率"], primary: "thermos", alternatives: ["solar"], difficulty: "中等", hours: "6+3", output: "冷却曲线、保温优化方案", ability: "热过程分析→能量计算→节能优化→社会应用", status: "重点建设" },
  { no: 11, volume: "下册", module: "电磁学", title: "静电场", concepts: ["库仑定律", "电场强度", "电势"], primary: "electrostatic", alternatives: ["circuitAI"], difficulty: "较高", hours: "6+3", output: "电场分布图、除尘效率方案", ability: "电场理解→粒子建模→结构优化→环境应用", status: "重点建设" },
  { no: 12, volume: "下册", module: "电磁学", title: "稳恒电流与电路", concepts: ["欧姆定律", "基尔霍夫定律", "电功率"], primary: "circuitAI", alternatives: ["pressure"], difficulty: "中等", hours: "6+4", output: "采集电路、预警功能验证", ability: "电路分析→信号采集→系统集成→安全论证", status: "成熟案例" },
  { no: 13, volume: "下册", module: "电磁学", title: "稳恒磁场", concepts: ["磁感应强度", "安培力", "磁介质"], primary: "magnetic", alternatives: ["wireless"], difficulty: "较高", hours: "5+4", output: "漏磁数据、损伤识别模型", ability: "磁场建模→特征提取→损伤识别→工程验证", status: "成熟案例" },
  { no: 14, volume: "下册", module: "电磁学", title: "电磁感应与电磁场", concepts: ["法拉第定律", "自感互感", "电磁振荡"], primary: "wireless", alternatives: ["magnetic"], difficulty: "较高", hours: "7+5", output: "无线传能样机、效率曲线", ability: "感应理解→谐振建模→系统优化→团队攻关", status: "成熟案例" },
  { no: 15, volume: "下册", module: "光学", title: "几何光学与光学仪器", concepts: ["反射折射", "薄透镜成像", "光学系统"], primary: "autofocus", alternatives: ["optical"], difficulty: "中等", hours: "5+3", output: "自动对焦程序、清晰度曲线", ability: "成像理解→光路设计→算法融合→系统展示", status: "重点建设" },
  { no: 16, volume: "下册", module: "光学", title: "波动光学", concepts: ["干涉", "衍射", "偏振"], primary: "optical", alternatives: ["pressure"], difficulty: "中等", hours: "6+4", output: "条纹计数系统、测量报告", ability: "相位理解→实验操作→智能识别→成果展示", status: "成熟案例" },
  { no: 17, volume: "下册", module: "近代物理", title: "量子物理基础", concepts: ["光电效应", "德布罗意波", "量子化"], primary: "photoelectric", alternatives: ["pressure"], difficulty: "中等", hours: "5+3", output: "截止电压曲线、普朗克常量拟合", ability: "量子理解→实验测量→参数拟合→科学论证", status: "拓展案例" },
  { no: 18, volume: "下册", module: "近代物理", title: "相对论与现代物理拓展", concepts: ["时空观", "时间膨胀", "质能关系"], primary: "gps", alternatives: ["photoelectric"], difficulty: "较高", hours: "4+2", output: "时间修正模型、科普展示", ability: "理论理解→数量级估算→跨域建模→公众表达", status: "拓展案例" },
];

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  { id: "context", name: "第一关：情境认知", ability: "知识理解", goal: "识别真实问题中的物理对象、变量和核心规律。", checks: ["完成项目背景阅读", "绘制物理问题结构图", "列出至少 3 个关键物理量"], prompt: "不要急于给出方案，先说明：系统中发生了什么物理过程？哪些量可测？" },
  { id: "model", name: "第二关：原理建模", ability: "专业应用", goal: "建立可计算、可检验的物理模型。", checks: ["写出核心物理关系", "说明模型假设", "确定自变量、因变量和控制变量"], prompt: "检查模型边界：哪些条件成立时公式才适用？" },
  { id: "design", name: "第三关：方案设计", ability: "创新实践", goal: "形成包含硬件、算法、实验和评价指标的方案。", checks: ["提交方案框图", "比较两种可行方案", "确定实验评价指标"], prompt: "比较方案时至少考虑准确性、成本、可实现性和安全性。" },
  { id: "experiment", name: "第四关：实验验证", ability: "创新实践", goal: "采集数据、分析误差并迭代方案。", checks: ["完成不少于 5 组数据", "计算误差或不确定度", "根据数据完成一次方案修改"], prompt: "让数据说话：你的改进是否真的使指标变好？" },
  { id: "collaboration", name: "第五关：协同创生", ability: "团队协作", goal: "完成作品、汇报答辩和成果反思。", checks: ["完成团队分工记录", "提交作品或成果视频", "完成答辩与个人反思"], prompt: "区分个人贡献与团队成果，并说明下一轮迭代方向。" },
];

export const DEMO_STUDENTS: readonly DemoStudentSnapshot[] = [
  { name: "张同学", score: 86, weakDimension: "波动", project: "智能导盲眼镜", progress: 72, risk: "正常" },
  { name: "李同学", score: 58, weakDimension: "电磁学", project: "无线能量传输", progress: 35, risk: "高风险" },
  { name: "王同学", score: 74, weakDimension: "光学", project: "干涉仪智能计数", progress: 61, risk: "关注" },
  { name: "赵同学", score: 91, weakDimension: "实验", project: "弱小压力测量", progress: 84, risk: "优秀" },
  { name: "陈同学", score: 67, weakDimension: "力学", project: "重力加速度测量", progress: 48, risk: "关注" },
  { name: "刘同学", score: 82, weakDimension: "波动", project: "电缆损伤检测", progress: 77, risk: "正常" },
];

export const TEACHING_PLANS: readonly TeachingPlan[] = [
  { id: "wave-support", title: "机械波模块", content: "机械波模块前测显示“波速—振动速度”混淆率较高。建议课前推送波动可视化卡片；课中用导盲眼镜测距情境追问“传播的是物质还是能量”；课后安排声速变化对测距误差的虚拟实验。" },
  { id: "em-staging", title: "电磁学项目组", content: "电磁学项目组差异较大。建议将无线能量传输任务分为基础组“验证谐振”、进阶组“研究偏移”、挑战组“设计自适应调谐”，并设置统一的效率评价指标。" },
  { id: "optics-ai", title: "光学模块", content: "光学模块可采用“迈克尔逊干涉仪智能计数”案例串联干涉条件、条纹变化、数据采集和算法识别。建议增加一次人工计数与 AI 计数的对照验证，培养批判性使用 AI 的习惯。" },
];

export const LEARNING_STYLE_LABELS: Readonly<Record<LearningStyle, string>> = {
  practice: "实验操作与项目实践",
  visual: "图像动画与观察",
  discussion: "小组讨论与合作探究",
  reading: "资料阅读与独立推导",
};

export const LEARNING_TARGET_LABELS: Readonly<Record<LearningTarget, string>> = {
  concept: "知识理解",
  application: "专业应用",
  innovation: "创新实践",
  collaboration: "协同创生",
};

export const DIAGNOSTIC_DIMENSIONS: readonly DiagnosticDimension[] = ["力学", "波动", "热学", "电磁学", "光学", "近代物理", "实验"];

export function getProjectById(id: string | null | undefined): Project | undefined {
  return PROJECTS.find((project) => project.id === id);
}

export const projectById = getProjectById;

export function getKnowledgeNodeById(id: string | null | undefined): KnowledgeNode | undefined {
  return KNOWLEDGE_NODES.find((node) => node.id === id);
}

export function getChapterByNumber(no: number): ChapterMapping | undefined {
  return CHAPTER_MAPPINGS.find((chapter) => chapter.no === no);
}
