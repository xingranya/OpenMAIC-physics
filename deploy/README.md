# 腾讯云 EdgeOne Pages 部署手册

> 面向「长江大学文理学院 · 大学物理 AI 智慧课堂」的部署操作说明。
> 目标平台：腾讯云 EdgeOne Pages（2026-06 起更名为 **EdgeOne Makers**）。

---

## 0. 为什么是 EdgeOne Pages

OpenMAIC `main` 分支（v1.2.0+）是 **server-first** 架构：课程生成在服务端常驻进程里跑，
并强依赖 PostgreSQL。EdgeOne Pages 是**无状态边缘平台**——没有长驻进程，也没有固定数据库。

本项目基于 **`release/1.1.x`（v1.1.4）** 改造。该分支默认使用浏览器存储
（课程文档 / 学习者运行时 / 设备 KV / 资源全部落在 IndexedDB），官方支持 Serverless 部署。
因此：

| 能力 | v1.2.x（main） | v1.1.x（本项目基底） | EdgeOne 适配 |
| --- | --- | --- | --- |
| 课程持久化 | PostgreSQL 必填 | 浏览器存储（默认） | ✅ 无需数据库 |
| 课程生成 | 服务端常驻进程 | 服务端 API 路由（无状态） | ✅ 无状态函数 |
| Agent Workbench | 需 PG 会话租约 | 关闭（`NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` 不设） | ✅ 中间件直接 404 |
| MP4 渲染 | 需 Docker + Chromium | 未启用 `RENDER_SERVICE_URL` 时自动降级为项目 ZIP | ✅ 降级路径内置 |

---

## 1. 前置条件

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **24.5.0** | EdgeOne 可选 22.11.0 / 22.17.1 / 24.5.0；OpenMAIC 要求 `node >= 22.19.0`，前两个**不满足**，只能选 24.5.0 |
| pnpm | ≥ 10 | EdgeOne 构建环境支持 pnpm / Bun / Yarn |
| 模型 Key | 至少一个 | 可选 MiniMax / DeepSeek / Kimi / Qwen / GLM / OpenAI 兼容 / Ollama 等；**没有也能演示**（见 §6） |
| 腾讯云账号 | 需要 | EdgeOne Pages 控制台 |

---

## 2. 部署步骤

### 2.1 准备仓库

```bash
git clone --branch release/1.1.x https://github.com/THU-MAIC/OpenMAIC.git
cd OpenMAIC
# 应用本项目的二开内容（lib/physics、lib/school、components/physics、app/physics、app/teacher、app/login 等）
```

### 2.2 建项目

1. 打开 EdgeOne Pages（Makers）控制台 → **创建项目**
2. 选择 **导入 Git 仓库**（支持 GitHub / Gitee / CNB / GitLab）
3. 框架预设选 **[Next]**
4. **Node 版本选 24.5.0**（见 §1 的版本约束说明）

### 2.3 构建配置

| 配置项 | 值 | 原因 |
| --- | --- | --- |
| 包管理器 | pnpm | 仓库是 pnpm workspace |
| 安装命令 | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile` | Playwright 只用于 e2e，EdgeOne 构建不需要浏览器；跳过可显著缩短构建并避免二进制下载失败 |
| 构建命令 | `pnpm build:packages && pnpm build` | 先构建 8 个工作区包，再跑 Next.js 生产构建 |
| 输出目录 | 保持默认 | EdgeOne 的 Next.js 适配器接管产物 |
| Node 版本 | 24.5.0 | 见 §1 |

> **关于 `build:packages`**
> 上游原脚本在 pnpm workspace 内部混用 `npm run build` 与 `pnpm run build`，
> npm 不认识 `workspace:` 协议，在 CI 环境中容易失败。本项目已改为：
> ```bash
> pnpm -r --filter "./packages/mathml2omml" --filter "./packages/pptxgenjs" \
>   --filter "./packages/@openmaic/dsl" --filter "./packages/@openmaic/generation" \
>   --filter "./packages/@openmaic/storage" --filter "./packages/@openmaic/importer" \
>   --filter "./packages/@openmaic/renderer" --filter "./packages/@openmaic/editor" \
>   run build && node scripts/sync-maic-importer.mjs
> ```

### 2.4 原生模块（关键）

`sharp` 与 `@napi-rs/canvas` 是原生模块，EdgeOne 构建环境是 **linux-x64**，
而本地开发机可能是 darwin-arm64。若不做处理，EdgeOne 构建期会报
`Cannot find module` 或 dlopen 失败。

本项目已在 `pnpm-workspace.yaml` 中声明目标架构：

```yaml
supportedArchitectures:
  os:
    - current
    - linux
  cpu:
    - current
    - x64
```

安装时 pnpm 会同时解析 linux-x64 的预编译产物，本地与 EdgeOne 共用同一份 lockfile。

### 2.5 环境变量

在控制台 **项目设置 → 环境变量** 中逐条配置，参考 `deploy/edgeone.env.example`。
**环境变量在控制台配置，不会进入客户端包。**

必须配置的三项：

```env
EDGEONE=1                              # 告诉 next.config.ts 构建目标是边缘平台
DEFAULT_MODEL=<provider>:<model>       # 例：minimax:MiniMax-M2.7-highspeed
ACCESS_CODE=<至少 16 位随机字符串>      # 站点级口令，保护部署不被他人改动
```

> **为什么 `EDGEONE=1` 是必填的**：上游 `next.config.ts` 默认产出 `standalone`
> 服务端包（供 Docker 自托管使用），只在 `VERCEL` 时关闭。EdgeOne Pages 与
> Vercel 一样由平台托管 Next.js 运行时，**不需要也不应该**拿到 standalone 产物——
> 若沿用 standalone，平台会拿到一份无人启动的服务器产物，表现为路由 404 或
> 静态资源缺失。本 fork 已加上 `EDGEONE` 开关，构建时设置该变量即可。

模型 Key 按所选 provider 配置，例如：

```env
MINIMAX_API_KEY=...
MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic/v1
```

> `ACCESS_CODE` 是保护部署的唯一凭据。没有它，任何能访问该地址的人都能修改
> 甚至删除整个课程库。生成方式：`openssl rand -base64 24`

### 2.6 KV / Blob（可选）

两者都是**最终一致**（边缘节点缓存最长 60s），因此只用于可容忍短暂滞后的数据：

- **Pages KV**（1GB 免费 / 10 命名空间 / 单值 ≤ 25MB / key ≤ 512B / **仅 Edge Functions 可用**）
  → 适合放课程目录索引、访问统计
- **Pages Blob**（对象存储 / 单值 ≤ 25MB / 支持目录层级 / SDK `@tencent/pages-blob`）
  → 适合放 AI 生成的图片与音频，实现跨浏览器共享

操作路径：控制台 → 存储 → KV/Blob → 创建命名空间 → 绑定到项目 → 记录绑定变量名。
**不绑定也不影响主流程**：课程与学生记录一律走浏览器强一致存储，
保证评委刷新两次看到的是同一份内容。

### 2.7 域名

1. 先用默认预览域名（`*.edgeone.app`）验证全链路
2. 需要自有域名时：控制台 → 域名管理 → 添加域名 → 配置 CNAME
3. **中国大陆自有域名需完成 ICP 备案**

---

## 3. 部署后验收

按 `deploy/deploy-checklist.md` 逐项打勾。最小验收路径：

1. 打开首页 → 看到校徽与「物理学习门户」
2. 点「物理学习工作台」→ 跳登录页 → `student` / `dunzhongwan` → 进入学生总览
3. 左侧「AI 智能课堂」→ 输入「大学物理 第三章 牛顿运动定律」→ 生成课堂 → 播放
4. 学生端走完 诊断 → 匹配 → 闯关 → 实验 → 报告，报告能下载 Markdown
5. 退出 → `teacher` / `dunzhongwan` → 教师端 5 视图可切换，评价复核能保存
6. 断网后：首页「离线课堂包」仍能导入并完整播放

---

## 4. 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 构建报 `Cannot find module '@openmaic/...'` | 工作区包未构建 | 确认构建命令包含 `pnpm build:packages &&` |
| 构建报 `sharp` / `dlopen` 失败 | 未取到 linux-x64 原生二进制 | 确认 `pnpm-workspace.yaml` 的 `supportedArchitectures` 生效，删除 `node_modules` 后重装 |
| 构建报 `packageManager` / corepack 错误 | corepack 试图下载 pnpm | EdgeOne 支持直接选 pnpm；或把 `packageManager` 字段改为控制台所选版本 |
| 构建超时 | monorepo 体量大 | 拆分构建：先单独构建工作区包并缓存产物；或改用 Vercel（1.1.x 官方支持） |
| 页面 500 且日志报 `[部署配置]` | 误配了 `DATABASE_URL` 或 Workbench 开关 | 见 §5 的互斥项清单 |
| 生成课堂报 429 | 模型额度耗尽 | 改用预置课堂包；或换 provider；或降低 `DEFAULT_MODEL` 成本 |
| 首页一直转圈 | 未配置模型 Key | 至少配置一个 `*_API_KEY`，或直接用预置课堂包 |
| 访问无口令保护 | 未配置 `ACCESS_CODE` | 配置后需重新验证 Cookie |
| 导出的 MP4 不可用 | 渲染服务未部署 | 预期行为：自动降级为导出项目 ZIP |

---

## 5. 边缘部署的互斥项（不要设置）

以下变量与无状态边缘运行时互斥。一旦误设，服务端启动断言会**直接抛错**
（见 `lib/config/deployment-mode.ts` 与 `instrumentation.ts`），宁可启动失败，
也不让评委在现场看到"点了没反应"：

```env
# ✗ DATABASE_URL=postgres://...
# ✗ NEXT_PUBLIC_PERSISTENCE=1
# ✗ NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=true
# ✗ OPENMAIC_AGENT_RUNTIME_ENABLED=true
# ✗ RENDER_SERVICE_URL=http://...
```

> 说明：仓库的 `package.json` 仍保留 `pg` 依赖——`lib/persistence/server-provider.ts`
> 在类型层面静态引用它，删除依赖会导致类型检查失败。**依赖在，但运行时永不启用**：
> 没有任何 `DATABASE_URL`，那条代码路径就不会被触达。

---

## 6. 没有模型额度时的演示方案

本项目内置**三级降级**，任何一环断掉都不会让演示中断：

```
真实 LLM（多智能体课堂 / 课件生成 / 讨论）
   ↓ 429 限额 / 无 key / 断网
预置课堂包（6 个物理章节，讲演页 + 测验 + 自包含交互仿真）
   ↓
物理学习工作台（本地规则引擎，诊断 / 匹配 / 闯关 / 实验 / 报告 全部离线可用）
```

预置课堂包在首页「离线课堂包」区块一键导入，导入后与真实生成的课堂
在播放、测验、导出上**没有任何差别**。

---

## 7. 备选部署路径

若 EdgeOne 构建不可行（构建超时或原生模块问题），**Vercel 是官方支持的备选**：

1. Fork 仓库 → Vercel 新建项目 → 导入
2. Node 版本选 22.19+（Vercel 默认即可）
3. 配置 `DEFAULT_MODEL` + 模型 Key + `ACCESS_CODE`
4. 部署完成

建议两个平台都部署一个：EdgeOne 作为主（国内访问快、免费额度足），
Vercel 作为灾备（EdgeOne 故障时切换）。
