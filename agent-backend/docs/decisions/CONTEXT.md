# 领域术语表（Context）

## 核心术语

- **用户（User）**：系统的使用者，多用户系统。每个用户拥有独立的 `user-data/` 空间
  （业务文件、对话历史、Token 用量）。部署形态为多用户，目录与身份模型按多用户设计。
- **数字人（Digital Human / Agent 配置）**：用户拥有的一个对话角色，由配置文件
  （SOUL.md、MCP.json、TOOL.json、skills/）定义其人格与能力，存放于
  `agents/{agent_name}/`。是静态配置，不是运行时对象。
- **Agent 实例（Agent Instance）**：数字人配置在运行时的内存化身，由某次对话触发创建，
  驻留内存并受 LRU 池管理。易失、可销毁、可重建。
- **对话（Thread）**：一次独立的会话，由 `thread_id` 标识，归属于某个用户。
  对话历史存于 `threads/{thread_id}/history.jsonl`。

## 已确认决策

- **多用户**：系统按多用户设计，用户数据按用户隔离（区别于"本期单用户"方案）。
- **认证**：目标形态为账号密码登录 + JWT 无状态认证。**本轮开发暂不实现认证**，
  所有请求默认归属内置的 `admin` 用户；接口与数据访问层按"当前用户"抽象编写，
  后续接入 JWT 时无需改动业务逻辑。
- **Agent 实例池**：实例 key = (user_id, agent_name)。实例只固化数字人配置
  （System Prompt、工具、MCP 连接），**不持有对话历史**；每轮请求由业务层按
  `thread_id` 拼装滑动窗口+摘要注入。`stop` 信号仅中断该 thread 的推理流，
  **不销毁实例**（取代原文档"stop 销毁实例"），实例回收统一交给 LRU + 空闲超时。
- **实例池容量**：全局最多同时驻留 **5 个** Agent 实例（LRU 淘汰，仅淘汰空闲实例）。
  并发额度为 **1 用户 : 最多 3 个并发 thread**（按 userId 统计、跨数字人累计）。
  **2026-09-10 修订**：用户同一时刻仍只有一个"当前选中数字人"，但 `select` 为
  **覆盖式**——切换**无需先退出**，也**不校验会话是否进行中**；**会话不绑定数字人**，
  同一会话内可切换，本轮由当前选中数字人执行、在**下一轮消息**生效
  （消息逐条记录 `agent_name`）。空闲超时统一为 **10 分钟**
  （删除原文档"30 分钟"表述）。各项均可配置。超出限制时拒绝请求并返回友好提示，
  不排队、不淘汰在用实例。
- **退出数字人**：仅清除"用户当前选中的数字人"这一会话状态，**后端实例不销毁**，
  由 LRU + 空闲超时自然回收；重新选回同一数字人时直接复用实例。
- **MCP 策略**：超时统一为 **30 秒**（初始化建连与运行期调用相同，取代原文档
  "5 秒/30 秒"双值），重试 1 次。初始化时 MCP 连接失败**不阻断** Agent 启动，
  该实例降级就绪、标记该 MCP 不可用；调用到不可用的 MCP 时回复
  "当前服务不可用，请稍后尝试"并记录告警日志。
- **内置工具（本期 6 个）**：`read_file`（读 7 业务目录 + shared，经权限代理，
  单文件读取截断到可配上限 32KB，超出提示分段读）、`write_file`（写 `tmp/`，
  强制 thread_id 前缀）、`list_dir`、`calculator`（安全表达式求值）、
  `grep_files`（文件内容搜索，限 Agent 可读目录，经同一权限代理）。
  联网搜索本期不做（涉及外部 API 依赖与计费，另立项）。
- **性能口径**：非 LLM 接口（thread CRUD、文件上传/列表、Token 查询、监控）
  P95 ≤ 200ms；对话接口以**首字延迟 < 5s** 为指标（收到请求 → 推送首个 SSE 事件，
  模型自身推理时间不计入）。
- **监控接口**：`GET /api/monitor/agents`（存活实例数 + 每实例明细：user、
  agent_name、活跃 thread 数、空闲时长、降级状态如不可用 MCP 列表）；
  `GET /api/monitor/health`（进程存活、内存 RSS、`.opt-agent` 磁盘可用空间）。
  均只读 JSON，本期无认证供运维内网调用，不接 Prometheus。
- **水平扩展**：本期单机部署、**不引入 Redis**。但"实例池"与"会话状态"必须收敛为
  接口背后的可替换组件，为日后分布式（Redis 会话索引 + 粘性路由）预留扩展点，
  本期业务代码不感知单机/分布式的差异。
- **Thread 生命周期**：thread_id 由**后端生成**（UUID）。接口集：创建、列表
  （按更新时间倒序，标题取首条 user 消息前 20 字）、重命名、删除。删除 thread
  连带删除 history/summary 及 `tmp/` 下该 thread_id 前缀的文件；`tmp/` 另设
  定期清理（7 天未访问清除）。
- **模型配置**：本期**全局单模型**（默认 deepseek-v4-flash-vision-exp，2026-09-09
  由 deepseek-v4-flash 修订），`config.yaml` models 列表第一项指定、重启生效；
  代码中模型提供方抽象为接口（chat/stream/tools/thinking），
  为日后扩展 Qwen/GPT 及按数字人/按请求切换留扩展点（本期不实现）。
- **断连语义**：客户端断开（切换页面/关闭浏览器）**不等于停止**——正在输出的那条
  assistant 消息继续完成并落盘；若 agentic loop 还有后续步骤（再调工具/再推理）
  则就此收尾，不开启新步骤。用户重连后从 history.jsonl 看到完整回复。
  显式 `stop` 信号才中断推理（按 thread_id，丢弃本轮未保存消息）。
- **文件权限**：不采用 monkey-patch `os.open`（拦不住 pathlib/第三方库/MCP 自写，
  且污染全局）。改为显式 **文件访问代理层**：Agent 全部文件读写经同一代理，
  内部做路径规范化 + 白名单校验，写操作仅限 `tmp/`（且必须带 thread_id 前缀），
  违规抛 `PermissionError`。MCP 服务的写能力在 MCP.json 注册时声明边界。
  **用户上传目标**：7 个业务目录 + `shared/`（`tmp/` 为 Agent 专用，用户不直接上传）；
  上传自动追加 `_YYYYMMDD_HHMMSS` 时间戳，单文件 ≤ 50MB，
  限 `.csv/.xlsx/.txt/.json/.pdf`。
- **Token 统计**：引入 **SQLite** 作为用量存储（选型理由：单文件零部署、契合单机
  形态；多维汇总查询天然支持；对比候选——纯日志文件查询需全量扫描不可行、
  Redis 易失不适合计费、MySQL 运维过重）。每轮对话记录一条
  （user/thread/agent/input_tokens/output_tokens/时间戳）；按日切分的日志文件
  保留为审计备份，不作为查询数据源。
- **SSE 输出**：流式事件分四类——`thinking`（推理流，前端折叠渲染、**不落盘**）、
  `content`（正式回复流）、`done`、`error`；不推送 tool 调用日志与中间推理链
  （thinking 除外）。每轮请求可带 `thinking` 开关。
- **数字人配置**：人格文件以 **`SOUL.md`** 为准（原文档"SOUL.json"为笔误）；
  `SKILL.md` 头部采用 **YAML frontmatter**（name/description 等），仅头部注入
  System Prompt。本期后端对数字人配置**只读**：仅提供列表/详情查询接口，
  创建与下发由数字人设计平台负责（直接写目录）。
- **对话历史与摘要**：`history.jsonl`（**JSONL 格式**，每行一条消息，追加写 O(1)、
  崩溃最多损失最后一行；取代原文档的 JSON 数组格式）仅存 user/assistant 原文。
  **不分片**，每 thread 一个文件（取代原文档"或按日期分片"的待定项）。摘要为派生物，
  单独存 `threads/{thread_id}/summary.json`（摘要文本 + 已覆盖消息序号）。
  采用**滚动摘要**：最近 20 条完整注入，更早的全部并入摘要（不设 100 条上限）；
  窗口外每新增满 20 条，异步增量重写摘要；摘要生成失败不阻塞对话（用旧摘要）。

## 技术选型决策（2026-09-09 评审确认）

- **运行时**：Node.js（20+/24）+ TypeScript（ESM、strict 全套、`noUncheckedIndexedAccess`）。
- **Agent 框架**：`@earendil-works/pi-agent-core@0.85.1`（精确锁定版本；旧
  `@mariozechner/pi-agent-core` 已废弃，不用；npm 裸名 `pi-agent-core` 为无关占位包）。
  **架构方案 A**：实例池缓存"配置包"（System Prompt、工具集、MCP 连接、LLM 客户端），
  每轮推理由业务层拼装历史后调用 pi 的**低层 `runAgentLoop`**；3 并发 thread = 3 个
  独立 loop；不使用 pi 的高层有状态 `Agent` 类（其单 run 串行模型与多 thread 并发冲突）。
- **Web 框架**：Fastify 5 + `@fastify/multipart`（50MB 流式上传）+ `@fastify/cors`（可配）。
- **MCP 客户端**：`@modelcontextprotocol/sdk`，stdio + Streamable HTTP 两种传输
  （留 legacy SSE 路径对接旧服务）；30s 超时 + 重试 1 次 + 建连失败降级由封装层实现。
- **Token 存储**：`better-sqlite3`（锁版本），**全局单库** `.opt-agent/usage.db`，
  多用户隔离用 `user_id` 列 + 数据访问层强制过滤（分库方案的连接管理与跨用户汇总
  代价不划算）。
- **LLM 接入**：pi-ai 内置 deepseek provider（模型目录含 `deepseek-v4-flash-vision-exp`，
  `reasoning_content` 流式解析为 thinking 事件原生支持）；模型配置走 `config.yaml`
  的 models 列表（条目 api_key 优先，.env 的 DEEPSEEK_API_KEY 兜底；默认模型 =
  列表第一项，2026-09-09 确认为 deepseek-v4-flash-vision-exp）；base_url 可配置覆盖；
  业务层经薄 `LlmProvider` 防腐接口调用；每轮 `thinking` 开关映射为请求级推理参数。
- **对话执行模型（Run Manager）**：agent loop 与 HTTP 请求生命周期解耦；SSE 是事件
  总线的订阅者，断连只是退订，loop 照跑；落盘器独立于 SSE 订阅持续累积 content 并
  写 history.jsonl；同 thread 同时仅一个活跃 run（进行中重复发消息 → 409）；
  **本期不做实时续推**（断连重连后前端拉完整历史，续推所需广播骨架预留二期）；
  `stop` = 按 thread_id 找 AbortController 中断。
- **后台调度**：进程内 `setInterval`（tmp 清理每小时、实例空闲回收每分钟），统一
  `Scheduler` 模块便于优雅关闭；摘要重写事件触发（窗口外每满 20 条），per-thread
  Promise 链串行，失败降级用旧摘要。
- **日志**：`pino`，进程直写按日切分文件 `.opt-agent/logs/app-YYYY-MM-DD.log`；
  关键字段 `user_id/thread_id/agent_name/event/duration_ms`；告警日志带
  `alert: true`；Token 审计日志独立 child logger 按日写 `usage-*.log`。
- **配置**：双源——`.env`（Node 内置 `--env-file` 加载：运行参数 + key 兜底）+
  `config.yaml`（models 列表，`yaml` 包解析）；zod 统一启动校验（类型转换/默认值/
  错误即拒启动，models 缺失或为空即拒）+ 冻结 `config.ts` 导出，业务代码不直接碰
  `process.env` 或配置文件；密钥不进日志与仓库（config.yaml 加入 gitignore）。
- **read_file 格式解析**：`.xlsx` 用 SheetJS 转 CSV 文本；`.pdf` 用 pdfjs 提取
  文本层（扫描件无文本层则友好提示，本期不做 OCR）；文本格式直读；统一 32KB 截断
  - `offset/limit` 分段读参数。
- **代码结构**：`routes/（薄 HTTP 层）/ domain/（agent-pool、run-manager、history、
summary、file-access、tools，不 import Fastify/pi）/ infra/（llm、mcp、agent-loop
封装、usage-db、scheduler）`；接口由 domain 定义、infra 实现，依赖方向向内。
- **测试**：vitest；单元测试为主（file-access、history 恢复、LRU、摘要、配置），
  集成测试用 Fastify `app.inject()` + 临时 SQLite + 假 `LlmProvider` 覆盖 SSE 全流程
  （断连续跑、stop 中断）；真 key 冒烟脚本 `scripts/smoke.ts` 本地手动跑；
  domain 核心覆盖率 ≥80%。
- **工程化**：`tsx watch` 开发、`tsc` 构建 `dist/`、`node --env-file=.env` 运行；
  ESLint（typescript-eslint 推荐集）+ Prettier。
- **优雅关闭**：SIGTERM/SIGINT 后停止接新请求；进行中 run 进入 draining（当前
  assistant 消息写完落盘、不开新 loop 步骤），宽限期 15s（可配）后 abort 并尽力
  落盘；摘要等派生任务直接放弃；SQLite close、pino flush；强杀兜底下 JSONL 最多
  损失最后一行（配合 3.3 损坏恢复）。
- **API 约定**：全部 `/api/*`，本期不加版本前缀；统一错误 envelope
  `{ "error": { "code", "message" } }`（SSE 流内走 `error` 事件同结构）；路由级
  JSON Schema 校验；手写 `docs/api.md`（本期不接 Swagger UI）。
