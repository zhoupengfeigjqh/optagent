# OptAgent 智能体平台

面向真实业务的**数字人（Agent）平台**：管理员在管理后台把「模型 · 本体 · 技能 · MCP 工具」装配给一个数字人，
一键部署到运行端；使用者在对话工作台里用自然语言驱动它完成排产、BOM 校验合并、表格识别等实际动作。

| 角色 | 入口（本地） | 提供什么 |
|---|---|---|
| 使用者 | http://localhost:5173 | 对话工作台：SSE 流式回答、工具调用卡片、人工确认（HITL）、@文件引用、三空间文件、后台产出铃铛 |
| 管理员 | http://localhost:5174/admin/ | 管理后台：MCP 服务 · 本体管理 · SKILL 管理 · 数字人设计 · 数字人部署 |
| 生产统一入口 | `http://<宿主 IP>:82` | 网关：`/` 工作台、`/admin/` 后台、`/api/` 运行端接口、`/api/admin/` 管理端接口 |

> **本平台当前没有登录体系**：运行端「当前用户」固定为 `admin`（`agent-backend/src/domain/current-user.ts`
> 已按 JWT 预留接口）。因此只能部署在可信内网，不要直接暴露公网。

---

## 1. 快速开始

### 1.1 前置

| 依赖 | 要求 | 是否必需 |
|---|---|---|
| Node.js | ≥ 20 | 必需 |
| npm | 随 Node | 必需 |
| 一个 LLM API Key | 默认 `deepseek`（`config.yaml` 可换模型） | 必需 |
| Docker Desktop | 跑 OCR / Jev / BOM（MCP）与 Laya（推理服务） | 可选（不用这些工具时不必） |
| 本体平台 optonto | 提供本体市场与「自建发布」函数服务 | 可选（不导入本体/技能时不必） |

### 1.2 本地开发形态（四个进程）

四个进程**各开一个终端**（`npm run dev` 会占住终端），下面的命令都在仓库根目录执行：

```bash
# ① 运行端后端 :3000
cd agent-backend
cp .env.example .env.local          # 填 DEEPSEEK_API_KEY、PUBLIC_BASE_URL
cp config.example.yaml config.yaml  # 填 models（缺省或为空会拒绝启动）
npm install && npm run dev

# ② 对话工作台 :5173
cd frontend
npm install && npm run dev

# ③ 管理端后端 :3001
cd admin-backend
cp .env.example .env.local          # 默认值即本地形态（相对路径 + 127.0.0.1）
npm install && npm run dev

# ④ 管理后台 :5174（base = /admin/）
cd admin-frontend
npm install && npm run dev
```

Windows 下把 `cp` 换成 `Copy-Item`。两个后端**只读 `.env.local`**（`--env-file=.env.local`），不读入库的 `.env`；
两个前端没有本地配置文件，`/api`、`/api/admin` 由 Vite Proxy 转发到 3000 / 3001。

启动后逐项验证（缺一个就先别继续）：

```bash
curl http://localhost:3000/api/monitor/health     # {"status":"ok",...}
curl http://localhost:3001/api/admin/platform/health   # 路径可写探测
curl -o /dev/null -w '%{http_code}\n' http://localhost:5173/
curl -o /dev/null -w '%{http_code}\n' http://localhost:5174/admin/
```

### 1.3 MCP / 推理服务（Docker，按需）

```bash
docker compose up -d ocr jev bom     # 表格识别 / Jev 决策 / BOM 校验合并
docker compose up -d laya            # 意图聚焦判定模型（013，可选；镜像近 3GB）
```

| 服务 | 宿主端口 | 容器内 | 说明 |
|---|---|---|---|
| ocr | 8100 | 8000 | RapidOCR，`/mcp` |
| jev | 8101 | 8000 | Jev 决策（需 `TYPESAFE_API_KEY`） |
| bom | 8102 | 8000 | BOM 校验 / 合并（产出回写平台） |
| laya | 8103 | 8000 | Laya 判定模型（需 `DECIS_API_KEY`） |

首次运行前按各目录 `.env.example` 建 `.env.local`：ocr / bom 可调项都有代码缺省值，缺失不影响启动；
`jev` 缺 `TYPESAFE_API_KEY` 时三个工具返回可读错误；`laya` 缺 `DECIS_API_KEY` 会**拒绝启动**（非 loopback 必须带 token）。

### 1.4 全 Docker 形态（联调 / 生产）

```bash
docker compose up -d --build          # 9 个服务：gateway + 4 个应用 + 4 个 MCP/推理
```

前置只有两份配置：`agent-backend/config.yaml`（模型，挂载进容器）与
`agent-backend/.env.local`（密钥，compose 作为 `env_file` 注入）。
访问 `http://<宿主 IP>:82`（工作台）与 `http://<宿主 IP>:82/admin/`（管理后台）。

首次构建含 `laya` 镜像（本地源码构建，慢）；只要核心能力时指定服务即可：
`docker compose up -d --build gateway backend admin-backend frontend admin-frontend`。

---

## 2. 从零到能对话（五步）

| 步骤 | 在哪做 | 关键判据 |
|---|---|---|
| ① 登记 MCP 服务 | 管理后台 → MCP 服务 → 新建 | 填名称/传输方式/连接地址（+ 请求头）→ **连接并获取工具**成功 → 勾选至少一个工具 → 创建 |
| ② 设计数字人 | 管理后台 → 数字人设计 | 选模型、写灵魂（人格与规则）、勾技能与 MCP 服务、开内置工具、设文件空间场景 |
| ③ 部署 | 管理后台 → 数字人部署 | 先看预览（将写入哪些文件）→ 下发 → 运行端出现 `users/{uid}/agents/{数字人}` |
| ④ 对话 | http://localhost:5173 | 选数字人 → 发一句话：能看到流式回答与工具卡片 |
| ⑤ 试工具 | 同一页面 | 触发一次带文件的工具（如 OCR）：卡片可展开看结果，需要确认的工具会弹 HITL 表单 |

> 部署是**以数字人为单位的整体覆盖**：平台侧没配的内容不会在运行端残留；但覆盖范围**仅限数字人配置目录**
> （`agents/{数字人}`），**不含文件空间**——`user-data/{数字人}/` 下既有的文件与二级目录一律保留。

---

## 3. 架构

### 3.1 组件与端口

| 组件 | 技术栈 | 端口 | 职责 |
|---|---|---|---|
| `gateway` | nginx | 82 → 80 | 唯一外部入口；SSE 关缓冲；`/dataApi/` 反代排产数据服务 |
| `frontend` | Vue 3 + Vite | 5173（dev） | 对话工作台 |
| `agent-backend` | Fastify 5 + TS | 3000 | Agent 运行时：SSE 对话、工具编排、HITL、文件空间、后台产出 |
| `admin-frontend` | Vue 3 + Vite | 5174（dev，base `/admin/`） | 管理后台 |
| `admin-backend` | Fastify 5 + TS | 3001 | 设计态配置中心 + 部署下发 |
| `ocr` | Python / FastMCP | 8100 → 8000 | 表格识别 MCP |
| `jev` | Python / FastMCP | 8101 → 8000 | Jev 决策 MCP（state + 类型化问题 → 结构化决策） |
| `bom` | Python / FastMCP | 8102 → 8000 | BOM 校验 / 合并 MCP（唯一产出文件的工具） |
| `laya` | Docker 推理镜像 | 8103 → 8000 | 意图聚焦判定（backend 直调 HTTP，**不经 MCP**） |
| 排产数据服务 | 外部 | `192.168.0.188:8080` | 排产页面与 `hd-algorithm` MCP 的数据/求解上游 |

```text
浏览器 ──► gateway(:82) ─┬─► frontend        工作台
                        ├─► admin-frontend  /admin/   管理后台
                        ├─► agent-backend   /api/     运行端
                        ├─► admin-backend   /api/admin/  设计态与部署
                        └─► hd-algorithm 数据服务 /dataApi/
agent-backend ──MCP(HTTP)──► ocr / jev / bom / 外部 MCP 服务
              ──HTTP──────► laya（意图聚焦，可选）
              ──文件直链──► MCP 服务回源下载（签名 URL，本机 LAN IP）
```

### 3.2 一次对话发生了什么

1. 前端发 `POST /api/chat`，后端以 **SSE** 逐帧回推（文本增量、工具调用、用量、错误）。
2. 模型决定调用工具 → 运行端按平台物化的 `MCP.json` 装配工具表（`{服务名}__{工具名}`），执行前按
   `confirmation` 决定是否**挂起等人工确认**（HITL 表单由入参 schema 递归生成）。
3. 工具入参里的文件相对路径按 `file_args` 铸成**签名直链**，MCP 服务回源下载（服务不在用户磁盘上）。
4. 长耗时工具改用**异步**：服务立即回受理，算完 `POST resultUrl` 回写 → 落 `临时空间/后台产出/` →
   铃铛出条目，后续轮次模型可 `read_file`。
5. 所有工具调用记录、会话、用量落盘（`threads/` + SQLite），刷新页面仍可见。

### 3.3 配置单向流（核心约束）

```text
管理后台（设计态：.platform-data/）  ──部署──►  运行端用户目录（agent-backend/.opt-agent/users/{uid}/agents/{数字人}）
                  ▲                                              │
                  └──────────── 平台是唯一权威源，不反向读取 ─────┘
```

- **只允许平台 → 运行环境一个方向**。平台不导入运行端既有数字人、技能、用户数据，运行端也不回写平台。
- 部署语义 = **整体覆盖**（先写临时目录再原子换入，失败回滚），不做字段级合并、不保留差异。
- **MUST NOT 手工编辑**运行端 `MCP.json` / `TOOL.json` / `SOUL.md` / `scenario.json`：它们是部署产物，下次部署即被覆盖。
- 例外只有一个：**文件空间不受部署影响**（见 §6）。

### 3.4 数据权威源

| 数据 | 权威源 | 落点 |
|---|---|---|
| 数字人 / MCP 服务 / 技能 / 本体 / 用户 | 管理后台 | `admin-backend/.platform-data/` |
| 本体与技能的市场来源 | 本体平台 optonto | 只读挂载 `.data/onto_market` |
| 运行期用户数据（会话、文件、用量） | `agent-backend` | `agent-backend/.opt-agent/` |
| 模型清单与密钥 | `agent-backend/config.yaml` + `.env.local` | 不入库 |

---

## 4. 模块说明

### 4.1 agent-backend（运行端）

分层：`routes/`（HTTP 与 SSE，14 个路由模块）→ `domain/`（纯业务：Agent 实例池、HITL 闸门、提示词组装、
上下文池、工具记录、后台产出、会话存储、文件沙箱）→ `infra/`（LLM 抽象、MCP 客户端、签名、SQLite、调度器）。

值得先知道的几个点：

- **Agent 实例池**：按 `(用户, 数字人)` 复用实例，空闲 30 分钟回收。
- **上下文池**：滚动摘要 + 工具结果按预算回灌，归档游标只有一个权威源，不会出现空洞。
- **降级可感知**：MCP 连接失败退避重连（用尽后转 120s 保活）、LLM 失败归类成可读错误码、
  意图聚焦超时静默跳过——原始错误一律进结构化日志。
- **数据隔离**：三空间与会话都是**数字人级**（`user-data/{数字人}/`），同一用户的数字人互不可见。

### 4.2 frontend（对话工作台）

三栏布局：历史会话 / 对话区 / 内容预览。核心 composable：`useChatStream`（SSE 与中断重发）、
`useChatPanel`（中栏装配）、`useInteractionForm`（HITL 递归表单）、`useWorkspace`（三空间）、
`useProduced`（后台产出）、`usePreview`（预览与放大）、`useMcpReadyGate`（发送前等 MCP 就绪，超时降级放行）。

展示层的格式化只有一处实现：`src/utils/format.ts`（函数名自带单位，如 `formatDurationMs`）。

### 4.3 admin-backend（管理端）

- `domain/config-center/`：数字人设计态（灵魂设计与 `soul-design.ts`、工具、技能、MCP、场景）。
- `domain/mcp/`：MCP 服务登记、工具白名单、请求头（明文存、响应只回掩码）、调用配置、连通性测试。
- `domain/skill-library/`、`domain/ontology/`：技能库与本体库（均可从本体市场整包导入，导入后只读）。
- `domain/deploy/`：部署预览与下发；`infra/opt-agent-writer.ts` 负责原子写入与回滚。
- 质量门禁脚本：`check:lines`（单文件 ≤500 行）、`check:deps`（依赖边界）、`check:contract`（错误码契约）。

### 4.4 admin-frontend（管理后台）

五个导航：**MCP 服务 · 本体管理 · SKILL 管理 · 数字人设计 · 数字人部署**。构建 `base: '/admin/'`，
生产由网关按前缀分发静态资源。

### 4.5 三个 MCP 服务

| 服务 | 工具 | 形态 | 特点 |
|---|---|---|---|
| ocr | `ocr_image` 等 | 同步 | 回源下载签名直链 → 识别 → 结构化输出 |
| jev | `noul` / `choice` / `score` | 同步 | state 可来自 LLM 文本或引用文件；有界指数退避 |
| bom | `bom_validate` / `bom_merge` | 同步 | 递归展开多级 BOM，产出 xlsx + HTML 报告并**回写平台**，自身不写磁盘 |

三者的共同点：**不共享用户磁盘**，只接受 http/https 直链、限时限大小、不跟随重定向。

### 4.6 外部集成

- **排产数据服务**（`192.168.0.188:8080`）：数据展示页 `/datapage/:pageid` 与排产结果页 `/taskresult`
  经 `/dataApi/` 调用（Vite dev proxy 与网关各配一份，前缀由代理剥掉）；同一上游的 `hd-algorithm` MCP
  （`/mcp`）提供排产求解，其中提交类工具在平台侧配置了人工确认。
- **本体平台 optonto**：本体（`ontology.yaml` + `securities.yaml`）、技能、自建发布函数三条通道，
  平台侧**只读消费**，导入后进入设计态再部署下发。

### 4.7 意图聚焦（可选能力）

每轮对话前用 Laya 判定「这句话是否指向某个工具」，命中则追加聚焦提示，减少多工具场景下的误选。
`config.yaml` 的 `intent_focus` 整块缺失 = 功能关闭（不影响启动）；块存在但字段不全 = 启动失败（防半配置）。

---

## 5. 配置

### 5.1 配置地图

| 文件 | 归属 | 本地形态 | 容器形态 |
|---|---|---|---|
| `agent-backend/.env.local` | 运行端私产（gitignore） | `dev/start` 唯一读取 | compose `env_file` 注入（提供密钥） |
| `agent-backend/.env` | 入库 | 不读 | 注入基础配置 |
| `agent-backend/config.yaml` | 运行端 | 直接读 cwd | 只读挂载进容器 |
| `admin-backend/.env.local` | 管理端私产 | 唯一读取 | — |
| `admin-backend/.env` | 入库 | 不读 | 注入容器形态路径 |
| `<服务>/.env.local`（ocr/jev/bom/laya） | 各服务私产 | 各自读 | compose 注入，缺失不报错 |

两种形态从不同文件出发**不混用**：本地是源码树相对路径 + `127.0.0.1`，容器是 `/app/...` + 服务名。

### 5.2 换机器时必看的三项

```env
# agent-backend/.env.local
DEEPSEEK_API_KEY=sk-...                  # 或换成 config.yaml 里其它模型
PUBLIC_BASE_URL=http://<本机 LAN IP>:3000  # 签名直链基址，MCP 服务从这台机器下载文件
FILE_SIGN_SECRET=<≥16 字符>               # 不配则每次启动随机生成，重启后旧直链全失效
```

`PUBLIC_BASE_URL` 的判据只有一条：**它对所有会下载/回写的 MCP 服务都必须可达**。所以不能写 `localhost`
（那是容器自己），要用 LAN IP 或 `host.docker.internal`。

### 5.3 关键运行参数（`agent-backend/.env.local`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 管理端固定 3001，避开 |
| `OPT_AGENT_ROOT` | `.opt-agent` | 运行数据根（用户、会话、用量库） |
| `POOL_SIZE` | 5 | 单机 Agent 实例上限 |
| `IDLE_TIMEOUT_MS` | 1800000 | 实例空闲回收 |
| `MCP_TIMEOUT_MS` | 60000 | 单次工具调用超时（超时重试 1 次；长任务应改用异步） |
| `MCP_CONNECT_TIMEOUT_MS` | 10000 | 建连超时，与调用超时分开（用户在等首轮回复） |
| `UPLOAD_MAX_MB` | 5 | 上传与回写统一上限（网关与 MCP 服务须对齐） |
| `LLM_MAX_RETRIES` / `LLM_RETRY_MAX_DELAY_MS` | 2 / 15000 | 只在响应到达前重试，不会产生重复正文 |

### 5.4 意图聚焦块（`config.yaml`）

```yaml
intent_focus:
  base_url: http://laya:8000       # 本地直跑 backend 时用 http://127.0.0.1:8103
  model: laya-multilingual
  api_key: $DECIS_API_KEY          # 与 laya 容器的 DECIS_API_KEY 必须同值
  timeout_ms: 10000                # 300~10000，超时即降级
  threshold: 0.6                   # 可被环境变量 INTENT_FOCUS_THRESHOLD 覆盖
```

---

## 6. 文件空间与运行数据

```text
agent-backend/.opt-agent/
├── logs/                                 结构化日志
├── usage.db                              Token 用量（SQLite）
└── users/{uid}/
    ├── agents/{数字人}/                   ← 部署产物，整体覆盖
    │   ├── SOUL.md                       人格与规则
    │   ├── TOOL.json                     内置工具开关
    │   ├── MCP.json                      MCP 服务与工具白名单（含请求头）
    │   ├── scenario.json                 数据准备空间的二级目录清单
    │   ├── skills/{技能}/                 技能文件
    │   └── ontology/{场景}/{本体}/        ontology.yaml + securities.yaml
    └── user-data/{数字人}/                ← 用户数据，部署不动
        ├── 数据准备/                      Agent 只读；二级目录由 scenario.json 决定
        ├── 共享空间/                      Agent 只读
        ├── 临时空间/                      Agent 可读写；产出强制 `{thread_id}_` 前缀
        │   └── 后台产出/                  异步 MCP 回写落点
        └── threads/{会话}/                消息、工具记录、摘要
```

规则：**临时空间 30 天未访问自动清理**（取 `max(atime, mtime)`，正在被引用的不会被误删）；
`scenario.json` 缺失或损坏时空间骨架照常创建，接口回可读错误 `SCENARIO_NOT_CONFIGURED`，服务不中断。

---

## 7. MCP 接入

### 7.1 字段总表（平台侧）

| 字段 | 必填 / 默认 | 取值与作用 |
|---|---|---|
| `name` | 必填 | 字母/数字/`_`/`-`，1~64 字符；成为**工具前缀** `{name}__{tool}` |
| `transport` | 必填 | `http`（= streamable-http）或 `stdio`，不支持 SSE |
| `url` | http 必填 | 容器内互访用服务名，宿主机服务用 LAN IP |
| `command` / `args` | stdio 必填 command | 拉起本地进程 |
| `headers` | `{}` | 请求头 / 访问令牌；**明文存、响应只回掩码**，掩码不能当值提交 |
| `allowed_tools` | **新建必填非空** | 工具白名单；空数组在语义上是"不限制"，故被拒；**创建后可二次调整**（全量替换） |
| `tool_labels` | `{}` | 工具的人读名称，用于平台清单与意图聚焦命题；不影响调用名 |
| `file_args` | `{}` | `{工具名: {参数路径: url \| url:from=<来源>}}`，把文件路径铸成签名直链 |
| `confirmation` | `never` | `never` / `always` / `{tools:[...]}`；**写操作应设 `always`** |
| `rules_fields` | `{}` | 声明哪个入参承载「算法规则」，HITL 弹窗据此给选择入口 |

保存语义统一：**不携带 = 沿用存量，提供 = 全量替换**（`{}` 即清空）。改完配置对所有引用它的数字人生效，
但需**重新部署**才落到运行端。

### 7.1.1 工具参数的显示名（`title` 约定）

HITL 弹窗的字段主标签 = `inputSchema.properties.{字段}.title`，**没有** `title` 时显示参数名本身；
`description` 收进「?」气泡，不占版面。因此服务侧的 `title` 必须满足：

- **同层唯一**：同一工具、同一对象、同一张表内不允许两个字段同名（重复时运行端只保留先出现的，
  其余回退英文参数名——能用但难读）；
- **写人话**：中文短名（≤6 字为佳），不要用 SDK 自动生成的 `Image` / `State File` 这类排版变体，
  与参数名只差大小写或分隔符时会被判为无信息而忽略；
- **别塞说明**：`title` 只回答"这是什么"，取值规则、格式、取值范围一律写进 `description`。

工具级显示名同一套思路：`tool_labels` → 服务端 `tool.title` → `{服务名}: {工具名}`，运行端算一次后
随工具事件与 HITL 快照一起下发。工具卡片与确认弹窗都显示它，原始调用名（`{服务名}__{工具名}`）
留在 `title` 悬停里便于核对日志；没有中文名时界面直接显示调用名。

### 7.2 平台代劳的三件事

| 能力 | 服务侧要做的 | 平台做的事 |
|---|---|---|
| 入参铸造 | 工具接受一个"文件地址" | 把文件空间相对路径铸成签名读直链；派生模式可从来源字段推导并覆盖 |
| 结果回写 | `inputSchema.properties` 顶层声明 `resultUrl`（**不放 required**） | 注入签名写直链（12h）、对模型隐藏该参数 |
| 视图入口 | 返回 JSON 里给 `viewUrl` / `filePath`（+ `Name`） | 抽成 sidecar 随记录下发，前端渲染可点入口 |

未声明的参数**一个字段都不碰**；漏声明 `file_args` 的后果是服务收到相对路径并报错。

### 7.3 异步回写（长耗时计算）

同步工具受 `MCP_TIMEOUT_MS`（60s）约束且超时会重试，长任务必须异步化：

```http
POST {resultUrl}&filename={job_id}.json&summary=<一行结论>
Content-Type: application/json
{ "status": "success" | "failed", "message": "...", ... }
```

硬规则：保留 `resultUrl` 原有 query（用 URL 解析器追加参数）；`filename` 不含路径分隔符；
`summary` **必须给**（界面标题的唯一来源，≤200 字符，失败结论前置）；**失败也要回写**，否则界面上什么都
不出现，用户无法区分"还在算 / 失败"；单次 ≤5MB。

平台响应：`202 {"path":"临时空间/后台产出/…"}` / `403` 验签失效 / `400` 参数非法 / `413` 超限。

### 7.4 部署产物 `MCP.json`

只有非空字段才写入，所以"字段缺席"= 不启用：

```jsonc
{ "servers": [{
  "name": "jev",
  "transport": "http",
  "url": "http://jev:8000/mcp",
  "headers": { "X-MCP-Token": "…" },
  "file_args": { "noul": { "state_file": "url" } },
  "confirmation": "always",
  "rules_fields": { "noul": "input.targetPriorities" },
  "allowed_tools": ["noul", "choice"],
  "tool_labels": { "noul": "命题真假判断" }
}]}
```

运行端加载时**手写校验**（与平台同构）：缺字段按"不启用"处理，配置损坏则跳过该数字人并告警。

### 7.5 运行端行为与默认值

| 项 | 行为 |
|---|---|
| 工具名 | `{服务名}__{工具名}`；显示名优先级：平台 `tool_labels` > 服务端 `Tool.title` > `server: tool` |
| 白名单 | 未声明或空数组 = 不限制；否则只挂白名单内工具 |
| 断线 | 5s → 15s → 30s → 60s → 60s，用尽后每 120s 保活重试，服务恢复自动接回（不用重启后端） |
| 健康探测 | 每 60s：优先 MCP `ping`，遇到 `-32601` 则记下并回退 `listTools` |
| 调用超时 | 默认 60s，超时重试 1 次 |
| 预热 | 进入工作台 / 切换数字人时前端调 `POST /api/agents/current/mcp/warm`；点发送时若仍灰着，最多等 10s，仍未就绪则降级放行并提示 |

### 7.6 故障对照

| 现象 | 原因与处置 |
|---|---|
| 新建服务直接 401 | 该服务需要访问令牌：在「请求头」填 `{"X-MCP-Token":"…"}` |
| 报"收到的是相对路径" | 该入参没在 `file_args` 声明 → 补 `{工具名: {"参数": "url"}}` |
| 模型编造 http 地址 | 改用派生模式 `url:from=<来源字段>`（覆盖模型填写并对其隐藏） |
| 异步工具算完，界面无条目 | 该工具 schema 未声明 `resultUrl`，运行端按同步处理，没有回写地址 |
| 工具灰着/不可用 | 看平台连通性测试；服务重启后应自动接回，仍灰则查白名单与 `allowed_tools` |
| 回写/下载 `ConnectTimeout` | 防火墙丢了容器→宿主的包（见 §8.2） |
| 回写 `HTTP 403` | 票据过期（回写 12h / 下载 24h）或改过 `FILE_SIGN_SECRET` |
| `/api/health` 404 | 路径不存在，不是故障：健康检查是 `/api/monitor/health` |

---

## 8. 生产部署（Docker）

### 8.1 入口与编排

- 全部外部流量走 `gateway:82`；容器之间用服务名互访，宿主端口只为「后端不在容器里」的本地调试而发布。
- `agent-backend/.opt-agent` 与 `admin-backend/.platform-data` 都是 **bind mount**：容器与源码目录同一份数据。
- 日志 `json-file` 轮转 10MB × 3；后端 `stop_grace_period: 25s`（应用内等 15s 让在途回答收尾）。
- 改了网关配置必须 `docker compose up -d --build gateway`（配置在镜像里，`restart` 不生效）。

### 8.2 `PUBLIC_BASE_URL` 与容器→宿主放通

`PUBLIC_BASE_URL` 由 `docker-compose.yml` 的 `backend.environment` **单点覆盖**（`.env.local` 里的同名项在容器形态下不生效）：

| 场景 | 取值 |
|---|---|
| 所有 MCP 服务都在 compose 网络内 | `http://backend:3000` |
| 存在**外部** MCP 服务（如 `192.168.0.188` 的排产/算法服务） | `http://<宿主 LAN IP>:82` |

取宿主入口时，容器访问「宿主 IP:82」会落进宿主 `INPUT` 链，而 ufw/firewalld 默认入站 DROP，
表现是 **SYN 无响应 → 10 秒后回写超时**。先取真实网段再放通（任选一种，务必持久化）：

```bash
docker network inspect optagent_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 例 172.26.0.0/16
sudo ufw allow from 172.26.0.0/16 to any port 82 proto tcp comment 'docker->gateway'
# 或：sudo iptables -I INPUT 1 -s 172.26.0.0/16 -p tcp --dport 82 -j ACCEPT（需自行持久化）
# 或：sudo firewall-cmd --permanent --zone=trusted --add-source=172.26.0.0/16 && sudo firewall-cmd --reload
```

若宿主 82 无监听（`userland-proxy=false`），改用 nat 表给容器来源补 DNAT 到 gateway 容器 IP。

### 8.3 上线验证

```bash
docker exec optagent-backend printenv PUBLIC_BASE_URL          # 期望与实际入口一致
curl -s -o /dev/null -w '%{http_code}\n' http://<宿主 IP>:82/api/monitor/health
docker exec optagent-ocr python -c "import urllib.request as u;print(u.urlopen('http://<宿主 IP>:82/api/monitor/health',timeout=5).status)"
curl -s -o /dev/null -w '%{http_code}\n' http://<宿主 IP>:82/admin/
```

业务级验证：跑一次异步任务（排产提交 / BOM 合并），结果应出现在「临时空间/后台产出/」，容器日志不再有回写超时。

### 8.4 运维要点

- 环境变量**启动期读取**：改 `.env` 后要 `up -d --force-recreate <服务>`，`restart` 不更新。
- 换机器/换网段：改 `docker-compose.yml` 的 `PUBLIC_BASE_URL` 与平台内 MCP 服务的 `url` 两处即可。
- `admin-backend` 不再挂 `docker.sock`、不读编排文件与容器状态——MCP 服务清单一律以平台内配置为准。

---

## 9. 开发与质量门禁

| 目的 | agent-backend | admin-backend | frontend | admin-frontend |
|---|---|---|---|---|
| 开发 | `npm run dev` | `npm run dev` | `npm run dev` | `npm run dev` |
| 类型检查 | `npm run typecheck` | `npm run typecheck` | `npm run typecheck` | `npm run typecheck` |
| 单元测试 | `npm run test`（`test:all` 含集成） | `npm run test` | `npm run test` | `npm run test` |
| 覆盖率 | `npm run test:coverage` | `npm run test:coverage` | `npm run test:coverage` | `npm run test:coverage` |
| 代码风格 | `npm run lint` | `npm run lint` | `npm run lint` / `format:check` | `npm run lint` / `format:check` |
| 结构门禁 | — | `check:lines` / `check:deps` / `check:contract` | — | `check:lines` / `check:deps` |

- Python 服务测试**只在宿主机跑**（容器不承担测试职责）：
  `cd ocr-service && pip install -r requirements-test.txt && python -m pytest -q tests`（jev / bom 同理）。
- 覆盖率是两层阈值：全局「防倒退地板」（只可上调）+ 受门禁约束模块的 80%。新增或改动模块必须配同名测试。
- 开发前先读 `.specify/memory/constitution.md`：它约束两侧同改、单文件 ≤500 行、测试完备、优雅降级等九条原则。
- 需求与设计细节在 `specs/`：001 平台、002 运行端，以及 004 灵魂设计、006 @引用浮层、007 下一步提示、
  008 上传类型、009 数据隔离、010 消息渲染、011 预览放大、012 上传命名、013 意图聚焦。

---

## 10. 文档索引

| 文档 | 内容 |
|---|---|
| `docs/architecture/01~04-*.svg` | 业务 / 数据 / 技术 / 应用架构图（阅读顺序见 `docs/architecture/README.md`） |
| `docs/architecture/review-2026-10-08.md` | 架构评审与遗留风险清单 |
| `异步MCP服务接入约定.md` | 异步受理 → 回写全链路、字段形状、示例 |
| `specs/` | 各特性的需求、设计、契约与任务记录 |
| `.specify/memory/constitution.md` | 项目宪章（开发约束的唯一落点） |

---

## 11. 已知限制

| 限制 | 影响 | 现状 |
|---|---|---|
| 无登录 / 无鉴权 | 不能暴露公网 | 运行端固定 `admin` 用户，JWT 接口已预留 |
| MCP 请求头明文落盘 | 设计态文件泄露即令牌泄露 | 响应只回掩码，掩码不能当值提交 |
| `MCP.json` 无 `schema_version` | 跨端契约无版本号 | 靠同构手写校验兜底 |
| 单机实例池 | 水平扩展需外置会话存储 | 池容量 `POOL_SIZE`，空闲回收 |
| 部分存量模块无测试 | 覆盖率地板低于 80% 全局 | 只约束新增与本次改动，不追溯 |
