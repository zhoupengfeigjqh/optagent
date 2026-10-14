# 007 实施计划：下一步动作提示卡片

- **特性标识**：`007-next-action-hints`
- **计划日期**：2026-10-12
- **规格**：[spec.md](./spec.md)（三项待澄清已收敛：引导句由界面固定渲染；仅展示最新一轮且该轮持久保留；隐藏工具引导与问题实例完全一致）
- **影响范围**：`agent-backend`、`frontend`、`admin-backend`、`admin-frontend`（四侧，宪章原则七）
- **技术栈**：沿用四侧既有栈（Node ≥20 / TS 6 / Fastify 5 / Vue 3.5 + Vite），**零新增第三方依赖**（宪章原则六）
- **门禁**：本地执行（宪章原则三/八），容器不参与
- **设计产物**：[research.md](./research.md)（D1~D12 决策与被否决方案）、[data-model.md](./data-model.md)、[contracts/next-actions-api.md](./contracts/next-actions-api.md)、[quickstart.md](./quickstart.md)

---

## 概要（Summary）

每轮对话成功结束后，运行环境用**一次独立的、不阻塞的** LLM 调用，基于「本轮用户输入 + 本轮回答 + 本轮已调用工具 + 当前数字人全部可用工具」产出 **0~3 条**中文下一步动作提示（每条 ≤50 字、不含工具英文名），连同**不展示**的关联工具引用写入该会话的**单份快照**（`next-actions.json`，每轮覆盖）。

聊天前台在该轮完成后（有界拉取，窗口覆盖生成超时上限）把卡片渲染在**回答正文之后**（与工具调用记录、视图入口同层的侧车位置），并在卡片上方显示**由界面固定渲染**的引导句"您接下来可以操作以下动作，请选择"；点击卡片 → 二次确认弹窗 → 复用既有发送链路发起下一轮，并把卡片关联工具作为**隐藏引导**注入本轮（与首页问题实例同一通道、同一文案、同一发送载荷）。

管理台在数字人 SOUL 配置内提供开关「是否开启下一步动作提示」（默认关闭）；关闭时该数字人既不生成也不展示，且**已持久化的快照在读取期被判定为不展示**。任何生成失败一律静默降级为"本轮无建议"。

---

## 技术上下文（Technical Context）

**Language/Version**：后端 Node ≥ 20 + TypeScript 6（ESM，`tsc` 直出）；前端 Vue 3.5 + TypeScript 6 + Vite 8（`vue-tsc`）

**Primary Dependencies**：后端 Fastify 5 / `zod` / `yaml` / `pino`；前端 Vue 3 + **既有** `ant-design-vue` / `tailwindcss` / `@vueuse/core` / `pinia` / `axios` / `dayjs`，卡片与弹窗仍以原生 `<dialog>` / `<button>` + 自有 CSS 变量为基座（`ant-design-vue` 与 Tailwind 的存在正是"`ConfirmDialog` 不居中"这一存量缺陷的根因，见「复杂度跟踪」）。**本次零新增依赖**（卡片、弹窗、拉取、JSON 解析全部用平台原生能力与既有实现）

**Storage**：文件系统（与 `summary.json` 同族）
`users/{uid}/user-data/threads/{tid}/next-actions.json` —— 会话级**单份**快照，临时文件 + `fs.renameSync` 原子替换；随会话目录一并删除

**Testing**：Vitest 5。后端 `tests/unit`（纯逻辑）+ `tests/integration`（端点）；前端与源码同目录 `*.spec.ts`；**不得依赖真实外部 LLM**（一律桩）

**Target Platform**：交付 Linux 容器（gateway → nginx 托管静态资源 + Node 服务）；开发/本地测试 Windows 宿主机。两者差异见「复杂度跟踪」

**Project Type**：四侧一体的 Web 产品（运行侧 `agent-backend` + `frontend`，管理侧 `admin-backend` + `admin-frontend`）

**Performance Goals**：
- 新增端点 `GET /api/threads/{id}/next-actions` **P95 ≤ 500ms**（宪章原则五，需计时验证并记录口径）；
- 生成**不进入主链路**：回答的流式与 `done` 不因本功能延迟（FR-007）；
- 非推理类交互（点击卡片、弹窗）反馈 ≤ 100ms；卡片渲染不引入布局跳变（无卡片时不渲染任何容器）

**Constraints**：单文件 ≤500 行（**硬门禁**，见「复杂度跟踪」）；新增模块覆盖率 ≥80%；全局覆盖地板只上不下；零新增依赖；提示词全中文；平台 → 运行环境单向且以数字人为单位整体覆盖

**Scale/Scope**：单用户工作台；每轮 0~3 张卡片；每会话一份快照（存储有界）；拉取窗口 4 次、生成超时 5s

---

## 宪章检查（Constitution Check）

*门禁：Phase 0 研究之前 MUST 通过；Phase 1 设计之后复核。*

### 逐条核对（v2.2.0，九条原则）

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 本目录四件套 + 契约文档全中文；进入实现前规格已收敛 |
| 二 代码质量与模块化边界 | **通过（含必要拆分）** | 新增模块单一职责；`run-manager.ts` 存量 532 行、本次必然触及 ⇒ **按硬门禁拆分**（D13）；不新增第二套卡片视觉（共用 `SuggestionCard.vue`）、不新增第二套合规判据（唯一纯函数） |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 新端点有集成测试；域逻辑单测；每个新组件/新 composable/新纯函数模块各有同名 spec；新增模块 ≥80%；**测试全部本地执行**；平台差异（原子改名）在复杂度跟踪登记 |
| 四 无障碍与可用性 | **通过** | 卡片为原生 `<button>`（`Tab`/`Enter`/`Space`）、列表容器有语义标签、焦点可见；确认弹窗复用既有 `ConfirmDialog`（原生 `<dialog>`，含焦点陷阱与 `Esc`）；动效随 `prefers-reduced-motion` 降级 |
| 五 性能与数据一致性 | **通过** | 新端点做 P95 计时；不引入 N+1；生成不进渲染路径；派生结果用 `computed`；快照写入为**原子替换**（MUST NOT 部分提交）；并发写入经 per-thread 串行链（D6） |
| 六 技术治理与依赖控制 | **通过** | **零新增依赖**；复用原生 `<dialog>`/`<button>`/既有 CSS 变量/既有发送链路 |
| 七 接口契约与前后端一致性 | **通过** | 新端点四处同步（契约文档 / 前端类型 / 后端 schema / 测试）；错误码复用既有 `THREAD_NOT_FOUND`；不硬编码后端下发值 |
| 八 测试与部署的简单可控 | **通过** | 四侧各自一条命令跑门禁；门禁从当前源码重建；容器只做部署；`quickstart.md` 给非交互冒烟（HTTP 打点） |
| 九 优雅降级与故障可观测 | **通过** | 四类失败（调用失败/超时/非法输出/工具清单不可用）静默降级为"0 条"且用户无感；原始错误进结构化日志（`alert: true` + `event`）；超时有界（5s、不重试）；拉取有界（4 次）；降级路径均有测试 |

**门禁判定：PASS，无宪章例外**（`Complexity Tracking` 中登记的是风险与既有存量状态，不是对原则的豁免）。

### Phase 1 设计之后复核

复核结论与上表一致，无新增冲突：

- 设计没有扩大契约面（SSE 与详情接口显式零变更，只新增一个只读轻量端点）；
- 设计没有触碰 535 行的存量超限文件 `useChatStream.ts`（状态落在新 composable，挂钩点用既有 `onTurnFinished`）；
- 开关经 `SOUL.md` frontmatter 承载，天然保证"不进 System Prompt"与"关闭态部署无残留"，未新增配置文件形态。

---

## 项目结构（Project Structure）

### 文档（本特性）

```text
specs/007-next-action-hints/
├── spec.md                        # 已产出（/speckit.specify）
├── plan.md                        # 本文件（/speckit.plan）
├── research.md                    # Phase 0：决策 D1~D12 与被否决方案
├── data-model.md                  # Phase 1：五段形状（设计态→物化→运行态→接口→前端类型）
├── contracts/
│   └── next-actions-api.md        # Phase 1：本特性契约增量（须回写 specs/001 的两份契约）
├── quickstart.md                  # Phase 1：门禁命令、端到端场景、非交互冒烟
├── checklists/requirements.md     # 规格质量检查表
└── tasks.md                       # Phase 2 产出（/speckit.tasks，不在本命令范围）
```

### 源码（仓库实际布局）

```text
agent-backend/
├── src/domain/
│   ├── next-actions.ts            # 新增：生成 + 解析 + 合规校验 + 快照读写 + 开关判定
│   ├── run-finalize.ts            # 新增：从 run-manager 拆出的轮次收尾（纯搬运 + 本特性的生成触发）
│   ├── run-manager.ts             # 修改：deps 字段、run 开始清空、runtime 槽位、调用收尾
│   ├── soul.ts                    # 修改：SoulMeta.nextActionHints + isNextActionsEnabled
│   ├── run-impl.ts                # 修改：calledTools
│   └── (summary.ts 为同构范式，不改)
├── src/infra/agent-factory.ts     # 修改：装配完工具后写 runtime.availableTools
├── src/routes/threads.ts          # 修改：新增 GET /api/threads/:id/next-actions
├── src/context.ts / src/server.ts # 修改：装配与注入 NextActionsStore
├── vitest.config.ts               # 修改：新增模块进入逐模块 80% 清单
└── tests/{unit,integration}/      # 新增 next-actions.spec.ts（单测 + 端点集成测试）

frontend/
├── src/api/threads.ts             # 修改：ThreadsApi.nextSteps + ThreadNextSteps 类型（放此处，避开已 488 行的 types.ts）
├── src/api/next-steps.ts          # 新增：只读拉取封装
├── src/utils/next-steps.ts        # 新增：拉取窗口常量、可见性派生、发送载荷派生（纯函数）
├── src/composables/useNextSteps.ts# 新增：store（拉取窗口 + 过期响应丢弃）+ useNextSteps() 注入访问器
├── src/composables/useAppSession.ts# 修改：装配并 provide nextSteps；onTurnFinished 追加一次拉取
├── src/components/chat/
│   ├── SuggestionCard.vue         # 新增：卡片按钮（首页问题实例与消息尾部共用）
│   ├── MessageNextSteps.vue       # 新增：回答正文之后的侧车容器（引导句 + 卡片列表）
│   ├── MessageBubble.vue          # 修改：新 prop + 渲染位置 + send-suggestion 事件
│   ├── MessageList.vue            # 修改：透传 prop 与事件（仅 message_id 匹配的那条）
│   └── ChatPanel.vue              # 修改：hero 复用 SuggestionCard；确认弹窗与点击发送
└── vite.config.ts                 # 修改：utils/next-steps.ts 进入逐文件 80% 清单

admin-backend/
├── src/domain/config-center/soul-design.ts   # 修改：SoulDesign 字段 + readBool + renderSoulMd 键
└── tests/unit/soul-design.spec.ts            # 修改：补用例

admin-frontend/
├── src/api/soul.ts                       # 修改：SoulDesign 字段
├── src/constants/agent-design.ts         # 修改：emptySoulDesign() 初值
├── src/composables/useAgentDesign.ts     # 修改：cloneSoul 深拷贝
└── src/components/agents/SoulEditor.vue  # 修改：新增开关（原生 checkbox）

specs/001-digital-human-platform/contracts/
├── admin-api.md                   # 修改：§5 SOUL 字段表新增 next_action_hints + 校验口径
└── runtime-api-delta.md           # 修改：SOUL frontmatter 新键 + 新端点契约
```

### 结构决策（Structure Decision）

- **保持四侧既有分层**，不引入新目录：后端 `routes → domain → infra`（新增 `domain/next-actions.ts` 属业务层，工具清单由 infra 装配期经请求出口传入，域层**不反查** infra）；前端 `components → composables → api`（新增 `api` + `utils` + `composables` + 组件各一）。
- **状态归属**：卡片状态放新 composable 并在 `useAppSession` 装配（与既有 store 同族），因为 `useChatStream.ts` 已 535 行（存量超限），**MUST NOT** 在其中新增代码。
- **共用而非复制**：卡片视觉抽 `SuggestionCard.vue` 供首页问题实例与消息尾部共用；合规判定与引导文案各自只有一处实现。

---

## 1. 技术决策（D1~D13）

D1~D12 的完整决策、理由与被否决替代方案见 **[research.md](./research.md)**（摘要：D1 轮末独立一次 LLM 调用 / D2 严格 JSON / D3 工具清单复用 `runWith` 装配结果 / D4 已调用工具取 `run.calledTools` / D5 会话单快照 + 原子改名 / D6 `clear` 与 `trigger` 同链 / D7 轻量端点 + 有界拉取 / D8 服务端开关判定 + 客户端 `message_id` 兜底 / D9 合规判据唯一纯函数 / D10 3 条上限 + 5s 超时 + 静默 / D11 开关落 SOUL frontmatter / D12 前端新模块 + `onTurnFinished` 挂钩）。

### D13 拆分 `run-manager.ts`（硬门禁要求，非可选）

- **现状**：`agent-backend/src/domain/run-manager.ts` 实测 **532 行**，**存量已超**"单文件 ≤500 行"硬门禁；本次必然触及该文件（新增 deps 字段、run 开始清空、runtime 槽位、调用收尾），按 006 已确立的口径「原则二是"不得新增或保留"，配合治理"不追溯"＝**触及即拆**」——该**口径本身未回滚**（006 的 2026-10-12 回滚只涉及其它区域的文件与拆分产物），故本次 MUST 一并拆到线下。
- **决策**：把**轮次收尾家族**（`finalizeDone` / `finalizeError` / `finalizeAborted` / `recordUsage`，约 127 行）抽到新模块 `domain/run-finalize.ts`，以最小依赖接口注入（`history` / `usage` / `toolEvents` / `summary` / `nextActions` / `logger` / `now`）；`run-manager.ts` 只保留编排（配额、`startRun`、`consume`、`buildPrompt`）。
- **理由**：① 满足硬门禁并留出可演进余量（预计 532 → ~425，再加本特性新增 ≈ +20）；② "轮次收尾"本身就是内聚的单一职责（落盘 + 广播 + 记账 + 附加能力触发），抽出后 `run-manager` 只做编排；③ 本特性要改的正是 `finalizeDone`，改动落在新模块里更清晰。
- **约束**：抽取 MUST 是**纯搬运**（逐字移动，不改行为、不改事件顺序、不改落盘顺序）；既有 `run-manager-*.spec.ts` MUST 保持全绿（若个别用例直接依赖内部方法，只调整其导入路径，MUST NOT 改断言口径）。

---

## 2. 被否决的替代方案

见 [research.md §2](./research.md)（共 11 项，含：把卡片塞进主回答同一次调用、`done` 前 `await` 生成、SSE 保持连接补推、只拉一次、走详情接口下发、域层自行枚举 MCP 工具、Markdown 承载工具引用、历史轮追加落盘、引入组件/解析库、开关独立配置文件）。**结论：无一项优于选定方案**，其中"`done` 前 `await` 生成"与"塞进主回答同一次调用"直接违反 FR-007。

---

## 3. 文件级改动

> 行数为**实测基线**（2026-10-12，`.NET ReadAllLines`）。带 ⚠️ 的文件为存量超限/贴近上限，改动后 MUST 复测。

### 3.1 `agent-backend`

**新增**

| 文件 | 职责 | 预估行数 |
|---|---|---|
| `src/domain/next-actions.ts` | 生成（systemPrompt 组装 + `streamChat` 收集 + 超时）、输出解析（容错 JSON）、合规与工具引用校验（纯函数）、快照读写（原子替换）、读取期**双判据**（归属数字人开关为开 + 归属数字人 = 当前选中数字人，见 FR-019/FR-034） | ~270（含注释与类型） |
| `src/domain/run-finalize.ts` | 轮次收尾：`finalizeDone`（含触发生成）/ `finalizeError` / `finalizeAborted` / `recordUsage`（纯搬运 + 生成触发） | ~135 |
| `tests/unit/next-actions.spec.ts` | 生成/解析/合规/工具过滤/超时/静默/覆盖写/清空顺序 | — |
| `tests/integration/next-actions.spec.ts` | 新端点：命中 / 空 / 开关关闭 / 无快照 / 损坏 / 隔离 / 404 / 时延 | — |

**修改**

| 文件 | 基线行数 | 改动 | 位置 |
|---|---|---|---|
| `src/domain/run-manager.ts` ⚠️ | **532** | `AgentRunRequest` 新增 `runtime?: RunRuntime`（可用工具出口）；`RunManagerDeps` 新增 `nextActions?`；`startRun` 加一行 `clear`；`consume` 装配 `runtime` 并传入 `agent.run`、`tool_call_start` 累积 `run.calledTools`；收尾家族改为调用 `run-finalize`（**净减约 107 行**） | L30-48 / L84-101 / L234-257 / L277-403 |
| `src/domain/run-impl.ts` | 71 | 新增 `calledTools: Set<string>` | 底部类型定义处 |
| `src/infra/agent-factory.ts` | 306 | 装配完 `tools` 后写 `req.runtime.availableTools = tools.map(t => ({ name: t.name, description: t.description ?? '' }))`（**唯一工具清单来源**） | L222 之后、L224 之前 |
| `src/domain/soul.ts` | 132 | `SoulMeta.nextActionHints`；`parseSoulMeta` 读 `next_action_hints`（非布尔/缺失 → `false`）；新增 `isNextActionsEnabled(root,userId,agentName)`（fail-closed） | 类型区 + `parseSoulMeta` |
| `src/routes/threads.ts` | 192 | 新增 `GET /api/threads/:id/next-actions`（`threadStore.get` 404 → 读快照 → **双判据**：归属数字人开关为开 ∧ 归属数字人 = `ctx.currentAgent.current(userId)` → 序列化；四类空态一律 200 空） | 文件末尾 |
| `src/context.ts` | 35 | `AppContext` 新增 `nextActions: NextActionsStore` | store 列表 |
| `src/server.ts` | 380 | 用**已存在的** `llm()` 惰性单例装配 `NextActionsStore`（日志用 `{ alert: true, event: 'next-actions.failed', scope: 'system' }`）；注入 `RunManager`；填入 context | L114-123 附近 / L219-241 / L243-255 |
| `vitest.config.ts` | — | 逐模块 80% 清单追加 `src/domain/next-actions.ts`、`src/domain/run-finalize.ts` | 清单末尾 |

**不加**：`summary.ts`（同构范式，仅作参照）、`prompt-builder.ts`（生成不走主链路，无需注入 prompt）、`run-events.ts`（SSE 零变更）、`agent-catalog.ts`（不在数字人详情里暴露开关）。

### 3.2 `frontend`

**新增**

| 文件 | 职责 |
|---|---|
| `src/api/next-steps.ts` | `fetchThreadNextSteps(threadId)`（复用 `api/http.ts`；**只读**，失败即空） |
| `src/utils/next-steps.ts` + `.spec.ts` | `NEXT_STEPS_PULL_DELAYS_MS = [0, 1500, 3500, 6000]`（**末次 MUST 晚于生成超时 5s**）、`visibleActions(steps, messageId)`（纯函数：仅 id 匹配时返回）、`nextStepSendPayload(action)`（与首页问题实例**同一**发送载荷形状） |
| `src/composables/useNextSteps.ts` + `.spec.ts` | `createNextStepsStore`（拉取窗口、单次命中即停、过期响应丢弃、切会话重置）+ `useNextSteps()` 注入访问器 |
| `src/components/chat/SuggestionCard.vue` + `.spec.ts` | 卡片按钮（`props: text` / `disabled`；`emit: select`；`data-test` 由使用方传入） |
| `src/components/chat/MessageNextSteps.vue` + `.spec.ts` | 侧车容器：固定引导句"您接下来可以操作以下动作，请选择" + 卡片列表；**无卡片时整块不渲染**；无障碍（列表语义 + 键盘） |
| `src/components/chat/MessageBubble.nextSteps.spec.ts`、`ChatPanel.nextSteps.spec.ts` | 接入回归（位置在正文之后；点击 → 弹窗 → 取消不发 / 确认发送） |

**修改**

| 文件 | 基线行数 | 改动 |
|---|---|---|
| `src/api/threads.ts` | 105 | 新增 `ThreadsApi.nextSteps()` 与 `ThreadNextSteps` 类型（**放此处**，避开已 488 行的 `api/types.ts`；`actions` 复用既有 `AgentStarter`） |
| `src/composables/useAppSession.ts` | 253 | 装配 `nextSteps` store；`onTurnFinished` 由 `() => threads.refresh()` 改为"刷新会话 + 启动一次拉取窗口"；`AppSession` 暴露 `nextSteps` |
| `src/components/chat/MessageBubble.vue` | 344 | 新增 prop `nextSteps?` 与 emit `send-suggestion`；在 `MessageViewLinks` **之后**渲染 `<MessageNextSteps>`（正文/工具/视图入口均不动） |
| `src/components/chat/MessageList.vue` | 344 | 新增 prop `nextSteps?`；仅对 `message.id === nextSteps.message_id` 的那条透传；透传 `send-suggestion` |
| `src/components/chat/ChatPanel.vue` | 403 | hero 卡片改用 `SuggestionCard`；新增 `ConfirmDialog`（`confirmLabel="发送"`）与 `onPickNextStep`（复用 `onSend`，含 `guidance`） |
| `src/components/chat/ChatPanel.starters.spec.ts` | — | 若 hero 结构/类名随 `SuggestionCard` 变动则同步断言（**MUST NOT** 放宽带 `chat-starter-*` 的既有语义） |
| `vite.config.ts` | — | `src/utils/next-steps.ts` 追加进逐文件 80% 清单；地板**只上不下** |

**不加**：`useChatStream.ts`（**535 行，存量超限**，本特性 MUST NOT 在其中新增代码；挂钩点用既有 `onTurnFinished`）、`api/types.ts`（488 行）、`MessageViewLinks.vue`、`ConfirmDialog.vue`/`BaseDialog.vue`（复用，不改）。

**存量缺陷——已修复（2026-10-13 更新）**：`ConfirmDialog` / `BaseDialog` 的原生 `<dialog>` 曾因 Tailwind preflight 的 `* { margin: 0 }` 覆盖了 UA 的 `dialog { margin: auto }` 而不居中（贴视口左上角）。该缺陷**先于本特性存在**，已于 2026-10-13 按"独立一行修复 + 单独登记"的口径处理完毕：`frontend/src/components/common/BaseDialog.vue` 的 `.base-dialog` 补 `margin: auto`，并把数字人面板 `frontend/src/components/chat/AgentPanel.vue` 由 `a-modal` 改回 `BaseDialog`，统一弹窗体系与居中口径（全量前端单测 613 通过）。**该修复不属本特性（007）的交付判定范围**。

### 3.3 `admin-backend`

| 文件 | 基线行数 | 改动 |
|---|---|---|
| `src/domain/config-center/soul-design.ts` | 391 | `SoulDesign` 新增 `next_action_hints: boolean`；`emptySoulDesign()` / `fromLegacySoul()` 落 `false`；`normalizeSoulDesign` 新增 `readBool`（缺省 `false`，非布尔 → 报错）；`renderSoulMd` **仅 true 时**写 `next_action_hints: true`；`isSoulDesign` 同步（不得把新字段判为非法） |
| `tests/unit/soul-design.spec.ts` | — | 补：缺省 false / true 渲染出键 / false 不写键 / 非布尔拒绝 / 旧字符串 soul 升级为 false |

**不加**：`agent-design.ts`（字段在 SOUL 内，随 `normalizeSoulDesign` 走）、`deploy/materialize.ts`（`renderSoulMd` 已覆盖，产物仍只有 `SOUL.md`）。

### 3.4 `admin-frontend`

| 文件 | 基线行数 | 改动 |
|---|---|---|
| `src/api/soul.ts` | 36 | `SoulDesign` 新增 `next_action_hints: boolean` |
| `src/constants/agent-design.ts` | 70 | `emptySoulDesign()` 补 `next_action_hints: false`（**必须**，否则脏检查与深拷贝会漏字段） |
| `src/composables/useAgentDesign.ts` | 200 | `cloneSoul` 补该字段 |
| `src/components/agents/SoulEditor.vue` | 205 | 在"快速上手"区之后新增开关（原生 `<input type="checkbox">`，沿用 `ScenarioFieldDialog` 的布尔范例），label 固定为「是否开启下一步动作提示」，附一句说明（关闭则部署后该功能消失）；经既有 `patch({ next_action_hints })` 上抛 |
| `src/components/agents/SoulEditor.spec.ts` | — | 补：渲染开关 / 默认关 / 勾选后 emit 含 true |

### 3.5 契约文档

| 文件 | 改动 |
|---|---|
| `specs/001-digital-human-platform/contracts/admin-api.md` | §5 SOUL 字段表新增 `next_action_hints`（布尔，可选，缺省 `false`）+ 拒绝式校验口径 |
| `specs/001-digital-human-platform/contracts/runtime-api-delta.md` | `SOUL.md` frontmatter 新键 `next_action_hints`（仅 true 时写）；新增 `GET /api/threads/{id}/next-actions` 契约与错误码；显式声明 SSE 与 `GET /api/threads/{id}` **零变更** |
| `specs/007-next-action-hints/contracts/next-actions-api.md` | 已产出；上述两处落地后 MUST 与其一致 |
| `specs/001-digital-human-platform/data-model.md` | 设计态 SOUL 字段表同步（若该文件维护字段表） |

---

## 4. 分期（每期独立可验收）

| 期 | 内容 | 验收（本地） |
|---|---|---|
| **P1 运行环境：生成与存储** | `next-actions.ts`（生成/解析/合规/快照/开关判定）+ `soul.ts` 读取 + `run-impl.calledTools` + `run-manager` 接线 + **`run-finalize.ts` 拆分** + `agent-factory` 工具出口 + `vitest.config.ts` 清单 | 单测全绿（含 0/1/3/4 条、50/51 字、含工具名、越界引用、非法 JSON、超时、覆盖写、清空顺序）；`run-manager*.spec.ts` 保持全绿；`next-actions.ts` / `run-finalize.ts` ≥80%；`run-manager.ts` 复测 ≤500；`lint`/`typecheck`/`build` 绿 |
| **P2 下发端点与契约** | `routes/threads.ts` 新端点 + `context.ts`/`server.ts` 装配 + 契约文档两处回写 + 集成测试 | 集成测试覆盖 §1.4 全部场景；P95 计时记录；`test:integration` 绿 |
| **P3 管理台开关** | `admin-backend`（字段/校验/渲染）+ `admin-frontend`（开关控件/初值/深拷贝）+ `admin-api.md` 同步 + 两侧测试 | 两侧 `test:coverage` 绿；渲染产物快照：开 → 有键、关 → 无键；旧设计态/旧字符串 SOUL 读取为 `false`；System Prompt 开/关逐字一致（FR-035） |
| **P4 聊天前台展示与点击** | `api` + `utils` + `composables/useNextSteps` + `useAppSession` 接线 + `SuggestionCard`/`MessageNextSteps` + `MessageBubble`/`MessageList`/`ChatPanel` + `vite.config.ts` 清单 | 组件/组合式测试绿（位置在正文之后、无卡片不渲染、确认弹窗取消不发、确认后复用既有发送、`prefers-reduced-motion` 无动效）；`frontend` 四项门禁绿；`quickstart.md` 的 S1~S7 场景通过 |

**依赖顺序**：P1 → P2 →（P3 可与 P2 并行）→ P4。P4 的端到端验证依赖 P1~P3 全部完成。

---

## 5. 复杂度跟踪（Complexity Tracking）

| 项 | 登记 |
|---|---|
| **宪章例外** | **无**。九条原则逐条通过（见「宪章检查」）。 |
| **平台相关行为差异（Windows 本地 / Linux 容器）** | **有，必须登记**：快照落盘走"临时文件 + `fs.renameSync` 原子替换"。POSIX 上覆盖改名原子；Windows 上 Node 走 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` 亦为替换语义，但目标文件被杀软/索引器短暂占用时可能 `EPERM`。**被否决的更简方案**：直接 `writeFileSync` 覆盖 —— 存在"写了半个文件就被读到"的窗口（脏 JSON），违反原则五"MUST NOT 部分提交"，故不采用。**处置**：写失败 → 保留旧快照 + 告警（降级），MUST NOT 抛错；读取侧对脏/超长文件一律按"无快照"处理，故最坏结果为"本轮无建议"。 |
| **每轮一次额外模型调用（成本与尾延迟）** | 已登记：生成使用默认模型、超时 5s、不重试、不阻塞 `done`；关闭开关时**不发起**该调用（SC-007 用测试守住）。 |
| **前端拉取窗口与生成超时的耦合** | 已登记：`NEXT_STEPS_PULL_DELAYS_MS` 的末次（6000ms）MUST 大于生成超时（5000ms），两者是**同一约束的两端**；实现中 MUST 用注释交叉引用，并有单测断言该不变量（防止后人只改一边）。 |
| **存量超限文件（本次处置）** | `agent-backend/src/domain/run-manager.ts`（**实测 532 行**，存量超限且本次必然触及 ⇒ **本次拆分**，见 D13；拆分后复测 ≤500）。 |
| **存量超限文件（本次不处置）** | `frontend/src/composables/useChatStream.ts`（**实测 535 行**，存量超限）。按治理"不回溯"条款不处置；**本特性 MUST NOT 在其中新增代码**（D12 的动因即此，挂钩点改在 `useAppSession` 的 `onTurnFinished`）。 |
| **贴近上限的文件（本次需盯）** | `frontend/src/api/types.ts`（488 行 → **本次不新增代码**，新类型落 `api/threads.ts`）；`frontend/src/components/chat/ChatPanel.vue`（403 → 预计 +~30，MUST 复测）；`admin-backend/.../soul-design.ts`（391 → +~10）。 |
| **新增配置形态** | **无**：开关并入既有 SOUL 结构化配置，不新增配置文件名；产物仍只有 `SOUL.md`（`TOOL.json` / `MCP.json` / `scenario.json` 不变）。 |
| **契约面控制（本次决定）** | `POST /api/threads/{id}/messages` 的 SSE 与 `GET /api/threads/{id}` **显式零变更**；只新增一个只读端点，并把"降级一律 200 + 空"写入契约（避免错误态污染聊天界面）。该决定登记在 `contracts/next-actions-api.md` §2。 |
| **跨数字人越权（analyze C1，必须守住）** | 会话**不绑定**数字人、可跨数字人（既有 FR-014 修订），而 `guidance` 由**发送端**铸造、接收端 `run-manager` 原样注入且**不校验** ⇒ 若只按"快照存在 + 归属数字人开关为开"下发，就存在"用 A 的卡片把 A 的工具名注入 B 的一轮"的真实路径。**处置**：下发前加第二判据「归属数字人 = 当前选中数字人」（FR-019 / SC-011）。该判据**只能在读取期**做（点击与发送之间服务端没有介入机会），故 MUST NOT 省略、MUST 有集成用例。 |
| **存储形态（本次决定）** | **不写"空快照"**：快照存在即代表"有建议"；开场 `clear` + 仅在产出 ≥1 条时写入，使「产出 0 条」「开关关闭」「生成失败」「关闭后重新部署」四种情形在存储层收敛为"文件不存在"，读取与端点因此无需分支。相应地，契约里不存在"`message_id` 非空但 `actions: []`"的下发形态。 |
| **已知存量观察（不在本次范围）** | `admin-backend` 等子项目的 `package.json` 中 `description` 字段含非法 UTF-8 字节（实测 `"…（Fastify 5 + TypeScript�?,"`），会导致 `ConvertFrom-Json` 一类解析失败。**单独登记、MUST NOT 混入本特性**。 |
| **已知存量缺陷（不在本次范围）** | `BaseDialog`/`ConfirmDialog` 原生 `<dialog>` 不居中（Tailwind preflight 覆盖 UA 的 `margin: auto`）；用户此前明确"先记一下、先不改"。本特性复用该组件，**不修**、不纳入交付判定；若验收期用户要求修复，按独立一行修复单独登记。 |

---

## 6. 门禁（本地单命令，宪章原则八）

```powershell
cd agent-backend;  npm run lint; npm run typecheck; npm run test:coverage; npm run test:integration; npm run build
cd frontend;       npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-backend;  npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build
```

**硬门禁三项**：新增模块覆盖率 ≥80%（且全局地板只上不下）；单文件 ≤500 行；依赖清单无未记录新增。

- 覆盖率与依赖清单一律由既有脚本核对：`admin-backend` / `admin-frontend` 有 `check:lines` 与 `check:deps`；`agent-backend` / `frontend` **既有即无这两个脚本**（本特性的合规门禁项为"类型检查 / `test` / `build` / `lint`"，两侧均齐全，无需补齐）。
  因此这两侧的单文件行数与依赖清单按**人工复核 + 本计划登记的实测基线**核对，并在 `tasks.md` 中登记核对结果与命令输出（MUST NOT 以"没有脚本"为由跳过）。
- 复测基线（2026-10-12 实测）：`agent-backend/src/domain/run-manager.ts` 532 → 拆分后 MUST ≤500；
  `frontend/src/components/chat/ChatPanel.vue` 403 → MUST ≤500；`admin-backend/.../soul-design.ts` 391 → MUST ≤500。

**部署后**：按 `quickstart.md` §4 执行**非交互冒烟确认**（HTTP 打点，确认服务可达、新端点 200 且形状正确、不存在会话 404、详情接口未新增 `next_actions` 字段）。该步骤只确认部署成功，**MUST NOT** 作为测试结论。

---

## 7. 交付物与后续

- **本命令产出**：`research.md`、`data-model.md`、`contracts/next-actions-api.md`、`quickstart.md`、本 `plan.md`（并已回填 `specs/007-next-action-hints/plan.md` 模板）。
- **下一步**：`/speckit.tasks` 生成 `tasks.md`（按 P1~P4 分期），实现后跑 `/speckit.analyze` 做规格—计划—任务一致性核查。
- **需在实现期留意的三处口径**：
  1. 生成与清空 MUST 共用同一条 per-thread 串行链（D6），否则会出现上一轮卡片"回魂"；
  2. 前端拉取末次延迟 MUST 晚于生成超时上限（复杂度跟踪已登记，需有单测断言）；
  3. `run-finalize.ts` 的抽取 MUST 为纯搬运，且 `run-manager.ts` 改动后 MUST 复测行数 ≤500。
