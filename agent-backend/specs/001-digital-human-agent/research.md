# Phase 0 Research: 数字人Agent对话后端

> 本文件汇总 Technical Context 中全部技术选型的研究结论。
> 所有"NEEDS CLARIFICATION"均已在 2026-09-09 的技术选型评审中逐项解决，
> 评审记录见 [sel_tech.md](../../../docs/decisions/sel_tech.md)。本文件按
> Decision / Rationale / Alternatives considered 格式整理。

## R1. Agent 框架与运行时

- **Decision**: Node.js 20+ / TypeScript（ESM, strict）+
  `@earendil-works/pi-agent-core@0.85.1`（精确锁定）。
- **Rationale**: pi-agent-core 是 pi-mono 项目的 TS 库，提供低层 agentic loop
  （工具执行、事件流、重试、AbortSignal 中断）。实测 npm：裸名 `pi-agent-core`
  为占位包；`@mariozechner/pi-agent-core@0.73.1` 已 DEPRECATED，官方后继为
  `@earendil-works` scope（当前 0.85.1，活跃维护，45 个版本）。<1.0 故锁版本。
- **Alternatives considered**: 旧 `@mariozechner` scope（废弃）；Python 生态重写
  （放弃 pi-agent-core 的成熟 loop 实现，且团队已定调）。

## R2. pi-agent-core 的使用方式（架构方案 A）

- **Decision**: 实例池缓存"配置包"（System Prompt、工具集、MCP 连接、LLM 客户端）；
  每轮推理由业务层拼装 history+summary 后调用低层 `runAgentLoop`；
  不使用高层有状态 `Agent` 类。
- **Rationale**: 阅读 `agent.d.ts` 确认高层 `Agent` 自持 transcript（state.messages）
  且单 run 串行（并发消息走 steering/follow-up 队列），与 FR-013（实例不持有历史）
  和 FR-014（3 并发 thread）直接冲突。方案 A 使 3 并发 thread = 3 个独立 loop，
  "空闲实例"判定（无进行中 loop）干净，LRU 语义清晰。

  **T012 竖切验证修订（2026-09-09）**：真 key 冒烟发现——`reasoning`（thinking 档位）
  仅在 `provider.streamSimple` 路径生效；`provider.stream`（ApiStreamOptions）不做
  ThinkingLevel→provider 参数映射，thinking 事件会静默丢失。故 agent-loop 的
  `streamFn` 必须委托 `streamSimple`。另：`deepseekProvider` 从子路径
  `@earendil-works/pi-ai/providers/deepseek` 导出（包根不导出）。
- **Alternatives considered**: 方案 B（池内放高层 Agent，每轮 reset 重灌历史——
  并发需互斥锁，退化为串行，违背 FR-014）；方案 C（实例 key 加 thread_id 维度——
  违背已确认决策且池容量语义全变）。

## R3. Web 框架

- **Decision**: Fastify 5 + `@fastify/multipart` + `@fastify/cors`。
- **Rationale**: 原生 JSON Schema 校验；multipart 流式处理 50MB 上传并限大小；
  SSE 直接写 `reply.raw`；性能满足非 LLM 接口 P95 ≤200ms；`@fastify/jwt`
  为后续认证预留。
- **Alternatives considered**: Express（异步错误处理/SSE 需手工糊）；Hono
  （multipart 与生态较薄）。

## R4. LLM 接入（DeepSeek）

- **Decision**: pi-ai 内置 deepseek provider；模型配置走 `config.yaml` 的
  `models` 列表（条目 api_key 优先，`.env` 的 `DEEPSEEK_API_KEY` 兜底），
  默认模型 = 列表第一项（本期 `deepseek-v4-flash-vision-exp`，2026-09-09
  用户确认取代 req_final 中的 `deepseek-v4-flash`）；业务层经薄 `LlmProvider`
  接口调用；thinking 开关为请求级参数。
- **Rationale**: 实测 pi-ai 模型目录（`providers/data/deepseek.json`）含
  `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp`（均 reasoning: true）；
  其 `openai-completions` 实现将 `reasoning_content` 流式字段解析为 thinking
  事件——FR-020/021 的 thinking 流式推送零造轮子。config.yaml 的 models 列表
  即需求 2.8 多模型扩展的预留形态（用户已有此配置文件习惯）。
- **Alternatives considered**: .env 单源（方案甲，更简单但与用户既有
  config.yaml 习惯冲突，被否）；直连 DeepSeek 裸 API（失去 pi-ai 流式归一化）。

## R5. MCP 客户端

- **Decision**: `@modelcontextprotocol/sdk`（官方 TS SDK）；stdio 子进程 +
  Streamable HTTP 双传输，留 legacy SSE 路径；30s 超时 + 重试 1 次 + 降级
  由封装层实现。
- **Rationale**: pi-agent-core 不含 MCP 能力；官方 SDK 内置两种传输与
  listTools/callTool；MCP 规范中旧 "HTTP+SSE" 已被 Streamable HTTP 取代，
  legacy SSE 仅作兼容旧服务的退路。
- **Alternatives considered**: 自实现 MCP 协议（无谓造轮子）。

## R6. Token 用量存储

- **Decision**: `better-sqlite3`（锁版本），全局单库 `.opt-agent/usage.db`，
  `user_id` 列隔离多用户。
- **Rationale**: 需求 2.7 已定 SQLite（单文件零部署、SQL 多维汇总；对比过
  纯日志全量扫描不可行、Redis 易失、MySQL 运维过重）。better-sqlite3 同步 API
  在本场景（每轮一条 INSERT + 低频汇总）是优点；Windows 有 prebuilt。
  分库方案被否：连接需按用户管理、跨用户汇总体验差；文件隔离已在目录层实现。
- **Alternatives considered**: `node:sqlite`（Node 22+ 内置但仍 Experimental）；
  分用户多库（上述理由否决）。

## R7. 对话执行模型

- **Decision**: Run Manager——agent loop 与 HTTP 请求解耦；每 thread 一个事件
  总线；SSE 为订阅者（断开=退订）；落盘器独立订阅持续累积 content 并写
  history.jsonl；同 thread 仅一个活跃 run，进行中重复发消息 → 409；
  **断连重连不做实时续推**（二期候选，广播骨架已预留），重连后拉历史；
  stop = AbortController。
- **Rationale**: FR-026 要求客户端断开后回复继续完成并落盘——loop 绑请求
  生命周期则断连即被杀。订阅者模型同时天然实现 FR-025（异步持久化）与
  "重连后从 history 看到完整回复"。续推（补发快照+增量）涉及"不漏不重"的
  并发陷阱，经评审其价值密度低于"跑完落盘"主体，砍为二期，不影响架构。
- **Alternatives considered**: SSE 直接驱动 loop（违背 FR-026）；实时续推
  （保留广播骨架，二期加订阅者即可恢复）；断连=stop（违背 FR-025/026，否）。

## R8. 后台调度

- **Decision**: 进程内 `setInterval` 统一 `Scheduler`（`临时空间/` 清理每小时、实例空闲
  回收每分钟）；摘要重写事件触发 + per-thread Promise 链串行。
- **Rationale**: 单机部署、任务简单（分钟级精度足够），无需 node-cron；
  摘要由"窗口外攒满 20 条"事件驱动最直接，串行链防同 thread 并发重写。
- **Alternatives considered**: node-cron（过度）；摘要走定时扫描（滞后且空转）。

## R9. 日志

- **Decision**: `pino`，进程直写按日切分文件 `.opt-agent/logs/app-YYYY-MM-DD.log`；
  字段 `user_id/thread_id/agent_name/event/duration_ms`；告警 `alert: true`；
  Token 审计独立 child logger。
- **Rationale**: Fastify 内置 pino 零集成成本；单机内网部署无日志收集器，
  自写按日文件最自足；对 PM2/docker/systemd 任何部署形态均成立。
- **Alternatives considered**: winston（生态老、性能弱于 pino）；stdout + 外部
  收集（部署形态未定时不自足）。

## R10. 配置管理

- **Decision**（2026-09-09 修订，方案乙）：双源——`.env`（Node 内置
  `--env-file`，运行参数 + key 兜底）+ `config.yaml`（models 列表，
  `yaml` 包解析）；zod 统一启动校验；冻结 `config.ts` 单一出口；
  密钥不进日志与仓库。
- **Rationale**: 用户已有 config.yaml 存模型清单（多模型预留形态）；
  .env 管运行参数、yaml 管模型清单，职责分明；zod 校验双源合并后的
  最终对象，启动即拒错误配置。
- **Alternatives considered**: .env 唯一来源（方案甲——更简单但与用户既有
  配置习惯冲突，被否）；dotenv（Node 24 已内置等价能力）。

## R11. read_file 二进制格式（需求未写明的坑）

- **Decision**: `.xlsx` 用 SheetJS 转 CSV 文本；`.pdf` 用 pdfjs-dist 提文本层，
  无文本层友好报错（本期不做 OCR）；统一 32KB 截断 + `offset/limit` 分段读。
- **Rationale**: 上传白名单含 xlsx/pdf，直读二进制是乱码；业务文件（生产计划、
  电价）本质是表格，CSV 文本对 LLM 最友好；SheetJS 纯 JS 无原生依赖。
- **Alternatives considered**: 拒绝二进制格式（违背需求初衷）；外部解析服务
  （单机部署过度设计）。

## R12. 测试

- **Decision**: vitest；单测主力（file-access、history 恢复、LRU、摘要、config）+
  `app.inject()` 集成 + 假 `LlmProvider` 端到端（SSE/断连/stop 不烧钱可测）+
  真 key 冒烟脚本（本地手动，不进 CI）；domain 核心 ≥80%。
- **Rationale**: vitest TS 原生、配置少；`LlmProvider` 抽象使端到端测试
  不依赖真 API——这是接口隔离的直接红利。
- **Alternatives considered**: jest（配置重）；全量真 API 测试（慢且烧钱）。

## R13. 工程化与优雅关闭

- **Decision**: ESM + `tsx watch` 开发 + `tsc` 构建；ESLint+Prettier。
  优雅关闭：停止接新请求 → 进行中 run draining（当前消息写完落盘、不开新步骤）
  → 15s 宽限（可配）→ abort 尽力落盘；SQLite close、pino flush；强杀兜底
  依赖 JSONL 追加写（最多损一行）+ FR-029 损坏恢复。
- **Rationale**: pi-agent-core 为 ESM 包，CJS 互操作无谓麻烦；draining 语义
  复用断连收尾逻辑，一套代码两处用。
- **Alternatives considered**: bundler（后端无必要）；关机立即 abort（丢消息）。

## R14. API 表层约定

- **Decision**: `/api/*` 无版本前缀；统一错误 envelope `{error:{code,message}}`，
  SSE 流内 `error` 事件同结构；Fastify 全局 `setErrorHandler` 收敛；路由级
  JSON Schema；手写 `docs/api.md`。
- **Rationale**: 单机内部系统加版本前缀是累赘；envelope 满足章程 VII；
  接口少，Swagger UI 本期投入产出不划算（需要时可后加 `@fastify/swagger`）。
