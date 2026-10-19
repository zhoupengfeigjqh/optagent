# OptAgent 智能体平台

智能体（Agent）应用平台。平台分两端：

- **Agent 端**：面向使用者的对话式智能体，支持 MCP 工具调用（**调用记录随会话持久化，刷新后仍可见**）、人工确认（HITL）、文件空间、**后台产出**（异步 MCP 任务完成后自动汇入「后台记录」，可在后续对话中读取）、多会话管理
- **数字人管理平台**：面向运营/管理员的管理后台，管理数字人（Agent）、**本体**、技能、MCP 服务与平台配置，并负责把配置下发部署到运行端

OCR 表格识别与 Jev 决策（TypeSafe System One）作为 MCP 工具服务独立部署（Docker）。

平台还支持从**本体平台（optonto）**提取三类资产——**本体**、**技能**、**MCP 服务**（含需要访问令牌的
「自建发布」服务）——并在设计态把它们装配给数字人、随部署下发到运行端。链路与当前已提取的清单见
[与本体平台（optonto）的集成](#与本体平台optonto的集成)。

## 总体架构

```
┌────────────┐   ┌────────────┐         ┌─────────────────┐
│  frontend  │   │ admin-     │         │  admin-backend  │
│ (Agent 对话)│   │ frontend   │────────▶│ (数字人管理/下发) │
│  :5173     │   │ (管理后台)  │  :3001  │     :3001       │
└─────┬──────┘   └────────────┘         └────────┬────────┘
      │ SSE/REST                                 │ 下发配置
      ▼                                          ▼
┌─────────────────┐         ┌───────────────────────────┐
│  agent-backend  │─file───▶│  ocr-service (Docker)     │
│ (Agent 运行时)   │ 签名直链  │  Excel/图片表格识别 MCP    │
│  :3000          │ 回源下载  │  :8000                    │
│                 │         └───────────────────────────┘
│                 │         ┌───────────────────────────┐
│                 │─MCP────▶│  jev-service (Docker)     │
│                 │         │  Jev 决策（System One）MCP │
│                 │         │  :8101 → :8000            │
│                 │         └───────────────────────────┘
│                 │         ┌───────────────────────────┐
│                 │─file───▶│  bom-service (Docker)     │
│                 │ 签名直链  │  BOM 校验 / 合并 MCP       │
│                 │         │  :8102 → :8000            │
└─────────────────┘         └───────────────────────────┘
```

`bom-service` 是唯一「产出文件并交给用户下载」的 MCP 服务：合并后的 xlsx 由**服务自己**落盘到
产出目录（容器内 `/app/.data`，bind mount 到宿主机 `bom-service/.data`）并铸造下载直链
（`http://<宿主机>:8102/files/{产出名}`），平台把它渲染成聊天区入口行，用户点开即下载——
二进制不经过模型上下文，也不走「后台记录」（这是同步工具，返回时结果已经算完）。

除同步调用外，MCP 服务也可走**异步**：运行环境为声明过的工具注入 `resultUrl`，服务立即返回受理，
算完后 POST 回写结果 → 落盘到 `临时空间/后台产出/` → 前端铃铛「后台记录」出现条目，模型可在后续
对话中用 `read_file` 读取。约定详见 [`异步MCP服务接入约定.md`](./异步MCP服务接入约定.md)。

### 资产提取链路（本体 · 技能 · MCP 服务）

本体平台（optonto）是**本体、本体技能、本体函数服务**的权威源；数字人管理平台对市场侧**只读**，
提取来的内容一律先落平台设计态，再由部署下发到运行端：

```
本体平台 optonto（权威源，与本平台同机运行）
  ├─ 本体市场   .data/onto_market/{场景}/{本体}/ ─► ① 只读导入 ─► 平台「本体管理」
  ├─ 本体技能   {场景}/{本体}/skills/{技能目录}  ─► ① 只读导入 ─► 平台「SKILL 管理」
  └─ 自建发布   :8021 / :8022（动态容器，需访问令牌）
                                                 ─► ② 登记为 MCP 服务（填 url + 请求头 X-MCP-Token）
                                                       └─► ③ 部署物化：MCP.json（含 headers）+ 技能文件
                                                             └─► agent-backend 运行时：模型可见的工具 / 技能
```

三条通道的细节、当前已提取的清单与操作步骤见 [与本体平台（optonto）的集成](#与本体平台optonto的集成)。

### 架构图（SVG）

| 图 | 文件 | 关注点 |
|---|---|---|
| 业务架构 | [`01-business-architecture.svg`](./docs/architecture/01-business-architecture.svg) | 角色 · 业务能力域 · **OLTP-OLAP 闭环** · 价值与边界 |
| 数据架构 | [`02-data-architecture.svg`](./docs/architecture/02-data-architecture.svg) | 数据来源 · 存储与唯一权威源 · 消费方 · 治理口径 |
| 技术架构 | [`03-technology-architecture.svg`](./docs/architecture/03-technology-architecture.svg) | 技术栈 · 部署形态 · 协议与端口 · 横切关注点 |
| 应用架构 | [`04-application-architecture.svg`](./docs/architecture/04-application-architecture.svg) | 模块划分 · 跨应用链路 · 分层与工程约束 |

图形约定与阅读顺序见 [`docs/architecture/README.md`](./docs/architecture/README.md)。

## 目录结构

```
optagent/
├── agent-backend/          # Agent 运行时后端（Fastify + Node ≥ 20，端口 3000）
│   └── src/
│       ├── routes/         # HTTP 接口层（12 个路由模块）
│       ├── domain/         # 领域层：纯业务逻辑，不依赖框架
│       ├── infra/          # 基础设施层：LLM、MCP、签名、数据库
│       ├── config.ts       # 配置加载（.env + config.yaml，启动校验）
│       ├── server.ts       # Fastify 装配与启动
│       ├── context.ts      # 请求上下文（当前用户/数字人）
│       ├── logging.ts      # 结构化日志（实例标识、字段脱敏）
│       ├── graceful-shutdown.ts  # 优雅关闭（等在途回答收尾）
│       └── types.ts        # 跨层共享类型
│
├── frontend/               # Agent 对话前端（Vue 3 + Vite，端口 5173）
│   └── src/
│       ├── api/            # 后端接口封装与类型
│       ├── components/
│       │   ├── chat/       # 对话区：消息流、工具调用卡片、输入框(Composer)、HITL 弹窗、@引用面板
│       │   ├── layout/     # 应用骨架：历史侧栏、文件空间面板、空间树
│       │   └── common/     # 通用组件（按钮/弹窗/图标等）
│       ├── composables/    # 状态与逻辑：会话流、@文件引用、路径插入、工作区、后台产出、预览、会话内搜索
│       ├── constants/      # 常量
│       ├── styles/         # 全局样式
│       └── utils/          # 工具函数（SSE 解析、搜索分段、空间/文件判定、产出与工具记录展示、会话恢复）
│
├── admin-backend/          # 数字人管理平台后端（端口 3001）
│   ├── src/
│   │   ├── routes/         # agents / mcp / ontologies / skills / builtin-tools / deploy / users / references / platform
│   │   ├── domain/         # 配置中心、部署、MCP、**本体**、技能库（含本体市场导入）、审计、错误码
│   │   └── infra/          # MCP 连接测试、运行时客户端、配置下发、设计态存储、路径探测
│   └── .platform-data/     # 设计态数据（运行期生成，不入库）：agents / skills / onto_market / users / mcp-services.json
│
├── admin-frontend/         # 数字人管理平台前端（Vue 3 + Vite，端口 5174）
│   └── src/
│       ├── components/
│       │   ├── agents/     # 数字人管理
│       │   ├── mcp/        # MCP 服务管理
│       │   ├── ontology/   # 本体管理（只读浏览 + 从本体市场导入 / 更新）
│       │   ├── skills/     # 技能库管理
│       │   ├── deploy/     # 部署/下发
│       │   ├── layout/     # 后台布局
│       │   └── common/     # 通用组件
│       ├── composables/    # 各模块状态逻辑
│       ├── api/            # 接口封装
│       └── router.ts       # 路由（含路由测试）
│
├── ocr-service/            # OCR MCP 服务（Docker，端口 8000）
│   ├── server.py           # MCP 服务入口（FastMCP / StreamableHTTP）
│   ├── ocr_core.py         # 表格识别核心（含回源 SSRF 白名单校验）
│   └── tests/              # 服务端测试
│
├── jev-service/            # Jev 决策 MCP 服务（Docker，宿主机端口 8101）
│   ├── server.py           # MCP 服务入口（FastMCP / StreamableHTTP）
│   ├── jev_core.py         # 决策调用核心（state 合并、重试退避、错误映射、回源白名单）
│   └── tests/              # 服务端测试
│
├── bom-service/            # BOM 校验/合并 MCP 服务（Docker，宿主机端口 8102）
│   ├── server.py           # MCP 服务入口（FastMCP / StreamableHTTP）+ 产出下载路由
│   ├── bom_core.py         # 校验与合并管线（S0~S6 阶段、结果形状、产出命名）
│   ├── bom_store.py        # 产出落盘与下载地址铸造（本服务唯一写磁盘处）
│   └── tests/              # 服务端测试
│
├── gateway/                # 生产网关（nginx）
├── specs/                  # 需求/设计规格文档（001 数字人平台、002 对话运行时）
├── 异步MCP服务接入约定.md    # 异步 MCP 服务接入约定（resultUrl 注入 → 受理 → 回写）
└── docker-compose.yml      # Docker 编排（OCR / Jev / BOM 等）；容器形态运行配置的权威源（非 MCP 服务清单来源）
```

## 配置地图：env / config 归属一览

两个后端统一为 **`.env`（入库 = Docker 形态）/ `.env.local`（本机私产 = 本地形态）** 严格分工（2026-09-20）：

| 文件 | 归属 | 消费方 | 说明 |
|---|---|---|---|
| `agent-backend/.env` | 运行环境 | 仅 compose `env_file` 注入容器 | **Docker 形态**配置（端口/路径/超时，**无密钥**，随仓库入库） |
| `agent-backend/.env.local` | 运行环境 | 本地 `--env-file`（仅本地）+ compose 注入（提供密钥） | **本地形态完整配置**（含密钥 + LAN IP），gitignore；样板 `.env.example` |
| `agent-backend/config.yaml` | 运行环境 | `src/config.ts` 启动加载 | 模型清单（model / api_key / base_url，缺省拒启动） |
| `admin-backend/.env` | 管理平台 | compose `env_file` 注入容器 | **容器形态**配置（`/app/...` 路径、服务名，无密钥，入库） |
| `admin-backend/.env.local` | 管理平台 | 仅本地 `--env-file` | **本地形态**配置（宿主机相对路径）；样板 `.env.example`。其中 **`ONTO_MARKET_DIR`** 指向本体平台的本体市场（`../../optonto/.data/onto_market`，平台**只读**）；缺省 = "从本体市场导入"不可用（不影响启动与其余功能） |
| `ocr-service/.env.local` | OCR 服务 | compose `env_file`（`required: false`） | 本机私产：可调项（下载上限、超时）；缺失即用代码缺省值（gitignore；样板 `.env.example`） |
| `jev-service/.env.local` | Jev 服务 | compose `env_file`（`required: false`） | `TYPESAFE_API_KEY` 与上游端点/超时等（含密钥，gitignore；样板 `.env.example`） |
| `bom-service/.env.local` | BOM 服务 | compose `env_file`（`required: false`） | 计算限额（输入/解压/节点上限）、产出保留策略，以及 **`BOM_PUBLIC_BASE_URL`**——下载地址的对外基址，**必须填用户浏览器可达的宿主机地址**（如 `http://192.168.1.3:8102`），否则回退成容器内名 `bom:8000`、用户点不开（gitignore；样板 `.env.example`） |
| `docker-compose.yml` | 编排层 | docker compose | 编排权威源：挂载/网络；**单点覆盖只剩 `PUBLIC_BASE_URL`**（服务变量一律走各服务 `env_file`）。**（2026-09-27）** `admin-backend` 已不再挂载 `docker.sock` 与编排文件本身——平台不读容器编排声明与容器运行态 |

读取规则（2026-09-20 分工，2026-09-23 扩到 MCP 服务，2026-09-28 简化）：
- **容器**：一律由 compose `env_file` 注入**服务自己的**配置——admin 读 `.env`（+ `.env.local`
  追加覆盖）；agent 读 `.env` + `.env.local`（运行需要密钥）；**ocr / jev / bom 只读各自可选的
  `.env.local`**（它们没有"容器形态必需变量"：可调项都有代码缺省值，故 2026-09-28 起不再有
  入库的 `.env`）。**compose 文件本身不逐行配置服务变量**；唯一的 `environment` 单点覆盖是
  `PUBLIC_BASE_URL`（容器内必须是服务名口径，本机 LAN IP 只留在 `.env.local`）；
- **本地**：dev/start 只读 `.env.local`（`--env-file=.env.local`），不读 `.env`。
  `.env.local` 是**完整的本地形态配置**（非增量覆盖），样板 `.env.example` 含两形态完整对照。
换机器/换网络时只需改**一处**：`agent-backend/.env.local` 的 `PUBLIC_BASE_URL`——它决定
签名直链的 host，也就是 MCP 服务回源下载的目标。原先还要求 ocr / jev 各写一份同值白名单，
该白名单已于 **2026-09-28 移除**（回源地址由运行环境**单点铸造**，服务侧不再各自验一遍
主机名；理由与替代控制见下「本地配置要点」）。

## 功能模块说明

### agent-backend（Agent 运行时后端）

**接口层 `routes/`**

| 模块 | 作用 |
|---|---|
| `chat.ts` | 对话接口（SSE 流式输出），Agent 执行主链路 |
| `agents.ts` | 数字人（Agent）列表/切换/配置 |
| `files.ts` | 文件空间：三空间汇总、上传/删除、**签名直链铸造与回源下载** |
| `files-put.ts` | **后台产出回写端点**（异步 MCP 服务 POST 结果落盘；因 ≤500 行门禁自 `files.ts` 拆出） |
| `threads.ts` | 会话（线程）管理与历史；**工具调用记录**（详情附带 + 外置正文懒加载端点） |
| `models.ts` | 模型列表/选择 |
| `builtin-tools.ts` | 内置工具开关与配置 |
| `monitor.ts` | 运行监控（事件流） |
| `usage.ts` / `mcp-call-stats.ts` | Token 用量统计 / MCP 调用统计 |
| `produced.ts` | **后台产出**：列表 / 单条正文 / 批量标记已读 / SSE 变更信号 |
| `feedback.ts` | 对话反馈（点赞点踩） |

**领域层 `domain/`（纯业务逻辑）**

| 模块 | 作用 |
|---|---|
| `agent-pool.ts` / `agent-instance.ts` / `agent-catalog.ts` | Agent 实例池与目录管理（多用户隔离复用） |
| `current-user.ts` / `current-agent.ts` | 当前用户 / 当前数字人解析 |
| `interaction-gate.ts` / `interaction-schema.ts` | **HITL 人工确认**：工具调用挂起、倒计时、schema 驱动表单生成 |
| `rule-file.ts` / `rules-field-path.ts` | HITL「算法规则」：规则文件解析 + `rules_fields` 对象路径求值 |
| `file-access.ts` / `fs-safe.ts` / `dirs.ts` | 文件访问安全：user-data 沙箱路径解析、越权拦截 |
| `file-arg-path.ts` | MCP 文件参数声明解析（`file_args`：`url` / `url:from=` 模式） |
| `mcp-transport.ts` / `mcp-events.ts` | MCP 连接生命周期与状态事件 |
| `run-manager.ts` | 运行任务管理（中断/恢复/快照） |
| `prompt-builder.ts` / `context-window.ts` | 提示词组装（纯函数：滚动摘要 + 工具结果按预算回灌 + 产出段）/ 上下文池与归档游标（单一权威源，无空洞） |
| `run-impl.ts` / `run-events.ts` / `message-format.ts` | Run 实例与事件类型、消息标识/格式化（按 ≤500 行门禁自 `run-manager.ts` 拆出） |
| `tool-events.ts` / `tool-context.ts` / `tool-result.ts` | **工具调用记录**：事件落盘与体积分流、上下文回灌投影、结果序列化与外置命名 |
| `produced.ts` / `produced-events.ts` | **后台产出**：sidecar 落盘与「目录即索引」投影；进程内变更信号（驱动铃铛 SSE） |
| `builtin-tool-catalog.ts` | 内置工具元数据的**单一来源目录**（装配时渲染给模型） |
| `thread-store.ts` / `history.ts` / `summary.ts` | 会话/消息/摘要持久化 |
| `tools/` | 内置工具实现：计算器、读/写文件、列目录、内容检索 |
| `field-check.ts` / `tmp-cleanup.ts` / `config-fingerprint.ts` | 字段校验 / 临时目录清理 / 配置指纹 |

**基础设施层 `infra/`**

| 模块 | 作用 |
|---|---|
| `llm/` | LLM 提供商抽象（`llm-provider.ts`）与实现（`pi-ai-provider.ts`） |
| `mcp/` | MCP 客户端管理（`mcp-manager.ts`，含**连接状态自愈**：退避用尽后保活重连 + 定期主动健康探测）与工具适配（`mcp-tool-adapter.ts`） |
| `agent-loop.ts` | Agent 主循环：LLM 流 → 工具调用 → 结果回填 |
| `tool-intercept.ts` | 工具调用拦截（HITL 挂起点） |
| `file-sign.ts` | 签名直链 HMAC 签名/验签 |
| `usage-db.ts` | 用量数据存储 |
| `scheduler.ts` | 定时任务（如临时文件清理） |
| `builtin-tools.ts` | 内置工具 → AgentTool 适配（异常翻译为可读文本，对话不中断） |
| `agent-factory.ts` | Agent 实例工厂 |

### frontend（Agent 对话前端）

| 模块 | 作用 |
|---|---|
| `components/chat/` | 消息气泡与 Markdown 渲染、Composer 输入框（**@ 文件引用**三级级联面板）、**InteractionDialog + InteractionField**（HITL 通用表单：schema 驱动**递归**控件映射——对象逐行、对象数组→表格、标量数组→列表、其余走 JSON 逃逸舱——外加 @ 路径引用、结构化文件卡片、算法规则入口）、MentionPicker、**ToolCallList**（工具调用卡片：内联结果展开即见、外置正文按需拉取、已清理时降级展示）、**ProducedBell + ProducedJsonView**（后台产出铃铛：未读角标、列表⇄正文双视图、结构化展示）、RulePickerDialog、SessionSearch、ThinkingBlock / ThinkingToggle |
| `components/layout/` | 应用骨架：历史会话侧栏、文件空间面板（空间树 + 文件列表 + 上传） |
| `composables/useChatStream.ts` | 会话流核心：SSE 接收、消息追加、中断/重发、HITL 快照恢复 |
| `composables/useFileMention.ts` | 聊天输入框 @ 引用状态机（触发检测、级联导航、引用登记、提交剥离） |
| `composables/usePathInsert.ts` | HITL 弹窗 @ 路径插入状态机（路径插入语义，复用 MentionPicker 面板协议） |
| `composables/useInteractionForm.ts` | HITL 弹窗表单状态：结构化模型（唯一事实源）、JSON 草稿（逃逸舱）、算法规则入口落点与写回、校验与提交构建 |
| `composables/useWorkspace.ts` | 文件空间数据（三空间汇总、目录文件加载） |
| `composables/useAppSession.ts` | 会话上下文（provide/inject 总线：workspace、toast 等） |
| `composables/useThreads.ts` / `useAgents.ts` / `useModels.ts` | 会话/数字人/模型数据管理 |
| `composables/useUploads.ts` | 文件上传队列 |
| `composables/useProduced.ts` | 后台产出 store：列表 / 未读数（自算）/ 标记已读 / 信号订阅 |
| `composables/usePreview.ts` | 右侧面板「文件列表 ⇄ 内容预览」双视图 |
| `composables/useChatPanel.ts` | 中栏装配 view-model（跨 composable 事件编排，使 ChatPanel 满足 ≤500 行） |
| `composables/useSessionSearch.ts` | 会话内搜索与命中定位（与高亮同一匹配口径） |
| `composables/useToast.ts` | 轻量提示队列（aria-live、最多 3 条、4s 自动消失） |
| `composables/useResizablePanel.ts` | 侧栏宽度拖拽 |
| `utils/tool-calls.ts` | 工具调用记录的展示模型（历史态与流式态统一、体积与耗时格式化） |
| `utils/produced-content.ts` / `utils/produced-display.ts` | 产出正文解析（对象/数组结构化，否则回落 `<pre>`）/ 角标与时间、体积格式化 |
| `utils/sse-parser.ts` / `utils/segments.ts` / `utils/error-message.ts` | SSE 帧解析 / 搜索高亮分段 / 错误信息归一 |
| `utils/arg-schema.ts` / `utils/arg-values.ts` / `utils/json-path.ts` / `utils/file-kind.ts` / `utils/space.ts` / `utils/format.ts` | HITL 入参 schema 与取值、JSON 路径、文件类型与空间判定、格式化 |
| `utils/thread-restore.ts` | 会话恢复：URL `?thread=` 与本地存储的读写（刷新后回到原会话） |

### admin-backend（数字人管理平台后端）

| 模块 | 作用 |
|---|---|
| `domain/config-center/` | 配置中心：数字人/MCP/技能的配置模型与校验 |
| `domain/deploy/` | 部署编排：把配置下发到 agent-backend 运行时 |
| `domain/skill-library/` | 技能库管理（含**本体市场导入**：整包目录复制 + 内容指纹判"可更新"，来源标 `onto_market:{场景}/{本体}`，导入后**只读**） |
| `domain/ontology/` | **本体库**：本体快照（`ontology.yaml` + `securities.yaml`，**两个均为必需文件**）的导入 / 更新 / 删除与元数据解析；索引只存 metadata 与两个内容指纹（身份由 metadata 派生）；平台侧只读浏览，本体**不被数字人引用**（本期作为可浏览的知识资产） |
| `domain/mcp/` | MCP 服务的**新建/删除/清单**与调用配置（含 `file_args` / `rules_fields` / `confirmation` / `allowed_tools` / **`headers`**（请求头 / 访问令牌：存明文、响应只回掩码））、测试与统计（2026-09-27：启停/日志已下架） |
| `domain/audit.ts` | 操作审计 |
| `domain/platform-settings.ts` | 平台级设置 |
| `domain/api-error.ts` / `domain/error-codes.ts` | 统一错误类型与错误码目录 |
| `domain/paging.ts` | 分页参数归一 |
| `infra/fs-probe.ts` | 路径可读 / 可写探测（健康检查） |
| `infra/platform-store.ts` | 平台设计态存储（原子写 + revision 乐观锁） |
| `infra/opt-agent-writer.ts` | 运行时配置文件写入（下发） |
| `infra/runtime-client.ts` | 调用 agent-backend 运行时接口 |
| `infra/mcp-client.ts` | MCP 服务连接测试 |
| `routes/deploy.ts` | 部署下发接口；`routes/users.ts` 用户管理；`routes/references.ts` 引用数据；`routes/ontologies.ts` 本体管理（列表 / 详情 / 删除 + 本体市场导入与更新） |
| `routes/platform.ts` | 平台健康检查（2026-09-27：平台设置与运行形态端点已下架） |
| `routes/builtin-tools.ts` | 内置工具配置 |

### admin-frontend（数字人管理平台前端）

| 模块 | 作用 |
|---|---|
| `components/agents/` | 数字人列表/编辑/配置 |
| `components/mcp/` | MCP 服务卡片列表 + 新建/编辑/删除、调用配置（含**请求头 / 访问令牌**，只显示掩码）、工具白名单、连通性测试（启停与运行日志已下架） |
| `components/ontology/` | **本体管理**：卡片列表（6 项 metadata）+ 只读详情（左侧文件列表 + 右侧全文）+ 从本体市场导入 / 更新弹窗 |
| `api/ontologies.ts` | 本体接口封装（列表 / 详情 / 删除 / 市场目录 / 导入 / 更新） |
| `components/skills/` | 技能库维护 |
| `components/deploy/` | 部署预览与下发、运行状态查看 |
| `components/layout/` | 后台框架（导航、布局） |

### ocr-service（OCR MCP 服务）

| 模块 | 作用 |
|---|---|
| `server.py` | MCP 服务入口，暴露 `ocr_image` 等工具 |
| `ocr_core.py` | 文字识别核心：下载签名直链（**只接受 http/https** + 限时、限大小、不跟随重定向）→ 识别 → 结构化输出；异步回写的受理与结果形状也在此 |

### jev-service（Jev 决策 MCP 服务）

TypeSafe System One 决策模型（Jev）的 MCP 封装：把「state + 类型化问题」求值成**结构化决策**
（概率与置信度），供 Agent 直接分支/路由/门控。与 OCR 同为独立部署的内网 MCP 服务。

| 模块 | 作用 |
|---|---|
| `server.py` | MCP 服务入口，暴露三个**原子工具**：`noul`（真假命题→0–1）、`choice`（择一→概率分布+置信度）、`score`（量表打分→加权分值+置信度）；运行时呈现为 `jev__noul` 等 |
| `jev_core.py` | 调用核心：state 合并（LLM 文本 + 引用文件内容，回源只接受 http/https 直链）、请求体构造与取值域校验、响应格式化、**有界指数退避**重试（429/529/5xx）、错误映射 |

工具入参中的 state 为**双通道合并**：`state`（LLM 生成的文本）+ `state_file`（可选，
文件空间相对路径，经 `file_args` 铸成签名直链后由本服务回源下载）。两者以

```text
<LLM 文本>

【引用文件：临时空间/订单.csv】
<文件内容>
```

的形状合并后发送；至少提供其一。

### bom-service（BOM 校验 / 合并 MCP 服务）

把一批单层子BOM（zip 打包）+ 顶层总成表递归展开成一棵多级总BOM。与 OCR / Jev 同为独立部署的
内网 MCP 服务，但它是**唯一有产出文件**的一个。

| 模块 | 作用 |
|---|---|
| `server.py` | MCP 服务入口：两个**同步**工具 `bom_validate`（校验，dry-run、**不产文件**）/ `bom_merge`（合并并给下载地址）；外加一条产出下载路由 `GET /files/{产出名}`（无鉴权，凭证就是那个不可猜的产出名） |
| `bom_core.py` | 全部业务规则与结果形状：S0 输入与配置 → S1.2 编码族 → S1.5 表头 1:1 映射 → S2 归一化 → S2.4 整行重复 → S2.5 编码认领 → S4 递归展开 → S5 累计用量连乘 → S6 按 `schema_path` 的 `excel_column_order` 导出 xlsx。错误逐条带 `code/level/stage/target/location/field/message/hint`，**任一阶段出现 error 即停止**（fail-fast）。四个输入经签名直链回源下载（只接受 http/https、限时限大小、不跟随重定向，与 OCR/Jev 同一机制） |
| `bom_store.py` | 产出落盘与下载地址铸造（**本服务唯一写磁盘的地方**）：产出名白名单（挡路径穿越）、原子写（`.tmp` + `os.replace`）、惰性清理（启动 + 每次落盘，按 `BOM_ARTIFACT_TTL_S` 默认 7 天，另有条数/字节上限兜底） |

**产出交付链路**（关键点：平台的签名直链只有平台铸得出来，所以服务**自管产出、自铸地址**）：

```text
bom_merge 算完 → xlsx 落盘 /app/.data → 拼 {BOM_PUBLIC_BASE_URL}/files/{产出名}
  → 结果 JSON 里带 viewUrl / viewUrlName（契约 §4.7）→ 平台渲染成聊天区入口行 → 用户点开即下载
```

**边界**：本服务只判「能不能合并」「能不能算出来」，**不做**与真实 BOM 的一致性比对（行序/数量/增删/版本差异）。

### gateway（生产网关）

nginx 反向网关：生产环境将前端静态资源与后端 API 统一入口。

## MCP 服务配置详解

> 本节是**字段级参考**（每个字段的含义、取值域、判据与常见故障）；操作步骤见
> [§6 把 MCP 服务接入数字人](#6-把-mcp-服务接入数字人数字人平台)，异步回写协议见
> [`异步MCP服务接入约定.md`](./异步MCP服务接入约定.md)。

### 配置的权威源与流转

- **唯一权威源是数字人管理平台**（`admin-backend`）：服务配置落在 `PLATFORM_DATA_DIR` 下的
  `mcp-services.json`（按服务名索引）。字段模型 `admin-backend/src/domain/mcp/service-config.ts`，
  判据与归一 `service-config-fields.ts`。
- 数字人**设计态只存服务名**（`mcp_services: string[]`）——`transport` / `url` / `headers` /
  `file_args` / `confirmation` / … 全部取自**服务级**配置，因此改一处即作用于所有引用它的数字人。
- 部署时按数字人**整体物化**出 `MCP.json`（平台未搭配的内容不残留），落点：

```text
.opt-agent/users/{uid}/agents/{agent}/MCP.json
```

- **MUST NOT 手工编辑该文件**：它是部署产物，下次部署按平台设计态整体覆盖（见 §6）。

### 字段总表（平台侧）

| 字段 | 必填 / 默认 | 取值与判据 | 作用 |
|---|---|---|---|
| `name` | 必填 | 字母、数字、下划线或连字符，1~64 字符 | 服务名，成为运行环境的**工具前缀**（`{name}__{工具名}`） |
| `description` | 缺省空串 | 任意文本 | 平台卡片上的用途描述 |
| `transport` | 必填 | `http`（界面文案 `streamable-http`）或 `stdio`；别名自动归一 | 传输方式，**只有这两种**（不支持 SSE） |
| `url` | `transport=http` 必填 | `http(s)://` 开头的可达地址 | 连接地址：容器内互访用服务名，宿主机服务用 LAN IP（见 §6 的表） |
| `command` / `args` | `stdio` 必填 `command` | 非空字符串 / 字符串数组 | `stdio` 服务的启动命令与参数 |
| `headers` | 缺省 `{}` | `{头名: 值}`；头名须为合法 token，值为单行非空字符串 | `http` 服务的**请求头 / 访问令牌**（如 `X-MCP-Token`） |
| `allowed_tools` | **新建必填非空**，之后不可改 | 该服务**原始工具名**清单（不含 `{server}__` 前缀） | 工具白名单：平台只呈现这些工具，运行环境只把它们挂给数字人 |
| `file_args` | 缺省 `{}` | `{工具名: {取值路径: 模式}}`，模式为 `url` 或 `url:from=<来源路径>` | 把文件空间相对路径铸成**签名直链**后注入工具入参 |
| `confirmation` | 缺省 `never` | `never` / `always` / `{tools: string[]}` | 调用前是否弹 **HITL 参数确认窗** |
| `rules_fields` | 缺省 `{}` | `{工具名: 字段名或对象路径}` | 声明哪个入参承载「算法规则」清单，供 HITL 弹窗提供「从算法规则选择」入口 |

> **异步工具没有配置项**（2026-10-17 起）：判据就是**工具自己的入参 schema**——在
> `inputSchema.properties` 里声明了 `resultUrl` 的工具，运行环境自动注入签名回写地址。

> 平台侧还有一组**遗留字段**（`writable` / `permission_scope`）已在 2026-09-15 移除、不再透出；
> 运行端加载仍兼容 `write` / `permission_boundary`（仅对历史上的手工配置有意义）。

### 各字段要点

**`transport`**：`http` 即 **Streamable HTTP**。它是**无状态**的——服务被停掉时没有可靠的 close
信号，所以断线靠**探针**发现（见下"运行端行为"）；`stdio` 由运行端按 `command` 拉起。
写 `sse` 会被拒（未支持）。

**`headers`（访问令牌）**：仅 `http` 有意义（`stdio` 保存期即丢弃）。响应只回**掩码**
（如 `6UuE…F3Z`），列表只给 `has_headers` 布尔量；**掩码不能当值提交**（保存期直接拒绝）。
保存时**不携带 = 沿用存量**、提供 = **全量替换**（`{}` 即清空）。完整纪律见
[§凭据纪律](#凭据纪律请求头--访问令牌)。

**`allowed_tools`（工具白名单）**：新建流程 = 连上服务 → 勾选 → 创建，**至少勾一个**
（漏传即拒，避免留下"全部工具放行"的服务）。**之后可以调整**：详情页「工具清单」点
「重新探测」，探测成功后弹出工具范围窗，在那里增减并保存（走 `PUT`，全量替换、同样至少一个
——**空数组在平台语义里是"不限制"**，与"一个都不给"正好相反，故被拒）。空数组 = 不限制，
只为兼容白名单上线前的存量服务（新建与二次调整都不可能产出空数组）。

**`file_args`（文件参数 → 签名 URL）**：`{工具名: {取值路径: 模式}}`，两种模式——`url`（直链铸造）与
`url:from=<来源路径>`（派生，覆盖模型填写并对模型隐藏）。取值路径语法、沙箱校验与相容性判据见下文
[MCP 工具能力](#mcp-工具能力) 的「入参铸造」一节。

**`confirmation`（HITL 闸门）**：`never`（默认）= 直跑；`always` = 该服务**全部工具**调用前都弹确认窗；
`{tools:[...]}` = 仅列出的**原始工具名**需确认。命中即"执行前挂起、等用户确认参数"，确认后才真正调用。
> **写操作类工具应设 `always`**：`docs/architecture/review-2026-10-08.md` 记录过一个
> `confirmation = never` 的写操作服务（模型可无确认写业务系统），列为 P0 待办。

**`rules_fields`（算法规则参数）**：`{工具名: 字段名或对象路径}`，如 `rules` 或
`input.targetPriorities`（**不支持数组段**）。声明后该字段在 HITL 确认窗出现「从算法规则选择」入口。
**它不改变是否走 HITL**：`confirmation: never` 时本映射不生效（工具未被包装，没有挂起点）。

**后台计算（异步工具）**：工具在**自己的入参 schema** 里声明 `resultUrl` 即表示支持异步，**平台侧没有配置项**；
未声明该参数的工具就是一个普通的同步工具。注入、回写与落盘细节见下文「MCP 异步功能」。

### 部署产物 `MCP.json` 的结构

**只有非空字段才写入**（空对象 / 空数组 = 缺省语义，不写空壳），所以运行端"字段缺席"就等于"不启用"：

```jsonc
{
  "servers": [
    {
      "name": "jev",                     // 必写
      "transport": "http",               // 必写（规范值 http）
      "url": "http://jev:8000/mcp",      // http：必写；stdio 则为 command（+ 可选 args）
      "headers": { "X-MCP-Token": "…" }, // 非空才写（明文，运行端按原样发送）
      "file_args": { "noul": { "state_file": "url" } }, // 非空才写
      "confirmation": "always",          // ≠ never 才写
      "rules_fields": { "noul": "input.targetPriorities" }, // 非空才写
      "allowed_tools": [ "noul", "choice" ] // 非空才写
    }
  ]
}
```

运行端加载在 `agent-backend/src/domain/agent-instance.ts`（**手写校验，与平台同构**，无独立
JSON Schema）；缺字段一律按"不启用"处理，配置损坏时**跳过该数字人并告警**。

> 已登记待办：物化文件**无 `schema_version`**（跨端契约无版本）、令牌**明文**下发运行端、
> 平台**无鉴权**——均见 `docs/architecture/review-2026-10-08.md`。

### 运行端行为与默认参数

| 项 | 行为 / 默认值 | 位置 |
|---|---|---|
| 工具名 | `{服务名}__{工具名}`；界面标签 `服务名: 工具名` | `infra/mcp/mcp-tool-adapter.ts` |
| 白名单 | 未声明或空数组 = 不限制；否则只挂白名单内工具 | `infra/mcp/mcp-tool-scope.ts` |
| 连接状态 | `connected` / `failed` / `unknown` | `infra/mcp/mcp-manager.ts` |
| 断线退避 | 5s → 15s → 30s → 60s → 60s，用尽后**不停**，转入保活重试（每 **120s**），服务恢复自动接回 | `infra/mcp/mcp-manager.ts` |
| 健康探测 | 每 **60s** 一次：优先 MCP `ping`，遇 `-32601 Method not found` 记下该服务并回退 `listTools` | `infra/mcp/mcp-manager.ts` + `server.ts` |
| 工具调用超时 | 默认 **60s**（`MCP_TIMEOUT_MS`），超时后**重试 1 次** | `config.ts` |
| 建连超时与预热 | 建连默认 **10s**（`MCP_CONNECT_TIMEOUT_MS`，与调用超时**刻意分开**）：超时即判该服务 `failed` 并交给退避重连，迟到的连接主动关闭。新登录 / 切换数字人时前端调 `POST /api/agents/current/mcp/warm` 预热（幂等）；点发送时若仍有灰，等出连接结果（≤10s）再提交，超时降级放行并提示 | `config.ts` + `infra/mcp/mcp-manager.ts` + `routes/agents.ts` + `frontend/src/composables/useMcpReadyGate.ts` |
| LLM 有界重试 | 默认**重试 2 次**（`LLM_MAX_RETRIES`，总尝试 ≤ 3）、单次等待上限 **15s**（`LLM_RETRY_MAX_DELAY_MS`）；交给 pi-ai 的 `retryProviderRequest`（退避 + `x-should-retry` / `Retry-After`，可被「停止」打断），**只在响应到达前重试**（不会重复正文） | `config.ts` + `infra/llm/pi-ai-provider.ts` + `infra/agent-loop.ts` |
| LLM 失败可见性 | 失败归类为 `LLM_UNAVAILABLE` / `LLM_RATE_LIMITED` / `LLM_INSUFFICIENT_BALANCE` / `LLM_UNAUTHORIZED` / `LLM_CONTEXT_TOO_LONG`（兜底 `LLM_ERROR`）；诊断字段（上游状态码 / 类型 / `request_id`）随 SSE `error` 与失败轮落盘下发；原始错误记 `llm.call.failed` 结构化日志（余额不足 / 凭证无效带 `alert`） | `domain/llm-error.ts` + `domain/run-finalize.ts` |
| 内置工具 | 数字人目录下 `TOOL.json`（`{"enabled":[…]}`）；与 MCP 工具进**同一张工具表**，靠 `{服务名}__` 前缀区分 | `domain/agent-instance.ts` |

### 平台侧接口与错误码

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/mcp/services` | 列表（分页） |
| GET | `/api/admin/mcp/services/:name` | 详情（工具清单、引用、`revision`） |
| POST | `/api/admin/mcp/probe` | 新建**前**探测工具清单（不要求已登记） |
| POST | `/api/admin/mcp/services` | 新建（`201`；`allowed_tools` 必填） |
| PUT | `/api/admin/mcp/services/:name` | 保存调用配置（**`revision` 必填**，乐观锁） |
| DELETE | `/api/admin/mcp/services/:name` | 删除（`204`） |
| POST | `/api/admin/mcp/services/:name/test` | 连通性 + 能力验证 |
| GET | `/api/admin/mcp/stats` | 调用统计 |

| 错误码 | HTTP | 触发 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 名称 / `url` / `transport` / `headers` / `file_args` / `confirmation` / `rules_fields` / `allowed_tools` / `revision` 不合法 |
| `ADM_MCP_SERVICE_EXISTS` | 409 | 新建重名 |
| `ADM_MCP_SERVICE_NOT_FOUND` | 404 | 服务不存在 |
| `ADM_RUNTIME_UNREACHABLE` | 503 | 连接 / 测试失败 |

> **删除不阻止引用**：删除会先列出受影响的数字人（见 §6）；删除后这些引用变为失效，
> 引用它的数字人**部署会被 precheck 拦截**（部署前校验引用有效性）。

### 常见故障对照

| 现象 | 原因与处置 |
|---|---|
| 新建时服务直接回 **401** | 服务需要访问令牌：在「请求头」填 `{"X-MCP-Token":"…"}`（见 §凭据纪律） |
| 服务报"收到的是相对路径" | 该出参没在 `file_args` 里声明 → 补 `{工具名: {"参数字段": "url"}}` |
| 模型编造 http 地址 | 改用派生模式 `url:from=<来源路径>`（覆盖模型填写且对其隐藏） |
| 异步工具算完，界面上没有条目 | 该工具的入参 schema 未声明 `resultUrl`（运行端不会注入回写地址，工具按同步处理） |
| 想调整白名单 | 创建后不可改：删除服务后重建，并重新部署引用它的数字人 |
| 服务停过又起来，工具仍是不可用 | 已修：退避用尽会转保活重试（每 120s）并自动接回，**无需重启 agent-backend**（规格 `specs/002-conversation-runtime/spec.md` §4.5） |
| 结果里想给个可点开的地址 | 返回 JSON 里加 `viewUrl` / `viewUrlName`；本地文件可给 `filePath` / `filePathName`（见「视图入口」一节） |

## MCP 工具能力

> 配好 MCP 服务之后，平台在**调用链路**上替工具代劳三件事。三者同一纪律：平台只**搬运 / 铸造**，
> 不生成业务数据、不改写服务给的值；任何一项没声明，行为就退回"原样透传"（对存量服务零影响）。

| 能力 | 服务侧要做的 | 平台做的事 | 落在哪 |
|---|---|---|---|
| 入参铸造 | 工具入参接受一个"文件地址" | 把文件空间相对路径铸成**签名读直链**；或按来源字段**派生** | 只出现在本次调用的入参里 |
| 结果回写 | `inputSchema` 顶层声明 `resultUrl` | 注入**签名写直链**（12h 有效）、对模型隐藏 | `临时空间/后台产出/` |
| 视图入口 | 返回 JSON 里给 `viewUrl` / `filePath` | 抽成 sidecar 随工具记录下发；前端渲染为可点入口 | 回答正文之后 / 工具记录 |

### 1. 入参铸造：文件参数 → 签名 URL

远程 / 跨容器服务没有用户磁盘的访问权，只能拿"可下载地址"。在**调用配置 → 文件参数映射**里按
`{工具名: {取值路径: 模式}}` 声明，调用时把模型填的**文件空间相对路径**原位换成签名直链（读方向，24h 有效）：

| 模式 | 声明示例 | 行为 |
|---|---|---|
| **直链** | `{"ocr_image": {"image": "url"}}` | 模型填相对路径 → 沙箱校验 → 原位铸成签名直链；**已是 `http(s)://` 的值原样透传** |
| **派生** | `{"bom_merge": {"mergedFileUrl": "url:from=sourceFile"}}` | 目标值**不取自模型**：从来源字段逐元素推导、过沙箱、铸造后**无条件覆盖**；目标字段对模型**隐藏** |

- 取值路径支持：顶层参数（`image`）、字符串数组（`files[]`）、对象数组元素字段（`items[].excelFileUrl`）、
  多级（`groups[].files[].url`）；**不支持下标**（`a[0]` 非法）。
- 直链模式用于"模型本来就在填文件相对路径"的参数；**派生模式**用于根治模型对 http 地址字段的幻觉。
- 派生模式的来源与目标**形状必须相容**（同长度、除最后一段外逐段一致），否则保存被拒；来源缺失 / 空串 →
  **调用不发出**（管道命脉，静默会铸出错误文件），让模型自我纠正。
- 未声明的参数**一个字段都不碰**（第三方服务常严格校验入参）；漏声明的后果是该参数把相对路径原样发给服务。

### 2. 结果回写：`resultUrl`（异步长任务）

工具在**自己的 `inputSchema.properties`（首层）** 里声明 `resultUrl`（`string`，**不要放进 `required`**）即表示
"本工具支持异步"——平台侧**没有对应配置项**。调用时平台注入**签名写直链**（`DEFAULT_PUT_TTL_MS` = 12h）、
从给模型的 schema 里删掉该参数、并覆盖模型填的任何值。服务**立即返回受理**（含 `job_id`），算完把结果
POST 回来：落 `临时空间/后台产出/`，经前端铃铛「后台记录」呈现，并在后续对话中作为「后台计算结果」注入
上下文（模型按需 `read_file` 读取）。**不改变工具是否同步、也不改变是否走 HITL。**

完整时序、回写字段与示例见下文 [MCP 异步功能](#mcp-异步功能长耗时计算)。

### 3. 视图入口：`viewUrl` / `viewUrlName` / `filePath` → 可点链接

工具返回的 JSON 里带上这些字段，平台抽成 sidecar（记录行里的 `view_links`）随工具记录下发，前端在
**回答正文之后**渲染为可点入口：

| 字段 | 说明 |
|---|---|
| `viewUrl` | 可跳转地址（判定**大小写不敏感**）：完整 `http(s)://`，或**单个** `/` 开头的根相对路径 |
| `viewUrlName` | 入口显示名，**MUST 与 `viewUrl` 同层**；不给就显示地址（中段省略） |
| `filePath` | **文件空间相对路径**（如 `数据准备/9月计划.xlsx`），界面转成预览接口后走同一条入口 |
| `filePathName` | `filePath` 的显示名，同样 MUST 同层 |

- 前提：结果正文是**合法 JSON 对象 / 数组**（可在任意层，深度 ≤8，文本 ≤256K）；纯文本、CSV、JSON 外套
  说明文字都不会被解析。
- 值形态：`http(s)://` 原样；根相对路径的**前缀由界面补**（= 用户当前访问入口，服务 MUST NOT 自己拼）。
  协议相对 `//host/…`、缺前导 `/`、`javascript:` / `data:` 等其它 scheme **不会被链接化**。
- 展示：跨工具按最终地址去重，最多直显 3 条，其余「另有 N 个」；一条合法链接都没有时**整行不渲染**；
  sidecar 不进模型上下文（不占回灌预算）。
- 点击行为：
  - **同源（协议 + 主机 + 端口一致，即同 IP + 端口）** → 在**右侧面板 iframe** 内展示；先预检响应头，
    不可内联（`attachment`）则给下载入口，预检失败降级为外部跳转；
  - **异源** → 直接跳转出去，**不改变**右侧面板状态；
  - **`filePath`** → 与"在文件空间里点文件"同一条路：打开右侧面板并按扩展名分派（文本 / PDF / 图片 / 下载引导）。

## MCP 异步功能（长耗时计算）

**要解决的问题**：同步工具必须"算法算完才返回"，而平台单次 MCP 调用有超时上限（`MCP_TIMEOUT_MS`，默认
**60s**）且**超时会重试 1 次**——长任务不仅必然超时，还会让算法侧收到两次提交。异步化的做法是
**先返回受理、算完再回写**：调用毫秒级返回，平台不超时、不重试，结果也不丢。

```text
① 声明   工具 inputSchema.properties 里声明 resultUrl      → 平台自动注入（模型看不到）
② 提交   立即返回受理 JSON（含 job_id）                     → 模型据此回复"已受理"
③ 回写   算法算完后 POST 回 resultUrl                      → 平台落盘 → 铃铛「后台记录」出现条目
```

### 服务侧硬规则

| # | 规则 |
|---|---|
| 1 | `properties` 里**必须有 `resultUrl`**（名字逐字一致，类型 `string`） |
| 2 | **不要放进 `required`**（有默认值即不在 required，平台照样注入） |
| 3 | 声明后平台会把它**从给模型的 schema 中删掉**，注入时**覆盖**模型填的任何值 |

### 提交返回（立即给模型）

```json
{ "job_id": "hd_1790328130074_4005b4b0", "status": "accepted", "message": "已受理，正在后台求解；完成后结果会自动出现在后台记录与后续对话里，无需重复提交。" }
```

`status` 固定 `accepted`；`message` 要含"无需重复提交"，否则模型常会再调一次、白排一遍。
`resultUrl` 缺失或协议不是 http/https 时，服务自行降级为同步返回，并在结果前说明原因。

### 回写协议

```http
POST {resultUrl}&filename=hd_1790328130074_4005b4b0.json&summary=排产完成，12 条工单
Content-Type: application/json; charset=utf-8

{ "status": "success", "message": "排产完成，12 条工单", "orderCount": 12, "orders": [ ... ] }
```

| 项 | 规定 |
|---|---|
| 原 query | **MUST 保留**（`u/d/exp/sig/sid/call_id/tool` 一个不丢），且用 URL 解析器追加参数，不能字符串拼 `&filename=` |
| `filename` | `{job_id}.json`；不含路径分隔符与 `..` |
| `summary` | **MUST 提供**：界面标题的唯一来源，一行 ≤200 字符，**失败结论前置**（标题单行省略，写在末尾会被截掉） |
| body | 统一结果 JSON；`status` **只能是 `success` / `failed`**，业务细分信息写进 `message` 或自定义字段 |
| 失败 | **也 MUST 回写**（否则界面什么都不出现，用户无法区分"还在算 / 失败 / 挂了"） |
| 大小 | ≤ 5MB；结果可能很大时先判断，超限降级为只回写状态 |
| 成功判据 | HTTP `200` / `202` |

平台响应：

| 响应 | 含义 |
|---|---|
| `202 {"path":"临时空间/后台产出/…","size":1234}` | 落盘成功 |
| `403 FILE_SIGN_INVALID` | 签名无效 / 过期（回写地址默认 **12h** 有效） |
| `400 VALIDATION_FAILED` | `filename` 非法 / body 为空 |
| `413` | body 超过 5MB |

### 平台侧处理

- **落盘目录**：`临时空间/后台产出/{filename}`。目录白名单是硬约束——即便签名合法，也只允许写这个目录。
- **成败判据**：sidecar 的 `status` 恒为 `done`（回写即完成），业务成败只看正文 `status` 与 `summary`。
- **通知**：落盘即经 SSE 推一次信号，前端重新拉列表 → 铃铛「后台记录」出现条目；产出正文不走对话流。
- **下一轮上下文**：只注入**当前会话**的后台产出清单（别的会话提交的任务不污染本轮）；模型按需 `read_file`。
- **视图链接**：异步正文里的 `viewUrl` 同样生效（铃铛的结构化查看里渲染为链接），与同步返回同一口径。

> 完整字段、`hd` 服务 Demo 与全链路时序见 [`异步MCP服务接入约定.md`](./异步MCP服务接入约定.md)。

## 环境要求

- Node.js >= 20
- Docker Desktop（OCR / Jev / BOM 三个 MCP 服务需要；若要提取本体平台的本体 / 技能 / 「自建发布」MCP 服务，
  本体平台自身的容器组也需运行）
- npm

## 本地启动

### 1. MCP 服务（Docker）

```bash
docker compose up -d ocr                            # 首次构建镜像较慢；模型加载约 30 秒
cp ocr-service/.env.example ocr-service/.env.local  # 本机形态才需要：填宿主机 LAN IP（回源白名单）
cp jev-service/.env.example jev-service/.env.local  # 首次：填 TYPESAFE_API_KEY 与同一个 LAN IP
docker compose up -d jev                            # 无本地模型，构建后秒级启动
cp bom-service/.env.example bom-service/.env.local  # 首次：填 BOM_PUBLIC_BASE_URL=http://<宿主机 LAN IP>:8102（下载链接的对外基址）
docker compose up -d bom                            # 无本地模型，构建后秒级启动
```

### 2. Agent 后端（端口 3000）

```bash
cd agent-backend
cp .env.example .env.local      # 首次：本地形态完整配置（密钥 + LAN IP + 运行参数，gitignore 不入库）
cp config.example.yaml config.yaml  # 首次：复制配置，填入模型 API Key
npm install                     # 首次
npm run dev                     # tsx watch，只读 .env.local
```

### 3. Agent 前端（端口 5173）

```bash
cd frontend
npm install                     # 首次
npm run dev
```

### 4. 数字人管理平台后端（端口 3001）

```bash
cd admin-backend
cp .env.example .env.local      # 首次：本机私产（宿主机路径口径，gitignore 不入库）
npm install                     # 首次
npm run dev
```

### 5. 数字人管理平台前端（端口 5174）

```bash
cd admin-frontend
npm install                     # 首次
npm run dev
```

启动后访问：Agent 端 http://localhost:5173 ，数字人平台 http://localhost:5174 。

### 6. 把 MCP 服务接入数字人（数字人平台）

**MCP 服务由管理员在平台内人工登记**（2026-09-27 起）：平台是 MCP 服务配置的**唯一权威源**，
不再读取 `docker-compose.yml`、也不再读 Docker 容器状态。以 `jev` 为例：

1. `/admin/mcp` 右上角「**新建 MCP 服务**」→ 弹窗填名称 `jev`、用途描述、传输方式 `streamable-http`
   与**唯一连接地址** → 点「创建服务」（名称会成为运行环境的工具前缀，须为字母/数字/下划线/连字符）。
   创建成功即进入该服务**详情页并自动测试一次**连接：地址填错时结果弹窗直接给出原因
   （连接被拒／超时／协议不匹配）。弹窗只收基础连接信息，**在线测试在详情页做**——
   `/api/admin/mcp/services/{name}/test` 只接受已登记的服务，所以测试时机是"创建后立刻"：

   | MCP 服务跑在哪 | 该填的 `url` |
   |---|---|
   | 全 Docker（容器内互访） | `http://jev:8000/mcp` |
   | 宿主机的服务（后端也在宿主机） | `http://<宿主机 LAN IP>:8101/mcp` |

   > **需要访问令牌的服务**（本体侧「自建发布」的动态容器，如 `X-MCP-Token`）：在新建弹窗/
   > 调用配置的**「请求头（访问令牌）」**里填 `{"X-MCP-Token":"…"}`（2026-10-08）。不带令牌
   > 时服务直接回 **401**，新建流程第一步就会过不去。平台按此头连接与测试，并在部署时把它
   > 物化进数字人的 `MCP.json`——**数字人侧无需另配**（`FR-064`）。值是凭据：界面只显示掩码
   > （`6UuE…F3Z`），掩码不能当值提交（保存会被拒）。至少一个工具的白名单也在这条新建流程里
   > 勾选——**只有白名单里的函数会进入模型可见的工具表**。

2. 在详情页补全**调用配置**并保存：`file_args` 需为 `noul` / `choice` / `score` 三个工具各声明一条
   `state_file: url`，否则 LLM 传的相对路径不会被铸成下载直链，服务会收到相对路径并报错；
   `confirmation` 建议 `never`（纯求值、无副作用），`rules_fields` 留空。
   「发起测试」就在连接地址旁，改完地址可**先测再保存**。

3. 数字人设计态勾选 `mcp_services` 含 `jev` → 部署 → 平台物化 `MCP.json` → Agent 运行时加载。

> 修改调用配置会**自动作用于所有引用它的数字人**（下次部署生效）；删除服务时若仍被引用，
> 平台会先列出受影响数字人并要求二次确认，删除后这些引用变为失效（保存与部署都会被拦截）。

> MUST NOT 手工编辑 `.opt-agent/users/{uid}/agents/{agent}/MCP.json`：它是**部署产物**，
> 下次部署按平台设计态整体覆盖，手改不会留存（数字人配置的权威源在平台侧）。

**异步 MCP 服务**（如排产 `hd`）：**平台侧无需登记**——服务在工具的 `inputSchema` 里声明
`resultUrl` 参数即可，运行环境自动注入回写地址，服务立即返回受理、算完后 POST 回写；结果落盘到
`临时空间/后台产出/` 并由前端铃铛「后台记录」呈现，模型可在后续对话中读取。回写形状（`status` 只有
`success` / `failed` + `summary`）与完整示例见 [`异步MCP服务接入约定.md`](./异步MCP服务接入约定.md)。

**BOM 服务（`bom`）的登记要点**：

- 连接地址：全 Docker 用 `http://bom:8000/mcp`；后端在宿主机跑用 `http://<宿主机 LAN IP>:8102/mcp`
  （它另外发布宿主端口 8102 供**用户浏览器**下载产出）；
- `file_args`：`bom_validate` / `bom_merge` 的四个文件入参
  （`sub_bom_zip_path` / `total_bom_path` / `schema_path` / `mapping_path`）**每个都要声明为 `url` 模式**
  ——模型填文件空间相对路径，运行端铸成签名直链；漏声明的那个参数会把相对路径原样发给服务，
  结果是 E001「输入取不到」。**声明的 key 就是参数名**（`file_args[toolName]` 的键必须与工具签名
  逐字一致）：这四个名字刻意不带 `url`/`http` 字样，避免模型自己拼直链；改名后**平台侧设计态的
  `file_args` 必须同步改成新名**，否则键对不上 → 铸造不生效 → 直接 E001；
- `confirmation` 建议 `never`（纯计算，不写业务系统）；两个工具都是**同步**的，**不要**在入参
  schema 里声明 `resultUrl`——那会让运行端注入一个它用不上、还可能被判为非法入参的字段；
- 产出的下载入口由服务自己在返回里给出 `viewUrl` / `viewUrlName`（见下），平台零改动渲染。

> **需要链接跳转时，请在工具返回里加上 `viewUrl` 与 `viewUrlName` 字段**，方便工具调用后的结果展示：
>
> - `viewUrl`（必给）：可跳转的页面地址，**二选一**——**根相对路径**（**单个** `/` 开头，如
>   `/datasource/ds1/dst1/t1/xlsx`）或**完整 `http(s)://` 地址**。协议相对（`//host/…`）、
>   缺前导 `/`、`javascript:` / `data:` 等其它 scheme **不会被链接化**；
> - `viewUrlName`（可选，**必须与 `viewUrl` 同层**）：入口显示的**名称**；不提供就显示地址本身。
>
> 前提：**结果正文须是一个合法 JSON 对象或数组**（`viewUrl` 可在任意层级，深度 ≤8）——纯文本、CSV、
> 或 JSON 之外还夹着说明文字、带 BOM 的文本都不会被解析。带上该字段后，工具调用会在**回答正文之后**
> 多出一行可点入口（最多直接显示 3 个，其余走「另有 N 个」），工具卡片的结构化视图里该地址也会变成链接。
> 平台**不改写值、不拼前缀**（根相对路径的前缀由界面按用户当前访问入口补）。
>
> 完整约定（含**不会被链接化**的各种形态）见 [`异步MCP服务接入约定.md`](./异步MCP服务接入约定.md) §4.7
> ——同步返回与异步回写用**同一口径**；规格依据 `specs/002-conversation-runtime/spec.md` §4.8（`TR-44`~`TR-48`）。

**字段级参考**（每个字段的含义 / 取值域 / 判据，以及平台接口、错误码、运行端默认参数与常见故障对照）
见 [MCP 服务配置详解](#mcp-服务配置详解)。

### 7. 从本体平台提取本体 / 技能 / MCP 服务（可选）

**前置**：本体平台（optonto）已在同一台机器运行（Docker Desktop），且 `admin-backend/.env.local` 的
`ONTO_MARKET_DIR` 指向它的本体市场（默认样例 `../../optonto/.data/onto_market`）。
三条通道的来龙去脉见 [与本体平台（optonto）的集成](#与本体平台optonto的集成)。

1. **本体**：`/admin/ontologies` →「从本体市场导入」→ 选中 `生产调度 / 原材料采购和库存` →
   导入后进入只读详情（左侧文件列表 + 右侧全文）；市场侧文件变了，卡片会提示"可更新"。
2. **技能**：`/admin/skills` →「从本体市场导入」→ 选中 `raw-material-inventory`。
   导入的技能**只读**——想更新只能再走一次"更新"（整包替换），不能在线编辑。
3. **MCP 服务**（本体侧「自建发布」）：`/admin/mcp` →「新建 MCP 服务」→ 弹窗第一步填
   名称 `raw_inventory_purchase_function`、传输方式 `streamable-http`、连接地址
   `http://localhost:8021/mcp`、**请求头** `{"X-MCP-Token":"<令牌>"}` → 「连接并获取工具」→
   **勾选要暴露给数字人的函数**（默认不勾、至少一个）→ 创建。`:8022`（行为类）同样再建一个。
   > 令牌取自本体平台的发布信息；界面只显示掩码、掩码不能当值提交。白名单之外的函数模型看不到。
4. **装配给数字人**：数字人设计态勾选 `skills` / `mcp_services` →「部署」→ 平台把 `MCP.json`（**含请求头**）
   与技能文件写入运行端用户目录，模型即可使用。

## 与本体平台（optonto）的集成

本体平台（optonto）是**本体、本体技能、本体函数服务**的权威源。数字人管理平台按三条通道提取资产，
提取来的内容先落**平台设计态**，再由部署下发到运行端——平台对市场侧一律**只读消费**。

### 三条提取通道

| 通道 | 本体平台侧的源 | 平台侧操作（界面） | 落在平台哪里 | 可改性 | 生效链路 |
|---|---|---|---|---|---|
| **本体** | `.data/onto_market/{场景}/{本体}/ontology.yaml`（+ `securities.yaml`，均为必需） | 本体管理 →「从本体市场导入」 | `.platform-data/onto_market/{场景}/{本体}/` | **只读**：只能经市场"更新"整体替换 | **本期不被数字人引用**，作为可浏览的知识资产（卡片展示 6 项 metadata，详情展示两个文件的全文） |
| **技能** | `{场景}/{本体}/skills/{技能目录}` | SKILL 管理 →「从本体市场导入」 | 技能库（来源记 `onto_market:{场景}/{本体}`） | **只读**：MUST NOT 在线编辑，只能整包更新 | 数字人勾选 `skills` → 部署 → 运行端用 `read_skill` 读取 |
| **MCP 服务**（「自建发布」） | 本体平台把本体的**行为/函数**发布为动态容器（`mcp-publish`，`:8021` / `:8022`） | MCP 服务 →「新建 MCP 服务」：填 `url` + **请求头 `{"X-MCP-Token":"…"}`** → 探测工具 → 勾**工具白名单** | `.platform-data/mcp-services.json`（令牌明文落盘，响应只回掩码） | **可改**（令牌会轮换；工具白名单在详情页「工具清单 → 重新探测」里调整） | 数字人勾选 `mcp_services` → 部署 → 物化 `MCP.json`（**含 headers**）→ 运行时按白名单装配工具 |

关于本体导入的范围（2026-10-03 起，2026-10-17 收紧）：只取 `ontology.yaml` 与 `securities.yaml`
（**两个均为必需文件**，后者承载行为安全管控；市场侧缺任一即该条不可导入）；
`data_engines.yaml`、`meta.json`、`functions/`、`ontology_versions/`、`skills/` **不导入**。市场侧这两个文件
任一变化都会让平台标记"可更新"（各自内容指纹比对）。

本体索引（`.platform-data/onto_market/index.json`）自 2026-10-17 起只保存 `metadata` + 两个内容指纹 + 时间戳：
场景名 / 本体目录名 / 展示名 / 来源分别由 `metadata.scenario_name`、`metadata.ontology_name` 派生，
导入时强校验二者与市场目录名完全一致（不一致即拒绝，避免派生出的路径指向不存在的目录）。

### 当前已提取的清单（2026-10-08 实测）

| 类别 | 市场侧（optonto） | 平台侧 |
|---|---|---|
| 本体 | 4 个：`原材料采购和库存`、`订单排程`、`货品BOM及工艺`、`资源（人员和设备）` | 本体库已导入 **1 个**：`生产调度 / 原材料采购和库存` |
| 技能 | `raw-material-inventory` | 技能库共 3 个：`调度算法`（ZIP 上传）、`海大算法求解`（在线创建）+ `raw-material-inventory`（**市场导入，只读**，来源记 `onto_market:生产调度/原材料采购和库存`） |
| MCP 服务 | 自建发布容器 `:8021` / `:8022` | 平台登记 4 个（见下） |

平台当前的 MCP 服务：

| 名称 | 连接地址 | 来源 | 访问令牌 |
|---|---|---|---|
| `jev` | `http://localhost:8101/mcp` | 本仓 `jev-service`（Docker） | 无 |
| `ocr` | `http://localhost:8000/mcp` | 本仓 `ocr-service`（Docker） | 无 |
| `raw_inventory_purchase_function` | `http://localhost:8021/mcp` | **本体侧自建发布** · 函数类：白名单 6 个，**全为查询/校验** | 需 `X-MCP-Token`（界面显示掩码 `6UuE…F3Z`） |
| `raw_inventory_purchase_action` | `http://localhost:8022/mcp` | **本体侧自建发布** · 行为类：白名单 8 个（`QueryInventory` / `QueryRawMaterials` / `QueryPurchaseRecords` / `QuerySuppliers` / `QuerySupplierCapability`，**外加 3 个写操作** `CreatePurchaseRecord` / `CancelPurchaseRecord` / `ReceiveRawMaterial`） | 同上 |

> 数字人 `生产计划助手` 目前引用 `skills=[海大算法求解, raw-material-inventory]`、`mcp_services=[jev, ocr]`，
> **尚未勾选两个本体侧自建发布服务**——要让数字人用上「原材料采购和库存」的本体函数，需在设计态勾选这两个
> 服务并**部署**（勾选后这些函数才进入模型可见的工具表）。

> ⚠️ **写操作的人工确认**：`raw_inventory_purchase_action` 的白名单里有 3 个**写操作**
> （`CreatePurchaseRecord` 建采购单 / `CancelPurchaseRecord` 取消采购单 / `ReceiveRawMaterial` 原材料收货），
> 而它当前的 `confirmation` 是 `never`——即**数字人无需人工确认即可写库**。
> 若要把这个服务交给数字人使用，建议把调用配置的 `confirmation` 改为 `always`（调用前弹 HITL 确认）。
> `8021`（全查询/校验）与 `jev`（纯求值）保持 `never` 是合适的。

### 生效三步（提取 ≠ 生效）

```text
① 设计态：数字人勾选技能 / MCP 服务（本体本身不参与引用，只作浏览）
② 部署：平台物化 —— MCP.json（含请求头）+ 技能文件写入运行端用户目录
③ 运行：模型经 read_skill / MCP 工具使用；白名单之外的函数对模型不可见
```

### 前置与配置

- **本体平台需在运行**（Docker Desktop）：其 core backend（`:8001`）与自建发布容器（`:8021` / `:8022`）；
  本体市场就是 `optonto/.data/onto_market`。
- 平台侧只有**一处**配置：`admin-backend/.env.local` 的 **`ONTO_MARKET_DIR`**
  （默认样例 `../../optonto/.data/onto_market`）；**缺省 = "从本体市场导入"不可用**，不影响启动与其余功能。
- 令牌来源：本体平台发布服务时会给出形如
  `{"mcpServers":{"xxx":{"type":"streamable-http","url":"http://localhost:8021/mcp","headers":{"X-MCP-Token":"…"}}}}`
  的片段——把 `url` 与 `headers` 原样填进平台的「连接地址」与「请求头」即可（平台**原样发送**，不做任何转换）。
  不带令牌时该类服务直接回 **401**，新建流程第一步就过不去。

### 凭据纪律（请求头 / 访问令牌）

- 请求头**存明文**（服务要求按原样发送），但**响应只回掩码**（列表仅回 `has_headers` 布尔量），
  明文 MUST NOT 出现在任何响应或日志中；
- 界面回显的掩码（`6UuE…F3Z`）**不能当值提交**——保存期直接拒绝并给出可读原因；
- 保存调用配置时**不携带 = 沿用存量**、提供 = 全量替换（`{}` 即清空）：保存 MUST NOT 顺手清空令牌；
- 令牌轮换后**重建服务即可**；工具白名单同理可改（详情页「工具清单 → 重新探测」）。

## 本地配置要点：文件回源链路必须使用本机 IP

agent-backend 会把文件空间的相对路径铸造成**签名直链**（如 `http://<主机>:3000/api/files/raw?...&sig=...`），交给 MCP 服务（如 OCR / Jev）回源下载。这条链路只有**一处**配置决定主机名——即本机局域网 IP（用 `ipconfig` 查看实际 IPv4 地址，下文以 `192.168.1.3` 为例）：

| 配置项 | 位置 | 作用 |
|---|---|---|
| `PUBLIC_BASE_URL` | `agent-backend/.env.local` | 铸造签名 URL 时使用的对外基址（容器形态由 compose 覆盖为 `http://backend:3000`） |

```env
# agent-backend/.env.local
PUBLIC_BASE_URL=http://192.168.1.3:3000
```

> **2026-09-28 变更：回源 host 白名单已移除。** ocr / jev 原先各有一份
> `OCR_URL_ALLOW_HOSTS` / `JEV_URL_ALLOW_HOSTS`（默认空集 = 拒绝一切回源），现整体删除：
> - 回源直链与 `resultUrl` 都由运行环境按 `PUBLIC_BASE_URL` **单点铸造**后注入
>   （URL 类参数一律经 `file_args` 的 `url` / `url:from=` 注入，模型无从指定主机），
>   服务侧再验一遍 host 属于同一判据的第二次执行；
> - 它要求"直链基址 + 每个 MCP 服务各一份白名单"三处写同一个主机名，**IP 一变就漏**，
>   历史上已因此出现过"回源被 SSRF 拒绝"的故障；
> - 服务侧保留的防护与白名单无关：**只接受 http/https**、不跟随重定向、下载超时、大小上限。
> - 附带效果：`ocr-service/.env`、`jev-service/.env` 两个入库文件随之删除（它们只剩白名单一行），
>   这两个服务在 compose 里只注入**可选**的本机私产 `.env.local`。

改完需要**重建** MCP 容器、重启 backend 才生效（环境变量在容器创建时固化，`restart` 不更新）：

```bash
docker compose up -d --build ocr jev    # 代码变更必须重建镜像；环境变量同样只在重建时固化
# agent-backend 重启（Ctrl+C 后重新 npm run dev）
```

改完**先确认容器真的拿到了新值**（别只看 compose 文件——它只是"下次创建时会用的值"）：

```bash
docker compose config | grep PUBLIC_BASE_URL
docker inspect optagent-backend --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PUBLIC_BASE_URL
```

**为什么不能写 `localhost`**——回源动作由 OCR / Jev **容器**发起，容器内的
`localhost`/`127.0.0.1` 指向容器自己（其 3000 端口无服务），不是宿主机。容器访问宿主机必须用
宿主在网络中的名字——局域网 IP 或 `host.docker.internal`。

## 常用命令

```bash
# 前端测试 / 类型检查（frontend 与 admin-frontend 相同）
npm run test
npm run typecheck

# 后端测试（agent-backend：单元 / 集成 / 全量 / 覆盖率）
npm run test            # = test:unit
npm run test:integration
npm run test:all
npm run test:coverage

# 后端门禁（admin-backend；admin-frontend 有前两项）
npm run check:lines     # 单文件 ≤500 行
npm run check:deps      # 依赖边界
npm run check:contract  # 错误码契约（仅 admin-backend）

# MCP 服务测试（Python，**宿主机本地**；容器不承担测试职责——宪章原则三）
cd ocr-service && pip install -r requirements-test.txt && python -m pytest -q tests
cd jev-service && pip install -r requirements-test.txt && python -m pytest -q tests
cd bom-service && pip install -r requirements-test.txt && python -m pytest -q tests
```
