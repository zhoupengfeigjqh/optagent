---
description: "意图聚焦（Intent Focus）实施任务清单"
---

# 任务清单：意图聚焦（Intent Focus）

- **特性标识**：`013-intent-focus`
- **输入**：[spec.md](./spec.md)（4 个用户故事）｜[plan.md](./plan.md)（P1~P4 分期）｜[research.md](./research.md)（D1~D13）｜[data-model.md](./data-model.md)｜[contracts/intent-focus-api.md](./contracts/intent-focus-api.md)｜[quickstart.md](./quickstart.md)
- **测试口径**：本项目宪章原则三为 **NON-NEGOTIABLE**，故测试任务不是可选项——新增模块、每个新组件/composable/纯函数、每个端点改动 MUST 有对应测试，且**全部在宿主机本地执行**（容器不参与）。
- **用户补充口径（2026-10-25）**：镜像固定 `chaitin/decis:laya-multilingual-v0.4.0`；判定阈值 MUST 支持环境变量 `INTENT_FOCUS_THRESHOLD`（**优先于** `config.yaml`）。
- **路径约定**：本仓库为多子项目布局，任务中出现 `agent-backend/`、`frontend/`、`admin-backend/`、`admin-frontend/` 前缀即仓库根下的真实目录。

## 格式

`[ID] [P?] [Story] 描述（含精确文件路径）`

- **[P]**：可并行（不同文件、不依赖未完成任务）
- **[Story]**：用户故事标签（仅用户故事阶段）
- 每条形如 `- [x] T001 …`

---

## Phase 1：准备（共享基础设施）

**目的**：把"模型服务能起来、基线记得住、依赖没变多"三件事先钉死。

- [x] T001 拉取并启动判定模型容器（**改为本地自建镜像 `laya-service`**，见"验收证据"）：先 `docker build -t laya-service laya-service`（源码 + 权重已预置，见 `quickstart.md §2.0`），再 `docker run -d --name optagent-laya -p 8103:8000 -e DECIS_API_KEY=dev-laya-key -e DECIS_SHUTDOWN_GRACE_MS=25000 --memory 6g laya-service`，随后逐项执行 `quickstart.md §2.3` 的 C1~C8 核对清单（含 `/healthz`、`/readyz`、`/v1/models`），把结论记在本文件"验收证据"处
- [x] T002 [P] 复测并登记行数基线：在仓库根执行逐文件计数，确认 `agent-backend/src/domain/run-manager.ts`=539、`agent-backend/src/server.ts`=498、`admin-backend/src/domain/config-center/soul-design.ts`=490、`frontend/src/composables/useChatPanel.ts`=486、`frontend/src/components/chat/ChatPanel.vue`=474（若与本清单不符，先更正 `plan.md §2` 再开工）
- [x] T003 [P] 依赖基线核对：确认 `agent-backend/package.json`、`frontend/package.json`、`admin-backend/package.json`、`admin-frontend/package.json` 无新增依赖（本特性零新增；`git diff --stat` 应只有 `docker-compose.yml` 等非 manifest 文件）

**检查点**：模型服务 `/v1/models` 返回含 `laya-multilingual`；四侧 `npm run lint`/`typecheck` 在改动前为绿。

---

## Phase 2：地基（阻塞所有用户故事）

**目的**：判定所需的最小可用零件——配置、协议适配器、纯函数、记录存储、开关读取、素材注入、容器编排。**⚠️ 本阶段完成前，任何用户故事都不能开始。**

### 配置与协议

- [x] T004 [P] 在 `agent-backend/src/config.ts` 新增 `intentFocusSchema`（`base_url`/`model`/`api_key`/`timeout_ms`/`threshold`/`max_actions`，整块可选）与冻结字段 `AppConfig.intentFocus?`；`base_url` MUST 以 `http(s)://` 开头；`timeout_ms ∉ [300,5000]`、`threshold ∉ [0,1]`、`max_actions ∉ [1,3]` 一律 `ConfigError` 启动失败；`api_key` 支持 `$ENV` 引用但**不**回落到 `DEEPSEEK_API_KEY`
- [x] T005 在 `agent-backend/src/config.ts` 的 `envSchema` 新增 `INTENT_FOCUS_THRESHOLD`（**与 T004 同一文件，串行执行**）（`z.coerce.number().min(0).max(1).optional()`），并在 `loadConfig()` 中用它**覆盖**配置块的 `threshold`（环境变量优先；两者都缺则 `0.5`）；越界即启动失败
- [x] T006 [P] 新增 `agent-backend/src/infra/laya-client.ts`：`SystemOneClient`（构造入参 `{ baseUrl, model, apiKey, timeoutMs }`），`decide(state, questions)` 用平台原生 `fetch` + `AbortSignal.timeout(timeoutMs)` 向 `{baseUrl}/v1/systemone` 发 `POST`（`Authorization: Bearer`），**不重试**；把 401/超时/非 JSON/非对象/缺 `answers` 归为可区分的失败原因（返回 discriminated union，不抛错给上层）
- [x] T007 [P] 新增 `agent-backend/tests/unit/laya-client.spec.ts`：注入桩 `fetch`，覆盖 200 正常、401、503、非 JSON、缺 `answers`、某题缺 `noul`、`noul` 非数字、超时（Abort）八种情形；断言**只发一次请求**（无重试）

### 判定纯函数

- [x] T008 [P] 新增 `agent-backend/src/domain/intent-focus.ts`：`buildQuestions(candidates)`（候选按原序截断到 **24**，逐题中文 `instructions` + `criteria`，键 `t1..tN` 与候选下标一一对应）、`selectActions({candidates, probabilities, threshold, maxActions})`（概率降序、同概率按候选原序、`≥threshold` 取前 `maxActions`）、`composeFocusPrompt(actions)`（固定前缀「请将当前规划重点聚焦于：」+ 中文逗号分隔 + 去重 + 空则返空串）、`decideDisposition(...)`（`focused`/`empty`/`skipped`/`degraded`/`unconfigured`）
- [x] T009 [P] 新增 `agent-backend/tests/unit/intent-focus.spec.ts`：0/1/3/4 个动作、阈值边界（恰等于阈值、全低于）、同概率稳定序、提示格式逐字断言（前缀/分隔符/无换行/去重/工具英文名不翻译）、候选 24 截断与 `truncated` 标记、无可用工具→`empty` 且不构造命题

### 记录存储

- [x] T010 [P] 新增 `agent-backend/src/domain/intent-focus-store.ts`：`append(uid, agentName, threadId, record)`（per-thread Promise 链串行 + `appendFile`）、`compact` 触发条件（>256KB 或 >200 行 → 保留最近 100 条，临时文件 + `fs.renameSync` 原子替换，失败保留原文件且只告警）、`seq` 维护（线程内自增）
- [x] T011 [P] 新增 `agent-backend/tests/unit/intent-focus-store.spec.ts`：串行追加（并发 5 条不交错）、五种处置各写一行、超限滚动后只剩 100 条、重命名失败时原文件不变且不抛错、坏行容错（读取侧不解析）

### 开关读取（运行侧）

- [x] T012 [P] 在 `agent-backend/src/domain/soul.ts` 的 `SoulMeta` 新增 `intentFocus: boolean`，`emptySoulMeta()` 补 `false`，`parseSoulMeta` 读 `record.intent_focus === true`（非布尔一律 false），新增 `isIntentFocusEnabled(optAgentRoot, userId, agentName, logger?)`（逐次读盘、异常→false+告警，与 `isNextActionsEnabled` 同构）
- [x] T013 [P] 在 `agent-backend/tests/unit/soul.spec.ts` 补用例：键缺失 / 非布尔 / `true` / 文件不存在 / YAML 非法 五态；并断言**开关不影响** `stripFrontmatter` 的正文结果

### 素材注入

- [x] T014 [P] 在 `agent-backend/src/domain/prompt-builder.ts` 的 `PromptSources` 新增 `focusPrompt?: string`，在 `guidance` **之前**、`nowText` 之后插入（有内容才占位），并补注释说明"为什么在 guidance 前"
- [x] T015 [P] 在 `agent-backend/tests/unit/prompt-builder.spec.ts` 补用例：有 `focusPrompt` 时段序为「…→当前时间→聚焦提示→guidance」；为空串/缺省时 `systemExtra` 与改造前逐字一致

### 容器编排与配置样例

- [x] T016 [P] 在 `docker-compose.yml` 新增 `laya` 服务：`image: chaitin/decis:laya-multilingual-v0.4.0`、`container_name: optagent-laya`、`ports: ["8103:8000"]`、`mem_limit: 6g`、`environment` 含 `DECIS_API_KEY`、`DECIS_SHUTDOWN_GRACE_MS=25000`（**不设** `DECIS_ALLOW_NO_AUTH` 与 `DECIS_PLAYGROUND_HOST_PORT`）、`restart: unless-stopped`、`logging: *default-logging`；`backend` 加 `depends_on: laya`；注释写明"固定版本 tag，勿用 latest"
- [x] T017 [P] 在 `agent-backend/config.example.yaml` 末尾新增带注释的 `intent_focus` 示例块（含"整块缺失 = 功能不可用"、"`INTENT_FOCUS_THRESHOLD` 可覆盖 threshold"两句说明）

**检查点**：`cd agent-backend && npm run test` 全绿；`npm run typecheck` 绿；容器冒烟通过；三份新模块（`intent-focus.ts` / `intent-focus-store.ts` / `laya-client.ts`）均有同名 spec。

---

## Phase 3：用户故事 1 — 开启后每轮先做意图聚焦（优先级：P1）🎯 MVP

**目标**：开关开启的数字人，每条手输消息在主模型调用**之前**完成一次判定，并把「请将当前规划重点聚焦于：…」注入本轮素材；空结果不追加；任何失败静默降级。

**独立测试**：桩实现返回 2 个工具概率（0.9 / 0.7）→ 走完一轮手输 → 断言：判定调用先于主模型调用、素材末段含一次固定格式提示、回答正文/工具记录/视图入口与改造前逐字一致；再分别注入"全低概率"与"超时"，断言不追加提示且回答正常。

### 实现

- [x] T018 [US1] 把 `agent-backend/src/domain/run-manager.ts` 的 `consume`（约 L350-537，含事件分派与 finally 日志）**纯搬运**到新文件 `agent-backend/src/domain/run-consume.ts`（导出 `consumeTurn(deps, run, opts, turn, userMessage, ...)`）；`run-manager.ts` 改为调用它；**不改行为、不改事件顺序、不改落盘顺序**，`run-manager*.spec.ts` 保持全绿
- [x] T019 [US1] 在 `agent-backend/src/domain/run-manager.ts` 的 `StartRunOptions` 新增 `skipIntentFocus?: boolean`、`RunManagerDeps` 新增 `intentFocus?: IntentFocusPort`（含 `decide` 与 `record`），并在 `buildPrompt` 增加 `focusPrompt` 入参透传到 `buildPromptMessages`
- [x] T020 [US1] 在 `agent-backend/src/domain/run-consume.ts` 里实现判定前置：`isIntentFocusEnabled()` → 读本轮可用工具（沿用 `runtime.availableTools` 的装配出口；为空则 `empty`）→ `laya-client.decide` → `selectActions` → `composeFocusPrompt` → 写入本轮 `systemExtra`；全程受 `timeout_ms` 约束，失败只降级
- [x] T021 [US1] 在 `agent-backend/src/domain/run-consume.ts` 补结构化日志：`intent-focus.ok` / `.empty` / `.failed`（`alert: true` + `reason` + `status`）/ `.unconfigured`（节流），字段含 `thread_id`/`agent_name`/`round_ms`/`candidates`/`actions`
- [x] T022 [US1] 新增 `agent-backend/src/server-attachments.ts`（`buildAttachments(...)` 装配 `summary` / `nextActions` / `intentFocus` 与告警节流），并改 `agent-backend/src/server.ts` 调用它（净减行数）；判定端口只经 `RunManagerDeps.intentFocus` 注入，`agent-backend/src/context.ts` **不需要改动**（路由不直接判定）
- [x] T023 [US1] 复测行数：`agent-backend/src/domain/run-manager.ts` **≤500**、`agent-backend/src/server.ts` **≤500**，结果记入本文件"验收证据"

### 测试

- [x] T024 [P] [US1] 新增 `agent-backend/tests/integration/chat-intent-focus.spec.ts`（判定链路部分）：手输触发判定且**先于**主模型调用、概率→工具组合、空结果不追加、超时降级、未配置降级、回答与 SSE 事件序列逐字不变；并断言返回的消息文本与界面载荷中**不含**聚焦提示原文（FR-012）；另断言「重新生成 / 重试本轮」（经同一发送链路重发原用户消息）**同样触发**判定，不被误判为跳过
- [x] T025 [P] [US1] 在 `agent-backend/tests/unit/run-consume.spec.ts` 覆盖：开关关闭→零调用、无可用工具→零调用且 `empty`、`skipIntentFocus` 为真时不调用（为 US2 预留判据）

**检查点**：US1 可独立演示（开启开关 → 手输 → 记录 `focused` + 素材含聚焦提示）；`agent-backend` 的 `lint`/`typecheck`/`test`/`test:integration`/`build` 全绿。

---

## Phase 4：用户故事 2 — 预置动作入口跳过聚焦（优先级：P2）

**目标**：由「下一步动作卡片」或「首屏问题实例卡片」发起的轮次，服务端可校验地跳过判定；其余发送方式照常判定。

**独立测试**：带 `skip_intent_focus: true` 发一轮 → 判定调用次数 0、记录 `disposition=skipped`（`reason` 区分两种入口）、卡片自带引导仍生效；不带该字段的手输/回车/带附件各 1 例 → 均产生判定。

### 实现

- [x] T026 [P] [US2] 在 `agent-backend/src/routes/chat.ts` 的 `messageBodySchema` 加 `skip_intent_focus: { type: 'boolean' }`，同步路由内 `body` 类型声明，并把值传入 `startRun`
- [x] T027 [P] [US2] 在 `frontend/src/api/messages.ts` 的 `SendMessageInput` 加 `skipIntentFocus?: boolean`，`buildSendMessageBody` **仅在 true 时**写 `skip_intent_focus`
- [x] T028 [P] [US2] 在 `frontend/src/composables/useChatStream.ts` 的 `send()` 载荷中透传该字段（沿用"空值省略"风格）
- [x] T029 [US2] 在 `frontend/src/composables/useChatPanel.ts` 的 `onSend` payload 加 `skipIntentFocus?` 并透传给 `chat.send`（改动 ≤6 行）
- [x] T030 [P] [US2] 在 `frontend/src/utils/next-steps.ts` 的 `nextStepSendPayload()` 返回 `skipIntentFocus: true`，并加注释指向规格 FR-043/FR-044
- [x] T031 [P] [US2] 在 `frontend/src/components/chat/ChatPanel.vue` 的 `onStarterClick` 的 `onSend` 载荷加 `skipIntentFocus: true`
- [x] T032 [P] [US2] 补前端用例：`frontend/src/api/messages.spec.ts`（含/不含该字段的 body）、`frontend/src/utils/next-steps.spec.ts`（置位）、`frontend/src/components/chat/ChatPanel.starters.spec.ts`（首屏卡片置位）
- [x] T033 [US2] 在 `agent-backend/tests/integration/chat-intent-focus.spec.ts` 增补：`skip_intent_focus: true` → 判定 0 次 + 记录 `skipped`；非布尔 → 400；未知字段仍是 400（schema 未被放宽）
- [x] T034 [US2] 复测 `frontend/src/composables/useChatPanel.ts` **≤500**、`frontend/src/components/chat/ChatPanel.vue` **≤500**

**检查点**：两个预置入口都跳过、手输照常；`frontend` 四项门禁绿。

---

## Phase 5：用户故事 3 — 管理台开关与部署生效（优先级：P2）

**目标**：数字人设计 → SOUL 出现复选框「意图聚焦」（默认未勾选）；勾选保存部署后生效，取消后消失且零调用、产物无残留键。

**独立测试**：管理台勾选 → 保存 → 断言设计态与 `SOUL.md` 产物含 `intent_focus: true`；取消 → 断言产物**无该键**且 System Prompt 逐字一致；两种产物下各跑一轮手输，断言判定分别发生 / 不发生。

### 实现

- [x] T035 [P] [US3] 在 `admin-backend/src/domain/config-center/soul-design.ts` 新增 `intent_focus?: boolean`（`emptySoulDesign` / `fromLegacySoul` 落 `false`；`normalizeSoulDesign` 用既有 `readBool` 拒绝非布尔；`renderSoulMd` **仅 true 时**写 `intent_focus: true` 到 frontmatter），改后**复测 ≤500 行**
- [x] T036 [P] [US3] 在 `admin-backend/src/domain/config-center/agent-design.ts` 的 `withSoulDefaults` 补 `intent_focus: false`（对外契约恒有该键）
- [x] T037 [P] [US3] 在 `admin-backend/tests/unit/soul-design.spec.ts` 增补：缺省 false / true 渲染出键 / false 不写键 / 非布尔 400 / 旧字符串 SOUL 升级为 false
- [x] T038 [P] [US3] 在 `admin-frontend/src/api/soul.ts` 的 `SoulDesign` 加 `intent_focus: boolean`，并在 `admin-frontend/src/constants/agent-design.ts` 的 `emptySoulDesign()` 补 `intent_focus: false`
- [x] T039 [P] [US3] 在 `admin-frontend/src/composables/useAgentDesign.ts` 的 `cloneSoul()` 显式补该字段（字段清单契约，漏则"复制数字人"丢配置）
- [x] T040 [US3] 在 `admin-frontend/src/components/agents/SoulEditor.vue` 的「是否开启下一步动作提示」之后新增复选框「意图聚焦」（原生 `<input type="checkbox">` + `<label>`，一句说明：勾选则每轮对话先做意图判定；未勾选则跳过），经既有 `patch({ intent_focus })` 上抛
- [x] T041 [P] [US3] 在 `admin-frontend/src/components/agents/SoulEditor.spec.ts` 增补：渲染存在、默认未勾选、勾选后 emit 含 `intent_focus: true`
- [x] T042 [US3] 补部署产物与组合矩阵用例（`agent-backend/tests/integration/chat-intent-focus.spec.ts`）：开/关两种 `SOUL.md` 下判定分别发生/不发生；与「下一步动作提示」开关 4 种组合互不影响；System Prompt 开/关逐字一致

**检查点**：管理台改开关 → 部署 → 运行环境行为随之变化；两侧管理端 `test:coverage` 绿。

---

## Phase 6：用户故事 4 — 记录仅留档、不入历史（优先级：P3）

**目标**：每次判定（含空结果、跳过、降级、未配置）落 `intent-focus.jsonl`；该文件**无任何运行期读取方**；聚焦内容不进历史、摘要与后续轮次素材。

**独立测试**：连跑三轮（一轮空结果、一轮由卡片跳过）→ 记录条数与轮次对应且字段完整；`history.jsonl` 与下一轮素材中均不含"请将当前规划重点聚焦于"。

### 实现

- [x] T043 [US4] 在 `agent-backend/src/domain/run-consume.ts` 里按 `decideDisposition` 的每个分支写入记录（字段见 `data-model.md §6.1`：`at`/`thread_id`/`agent_name`/`message_id`/`seq`/`input`/`input_truncated`/`disposition`/`reason`/`model`/`round_ms`/`candidates`/`truncated`/`probabilities`/`actions`/`focus_prompt`/`error`），写入失败只记 `intent-focus.record.failed`（`alert: true`）
- [x] T044 [US4] 在 `agent-backend/src/domain/intent-focus-store.ts` 落实 `compact`（临时文件 + `fs.renameSync` 原子替换）与 `seq` 恢复逻辑（启动/首写时按现有行数对齐）
- [x] T045 [US4] 在 `agent-backend/tests/unit/intent-focus-store.spec.ts` 增补：五种处置各一行、超限滚动、重命名失败保留原文件、并发不交错、`seq` 连续；并断言记录文本为中文（FR-025，用户输入与工具标识按原文保留）
- [x] T046 [US4] 在 `agent-backend/tests/integration/chat-intent-focus.spec.ts` 增补隔离用例：三轮后第 3 轮素材不含前两轮 `focus_prompt`；`history.jsonl` 无该字符串，且其中的用户消息正文与本轮输入**逐字一致**（FR-007）；摘要读取路径不触碰该文件；记录写入失败（只读目录）时回答正常
- [x] T047 [P] [US4] 在 `agent-backend/src/domain/intent-focus-store.ts` 的读侧注释与测试中断言"**无生产代码读取方**"（用 `rg` 结果作为证据记录到本文件）

**检查点**：`quickstart.md §6.3` 的两条命令（记录有内容、历史无匹配）通过。

---

## Phase 7：收尾与横切

- [x] T048 [P] 回写 `specs/001-digital-human-platform/contracts/admin-api.md`：§5 SOUL 字段表新增 `intent_focus`（布尔、可选、缺省 false）+ 拒绝式校验口径
- [x] T049 [P] 回写 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`：`SOUL.md` frontmatter 新键；`POST /api/threads/{id}/messages` 新增 `skip_intent_focus`；线程目录新增 `intent-focus.jsonl`；**显式声明** SSE / 会话详情 / `next-actions` / 数字人详情零变更（若 `specs/001-.../data-model.md` 维护 SOUL 字段表，同步一行）
- [x] T050 [P] 在 `agent-backend/vitest.config.ts` 把 `src/domain/intent-focus.ts`、`src/domain/intent-focus-store.ts`、`src/infra/laya-client.ts` 加入逐模块 80% 清单；若 `frontend/vite.config.ts` 需要，按改动文件补清单（该文件未新增模块则不动）
- [x] T051 [US1] 阈值标定：按 `quickstart.md §7` 用 `INTENT_FOCUS_THRESHOLD`（0.35/0.5/0.65）在 10 条真实输入上各跑一遍，记录入选合理性与 `round_ms` P90，把结论写入本节"验收证据"（不达标则回到 T008/T009 调整命题措辞）——**实测后已按结论改写命题形态（noul → choice），见"验收证据"与"收尾补充"**
- [x] T052 四侧门禁全量跑一遍并按 `plan.md §6` 复测行数：`agent-backend`（lint/typecheck/test/test:integration/test:coverage/build）、`frontend`、`admin-backend`、`admin-frontend`；四项复测（`run-manager.ts`/`server.ts`/`soul-design.ts`/`useChatPanel.ts`）全部 ≤500
- [x] T053 执行 `quickstart.md §6` 非交互冒烟：`/api/models`、Laya `/v1/models`、带 `skip_intent_focus` 的发送打点、历史文件不含聚焦提示；结论记入"验收证据"（该步骤**不作为测试结论**）
- [x] T054 文档一致性收口：`spec.md` 修订记录、`plan.md` 复杂度跟踪、本文件勾选状态与"验收证据"同步；确认 `.specify/feature.json` 指向 `specs/013-intent-focus`

---

## 依赖关系与执行顺序

### 阶段依赖

- **Phase 1（准备）**：无依赖，可立即开始
- **Phase 2（地基）**：依赖 Phase 1；**阻塞全部用户故事**
- **Phase 3（US1）**：依赖 Phase 2 —— 唯一能单独构成 MVP 的阶段
- **Phase 4（US2）**：依赖 Phase 3（复用同一发送链路与 `consumeTurn` 判定入口）
- **Phase 5（US3）**：依赖 Phase 2；可与 Phase 4 并行（不同侧、不同文件），端到端验收需 US1 在位
- **Phase 6（US4）**：依赖 Phase 3（记录写在判定分支里）
- **Phase 7（收尾）**：依赖所有目标故事完成

### 用户故事之间的独立可测性

| 故事 | 可独立验证的最小路径 | 与其他故事的关系 |
|---|---|---|
| US1 | 直接改 `SOUL.md` frontmatter 加 `intent_focus: true`（绕过管理台）手输一轮 | 不依赖 US2/US3/US4 |
| US2 | 桩判定断言调用次数 | 依赖 US1 的判定入口存在 |
| US3 | 管理台保存/部署 → 断言产物键与运行行为 | 不依赖 US2/US4；端到端需 US1 |
| US4 | 直接构造 `record` 调 `store.append` + 三轮隔离用例 | 依赖 US1 的分支结构 |

### 关键提醒

- **T018 与 T022 是硬门禁任务，不是可选重构**：`run-manager.ts` 539 行、`server.ts` 498 行，改完必须复测 ≤500，且抽取 MUST 为纯搬运（先跑一遍既有单测再改，改完再跑对比）。
- **T005 的优先级**：`INTENT_FOCUS_THRESHOLD` 必须**覆盖**配置块而非"二选一"，且越界即启动失败（避免线上静默用了错的灵敏度）。
- **集成测试文件被四个故事共用**：`agent-backend/tests/integration/chat-intent-focus.spec.ts` 由 T024（US1 创建）、T033（US2）、T042（US3）、T046（US4）分阶段追加。**跨故事并行时必须串行追加同一文件**，禁两人同时改它。
- **红线三条**（`plan.md §7`）：判定必须先于主模型调用且**从不重试**；记录文件**无运行期读取方**；两处拆分必须纯搬运。

---

## 并行示例

### Phase 2（地基）并行

```text
批 1（互不依赖，可同时开）：
  T004 + T005  agent-backend/src/config.ts            （同一文件，串行处理）
  T006         agent-backend/src/infra/laya-client.ts
  T008         agent-backend/src/domain/intent-focus.ts
  T010         agent-backend/src/domain/intent-focus-store.ts
  T012         agent-backend/src/domain/soul.ts
  T014         agent-backend/src/domain/prompt-builder.ts
  T016/T017    docker-compose.yml + config.example.yaml
批 2（测试，随各实现落地）：
  T007 / T009 / T011 / T013 / T015
```

### US2（跳过）并行

```text
同一批（不同文件）：
  T026  agent-backend/src/routes/chat.ts
  T027  frontend/src/api/messages.ts
  T028  frontend/src/composables/useChatStream.ts
  T030  frontend/src/utils/next-steps.ts
  T031  frontend/src/components/chat/ChatPanel.vue
串行（同文件/有依赖）：
  T029（useChatPanel.ts）→ T032（用例）→ T034（行数复测）
```

### 两侧管理端并行（US3）

```text
批 1：
  T035 admin-backend soul-design.ts ｜ T038 admin-frontend api + 常量
  T036 admin-backend agent-design.ts ｜ T039 admin-frontend useAgentDesign.ts
批 2：
  T037 / T041 各自用例 → T040 SoulEditor.vue → T042 端到端组合矩阵
```

---

## 实施策略

### MVP 优先（只做 US1）

1. Phase 1 → Phase 2 → Phase 3
2. **停下来验证**：手动给某数字人的 `SOUL.md` 加 `intent_focus: true`，手输一条与工具强相关的消息，确认记录 `focused` 且素材含聚焦提示、回答与改造前一致
3. 这一步已经能回答"意图聚焦是否让工具选择更准"这个核心问题，可先灰度

### 增量交付

1. 地基 → US1（MVP，可灰度）
2. US2（两个预置入口不重复聚焦）→ 独立验证
3. US3（管理台开关，正式上线闸门）→ 独立验证
4. US4（留档与隔离，为事后分析准备数据）→ 独立验证
5. 收尾（契约回写、覆盖率清单、标定、门禁、冒烟）

### 团队并行

- 一人：Phase 2 的配置/协议/纯函数（T004~T017 的 `.ts` 侧）
- 一人：Phase 4 的前端（T027/T028/T030/T031/T032）
- 一人：Phase 5 的管理台（T035~T041）
- 交汇点：T018（run-manager 拆分）与 T022（server 装配）必须由**同一人**完成，避免双人同时改同一文件

---

## 需求覆盖矩阵（FR/TR → 任务）

> 由 `/speckit.analyze` 首轮补齐：此前任务描述未显式引用 FR 编号，导致"需求 → 任务"无法逐条对账。
> 下表是唯一的对账口径；实现期若发现某 FR 无落点任务，MUST 先补任务再写代码。

| 需求 | 落点任务 |
|---|---|
| FR-001 判定先于主模型 | T020、T024 |
| FR-002 判定输入仅本轮输入 | T020、T024 |
| FR-003 动作 = 1~N 工具组合 | T008、T009 |
| FR-004 固定格式 + 工具英文名 | T008、T009 |
| FR-005 空结果不追加 | T020、T024 |
| FR-006 不改写 SOUL/工具权限 | T014、T015、T024 |
| FR-007 同层追加、不冒充用户消息 | T014、T015 |
| FR-008 下一步卡片跳过 + 仅留档 skipped | T025、T026、T033 |
| FR-009 有界（超时/不重试） | T004、T006、T024 |
| FR-010 每轮独立、不缓存 | T020、T024 |
| FR-011 不进历史/摘要/后续素材 | T046 |
| FR-012 界面不可见 | T024、T046 |
| FR-013 不进记忆 | T047（本仓库无记忆子系统，由"无读取方 + 不落历史"两条覆盖） |
| FR-020 线程目录独立文件 | T010、T043 |
| FR-021 记录字段完整（5 态） | T010、T043、T045 |
| FR-022 记录有界滚动 | T010、T044、T045 |
| FR-023 仅事后分析、无读取方 | T043、T046、T047 |
| FR-024 写入失败不影响对话 | T043、T046 |
| FR-025 记录中文 | T045 |
| FR-030 复选框「意图聚焦」 | T040 |
| FR-031 数字人粒度 + 默认关闭 | T035、T036 |
| FR-032 关闭零调用零记录 | T025、T042 |
| FR-033 部署生效、关闭无残留 | T035、T042 |
| FR-034 不改人格提示词 | T042 |
| FR-035 与 007 开关互不影响 | T042 |
| FR-040 跳过标记服务端可校验 | T026、T033 |
| FR-041 手输/回车/带附件照常判定 | T024、T033 |
| FR-042 标记不入消息与历史 | T026、T032、T033 |
| FR-043 首屏卡片同口径跳过 | T031、T032、T033 |
| FR-044 跳过判据覆盖全部预置入口 | T030、T031、T032 |
| FR-050 独立 Laya 服务、不回退主模型 | T004、T006、T016 |
| FR-051 配置 + 阈值环境变量优先 | T004、T005、T017 |
| FR-052 未配置/不可达 fail-closed | T004、T020、T024 |
| FR-053 唯一防腐适配器、零依赖 | T003、T006 |
| FR-054 直连、不经 MCP/不入工具清单 | T006（并见 `plan.md §2.1` 的"不加"清单） |
| FR-055 结构化决策、按阈值筛 | T008、T009 |
| FR-056 候选 ≤24、无工具不调用 | T008、T009、T020 |
| TR-01 可选配置块、密钥独立 | T004、T005 |
| TR-02 唯一纯函数实现 | T008、T009 |
| TR-03 零新增依赖、单一适配器 | T003、T006 |
| TR-04 请求字段三处同改 | T026、T027 |
| TR-05 SOUL 开关全链落地 | T035、T036、T038、T039、T040 |
| TR-06 契约四处同步 | T048、T049 |
| TR-07 行数 ≤500 + 覆盖率清单 | T023、T034、T050、T052 |
| TR-08 沿用线程目录落盘范式 | T010、T044 |

---

## 验收证据（实现期填写）

| 项 | 证据 |
|---|---|
| T001 容器核对 C1~C8 | **已完成（改为本地自建镜像）**：官方 `chaitin/decis:laya-multilingual-v0.4.0` 六个镜像站均不可得（403 / `EOF` / 证书错 / 层数据被改写），改为 `docker build -t laya-service laya-service`（源码 `chaitin/Decis` @ `969cc45` + 权重 ModelScope `convaiinnovations/laya-multilingual`）。`/healthz` → `{"status":"ok","version":"0.4.0"}` 200；`/readyz` → `{"status":"ready","engine":"laya-multilingual"}` 200；`/v1/models` → `decis/laya-multilingual@0.3.29`（`device:cpu`、`dtype:float32`，已加载）200；`POST /v1/systemone` 真实判定 164ms（2 题）/ 123~237ms（6 选项）。**体积**（同一镜像两种口径）：`docker images` **2.91GB**（未压缩磁盘占用）/ `inspect .Size` **0.88GiB**（压缩口径，十进制即 946MB）。对照官方同 tag 的 amd64 manifest 压缩总量 4.10GB（其最大一层 2.92GiB 即 CUDA 版 torch）——官方并没有更"精简"，只是口径不同。做到这一步靠两件事：① 默认装 **CPU 版 torch**（`torch==2.9.0+cpu`，实测 `nvidia/` 3.2GB + `triton` 0.9GB 全部消失，`device: cpu` 推理 198ms），CUDA 版通过 `--build-arg TORCH_SPEC/TORCH_INDEX` 随时切回，命令留在 `laya-service/Dockerfile` 与 `quickstart.md §1`；② **权重只存一份**：改用 `COPY --chown=10001:10001`，原先 `COPY` 后再 `chown -R /models` 触发 overlayfs copy-up，把 647MB 权重整份复制成第二层（+679MB） |
| T002 行数基线 | 已复测：`run-manager.ts` 539 → **343** / `server.ts` 498 → **466** / `soul-design.ts` 490 → **383**（新增字段说明后曾到 510，已外移 `soul-fields.ts` 129 / `soul-limits.ts` 38）/ `useChatPanel.ts` 486 → **434** / `ChatPanel.vue` 474 → **435**（全部 ≤500；另 `routes/chat.ts` 316、`config.ts` 419） |
| T003 依赖基线 | `git diff --stat -- '*package.json' '*package-lock.json'` 为空：四侧**零新增依赖** |
| T023 / T034 / T052 行数复测 | 同上；`chat.ts` 因新增严格校验 +32 行，仍在 500 门禁内 |
| T047 记录无读取方 | `Select-String -Path agent-backend/src/**/*.ts -Pattern "intent-focus.jsonl"` 仅命中 `src/domain/intent-focus-store.ts` 两处（文件头注释 + `filePathOf`），**生产代码零读取方** |
| T051 阈值标定 | **已完成，并据此改了命题形态**。原 `noul`（每工具一条真值命题）实测不可用：8 题并行时互不竞争，"今天北京天气" 也让 `erp__query_bom` 拿到 0.910、`read_file` 0.868，阈值 0.5/0.7/0.85 均切不开；top1 仅对 1/10，入选集合几乎全为无关工具。改为**一条 `choice`**（工具名 + `__none__` 作选项）后，同一批 10 条业务输入：top1 对 7/10、入选集合精确率 **7/8**、两条"无需工具"轮次（天气 / 写邮件）**均正确返回空**，单轮 123~248ms（远低于 SC-002 的 2s）。据此保留 `threshold=0.5`、`max_actions=3`。**同时发现**上游每题 256 token 上限：6 工具 × 120 字说明 ≈ 320 token ⇒ `422 too_long` ⇒ 整轮 `degraded`，故选项说明改为**总预算 160 字均分**（`min(40, max(6, 160/(N+1)))`） |
| T052 四侧门禁 | `agent-backend`：lint 0 / typecheck 绿 / unit **775** / integration **168** / coverage **943 且 80% 模块门禁通过（含四个新模块）** / build 绿；`frontend`：lint 0 / typecheck 绿 / coverage **1069** / build 绿；`admin-backend`：lint 0 / typecheck 绿 / coverage **637** / `check:lines`+`check:deps` 绿 / build 绿；`admin-frontend`：lint 0 / typecheck 绿 / coverage **615** / `check:lines`+`check:deps` 绿 / build 绿 |
| T053 非交互冒烟 | **已完成（真实进程 + 真实模型）**：① `GET /api/models` 200；② Laya `/v1/models` 200；③ 带 `skip_intent_focus: true` 发送（真实 DeepSeek 主模型）→ `200 text/event-stream`，事件仅 `content / tool_call / tool_call_end / done`；该数字人开关关闭 ⇒ **零判定、零留档**（`intent-focus.jsonl` 不存在），`history.jsonl` 不含聚焦提示；④ 临时打开该数字人开关后再发一条 → 留档 `disposition: focused`、`probabilities` 为真实概率（`read_skill 0.9396`）、`actions:["read_skill"]`、`round_ms: 237`，`history.jsonl`（3726B）**仍不含**聚焦提示；随后已还原 SOUL（开关复位）。⑤ 校验层：`skipIntentFocus` → 400「不支持的请求字段」、`"true"` → 400「须为布尔值」 |
| T054 文档一致性 | 已回写：`admin-api.md` §5 SOUL 字段表新增 `intent_focus`；`runtime-api-delta.md` 新增 R22 / §21（含严格校验、配置矩阵、不变式与回滚）；`contracts/intent-focus-api.md` §5.1 补齐「带路径 / 未知键 / 空串环境变量」三条口径 |

### 收尾补充（2026-10-25）

- **配置严谨化**：`config.ts` 抽出 `INTENT_FOCUS_LIMITS` / `INTENT_FOCUS_DEFAULTS`（区间与缺省单一来源）、
  `resolveEnvRef`（模型与判定模型共用 `$ENV` 解析）、四个中文报错读取器（指名 YAML 路径 + 区间 + 当前值）；
  `intent_focus` 块改为 `strict()`，拼错键即启动失败；`INTENT_FOCUS_THRESHOLD` 空串视为未设置
  （否则 `z.coerce.number` 会把它变成 `0`，全部工具入选且无任何报错）；`base_url` 带路径即拒绝
  （避免拼出 `/v1/v1/systemone`）。覆盖：`tests/unit/config.spec.ts` 新增 15 例。
- **请求体严格化**：`routes/chat.ts` 在 `preValidation` 里拒绝未知字段与非布尔 `skip_intent_focus`
  （Fastify 默认 ajv 是 `coerceTypes` + `removeAdditional`，会把 `"true"` 悄悄转成 `true`、
  把 `skipIntentFocus` 静默丢弃；对"服务端可校验的跳过标记"不可接受）。仅作用于本路由。
- **留档分支去死代码**：`decideDisposition` 改为重载（`disabled` → `null`，其余恒有结论），
  runner 不再需要 `?.` / `?? 'empty'` 这类永远走不到另一侧的防御分支；`intent-focus-runner.ts` 分支覆盖 70.58% → 通过 80% 门禁。
- **行数门禁**：`soul-design.ts` 因新增字段说明涨到 **510 行**（超 500），按职责外移两个模块——
  `soul-limits.ts`（字段上限单处定义，渲染 / 读取器 / 前端计数共用）与 `soul-fields.ts`
  （拒绝式字段读取器：`readBool` / `readPositiveInt` / `readRequiredText` / `readOptionalText` /
  `readTextList` / `truncate`）。`soul-design.ts` 保留 `export { SOUL_LIMITS }` 兼容既有导入，降至 **≈430 行**；
  `check:lines` 通过（104 文件全部 ≤500）。
- **两个存量覆盖率缺口（顺手补齐，非本特性引入）**：
  ① `admin-backend/src/domain/config-center/references.ts` 函数覆盖 77.77% → 新增
  `tests/unit/references.spec.ts`（9 例，反向查询 4 个 / 异常文案 / 影响面展开），现 100%；
  ② `frontend/src/utils/caret-rect.ts` 分支覆盖 62.96% → `caret-rect.spec.ts` 补 6 例
  （contenteditable 选区四条降级路径 + 行高兜底 + 未滚动），现 92.59%。
  两处均是"覆盖率地板只上不下"的直接落实，未改动任何生产逻辑。

- **命题形态按标定结果重写（noul → choice）**：见 T051。`buildQuestions` 现在只发**一条** `choice`，
  `criteria` 的键就是工具名 + `__none__`，响应概率以同名回传，省掉"下标 → 工具名"的对齐；
  `selectActions` 按工具名取值，`__none__` 天然不参与入选。伴随改动：`SystemOneQuestion` 改为 choice 形态、
  `laya-client` 解析 `answers[*].probabilities`（保留 `noul` 标量兼容）。
- **题面 token 预算**：`QUESTION_CHAR_BUDGET=160`、单条 `6~40` 字，按 `N+1`（含 `__none__`）均分；
  新增用例断言"24 个候选时整条命题 ≤ 240 字"。不重试（FR-009）。
- **HTTP 失败可诊断**：`laya-client` 在非 2xx 时把响应体摘要（≤200 字）并入 `message`，
  runner 的 `intent-focus.failed` 告警新增 `detail` 字段——422 这类 schema 拒绝只看状态码无法定位（本次即由此发现 256 token 上限）。
- **部署改为自建镜像**：`docker-compose.yml` 的 `laya` 服务由 `image: chaitin/decis:...` 改为
  `build: ./laya-service` + `image: laya-service`；`laya-service/Dockerfile` 与 `laya-service/models/`（614MB 权重）
  入仓但 `.gitignore` 已排除 `laya-service/upstream/` 与 `laya-service/models/`。

### 复现（本机已验证，2026-10-25）

```powershell
# 1) 构建（源码在 laya-service/upstream，权重在 laya-service/models/laya-multilingual）
docker build -t laya-service laya-service

# 2) 起服务（8103 → 容器 8000；DECIS_API_KEY 必须与 config.yaml 的 intent_focus.api_key 一致）
docker run -d --name optagent-laya -p 8103:8000 -e DECIS_API_KEY=dev-laya-key \
  -e DECIS_SHUTDOWN_GRACE_MS=25000 --memory 6g laya-service

# 3) 打点
curl.exe -s http://127.0.0.1:8103/healthz
curl.exe -s http://127.0.0.1:8103/readyz
curl.exe -s -H "Authorization: Bearer dev-laya-key" http://127.0.0.1:8103/v1/models

# 4) backend 侧（config.yaml 已含 intent_focus 块；.env.local 需含 DECIS_API_KEY）
cd agent-backend; npm run build; npm start
```

## 收尾补充（2026-10-26）

- **命题形态回到 `noul`**：每个候选工具一条（"本轮用户发起的任务是否需要使用 X ？" + 判据 `需要/不需要`），
  阈值 **0.6**、入选**不设条数上限**；聚焦提示改为软措辞「本轮可优先考虑以下工具（仅供参考，不必局限）：…」
  （本功能是增强而非限制）。三套措辞的对照实测与取舍见 `spec.md` 2026-10-26 修订记录。
- **`guidance` 与聚焦提示不共存**：`guidance` 非空白时由域层（`run-consume`）归一为跳过，
  不依赖调用方是否带 `skip_intent_focus`（补齐"调用方漏传"与"显式 false"两种情况）。
- **失败归因可读**：全批失败时留档 `reason` 记根因（`timeout` / `http_503`；多因归一才退回 `all_batches_failed`），
  `error` 仍保留 `batch_0:http:503` 明细。
- **标定脚本重写**：原 choice 版 API 已不存在（`NO_TOOL_OPTION` / `probabilities` / `maxActions`），
  改为 noul 口径并支持措辞 A/B：

  ```powershell
  cd agent-backend; npm run build
  node scripts/calibrate-intent-focus.mjs --prompt all --threshold 0.6
  ```

  `current` / `hybrid` / `proposed` 三套措辞在同一批 10 条业务输入上对照，打印
  top1 命中 / 入选精确率 / 召回 / "无工具"判断 / 误选最高分 / 平均耗时。
