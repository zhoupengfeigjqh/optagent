# Implementation Plan: Agent 前端交互页所需的后端能力补全

**Branch**: `002-agent-chat-ui` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-agent-chat-ui/spec.md`

## Summary

为支撑前端三栏 Agent 聊天页，对现有 Fastify 后端做 7 组能力增量：①SSE 事件流增加工具调用开始/结束事件（仅工具名 + 调用标识，剥离入参与结果）与整轮耗时；②会话历史 JSONL 升级为带元数据的消息行（消息 ID、时间戳、token、耗时、状态、文件引用、反馈），**明确不落思考内容与工具调用信息**；③新增消息反馈接口；④新增当前数字人查询与 MCP 服务状态接口；⑤新增模型列表接口与按消息指定模型；⑥放开空间上传（**2026-09-13 修订**：由"放开 tmp"扩展为三空间按各自扩展名策略上传）、新增内联预览接口、发消息支持结构化文件引用；⑦新增工作空间文件汇总接口（**2026-09-13 重构**为按空间下发目录树 + 权限/扩展名策略）。技术栈全部沿用现有：TypeScript ESM + Fastify 5 + zod/JSON Schema 校验 + better-sqlite3（不新增依赖）、JSONL 文件存储。

## Technical Context

**Language/Version**: TypeScript (ESM) / Node.js ≥ 20（沿用）

**Primary Dependencies**: Fastify 5、@fastify/cors、@fastify/multipart、zod、pino、better-sqlite3、@earendil-works/pi-agent-core、@modelcontextprotocol/sdk（全部沿用，**不新增第三方依赖**）

**Storage**: 会话历史 history.jsonl（行格式升级，向后兼容）；反馈随历史行/反馈行落盘；usage.db（better-sqlite3，沿用）

**Testing**: vitest（tests/unit + tests/integration，沿用）

**Target Platform**: Windows/Linux 服务器（本地工作台部署）

**Project Type**: web-service（REST + SSE）

**Performance Goals**: 非流式接口 P95 ≤ 200ms；SSE 事件产生到下发 < 100ms；MCP 状态滞后 ≤ 5s

**Constraints**: 工具入参/结果 0 透出；历史 0 思考内容、0 工具调用信息；history.jsonl 旧格式可读（向后兼容）；单文件 ≤ 500 行；核心逻辑测试覆盖 ≥ 80%

**Scale/Scope**: 单用户（admin，多用户预留）；单用户 ≤ 3 并发 thread（跨数字人累计，现有）

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| 原则 | 判定 | 说明 |
|---|---|---|
| I. 中文文档优先 | ✅ | 全部文档中文 |
| II. 分层架构（接口→业务→数据访问） | ✅ | 新路由仅做参数校验/映射，逻辑落 domain（run-manager、history、feedback、agent-catalog），文件/DB 访问走数据访问层 |
| 单文件 ≤ 500 行 | ✅ | history.ts 升级后预计 <200 行；chat.ts 变更后 <150 行；新增 feedback.ts / workspace 等均为小文件 |
| III. 测试覆盖 ≥80%，正常/异常/边界 | ✅ | 每模块配单元测试；SSE 事件与历史兼容配集成测试（见 quickstart.md） |
| IV. P95 ≤ 200ms；禁 N+1 | ✅ | 历史读取为单文件顺序读；工作空间汇总为按空间的有界常数次目录 list（**2026-09-13 修订**：数据准备按其 scenario 子目录数，非 N+1）；反馈/历史查询无跨记录循环查 |
| V. 状态变更原子性 | ✅ | 消息+元数据同一 JSONL 行一次追加；反馈为单行追加合并；沿用 per-thread Promise 链串行化 |
| VI. 依赖治理 | ✅ | 不新增依赖 |
| VII. RESTful + 统一错误格式 + 文档同步 | ✅ | 全部新接口走 ApiError(code/message) 统一封装；contracts/ 随代码同步更新 |

初始判定：**全部通过，无违规需豁免**。

## Project Structure

### Documentation (this feature)

```text
specs/002-agent-chat-ui/
├── plan.md              # 本文件
├── research.md          # Phase 0：技术决策
├── data-model.md        # Phase 1：数据模型
├── quickstart.md        # Phase 1：端到端验证指南
├── contracts/
│   ├── sse-events.md    # SSE 事件契约（新增/变更）
│   └── http-api.md      # REST 接口契约（新增/变更）
└── tasks.md             # /speckit-tasks 生成（本命令不产出）
```

### Source Code (repository root)

沿用现有单体结构，变更/新增如下（其余不动）：

```text
src/
├── types.ts                     # 改：HistoryMessage 扩展元数据；LlmEvent 增加 tool_call_*；FileReference 类型
├── domain/
│   ├── history.ts               # 改：行格式升级（元数据/反馈合并）、parseLine 兼容旧行
│   ├── run-manager.ts           # 改：tool 事件转发、耗时统计、消息 ID 生成、落盘带元数据
│   ├── feedback.ts              # 新：反馈记录与合并（JSONL 反馈行）
│   ├── current-agent.ts         # 不变（复用 current()）
│   └── dirs.ts                  # 不变
├── infra/
│   ├── agent-loop.ts            # 改：拦截 pi tool_execution_* → LlmEvent tool_call_*；模型按请求注入
│   ├── agent-factory.ts         # 改：run 请求携带 model 覆盖项
│   └── llm/                     # 改：按模型条目构造 provider/streamFn
├── routes/
│   ├── chat.ts                  # 改：body 增加 model/attachments；校验附件存在
│   ├── threads.ts               # 改：历史返回带元数据/反馈/文件引用
│   ├── agents.ts                # 改：新增 GET /api/agents/current、GET /api/agents/current/mcp
│   ├── files.ts                 # 改：三空间上传（按空间扩展名策略）；新增 GET /api/files/preview、GET /api/files/workspace
│   ├── models.ts                # 新：GET /api/models
│   └── feedback.ts              # 新：PUT /api/threads/:id/messages/:mid/feedback
└── server.ts                    # 改：注册新路由

tests/
├── unit/                        # 改/新：history 兼容、feedback 合并、run-manager 耗时与 tool 事件、模型解析、preview 白名单
└── integration/                 # 新：SSE 全事件流、历史元数据回归、反馈互斥、空间上传、preview、workspace
```

**Structure Decision**: 单体 web-service，分层沿用 `routes（接口层）→ domain（业务层）→ domain/infra 数据访问（history/file-access/usage-db）`。不新建顶层目录。

## Complexity Tracking

无（Constitution Check 全部通过，无需豁免）。
