# OptAgent 智能体平台

智能体（Agent）应用平台。平台分两端：

- **Agent 端**：面向使用者的对话式智能体，支持 MCP 工具调用、人工确认（HITL）、文件空间、多会话管理
- **数字人管理平台**：面向运营/管理员的管理后台，管理数字人（Agent）、技能、MCP 服务与平台配置，并负责把配置下发部署到运行端

OCR 表格识别与 Jev 决策（TypeSafe System One）作为 MCP 工具服务独立部署（Docker）。

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
│                 │         │  :8001 → :8000            │
└─────────────────┘         └───────────────────────────┘
```

## 目录结构

```
optagent/
├── agent-backend/          # Agent 运行时后端（Fastify + Node ≥ 20，端口 3000）
│   └── src/
│       ├── routes/         # HTTP 接口层（10 个路由模块）
│       ├── domain/         # 领域层：纯业务逻辑，不依赖框架
│       ├── infra/          # 基础设施层：LLM、MCP、签名、数据库
│       ├── config.ts       # 配置加载（.env + config.yaml，启动校验）
│       ├── server.ts       # Fastify 装配与启动
│       └── context.ts      # 请求上下文（当前用户/数字人）
│
├── frontend/               # Agent 对话前端（Vue 3 + Vite，端口 5173）
│   └── src/
│       ├── api/            # 后端接口封装与类型
│       ├── components/
│       │   ├── chat/       # 对话区：消息流、输入框(Composer)、HITL 弹窗、@引用面板
│       │   ├── layout/     # 应用骨架：历史侧栏、文件空间面板、空间树
│       │   └── common/     # 通用组件（按钮/弹窗/图标等）
│       ├── composables/    # 状态与逻辑：会话流、@文件引用、路径插入、工作区
│       ├── constants/      # 常量
│       ├── styles/         # 全局样式
│       └── utils/          # 工具函数（格式化、空间判定等）
│
├── admin-backend/          # 数字人管理平台后端（端口 3001）
│   └── src/
│       ├── routes/         # agents / mcp / skills / deploy / users / references ...
│       ├── domain/         # 配置中心、部署、MCP、技能库、审计、平台设置
│       └── infra/          # Docker 主机探测、compose 读取、运行时客户端、配置下发
│
├── admin-frontend/         # 数字人管理平台前端（Vue 3 + Vite，端口 5174）
│   └── src/
│       ├── components/
│       │   ├── agents/     # 数字人管理
│       │   ├── mcp/        # MCP 服务管理
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
├── jev-service/            # Jev 决策 MCP 服务（Docker，宿主机端口 8001）
│   ├── server.py           # MCP 服务入口（FastMCP / StreamableHTTP）
│   ├── jev_core.py         # 决策调用核心（state 合并、重试退避、错误映射、回源白名单）
│   └── tests/              # 服务端测试
│
├── gateway/                # 生产网关（nginx）
├── specs/                  # 需求/设计规格文档
├── .env.example            # 编排层变量样例（compose 插值专用，见下「配置地图」）
└── docker-compose.yml      # Docker 编排（OCR / Jev 等；同时是容器形态运行配置的权威源）
```

## 配置地图：env / config 归属一览

两个后端统一为 **`.env`（入库 = Docker 形态）/ `.env.local`（本机私产 = 本地形态）** 严格分工（2026-09-20）：

| 文件 | 归属 | 消费方 | 说明 |
|---|---|---|---|
| `agent-backend/.env` | 运行环境 | 仅 compose `env_file` 注入容器 | **Docker 形态**配置（端口/路径/超时，**无密钥**，随仓库入库） |
| `agent-backend/.env.local` | 运行环境 | 本地 `--env-file`（仅本地）+ compose 注入（提供密钥） | **本地形态完整配置**（含密钥 + LAN IP），gitignore；样板 `.env.example` |
| `agent-backend/config.yaml` | 运行环境 | `src/config.ts` 启动加载 | 模型清单（model / api_key / base_url，缺省拒启动） |
| `admin-backend/.env` | 管理平台 | compose `env_file` 注入容器 | **容器形态**配置（`/app/...` 路径、服务名，无密钥，入库） |
| `admin-backend/.env.local` | 管理平台 | 仅本地 `--env-file` | **本地形态**配置（宿主机相对路径）；样板 `.env.example` |
| `.env`（根） | 编排层 | 仅 docker-compose 插值 | `GATEWAY_HOST_PORT` / `JEV_HOST_PORT`，**不注入任何容器**（样板 `.env.example`） |
| `ocr-service/.env` | OCR 服务 | compose `env_file` 注入 ocr 容器 | **容器形态**配置（`OCR_URL_ALLOW_HOSTS=backend` 等，无密钥，入库） |
| `ocr-service/.env.local` | OCR 服务 | compose `env_file` 注入 ocr 容器 | 本机私产：白名单**追加**宿主机 LAN IP（gitignore；样板 `.env.example`） |
| `jev-service/.env` | Jev 服务 | compose `env_file` 注入 jev 容器 | **容器形态**配置（`JEV_URL_ALLOW_HOSTS=backend`，无密钥，入库） |
| `jev-service/.env.local` | Jev 服务 | compose `env_file` 注入 jev 容器 | `TYPESAFE_API_KEY` + 白名单 LAN IP 追加（含密钥，gitignore；样板 `.env.example`） |
| `docker-compose.yml` | 编排层 | docker compose | 编排权威源：挂载/socket/网络；**单点覆盖只剩 `PUBLIC_BASE_URL`**（服务变量一律走各服务 `env_file`） |

读取规则（2026-09-20 分工，2026-09-23 扩到 MCP 服务）：
- **容器**：一律由 compose `env_file` 注入**服务自己的**配置——admin / ocr / jev 读各自的
  `.env`（+ `.env.local` 追加覆盖）；agent 读 `.env` + `.env.local`（运行需要密钥）。
  **compose 文件本身不逐行配置服务变量**；唯一的 `environment` 单点覆盖是
  `PUBLIC_BASE_URL`（容器内必须是服务名口径，本机 LAN IP 只留在 `.env.local`）；
- **本地**：dev/start 只读 `.env.local`（`--env-file=.env.local`），不读 `.env`。
  `.env.local` 是**完整的本地形态配置**（非增量覆盖），样板 `.env.example` 含两形态完整对照。
换机器/换网络时只动**三个** `.env.local` 里的同一个 LAN IP：`agent-backend` 的
`PUBLIC_BASE_URL`、`ocr-service` 的 `OCR_URL_ALLOW_HOSTS`、`jev-service` 的
`JEV_URL_ALLOW_HOSTS`（见下「本地配置要点」）。

## 功能模块说明

### agent-backend（Agent 运行时后端）

**接口层 `routes/`**

| 模块 | 作用 |
|---|---|
| `chat.ts` | 对话接口（SSE 流式输出），Agent 执行主链路 |
| `agents.ts` | 数字人（Agent）列表/切换/配置 |
| `files.ts` | 文件空间：三空间汇总、上传/删除、**签名直链铸造与回源下载** |
| `threads.ts` | 会话（线程）管理与历史 |
| `models.ts` | 模型列表/选择 |
| `builtin-tools.ts` | 内置工具开关与配置 |
| `monitor.ts` | 运行监控（事件流） |
| `usage.ts` / `mcp-call-stats.ts` | Token 用量统计 / MCP 调用统计 |
| `feedback.ts` | 对话反馈（点赞点踩） |

**领域层 `domain/`（纯业务逻辑）**

| 模块 | 作用 |
|---|---|
| `agent-pool.ts` / `agent-instance.ts` / `agent-catalog.ts` | Agent 实例池与目录管理（多用户隔离复用） |
| `interaction-gate.ts` / `interaction-schema.ts` | **HITL 人工确认**：工具调用挂起、倒计时、schema 驱动表单生成 |
| `file-access.ts` / `fs-safe.ts` / `dirs.ts` | 文件访问安全：user-data 沙箱路径解析、越权拦截 |
| `file-arg-path.ts` | MCP 文件参数声明解析（`file_args`：`url` / `url:from=` 模式） |
| `mcp-transport.ts` / `mcp-events.ts` | MCP 连接生命周期与状态事件 |
| `run-manager.ts` | 运行任务管理（中断/恢复/快照） |
| `thread-store.ts` / `history.ts` / `summary.ts` | 会话/消息/摘要持久化 |
| `tools/` | 内置工具实现：计算器、读/写文件、列目录、内容检索 |
| `field-check.ts` / `tmp-cleanup.ts` / `config-fingerprint.ts` | 字段校验 / 临时目录清理 / 配置指纹 |

**基础设施层 `infra/`**

| 模块 | 作用 |
|---|---|
| `llm/` | LLM 提供商抽象（`llm-provider.ts`）与实现（`pi-ai-provider.ts`） |
| `mcp/` | MCP 客户端管理（`mcp-manager.ts`）与工具适配（`mcp-tool-adapter.ts`） |
| `agent-loop.ts` | Agent 主循环：LLM 流 → 工具调用 → 结果回填 |
| `tool-intercept.ts` | 工具调用拦截（HITL 挂起点） |
| `file-sign.ts` | 签名直链 HMAC 签名/验签 |
| `usage-db.ts` | 用量数据存储 |
| `scheduler.ts` | 定时任务（如临时文件清理） |
| `agent-factory.ts` | Agent 实例工厂 |

### frontend（Agent 对话前端）

| 模块 | 作用 |
|---|---|
| `components/chat/` | 消息气泡与 Markdown 渲染、Composer 输入框（**@ 文件引用**三级级联面板）、**InteractionDialog + InteractionField**（HITL 通用表单：schema 驱动**递归**控件映射——对象逐行、对象数组→表格、标量数组→列表、其余走 JSON 逃逸舱——外加 @ 路径引用、结构化文件卡片、算法规则入口）、MentionPicker |
| `components/layout/` | 应用骨架：历史会话侧栏、文件空间面板（空间树 + 文件列表 + 上传） |
| `composables/useChatStream.ts` | 会话流核心：SSE 接收、消息追加、中断/重发、HITL 快照恢复 |
| `composables/useFileMention.ts` | 聊天输入框 @ 引用状态机（触发检测、级联导航、引用登记、提交剥离） |
| `composables/usePathInsert.ts` | HITL 弹窗 @ 路径插入状态机（路径插入语义，复用 MentionPicker 面板协议） |
| `composables/useInteractionForm.ts` | HITL 弹窗表单状态：结构化模型（唯一事实源）、JSON 草稿（逃逸舱）、算法规则入口落点与写回、校验与提交构建 |
| `composables/useWorkspace.ts` | 文件空间数据（三空间汇总、目录文件加载） |
| `composables/useAppSession.ts` | 会话上下文（provide/inject 总线：workspace、toast 等） |
| `composables/useThreads.ts` / `useAgents.ts` / `useModels.ts` | 会话/数字人/模型数据管理 |
| `composables/useUploads.ts` | 文件上传队列 |
| `composables/useResizablePanel.ts` | 侧栏宽度拖拽 |

### admin-backend（数字人管理平台后端）

| 模块 | 作用 |
|---|---|
| `domain/config-center/` | 配置中心：数字人/MCP/技能的配置模型与校验 |
| `domain/deploy/` | 部署编排：把配置下发到 agent-backend 运行时 |
| `domain/skill-library/` | 技能库管理 |
| `domain/mcp/` | MCP 服务注册与连通性检测 |
| `domain/audit.ts` | 操作审计 |
| `domain/platform-settings.ts` | 平台级设置 |
| `infra/docker-host.ts` / `compose-reader.ts` | Docker 环境探测、compose 文件解析 |
| `infra/opt-agent-writer.ts` | 运行时配置文件写入（下发） |
| `infra/runtime-client.ts` | 调用 agent-backend 运行时接口 |
| `infra/mcp-client.ts` | MCP 服务连接测试 |
| `routes/deploy.ts` | 部署下发接口；`routes/users.ts` 用户管理；`routes/references.ts` 引用数据 |

### admin-frontend（数字人管理平台前端）

| 模块 | 作用 |
|---|---|
| `components/agents/` | 数字人列表/编辑/配置 |
| `components/mcp/` | MCP 服务注册、参数配置、连通性测试 |
| `components/skills/` | 技能库维护 |
| `components/deploy/` | 部署预览与下发、运行状态查看 |
| `components/layout/` | 后台框架（导航、布局） |

### ocr-service（OCR MCP 服务）

| 模块 | 作用 |
|---|---|
| `server.py` | MCP 服务入口，暴露 `ocr_image` 等工具 |
| `ocr_core.py` | 表格识别核心：下载签名直链 → SSRF 白名单校验（`OCR_URL_ALLOW_HOSTS`）→ 识别 → 结构化输出 |

### jev-service（Jev 决策 MCP 服务）

TypeSafe System One 决策模型（Jev）的 MCP 封装：把「state + 类型化问题」求值成**结构化决策**
（概率与置信度），供 Agent 直接分支/路由/门控。与 OCR 同为独立部署的内网 MCP 服务。

| 模块 | 作用 |
|---|---|
| `server.py` | MCP 服务入口，暴露三个**原子工具**：`noul`（真假命题→0–1）、`choice`（择一→概率分布+置信度）、`score`（量表打分→加权分值+置信度）；运行时呈现为 `jev__noul` 等 |
| `jev_core.py` | 调用核心：state 合并（LLM 文本 + 引用文件内容）、请求体构造与取值域校验、响应格式化、**有界指数退避**重试（429/529/5xx）、错误映射、回源 SSRF 白名单（`JEV_URL_ALLOW_HOSTS`） |

工具入参中的 state 为**双通道合并**：`state`（LLM 生成的文本）+ `state_file`（可选，
文件空间相对路径，经 `file_args` 铸成签名直链后由本服务回源下载）。两者以

```text
<LLM 文本>

【引用文件：临时空间/订单.csv】
<文件内容>
```

的形状合并后发送；至少提供其一。

### gateway（生产网关）

nginx 反向网关：生产环境将前端静态资源与后端 API 统一入口。

## 环境要求

- Node.js >= 20
- Docker Desktop（OCR / Jev 两个 MCP 服务需要）
- npm

## 本地启动

### 1. MCP 服务（Docker）

```bash
docker compose up -d ocr                            # 首次构建镜像较慢；模型加载约 30 秒
cp ocr-service/.env.example ocr-service/.env.local  # 本机形态才需要：填宿主机 LAN IP（回源白名单）
cp jev-service/.env.example jev-service/.env.local  # 首次：填 TYPESAFE_API_KEY 与同一个 LAN IP
docker compose up -d jev                            # 无本地模型，构建后秒级启动
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

MCP 服务**无需在平台侧登记**——`docker-compose.yml` 就是服务清单的权威源
（非平台基础服务的容器一律视为候选 MCP 服务），新增即自动出现在 `/admin/mcp`：

1. `/admin/mcp` 出现 `jev` 卡片后进详情保存**调用配置**（地址按目标运行形态填）：

   | 运行形态 | `transport` | `url` |
   |---|---|---|
   | 容器编排内网 `container_network` | `http` | `http://jev:8000/mcp` |
   | 宿主机本地 `host_local` | `http` | `http://<宿主机 LAN IP>:8001/mcp` |

   `file_args` 需为 `noul` / `choice` / `score` 三个工具各声明一条 `state_file: url`，
   否则 LLM 传的相对路径不会被铸成下载直链，服务会收到相对路径并报错；
   `confirmation` 建议 `never`（纯求值、无副作用），`rules_fields` 留空。

2. 数字人设计态勾选 `mcp_services` 含 `jev` → 部署 → 平台物化 `MCP.json` → Agent 运行时加载。

> MUST NOT 手工编辑 `.opt-agent/users/{uid}/agents/{agent}/MCP.json`：它是**部署产物**，
> 下次部署按平台设计态整体覆盖，手改不会留存（数字人配置的权威源在平台侧）。

## 本地配置要点：文件回源链路必须使用本机 IP

agent-backend 会把文件空间的相对路径铸造成**签名直链**（如 `http://<主机>:3000/api/files/raw?...&sig=...`），交给 MCP 服务（如 OCR / Jev）回源下载。这条链路要求**三个文件写同一个主机名**——即本机局域网 IP（用 `ipconfig` 查看实际 IPv4 地址，下文以 `192.168.1.3` 为例）：

| 配置项 | 位置 | 作用 |
|---|---|---|
| `PUBLIC_BASE_URL` | `agent-backend/.env.local` | 铸造签名 URL 时使用的对外基址（容器形态由 compose 覆盖为 `http://backend:3000`） |
| `OCR_URL_ALLOW_HOSTS` | **`ocr-service/.env.local`** | OCR 回源白名单（**追加**在 `.env` 的 `backend` 之后） |
| `JEV_URL_ALLOW_HOSTS` | **`jev-service/.env.local`** | Jev 回源白名单（同上） |

```env
# agent-backend/.env.local
PUBLIC_BASE_URL=http://192.168.1.3:3000
```

```env
# ocr-service/.env.local（首次：cp ocr-service/.env.example ocr-service/.env.local）
OCR_URL_ALLOW_HOSTS=backend,192.168.1.3
```

```env
# jev-service/.env.local（首次：cp jev-service/.env.example jev-service/.env.local）
TYPESAFE_API_KEY=...
JEV_URL_ALLOW_HOSTS=backend,192.168.1.3
```

> **为什么白名单在服务自己的文件里**（2026-09-23 变更）：原先由 `docker-compose.yml` 的
> `environment` 拿根 `.env` 的 `HOST_LAN_IP` 拼装——一处配置两个主人（compose 里的默认值与
> 根 `.env` 的覆盖并存），而且**只有重建容器才生效**：`docker restart` 或机器重启后由
> `restart: unless-stopped` 拉起，都只是让**既有容器**再跑一遍，环境变量仍是**创建时**固化
> 的旧值。现在 compose 只声明"注入哪个文件"，服务配置归服务文件，改完 `docker compose
> up -d ocr jev` 重建即生效。
>
> `backend` 保留给全 Docker 形态（容器内互访）；本地运行时 backend 跑在宿主机，容器需经宿主
> IP 回源，故追加该 IP。白名单只影响**引用文件回源下载**（OCR 的 `image`、Jev 的
> `state_file`），纯文本调用不受影响。

改完后需要**重建** MCP 容器、重启 backend 才生效：

```bash
docker compose up -d ocr jev    # 重建容器（只 restart 不会更新环境变量！）
# agent-backend 重启（Ctrl+C 后重新 npm run dev）
```

改完**先验证容器真的拿到了新值**（别只看 compose 文件——它只是"下次创建时会用的值"）：

```bash
docker compose config | grep ALLOW_HOSTS                    # 插值后即将使用的值
docker inspect optagent-ocr --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ALLOW_HOSTS
docker inspect optagent-jev --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ALLOW_HOSTS
```

**为什么不能写 `localhost`**——两个层面都会失败：

1. **白名单是字符串精确匹配**：容器收到的 URL host 是 `192.168.1.3`，与 allowlist 里的 `localhost` 字面不匹配 → SSRF 拒绝。
2. **容器内的 localhost 不是宿主机**：回源动作由 OCR / Jev 容器发起，容器内的 `localhost`/`127.0.0.1` 指向容器自己（其 3000 端口无服务），不是宿主机。容器访问宿主机必须用宿主在网络中的名字——局域网 IP 或 `host.docker.internal`。

## 常用命令

```bash
# 前端测试 / 类型检查（frontend 与 admin-frontend 相同）
npm run test
npm run typecheck

# 后端测试
npm run test

# MCP 服务测试（Python，**宿主机本地**；容器不承担测试职责——宪章原则三）
cd ocr-service && pip install -r requirements-test.txt && python -m pytest -q tests
cd jev-service && pip install -r requirements-test.txt && python -m pytest -q tests
```
