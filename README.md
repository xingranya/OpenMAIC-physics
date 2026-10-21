# 大学物理 AI 智慧课堂

**长江大学文理学院 · 《大学物理》课程智慧教学工作台**

一个从登录到功能完整、可现场演示、可部署到腾讯云 EdgeOne Pages 的教学成品。
基于清华大学开源项目 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 二次开发。

---

## 这是什么

平台由两个能力域组成，共用一套账号、导航与品牌：

| 能力域 | 内容 |
| --- | --- |
| **AI 智能课堂** | 一键生成课件 + 测验 + 交互仿真 + 项目式学习；多智能体授课、白板演算、课堂讨论与圆桌辩论；导出 PPTX / 离线 HTML / 课堂 ZIP |
| **物理学习工作台** | 学生 8 视图（学情诊断 → 项目匹配 → 任务闯关 → 虚拟实验 → 学习报告）；教师 5 视图（驾驶舱 / 班级画像 / 课程矩阵 / 评价复核 / 教学洞察） |

两域互通：诊断维度得分决定 AI 课堂的讲解深度与推荐项目；AI 课堂的测验与讨论记录
回流为学习报告的"过程证据"。

### 三条产品原则

1. **过程证据 > 最终分数** —— 报告汇总的是每一步留下了什么，分数只是其中一项。
2. **破坏性动作必须可逆** —— 重置记录 / 重新诊断 / 切换项目都有二次确认 + 24 小时可恢复快照。
3. **教师保留最终判断权** —— AI 只产出建议分与理由，教师复核结果始终覆盖之，界面常驻可见。

---

## 快速开始

### 本地开发

```bash
# 依赖：Node.js >= 22.19（推荐 24.x），pnpm >= 10
pnpm install
pnpm build:packages     # 构建 8 个工作区包
pnpm dev                # http://localhost:3000
```

### 质量门槛

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
pnpm test        # Vitest（含物理域 19 个用例）
pnpm build       # Next.js 生产构建
```

### 演示账号

| 账号 | 角色 | 密码 |
| --- | --- | --- |
| `student` | 学生（物理学 2601 班） | `dunzhongwan` |
| `teacher` | 教师 | `dunzhongwan` |

账号仅用于当前产品的登录校验，**不连接真实教务系统、统一身份认证或大模型**。

---

## 部署

目标平台：**腾讯云 EdgeOne Pages（EdgeOne Makers）**，无状态边缘运行时，**无需数据库**。

- 部署手册：[`deploy/README.md`](deploy/README.md)
- 验收清单：[`deploy/deploy-checklist.md`](deploy/deploy-checklist.md)
- 环境变量模板：[`deploy/edgeone.env.example`](deploy/edgeone.env.example)

关键三点：

1. **Node 版本必须选 24.5.0** —— EdgeOne 可选 22.11.0 / 22.17.1 / 24.5.0，
   而 OpenMAIC 要求 `node >= 22.19.0`，前两个不满足。
2. **构建命令**：`pnpm build:packages && pnpm build`
3. **必配环境变量**：`DEFAULT_MODEL` + 至少一个 `*_API_KEY` + `ACCESS_CODE`（≥16 位随机）

> 无模型额度或现场断网时仍可完整演示：首页「离线课堂包」提供 6 个物理章节的
> 预置课堂（讲演页 + 测验 + 自包含交互仿真），零配额、零网络可导入播放与导出。

---

## 目录结构

```
OpenMAIC-physics/
├── app/
│   ├── page.tsx                 # AI 智能课堂首页（含物理学习门户）
│   ├── classroom/[id]/          # AI 课堂播放
│   ├── physics/[view]/          # 学生端 8 视图
│   ├── teacher/[view]/          # 教师端 5 视图
│   └── login/                   # 工作台登录
├── components/
│   ├── physics/                 # 工作台外壳、登录、命令面板、13 个视图
│   └── portal/                  # 首页物理门户
├── lib/
│   ├── physics/                 # 物理教学域（纯函数，零 React / 零 DOM）
│   │   ├── types.ts data.ts engine.ts report.ts local-store.ts
│   │   ├── prompts/             # 物理领域约束（注入生成管线）
│   │   ├── presets/             # 预置课堂包
│   │   ├── session.ts undo.ts shortcuts.ts use-shortcuts.ts
│   ├── school/                  # 校本层：identity/branding/curriculum/ideology/rubric/campus
│   ├── brand/                   # 品牌配置（已改为校色）
│   └── config/deployment-mode.ts# 部署形态断言
├── packages/@openmaic/*         # 上游工作区包（MIT；mathml2omml 为 LGPL-3.0-or-later）
├── docs/参赛/                    # 作品说明书 / 演示脚本 / 视频脚本 / 答辩预案 / 许可与致谢
└── deploy/                      # EdgeOne 部署手册、环境变量模板、验收清单
```

---

## 参赛材料

| 文档 | 用途 |
| --- | --- |
| [`docs/参赛/作品说明书.md`](docs/参赛/作品说明书.md) | 背景、架构、二开逐条对照、创新点、局限与展望 |
| [`docs/参赛/演示脚本.md`](docs/参赛/演示脚本.md) | 8–10 分钟现场演示逐镜头脚本 + 应急动线 |
| [`docs/参赛/演示视频脚本.md`](docs/参赛/演示视频脚本.md) | 4 分 30 秒录制分镜与旁白全文 |
| [`docs/参赛/答辩预案.md`](docs/参赛/答辩预案.md) | 20 条高频问答 |
| [`docs/参赛/许可与致谢.md`](docs/参赛/许可与致谢.md) | 许可关系、LGPL 合规、学术引用 |

---

## 与 OpenMAIC 的关系

本项目是 OpenMAIC 的**二次开发**，不是独立实现。改动集中在：

1. 物理教学域移植（`lib/physics/`，3 618 行；其中纯领域层 2 698 行）
2. 物理领域约束注入生成管线（`lib/physics/prompts/`，不改动上游模板）
3. 校本内容层（`lib/school/`）与品牌层
4. 无数据库边缘部署改造（移除 render-service 与 persistence 路由、部署形态断言、
   跨平台原生模块配置、`build:packages` 修正）

详见 `NOTICE` 与 `docs/参赛/作品说明书.md` §3。

---

## 许可

- 本项目二开代码：MIT
- OpenMAIC 上游：MIT（`LICENSE`）
- `packages/mathml2omml`：LGPL-3.0-or-later（保留原始许可）
- `packages/pptxgenjs`：MIT（第三方）

---

## 数据声明

班级名单、学生成绩、评价记录、诊断结果**均为课程示例数据**，不是真实教务数据，
界面与导出文件中均已标注。章节学时、教材版本与校内实验清单为示例内容，
校对状态见 `lib/school/curriculum.ts` 的 `isVerified` 字段。
