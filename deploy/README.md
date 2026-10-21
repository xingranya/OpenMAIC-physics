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

> **本地开发用哪个 Node？** 仓库的 `.nvmrc` 写的是 `22`——那是**本地开发的
> 最低主线**，不是部署版本：OpenMAIC 要求 `node >= 22.19.0`，所以用 22 系列时
> 请指定 22.19.0 及以上的补丁版本（如 22.20.0）。**部署到 EdgeOne 时控制台固定
> 选 24.5.0**（平台只提供 22.11.0 / 22.17.1 / 24.5.0，前两个低于下限）。
> `.nvmrc` 保持单行是有意的：`nvm` 不识别文件里的 `#` 注释，多行会让
> `nvm use` 直接报 "version '22\n# …' is not yet installed"。

---

## 2. 部署步骤

### 2.0 两条路径：Git 导入 与 CLI 直传

| 路径 | 适用 | 前置 |
| --- | --- | --- |
| **A. CLI 直传**（推荐，最快） | 参赛现场、临时演示、只有本机代码 | 本机已装 `edgeone` CLI 并 `edgeone login` |
| **B. Git 导入** | 正式上线、需要持续迭代 | 仓库已推到 GitHub / Gitee / CNB / GitLab |

#### 路径 A：EdgeOne CLI 直传

EdgeOne 官方 CLI 支持**直接上传目录部署**，不必先推 Git 仓库：

```bash
# 0) 安装并登录（登录态存在 ~/.edgeone，主对话或 CI 均可直接复用）
npm install -g edgeone
edgeone login --site china
edgeone whoami            # 确认账号与 APPID

# 1) 本地先构建出与平台一致的产物（见 §2.3 的构建配置）
export EDGEONE=1
pnpm build:packages && pnpm build

# 2) 直传部署
edgeone makers deploy . --name <项目名> --json

# 3) 后续更新：重新构建后再次 deploy 即可
```

要点：

- `--json` 输出机器可读 JSON（URL、状态、产物信息），便于脚本化与留证。
- 默认会自动把 **AI Gateway 密钥**同步进本地 `.env` 并绑定云端凭据；
  若不希望自动绑定，加 `--skip-ai-gateway-sync`。
- 部署到**预览环境**用 `--env preview`；中国大陆与海外节点用 `--area china|global`。
- 已有项目必须是「直传（direct upload）」类型才能被 `deploy` 复用。
- 可用 `edgeone makers env set/ls/pull/rm` 在命令行增删改环境变量，
  不必每次都进控制台。

#### 路径 B：Git 导入（控制台）

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
| 构建命令 | `EDGEONE=1 pnpm build:packages && EDGEONE=1 pnpm build` | 先构建 8 个工作区包，再跑 Next.js 生产构建。**`EDGEONE=1` 必须带上**：它决定 `next.config.ts` 不产出 standalone 产物（平台自己托管 Next.js 运行时） |
| 输出目录 | 保持默认 | EdgeOne 的 Next.js 适配器接管产物 |
| Node 版本 | 24.5.0 | 见 §1 |

> **为什么 `EDGEONE=1` 必须在构建时带上**
> `output` 决定**构建产物形态**：EdgeOne / Vercel 由平台托管 Next.js 运行时，
> 不需要 standalone 产物；其余场景（自托管 Docker）需要 `.next/standalone`。
> 控制台配置的环境变量在**构建与运行两侧都能读到**，所以平台上一致。
>
> ⚠️ **构建与运行必须看到同一份环境变量。** Next 在运行期按 `output` 决定静态资源
> 的文件系统检查策略：产物是非 standalone 形态、运行期却按 standalone 处理时，
> 静态资源路由会异常，表现为**路由 404 或静态资源缺失**。
> 本地两侧都要带 `EDGEONE=1`；平台侧控制台的环境变量两侧都有，天然一致。
>
> ⚠️ 另一条、也是更隐蔽的一条：**不要在服务运行期间重新构建**。运行中的
> `next start` 持有旧的 build-manifest，一旦 `.next` 被就地重建，它返回的 HTML
> 会按旧 BUILD_ID 引用磁盘上已不存在的 chunk → chunk 拉不到 → React 不水合 →
> **页面文字正常但所有按钮静默失效**。重建后请重启服务（核对步骤见 §8.0）。
>
> 这两条**症状不同、成因也不同**，排查时不要混为一谈：我们做过对照实验
> （同一份产物、只改运行期判定值，standalone 与非 standalone 两种形态下
> 49 个客户端 chunk 全部 200），所以"形态不一致 → chunk 500"并不成立；
> 真正会打空按钮的是上面第二条。

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

**推荐方案：腾讯云 Makers Models 统一网关**（免自备第三方厂商密钥）

Makers Models 是部署在 EdgeOne 边缘节点的统一模型接入服务，OpenAI 兼容协议、
单一 Key 调多家厂商模型、SSE 流式原生支持。本项目已原生识别 EdgeOne 的
`MAKERS_MODELS_KEY` 变量名并映射到 `openai` provider，控制台配置如下：

```env
MAKERS_MODELS_KEY=<EdgeOne Makers → Models → API Key 复制的值>
DEFAULT_MODEL=openai:@makers/deepseek-v4-flash
```

- 官方文档：<https://cloud.tencent.com/document/product/1552/132748>
- 平台「模板部署」时可能自动注入 `MAKERS_MODELS_KEY`，此时无需任何改动即可生效。
- 显式配置 `OPENAI_API_KEY` 时优先级更高（运维自备密钥优先于平台注入密钥）。
- 想限定可用模型时补一行 `MAKERS_MODELS=@makers/deepseek-v4-flash,@makers/xxx`。
- 需要自定义端点时补 `OPENAI_BASE_URL=https://ai-gateway.edgeone.link/v1`。

> 平台上还有两类可选的边缘计算模块，本项目当前**未**使用，需要时可另行接入：
> Makers Functions（`./edge-functions/api` 或 `./cloud-functions/api`，单次请求/任务型）
> 与 Makers Agents（`context.env` / `context.store` / `context.sandbox` 等，AI 业务流程型）。
> 参考 <https://cloud.tencent.com/document/product/1552/127415> 与
> <https://cloud.tencent.com/document/product/1552/132759>。

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
| **页面文字正常但所有按钮点不动** | 客户端 chunk 500 → React 未水合。常见原因：①构建与运行只在一侧配了 `EDGEONE=1`；②服务运行期间重建了产物 | 两侧都带 `EDGEONE=1`；重建后重启服务；跑 §8 的 `check:physics-e2e.mjs` 确认 chunk 全 200 |
| 访问无口令保护 | 未配置 `ACCESS_CODE` | 配置后需重新验证 Cookie |
| 本地 http 演示卡在口令弹窗 | 口令 Cookie 带了 `Secure`，http 下浏览器不回传 | 本地自检时设 `ALLOW_INSECURE_ACCESS_COOKIE=1`（仅限 http://localhost 演示；生产一律带 `Secure`） |
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
本地确定性引擎（工作台：诊断 / 匹配 / 闯关 / 实验 / 报告，全部离线可用）
   ↓
预生成课程包（AI 课堂的"生成"环节：6 个物理章节，讲演页 + 测验，部分另含自包含交互仿真）
```

后两档各管一段、互不替代：工作台没有模型也能完整跑；AI 课堂没有模型时，
到首页「离线课堂包」一键导入已备好的课堂，播放、测验、导出与真实生成无差别。

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

---

## 8. 提交前本地自检（建议每次部署前跑一遍）

**重建之后必须重启服务进程**，否则会出现"页面能打开、但所有按钮点不动"的假故障：
旧进程返回的 HTML 按旧 BUILD_ID 引用客户端 chunk，而那些 chunk 文件已被新构建删除
→ chunk 拉不到 → React 不水合 → 所有 `onClick` 静默失效。
SSR 文字照常显示、构建日志也是 EXIT=0，**只有真的点一下才会暴露**。

### 8.0 重建后的 BUILD_ID 一致性核对（先做这一步）

> 为什么单独列一条：客户端 chunk 的文件名是**内容哈希**，源码没变 → 哈希没变 →
> 旧 chunk 仍在磁盘上。所以"chunk 全 200"这一项在**过期进程**上照样会通过，
> 查不出问题。唯一能识别"重建了产物却没重启服务"的办法是比对 BUILD_ID。

```bash
# 1) 磁盘上这份产物的 BUILD_ID
cat .next/BUILD_ID

# 2) 服务实际返回的 BUILD_ID（Next 把它嵌在首屏 HTML 的 flight 数据里）
curl -s http://127.0.0.1:3434/ | grep -o '\\*"b\\*":\\*"[A-Za-z0-9_-]*' | head -1

# 3) 两步输出的 ID 应当一致
```

不一致 ⇒ **进程还在服务旧产物**：停掉旧进程、用新端口重启，再跑下面的自检。
本地演示若不便重启进程，**换一个新端口**也可以——但不能复用旧端口上的旧进程。

> 自检脚本已经内建这一项：直接跑 `node scripts/check-physics-e2e.mjs --base-url <地址>`
> 就会比对「服务返回的 BUILD_ID」与「本地 `.next/BUILD_ID`」，不一致即判失败。
> 线上部署用 `--expect-build-id <id>` 显式声明期望值。

### 8.1 一条命令的端到端自检

```bash
# 1) 先构建（与平台同形态）
export EDGEONE=1
pnpm build:packages && pnpm build      # 产物中不应出现 .next/standalone

# 2) 启动（构建与运行都带 EDGEONE=1）；**必须重启，不能复用旧进程**
EDGEONE=1 pnpm start -- -p 3434        # 或 ./node_modules/.bin/next start -p 3434

# 3) 跑自检脚本（未启用口令 21 项 / 启用口令 24 项）
node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3434
# 配置了口令时再加上 --access-code，并让服务带 ALLOW_INSECURE_ACCESS_COOKIE=1
```

脚本检查的内容：

| 检查项 | 通过条件 |
| --- | --- |
| 15 条关键路由 | HTTP 200，且首帧含校名与「正在加载工作台」水合安全标记 |
| 客户端 chunk | 页面引用的**每一个** chunk 都是 200（本次 51 个） |
| 口令门禁 | 未授权 401、错误口令 401、正确口令放行、带 Cookie 会话生效 |
| 模型降级前提 | 未配置模型 Key 时 provider 为空，生成路径优雅降级 |

任何一项失败都是阻断项，退出码非 0。

### 8.2 静态质量门槛

```bash
node scripts/typecheck.mjs              # 退出码 0（且会原样还原 next-env.d.ts）
./node_modules/.bin/eslint --quiet      # 退出码 0
./node_modules/.bin/vitest run tests/physics/   # 全绿
node scripts/check-physics-domain-purity.mjs   # 分层门禁
node scripts/check-doc-metrics.mjs            # 参赛材料自引数字与实现一致
```

模型供给自检（**在 EdgeOne 控制台拿到 Makers Key 之后跑**）：

```bash
MAKERS_MODELS_KEY=<your-key> node scripts/check-makers-models.mjs
# 输出当前账号可用的模型 id，以及可直接粘进控制台的 DEFAULT_MODEL
```

这条命令直接解决"配了 Key 却说没有可用模型"：它会告诉你网关到底返回了哪些模型，
以及 `DEFAULT_MODEL` 应该写成什么形式（必须带 `openai:` 前缀）。

### 8.3 口令门禁的本地形态

本地 `next start` 也是 `NODE_ENV=production`，口令 Cookie 会带 `Secure`，
http 下浏览器不回传 → 一直卡在口令弹窗。本地演示请显式开：

```bash
ALLOW_INSECURE_ACCESS_COOKIE=1 EDGEONE=1 ./node_modules/.bin/next start -p 3434
```

**生产环境绝对不要设置这个变量**——设了它，口令票据就能在明文 http 上传输。

### 8.4 两条容易踩的坑（症状不同，别混为一谈）

1. **重建后要重启服务**。运行中的 `next start` 持有旧的 build-manifest，
   `.next` 被就地重建后，它返回的 HTML 会引用磁盘上已不存在的 chunk →
   chunk 拉不到 → React 不水合 → **页面文字正常但所有按钮静默失效**。
   识别办法：比对 BUILD_ID（§8.0），自检脚本已内建这一项。
2. **构建与运行要看到同一份环境变量**。只在一侧配 `EDGEONE=1` 时，
   运行期会按 standalone 处理非 standalone 产物，静态资源路由异常，
   表现为**路由 404 或静态资源缺失**——不是 chunk 500。
   （我们用对照实验确认过：同一份产物只改运行期判定值时，两种形态的
   49 个客户端 chunk 全部 200。）

### 8.5 清理残留的本地服务进程（现场演示前必做）

反复调试会在本机留下一堆 `next start` 进程。它们不只是占端口，还会让验证
**测到错误的实例**：

| 残留类型 | 危害 |
| --- | --- |
| 指向**旧构建**的 `next start` | 返回的 HTML 引用已被新构建删除的 chunk → React 不水合 → **页面文字正常但按钮全哑**（§8.4 第 1 条） |
| 改了 `BUILD_ID` 响应头的代理 | 自检脚本的「BUILD_ID 与目标产物一致」会**误判通过**，掩盖真实的版本不一致 |
| 启用了 `ACCESS_CODE` 的实例 | 口令已知且会留在 shell 历史里；也容易让人误以为线上就是这个口令 |
| 占用同一端口的旧实例 | 新实例起不来，验证其实跑在老代码上 |

仓库自带清理脚本（**默认 dry-run**，只列不动手；要真结束必须显式 `--yes`）：

```bash
# 1) 看看有哪些属于本仓库的残留进程
node scripts/cleanup-local-dev.mjs

# 2) 确认无误后结束（只处理 cwd 在本仓库内的 node 进程，不碰别的项目）
node scripts/cleanup-local-dev.mjs --yes

# 只处理某个端口
node scripts/cleanup-local-dev.mjs --port 3540 --yes
```

手工清理的话：

```bash
# 1) 看看有哪些 node 进程在监听端口
lsof -nP -iTCP -sTCP:LISTEN | grep node

# 2) 逐个结束（先确认 PID 对应的是本项目的 next start 再动手）
kill <PID>

# 3) 确认已清干净
lsof -nP -iTCP -sTCP:LISTEN | grep node || echo "已清空"
```

> 演示前请只保留**一个**实例，并确认它是用**当次构建产物**启动的：
> `node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:<端口>` 里的
> 「BUILD_ID 与目标产物一致」必须通过。

---

## 9. EdgeOne Makers 平台能力速查（2026-06 官方文档）

| 能力 | 文档 | 与本项目的关系 |
| --- | --- | --- |
| **Makers Models** 统一模型网关 | `1552/132748`（能力）、`1552/132789`（配额） | 单一 Key 调多家厂商模型，OpenAI 兼容，SSE 原生支持，内置模型开箱即用。`MAKERS_MODELS_KEY` + `DEFAULT_MODEL=openai:@makers/deepseek-v4-flash` 即接入；`DEFAULT_MODEL` 缺省时由代码自动推导。**Models 免费版配额：内置模型免费额度 50 万 token/月、单个请求最大运行时间 300 秒、请求 body 上限 25 MB** |
| **Makers Agents** 运行时 | `1552/132789` | 平台整体配额参考：执行次数 20 万/月、总内存时长 10 万 GB-s/月、单请求最长 3600 秒、会话最长空闲 300 秒、运行并发上限 40。**本项目未启用 Agent Workbench**（`OPENMAIC_AGENT_RUNTIME_ENABLED` 未设置），该配额不占用 |
| **Makers Agents** | `1552/132759` | 托管运行时 + 沙箱 + 会话管理 + 内置模型，`AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL`（默认 `https://ai-gateway.edgeone.link/v1`）。本项目**未使用**（见 §5 互斥项） |
| **Makers Functions** | `1552/127415` | Edge Functions（边缘节点、毫秒级冷启动）与 Cloud Functions（云端、Node/Python/Go）两档；本项目的 Next.js API 路由由平台的 Next 适配器托管 |

> 三份文档均已核对，结论已写进 `deploy/edgeone.env.example` 的「方案 A」。

### 9.1 关闭某个模型 provider

LLM provider 段支持运维侧的强制关闭开关（上游原本只对能力段支持这一档）：

```bash
# EdgeOne 控制台的环境变量写法（推荐，平台只能配环境变量）
OPENAI_ENABLED=false

# 或者用 server-providers.yml
#   providers:
#     openai:
#       enabled: false
```

被关掉的 provider：不拿任何密钥、不出现在客户端的模型列表里，
**平台自动注入的 `MAKERS_MODELS_KEY` 也不会把它复活**。
注意 `*_ENABLED` 未设置（空值）视为"没有意见"，不会覆盖 YAML 里的显式关闭；
显式写 `=true` 才会反过来打开。
