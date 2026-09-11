---
description: '002-agent-chat-ui 任务拆分'
---

# Tasks: Agent 前端交互页所需的后端能力补全

**Input**: Design documents from `/specs/002-agent-chat-ui/`

**Prerequisites**: plan.md ✅、spec.md ✅、research.md ✅、data-model.md ✅、contracts/ ✅

**Tests**: 章程原则 III 要求测试不可协商（核心覆盖 ≥80%，正常/异常/边界三类场景），故每个故事包含测试任务，**测试先于实现编写并确认失败**。

**Organization**: 按 spec.md 的 7 个用户故事（US1–US7）组织，每个故事可独立实现与验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 对应 spec.md 用户故事（US1–US7）

---

## Phase 1: Setup（共享基础设施）

**Purpose**: 本特性为存量项目增量，无项目初始化；仅做准备性任务

- [ ] T001 通读 contracts/sse-events.md 与 contracts/http-api.md，确认与现有 001 契约（specs/001-digital-human-agent/contracts/）的差异清单，标注废弃/变更条目

---

## Phase 2: Foundational（阻塞性前置）

**Purpose**: 类型与存储格式升级，所有故事的公共基础

**⚠️ CRITICAL**: 本阶段完成前不得开始任何用户故事

- [ ] T002 扩展 src/types.ts：HistoryMessage 增加可选字段 `id/ts/status/usage/durationMs/attachments/error`（不定义 thinking 与工具调用字段）；新增 `FileReference {dir, filename}` 类型；LlmEvent 增加 `{type:'tool_call_start',callId,name}` 与 `{type:'tool_call_end',callId,status:'success'|'error'}`
- [ ] T003 [P] 编写 history 格式升级单元测试（新行写入/读取、旧行兼容合成 id 与 ts、反馈行合并、反馈行不参与 convertToLlm 的消息构造）于 tests/unit/history.test.ts
- [ ] T004 升级 src/domain/history.ts：parseLine 解析新格式并兼容旧行（旧行合成 id=`{threadId}-{行号}`、ts 回填线程创建时间）；新增 appendFeedback(messageId, value) 与反馈合并读取（后者覆盖前者）；保持 per-thread Promise 链串行
- [ ] T005 扩展 src/domain/run-manager.ts 的 SsePayload：新增 `tool_call{call_id,name,status:'running'}`、`tool_call_end{call_id,status}`；done 增加 `duration_seconds、message_id`；error 增加可选 `duration_seconds、usage`；**2026-09-10 修订**：done/error 均增加 `agent_name`（会话可跨数字人），user/assistant 落盘行同样带 `agent_name`

**Checkpoint**: 类型与存储就绪——US1–US7 可开始

---

## Phase 3: User Story 1 - 流式对话事件补全：工具调用与耗时 (Priority: P1) 🎯 MVP

**Goal**: SSE 事件流下发出工具调用开始/结束事件（仅工具名），done/error 事件携带整轮耗时

**Independent Test**: 触发一轮带工具调用的对话，curl -N 观察 SSE：tool_call/tool_call_end 成对出现且无 args/result 字段，done 含 duration_seconds（quickstart.md 场景 1）

### Tests for User Story 1

- [ ] T006 [P] [US1] 编写 agent-loop 工具事件拦截单元测试（tool_execution_start/end → tool_call_start/end，args/result/partialResult 不透出，callId 配对）于 tests/unit/agent-loop.test.ts
- [ ] T007 [P] [US1] 编写 run-manager 耗时与转发单元测试（注入时钟断言 duration_seconds、tool 事件转发顺序、error 事件带 duration）于 tests/unit/run-manager.test.ts
- [ ] T008 [P] [US1] 编写 SSE 集成测试（一轮含工具调用对话的完整事件序列断言）于 tests/integration/chat-sse.test.ts

### Implementation for User Story 1

- [ ] T009 [US1] 修改 src/infra/agent-loop.ts 的 emit：拦截 `tool_execution_start`→push `{type:'tool_call_start',callId,name}`、`tool_execution_end`→push `{type:'tool_call_end',callId,status:isError?'error':'success'}`；严禁复制 args/result/partialResult
- [ ] T010 [US1] 修改 src/domain/run-manager.ts：startRun 记 startedAt（注入 now()）；consume 中转发 tool_call_start/end 为 SsePayload；finalizeDone/finalizeAborted/error 路径计算 durationMs 并填入 done/error 事件的 duration_seconds（1 位小数）

**Checkpoint**: US1 独立可用——前端"思考中 + 工具名闪现 + 耗时展示"数据齐全

---

## Phase 4: User Story 2 - 历史消息元数据补全 (Priority: P1)

**Goal**: 历史消息携带 id/ts/usage/duration/status/feedback 字段，失败轮留痕；历史 0 思考 0 工具信息

**Independent Test**: 完成一轮对话后 GET /api/threads/:id：消息含 id/ts、assistant 含 usage/duration_seconds；全量响应不含思考文本与工具名（quickstart.md 场景 2）

### Tests for User Story 2

- [ ] T011 [P] [US2] 编写历史元数据集成测试（完成后查询历史断言字段齐全；grep 断言无 thinking/工具信息落盘）于 tests/integration/history-metadata.test.ts
- [ ] T012 [P] [US2] 编写失败轮落盘单元测试（error 路径写 status='failed' + error 字段；aborted 不落消息行）于 tests/unit/run-manager.test.ts

### Implementation for User Story 2

- [ ] T013 [US2] 修改 src/domain/run-manager.ts：finalizeDone 生成消息 id（`m_{base36时间戳}_{4位随机}`），user/assistant 行带 id/ts 落盘，assistant 行附 usage/duration_ms/status='completed'；error 路径落 status='failed'+error 行；done 事件回填 message_id（stop 时为 null）
- [ ] T014 [US2] 修改 src/routes/threads.ts：GET /api/threads/:id 消息输出升级为契约格式（id/ts/status/usage/duration_seconds/attachments/feedback/error），duration_ms→duration_seconds 换算，feedback 恒返回（默认 null）

**Checkpoint**: US2 独立可用——刷新后历史消息 token/耗时/错误可完整还原

---

## Phase 5: User Story 3 - 消息反馈（点赞/点踩） (Priority: P1)

**Goal**: PUT 反馈接口 + 历史返回反馈状态，互斥可取消

**Independent Test**: 对 done 的 message_id 依次提交 up→down→down（取消），历史查询依次为 up/down/null；伪造 mid 返回 404（quickstart.md 场景 3）

### Tests for User Story 3

- [ ] T015 [P] [US3] 编写反馈接口集成测试（up→down 互斥切换、同值重复=取消、非法 value 400、伪造 mid 404、历史返回反馈状态）于 tests/integration/feedback.test.ts

### Implementation for User Story 3

- [ ] T016 [US3] 新增 src/routes/feedback.ts：PUT /api/threads/:id/messages/:mid/feedback，校验 value 枚举、校验线程与消息存在（history 读取匹配 id），调用 history.appendFeedback；同值重复提交置 null
- [ ] T017 [US3] 修改 src/server.ts：注册 registerFeedbackRoutes

**Checkpoint**: US3 独立可用——点赞/点踩持久化并随历史返回

---

## Phase 6: User Story 4 - 数字人当前态查询与 MCP 服务状态 (Priority: P2)

**Goal**: GET /api/agents/current 与 GET /api/agents/current/mcp

**Independent Test**: select 后查询返回当前数字人与各 MCP 状态；exit 后 agent_name=null；会话中切换数字人直接成功（覆盖式，无需 exit）（quickstart.md 场景 4）

### Tests for User Story 4

- [ ] T018 [P] [US4] 编写当前数字人/MCP 状态集成测试（选中/未选中/实例未创建时全 failed、实际 connected/failed 映射、会话进行中可直接覆盖式切换且不影响进行中的 run）于 tests/integration/agents-current.test.ts

### Implementation for User Story 4

- [ ] T019 [US4] 修改 src/routes/agents.ts：新增 GET /api/agents/current（currentAgent.current(userId)，未选中返回 `{agent_name:null}`）；新增 GET /api/agents/current/mcp（池内实例存在→取 unavailable 名单映射 connected/failed；实例未创建→配置清单全列且 status='failed'；不外泄 url/command）

**Checkpoint**: US4 独立可用——前端刷新可恢复数字人与 MCP 状态展示

---

## Phase 7: User Story 5 - LLM 模型列表与按会话切换 (Priority: P2)

**Goal**: GET /api/models + 发消息支持 model 字段（请求级注入，不重建实例）

**Independent Test**: GET /api/models 含默认标识且无 api_key；带第二模型发消息正常完成；带非法模型 400 MODEL_NOT_FOUND 且未产生 run（quickstart.md 场景 5）

### Tests for User Story 5

- [ ] T020 [P] [US5] 编写模型列表与切换集成测试（列表无敏感字段、默认标识正确、非法模型 400、指定模型生效）于 tests/integration/models.test.ts
- [ ] T021 [P] [US5] 编写模型解析单元测试（config.models 命中/未命中、apiKey/baseUrl 解析沿用现有规则）于 tests/unit/model-resolve.test.ts

### Implementation for User Story 5

- [ ] T022 [US5] 新增 src/routes/models.ts：GET /api/models 返回 `{models:[{model,is_default}]}`（config.models 只读投影，剥离 apiKey/baseUrl）；注册到 src/server.ts
- [ ] T023 [US5] 修改 src/routes/chat.ts：messageBodySchema 增加可选 `model`；校验命中 config.models（否则 400 MODEL_NOT_FOUND），解析 ModelEntry 传入 startRun
- [ ] T024 [US5] 修改 src/domain/run-manager.ts StartRunOptions 与 src/infra/agent-factory.ts、src/infra/llm/：run 请求级携带 model 覆盖项，按 entry 构造本次 model 与 streamFn（缺省用 defaultModel）

**Checkpoint**: US5 独立可用——前端模型选择器端到端可用

---

## Phase 8: User Story 6 - 文件能力补全：tmp 上传、内联预览与 @ 引用 (Priority: P2)

**Goal**: tmp 可上传；preview 内联返回；发消息支持结构化 attachments 并随历史持久化

**Independent Test**: 上传 tmp 文件→preview 返回 inline→带 attachments 发消息→历史还原引用；引用不存在文件 400 FILE_REF_NOT_FOUND（quickstart.md 场景 6）

### Tests for User Story 6

- [ ] T025 [P] [US6] 编写 tmp 上传与 preview 集成测试（tmp 上传 201、preview Content-Disposition:inline 与各扩展名 Content-Type、xlsx 回退 attachment、不存在文件 404）于 tests/integration/files-preview.test.ts
- [ ] T026 [P] [US6] 编写 attachments 集成测试（合法引用发送成功且历史还原、不存在文件 400、超 10 个 400、非法 dir 403/400）于 tests/integration/attachments.test.ts

### Implementation for User Story 6

- [ ] T027 [US6] 修改 src/routes/files.ts：UPLOAD_DIRS 增加 TMP_DIR（注释更新）；新增 GET /api/files/preview（复用 checkDir 与 file-access，按扩展名映射 Content-Type：.txt/.csv→text/*+utf-8、.json→application/json、.pdf→application/pdf、.xlsx→octet-stream+attachment；inline 头；不存在 404 FILE_NOT_FOUND）
- [ ] T028 [US6] 修改 src/routes/chat.ts：messageBodySchema 增加可选 `attachments`（≤10，FileReference 数组）；checkDir 白名单校验 + 文件存在性校验（不存在 400 FILE_REF_NOT_FOUND）；传入选项
- [ ] T029 [US6] 修改 src/domain/run-manager.ts：提交 LLM 的 user content 追加引用段 `[引用文件] {dir}/{filename}`；user 历史行持久化结构化 attachments

**Checkpoint**: US6 独立可用——上传/预览/@ 引用全链路可用

---

## Phase 9: User Story 7 - 工作空间文件汇总 (Priority: P3)

**Goal**: GET /api/files/workspace 一次返回 9 目录文件清单

**Independent Test**: 2 个目录放文件后查询：9 目录全返回，有文件目录非空、空目录 `[]`（quickstart.md 场景 7）

### Tests for User Story 7

- [ ] T030 [P] [US7] 编写 workspace 集成测试（9 目录齐全、元信息字段、空目录空数组）于 tests/integration/files-workspace.test.ts

### Implementation for User Story 7

- [ ] T031 [US7] 修改 src/routes/files.ts：新增 GET /api/files/workspace，顺序 list 9 个白名单目录，返回 `{dirs:[{dir,files:[{filename,size,updated_at}]}]}`

**Checkpoint**: US7 独立可用

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T032 [P] 同步契约文档：更新 specs/001-digital-human-agent/contracts/sse-events.md 与 http-api.md 标注"已被 002 契约取代/变更"，保持契约单一事实源
- [ ] T033 [P] 验证章程合规：新增/修改文件均 ≤500 行；核心逻辑覆盖率 ≥80%（npm run test:coverage）
- [ ] T034 执行 quickstart.md 全部 7 个场景人工端到端验证 + 旧格式 history.jsonl 回归验证
- [ ] T035 [P] 更新 README 或 docs/ 接口清单，补充新增 5 接口与 SSE 新事件说明
- [ ] T036 [P] 性能验证（FR-032）：对新增 5 个非流式接口（models/current/mcp/feedback/workspace/preview）做简单计时验证，确认 P95 ≤ 200ms

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: T002 → T003/T004（T003 测试先行）→ T005；**阻塞所有用户故事**
- **User Stories (Phase 3–9)**: 均依赖 Phase 2；US1/US2/US3 有内部链：US2 的 T013 依赖 US1 的 T010（同文件 run-manager.ts 顺序改），US3 的 T016 依赖 US2 的 T013（需 message_id）；US4/US5/US7 彼此独立；US6 的 T029 依赖 T013（同文件）
- **Polish (Phase 10)**: 依赖全部目标故事完成

### User Story Dependencies

- **US1 (P1)**: Phase 2 后可开始，无故事间依赖
- **US2 (P1)**: 依赖 US1 的 T010（run-manager.ts 顺序修改）
- **US3 (P1)**: 依赖 US2 的 message_id 落盘（T013）
- **US4 (P2)**: 独立（仅 Phase 2）
- **US5 (P2)**: 独立（仅 Phase 2；T024 与 US1 同文件 run-manager.ts，建议排在 US1 后）
- **US6 (P2)**: T027/T028 独立；T029 依赖 US2 的 T013
- **US7 (P3)**: 独立（仅 Phase 2；与 US6 同文件 files.ts，建议排在 US6 后或合并提交）

### Parallel Opportunities

- Phase 2 内 T003 可与 T002 并行（测试先写）
- 各故事内测试任务（标 [P]）可并行编写
- US4、US5（T020–T022）、US7 三个故事互相独立，可并行
- T006/T007/T008（US1 三个测试文件）可并行

## Parallel Example: User Story 1

```bash
# 并行编写 US1 全部测试：
Task: "agent-loop 工具事件拦截单元测试 tests/unit/agent-loop.test.ts"
Task: "run-manager 耗时与转发单元测试 tests/unit/run-manager.test.ts"
Task: "SSE 集成测试 tests/integration/chat-sse.test.ts"
# 然后顺序实现 T009 → T010（不同文件，但 T010 依赖 T009 的事件定义，逻辑上顺序）
```

---

## Implementation Strategy

### MVP First（US1 + US2 + US3，均为 P1）

1. 完成 Phase 1 + Phase 2
2. US1（工具事件 + 耗时）→ 独立验证
3. US2（历史元数据）→ 独立验证
4. US3（反馈）→ 独立验证
5. **STOP**：P1 三故事构成前端 MVP 所需的全部后端能力

### Incremental Delivery

P1（US1–US3）→ P2（US4 数字人/MCP → US6 文件能力 → US5 模型）→ P3（US7）→ Polish。每个故事独立可验证、可交付，不破坏既有契约（SSE 为向后兼容扩展）。

---

## Notes

- [P] 任务 = 不同文件、无未完成依赖
- run-manager.ts 被 US1/US2/US5/US6 多故事修改：同文件任务必须顺序执行（T010 → T013 → T024 → T029）
- files.ts 被 US6/US7 修改：T027 → T031 顺序
- 所有新接口错误体遵循 `{error:{code,message}}` 统一格式（server.ts 全局封装）
- 每任务或逻辑组完成后提交；测试必须先失败再通过
