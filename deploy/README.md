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
| Agent Workbench | 需 PG 会话租约 | **已删除**（`/workbench`、`/workspace` 路由与 `components/workbench/` 整体移除） | ✅ 无此入口 |
| MP4 渲染 | 需 Docker + Chromium | **已删除**（`app/api/export-video/` 与 `lib/video-export*`；导出走 PPTX / 课堂 ZIP / 剧本） | ✅ 无此入口 |

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

EdgeOne 官方 CLI 支持**直接上传目录部署**，不必先推 Git 仓库。

> 本节命令于 2026-10-22 在本机**实测跑通**（CLI 已登录、账号 APPID 1374239834），
> 实测细节见下方「实测记录」。

```bash
# 0) 安装并登录（登录态存在 ~/.edgeone，主对话或 CI 均可直接复用）
npm install -g edgeone
edgeone login --site china
edgeone whoami            # 确认账号与 APPID

# 1) 关联项目（项目不存在时 deploy 会自动创建，但 env set 必须先关联）
edgeone makers link -n <项目名>

# 2) 配置环境变量（不必进控制台；写入「生产」环境）
edgeone makers env set ACCESS_CODE  <≥16位随机口令>
edgeone makers env set EDGEONE      1
edgeone makers env set DEFAULT_MODEL openai:@makers/deepseek-v4-flash
edgeone makers env ls               # 复核

> ⚠️ **`env set` 只影响后续部署，改完必须重新部署才生效。**
> 实测：轮换访问码时执行了 `env set`（`env ls` 回读已确认新值），
> 但**正在运行的部署仍然用旧口令**（新口令 401、旧口令 200）——
> 平台环境变量是**部署时绑定**的，不是一次写完就实时生效。
> 所以轮换口令的完整动作是：`env set` → **重新部署** → 用新口令复验。

# 3) 部署（推荐用仓库自带的一键脚本，见下方「为什么不能直接 deploy」）
node scripts/deploy-edgeone.mjs

# 3') 或者手工三步（等价于上面那条脚本）
edgeone pages build --mode prod              # 只构建，产出 .edgeone/
node scripts/prune-edgeone-function.mjs --yes # 裁剪云函数包到 128MiB 以内
edgeone makers deploy .tmp/edgeone-stage -n <项目名> -e production --area global --json

# 4) 后续更新：改完代码再次 node scripts/deploy-edgeone.mjs 即可
```

要点：

- **CLI 会自己在本地构建**：实测日志里能看到 `[builder] InstallCommand: pnpm install`，
  即平台按项目的 `packageManager` 字段选择包管理器，**不需要**手动先构建。
- **不能直接 `edgeone makers deploy`**：EdgeOne 的 Cloud SSR Node 函数包有
  **128MiB 硬上限**（详见 §8.1d），本项目直接 deploy 会被平台以错误码 30 拒收。
  `scripts/deploy-edgeone.mjs` 负责「构建 → 裁剪 → 上传」三步。
- **`--env preview` 有前置条件**：平台要求**先创建一次 production 部署**，
  报错原文「Please create a production deployment first」。首次部署请直接用 `-e production`。
- `--json` 输出机器可读 JSON（URL、状态、产物信息），便于脚本化与留证。
- 默认会自动把 **AI Gateway 密钥**同步进本地 `.env` 并绑定云端凭据；
  若不希望自动绑定，加 `--skip-ai-gateway-sync`。
- 部署到**预览环境**用 `--env preview`；中国大陆与海外节点用 `--area china|global`。
- 已有项目必须是「直传（direct upload）」类型才能被 `deploy` 复用。
- 可用 `edgeone makers env set/ls/pull/rm` 在命令行增删改环境变量，
  不必每次都进控制台。
- CLI 会在仓库根生成 `.edgeone/project.json`（项目关联信息），已加入 `.gitignore`。
- **预设域名（`*.edgeone.cool`）带平台级访问保护**：不带 `eo_token` 的请求会拿到
  平台自己的 401 页面（不是应用的 401）。CLI 部署成功时会打印带令牌的地址：
  `https://<项目>.edgeone.cool?eo_token=...&eo_time=...`。
  **正式对外访问应绑定自定义域名**，绑定后不再需要这个令牌。
  自检脚本用 `--site-query "eo_token=...&eo_time=..."` 传进去。
  平台在**第一次**带令牌的请求上用 302 下发 Cookie，浏览器跟随后即放行。
  实测下发的响应头原文（2026-10-24，预设域 `physics-ai-classroom-global-rvroompq.edgeone.dev`）：

  ```
  HTTP/1.1 302 Found
  Set-Cookie: eo_token=<token>; Max-Age=10800; HttpOnly; Path=/; SameSite=None; Secure; Partitioned
  Set-Cookie: eo_time=<ts>;   Max-Age=10800; HttpOnly; Path=/; SameSite=None; Secure; Partitioned
  Location: https://physics-ai-classroom-global-rvroompq.edgeone.dev/api/health
  ```

  `Max-Age=10800` 即 **3 小时**——这是演示材料的「平台 Cookie 有效期 3 小时」的出处。
  （注意：这是**平台**的 Cookie，与我们自己发的 `openmaic_access` 会话 Cookie 无关。）

**实测记录（2026-10-22）**

| 步骤 | 结果 |
| --- | --- |
| `edgeone whoami` | 账号 100043806721 / APPID 1374239834（登录态可用） |
| `edgeone makers deploy -n physics-ai-classroom -e preview` | 报错：需先创建 production 部署 |
| `edgeone makers deploy -n physics-ai-classroom -e production` | 报错：`pnpm install` 失败——corepack 缓存里没有 `pnpm@10.28.0`（`ENOENT: stat ~/.cache/node/corepack/v1/pnpm/10.28.0`） |
| `node scripts/deploy-edgeone.mjs` | **部署成功**：项目 `physics-ai-classroom-global`（ID `makers-kru2xpkwfs7q`，加速区域 `Area: "overseas"`＝全球可用区**不含**中国大陆），预设域 `https://physics-ai-classroom-global-rvroompq.edgeone.dev`，部署 ID `dp4c95mdsunb`，函数包 119.3 MiB（上限 128 MiB）；自定义域名 `dun.xran.uk` 已绑定 |
| 线上静态页（`/physics/overview` 等 SSG 路由） | HTTP 200，首屏标题「大学物理 AI 智慧课堂 · 长江大学文理学院」 |
| 线上动态路由（`/api/health`、`/physics/overview`、`/teacher/dashboard` 等 SSR 路由） | **HTTP 200**（修复前是 502 / 500），根因与修法见 §8.1e；线上自检 `node scripts/check-physics-e2e.mjs --base-url <地址> --access-code <码>` **25 / 25 通过** |
| 函数落点 | `actualRegions = {"overseas": "ap-singapore"}` —— **无大陆节点**；旧项目（含大陆）已按「删除重建」要求删除 |

**坑：corepack 缓存缺失导致 `pnpm install` 跑不起来**

`package.json` 用 `packageManager: pnpm@10.28.0` 锁定版本，corepack 会去
`~/.cache/node/corepack/v1/pnpm/10.28.0` 取对应版本；受限环境里该缓存不存在，
corepack 自己的下载也没成功，于是构建第一步就挂。

解法（任选其一）：

```bash
# 方案 1：手动把发行包放进 corepack 缓存（需要能访问 npm registry）
#   注意：corepack 0.34.6 自己的下载在受限环境里走不通——
#   缓存目录不存在时 installVersion 直接抛 ENOENT（不去下载），
#   而能下载时又会在清理下载临时文件上撞 EPERM unlink。
#   所以绕过 corepack，手动解包到它期望的目录即可：
DEST=~/.cache/node/corepack/v1/pnpm/10.28.0
curl -sSL -o /tmp/pnpm.tgz https://registry.npmjs.org/pnpm/-/pnpm-10.28.0.tgz
mkdir -p "$DEST"
tar -xzf /tmp/pnpm.tgz -C "$DEST" --strip-components=1 --exclude='*/.idea/*' --exclude='*/.git*'
node "$DEST/bin/pnpm.cjs" --version   # 应输出 10.28.0
```

```bash
# 方案 2：装成持久可用的全局 pnpm（本次实测最终采用的办法）
#   落点是 ~/.local/share/pnpm/，**不放 /tmp**：受限文件系统里 /tmp 下的
#   文件删不掉、下一轮会话就失效；~/.local/bin 本来就在 PATH 里且排在
#   /usr/local/bin（corepack 壳）前面，垫片放这里可以直接盖掉 corepack。
PNPM_DIR="$HOME/.local/share/pnpm/10.28.0"
mkdir -p "$PNPM_DIR"
curl -sSL -o /tmp/pnpm.tgz https://registry.npmjs.org/pnpm/-/pnpm-10.28.0.tgz
tar -xzf /tmp/pnpm.tgz -C "$PNPM_DIR" --strip-components=1 --exclude='*/.idea/*' --exclude='*/.git*'
cat > "$HOME/.local/bin/pnpm" <<'SH'
#!/bin/sh
# 绕过 corepack：corepack 0.34.6 在受限环境里下载 pnpm 会卡在
# "Corepack is about to download ..." 然后抛 EPERM unlink。
set -e
CACHE="$HOME/.cache/node/corepack/v1/pnpm"
DEFAULT="$HOME/.local/share/pnpm/10.28.0"
want=""
if [ -f package.json ]; then
  want=$(node -p "try{require('./package.json').packageManager||''}catch(e){''}" 2>/dev/null \
         | sed -n 's/^pnpm@\([0-9][^:+]*\).*/\1/p')
fi
if [ -n "$want" ] && [ -f "$CACHE/$want/bin/pnpm.cjs" ]; then
  exec node "$CACHE/$want/bin/pnpm.cjs" "$@"
fi
exec node "$DEFAULT/bin/pnpm.cjs" "$@"
SH
chmod +x "$HOME/.local/bin/pnpm"
hash -r 2>/dev/null || true
pnpm --version   # 应输出 10.28.0
```

> 注意 `--exclude='*/.idea/*'`：pnpm 发行包里带 `.idea` 目录，
> 某些受限文件系统不允许创建其中的文件，不排除会让 `tar` 中途报错。
>
> 验证方式要覆盖真实用法，不能只看 `--version`：
> `pnpm exec tsc --version`（能跑本地二进制）与 `pnpm -r list --depth -1`
> （能识别 workspace）都要正常——corepack 壳在下载失败时正是这两类命令先挂。

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
| 安装命令 | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile` | Playwright 只用于 e2e，EdgeOne 构建不需要浏览器；跳过可显著缩短构建并避免二进制下载失败。**不要加 `--ignore-scripts`**：root `postinstall` 会跑 `pnpm run build:packages`，构建 8 个工作区包（它们的 `dist/` 不在版本控制里），跳过就等于干净机器上构建链断在第一步 |
| 构建命令 | `node scripts/sync-maic-importer.mjs && EDGEONE=1 pnpm build` | 与仓库里的 `edgeone.json` **完全一致**（CLI 读 `edgeone.json` 优先于控制台输入，两者不一致时以文件为准）。工作区包已由安装命令的 postinstall 构建，这里只需把 importer 产物同步到 `public/vendor/` 再跑 Next.js 生产构建。**`EDGEONE=1` 必须带上**：它决定 `next.config.ts` 不产出 standalone 产物（平台自己托管 Next.js 运行时） |
| 输出目录 | 保持默认 | EdgeOne 的 Next.js 适配器接管产物 |
| Node 版本 | 24.5.0 | 见 §1 |

> **为什么 `EDGEONE=1` 必须在构建时带上**
> `output` 决定**构建产物形态**：EdgeOne / Vercel 由平台托管 Next.js 运行时，
> 不需要 standalone 产物；其余场景（自托管）需要 `.next/standalone`。
> 注：本作品**已删除** `Dockerfile` / `docker-compose.yml`（唯一部署目标是 EdgeOne），自托管不在交付范围内。
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
> 42 个客户端 chunk 全部 200），所以"形态不一致 → chunk 500"并不成立；
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
> 服务端包（供自托管使用），只在 `VERCEL` 时关闭。EdgeOne Pages 与
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
| 页面 500 且日志报 `[部署配置]` | 误配了 `DATABASE_URL` | 见 §5 的互斥项清单 |
| 生成课堂报 429 | 模型额度耗尽 | 改用预置课堂包；或换 provider；或降低 `DEFAULT_MODEL` 成本 |
| 首页一直转圈 | 未配置模型 Key | 至少配置一个 `*_API_KEY`，或直接用预置课堂包 |
| **页面文字正常但所有按钮点不动** | 客户端 chunk 500 → React 未水合。常见原因：①构建与运行只在一侧配了 `EDGEONE=1`；②服务运行期间重建了产物 | 两侧都带 `EDGEONE=1`；重建后重启服务；跑 §8 的 `check:physics-e2e.mjs` 确认 chunk 全 200 |
| 访问无口令保护 | 未配置 `ACCESS_CODE` | 配置后需重新验证 Cookie |
| 本地 http 演示卡在口令弹窗 | 口令 Cookie 带了 `Secure`，http 下浏览器不回传 | 本地自检时设 `ALLOW_INSECURE_ACCESS_COOKIE=1`（仅限 http://localhost 演示；生产一律带 `Secure`） |
| 导出的 MP4 不可用 | 渲染服务未部署 | 预期行为：自动降级为导出项目 ZIP |
| `pnpm install` 报 `ERR_PNPM_EPERM … copyfile … .gitmodules` | 防护策略按文件名拦截 `.gitmodules` 的创建（防 git 子模块劫持），pnpm 写这个上游残留文件时拿到 EPERM | 见下方「`.gitmodules` 拦截的绕法」 |
| 部署报 `Cloud SSR Node functions package size exceeds 128MiB limit` | 云函数包超平台硬上限 | 见 §8.1d（用 `scripts/prune-edgeone-function.mjs` 裁剪） |
| 线上动态路由全 5xx、静态页正常 | 平台**不物化符号链接**，函数包里 `node_modules/next` 等入口在平台上不存在 | 见 §8.1e（拍平）；取函数运行日志需在控制台「日志分析」里展开 SSR 行 |
| 线上访问返回平台自己的 401 页面 | 预设域名有访问保护，需要 `eo_token` | 用 CLI 部署成功时打印的带令牌链接；或绑自定义域名（§8.1g） |

### `.gitmodules` 拦截的绕法

某些受限环境会**按文件名**拦截 `.gitmodules` 的创建。pnpm 往包里写这个
上游残留文件时就拿到 EPERM，整个安装中断：

```bash
# 1) 先跑一次安装（会在写 .gitmodules 时失败，但 store 已经填充好了）
pnpm install --package-import-method=hardlink

# 2) 修 store 索引：把 .gitmodules 从包的索引里摘掉，pnpm 就不会再尝试创建它
node scripts/fix-pnpm-store-gitmodules.mjs

# 3) 再跑一次安装，这次会成功
pnpm install --package-import-method=hardlink
```

原理与适用范围见 `scripts/fix-pnpm-store-gitmodules.mjs` 的文件头注释。
脚本只改本地 store 缓存（不进版本库），幂等。

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

### 8.0 现场演示前置检查（一条命令）

```bash
node scripts/preflight-demo.mjs --port 3800 [--access-code '<访问码>']
```

它会依次做：构建产物与 BUILD_ID → 工作区是否干净 → 本机残留进程提示 →
**用当次构建产物**起一个服务并跑一遍端到端自检 → 打印「可以上台 / 需要先处理什么」。

> 为什么要有这条：现场最怕的不是功能坏，而是**测到错误的实例**——本机残留的
> 旧 `next start` 会返回旧 HTML，引用已被新构建删除的 chunk，表现为
> "页面文字正常、按钮全哑"（见 §8.4）。脚本用**新端口**起服务，所以即使本机
> 还有残留进程，它测的仍是自己拉起的实例；但目标端口被占用时会直接拦下。

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

# 3) 跑自检脚本（未启用口令 21 项 / 启用口令 25 项）
node scripts/check-physics-e2e.mjs --base-url http://127.0.0.1:3434
# 配置了口令时再加上 --access-code，并让服务带 ALLOW_INSECURE_ACCESS_COOKIE=1
```

脚本检查的内容：

| 检查项 | 通过条件 |
| --- | --- |
| 15 条关键路由 | HTTP 200，且首帧含校名与「正在加载工作台」水合安全标记 |
| 客户端 chunk | 页面引用的**每一个** chunk 都是 200（本次 42 个客户端 chunk） |
| 口令门禁 | 未授权 401、错误口令 401、正确口令放行、带 Cookie 会话生效 |
| 模型降级前提 | 未配置模型 Key 时 provider 为空，生成路径优雅降级 |

任何一项失败都是阻断项，退出码非 0。

### 8.1b 上游 mock 工厂导出面门禁

```bash
node scripts/check-mock-factory-exports.mjs
```

本分支给某个模块**新增导出**时，如果仓库里有测试用**固定形状**的
`vi.mock('…', () => ({ … }))` 工厂 mock 它，那个工厂必须一并补上新导出——
否则 vitest 会抛 `No "X" export is defined on the mock`，把那个测试从绿变红。

这类问题极难靠人眼发现（类型检查不报错、局部跑测试也不报错，只有跑全量才炸），
所以做成了门禁并接进 CI。判��只看**本分支相对上游基线新增**的导出，
上游遗留的差异不归本分支管。

### 8.1c 全量测试与上游基线的逐条对照（交付前跑一次）

```bash
node scripts/check-test-baseline.mjs          # 两侧各跑一次全量 vitest
node scripts/check-test-baseline.mjs --skip-baseline-run   # 只跑当前树（快，但不能做差集）
```

它把上游基线（v1.1.4）用 `git archive` 解到临时目录（**不碰 `.git`**），
在基线树与当前仓库各跑一次全量 vitest，然后比对**失败文件集合**——
当前有、基线没有的，就是本分支引入的回归。

为什么需要它：第八轮复审发现，本分支给 `provider-config` 新增一个导出，
就破坏了 5 个上游测试的固定形状 mock 工厂，48 例上游测试由绿转红。
而"全量失败数没变多"是**看不出**这种回归的——必须逐文件与基线对照。
（`check-mock-factory-exports` 是它的轻量级等价防线，跑在 CI 里。）

> 全量失败集合会随并发负载浮动（同一份代码两次全量可能差一两个时序敏感文件），
> 所以判定"本分支是否引入回归"要看**稳定核心**：把这几个文件单独再跑一遍，
> 两边都失败的才算真回归。脚本会同时列出"相比基线不再失败"的文件
> （本分支顺手修好的）。

### 8.1d EdgeOne 云函数包 128MiB 硬上限（部署必读）

EdgeOne 的 **Cloud SSR Node 函数包**解包后超过 **128MiB** 会被平台直接拒收：

```
Error: Cloud SSR Node functions package size exceeds 128MiB limit (422MiB)
[CI][dp98yk0t9dbh] ✘ Build error  ret code: 30
```

平台侧只给一个错误码，日志要自己去取（CLI 不打印）：

```bash
TOKEN=<CLI 登录令牌>   # 见 ~/.edgeone 下的 eo_token 记录
curl -s -X POST https://pages-api.cloud.tencent.com/v1 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"Action":"DescribePagesDeploymentLog","ProjectId":"<项目ID>","DeploymentId":"<部署ID>"}'
# 返回里的 LogUrl 就是上面那份日志
```

本项目（上游 OpenMAIC 全量 + 物理工作台）打包后 **285.7 MiB**，超限一倍多。
三个大头与实测数值：

| 大头 | 体积 | 为什么可以砍 |
| --- | --- | --- |
| `sharp` 的 6 个平台原生变体 | ≈133 MiB | EdgeOne 函数运行时固定 linux-x64；且 EdgeOne CLI 会给 Next 注入自定义图片加载器（`images.loader='custom'`），**Next 自己的 image optimizer 根本不碰 sharp**。应用自己 `import sharp` 用的是 sharp 0.35.4 → libvips 1.3.3，只有 linux-x64 那份是必需的 |
| 项目源码的整份拷贝 | ≈34 MiB | opennext 把项目根整体复制进函数包；运行时真正需要的只有**工作区包的运行期部分**（`package.json` + `dist` + 许可，已实体化进 `deps/`）、`skills/`、以及 `outputFileTracingIncludes` 点名的那个 mjs |
| `public/vendor/maic-importer` | ≈5 MiB | maic-importer 是通过 **URL 动态 import** 的静态资源，由静态托管（`.edgeone/assets/vendor/…`）提供，函数包里这份是重复 |

裁剪脚本把这些一起处理掉，并顺带修掉 opennext 的**四个**运行时坑：

```bash
node scripts/prune-edgeone-function.mjs            # dry-run，只报告
node scripts/prune-edgeone-function.mjs --yes      # 真执行
```

实测：**285.7 MiB → 118.0 MiB**（裁剪 + 拍平 + 别名/工作区包实体化之后；
只裁剪、不拍平时是 151.6 MiB，仍超限）。再按运行期反馈补包（4 个包 / 1.4 MiB），
**最终上传 119.3 MiB**。

**当前产物实测（门禁口径）**：函数包最终体积 **119.3 MiB**，运行期门禁覆盖 **67 条路由**。

> **体积口径**：`119.3 MiB` 是**最终上传体积**（按文件字节求和，脚本里的 `dirSize`），
> 与平台「解包后体积」的判定口径不完全等同——同一目录用 `du -sk` 量是更大的
> （块对齐会更大）。本项目按 119.3 MiB 部署**被平台接受**（部署 ID `dp4c95mdsunb`），
> 说明平台的判定口径与文件字节求和一致或更宽松。

### 8.1e 云函数依赖为什么必须改名成 `deps`（**线上 5xx 的真正根因**）

这一条是本项目踩得最深的坑，也是**本地永远复现不出来**的一类故障。

**症状**：静态页（SSG 路由，走平台 filesystem handler）线上 200，
**所有走云函数的路由**（`/api/**`、`/physics/*`、`/teacher/*` …）线上 5xx：

```
502 CLOUD_FUNCTION_INVOCATION_FAILED     # 函数压根没起来
500 INTERNAL_CLOUD_FUNCTION_ERROR        # 函数起来了，但执行期报错
```

**平台函数日志（控制台「日志分析」→ SSR 行右侧展开）先后给出过两条错误**，
它们是**同一个根因的两个阶段**：

```
# 阶段一：CJS 侧
Error: Cannot find module 'next/dist/server/lib/start-server.js'
  at Object.<anonymous> (/var/user/.edgeone/dist/run/next.cjs:41:30)

# 阶段二：ESM 侧（CJS 修好之后才暴露出来）
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg-587764f78a6c7a9c'
```

**根因（四条实测事实拼起来才是完整答案）**：

1. opennext 的运行时 `next.cjs` 用**裸标识符** `require('next/…')` 加载 Next——
   CJS 解析只认 `node_modules` 目录；
2. **EdgeOne Pages 在上传/解包时会剥离任何名为 `node_modules` 的目录**
   （实测：函数包根与 `.next/node_modules` 下的都没了，`/var/user/node_modules` 不存在）。
   这与依赖是软链还是实体目录无关——**连 npm 式的扁平布局也一样被剥**；
3. **函数运行时文件系统是只读的**（`EROFS: read-only file system`），
   所以「在运行时把 `node_modules` 补回来」这条路也走不通；
4. **ESM 不认 `NODE_PATH`**——ESM 只沿父目录逐级找 `node_modules`。
   而 Turbopack 的外部模块加载器正是原生 ESM 动态导入：

   ```
   .next/server/chunks/[turbopack]_runtime.js
     async function externalImport(id) { raw = await import(id); }
     contextPrototype.y = externalImport;
   // 产物里的调用点：e.y("pg-587764f78a6c7a9c")
   ```

⇒ 叠加的结果就是：依赖**一定到不了运行时**；只修 CJS 的话，
ESM 侧会以「Cannot find package」的形式继续 5xx。

**修法（已实现，在 `scripts/prune-edgeone-function.mjs` 里）**：

1. 裁剪阶段把函数包的 `node_modules` **改名成 `deps`**（名字不含 `node_modules`，平台就
   不剥离它——实测 `deps/` 能完整到达平台）；
2. 把 Turbopack 为 `serverExternalPackages` 生成的**哈希别名**
   （形如 `pg-587764f78a6c7a9c`）与工作区包（`@openmaic/*` 等）一并**实体化**到 `deps/`；
   工作区包的实体源取**仓库里的 `packages/`**，不取函数包里的副本（后者会被裁掉）；
3. 入口 `index.mjs` 在加载 handler **之前**做两件事：
   - `process.env.NODE_PATH = <包根>/deps` + `Module._initPaths()`
     → CJS 的 `require('next/…')` 立刻可解析；
   - `module.register('./esm-hooks.mjs')` 注册 **ESM 解析钩子**
     （钩子本体是仓库里的独立文件 `scripts/edgeone-esm-hooks.mjs`，
     裁剪脚本**原样拷贝**进函数包，不在脚本里再抄一份模板字符串；
     `tests/deploy/esm-hooks.test.ts` 直接验证这一个文件）
     → ESM 的 `await import('pg-<hash>')` 在默认解析失败时回退到 `deps/`
     （钩子按 package.json 的 `exports`/`module`/`main` 找入口，
     也支持 `<别名>/<子路径>` 这种 exports 子路径）。
   **不用**「运行时建 node_modules 软链」的办法——运行时只读，建不出来；
4. 裁剪脚本带 **fail-closed 门禁**（见 §8.1e-2）：残留符号链接、关键模块不可解析、
   **CJS 探针**（走 `NODE_PATH`，与生产同一条解析路径）解析每一个裸标识符、
   **ESM 探针**（起子进程真 `import()`）——任何一条不通过都中止部署。

> **为什么本地跑得通、本地也曾经跑不通**：本机文件系统认得符号链接、也认得
> `node_modules`，所以「同一份包本地 200、线上 5xx」是常态。
> 现在本地自检已经**模拟**了平台行为（依赖改名 + 只读约束下的解析路径），
> 本地与线上首次达成一致。

### 8.1e-2 门禁必须打在「真正的匹配源」上（三次假绿的教训）

这三条是本项目在修 §8.1e 时**真实踩到**的坑，值得写进手册——
它们都属于「断言恒真」型缺陷：测出来是绿的，线上照样 500。

| 假绿 | 现象 | 真相 | 现在的做法 |
| --- | --- | --- | --- |
| **软链从没被真正摘掉** | 裁剪日志刷「拍平失败：`src and dest cannot be the same`」，看起来像 Node 的怪癖 | 摘链用的 `unlinkSync` **从未被 import** → `ReferenceError` 被 `catch` 吞掉 → 软链还在 → 后续拷贝穿过软链写进目标目录，Node 的 `cpSync` 判定 src 与 dest 是同一个 inode | 补上 import；摘链**不再吞掉异常**；软链一律用 unlink 语义，不用递归删除（后者会跟随软链掏空目标目录） |
| **产物里的「别名全部可解析」恒真** | 门禁每次都报「外部模块别名全部可解析」 | 门禁用的正则是 `externalImport\\("..."`，而产物里**根本没有这种写法**（真实调用点是 `e.y("pg-<hash>")`）→ 一个都没匹配上 | 扫描改成打在真实调用点上：`require("x")`、`import("x")`、`.y("x")` |
| **探针其实解析到了工作区的 node_modules** | 关键模块 8/8「可解析」 | 探针的 `createRequire` 指向函数包，但函数包在**仓库内**，Node 会沿父目录向上找到**仓库根的 node_modules** → 验的根本不是要上线的那份产物 | 探针目录改到**仓库之外**（`tmpdir()`），那里向上找不到任何 `node_modules`，只剩 `deps/` 一条路——与平台情形一致 |

门禁现在还会**起一个子进程**（`node`，工作目录在仓库之外）真实注册钩子并
`import()` 产物里用到的每一个 ESM 裸标识符——不是「目录存在就算过」，
而是**真的能加载**。本地可用 `Node 20.19`（平台同款运行时）复现：

```bash
# 用平台同版本运行时验证 ESM 解析钩子
.tmp/node20/bin/node .tmp/esm-probe.mjs \
  "$PWD/.edgeone/cloud-functions/ssr-node" pg-<hash> undici shiki-<hash> …
# 期望：全部 OK，失败 0/9
```

### 8.1e-3 EdgeOne Pages **不部署 Next 中间件** → 访问码门禁要自己实现

`middleware.ts` 里那条「API 未授权 → 401」的规则，是本项目「ACCESS_CODE 生效、
未授权访问被拦截」这条验收标准的实现者。但实测发现：

- 产物里的 `.next/server/middleware-manifest.json`，`middleware` 字段是**空的**；
- 平台侧的 `.edgeone/edge-functions/index.js` 里也**没有**这段逻辑。

⇒ **Next 中间件在 EdgeOne Pages 上根本没有部署**，中间件里的 401 规则等于不存在：
所有 `/api/*` 路由对未授权请求是敞开的（实测 `/api/chat`、`/api/stages`
未带 Cookie 也能打到路由）。

**修法**：在云函数入口 `index.mjs` 里把同一条规则**补回来**——包装 opennext 的
handler，在调用前校验 `openmaic_access` Cookie：

```
Cookie 形态：<毫秒时间戳>.<HMAC-SHA256(时间戳, ACCESS_CODE) 的小写 hex>
有效期 7 天，允许 5 分钟时钟超前（与 lib/server/access-token-shared.ts 一致）
白名单：/api/access-code/**、/api/health
其余 /api/*：无合法 Cookie → 401 {"success":false,"errorCode":"INVALID_REQUEST",...}
页面路由：照旧放行（前端弹口令框），与 middleware.ts 语义一致
```

两个容易踩空的细节（都实测过）：

1. opennext 的 bootstrap 传给 handler 的是 **Node 的 `IncomingMessage`**
   （`request.url` 是相对路径、Cookie 在 `request.headers.cookie`），
   不是 WHATWG `Request`。门禁必须同时支持两种形态——
   否则 `new URL(request.url)` 直接抛错，被 catch 吞掉后**门禁静默失效**；
2. 门禁要放在**入口**（`index.mjs`），不是放在应用源码里：
   源码里的中间件平台不会部署。

本地验证（用平台同款 Node 20.19 起函数包）：

```
未授权 GET /api/stages      → 401 {"success":false,"errorCode":"INVALID_REQUEST",...}
伪造签名 GET /api/chat      → 401
过期令牌 GET /api/chat      → 401
合法 Cookie GET /api/chat   → 405（已到达路由，说明门禁放行）
白名单 GET /api/health      → 200
```

### 8.1f 云函数在平台侧的四个「平台说了算」（都实测过）

这四项与本地行为不同，是 EdgeOne Makers 的平台约定，排查时先排掉它们：

| 项 | 平台实况 | 本地/仓库里的对应值 | 影响 |
| --- | --- | --- | --- |
| **函数运行时版本** | **Nodejs20.19**，由平台固定，改不动 | 控制台「项目设置 → Node.js 版本」与 `edgeone.json` 的 `nodeVersion` 都设成 `24.5.0`，构建日志也确实是 `v24.5.0`，但函数运行时仍显示 `Nodejs20.19` | 产物里的 `engines.node` 应当**匹配平台实际提供的运行时**。仓库 `package.json` 写的是上游要求的 `>=22.19.0`，平台上没有满足它的运行时，平台可能在拉起阶段直接拒收。本项目把**产物副本**放宽到 `>=20.19.0`（仓库里的不动）。⚠️ 注意：仓库里 `@earendil-works/pi-ai` / `pi-agent-core` 自报 `>=22.19.0`、`svg-pathdata` 自报 `>=22.16.0`，在 Node 20.19 上属**未声明支持**，涉及 AI 助教与导出路径时需留意 |
| **云函数包体积** | 解包后 ≤ **128 MiB** | 直接 deploy 是 285.7 MiB，裁剪+拍平+依赖实体化后 118.0 MiB，补包后**最终上传 119.3 MiB** | 超限平台拒收（错误码 30），见 §8.1d / §8.1e |
| **函数地域** | **跟随加速区域**：本项目 `Area: "overseas"` → 部署 MetaData 的 `actualRegions` = `{"overseas": "ap-singapore"}`，**无大陆节点**；旧的「含大陆」项目（`Area: "global"`）才是 `{mainland: ap-guangzhou, overseas: ap-singapore}` | `edgeone.json` 的 `cloudFunctions.regions.overseas` 只会**新增**海外节点；`mainland: []` 不会凭空长出大陆节点 | 部署 MetaData 的 `actualRegions` **实测**为 `{"overseas": "ap-singapore"}`（**无 mainland 节点**）—— 大陆节点来自**加速区域**，不是平台强改（详见 §8.1f-1） |
| **预设域名访问保护** | `*.edgeone.cool` 需带 `eo_token` | 仓库里没有这个概念 | 不带令牌的请求会拿到**平台自己的 401 页面**（不是应用的 401）；CLI 部署成功时打印的地址带 `?eo_token=…&eo_time=…`，绑定自定义域名后不再需要 |

**⇒ 产物 `engines.node` 为什么必须改**：仓库 `package.json` 写的是上游 OpenMAIC 的
`"node": ">=22.19.0"`（构建期 Node 是 24.5.0，满足）；但函数运行时是 20.19，
`>=22.19.0` 在平台上**没有任何运行时能满足**，平台就可能在拉起阶段拒收。
`scripts/prune-edgeone-function.mjs` 因此把**产物副本**的 `engines.node` 放宽到
`>=20.19.0`（仓库里的不动，仍是上游要求）。

**⇒ 但它不是本项目 5xx 的根因**：带 `engines` 放宽的包部署后，函数日志里已经出现
`[ssr-node] framework server listening`（说明函数**起来了**，内存占用 ~17MB），
真正的报错是 `Cannot find module 'next/dist/server/lib/start-server.js'`
—— 根因是**平台不物化符号链接**，见 §8.1e。

### 8.1f-1 「加速区域」与「函数地域」是两件事（都实测过，别混）

这是本项目在「不要中国大陆节点」这件事上绕得最久的一处认知偏差，结论如下：

| 概念 | 平台字段 | 取值与含义 | 本项目现状 |
| --- | --- | --- | --- |
| **加速区域**（项目级，决定静态资源与函数落在哪套可用区） | 项目 `Area` | `"global"` = 全球可用区（**含**中国大陆）；`"overseas"` = 全球可用区（**不含**中国大陆） | **`"overseas"`** ✔（零大陆节点） |
| **函数地域**（SCF 部署节点） | 部署 MetaData 的 `actualRegions` | 跟随加速区域 | `{"overseas": "ap-singapore"}` ✔ |

**实测证据链**：

1. `DescribePagesProjects` 逐字段对比两个项目：旧的 `physics-ai-classroom`
   是 `Area: "global"`，控制台列表标注「全球可用区（**含**中国大陆）」；
   新建的 `physics-ai-classroom-global` 是 `Area: "overseas"`，
   标注「全球可用区（**不含**中国大陆）」；
2. 部署 MetaData：旧项目 `actualRegions = {mainland: ap-guangzhou, overseas: ap-singapore}`，
   新项目 `actualRegions = {overseas: ap-singapore}` —— **大陆节点消失**；
3. 控制台「项目设置 → 函数管理 → 函数地域」里**大陆组必须保留至少一个地域**
   （实测点「上海」能选中、点「广州」能取消，但大陆组清不掉）——
   这与中国站账号的默认落点有关，与加速区域是两码事；
4. **EdgeOne CLI 建项目时写死 `CreatePagesProject {Area: "global"}`**（CLI 内部常量
   `Wy = {global: pages-api.edgeone.ai, china: pages-api.cloud.tencent.com}`
   里的 "global" 指的是 **API 端点**，和项目的 `Area` 字段**不是同一个概念**，
   极易搞混）——所以**只用 CLI 建项目，永远落在「含中国大陆」那一档**；
5. 控制台的「创建项目 → 直接上传 / 导入 Git 仓库」向导里都有**加速区域**下拉，
   选「全球可用区（不含中国大陆）」时，平台写的就是 `Area: "overseas"`；
6. `CreatePagesProject` 也可以直接用 API 建 `Area: "overseas"` 的项目
   （本项目现在就是这么建的，见 `scripts/deploy-edgeone.mjs` 的 `ensureOverseasProject`）。

**⇒ 结论**：「零大陆节点 + 自定义域名免 ICP 备案」**不需要国际站**，
只需要**在腾讯云中国站新建一个 `Area: "overseas"` 的项目**。
自定义域名的 ICP 拦截随之消失（实测：`dun.xran.uk` 在不含大陆的项目上
可以正常走完「添加自定义域名 → 下一步」，中国区项目则被
「检测到当前域名未在工信部备案」直接拦下）。

> ⚠️ 旧的 `physics-ai-classroom`（`Area: "global"`）已按「删除重建」的要求删除，
> 现存项目只有 `physics-ai-classroom-global`（`Area: "overseas"`）。

### 8.1h 自定义域名绑定（`dun.xran.uk`）

**前提**：项目必须建在**加速区域 = 全球可用区（不含中国大陆）**（`Area: "overseas"`），
否则中国区产品会按 ICP 备案拦截（见 §8.1f-1）。

```bash
# 1) 控制台 → 项目 → 域名管理 → 添加自定义域名 → 填 dun.xran.uk
#    → 关联环境选「生产」→ 下一步
#    （在 Area=overseas 的项目上，这一步**不再**弹「未在工信部备案」）
# 2) 按控制台给出的记录，在 dun.xran.uk 的 DNS 上加：
#      CNAME  dun  →  dun.xran.uk.pages.dnsoe6.com
#    本项目的域名托管在 Cloudflare（NS: benedict/donna.ns.cloudflare.com），
#    记录请加在 Cloudflare 的 DNS 里，且选「仅 DNS（灰色云）」（不要代理）
# 3) 等控制台把该域名状态从「部署中」变成「已生效」，再开 HTTPS 证书
```

**实测**：域名在 `Area: "overseas"` 的项目上绑定成功（控制台状态「部署中」，
CNAME 已下发），API 侧 `DescribePagesProjects` 也能看到
`CustomDomains: [{"Domain": "dun.xran.uk"}]`。

**DNS 记录已加、路由已通，但 HTTPS 证书还没签发**（2026-10-23 实测）：

| 检查 | 结果 |
| --- | --- |
| `dig +short CNAME dun.xran.uk` | `dun.xran.uk.pages.dnsoe6.com.` ✔ |
| `dig +short A dun.xran.uk` | `43.174.246.40` / `43.174.247.40`（EdgeOne 边缘）✔ |
| `curl http://dun.xran.uk/` | **200** ✔ |
| `curl http://dun.xran.uk/physics/overview` | **200** ✔ |
| `curl -sk https://dun.xran.uk/` | **200**（路由通）✔ |
| `openssl s_client` 的证书 CN | `*.cdn.myqcloud.com` ✘ **不是 `dun.xran.uk`** |
| 预设域的证书 CN | `edgeone.dev` ✔（平台自有域另有证书） |

**「域名绑定成功 + DNS 生效」不等于「证书已签发」**——证书是独立的一步。
证书没签发时，边缘仍会下发**共享的 CDN 证书**（56 个 SAN 的通配证书），
浏览器打开 `https://dun.xran.uk` 就是一个证书错误页，评委看到的是
「网站打不开」。所以最后一步是在控制台
「项目 → 域名管理 → 自定义域名 → 申请/上传证书」
（DNS 验证通过后平台也会自动签发，分钟级到小时级）。

**控制台上的确切位置**（实测）：项目 `physics-ai-classroom-global` → 左侧
「**域名管理**」→ `dun.xran.uk` 那一行的「**HTTPS 配置**」列显示「**未配置**」
→ 点该列的「**配置**」→ 弹出「**边缘 HTTPS 证书**」面板 → 在那里申请证书。
同一面板里还有「强制 HTTPS」「HSTS」「OCSP 装订」——**证书就绪后再开强制
HTTPS**，否则会把 HTTP 访问重定向到不可用的 HTTPS，反而更糟。

**命令行没有这条路**（实测）：`edgeone makers` 只有 init / dev / generate-routes /
env / link / deploy / claim / create，没有域名或证书子命令；Pages API
（`pages-api.cloud.tencent.com/v1`）也只有 `DescribePagesProjects` /
`ModifyPagesProject` / `DescribePagesDeployments` / `DescribePagesEncipherToken`
这一族，**域名与证书相关 Action 全部返回 `Code 107 Action has not found`**
（试过 18 个候选名）。控制台走的是内部 `console.cloud.tencent.com/cgi/capi` 网关，
需要控制台会话 Cookie，外部调不了。

核验命令（**不要用 `curl -k`**，那会掩盖问题）：

```bash
echo | openssl s_client -connect dun.xran.uk:443 -servername dun.xran.uk 2>/dev/null \
  | openssl x509 -noout -subject          # CN/SAN 里必须有 dun.xran.uk
curl -o /dev/null -w '%{http_code}\n' https://dun.xran.uk/   # 应为 200
```

**为什么命令行改不了**（实测两次）：`ModifyPagesProject` 带 `CustomDomains`
会返回 `Code 0`，但再查项目 `CustomDomains` 仍是 `[]`——平台**静默丢弃**，
自定义域名只能在控制台加。

**Git 导入路径为什么不能用来部署**（实测）：控制台的「导入 Git 仓库」也会走
平台自己的构建流水线，而**本项目的函数包后处理必须在适配器打包之后**做
（`deps` 改名、ESM 解析钩子、访问码门禁都改在**函数包入口**上，
平台构建时那个入口还不存在）。实测用 Git 导入新建的项目，
平台构建出的云函数包**超过 128 MiB 上限**（未裁剪约 295 MiB），
部署直接失败。因此：

- **代码**已发布到 GitHub（`xingranya/OpenMAIC-physics`，分支
  `feature/physics-ai-classroom`），便于分发与协作；
- **部署**走本地 CLI：先在本地裁剪出合规的函数包，再上传
  （`node scripts/deploy-edgeone.mjs`，脚本会先核对项目的加速区域）。

### 8.1i 产物里的「桩包」与**仓库外**运行时门禁（线上空体 500 的真正根因）

这一条是**本地永远复现不出来**的那类故障，代价是线上 15 条 API 路由返回**空体 500**
（`/api/stages*`、`/api/classroom`、`/api/agent/*`、
`/api/chat/pi`、`/api/extract-document`、`/api/parse-pdf`），其余路由正常。

**根因**：EdgeOne 的构建产物里，有些包只是**一个桩目录**——版本号、`exports`
都对，但里面除 `package.json` 什么都没有（`@openmaic/storage` 的 `dist/` 是**空目录**，
`nanoid` / `openai` / `yaml` 等只剩 manifest）。平台部署时会剥离 `node_modules`，
运行时全靠我们把 `deps/` 挂进 `NODE_PATH` 与 ESM 解析钩子——桩目录到了平台上
就是 `Cannot find package`，表现为**空体 500**。

**为什么本地一直全绿**（这一条最关键）：探针目录用 `os.tmpdir()`，
而受限环境里 `TMPDIR` 常常被指到**仓库内**的临时目录（本项目就曾把
`TMPDIR` 设成 `<repo>/.tmp`）。于是「仓库外的探针」其实**一直在仓库内**，
Node 沿父目录向上两步就找到仓库根的 `node_modules`，把产物里缺失的文件全给补上了。
这不是偶发，是**长期**的假绿。

**修法（三件事，缺一不可）**：

1. **探针落位有两道互相独立的不变量**（`scripts/edgeone-temp.mjs`）：
   - *相对判据*：不在仓库根之内。仓库根由 `detectRepoRoot()` 从脚本自身位置
     **向上找 `.git`** 得出，**不依赖调用时的 cwd**——跑在错误的目录下也不会判错；
   - *绝对判据*：从探针目录**向上到根每一层都没有 `node_modules`**。这条与
     「仓库根在哪」无关，只要命中就一定是在拿仓库的依赖冒充产物
     （本机 `~/node_modules` **是存在的**，所以「在仓库外但在 home 底下」同样会骗人）。
   `outsideRepoTemp()` 按这两条筛候选目录，`TMPDIR` 指到仓库内也照绕。
2. **调用点显式断言**：光靠 `outsideRepoTemp()` **不够**——真正的失守在调用点，
   有人把它换成 `join(process.cwd(), '.tmp', …)` 时工具函数根本不会执行，
   门禁会从红翻绿还照样打印「通过」。所以 `runRuntimeProbe()` 里独立调用
   `assertProbeOutsideRepo()` 再查一遍，不通过直接抛错拒绝放行
   （`repair-edgeone-runtime-deps.mjs` 复用同一探针，所以补包循环同样会 fail-closed）。
3. **按运行期反馈补包**：把函数包挪到仓库外**真的跑起来**，看它到底缺哪个包，
   补完再跑，直到不再缺——而不是靠静态闭包猜。

```bash
node scripts/repair-edgeone-runtime-deps.mjs   # 运行期反馈补包（多轮直到不缺）
node scripts/verify-edgeone-runtime.mjs        # 仓库外运行时门禁：打全部 67 条路由
```

**为什么不用静态闭包**：静态闭包（产物引用的包 + 它们的**全部**传递依赖）是
**过近似**——它会把 `typebox` / `@smithy/core` / `@aws-sdk/*` 这些
**运行期根本不加载**的包也算进来。实测把它们逐个实体化要多塞好几 MiB，
而函数包有 128 MiB 硬上限；按运行期反馈补，只需要 4 个包 / 1.4 MiB。

**门的判定口径**（`verify-edgeone-runtime.mjs`）：

- **先断言探针落位**（不在仓库内 + 向上无 node_modules），不通过直接中止；
- 全部路由探一遍，**任何 5xx（除 501）都算失败**；
- 子进程 stderr 里的 `Failed to load external module` 逐类归因：
  - `Cannot find package 'x'` / `Cannot find module '…/deps/x/…'` → 缺包，要补；
  - `Could not load the "sharp" module using the darwin-arm64 runtime` →
    **平台原生差异**（产物带 linux-x64 原生库，本机是 macOS），不算失败。
    这类差异**逐请求归因**（只看该请求自己产生的 stderr），
    否则会把别的路由的报错算到当前路由头上。

**实测**：修完之后，仓库外跑 **67 条路由** → `200×13 400×1 404×19 405×32 500×2`，
其中 2 条 500 已归因为 sharp 的 macOS 差异（平台上 linux-x64 正常）。

> **体积口径补充**：丢掉 source map（496 个文件 / 5.8 MiB，运行期不用）后，
> 裁剪结果是 **285.7 MiB → 118.0 MiB**，补包后 **最终上传 119.3 MiB**（上限 128 MiB）。

> **这道护栏自己也得有牙齿**：`tests/deploy/edgeone-probe-isolation.test.ts`
> 对**每一层**都做了变异验证——删掉调用点的断言、把两道判据分别短路、
> 把候选筛选的判据短路，五种改法都会让门禁变红（实测 5/5 变红）。
> 两道判据必须能**分别**证伪：仓库根本来就装着 `node_modules`，
> 若错误消息只笼统说「不在仓库外」，改坏其中一道时另一道会替它挡刀，
> 测试照样全绿——护栏就成了摆设。

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
