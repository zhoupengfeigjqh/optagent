# OptAgent 智能体平台

智能体（Agent）应用平台。平台分两端：

- **Agent 端**：面向使用者的对话式智能体，支持 MCP 工具调用、人工确认（HITL）、文件空间、多会话管理
- **数字人管理平台**：面向运营/管理员的管理后台，管理数字人（Agent）、技能、MCP 服务与平台配置，并负责把配置下发部署到运行端

OCR 表格识别作为 MCP 工具服务独立部署（Docker）。

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
├── gateway/                # 生产网关（nginx）
├── specs/                  # 需求/设计规格文档
└── docker-compose.yml      # Docker 编排（OCR 等）
```

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
| `components/chat/` | 消息气泡与 Markdown 渲染、Composer 输入框（**@ 文件引用**三级级联面板）、**InteractionDialog**（HITL 通用表单：schema 驱动控件映射 + @ 路径引用 + 结构化文件卡片）、MentionPicker |
| `components/layout/` | 应用骨架：历史会话侧栏、文件空间面板（空间树 + 文件列表 + 上传） |
| `composables/useChatStream.ts` | 会话流核心：SSE 接收、消息追加、中断/重发、HITL 快照恢复 |
| `composables/useFileMention.ts` | 聊天输入框 @ 引用状态机（触发检测、级联导航、引用登记、提交剥离） |
| `composables/usePathInsert.ts` | HITL 弹窗 @ 路径插入状态机（路径插入语义，复用 MentionPicker 面板协议） |
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

### gateway（生产网关）

nginx 反向网关：生产环境将前端静态资源与后端 API 统一入口。

## 环境要求

- Node.js >= 20
- Docker Desktop（仅 OCR 服务需要）
- npm

## 本地启动

### 1. OCR 服务（Docker）

```bash
docker compose up -d ocr        # 首次构建镜像较慢；模型加载约 30 秒
```

### 2. Agent 后端（端口 3000）

```bash
cd agent-backend
cp .env.example .env            # 首次：复制环境变量，按下方「本地配置要点」修改
cp config.example.yaml config.yaml  # 首次：复制配置，填入模型 API Key
npm install                     # 首次
npm run dev                     # tsx watch + .env 热加载
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

## 本地配置要点：文件回源链路必须使用本机 IP

agent-backend 会把文件空间的相对路径铸造成**签名直链**（如 `http://<主机>:3000/api/files/raw?...&sig=...`），交给 MCP 服务（如 OCR）回源下载。这条链路要求两处配置使用同一个主机名——**本机局域网 IP**（用 `ipconfig` 查看实际 IPv4 地址，下文以 `192.168.1.3` 为例）：

| 配置项 | 位置 | 作用 |
|---|---|---|
| `PUBLIC_BASE_URL` | `agent-backend/.env` | 铸造签名 URL 时使用的对外基址 |
| `OCR_URL_ALLOW_HOSTS` | `docker-compose.yml` → `ocr` 服务的 `environment` | OCR 回源 SSRF 白名单，对签名 URL 的 host 做**字符串精确匹配** |

```env
# agent-backend/.env
PUBLIC_BASE_URL=http://192.168.1.3:3000
```

```yaml
# docker-compose.yml → ocr
environment:
  OCR_URL_ALLOW_HOSTS: backend,192.168.1.3
```

> `backend` 保留给全 Docker 部署形态（容器内互访）；本地运行时 backend 跑在宿主机，OCR 容器需经宿主 IP 回源。

改完后需要重建 OCR 容器、重启 backend 才生效：

```bash
docker compose up -d ocr        # OCR 重建，加载新环境变量
# agent-backend 重启（Ctrl+C 后重新 npm run dev）
```

**为什么不能写 `localhost`**——两个层面都会失败：

1. **白名单是字符串精确匹配**：OCR 收到的 URL host 是 `192.168.1.3`，与 allowlist 里的 `localhost` 字面不匹配 → SSRF 拒绝。
2. **容器内的 localhost 不是宿主机**：回源动作由 OCR 容器发起，容器内的 `localhost`/`127.0.0.1` 指向容器自己（其 3000 端口无服务），不是宿主机。容器访问宿主机必须用宿主在网络中的名字——局域网 IP 或 `host.docker.internal`。

## 常用命令

```bash
# 前端测试 / 类型检查（frontend 与 admin-frontend 相同）
npm run test
npm run typecheck

# 后端测试
npm run test
```
