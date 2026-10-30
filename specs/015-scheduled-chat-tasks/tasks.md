# 任务清单：聊天区定时任务

**Input**: 设计文档 `specs/015-scheduled-chat-tasks/`（[spec.md](./spec.md) / [plan.md](./plan.md) / [research.md](./research.md) / [data-model.md](./data-model.md) / [contracts/](./contracts/) / [quickstart.md](./quickstart.md)）

**分支**：`015-scheduled-chat-tasks`

**测试说明**：本特性**测试为必做项**（宪章原则三，NON-NEGOTIABLE），不是可选项。前端每个新增组件/composable/纯函数 MUST 配同名同目录 spec；后端每个端点 MUST 有集成测试，`domain/` MUST 有单元测试（正常 / 异常 / 边界）。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可与同阶段其他任务并行（不同文件、无依赖）
- **[Story]**：所属用户故事（US1 / US2 / US3）；基础设施与收尾任务不带
- 所有路径相对仓库根 `d:/公司项目/智能体/optagent/`

## 路径约定

- 后端：`agent-backend/src/**`，测试在 `agent-backend/tests/{unit,integration}/`
- 前端：`frontend/src/**`，测试与源文件**同名同目录**（`Xxx.vue` ↔ `Xxx.spec.ts`）

---

## Phase 1: Setup（共享常量与契约类型）

**目的**：把跨故事复用的常量、路径函数、错误码与前端类型先落定，避免后续多处各写一份。

- [x] T001 [P] 新增 `agent-backend/src/domain/run-limits.ts`，导出 `MAX_ACTIVE_THREADS_PER_USER = 3`（唯一来源），并把 `agent-backend/src/routes/chat.ts` 的本地常量改为引用它
- [ ] T002 [P] `agent-backend/src/domain/dirs.ts` 增加 `SCHEDULED_TASKS_DIR` 常量与 `scheduledTasksDir(root, uid, agentName)` 路径函数（`user-data/{agent}/scheduled-tasks`）
- [x] T003 [P] `agent-backend/src/server.ts` 的 `DOMAIN_ERROR_STATUS` 增加 `SCHEDULED_TASK_NOT_FOUND: 404`、`SCHEDULED_TASK_NAME_CONFLICT: 409`、`SCHEDULED_TASK_ENABLED: 409`、`SCHEDULED_TASK_EXHAUSTED: 409`
- [ ] T004 [P] `frontend/src/api/types.ts` 增加 `ThreadSource`、`ScheduledTask`（含 `new_thread_per_run`）、`ScheduleRun`（含 `rebuilt`）、`ScheduledTaskCreateRequest`、`ScheduledTaskListResponse`、`ScheduleRunListResponse`，并给 `Conversation` 加可选 `source`
- [ ] T005 [P] `frontend/src/api/types.ts` 落地共享字面量联合类型 `ScheduledTaskStatus`（`'idle' | 'running'`）与 `ScheduleRunResult`（`'success' | 'failed' | 'skipped'`），作为 `ScheduleStatus` / `ScheduleRunsDialog` 判据的唯一来源（MUST NOT 在组件内重复写字符串常量）

---

## Phase 2: Foundational（阻塞所有故事）

**⚠️ 关键**：本阶段完成前，任何用户故事都不可开工。

### 后端：存储与调度内核

- [ ] T006 [P] 新增 `agent-backend/src/domain/scheduled-task-schedule.ts`：`firstRunAt` / `nextRunAtAfter` / `advanceToFuture` / `isExhausted` / `deriveStatus` / `canStart`（纯函数）
- [ ] T007 [P] 新增 `agent-backend/tests/unit/scheduled-task-schedule.spec.ts`：首跑、间隔推进、恰好等于截止、恰好等于次数、已过期、跨截止的下一时刻推进
- [ ] T008 [P] 新增 `agent-backend/src/domain/scheduled-task-store.ts`：读写 `tasks.json`（临时文件 + `rename` 原子替换、同域串行队列）、`list/get/create/setEnabled/remove/markTriggered`、名称唯一校验、损坏 JSON 抛 `ScheduledTaskStoreError`
- [ ] T009 [P] 新增 `agent-backend/tests/unit/scheduled-task-store.spec.ts`：往返读写、无 `.tmp` 残留、名称冲突、损坏 JSON 抛错、并发写不互相覆盖、`markTriggered` 推进 `next_run_at` 与 `executed_count`、**跨 uid / 跨数字人目录不互串**（`FR-053`）
- [ ] T010 [P] 新增 `agent-backend/src/domain/scheduled-task-run-store.ts`：`runs.jsonl` 追加、按触发时刻倒序读取、`task_id` 筛选、`limit` 封顶 200
- [ ] T011 [P] 新增 `agent-backend/tests/unit/scheduled-task-run-store.spec.ts`：追加顺序、倒序读取、筛选、limit 行为、空文件
- [ ] T012 [P] 新增 `agent-backend/src/domain/scheduled-task-events.ts`：`emitChanged(userId)` / `onChanged`（同 `ProducedEvents` 形态）
- [ ] T013 `agent-backend/src/domain/thread-store.ts`：`ThreadMeta` / `MetaFile` 增可选 `source`；`create(userId, agentName, opts?: { title?, source? })`；`touch` / `rename` MUST NOT 改动或清除 `source`
- [ ] T014 `agent-backend/tests/unit/thread-store.spec.ts` 补断言：带 `title`/`source` 创建、`touch` 后 `source` 仍在、无 `source` 时 meta 中**不含该键**
- [x] T015 [P] 新增 `agent-backend/src/infra/scheduled-task-ticker.ts`：单 `setInterval(1000)`（`unref`）、扫描全部（用户 × 数字人）任务、`inflight` 跳过、派发不 `await`、`isDraining` 时不派发、`stop()` 先置标记再清 timer；派发走 `registerDispatcher(fn)` 注入的回调，**ticker 不 import runner**（避免 Phase 2 依赖 Phase 3）
- [x] T016 [P] 新增 `agent-backend/tests/unit/scheduled-task-ticker.spec.ts`：到期才派发、未到期不派发、同一任务在途时跳过并记 `skipped`、`stop()` 后不再派发、关服标记生效、未注册派发器时安全空转
- [x] T016a [P] `agent-backend/tests/unit/scheduled-task-ticker.spec.ts` 增"重启恢复"用例：`next_run_at` 已在过去的启用任务，启动后**只触发一次**且下一时刻被推进到未来；已停用任务重启后不触发；不补跑错过的所有历史时刻（`FR-045`/`SC-007`）
- [ ] T017 `agent-backend/src/routes/threads.ts`：`metaJson()` 透出可选 `source`（列表与详情共用）
- [ ] T018 `agent-backend/tests/integration/threads.spec.ts` 补断言：带 `source` 的会话在列表与详情中都能读到；普通会话**不含** `source` 键
- [x] T019 `agent-backend/src/context.ts` + `agent-backend/src/server.ts`：装配 `scheduledTaskStore` / `runs` / `scheduledTaskEvents`；创建 ticker 实例并 `start()`（此时派发器未注册，安全空转）、`onClose` 内 `stop()`；**runner（含 `registerDispatcher` 注册）与路由注册留到 US1 阶段**

### 前端：通信与状态基础

- [ ] T020 [P] 新增 `frontend/src/api/scheduled-tasks.ts`（6 个方法：`list` / `create` / `setEnabled` / `remove` / `runs` / `eventsUrl`）
- [ ] T021 [P] 新增 `frontend/src/api/scheduled-tasks.spec.ts`：请求路径与方法、请求体字段（含 `new_thread_per_run`）、`runs` 查询参数、错误对象透传
- [ ] T022 [P] 新增 `frontend/src/utils/schedule-format.ts`：`formatDateTime` / `formatInterval` / `formatCount` / `formatRunResult` / `formatRebuilt`（纯函数）
- [ ] T023 [P] 新增 `frontend/src/utils/schedule-format.spec.ts`：秒级格式化、频率文案、`已执行 X / Y 次`、三种结果文案、`rebuilt` 标注
- [ ] T024 新增 `frontend/src/composables/useScheduledTasks.ts`：`open` / `list` / `loading` / `error` / `create` / `setEnabled` / `remove` / `runs` / SSE 订阅（信号到达→刷新任务列表 + `threads.loadList()`）/ `onAgentSwitched`；**SSE 重连 MUST 有界**——指数退避 1s/2s/4s/8s/16s，最多 5 次，超限置 `degraded` 并提示"实时更新已暂停，可手动刷新"（宪章原则九）
- [ ] T025 新增 `frontend/src/composables/useScheduledTasks.spec.ts`：创建后插入首位、启停乐观更新与回滚、SSE 信号触发刷新、SSE 断开不报错、**重连达上限后置 `degraded` 且不无限重试**、加载失败置 `error` 而非空列表
- [ ] T026 `frontend/src/composables/useAppSession.ts`：`AppSession` 增 `schedule`，装配顺序放在 `threads` 之后、`agents` 之前；`onSwitched` 内加一次 `schedule.onAgentSwitched()`
- [ ] T027 `frontend/src/composables/useAppSession.spec.ts` 补断言：`schedule` 存在、切换数字人后任务被重载

**检查点**：存储/调度内核与前端的 api/composable 就绪，用户故事可以并行开工。

---

## Phase 3: User Story 1 - 创建定时任务并按时自动执行（Priority: P1）🎯 MVP

**目标**：从闪电入口进入设置页 → 创建任务 → 启用 → 到点自动跑一次对话并带来源标记，全程不打断用户。

**独立验证**：`quickstart.md` S3（创建 1 分钟后触发、间隔 60 秒、次数 2 的任务并启用，观察两个新会话、历史完整、已执行次数归零）

### 测试（先写并确认失败）

- [x] T028 [P] [US1] 新增 `agent-backend/tests/unit/scheduled-task-runner.spec.ts`：成功、执行失败、上一轮未完（`skipped`）、并发额度满（`skipped`）、数字人不可用（`skipped` + 自动停用），断言记录字段与会话创建
- [x] T028a [P] [US1] 同文件增"计数口径"用例：`success` / `failed` 各使 `executed_count` +1；三种 `skipped` 均**不增加**、`next_run_at` 仍推进（`FR-041` / `FR-043`）
- [x] T029 [P] [US1] 新增 `agent-backend/tests/integration/scheduled-tasks.spec.ts`：`GET`（空数组/排序/派生字段）、`POST`（201 / 400 字段 / 409 名称冲突）、`PATCH enabled`（200 / 404 / 409 EXHAUSTED）、`GET events`（`text/event-stream` 首帧）
- [ ] T030 [P] [US1] 新增前端 spec 骨架并确认失败：`ScheduleEntryButton.spec.ts`、`ScheduleStatus.spec.ts`、`ScheduleRow.spec.ts`、`ScheduleTable.spec.ts`、`ScheduleCreateDialog.spec.ts`、`SchedulePanel.spec.ts`

### 实现

- [x] T031 [US1] 新增 `agent-backend/src/domain/scheduled-task-runner.ts`：`loadAgentConfig` → 建会话（title + `source`）→ `acquireQuota` → `getOrCreateAgent` → `mcpReady`（超时降级）→ `startRun`（提示词为本轮 user 消息，`thinking` 取任务配置）→ 订阅 `done`/`error` → `settled` 后写记录 + `touch` + 广播；末尾用 `registerDispatcher(...)` 把 runner 注册给 ticker（T015 的注入点）
- [x] T031a [P] [US1] `agent-backend/tests/unit/scheduled-task-runner.spec.ts` 增"多任务同刻"用例：两个任务同时到点各自拿到不同 `thread_id`、互不合并（`FR-046`）
- [x] T032 [US1] 新增 `agent-backend/src/routes/scheduled-tasks.ts`：`GET /api/scheduled-tasks`、`POST /api/scheduled-tasks`（8 项校验含 `new_thread_per_run` + 服务端权威拒绝 + `details.field`）、`PATCH /api/scheduled-tasks/:id/enabled`（启用时把过去的 `next_run_at` 推进到未来）；在 `server.ts` 注册
- [x] T032a [P] [US1] `agent-backend/tests/integration/scheduled-tasks.spec.ts` 增"用户隔离"用例：另一 `uid` 的列表为空、按 id 访问返回 404、`PATCH`/`DELETE` 均不可越权（`FR-053`）
- [x] T033 [US1] 同文件新增 `GET /api/scheduled-tasks/events`（SSE 纯信号：事件名 `scheduled-task`、负载空、建连即推、25s 心跳、按 userId 过滤）
- [ ] T034 [P] [US1] `frontend/src/components/common/BaseIcon.vue`：`ICON_PATHS` 增加 `schedule`（闪电）路径
- [ ] T035 [P] [US1] 新增 `frontend/src/components/schedule/ScheduleEntryButton.vue`：原生 `<button>`、`aria-label="定时任务"`、`aria-pressed`、禁用态带原因；**组件级键盘验证**（Tab 可达、Enter/Space 触发）与**读屏验证**（名称 + 开关状态朗读）写在 spec 中
- [ ] T036 [P] [US1] 新增 `frontend/src/components/schedule/ScheduleStatus.vue`：文字 + 圆点双通道（未开始 / 执行中），颜色不唯一承载语义；**读屏验证**：状态文字被朗读（不得只有颜色）
- [ ] T037 [P] [US1] 新增 `frontend/src/components/schedule/ScheduleRow.vue`：六列 + 行尾三角启停按钮（`aria-pressed`、禁用态原因用 `title` + 可读文本）；**组件级键盘验证**（Tab 顺序：启停 → 删除；Space 切换）与**读屏验证**（按钮朗读开/关）
- [ ] T038 [P] [US1] 新增 `frontend/src/components/schedule/ScheduleTable.vue`：表头（`<table>` + `scope="col"`）、空态文案与创建引导、超出滚动；行渲染 MUST 用稳定 `key`（`task.task_id`）并按 `v-memo` 提示做渲染缓存（宪章原则五）；**读屏验证**：表头与列的关联被正确朗读
- [ ] T039 [P] [US1] 新增 `frontend/src/components/schedule/ScheduleCreateDialog.vue`：8 项输入（含复选框「每次任务创建新对话」，默认勾选）、字段级校验与提示、提交中禁用、失败保留已填内容；思考开关默认值 MUST 由 props 注入（来自聊天区当前值，见 T042）；**组件级键盘验证**（Tab 顺序、Esc 关闭）与**读屏验证**（字段标签、错误提示通过 `aria-describedby` 朗读）
- [ ] T040 [US1] 新增 `frontend/src/components/schedule/SchedulePanel.vue`：覆盖层容器（`inset: 0`）、头部按钮顺序「运行记录 / 创建定时任务 / ×」、Esc 关闭覆盖层（不误伤聊天终止）、装配 Table + CreateDialog；**组件级键盘验证**（Tab 收敛在覆盖层内、Esc 关闭）与**读屏验证**（覆盖层有可读标题、按钮有名称）
- [ ] T041 [US1] `frontend/src/views/WorkbenchView.vue`：中栏加 `position: relative` 包装层，按 `session.schedule.open` 渲染 `SchedulePanel`，关闭时回到原聊天界面
- [ ] T041a [P] [US1] `frontend/src/components/schedule/SchedulePanel.spec.ts` 增断言：打开/关闭覆盖层**不触发任何任务状态写入**（不调用 `setEnabled`/`create`），且关闭后原会话与草稿仍在（`FR-003`/`FR-006`）
- [ ] T042 [US1] `frontend/src/components/chat/ChatPanel.vue`：`actions-extra` 槽内、铃铛之前渲染 `ScheduleEntryButton`（点击调 `session.schedule.openPanel()`）；把当前会话 `source` 传给 `MessageList`，并把聊天区当前 `thinking` 传给覆盖层作创建弹窗默认值（`FR-026`）
- [ ] T043 [P] [US1] 新增 `frontend/src/components/chat/ThreadSourceNotice.vue`：文案"由定时任务「任务名」于 … 触发"，`role="status"`；**读屏验证**：进入会话时标记被播报一次（不得重复轰炸）
- [ ] T044 [US1] `frontend/src/components/chat/MessageList.vue`：顶部按 `source` 渲染 `ThreadSourceNotice`（无来源时不渲染、不留占位）
- [ ] T045 [P] [US1] `frontend/src/components/layout/HistoryItem.vue`：标题前渲染闪电图标（`aria-label="定时任务会话"`），与「进行中」徽标共存；**读屏验证**：会话条目朗读"定时任务会话"前缀
- [ ] T046 [US1] 补齐受影响的既有 spec 与夹具：`frontend/src/components/chat/ChatPanel.spec.ts`（含 thinking 透传）、`frontend/src/components/chat/MessageList.spec.ts`、`frontend/src/components/layout/HistoryItem.spec.ts`、`frontend/src/composables/useThreads.spec.ts`（`source` 缺省/有值两态）
- [ ] T047 [US1] 汇总复核 `quickstart.md` S1~S4、S9 并记录结果（S9 只作跨组件回归，**不替代** T035~T045 各自的组件级键盘与读屏验证）

**检查点**：MVP 可用——能创建、能启用、到点自动执行并留下可回看的带标记会话；`quickstart.md` S3 通过即可演示。

---

## Phase 4: User Story 2 - 停用与删除治理（Priority: P2）

**目标**：关掉三角按钮即停止后续触发；必须先停用才能删除，删除前二次确认；删除不连带删历史。

**独立验证**：执行中任务点删除被拒 → 停用后删除弹二次确认 → 取消保持原状 → 确认后任务消失、会话仍在。

### 测试

- [x] T048 [P] [US2] `agent-backend/tests/integration/scheduled-tasks.spec.ts` 增：`DELETE` 204 / 409 `SCHEDULED_TASK_ENABLED` / 404；删除后 `GET` 列表不含该任务、`GET runs` 不再返回其记录
- [ ] T049 [P] [US2] `agent-backend/tests/unit/scheduled-task-runner.spec.ts` 增：停用后不再触发；停用时正在进行的那一轮**跑完**且记录为 `success`

### 实现

- [x] T050 [US2] `agent-backend/src/routes/scheduled-tasks.ts` 增 `DELETE /api/scheduled-tasks/:id`：启用中直接 409；停用则先标记不允许再派发、再原子移除并落盘
- [ ] T051 [P] [US2] `frontend/src/components/schedule/ScheduleRow.vue` 增行尾「×」删除按钮：启用中点击给出"请先停止任务"提示且不发请求；**组件级键盘验证**（Tab 可达、Enter 触发）与**读屏验证**（朗读"删除任务 {任务名}"）
- [ ] T052 [US2] `frontend/src/components/schedule/SchedulePanel.vue` 接入 `ConfirmDialog`（标题"删除定时任务"、消息含任务名、`danger`、`busy` 防重复提交），取消/Esc 保持原状；**键盘验证**：焦点进入确认框、Esc 关闭后焦点回到原删除按钮
- [ ] T053 [US2] `frontend/src/composables/useScheduledTasks.ts` 增 `remove`（乐观移除 + 失败回滚 + 提示）；对应 spec 补用例

**检查点**：US1 与 US2 均独立可用——任务可从"不要了"安全退出，且不影响历史资产。

---

## Phase 5: User Story 3 - 运行记录追溯与跳转（Priority: P3）

**目标**：按触发时刻倒序看每次执行的结果，一键跳回对应会话；会话已删的条目明确标注且不可点。

**独立验证**：对一个触发过的任务打开运行记录，条数与触发次数一致，点击跳转正确，空态与"会话已删除"两态正确。

### 测试

- [x] T054 [P] [US3] `agent-backend/tests/integration/scheduled-tasks.spec.ts` 增：`GET runs` 倒序、`task_id` 筛选、`limit` 上限、`thread_deleted` 回填、空态 `{runs: [], total: 0}` 且 200

### 实现

- [x] T055 [US3] `agent-backend/src/routes/scheduled-tasks.ts` 增 `GET /api/scheduled-tasks/runs`（含 `total`）；`thread_deleted` 的**存在性检查 MUST 由 `domain/` 提供**（`run-store` 或 `thread-store` 暴露批量存在性判定），路由层只做响应映射——接口层 MUST NOT 直接访问文件系统（宪章原则二）
- [ ] T056 [P] [US3] 新增 `frontend/src/components/schedule/ScheduleRunsDialog.vue`：列表（会话名/任务名/触发时刻/结果 + 原因）、任务筛选、空态、不可跳转态；稳定 `key` = `run_id`；对应 spec 覆盖 props / emit / 三种结果 / 空态；**组件级键盘验证**（Tab、Enter 打开记录）与**读屏验证**（"会话已删除，不可打开"被朗读）
- [ ] T057 [US3] `frontend/src/composables/useScheduledTasks.ts` 增 `loadRuns`（含 `task_id` 筛选与 `limit`）；`SchedulePanel` 头部「运行记录」按钮接上；点击记录关闭弹窗并 `threads.select(thread_id)`
- [ ] T058 [US3] 手工验收 `quickstart.md` S5

**检查点**：三个故事全部可独立演示。

---

## Phase 6: 会话复用模式（2026-10-30 增补，属 US1 增量）

**目标**：创建时取消勾选「每次任务创建新对话」→ 首轮建会话、后续每轮追加到同一会话；会话被删则自动重建，任务不中断。

**独立验证**：`quickstart.md` S10（连跑 3 次只多一个会话、3 轮问答）；S11（默认勾选、列表仍 6 列、多条记录指向同一会话）。

### 测试

- [x] T059 [P] [US1] `agent-backend/tests/unit/scheduled-task-runner.spec.ts` 增：复用命中（不新建会话、不改标题）、会话已删（新建 + `rebuilt=true` + 更新 `reused_thread_id`）、meta 损坏（按 `failed` 处理）、用户重命名后不覆写标题
- [x] T060 [P] [US1] `agent-backend/tests/integration/scheduled-tasks.spec.ts` 增：`POST` 带 `new_thread_per_run=false` → `GET` 回显该字段；未传时缺省 `true`；`GET runs` 回显 `rebuilt`；`PATCH` 不接受该字段（`additionalProperties: false` → 400）

### 实现

- [x] T061 [US1] `agent-backend/src/domain/scheduled-task-store.ts`：`create` 默认 `new_thread_per_run = true`；`markTriggered` 支持写入/更新 `reused_thread_id` 与 `last_run_at`
- [x] T062 [US1] `agent-backend/src/domain/scheduled-task-runner.ts`：按模式决定会话（新建 / 复用 / 重建），重建时保留 `source` 并标 `rebuilt`
- [x] T063 [US1] `agent-backend/src/routes/scheduled-tasks.ts`：`POST` 接收可选 `new_thread_per_run`（缺省 `true`）；响应与列表下发该字段；`PATCH enabled` 的 schema 保持 `additionalProperties: false`
- [ ] T064 [P] [US1] `frontend/src/components/schedule/ScheduleCreateDialog.vue`：会话模式复选框「每次任务创建新对话」（默认勾选）、`aria-describedby` 说明文案、随提交体发送
- [ ] T065 [P] [US1] `frontend/src/components/schedule/ScheduleRunsDialog.vue`：对 `rebuilt=true` 的记录加文字标注"重建会话"
- [ ] T066 [US1] `frontend/src/api/scheduled-tasks.ts` + `api/types.ts`：补齐 `new_thread_per_run` 与 `rebuilt`（契约同步，含 spec 断言）
- [ ] T067 [US1] 手工验收 `quickstart.md` S10、S11

**检查点**：两种会话模式都可用，且旧任务（无该字段）行为不变。

---

## Phase 7: Polish & 横切关注点

- [ ] T068 [P] 单文件行数核查：新增/改动文件均 ≤ 500 行（`ChatPanel.vue` / `useChatPanel.ts` / `server.ts` 若超限，按 plan「风险与行数预算」抽 `ChatActionsExtra.vue` 或移出装配细节）
- [ ] T069 [P] 覆盖率核查：新增模块（`domain/scheduled-task-*`、`api/scheduled-tasks.ts`、`composables/useScheduledTasks.ts`、`utils/schedule-format.ts`、`components/schedule/**`）语句覆盖率 ≥ 80%
- [ ] T070 [P] 文档一致性核对：`contracts/scheduled-tasks-api.md` / `contracts/thread-source.md` / `data-model.md` / `quickstart.md` 与实际实现逐项对齐；差异登记进 plan「增补修订记录」
- [ ] T071 [P] 可观测性核对：`scheduled_task.tick.*`、`scheduled_task.run.*`（含 `rebuild`）、`scheduled_task.store.write_failed`、`scheduled_task.list.failed` 四类结构化日志均已落地
- [ ] T072 全量门禁（本地）：`frontend` = `npm run lint && npm run typecheck && npm run test:coverage && npm run build`；`agent-backend` = `npm run typecheck && npm run lint && npm run test:all && npm run build`
- [ ] T072a 端点计时验证（`SC-012`）：按规格口径（生产构建、100 任务 / 1000 条记录、每端点串行 20 次取 P95）实测 5 个端点 + SSE 首帧时延，**把实测数值回填到 `spec.md` 的 `SC-012` 结果位**并在 plan「增补修订记录」登记（宪章原则五，MUST NOT 留空）
- [ ] T073 非交互冒烟：`quickstart.md` §4（含 `npm run smoke`），确认部署后端点可达与状态码符合预期
- [ ] T074 按 `quickstart.md` S1~S11 做一次完整回归并记录结论（含 S6 跳过、S7 重启不补跑、S10 复用与重建）

**补充任务（2026-10-30 分析修复补入，编号带后缀以保持既有编号稳定）**

- `T016a`（Phase 2，重启恢复）· `T028a`（计数口径）· `T031a`（多任务同刻）· `T032a`（用户隔离）
- `T041a`（覆盖层开合无副作用）· `T072a`（端点计时验证）
- 以上任务已就地插入对应阶段；执行顺序以它们在文件中的位置为准

---

## 依赖与执行顺序

### 阶段依赖

- **Setup（Phase 1）**：无依赖，可立即开始
- **Foundational（Phase 2）**：依赖 Setup；**阻塞全部用户故事**
- **US1（Phase 3）**：依赖 Foundational
- **US2（Phase 4）**：依赖 Foundational；与 US1 的 `ScheduleRow.vue` / `SchedulePanel.vue` / `useScheduledTasks.ts` 有文件重叠，实施时先完成 US1 再加删除入口
- **US3（Phase 5）**：依赖 Foundational 与 US1（需要真实执行记录才有数据）
- **会话复用（Phase 6）**：依赖 US1 的 runner 与创建弹窗
- **Polish（Phase 7）**：依赖全部完成

### 故事内顺序

1. 先写测试并确认失败 → 2. 纯函数/存储 → 3. runner 与端点 → 4. 组件与 store → 5. 装配与手工验收

### 并行机会

- T001~T005（Setup）可全并行
- 后端存储四件套（T006/T008/T010/T012）与前端 api/纯函数（T020/T022）可并行；它们的 spec 任务（T007/T009/T011/T021/T023）与实现**同文件成对**，按"先测后写"顺序执行
- US1 内：T034~T039（图标与四个展示组件）可并行；T043/T045（来源提示、左栏标记）可并行
- US3 与 Phase 6 在 US1 完成后可并行

### 并行示例：US1 展示层

```bash
# 可同时开工（互不相同的文件）
Task: "T034 BaseIcon.vue 增加 schedule 图标"
Task: "T035 ScheduleEntryButton.vue + spec"
Task: "T036 ScheduleStatus.vue + spec"
Task: "T043 ThreadSourceNotice.vue + spec"
Task: "T045 HistoryItem.vue 闪电标记 + spec"
```

---

## 实施策略

### MVP 优先（仅 US1）

1. 完成 Phase 1、Phase 2
2. 完成 Phase 3
3. **停下来验证**：跑 `quickstart.md` S3，确认"到点自动执行 + 带标记会话 + 次数归零"三件事成立
4. 可交付演示，再继续 US2 / US3

### 增量交付

- Setup + Foundational → US1（MVP）→ US2（治理）→ US3（追溯）→ Phase 6（会话复用）→ Polish
- 每个阶段结束时 MUST 通过该阶段相关测试，且不破坏前一阶段行为

### 并行团队策略

- 后端负责人：T006~T019 → US1 的 T031~T033 → US2 的 T050 → US3 的 T055 → Phase 6 的 T061~T063
- 前端负责人：T020~T027 → US1 的 T034~T046 → US2 的 T051~T053 → US3 的 T056~T057 → Phase 6 的 T064~T066
- 共同：T072~T074 门禁与回归

---

## 2026-10-30 二次增补：任务编辑与启停视觉（`FR-013`/`FR-017`/`FR-017a`/`FR-065`~`FR-069`）

- [x] T075 后端：`ScheduledTaskStore.update`（仅停用可改、名称唯一、`next_run_at` 重置为新的 `start_at`、`executedCount`/`lastRunAt` 保留）
- [x] T076 后端：`PATCH /api/scheduled-tasks/:id`（整份替换 7 项；`new_thread_per_run` 未声明字段 → 400；启用中 → 409 `SCHEDULED_TASK_ENABLED`）
- [x] T077 后端：`validateEditable` 抽出创建/编辑共用校验，编辑路径允许开始时间已过去（`FR-067`）
- [x] T078 后端集成测试：成功替换（次数保留 / `next_run_at` 重置）、保留过去时刻、启用中 409、重名 409、不存在 404、带会话模式字段 400、字段级 400
- [x] T079 前端：`api/types.ts` 增 `UpdateScheduledTaskRequest`；`api/scheduled-tasks.ts` 增 `update`；store 增 `update`（无乐观更新、pending 必清）
- [x] T080 前端：`ScheduleRow` 操作区改「启停 → 编辑(笔) → 删除」，启用态启停改为红色方块，启用中编辑/删除禁用并给出原因
- [x] T081 前端：`ScheduleCreateDialog` 复用为编辑弹窗（预填、标题/按钮文案、会话模式只读、允许过去时刻）；`SchedulePanel` 用同一弹窗分流创建/编辑
- [x] T082 前端测试：行按钮顺序与禁用规则、编辑上抛链路（行 → 表 → 覆盖层）、表单预填与提交体（不含 `new_thread_per_run`）、store `update` 成功/失败、API `PATCH /{id}` 形状

---

## 备注

- `[P]` = 不同文件、无依赖，可并行
- 每个任务内的测试 MUST 先失败再实现（宪章原则三）
- 门禁全部在**宿主机本地**执行，容器不参与测试
- 后端 `npm run test` **只跑单测**，不得作为门禁，必须用 `test:all`
- 提交信息用中文，并注明影响的侧（前端 / 后端 / 两者）
- 任何超出 plan 的实现取舍，MUST 回写 `plan.md` 的「增补修订记录」
