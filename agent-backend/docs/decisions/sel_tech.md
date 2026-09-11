# 技术选型决策（sel_tech）

> 来源：2026-09-09 技术选型评审（16 项决策逐项确认），与 [CONTEXT.md](./CONTEXT.md)
> 「技术选型决策」章节内容一致。
> 需求依据：[req_final.md](../../req_final.md)

## 总览表

| #   | 领域           | 决策                                                                                             |
| --- | -------------- | ------------------------------------------------------------------------------------------------ |
| 1   | 运行时         | Node.js (20+/24) + TypeScript（ESM、strict 全套）                                                |
| 2   | Agent 框架     | `@earendil-works/pi-agent-core@0.85.1`（精确锁定）                                               |
| 3   | Web 框架       | Fastify 5 + `@fastify/multipart` + `@fastify/cors`                                               |
| 4   | MCP 客户端     | `@modelcontextprotocol/sdk`（stdio + Streamable HTTP）                                           |
| 5   | Token 存储     | `better-sqlite3`，全局单库 `.opt-agent/usage.db`                                                 |
| 6   | LLM 接入       | pi-ai 内置 deepseek provider（`deepseek-v4-flash-vision-exp`）+ 薄 `LlmProvider` 防腐接口        |
| 7   | 对话执行       | Run Manager 模式（loop 与 HTTP 解耦，SSE 为订阅者，断连≠停止；**本期不做实时续推**，重连拉历史） |
| 8   | 后台调度       | 进程内 `setInterval` + 摘要事件触发 per-thread 串行                                              |
| 9   | 日志           | `pino`，按日切分文件 `.opt-agent/logs/`                                                          |
| 10  | 配置           | `.env`（运行参数）+ `config.yaml`（models 列表）双源 + zod 启动校验 + 冻结 `config.ts`           |
| 11  | read_file 解析 | SheetJS（xlsx→CSV）+ pdfjs（pdf 文本层）                                                         |
| 12  | 代码结构       | `routes / domain / infra` 三层，依赖方向向内                                                     |
| 13  | 测试           | vitest + `app.inject()` 集成 + 假 LlmProvider + 冒烟脚本                                         |
| 14  | 工程化         | ESM、`tsx watch`、`tsc`、ESLint + Prettier                                                       |
| 15  | 优雅关闭       | draining ≈ 全员断连语义 + 15s 宽限                                                               |
| 16  | API 约定       | `/api/*`、统一错误 envelope、JSON Schema 校验、`docs/api.md`                                     |

---

## 详细决策

### 1. 运行时

- **Node.js（20+/24）+ TypeScript**，ESM（`"type": "module"`）。
- 因 Agent 框架选定 pi-agent-core（TypeScript/Node 生态），整个后端锁定 Node.js 技术栈。
- 需求文档中"monkey-patch `os.open`"等 Python 味表述不影响（已改为显式文件访问代理层）。

### 2. Agent 框架（关键决策）

- **`@earendil-works/pi-agent-core@0.85.1`**，精确锁定版本（<1.0，API 可能变动）。
  - ⚠️ npm 裸名 `pi-agent-core` 是无关占位包；旧 scope `@mariozechner/pi-agent-core`
    （停于 0.73.1）已 DEPRECATED，均不可用。
  - 配套 `@earendil-works/pi-ai@0.85.1`（统一 LLM API）。
- **架构方案 A**：pi 的高层 `Agent` 类是有状态的（自持 transcript、单 run 串行），
  与"实例不持有历史 + 3 并发 thread"冲突。因此：
  - 实例池（key = user_id + agent_name）缓存的是**配置包**：System Prompt、
    工具集、MCP 连接、LLM 客户端。
  - 每轮推理由业务层加载 history + summary 拼装后，调用 pi 的**低层
    `runAgentLoop`** 跑独立 run；3 并发 thread = 3 个独立 loop。
  - LRU 回收对象 = 配置包与 MCP 连接；"空闲" = 无进行中 loop，判定干净。

### 3. Web 框架

- **Fastify 5**：性能满足"非 LLM 接口 P95 ≤ 200ms"；SSE 一等支持。
- `@fastify/multipart`：50MB 文件流式上传、限大小。
- `@fastify/cors`：开发期放行 localhost，生产可关，做成配置项。
- 将来接 JWT 用 `@fastify/jwt`，与"本期无认证、后续不改业务逻辑"的抽象吻合。

### 4. MCP 客户端

- **`@modelcontextprotocol/sdk`**（官方 TS SDK），pi-agent-core 不含 MCP 能力，需单独引入。
- 传输：**stdio 子进程 + Streamable HTTP 都支持**；留 legacy `SSEClientTransport`
  路径对接旧服务（成本近零）。
- 超时 30s（建连与调用一致）+ 重试 1 次 + 建连失败降级，由封装层实现。

### 5. Token 存储

- **`better-sqlite3`**（锁版本）：同步 API 在此场景是优点（INSERT/汇总查询微秒级）。
- **全局单库** `.opt-agent/usage.db`，多用户隔离用 `user_id` 列 + 数据访问层
  强制过滤。
  - 分库方案被否：连接需按用户管理、跨用户汇总（运维/计费对账）体验差；
    文件隔离已在目录层（`users/{user_id}/`）实现，用量是小行结构化数据，
    SQL 列隔离足够。

### 6. LLM 接入

- pi-ai **内置 deepseek provider**，模型目录含 `deepseek-v4-flash-vision-exp`
  （reasoning: true），`openai-completions` 实现原生把 `reasoning_content`
  流式解析为 thinking 事件 → 需求 2.4 的 thinking 流式推送零造轮子。
- **模型配置走 `config.yaml`**（方案乙，2026-09-09 修订）：
  ```yaml
  models:
    - api_key: sk-... # 该模型的 key（优先）
      model: deepseek-v4-flash-vision-exp
      # base_url: 可省略，默认 https://api.deepseek.com
  ```
  默认模型 = `models` 列表第一项；`.env` 的 `DEEPSEEK_API_KEY` 仅作兜底
  （条目缺 api_key 时使用）。base_url 可覆盖便于走代理/网关。
- 每轮请求的 `thinking` 开关映射为请求级推理参数，无需双模型配置。
- 业务层经薄 **`LlmProvider { streamChat(messages, tools, opts) }`** 防腐接口调用
  pi-ai——为将来接 Qwen/GPT、按数字人切模型留扩展点（需求 2.8）；config.yaml
  的 models 列表即多模型配置的预留形态。

### 7. 对话执行模型（Run Manager）

- agent loop **与 HTTP 请求生命周期解耦**（客户端断开 ≠ 停止，需求 2.6）：
  - `POST /api/threads/{id}/messages` 启动 run；loop 在后台异步跑。
  - 每 thread 一个事件总线：SSE 流是订阅者（断开只是退订），落盘器独立订阅，
    content 持续累积、结束后写 history.jsonl——无客户端连着也照跑照存。
  - 同 thread 同时仅允许一个活跃 run；进行中重复发消息 → 409。
  - **本期不做实时续推**（原计划的 stream 端点 + resumed 事件砍掉）：断连重连后
    前端用 `GET /api/threads/{id}` 拉完整历史；事件总线的广播骨架已就位，
    二期加一个订阅者即可恢复续推能力。
  - `stop` 接口 = 按 thread_id 找 AbortController 中断，丢弃本轮未保存消息
    （token 用量仍记录），不销毁实例。

### 8. 后台调度

- 进程内 `setInterval`，统一 `Scheduler` 模块注册，优雅关闭时清理：
  - `tmp/` 7 天未访问清理：**每小时**扫描。
  - 实例空闲 10 分钟回收：**每分钟**扫描。
- 摘要重写**不走定时器**：对话轮结束检查窗口外是否攒满 20 条，fire-and-forget
  触发增量重写；per-thread Promise 链串行防并发；失败记日志用旧摘要（需求 2.3）；
  摘要调用复用同一 `LlmProvider`。

### 9. 日志

- **`pino`**（Fastify 内置）：JSON 结构化、性能最好。
- 进程直写按日切分文件 `.opt-agent/logs/app-YYYY-MM-DD.log`（单机部署自足，
  不依赖外部收集器）；开发期可用 `pino-pretty`。
- 关键字段：`user_id`、`thread_id`、`agent_name`、`event`、`duration_ms`、`error`。
- 告警（MCP 降级、历史损坏重建、Agent 崩溃）带 `alert: true`。
- Token 审计日志独立 child logger 按日写 `usage-YYYY-MM-DD.log`（仅审计备份，
  查询数据源是 SQLite）。

### 10. 配置

- **双源配置**（2026-09-09 修订，方案乙）：
  - `.env`（Node 内置 `--env-file` 加载）：运行参数（端口、池容量、超时、
    路径、CORS、关机宽限）+ `DEEPSEEK_API_KEY`（模型 key 兜底）；
  - `config.yaml`：`models` 列表（model/api_key/base_url），默认取第一项，
    条目 api_key 优先于 .env 兜底。
- 启动时 **zod** 统一校验两个来源（类型转换/默认值/错误即拒启动；
  config.yaml 缺失 models 或为空即拒）。
- 所有配置经单一 **`config.ts`** 导出冻结对象，业务代码不直接碰
  `process.env` / 配置文件。
- 密钥只走环境变量或 config.yaml（gitignore），不进日志、不进仓库。
- 可配项：models（模型/key/base_url）、池容量 5、空闲超时 10min、
  MCP 超时 30s、上传上限 50MB、read_file 截断 32KB、`.opt-agent` 根路径、
  端口、CORS、关机宽限 15s。

### 11. read_file 格式解析（需求未写明的坑）

- 上传允许 `.csv/.xlsx/.txt/.json/.pdf`，其中 xlsx/pdf 是二进制，必须解析：
  - `.xlsx`：**SheetJS（`xlsx`）** 逐 sheet 转 CSV 文本（LLM 友好）；
  - `.pdf`：**pdfjs-dist** 提取文本层；扫描件无文本层 → 友好提示"无法读取"
    （本期不做 OCR，合理边界）；
  - `.csv/.txt/.json`：直读。
- 解析后统一 32KB 截断；`read_file` 增加可选 `offset/limit` 分段读参数。

### 12. 代码结构

```
src/
├── config.ts                 # zod 校验后的冻结配置
├── server.ts                 # Fastify 装配、路由注册
├── routes/                   # 薄 HTTP 层：threads / files / agents / monitor / usage / chat(SSE)
├── domain/                   # 业务核心（不 import Fastify/pi）
│   ├── agent-pool.ts         # LRU 实例池（接口 PoolStore，本期内存实现）
│   ├── run-manager.ts        # 对话运行管理（AbortController、事件总线）
│   ├── history.ts            # history.jsonl 读写、损坏恢复
│   ├── summary.ts            # 滚动摘要
│   ├── file-access.ts        # 文件访问代理层（路径规范化 + 白名单）
│   └── tools/                # 6 个内置工具（经 file-access 代理）
├── infra/                    # 外部世界适配器
│   ├── llm/                  # LlmProvider 接口 + pi-ai 实现
│   ├── mcp/                  # MCP 客户端封装（stdio/HTTP）
│   ├── agent-loop.ts         # pi-agent-core 低层 loop 调用封装
│   ├── usage-db.ts           # better-sqlite3
│   └── scheduler.ts          # tmp 清理 / 空闲回收
└── logging.ts                # pino
```

- 接口（`LlmProvider`、`PoolStore`）由 domain 定义、infra 实现，**依赖方向向内**；
  结构性保证"实例池/会话状态可替换""模型提供方抽象"两条需求，而非靠自觉。

### 13. 测试

- **vitest**（TS 原生、配置少）。
- 单元测试为主：`file-access` 白名单/前缀、history 坏行跳过与重建、摘要窗口、
  LRU 淘汰、配置校验。
- 集成测试：Fastify `app.inject()` + 临时 SQLite + **假 `LlmProvider`**
  （接口抽象的红利：SSE 全流程、断连续跑、stop 中断可端到端测，不调真 API）。
- 冒烟脚本 `scripts/smoke.ts`：真 DeepSeek key 跑一轮，验证 thinking 流式与
  token 落库；不进 CI。
- domain 核心模块覆盖率 ≥80%，不追求全局数字；不测 pi 库内部。

### 14. 工程化

- 开发：`tsx watch`；构建：`tsc` → `dist/`；运行：
  `node --env-file=.env dist/server.js`。不上 bundler。
- `strict: true` 全套 + `noUncheckedIndexedAccess`（路径/数组操作多，值得）。
- ESLint（typescript-eslint 推荐集）+ Prettier。

### 15. 优雅关闭

- SIGTERM/SIGINT → Fastify 停止接新请求。
- 进行中 run 进入 draining：当前 assistant 消息写完落盘、不开新 loop 步骤；
  宽限期 **15s（可配）** 后 abort，已累积 content 尽力落盘。
- 摘要重写等派生任务直接放弃（下轮可再生成）。
- SQLite close（同步写天然安全）、pino flush。
- 强杀（kill -9）兜底：JSONL 追加写保证最多损失最后一行，配合需求 3.3 损坏恢复。

### 16. API 约定

- 全部 `/api/*`，本期不加版本前缀（单机内部系统）。
- 统一错误 envelope：`{ "error": { "code": "POOL_EXHAUSTED", "message": "..." } }`；
  HTTP 状态语义化（409 容量超限 / 403 权限 / 404 / 400）；SSE 流内错误走 `error`
  事件、同结构；Fastify 全局 `setErrorHandler` 一处收敛。
- 路由级 JSON Schema 校验（Fastify 原生）。
- API 文档手写 `docs/api.md`（本期接口少，不接 Swagger UI）。

---

## 依赖清单（npm）

| 包                                                      | 版本策略          | 用途                                |
| ------------------------------------------------------- | ----------------- | ----------------------------------- |
| `@earendil-works/pi-agent-core`                         | **精确锁 0.85.1** | agent loop、工具执行、事件流        |
| `@earendil-works/pi-ai`                                 | 精确锁 0.85.1     | 统一 LLM API、deepseek provider     |
| `fastify`                                               | ^5                | Web 框架                            |
| `@fastify/multipart`                                    | 最新              | 文件上传                            |
| `@fastify/cors`                                         | 最新              | CORS                                |
| `@modelcontextprotocol/sdk`                             | 最新              | MCP 客户端                          |
| `better-sqlite3`                                        | 锁版本            | Token 用量 SQLite                   |
| `pino` / `pino-pretty`                                  | 最新              | 结构化日志                          |
| `zod`                                                   | 最新              | 配置校验（.env + config.yaml 双源） |
| `yaml`                                                  | 最新              | config.yaml 解析                    |
| `xlsx`（SheetJS）                                       | 最新              | xlsx → CSV                          |
| `pdfjs-dist`                                            | 最新              | pdf 文本提取                        |
| `typescript` / `tsx` / `vitest` / `eslint` / `prettier` | 最新              | 开发工具链                          |
