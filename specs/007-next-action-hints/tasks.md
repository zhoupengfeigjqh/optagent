---

description: "「下一步动作提示卡片」实施任务清单"
---

# 任务清单：下一步动作提示卡片

**特性标识**：`007-next-action-hints`
**输入**：`specs/007-next-action-hints/` 下的设计文档
**前置**：[plan.md](./plan.md)（必需）、[spec.md](./spec.md)（必需，含 P1~P3 用户故事）、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/next-actions-api.md](./contracts/next-actions-api.md)、[quickstart.md](./quickstart.md)

**测试**：本仓库宪章原则三为 **NON-NEGOTIABLE** —— 每个组件 / composable / 纯函数模块 / 接口端点 MUST 有测试，故本清单**包含测试任务**（非可选）。

**组织方式**：任务按**用户故事**分组，每个故事可独立实现、独立测试、独立交付。

---

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（不同文件、且不依赖未完成任务）
- **[Story]**：所属用户故事（`US1` / `US2` / `US3` / `US4`）；Setup / Foundational / Polish 阶段**不带**故事标签
- 每条任务 MUST 含**精确文件路径**

## 路径约定（本仓库四侧布局，非单项目）

- 运行侧后端：`agent-backend/src/**`，测试 `agent-backend/tests/{unit,integration}/**`
- 聊天前台：`frontend/src/**`（测试与源码同目录 `*.spec.ts`）
- 管理平台服务：`admin-backend/src/**`，测试 `admin-backend/tests/{unit,integration}/**`
- 管理界面：`admin-frontend/src/**`（测试与源码同目录 `*.spec.ts`）
- 契约文档：`specs/001-digital-human-platform/contracts/**`

## 用户故事索引（来自 spec.md）

| 标签 | 优先级 | 故事 | 独立验收判据 |
|---|---|---|---|
| **US1** | P1 | 每轮回答结束后出现下一步动作卡片 | 桩模型固定返回 2 条 → 回答正文下方出现 2 张卡片 + 引导句；正文/工具记录/视图入口逐字不变；切换当前数字人后原数字人卡片不再下发（FR-019） |
| **US2** | P2 | 点击卡片经确认后发起下一轮 | 渲染 1 张卡片 → 点击弹窗且**未**发送 → 确认后聊天区新增内容等于该提示词的用户消息，且无工具名 |
| **US3** | P2 | 管理台开关与部署生效 | 管理台开关保存 → 部署产物带/不带 `next_action_hints` 键；运行环境两态行为分别出现/不出现卡片 |
| **US4** | P3 | 附加能力失败不打扰用户 | 注入四类失败 → 用户端无卡片、无引导句、无错误 UI；日志各有对应记录 |

---

## Phase 1: Setup（共享准备）

**目的**：建立门禁基线与模块骨架，避免"改完才发现基线已红"。

- [ ] T001 [P] 记录四侧门禁基线与关键文件行数（`lint` / `typecheck` / `test` / `coverage` / `build` 现状；`agent-backend/src/domain/run-manager.ts`、`frontend/src/composables/useChatStream.ts`、`frontend/src/api/types.ts`、`frontend/src/components/chat/ChatPanel.vue`、`admin-backend/src/domain/config-center/soul-design.ts` 实测行数），写入 `specs/007-next-action-hints/tasks.md` 末尾「同步记录」表
- [ ] T002 [P] 新建 `agent-backend/src/domain/next-actions.ts` 骨架（导出 `NextAction` / `NextActionsSnapshot` / `RuntimeToolBrief` / `NextActionsDeps` / `NextActionsStore` 类型与空方法），并建 `agent-backend/tests/unit/next-actions.spec.ts` 骨架
- [ ] T003 [P] 新建前端骨架：`frontend/src/utils/next-steps.ts` + `frontend/src/utils/next-steps.spec.ts`、`frontend/src/api/next-steps.ts`、`frontend/src/composables/useNextSteps.ts` + `frontend/src/composables/useNextSteps.spec.ts`、`frontend/src/components/chat/MessageNextSteps.vue` + `.spec.ts`、`frontend/src/components/chat/SuggestionCard.vue` + `.spec.ts`

---

## Phase 2: Foundational（阻塞性前置，MUST 先完成）

**目的**：四条故事共同依赖的运行期通道与硬门禁处置。

**⚠️ 关键**：本阶段完成前，任何用户故事都不可开工（US1 的功能闸门、生成触发点、工具清单出口均在此打通）。

- [ ] T004 在 `agent-backend/src/domain/run-impl.ts` 新增 `calledTools: Set<string>`（本轮已调用工具集合，供轮末生成使用）
- [ ] T005 在 `agent-backend/src/domain/run-manager.ts` 新增 `AgentRunRequest.runtime?: RunRuntime`（可用工具出口）与 `RunManagerDeps.nextActions?` 字段；`consume` 装配 `runtime` 并传入 `agent.run`；`tool_call_start` 分支累积 `run.calledTools.add(ev.name)`
- [ ] T006 在 `agent-backend/src/infra/agent-factory.ts` 的 `runWith` 中，装配完 `tools` 后写 `req.runtime.availableTools = tools.map(t => ({ name: t.name, description: t.description ?? '' }))`（**工具清单唯一来源**，直聊分支保持空）
- [ ] T007 拆分 `agent-backend/src/domain/run-manager.ts`（实测 532 行，**存量超限且本次触及**）：把轮次收尾家族（`finalizeDone` / `finalizeError` / `finalizeAborted` / `recordUsage`）**纯搬运**到新建 `agent-backend/src/domain/run-finalize.ts`（注入 `history` / `usage` / `toolEvents` / `summary` / `nextActions` / `logger` / `now`），`run-manager.ts` 只保留编排；抽取后复测该文件 ≤500 行
- [ ] T008 回归校验拆分：运行 `agent-backend/tests/unit/run-manager-*.spec.ts`，MUST 全绿（仅允许调整对内部方法的导入路径，MUST NOT 改动断言口径）
- [ ] T009 在 `agent-backend/src/domain/soul.ts` 新增 `SoulMeta.nextActionHints`，`parseSoulMeta` 读取 frontmatter 键 `next_action_hints`（缺失/非布尔 → `false`），并新增 `isNextActionsEnabled(optAgentRoot, userId, agentName)`（读 `SOUL.md` → `parseSoulMeta`；异常一律 `false`，fail-closed + 告警）
- [ ] T010 [P] 在 `agent-backend/tests/unit/soul.spec.ts` 补用例：有键 true / 有键 false / 无键 / 非布尔 / YAML 非法 / SOUL 文件缺失（`isNextActionsEnabled` 返回 false）
- [ ] T011 [P] 在 `agent-backend/vitest.config.ts` 的逐模块 80% 清单追加 `src/domain/next-actions.ts` 与 `src/domain/run-finalize.ts`
- [ ] T012 [P] 在 `frontend/vite.config.ts` 的逐文件 80% 清单追加 `src/utils/next-steps.ts` 与 `src/composables/useNextSteps.ts`（全局地板 MUST NOT 下调）

---

## Phase 3: US1（P1）每轮回答结束后出现下一步动作卡片

**故事目标**：回答完成后，正文下方出现固定引导句 + 至多 3 张中文卡片（≤50 字、无工具英文名、不展示工具信息）；0 条时不渲染任何内容；该轮卡片持久保留（刷新/重进仍可见），历史轮次不展示。
**独立验收**：桩模型固定返回 2 条 → 断言卡片数量、顺序、位置（正文之后）、文案合规；刷新后仍在；正文/工具记录/视图入口与改造前逐字一致。

### 测试（先行）

- [ ] T013 [P] [US1] 在 `agent-backend/tests/unit/next-actions.spec.ts` 写**解析与合规**用例：真正 0/1/3/4 条（4 条截取前 3）、50 字通过 / 51 字丢弃、含工具标识符丢弃、含 `snake_case`/`CamelCase` token 丢弃、重复丢弃、空串丢弃、非法 JSON → 空、带 JSON 代码块围栏（三反引号 json）→ 正常解析、顶层裸数组 → 正常解析
- [ ] T014 [P] [US1] 在 `agent-backend/tests/unit/next-actions.spec.ts` 写**工具引用与引导**用例：合法内置/MCP 引用保留并生成 `guidance`（复用 `buildStarterGuidance` 文案）；越界引用丢弃但保留卡片文本；`guidance` >500 字时丢掉引导；可用工具清单为空时所有引用被丢弃
- [ ] T015 [P] [US1] 在 `agent-backend/tests/unit/next-actions.spec.ts` 写**生成链路**用例（注入 `streamChat` 桩）：systemPrompt 含四类上下文（用户输入 / 回答 / 已调用工具 / 可用工具摘要）；超时（假时钟 + Abort）→ 空结果；`error` 事件（`LLM_ERROR`）→ 空结果；空文本 → 空结果；**不阻塞断言（FR-007 / M2）**：把生成桩挂起（不 resolve），断言 `done` 仍按原时序广播、本轮回答与工具记录落盘不受影响
- [ ] T016 [P] [US1] 在 `agent-backend/tests/unit/next-actions.spec.ts` 写**快照存储**用例：覆盖写（新一轮替换旧快照）、原子替换（`.tmp` 不残留）、损坏 JSON → 空 + 告警、超 64KB → 空 + 告警、`clear` 与 `trigger` **同链顺序**（模拟第 N 轮写入未完成时第 N+1 轮 `clear`，断言最终为空）、**产出 0 条 / 开关关闭 / 生成失败一律不写快照**（断言文件不存在，不存在"空快照"形态）
- [ ] T017 [P] [US1] 在 `agent-backend/tests/integration/next-actions.spec.ts` 写端点用例（先于实现，见 T024 期望）：命中 / 开关关闭 / 无快照（产出 0 条、失败轮、中断轮）/ **当前选中数字人 ≠ 快照归属数字人 → 空，切回后恢复下发（FR-019 / SC-011）** / 快照损坏 / 他人会话 404 `THREAD_NOT_FOUND` / P95 计时（20 次，冷热各半，实测值登记进本文末尾「同步记录」表）
- [ ] T018 [P] [US1] 在 `frontend/src/utils/next-steps.spec.ts` 写用例：`NEXT_STEPS_PULL_DELAYS_MS` 末次 **> 生成超时上限**（不变量断言）、`visibleActions(steps, messageId)` 仅在 id 匹配时返回、`nextStepSendPayload` 产出 `{content, attachments: [], guidance?}`（与问题实例同款）
- [ ] T019 [P] [US1] 在 `frontend/src/composables/useNextSteps.spec.ts` 写用例（假时钟）：拉取窗口按 `[0,1500,3500,6000]` 依次触发、首次命中即停、全空后停止、切换会话重置、**过期响应丢弃**（旧请求返回后不得覆盖新状态）、请求失败静默（不抛错、不产生错误态）
- [ ] T020 [P] [US1] 在 `frontend/src/components/chat/MessageNextSteps.spec.ts` 写用例：无卡片时根节点不渲染（无 DOM）；有卡片时渲染固定引导句"您接下来可以操作以下动作，请选择"且文案逐字一致；卡片按序渲染且文本等于 `prompt`；**不出现任何工具名**；键盘 `Tab`/`Enter`/`Space` 可达
- [ ] T021 [P] [US1] 在 `frontend/src/components/chat/SuggestionCard.spec.ts` 写用例：`text` 渲染、`disabled` 置灰、点击发 `select`、`data-test` 透传
- [ ] T022 [P] [US1] 在 `frontend/src/components/chat/MessageBubble.nextSteps.spec.ts` 写用例：卡片容器渲染在正文容器**之后**（工具记录与视图入口的相对顺序不变）

### 实现

- [ ] T023 [US1] 实现 `agent-backend/src/domain/next-actions.ts` 的**纯函数层**：输出容错解析（剥离代码块围栏、容忍裸数组）、提示词合规判定（唯一实现）、工具引用过滤与 `exposed_name` 派生、`guidance` 派生（复用 `soul.ts` 的 `buildStarterGuidance` / `toolExposedName`）
- [ ] T024 [US1] 实现 `agent-backend/src/domain/next-actions.ts` 的**生成层**：systemPrompt 组装（全中文约束 + 严格 JSON 输出要求 + 可用工具摘要，并声明工具标识符仅供 `tools` 字段使用）、`streamChat` 收集（`tools: []`、`thinking: false`）、5s `AbortController` 超时、失败静默 + 结构化告警（`{ alert: true, event: 'next-actions.failed', scope: 'system' }`，经 `createThrottledWarn`）
- [ ] T025 [US1] 实现 `agent-backend/src/domain/next-actions.ts` 的**存储层**：`trigger()` / `clear()` / `read()`，per-thread 串行链（`clear` 与 `trigger` **同链**，保证「N 轮写入 → N+1 轮清空」）、`next-actions.json` 原子替换（临时文件 + `renameSync`，失败保留旧快照 + 告警）、64KB 上限、**仅在产出 ≥1 条时写入**（0 条 / 开关关 / 失败一律不写，不产生"空快照"）、`read()` 实现**双判据**：按快照 `agent_name` 调 `isNextActionsEnabled`（关闭 → 空）∧ 该 `agent_name` 必须等于**当前选中数字人**（不一致 → 空，FR-019）
- [ ] T026 [US1] 在 `agent-backend/src/domain/run-finalize.ts` 的 `finalizeDone` 末尾接入生成触发（紧随 `summary.trigger` 之后，`void` 调用，参数含 `userId` / `threadId` / `assistantMessageId` / `agentName` / `userText` / `answerText` / `calledTools` / `availableTools`）；在 `RunManager.startRun` 接入 `clear`；触发前 MUST 先判该轮数字人开关（关 → 不入链、不产生任何模型调用，FR-032/SC-007）
- [ ] T027 [US1] 在 `agent-backend/src/context.ts` 的 `AppContext` 新增 `nextActions`；在 `agent-backend/src/server.ts` 用**既有惰性单例** `llm()` 装配 `NextActionsStore`、注入 `RunManager`、填入 context
- [ ] T028 [US1] 在 `agent-backend/src/routes/threads.ts` 新增 `GET /api/threads/:id/next-actions`：会话归属校验（不存在/非本人 → 404 `THREAD_NOT_FOUND`）→ 读快照 → **双判据**（归属数字人开关为开 ∧ 归属数字人 = `ctx.currentAgent.current(userId)`，FR-019/FR-034）→ 序列化为 `{ message_id, actions }`（`guidance` 始终出现，空串表示无引导）；四类空态一律 **200 + 空**；`Cache-Control: no-store`
- [ ] T029 [US1] 回写契约：在 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 登记新端点（含 §1.4 全场景与错误码）与"SSE / 详情接口零变更"声明，并与 `specs/007-next-action-hints/contracts/next-actions-api.md` 核对一致
- [ ] T030 [P] [US1] 在 `frontend/src/api/threads.ts` 新增 `ThreadNextSteps` 类型与 `ThreadsApi.nextSteps(threadId)`（类型放此处，`frontend/src/api/types.ts` 本次不新增代码）
- [ ] T031 [P] [US1] 实现 `frontend/src/api/next-steps.ts` 的只读拉取封装（复用 `api/http.ts`；失败即返回空形态，不抛错）
- [ ] T032 [US1] 实现 `frontend/src/utils/next-steps.ts`：`NEXT_STEPS_PULL_DELAYS_MS`（含"末次 MUST 晚于生成超时"注释交叉引用）、`visibleActions`、`nextStepSendPayload`
- [ ] T033 [US1] 实现 `frontend/src/composables/useNextSteps.ts`：`createNextStepsStore`（拉取窗口调度、命中即停、过期响应丢弃、切会话重置、失败静默）+ `useNextSteps()` 注入访问器
- [ ] T034 [US1] 实现 `frontend/src/components/chat/SuggestionCard.vue`：原生 `<button>`（`props: text` / `disabled`；`emit: select`；`data-test` 由使用方传入），样式与既有 `.chat-panel__starter` **同源**（同一套 CSS 变量与形态）
- [ ] T035 [US1] 实现 `frontend/src/components/chat/MessageNextSteps.vue`：固定引导句 + 卡片列表（语义列表容器 + `aria-label`）；无卡片时**不渲染任何 DOM**；动效随 `prefers-reduced-motion` 降级
- [ ] T036 [US1] 在 `frontend/src/composables/useAppSession.ts` 装配 `nextSteps` store 并在 `AppSession` 暴露；`onTurnFinished` 由 `() => threads.refresh()` 改为"刷新会话 + 启动一次拉取窗口"
- [ ] T037 [US1] 在 `frontend/src/components/chat/MessageBubble.vue` 新增 prop `nextSteps?` 并在 `MessageViewLinks` **之后**渲染 `<MessageNextSteps>`；在 `frontend/src/components/chat/MessageList.vue` 新增同名 prop，仅对 `message.id === nextSteps.message_id` 的那条透传
- [ ] T038 [US1] 在 `frontend/src/components/chat/ChatPanel.vue` 挂载 `useNextSteps()` 并把数据接到 `MessageList`；hero 区问题实例卡片改用 `SuggestionCard`，同步更新 `frontend/src/components/chat/ChatPanel.starters.spec.ts`
- [ ] T039 [US1] 门禁：`cd agent-backend; npm run lint; npm run typecheck; npm run test:coverage; npm run test:integration; npm run build` 全绿；`next-actions.ts` / `run-finalize.ts` ≥80%；`run-manager.ts` 复测 ≤500
- [ ] T040 [US1] 门禁：`cd frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build` 全绿；`ChatPanel.vue` 复测 ≤500；覆盖地板未下调

**检查点**：US1 完成后即是 **MVP** —— 开启开关的数字人，回答后能看到可点击的下一步动作卡片（点击行为在 US2）。

---

## Phase 4: US2（P2）点击卡片经确认后发起下一轮

**故事目标**：点击卡片 → 二次确认弹窗（展示提示词全文）→ 取消不发 / 确认后经**既有发送链路**发起下一轮；卡片关联工具经**隐藏引导**注入本轮（与问题实例同一通道、同一文案；不展示、不落历史、不改变工具权限）。
**独立验收**：渲染 1 张卡片 → 点击 → 弹窗出现且**未**发送 → `Esc`/取消后消息列表长度不变 → 确认后新增用户消息内容等于提示词，网络面板可见 `guidance` 且界面无工具名。

### 测试（先行）

- [ ] T041 [P] [US2] 在 `frontend/src/components/chat/ChatPanel.nextSteps.spec.ts` 写用例：点击卡片 → 弹窗出现且**未**调用 `onSend`；取消 / `Esc` → 不发送；确认 → 调用一次 `onSend`，payload 为 `{content: prompt, attachments: [], guidance}`（与 `onStarterClick` 同款）
- [ ] T042 [P] [US2] 在 `frontend/src/components/chat/ChatPanel.nextSteps.spec.ts` 补充边界用例：确认弹窗打开或发送进行中时**连点只发一次**；发送失败时提示可见（不静默）；未选中数字人 / 会话不可用 → 明确提示且不产生残留会话

### 实现

- [ ] T043 [US2] 在 `frontend/src/components/chat/MessageBubble.vue` 新增 `send-suggestion` 事件出口，并在 `frontend/src/components/chat/MessageList.vue` 透传至 `ChatPanel`
- [ ] T044 [US2] 在 `frontend/src/components/chat/ChatPanel.vue` 新增 `ConfirmDialog`（`confirmLabel="发送"`，标题与正文展示提示词全文）与 `onPickNextStep`：确认后调 `onSend(nextStepSendPayload(action))`，`guidance` 非空时一并回传；发送中禁用、失败提示
- [ ] T045 [US2] 在 `frontend/src/components/chat/ChatPanel.vue` 实现不可用态拒绝：未选中数字人或会话被删除时，点击卡片给出可感知提示且不发送（复用既有 `toast` 与 `useThreads` 的既有降级口径）
- [ ] T046 [US2] 在 `frontend/src/composables/useChatPanel.ts` 与 `frontend/src/components/chat/MessageBubble.vue` 核对不变量：发送链路唯一（未新增第二套发送实现）、用户消息气泡与历史中不出现工具名（在 `frontend/src/components/chat/ChatPanel.nextSteps.spec.ts` 的 T041 用例中断言）
- [ ] T047 [US2] 门禁：`cd frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build` 全绿

---

## Phase 5: US3（P2）管理台开关与部署生效

**故事目标**：管理台"数字人管理 → SOUL"出现开关「是否开启下一步动作提示」（默认关闭）；开启/关闭保存并部署后，运行环境分别产出/停止产出卡片，且关闭态部署产物**无残留配置**。
**独立验收**：设计态保存 → 部署产物在开启时含 `next_action_hints: true`、关闭时**不含**该键；两态部署产物下各跑一轮，卡片分别出现/不出现；开关开/关的 System Prompt **逐字一致**。

### 测试（先行）

- [ ] T048 [P] [US3] 在 `admin-backend/tests/unit/soul-design.spec.ts` 写用例：缺省 → `false`；`true` → 渲染出 `next_action_hints: true`；`false` → **不写键**（不写空壳）；非布尔（字符串/数字/null）→ 报错；旧字符串 `soul` 升级路径落 `false`；`isSoulDesign` 不得把新字段判为非法
- [ ] T049 [P] [US3] 在 `admin-backend/tests/unit/materialize.spec.ts`（或 `agent-design.spec.ts`）写用例：开关开/关两种设计态的 `SOUL.md` 产物差异**只有 frontmatter 一个键**，正文逐字一致
- [ ] T050 [P] [US3] 在 `admin-frontend/src/components/agents/SoulEditor.spec.ts` 写用例：开关渲染、文案为「是否开启下一步动作提示」、默认关闭、勾选后 `update:modelValue` 含 `next_action_hints: true`
- [ ] T051 [P] [US3] 在 `agent-backend/tests/integration/` 写 FR-035 快照用例：同一 `SOUL.md` 正文 + 开关开/关两种 frontmatter，`loadAgentConfig` 产出的 `systemPrompt` **逐字一致**；并断言开关关闭时该轮**不发起**生成调用（SC-007）

### 实现

- [ ] T052 [US3] 在 `admin-backend/src/domain/config-center/soul-design.ts` 实现：`SoulDesign.next_action_hints: boolean`（可选、缺省 `false`）、`emptySoulDesign()` / `fromLegacySoul()` 落 `false`、`normalizeSoulDesign` 新增 `readBool`（缺省 false、非布尔报错）、`renderSoulMd` **仅 true 时**写键、`isSoulDesign` 同步
- [ ] T053 [P] [US3] 在 `admin-frontend/src/api/soul.ts` 的 `SoulDesign` 新增 `next_action_hints: boolean`
- [ ] T054 [P] [US3] 在 `admin-frontend/src/constants/agent-design.ts` 的 `emptySoulDesign()` 补 `next_action_hints: false`（**必须**，否则脏检查与深拷贝漏字段）
- [ ] T055 [P] [US3] 在 `admin-frontend/src/composables/useAgentDesign.ts` 的 `cloneSoul` 补该字段
- [ ] T056 [US3] 在 `admin-frontend/src/components/agents/SoulEditor.vue` 于"快速上手"区之后新增开关（原生 `<input type="checkbox">`，沿用 `ScenarioFieldDialog` 的布尔范例），label「是否开启下一步动作提示」+ 一句说明（关闭则部署后该功能消失），经 `patch({ next_action_hints })` 上抛
- [ ] T057 [US3] 回写契约：在 `specs/001-digital-human-platform/contracts/admin-api.md` 的 §5 SOUL 字段表新增 `next_action_hints`（布尔、可选、缺省 false、拒绝式校验口径）；在 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 登记 `SOUL.md` frontmatter 新键与"仅 true 时写"口径；核对 `specs/001-digital-human-platform/data-model.md` 的设计态字段表
- [ ] T058 [US3] 门禁：`cd admin-backend; npm run lint; npm run typecheck; npm run test:coverage; npm run build` 与 `cd admin-frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build` 全绿；`admin-backend/src/domain/config-center/soul-design.ts` 复测 ≤500

---

## Phase 6: US4（P3）附加能力失败不打扰用户

**故事目标**：生成链路四类失败（调用失败 / 超时 / 输出结构非法 / 条目全部不合规，含工具清单不可用）一律静默降级为"本轮无建议"；用户端无错误 UI；原始错误落结构化日志；重试与超时有界。
**独立验收**：四种注入下用户端均无卡片、无引导句、无错误提示，本轮回答与工具记录照常展示，日志各有对应记录。

### 测试（先行）

- [ ] T059 [P] [US4] 在 `agent-backend/tests/unit/next-actions.spec.ts` 写四类失败用例：`streamChat` 抛错 / 超时 / 返回非法结构 / 返回 5 条全不合规 + 工具清单为空 → 结果均为空、**不抛错**、各有告警记录（断言 `event: 'next-actions.failed'` 与 `thread_id` / `agent_name` 上下文）
- [ ] T060 [P] [US4] 在 `agent-backend/tests/integration/next-actions.spec.ts` 写端点降级用例：快照写入失败 / 开关读取失败 / 文件损坏 → 端点仍 **200 + 空**（MUST NOT 变成 5xx）
- [ ] T061 [P] [US4] 在 `frontend/src/composables/useNextSteps.spec.ts` 写前端降级用例：拉取全失败 / 全部为空 → 不抛错、无错误态、`steps` 为空
- [ ] T062 [P] [US4] 在 `frontend/src/components/chat/MessageNextSteps.spec.ts` 写降级展示用例：`steps` 为空对象 / `message_id: null` → 根节点不渲染（无间距、无占位、无错误文案）

### 实现与收敛

- [ ] T063 [US4] 逐条核对降级实现：`agent-backend/src/domain/next-actions.ts` 的 catch 分支只告警不外抛；`agent-backend/src/routes/threads.ts` 的新端点错误处理按"一律 200 空"；`frontend/src/composables/useNextSteps.ts` 的拉取失败与空结果路径均无 UI 反馈（不新增 toast / 错误块）
- [ ] T064 [US4] 核对有界性：`agent-backend/src/domain/next-actions.ts` 生成 ≤1 次尝试、超时 5s、无重试；`frontend/src/utils/next-steps.ts` 拉取恰好 4 次；两处常量以注释互相交叉引用（防"只改一边"）
- [ ] T065 [US4] 门禁：`cd agent-backend; npm run lint; npm run typecheck; npm run test:coverage; npm run test:integration; npm run build` 与 `cd frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build` 全绿

---

## Phase 7: Polish 与横切关注点

- [ ] T066 [P] 覆盖率地板复核：`agent-backend/vitest.config.ts`、`frontend/vite.config.ts`、`admin-backend/vitest.config.ts`、`admin-frontend/vitest.config.ts` 的全局地板与实测值比对，若实测高于地板则按先例**上调**（地板只上不下）并在 `specs/007-next-action-hints/tasks.md` 登记实测值与命令输出
- [ ] T067 [P] 行数复核：`agent-backend/src/domain/run-manager.ts`、`frontend/src/components/chat/ChatPanel.vue`、`admin-backend/src/domain/config-center/soul-design.ts` 均 ≤500；`frontend/src/composables/useChatStream.ts`（存量 535 行）**确认未被改动**（`git diff --stat` 核对）
- [ ] T068 [P] 依赖复核：四侧 `package.json` / `package-lock.json` **零新增依赖**（`git diff` 核对；有则回退并登记）
- [ ] T069 执行 `specs/007-next-action-hints/quickstart.md` §3 的 S1~S8 端到端场景并记录结果（含"关闭态无额外模型调用""刷新后仍在""新一轮旧卡片消失""关闭后历史不展示""**跨数字人切换不下发且切回恢复**"五项关键断言）
- [ ] T070 执行 `specs/007-next-action-hints/quickstart.md` §4 的**非交互冒烟确认**（`docker compose up -d --build` + HTTP 打点：健康检查 200 / 新端点 200 且形状正确 / 不存在会话 404 / 详情接口**无** `next_actions` 字段）
- [ ] T071 [P] 交付说明登记已知存量缺陷：`BaseDialog` / `ConfirmDialog` 原生 `<dialog>` 因 Tailwind preflight 覆盖 `dialog { margin: auto }` 而不居中；用户此前明确"先记一下、先不改"，本特性仅新增一处复用，**不修**、不纳入交付判定
- [ ] T072 [P] `specs/007-next-action-hints/tasks.md` 末尾「同步记录」表登记：本次口径变更（生成超时 = 5s 与拉取末次 = 6000ms 的耦合约束、`run-manager.ts` 拆分前后行数、覆盖率地板变动、契约回写落点与日期）
- [ ] T073 规格—计划—任务一致性核查：对 `specs/007-next-action-hints/spec.md`、`plan.md`、`tasks.md` 与 `specs/001-digital-human-platform/contracts/` 执行 `/speckit.analyze`，宪章冲突按 CRITICAL 处理，逐条修正到无遗留

---

## 依赖关系与执行顺序

```text
Phase 1 (Setup)
        ↓
Phase 2 (Foundational：T004~T012)  ← 阻塞全部故事
        ↓
   ┌────────────┬───────────────┬──────────────┐
   ↓            ↓               ↓              ↓
 US1 (P1)     US2 (P2)        US3 (P2)       US4 (P3)
 T013~T040    T041~T047       T048~T058      T059~T065
   │            │               │              │
   └────────────┴───────────────┴──────────────┘
                        ↓
              Phase 7 (Polish T066~T073)
```

**故事间依赖**

| 关系 | 说明 |
|---|---|
| US1 → US2 | US2 需要 US1 渲染出的卡片与数据（同一份 `steps`） |
| US3 与 US1 **互不阻塞** | US1 的独立验收用**夹具 SOUL.md**（手写 `next_action_hints: true`）开启功能，不依赖管理台；US3 用部署产物断言，不依赖卡片渲染 |
| US1 → US4 | US4 断言的是 US1 生成链路的失败分支，须在 US1 实现后注入 |
| US3 → US4 无关 | 降级与开关是两个正交维度 |

**同文件冲突提示（MUST 串行，不可并行）**

- `agent-backend/src/domain/next-actions.ts`：T023 → T024 → T025（同文件三阶段）
- `agent-backend/tests/unit/next-actions.spec.ts`：T013、T014、T015、T016（可并行编写但合并时注意 describe 分组）
- `frontend/src/components/chat/ChatPanel.vue`：T038 → T044
- `frontend/src/components/chat/MessageBubble.vue` / `MessageList.vue`：T037 → T043
- `specs/001-digital-human-platform/contracts/runtime-api-delta.md`：T029；`admin-api.md`：T057

---

## 并行执行示例

### Foundational（Phase 2）

```text
任务：在 agent-backend/src/domain/run-impl.ts 新增 calledTools（T004）
任务：在 agent-backend/tests/unit/soul.spec.ts 补开关读取用例（T010）
任务：在 agent-backend/vitest.config.ts 追加两个模块阈值（T011）
任务：在 frontend/vite.config.ts 追加两个模块阈值（T012）
```

### US1（Phase 3）——测试组可全量并行

```text
任务：写 next-actions 解析与合规用例（T013）
任务：写 next-actions 工具引用与引导用例（T014）
任务：写 next-actions 生成链路用例（T015）
任务：写 next-actions 快照存储用例（T016）
任务：写端点集成用例（T017）
任务：写 frontend/utils/next-steps.spec.ts（T018）
任务：写 frontend/composables/useNextSteps.spec.ts（T019）
任务：写 MessageNextSteps.spec.ts / SuggestionCard.spec.ts / MessageBubble.nextSteps.spec.ts（T020~T022）
```

### US1 实现层可并行（不同文件）

```text
任务：实现 frontend/src/api/next-steps.ts（T031）
任务：实现 frontend/src/utils/next-steps.ts（T032）
任务：实现 frontend/src/components/chat/SuggestionCard.vue（T034）
```

### US3 与管理台并行

```text
任务：admin-backend 的 soul-design.spec.ts 用例（T048）
任务：admin-frontend 的 SoulEditor.spec.ts 用例（T050）
任务：agent-backend 的 FR-035 快照用例（T051）
```

---

## 实现策略

### MVP 优先（仅 US1）

1. 完成 Phase 1（Setup）与 Phase 2（Foundational）——**阻塞项，不可跳过**；
2. 完成 Phase 3（US1）；
3. **停下并独立验证**：用夹具 SOUL.md（`next_action_hints: true`）跑一轮对话，确认卡片出现、文案合规、刷新后仍在、历史轮不展示；
4. 此时可交付演示（卡片可看但点击尚未接线）。

### 增量交付

| 增量 | 内容 | 交付价值 |
|---|---|---|
| 增量 1 | Setup + Foundational + US1 | **MVP**：回答后出现可点击的下一步动作卡片 |
| 增量 2 | + US2 | 形成"点击即可推进"的闭环（引导可用） |
| 增量 3 | + US3 | 可按数字人灰度/回滚（上线闸门） |
| 增量 4 | + US4 + Polish | 可放心上线的健壮性与可观测性 |

每个增量完成后 MUST 独立跑该涉及的侧门禁，MUST NOT 把"跑测试"推迟到全部完成之后。

### 并行团队策略（若有多人）

1. 全员共同完成 Setup + Foundational；
2. 之后：A 负责 US1（运行环境 + 前台），B 负责 US3（管理平台两侧），C 负责 US2 的确认弹窗与事件链路（依赖 A 的 T037 完成后开工）；
3. US4 由 A 收口（其断言落在 US1 的生成链路上）。

---

## 注意事项

- **[P]** = 不同文件且无未完成依赖；同文件任务 MUST 串行（见"同文件冲突提示"）
- **[Story]** 标签用于追溯任务归属，便于按故事独立验收
- **测试先行**不等于严格 TDD：先写用例以锁定验收口径，实现后 MUST 全部通过
- 每个检查点后 MUST 提交一次（提交信息用中文并说明影响的侧）
- 提交前 MUST 复核：**零新增依赖**、触及文件 ≤500 行、契约四处同步（契约文档 / 前端类型 / 后端 schema / 测试）
- **MUST NOT** 顺手修与本次无关的存量缺陷（含 `ConfirmDialog` 不居中）；如需处理，另行登记（见 T071）

---

## 同步记录

> 供实现期登记口径变更、实测数据与偏差；`/speckit.analyze` 与验收时逐条核对。

### 表（1）门禁基线与关键文件行数（T001）

| 项 | 基线值（2026-10-12 实测） | 现状 | 备注 |
|---|---|---|---|
| `agent-backend/src/domain/run-manager.ts` | **532 行（存量超限）** | 待实现后复测 | 本次 MUST 拆分（T007） |
| `frontend/src/composables/useChatStream.ts` | **535 行（存量超限）** | 待确认未改动 | 不追溯；本特性 MUST NOT 新增代码 |
| `frontend/src/api/types.ts` | 488 行 | 待确认未改动 | 本次新类型落 `api/threads.ts` |
| `frontend/src/components/chat/ChatPanel.vue` | 403 行 | 待复测 | 预计 +~30 |
| `admin-backend/src/domain/config-center/soul-design.ts` | 391 行 | 待复测 | 预计 +~10 |
| 四侧门禁基线（lint / typecheck / test / coverage / build） | 待登记 | — | 依 T001 **实测**填入（不预设存量红灯；`agent-backend` / `frontend` 既有即无 `check:lines` / `check:deps` 脚本，属既有现状而非本特性缺陷） |

### 表（2）口径与参数登记

| 项 | 值 | 落点 |
|---|---|---|
| 生成超时上限 | 5000 ms（≤1 次尝试、不重试） | `agent-backend/src/domain/next-actions.ts` |
| 前端拉取窗口 | `[0, 1500, 3500, 6000]` ms（末次 MUST > 生成超时） | `frontend/src/utils/next-steps.ts` |
| 卡片条数上限 | 3 条；提示词 ≤50 字；`guidance` ≤500 字 | `next-actions.ts` 合规层 |
| 快照上限 | 64 KB；每会话一份 | `next-actions.ts` 存储层 |
| 开关字段名 | `soul.next_action_hints` → `SOUL.md` frontmatter `next_action_hints`（仅 true 时写） | 管理台 + 物化 + 运行环境 |
| 新端点 | `GET /api/threads/{id}/next-actions`（四类空态一律 200 + 空） | `agent-backend/src/routes/threads.ts` |
| **下发前置双判据** | ① 归属数字人开关为开；② **归属数字人 = 当前选中数字人**（FR-019 / SC-011，跨数字人越权的唯一兜底点） | `agent-backend/src/routes/threads.ts` + `next-actions.ts` |
| **快照写入条件** | **仅在产出 ≥1 条时写入**；0 条 / 开关关 / 失败一律不写（不产生"空快照"，快照存在即代表"有建议"） | `next-actions.ts` 存储层 |
| 新端点时延 | P95 ≤ 500ms；计时 20 次（冷热各半），实测值登记进表（2）下方 | `agent-backend/tests/integration/next-actions.spec.ts` |
| 结构化日志事件 | `next-actions.failed`（`alert: true`，含 `thread_id` / `agent_name`） | `next-actions.ts`（`createThrottledWarn`） |
| SSE / 详情接口 | **零变更**（显式声明） | `contracts/next-actions-api.md` §2 |

### 表（2.1）新端点 P95 实测（T017 填写）

| 日期 | 样本数 | 冷 / 热 | P95 (ms) | 判定（≤500ms） |
|---|---|---|---|---|
| — | 20 | 各 10 | 待填 | 待判定 |

### 表（3）执行期偏差记录

| 日期 | 项 | 说明 |
|---|---|---|
| 2026-10-12 | analyze C1（CRITICAL） | 新增 FR-019 / SC-011 与下发前置第二判据（归属数字人 = 当前选中数字人），并把该判据写入 T017 / T025 / T028；依据：会话不绑定数字人且可跨数字人，隐藏引导在发送端铸造、接收端不校验 |
| 2026-10-12 | analyze H1 | `guidance` 口径统一为"始终出现，空串 = 无引导"（与既有 `AgentStarterView.guidance: string` 逐字同形），同步契约 §1.2 / §5 与 T028 / T032 |
| 2026-10-12 | analyze M1 | SC-001 口径修订（不存在加载态 + 成功时 P90 ≤5s + 最迟 6s 可确定），消除与"超时 5s / 末次拉取 6s"的漂移 |
| 2026-10-12 | analyze M2 | FR-007 不阻塞断言并入 T015（生成桩挂起时 `done` 仍按原时序广播） |
| 2026-10-12 | analyze M3 | 固化为「**不写空快照**」（快照存在即代表"有建议"），同步 T016 / T025 / 契约 §1.4 与 `data-model.md` §4.2 |
| 2026-10-12 | analyze L1 | 删除本文档表（1）中无证据的"`frontend` 既有 lint/typecheck 存量红灯"表述，改为以 T001 实测登记 |
| 2026-10-12 | analyze L3 | 新端点 P95 补判定门限与登记落点（表 2.1） |
| 2026-10-12 | 存量观察（L4） | `admin-backend` 等 `package.json` 的 `description` 含非法 UTF-8 字节，会导致 `ConvertFrom-Json` 一类解析失败；**单独登记、不在本特性范围** |
| — | — | 待实现期继续填写 |
