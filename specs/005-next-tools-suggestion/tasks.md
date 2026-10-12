---
description: "任务清单：对话运行时 · 下一步动作建议（005，2026-10-12；模型单段直接产出 Top3）"
---

# Tasks: 对话运行时 · 下一步动作建议（005）

**Input**: [spec.md](./spec.md) §4（`NT-01`~`NT-30`）、§5、§6、§8、§9、§10；[plan.md](./plan.md)

**状态**：**全部实现任务未开工**（用户要求"先不改代码"；规格与计划已收敛，无待确认项——触发范围 = 每轮都试，渲染范围 = 只渲染最新一条）

**Prerequisites**: [spec.md](./spec.md) 与 [plan.md](./plan.md)。

**Tests**: **本增量必须包含测试任务**。宪章原则三（NON-NEGOTIABLE）要求：前端每个组件 / composable /
纯函数模块 MUST 同名同目录测试（覆盖 props / emit / 边界）；后端 `domain/` 核心逻辑 MUST 有单测
（正常 / 异常 / 边界）。**测试执行环境＝宿主机本地**，容器不参与。

## Format: `[ID] [P?] Description`

- **[P]**：可并行（不同文件，且不依赖未完成的任务）
- 每条任务 MUST 含**确切文件路径**

## 设计取舍（对应宪章「治理 § 例外」的登记口径；**均非原则违反**）

| 取舍 | 必要性 | 被否决的更简方案 |
|---|---|---|
| 单段：模型一次输出有序 1–3 条 | jev 三个 primitive 均无数值以外出口，无法产文案；而"模型写候选 → jev 排序"的净收益不足（概率只用于排一次序、`choice` 的互斥语义不符） | 两段（预算被瓜分、两处失败面）；主回答里顺带输出（结构化块会在流式里闪现） |
| 建议在 `history.append` **之前**产出 | `history.jsonl` 是 append-only；事后改写等于允许"部分提交"（原则五） | 先落盘再改写该行；落独立 sidecar（多一套 store 与清理） |
| 顺序由模型给出、后端不重排 | 单段下没有独立排序依据；三张卡都可点，顺序只表优先级 | 后端按某种规则重排（凭空造依据 = 假装有排序，原则九②） |
| `guidance` 由**后端**产出并随建议下发 | 工具名与文案都在后端（唯一来源、可测）；前端零拼装 | 前端拼模板（第二处规则，会与后端漂移） |
| 候选工具清单复用装配 LLM 工具表的**同一三段式** | 否则会建议出"模型根本调不到的工具"（点了没用） | 各写一套收集逻辑（两处漂移） |
| 排除服务走配置项（默认 `jev`） | 平台内部能力不应长成用户卡片；写死服务名会渗进业务逻辑 | 硬编码 `jev`（将来加内部服务要改代码） |
| 与 `summary.ts` 同构的后台调用写法 | 后台 LLM 调用在本仓库保持"一种写法"；`domain/` 只依赖最小结构接口 | 自创一套调用/超时/降级写法 |
| 触发范围 = **每个成功回合都试**（含纯问答轮） | 保留最全覆盖（纯问答轮恰恰最需要引导）；成本侧用开关与日志观测，必要时再立项 | 仅工具轮生成（砍掉覆盖，省的是最需要的那部分）／会话级节流（要新增节流状态） |
| 卡片**只渲染在最新一条** assistant 消息下方 | 从根上消掉连续追问刷屏；落盘与接口下发不变，只收窄渲染规则 | 每条消息都渲染（长对话累积卡片） |

## Phase 1: 规格（宪章原则一：先规格后代码）

- [x] T001 新增 `specs/005-next-tools-suggestion/spec.md`（第三版定稿：单段方案 / `NT-01`~`NT-30` / 降级矩阵 / 数据模型 / 契约增量 / 宪章符合性与原则九判定 / 已知风险 / 验收 / 决策记录与演进）
- [x] T002 新增 `specs/005-next-tools-suggestion/plan.md`（技术方案 / 关键判据 / 文件清单 / Complexity Tracking 含两处触限拆分与替代方案 / 平台差异 / 覆盖率缺口结论 / 门禁）
- [x] T003 新增本文件 `specs/005-next-tools-suggestion/tasks.md`
- [x] T003a 新增 `specs/005-next-tools-suggestion/prompts.md`（**提示词唯一权威文本**：调用形状 / systemPrompt 逐字稿 / user 模板逐字稿 / 五段来源与截断规则 / 长度预算 / 解析容错表 / 刻意不加的项 / 测试断言清单）——被 `NT-06`、T004、T019 引用

## Phase 2: 后端实现（`agent-backend`）

- [ ] T004 新增 `agent-backend/src/domain/next-actions.ts`（唯一新模块）：常量与文案（**systemPrompt / user 模板逐字照抄 [prompts.md](./prompts.md) §2、§3**；`NEXT_ACTIONS_MAX=3` / `NEXT_TOOLS_TOOLS_MAX=40` / `NEXT_ACTIONS_ACTION_MAX_CHARS=120` / `NEXT_TOOLS_ROLE_MAX_CHARS=500` / `NEXT_TOOLS_STATE_MAX_CHARS=2000` / `NEXT_TOOLS_TOOL_DESC_MAX_CHARS=80` / guidance 模板与 500 上限）、`NextToolSuggestion` 类型、最小 LLM 接口（对齐 `summary.ts` 的 `SummaryLlm` 写法）、`buildNextActionsPrompt()`（**五段**：数字人角色摘要 + 用户消息 + 本轮回答 + 已用工具 + 候选工具清单；含截断标记、「允许返回 `[]`」与「不重复建议已执行过的动作」）、`parseNextActions()`（容忍代码围栏与噪声 → tool 白名单 → action 非空与截断 → 按 tool 去重（首次胜）→ **保持顺序** → >3 截断；**区分 `[]`（正常空结果）与"非 JSON / 全被丢弃"（降级）**）、`buildGuidance()`、`generateNextActions()`（`streamChat({tools: [], thinking: false, signal})` + 独立 `AbortController` + **日志分级唯一出口**：`next_tools.skip`(info) / `next_tools.degraded`(warn) 各恰好一条）
- [ ] T005 `agent-backend/src/infra/agent-factory.ts`：抽出"可见工具收集"共享函数（`isAvailable` + `listTools` + `scopeToolsByAllowlist`，供装配与候选**同一处**）；`ChatAgent.suggestNextTools?` = 收集候选描述符（含显示名/简介，排除 `excludeServers`、`>40` 取前 40）→ 调 T004 的 `generateNextActions()`；`AgentFactoryDeps.nextTools` 新增 `{ enabled, timeoutMs, excludeServers }`
- [ ] T006 `agent-backend/src/config.ts`：`envSchema` 新增 `NEXT_TOOLS_ENABLED`（默认 true）/ `NEXT_TOOLS_TIMEOUT_MS`（默认 4000，下界 > 0）/ `NEXT_TOOLS_EXCLUDE_SERVERS`（默认 `jev`，逗号分隔 + 去空项）+ `AppConfig` 字段
- [ ] T007 `agent-backend/src/server.ts`：把 T006 三项透传进 `AgentInstanceFactory`；`context.ts` **不改**
- [ ] T008 `agent-backend/src/domain/run-impl.ts` + `src/domain/run-manager.ts`：`RunImpl` 加 `calledTools: Set<string>`（`tool_call_start` 加入、**结束时不移除**）；`RunAgentLike` 加可选 `suggestNextTools`；`finalizeDone` 在 `history.append` **之前**并行发起生成、把 `next_tools` 写进 assistant 行，随后 `emit('next_tools')` → `emit('done')`；`run.end` 日志补 `next_tools_ms`
- [ ] T009 [P] `agent-backend/src/domain/run-finalize.ts`（**硬门禁拆分**）：从 `run-manager.ts` 抽出 `finalizeError` / `finalizeAborted`，行为逐字保持；`run-manager.ts` 拆分后（含本次增量）≤500 行
- [ ] T010 [P] `agent-backend/src/types.ts`：`HistoryMessage.next_tools?: NextToolSuggestion[]`
- [ ] T011 [P] `agent-backend/src/domain/run-events.ts`：`SsePayload` 新增 `next_tools` 分支 + 载荷类型 `{ message_id, tools }`
- [ ] T012 `agent-backend/src/routes/threads.ts`：`GET /api/threads/:id` 的 assistant 消息透出 `next_tools`（**仅非空**下发）

## Phase 3: 前端实现（`frontend`）

- [ ] T013 [P] 新增 `frontend/src/components/chat/MessageNextActions.vue`：固定标题（唯一来源常量）+ 1–3 张卡片（**主文案 = `text`**、次行 = `toolLabel`（空串不渲染）、原生 `<button>`、`:disabled`、`title`、`aria-label` 含动作文案与工具显示名）；**无建议整段不渲染**；不显示暴露名与任何数值指标
- [ ] T014 [P] 新增 `frontend/src/utils/chat-stream-state.ts`（拆分 + 纯函数）：`appendToolCall()` / `settleToolCall()` / `setNextTools()`
- [ ] T015 `frontend/src/composables/useChatStream.ts`：新增 `nextTools` ref；事件分支接 `next_tools`（走 T014）；`send()` / `reset()` 清空，**`finally` 不清空**；拆分后 ≤500 行
- [ ] T016 `frontend/src/api/types.ts`：`NextToolSuggestion`（`name / text / toolLabel / guidance`）、`Message.next_tools?`、`StreamEvent` 加 `next_tools`（与后端**同批**）
- [ ] T017 `frontend/src/components/chat/MessageBubble.vue` + `MessageList.vue`：卡片挂于 `MessageViewLinks` 之后、`TypingIndicator` 之前；流式态 `nextTools` 经既有 `streaming` 通道下传（与 `toolCalls` 同路）；**渲染范围收窄（`NT-25`）**：`MessageList` 判定并下传"是否最新一条 assistant 消息"，`MessageBubble` 仅在该条件为真时挂载卡片（历史消息即使带 `next_tools` 也不渲染；**不改后端**）
- [ ] T018 `frontend/src/components/chat/ChatPanel.vue`（如需则含 `src/composables/useChatPanel.ts`）：点击 → `onSend({ content: s.text, attachments: [], guidance: s.guidance })`；未选数字人 / 本轮进行中 → 不响应

## Phase 4: 测试（宪章原则三）

- [ ] T019 [P] 新增 `agent-backend/tests/unit/next-actions.spec.ts`：`buildNextActionsPrompt`（按 [prompts.md](./prompts.md) §8 的全量断言清单：五段标题字面量与固定顺序 / 角色摘要与回答的截断（未超限·恰好等于上限·超限）/ 空值占位四种 / 清单行格式与简介截 80 字、简介缺失省略该行 / 清单无排除服务工具、超 40 条只渲染前 40 / 末尾输出要求那一行存在 / systemPrompt 含白名单·用户口吻·不重复建议·允许 `[]`）、`parseNextActions` **10 例**（正常 / 围栏 / 噪声 / 非法 JSON（降级）/ 越界 tool 丢弃 / 空 action 丢弃 / 重复 tool 去重 / 全被丢弃（降级）/ **`[]` 正常空结果（`skip` 且无 warn）** / >3 截断且顺序不变）、`buildGuidance`（≤500 守卫、含工具名与文案）、`generateNextActions` 跳过与降级逐场景（开关关 / 清单为空 / 超时（恒挂起 fake provider）/ 抛错 / 非 JSON / 全被丢弃）→ 均 `undefined` 且**日志级别正确**（`skip` info vs `degraded` warn，各恰好一条）、`usage` 未被写入
- [ ] T020 `agent-backend/tests/unit/run-manager-*.spec.ts`（扩展）：`suggestNextTools` 缺省（fake agent 无该方法）→ 行为与改动前一致；返回 `undefined` / 抛错 → `done` 正常且无事件；返回建议 → **事件先于 `done`**、assistant 落盘含 `next_tools`（含 `guidance`）、空建议不写键；失败轮 / 中断轮不调用；下一轮 `messages` 不含 `next_tools`；`run.end` 含 `next_tools_ms`
- [ ] T021 [P] `agent-backend/tests/unit/`（新增断言，可并入 T019 同目录新文件或既有 `mcp-tool-scope` 相关用例）：候选清单与装配工具表**集合一致**（排除服务后）、单 server `listTools` 失败不阻断、清单 0 / 1 / 40 / 41 边界
- [ ] T022 [P] 新增 `frontend/src/utils/chat-stream-state.spec.ts`：三函数空 / 未命中 / 覆盖边界
- [ ] T023 [P] 新增 `frontend/src/components/chat/MessageNextActions.spec.ts`：空态 0 DOM、3 行、1 张、主次文案、`toolLabel` 空串不渲染、点击 emit 载荷（`text` + `guidance`）、`disabled` 不 emit、可见文本里无暴露名与数值指标
- [ ] T024 `frontend/src/composables/useChatStream.spec.ts`（扩展）：`next_tools` 事件进 ref、`send()` / `reset()` 清空、`finally` 保留
- [ ] T025 新增 `frontend/src/components/chat/MessageBubble.nextTools.spec.ts`：落点 DOM 顺序（视图入口行 < 卡片 < 操作区）、两数据源渲染一致、用户消息无卡片、**非最新一条 assistant 消息不渲染卡片（`NT-25`：3 条历史消息中只有最后一条有卡）**
- [ ] T026 [P] `agent-backend/vitest.config.ts` + `frontend/vite.config.ts`：`src/domain/next-actions.ts`、`src/utils/chat-stream-state.ts` 登记进模块阈值清单（80%）

## Phase 5: 文档与门禁

- [ ] T027 [P] `agent-backend/.env.example` 补 3 项（默认值 + 一句话说明）；`README.md`「运行端行为与默认参数」表补本功能三项（开关 / 生成超时 / 排除的服务）
- [ ] T028 [P] 测试与覆盖率：两侧 `test:coverage` 全绿，新模块 ≥80%，全局地板**未下调**
- [ ] T029 硬门禁：改动 / 新增文件最大 ≤500 行（`run-manager.ts`、`useChatStream.ts` 必须拆到线下）；**零新增依赖**（两侧 `package.json` 未变）
- [ ] T030 静态检查与构建：改动文件 `eslint` 0 问题；`tsc --noEmit` / `vue-tsc` 无**本次引入**的报错；两侧 `build` 通过
- [ ] T031 部署冒烟（原则八）：`docker compose up -d --build` 后按 `quickstart.md` 执行非交互确认——`POST /api/threads/{id}/messages` 读到 `event:` 流；**不作为测试结论**
- [ ] T032 端到端走查（[spec.md](./spec.md) §9 逐项）：正常出卡片（主文案是自然语言动作）/ 顺序与下发一致 / **只渲染最新一条**（追问两轮后往上滚，更早的消息下方无卡片）/ 点击发送文案 + guidance 生效 / 刷新仍在（在最新一条上）/ 未挂 MCP 的数字人也能出卡片 / 挂 jev 的数字人不出现 `jev__*` 卡片 / 非法 JSON 降级（warn）/ 模型返回 `[]` 不出卡片（无 warn）/ 超时降级 / 关开关零调用 / prompt 含数字人角色摘要且建议贴合其领域；并登记**存量缺口**（`POST /messages` 无端点级集成测试、全仓 lint/typecheck 存量报错，均不追溯）
