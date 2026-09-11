# Implementation Plan: 数字人Agent对话后端

**Branch**: `001-digital-human-agent` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-digital-human-agent/spec.md`
**技术选型依据**: [sel_tech.md](../../../docs/decisions/sel_tech.md)（2026-09-09 评审确认的 16 项技术决策）

## Summary

构建多用户数字人 Agent 对话后端：基于 **Node.js + TypeScript + Fastify 5**，
Agent 核心采用 **`@earendil-works/pi-agent-core@0.85.1`（架构方案 A：实例池缓存配置包，
推理走低层 `runAgentLoop`）**；LLM 经 pi-ai 内置 deepseek provider 接入
`deepseek-v4-flash-vision-exp`（thinking 流式原生支持，config.yaml models 第一项指定），
外隔薄 `LlmProvider` 防腐接口；
对话执行采用 **Run Manager 模式**（loop 与 HTTP 解耦，SSE 为订阅者，断连≠停止）；
文件权限经显式代理层强制管控；Token 用量存全局单库 SQLite；历史 JSONL + 滚动摘要。

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+（开发机 Node 24），ESM、strict 全套

**Primary Dependencies**:

- `@earendil-works/pi-agent-core@0.85.1`（精确锁定）、`@earendil-works/pi-ai@0.85.1`
- `fastify@^5`、`@fastify/multipart`、`@fastify/cors`
- `@modelcontextprotocol/sdk`（MCP 客户端，stdio + Streamable HTTP）
- `better-sqlite3`（锁版本）、`pino`、`zod`、`xlsx`（SheetJS）、`pdfjs-dist`

**Storage**: 文件系统（`.opt-agent/`：用户数据、history.jsonl、summary.json、日志）

- SQLite 全局单库（`.opt-agent/usage.db`，Token 用量）

**Testing**: vitest（单测为主）+ Fastify `app.inject()` 集成 + 假 LlmProvider 端到端

- 真 key 冒烟脚本

**Target Platform**: 单机部署（Windows/Linux 服务器），内网服务

**Project Type**: web-service（纯后端 HTTP/SSE API）

**Performance Goals**: 非 LLM 接口 P95 ≤ 200ms；对话接口首字延迟 < 5s（收到请求 →
首个 SSE 事件）

**Constraints**: 单机最多 5 个 Agent 实例；1 用户 : 1 数字人 : 3 并发 thread；
MCP 超时 30s 重试 1 次；写操作仅限 tmp/ 且强制 thread_id 前缀；不引入 Redis；
文件 ≤500 行（章程要求）

**Scale/Scope**: 本期默认 admin 单用户（多用户隔离模型已就位）；6 个内置工具；
7 业务目录 + tmp + shared；5 组 API（对话/对话管理/文件/数字人查询/监控与用量）

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| 章程条款        | 评估                                                                                                                                       | 结论 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| I. 中文文档优先 | 本 plan、research、data-model、contracts、quickstart 全部中文；标识符英文                                                                  | ✅   |
| II. 分层架构    | `routes（接口层）→ domain（业务层）→ infra（数据访问/外部适配）`，禁止跨层；domain 不 import Fastify/pi；文件 ≤500 行                      | ✅   |
| III. 测试覆盖   | vitest 单测 + inject 集成 + 假 LlmProvider 端到端；domain 核心 ≥80%；覆盖正常/异常/边界三类场景                                            | ✅   |
| IV. 性能标准    | 非 LLM 接口 P95 ≤200ms；usage.db 高频查询字段（thread_id、agent_name、timestamp）建索引；thread 列表读目录元数据，无 N+1                   | ✅   |
| V. 数据一致性   | SQLite 写操作单语句事务（better-sqlite3 同步事务）；history.jsonl 追加写原子性按行保证；删除 thread 连带清理按"先文件后索引"顺序并记录失败 | ✅   |
| VI. 依赖治理    | 全部依赖的选型理由、候选对比记录于 [sel_tech.md](../../../docs/decisions/sel_tech.md)（评审产物）                                          | ✅   |
| VII. 接口设计   | RESTful 资源命名；统一错误 envelope `{error:{code,message}}`；接口文档 docs/api.md 随代码同步                                              | ✅   |

**Gate 结果：通过，无违规项，无需 Complexity Tracking。**

## Project Structure

### Documentation (this feature)

```text
specs/001-digital-human-agent/
├── plan.md              # 本文件
├── research.md          # Phase 0 输出：选型研究与决策依据
├── data-model.md        # Phase 1 输出：实体与存储模型
├── quickstart.md        # Phase 1 输出：端到端验证指南
├── contracts/           # Phase 1 输出：接口契约
│   ├── http-api.md      # REST 接口契约
│   ├── sse-events.md    # SSE 事件流契约
│   └── internal-interfaces.md  # 内部接口（LlmProvider/PoolStore 等）
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks 输出（本命令不生成）
```

### Source Code (repository root)

```text
src/
├── config.ts                 # zod 校验后的冻结配置（唯一读取 process.env 处）
├── server.ts                 # Fastify 装配、路由注册、全局错误处理、优雅关闭
├── logging.ts                # pino（按日文件 + 审计 child logger）
├── routes/                   # 接口层（薄）：参数校验 + 调 domain
│   ├── chat.ts               # POST /api/threads/:id/messages (SSE)、POST .../stop
│   ├── threads.ts            # thread CRUD
│   ├── files.ts              # 上传/列表/下载
│   ├── agents.ts             # 数字人列表/详情（只读）+ select/exit 选中状态
│   ├── monitor.ts            # /api/monitor/agents、/api/monitor/health
│   └── usage.ts              # Token 用量汇总查询
├── domain/                   # 业务层（不 import Fastify/pi）
│   ├── agent-pool.ts         # LRU 实例池（PoolStore 接口，本期内存实现）
│   ├── agent-instance.ts     # 配置包：SystemPrompt/工具/MCP 连接/LLM 客户端
│   ├── run-manager.ts        # 对话运行管理（事件总线、AbortController、落盘器）
│   ├── history.ts            # history.jsonl 读写、损坏恢复
│   ├── summary.ts            # 滚动摘要（窗口 20 条、增量重写、失败降级）
│   ├── file-access.ts        # 文件访问代理层（路径规范化 + 白名单 + thread_id 前缀）
│   ├── thread-store.ts       # thread 元数据（meta.json）与生命周期（连带清理）
│   ├── current-user.ts       # "当前用户"抽象（本期固定 admin）
│   ├── current-agent.ts      # "用户当前选中数字人"状态（select/exit，内存 Map）
│   └── tools/                # 内置工具（全部经 file-access 代理）
│       ├── read-file.ts      # 含 xlsx/pdf 解析分派、32KB 截断、offset/limit
│       ├── write-file.ts
│       ├── list-dir.ts
│       ├── grep-files.ts
│       └── calculator.ts
├── infra/                    # 数据访问/外部适配层（实现 domain 定义的接口）
│   ├── llm/
│   │   ├── llm-provider.ts   # LlmProvider 接口（domain 语义）
│   │   └── pi-ai-provider.ts # pi-ai deepseek 实现（thinking 开关映射）
│   ├── agent-loop.ts         # pi-agent-core 低层 runAgentLoop 调用封装
│   ├── mcp/
│   │   ├── mcp-manager.ts    # 异步并发建连（不阻断实例就绪）、降级标记、调用转发
│   │   └── mcp-tool-adapter.ts # MCP tool → pi loop 工具包装（30s 超时 + 重试 1 次）
│   ├── usage-db.ts           # better-sqlite3：建表、索引、写入、汇总查询
│   └── scheduler.ts          # tmp 清理（每小时）、实例空闲回收（每分钟）
└── types.ts                  # 共享类型（Message、AgentConfig、UsageRecord 等）

tests/
├── unit/                     # file-access、history、summary、agent-pool、config 等
├── integration/              # app.inject() 打 HTTP 层 + 假 LlmProvider 端到端
└── helpers/                  # fake-llm-provider、临时目录/临时 SQLite 工具

scripts/
└── smoke.ts                  # 真 DeepSeek key 冒烟（手动，不进 CI）

docs/
└── api.md                    # 手写接口文档（与 contracts/ 同步）

.opt-agent/                   # 运行期数据根（gitignore）
├── users/{user_id}/user-data/{7业务目录, tmp/, shared/, threads/{thread_id}/}
├── users/{user_id}/agents/{agent_name}/{SOUL.md, MCP.json, TOOL.json, skills/}
├── usage.db
└── logs/
```

**Structure Decision**: 单一 web-service 项目，三层架构（routes → domain → infra），
domain 定义接口、infra 实现，依赖方向向内。该结构是章程 II（分层）与需求
"实例池/会话状态/模型提供方抽象为可替换接口"的直接落点。

## 实施阶段划分（供 /speckit-tasks 参考）

1. **地基**：项目骨架（package.json/tsconfig/ESLint）、config、logging、
   错误 envelope、current-user 抽象。
2. **数据与文件层**：目录初始化、file-access 代理层、thread-store、history、
   usage-db。
3. **Agent 核心**：agent-instance 配置加载（SOUL/TOOL/MCP/skills，MCP 异步
   并发建连不阻塞就绪）、LlmProvider + pi-ai 实现、agent-loop 封装、
   agent-pool（LRU + 空闲回收）、current-agent 选中状态。
4. **对话链路**：run-manager（SSE 订阅、断连续跑、stop）、summary、
   chat 路由 + stop 路由。
5. **工具与 MCP**：6 个内置工具、MCP 管理器与降级。
6. **外围接口**：threads/files/agents/monitor/usage 路由、scheduler。
7. **加固**：优雅关闭、异常容灾（FR-029/030）、性能与容量校验、冒烟。
