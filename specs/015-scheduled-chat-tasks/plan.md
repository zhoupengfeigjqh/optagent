# 实施计划：聊天区定时任务

**Branch**: `015-scheduled-chat-tasks` | **Date**: 2026-10-29（2026-10-30 增补修订） | **Spec**: [spec.md](./spec.md)

**Input**: 需求规格 `specs/015-scheduled-chat-tasks/spec.md`（已评审；首轮 3 处歧义已收敛，2026-10-30 增补「会话复用模式」）

## 摘要

在既有前后端栈上新增"定时任务"能力，不做任何技术栈引入：

1. **前端**：聊天区右上角新增闪电入口（位于「工作空间」与「铃铛」之间）；点击后以**覆盖层**铺满中栏聊天区（不含左栏），内含任务列表（六列 + 行内启停 + 删除）、创建弹窗（8 项，含会话模式复选框）、运行记录弹窗；左栏会话条目与聊天区消息流顶部出现"定时任务"标记。
2. **后端**：新增**定时任务域**（任务存储 + 秒级心跳巡检 + 到点触发一次对话）与 **6 个端点**；到点执行**复用既有对话运行链路**（`threadStore.create` → `runManager.acquireQuota` → `getOrCreateAgent` → `runManager.startRun`），因此历史落盘、usage 记账、并发上限、思考开关、工具装配全部与手动对话同一套实现，不存在第二份执行逻辑。
3. **会话复用模式（2026-10-30 增补）**：任务带 `new_thread_per_run` 开关——为 `true` 时每轮新建会话（既有行为）；为 `false` 时复用任务的 `reused_thread_id`（首轮创建），每轮把任务提示词作为新增 user 消息追加到同一会话；触发前校验该会话仍存在，已删除则自动重建并在运行记录标注"重建会话"。
4. **跨侧契约**：新增 `scheduled-tasks` 契约文档；会话元数据扩展可选 `source`（定时任务来源），前端类型、后端读写、测试四处同步。

核心取向：**调度器只有一个心跳**（单 `setInterval` 巡检，非每任务一个 timer），因此启停、重启恢复、错过不补跑都只改一份持久化文件；**执行只有一个入口**（复用 `RunManager`），因此定时任务不是"第二套对话系统"。

## 技术上下文

**Language/Version**：TypeScript 6；前端 Vue 3（`<script setup>`）+ Vite；后端 Node ≥ 20 / Fastify 5（ESM）

**Primary Dependencies**：前端 = Vue 3 + ant-design-vue 4 + dayjs（均已安装，**本次不新增依赖**，日期时间选择复用 `a-date-picker show-time`）；后端 = Fastify 5（`setInterval` 与 `fs` 原生能力足够，**不引入 cron 库**）

**Storage**：文件持久化，落点 `agent-backend/.opt-agent/users/{uid}/user-data/{数字人}/scheduled-tasks/`：
- `tasks.json`（任务集合，原子替换写入）
- `runs.jsonl`（执行记录，追加写）

选此落点的理由：与 `threads/` 同域 ⇒ **数字人隔离由目录位置承载**（与 `ThreadStore` 同一口径，不需要额外校验）；平台部署只覆盖数字人目录与 `scenario.json`，不触碰 `user-data/`，因此任务不因重新部署被抹掉。

**Testing**：两端 Vitest 5；前端组件用 jsdom；后端端点用 Fastify `inject` 集成测试，`domain/` 纯函数与存储各自单测

**Target Platform**：内网桌面浏览器 + Linux 容器运行的后端（本地开发为 Windows）

**Project Type**：Web 前后端一体（`frontend` ↔ `agent-backend`）

**Performance Goals**：任务列表 / 运行记录端点 P95 ≤ 500ms（数据量级：任务 ≤ 100、记录单次读 200 条）；心跳巡检单轮 ≤ 50ms（纯内存比较 + 文件变更时才写盘）；触发时刻偏差 ≤ 5s（SC-003）

**Constraints**：单文件 ≤ 500 行；无新依赖；破坏性操作二次确认；状态不得只靠颜色；所有写盘必须原子替换；所有降级用户可感知且有结构化日志

**Scale/Scope**：单用户桌面应用（当前固定 `admin`），任务量级 10~100，运行记录按任务滚动读取；本次改动约前端 12 个、后端 9 个源文件 + 对应测试

## 宪章检查

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

| 原则 | 结论 | 依据 |
|---|---|---|
| 一、中文文档与规格驱动 | 通过 | spec / plan / research / data-model / contracts / quickstart 全部中文；本特性按「规格 → 计划 → 任务」推进，歧义已在 spec 内收敛 |
| 二、代码质量与模块化（≤500 行） | 通过（有行数预算风险，见「风险与行数预算」） | 调度拆为 `store` / `schedule`(纯函数) / `run-store` / `runner` / `ticker` / `events` 六个单一职责模块；前端拆为 `SchedulePanel`/`Table`/`Row`/`CreateDialog`/`RunsDialog`/`Status` 六个组件 + `useScheduledTasks` + `utils/schedule-format.ts`；`MAX_ACTIVE_THREADS_PER_USER` 抽为唯一来源 |
| 三、测试完备性 | 通过 | 新增前端组件/composable/纯函数均配同名同目录 spec（覆盖 props / emit / 边界）；后端 6 个端点全部有集成测试（状态码 + 响应体 + 错误码），`domain/` 纯函数与存储有单测（正常 / 异常 / 边界）；失败与跳过路径有测试（原则九） |
| 四、无障碍与可用性 | 通过 | 闪电入口与行内启停用原生 `<button>` + `aria-pressed` + `aria-label`；状态列"文字 + 颜色"双通道；删除二次确认走既有 `ConfirmDialog`（原生 `<dialog>` 焦点陷阱）；覆盖层支持 Esc 与 Tab 顺序收敛；`prefers-reduced-motion` 下无动效 |
| 五、性能与数据一致性 | 通过 | `tasks.json` 写盘＝"临时文件 + `rename` 原子替换"，同文件写操作串行；删除＝"先停调度再原子改集合"，不出现半删；列表一次读全部（无 N+1）；心跳不 `await` 执行完成，长回答不阻塞其他任务巡检 |
| 六、技术治理与依赖控制 | 通过 | 零新增依赖：定时用 `setInterval`、日期选择用已装的 antd、SSE 用既有手写解析、图标加一条内联 SVG 路径 |
| 七、接口契约与前后端一致性 | 通过 | 契约文档 + 前端类型 + 后端 schema + 测试四处同步（见「契约同步清单」）；前端不硬编码任务状态文案判据以外的后端常量 |
| 八、测试与部署简单可控 | 通过 | 沿用既有 `npm run lint / typecheck / test(:coverage) / build` 与后端 `test:all`，不新增脚本 |
| 九、优雅降级与故障可观测 | 通过 | MCP 就绪超时有界降级（沿用）；SSE 断连按 1s/2s/4s/8s/16s 退避、最多 5 次后置 `degraded` 并提示"实时更新已暂停，可手动刷新"（重连有界、状态可感知）；执行失败/跳过的原因写入 `runs.jsonl` 并在运行记录中用户可读；数字人不可用 → 自动停用 + 界面对应标记；所有失败落结构化日志（`event: 'scheduled_task.*'`）；降级路径均有测试（`useScheduledTasks.spec` 的断连/超限用例、加载失败用例） |

**Gate 结论**：无违反项，无需登记例外。

## 方案要点

### 1. 调度：单心跳巡检（后端）

新增 `agent-backend/src/infra/scheduled-task-ticker.ts`：

- 一个 `setInterval(1000, ...)`（`unref()`，不阻碍进程退出）作为**唯一**时钟，取代"每个任务一个 timer"。
- 每轮巡检：扫描 `users/*/user-data/*/scheduled-tasks/tasks.json` → 对每个 `enabled === true` 的任务比较 `next_run_at` 与当前时刻 → 到期则派发执行。
- 派发**不 `await`**：维护 `inflight: Set<task_id>`，同一任务上一轮未结束 → 本轮记 `skipped`（`FR-043`），不并发堆积，也不阻塞其他任务。
- 到点后**先**原子写回"已执行次数 +1、`next_run_at` 推进到下一个未来时刻"，**再**执行；这样进程重启后不会重复触发同一时刻（`FR-045` 不补跑）。
- 关服：`stop()` 清心跳；`isDraining()` 为真时不再派发。
- **派发器注入**：ticker 通过 `registerDispatcher(fn)` 接收执行器，`infra/` 不 import `domain/` 的 runner（避免 Phase 2 依赖 Phase 3）；未注册时安全空转，注册发生在 runner 就绪之后。

**为什么不是每任务一个 `setTimeout`**：启停、删除、重启恢复、次数用尽都要维护定时器生命周期，任何一处漏清就是"幽灵触发"；心跳巡检把全部判断收敛到一份文件 + 一个纯函数，逻辑可单测、可重放。

**为什么不是 cron 表达式**：需求只定义"开始时间 + 间隔秒数 + 次数 + 截止时间"，固定间隔即可；引入 cron 需要新依赖（原则六）。

### 2. 执行：复用 `RunManager`（后端）

新增 `agent-backend/src/domain/scheduled-task-runner.ts`，一次触发的顺序固定为：

1. 取任务绑定的 `userId` / `agentName`（**不再读"当前选中数字人"**：后台执行没有请求上下文，`FR-054` 要求绑定创建时的数字人）；
2. `loadAgentConfig` 校验数字人可用；不可用 → 任务自动停用 + 记 `failed`（不计次数），结束；
3. **确定本轮会话**（`FR-036`/`FR-061`）：
   - `new_thread_per_run === true` → `threadStore.create(userId, agentName, { title: '任务名 + 触发时刻', source })` 新建；
   - `new_thread_per_run === false` 且 `reused_thread_id` 非空 → `threadStore.get(...)` 校验仍存在：存在则复用（不建会话、不改标题），不存在则按上一条新建，并把 `reused_thread_id` 更新为新会话、当次记录标 `rebuilt: true`；
4. `runManager.acquireQuota(userId, threadId, MAX_ACTIVE_THREADS_PER_USER)`；满 → `skipped`（不计次数）；
5. `getOrCreateAgent` → `agent.mcpReady(timeout)`（超时降级继续，沿用既有口径）→ `runManager.startRun`（任务提示词作为**本轮** user 消息：新建会话时是首条，复用时是新增一轮；`thinking` 取任务配置）；
6. `run.subscribe` 捕获 `done` / `error` 作为结果判据，`await run.settled` 后追加 `runs.jsonl` 记录并 `threadStore.touch`；复用时 `touch` 使该会话排到左栏顶部（与手动继续对话同一效果）；
7. 广播变更信号（`scheduledTaskEvents.emitChanged(userId)`），前端据此刷新列表与会话侧栏。

**复用模式的三个实现要点**：

- **会话不存在不等于失败**：`threadStore.get` 抛 `ThreadNotFoundError` 是"用户删了会话"的正常分支，走重建（`FR-061`），**不进** `failed` 计数、不停用任务；其他异常（meta 损坏）按 `failed` 处理并落日志。
- **重建也要带来源标记**：重建出的会话同样写 `source`（`task_id` 不变、`triggered_at` 取本次触发时刻），左栏闪电标记与会话内提示因此始终成立（`SC-004`）。
- **重命名不被覆写**（`FR-063`）：复用时**不调用** `threadStore.rename`；`touch` 只更新 `updated_at`（既有实现已保证不覆写标题与 `source`）。

**为什么走内部链路而不是回环 HTTP**：回环需要伪造请求头、重复一次鉴权与校验，还会把"后台执行"耦合到自己的 HTTP 服务可用性上；内部链路本就是 SSE 路由调用的同一批方法。

**计入次数的口径（已回写为 `FR-041` 正文，不再是"计划侧解释"）**：**只有真正开跑的一轮**（`success` / `failed`）计入 `executed_count`；`skipped`（上一轮未结束、并发额度已满、数字人不可用）不计入——否则一个满负载的时段会白白烧掉用户的执行次数。

### 3. 任务存储（后端）

新增 `agent-backend/src/domain/scheduled-task-store.ts`：

- 路径：`userDataDir(root, uid, agent) + '/scheduled-tasks/tasks.json'`；
- 读取：文件缺失 → 空集合（不是错误）；JSON 损坏 → 抛 `ScheduledTaskStoreError`（上层映射 500 并落日志，**不静默清空**）；
- 写入：`tasks.json.tmp` → `fs.renameSync` 原子替换；同（用户, 数字人）粒度的写操作**串行队列**（与 `HistoryStore` 的 per-thread 串行同一手法），避免两处并发写互相覆盖；
- 能力：`list` / `get` / `create`（名称唯一校验 + `new_thread_per_run` 默认 `true`）/ `setEnabled` / `remove` / `markTriggered`（次数 +1、推进 `next_run_at`、写 `last_run_at`，并在复用模式下写入/更新 `reused_thread_id`）；
- 每轮次都要落盘：次数与 `next_run_at` 是"下次是否触发"的唯一依据，**不允许只存在内存**。
- **跨聚合判定归 `domain/`**：运行记录接口要的"会话是否仍存在"由 `thread-store` 暴露的存在性检查提供（单条/批量），路由层只做响应映射——接口层 MUST NOT 直接访问文件系统（宪章原则二）。

新增 `agent-backend/src/domain/scheduled-task-schedule.ts`（纯函数，便于单测）：

- `firstRunAt(startAt, intervalMs)`、`nextRunAtAfter(last, intervalMs)`；
- `isExhausted(task, now)`（次数用尽或已过截止）、`canStart(task, now)`；
- `deriveStatus(task, now)` → `'idle' | 'running'`（对应 `FR-009` 的两态）。

新增 `agent-backend/src/domain/scheduled-task-run-store.ts`：`runs.jsonl` 追加 + 读取（按触发时刻倒序、`task_id` 可选筛选、`limit` 封顶 200）。

### 4. 会话来源标记（跨侧契约）

- `thread-store.ts`：`ThreadMeta` / `MetaFile` 增**可选** `source`；`create()` 增可选 `{ title, source }` 入参（既有调用点不变）；`writeMeta` 有值才写（旧数据缺省兼容）。
- `routes/threads.ts` 的 `metaJson()` 透出 `source`；列表与详情因此**零额外读盘**就能带上来源（`FR-039`）。
- 前端 `api/types.ts` 的 `Conversation` 增 `source?: ThreadSource`。

**为什么放在会话元数据而不是消息上**：来源是会话级事实（"这个会话整体由某次定时触发产生"），放在 meta 上，左栏列表无需读历史即可画闪电标记；单条消息级标记无法回答"这个会话是不是定时任务"。

### 5. 前端：覆盖层与入口（不新增路由）

- 入口按钮 `ScheduleEntryButton.vue` 注入 `ChatHeader` 的 `actions-extra` 槽内、**排在铃铛之前** ⇒ 实际顺序为「搜索 → 工作空间 → 闪电 → 铃铛」，满足"铃铛与文件空间之间"，且 `ChatHeader.vue` **完全不用改**（它只负责排版与插槽，业务仍由调用方注入）。
- 覆盖层 `SchedulePanel.vue` 挂在 `WorkbenchView` 的 `#chat` 槽内、与 `ChatPanel` 同级（外层加一个 `position: relative` 的包装 div，面板 `position: absolute; inset: 0`）。这样覆盖范围恰好是**中栏**（左栏在其父级 grid 的另一列），且不触碰已经 487 行的 `ChatPanel.vue`。
- Esc：覆盖层打开时优先关闭覆盖层（在 `ChatPanel` 的 Esc 瀑布之前由 `SchedulePanel` 自己监听），不误伤"终止本轮"；`BaseDialog` 的 Esc 优先级仍最高（原生 `<dialog>` 自带）。

**为什么不做成路由页 / `<dialog>`**：路由会整页切换并重排三栏；`<dialog>` 打开时遮住整页（含左栏），与 `FR-002`"不含左侧任务栏"冲突。

### 6. 前端状态与实时性

- 新增 `api/scheduled-tasks.ts`（6 个方法）+ `composables/useScheduledTasks.ts`（`open` / `list` / `runs` / `loading` / `error` / CRUD / 启停 / 筛选 / SSE 订阅）。
- 装配位置：`createAppSession()` 内新增 `schedule`（依赖 `currentAgentName`、`threads.loadList`、`toast`），并由 `agents.onSwitched()` 追加一次 `schedule.reload()`（切换数字人时列表随作用域变化，`FR-054`）。
- 实时性：`GET /api/scheduled-tasks/events` 为**纯信号 SSE**（事件名 `scheduled-task`，负载为空，建连即推一次 + 25s 心跳，与 `produced` 同构）。收到信号后：任务页刷新列表；**同时** `threads.loadList()` 刷新左栏（新会话与闪电标记随之出现），但**不切换当前会话**（`FR-038`/`SC-009`）。
- 信号丢失（断连、刷新）无后果：任务列表与运行记录都可由文件重算。
- **有界重连**（宪章原则九）：订阅断开后按 1s / 2s / 4s / 8s / 16s 退避重试，最多 5 次；超限置 `degraded` 并在界面显示"实时更新已暂停，可手动刷新"，MUST NOT 无限重试，也 MUST NOT 假装仍是实时状态。

### 7. 前端展示细节

- 时间列：`utils/schedule-format.ts` 纯函数统一格式化为 `YYYY-MM-DD HH:mm:ss`（本地时区）；提交时用 `dayjs(...).toISOString()`，服务端存 ISO UTC，比较用 epoch（`FR-058`）。
- 频率列：`N 秒`；次数列：`已执行 X / Y 次`；状态列：`未开始`（中性色）/ `执行中`（成功色）+ 圆点与文字双通道。
- 行内启停：三角按钮 `aria-pressed` 反映状态；禁用态（次数用尽 / 已过截止 / 数字人不可用）带 `title` 与可读原因。
- 删除：启用中 → 本地先判（避免一次无效请求）但**服务端同样校验**（409 `SCHEDULED_TASK_ENABLED`）；二次确认复用 `ConfirmDialog`，消息中带任务名（`FR-019`）。
- 运行记录：`ScheduleRunsDialog.vue` 按触发时刻倒序，每条显示会话名 / 任务名 / 触发时刻 / 结果（成功·失败·跳过 + 原因）；点击可跳转的条目 → 关闭弹窗 + `threads.select(thread_id)`；会话已删（后端记录 `thread_deleted` 或跳转 404）→ 标注"会话已删除"且不可点。
- 会话内标记：`ThreadSourceNotice.vue` 由 `MessageList` 顶部渲染（`source` 由 `ChatPanel` 从其 `threads` 列表项派生后传入），文案"由定时任务「任务名」于 … 触发"。
- 左栏标记：`HistoryItem.vue` 在标题前渲染闪电图标（`aria-label="定时任务会话"`），与"进行中"徽标共存不互斥。

## 项目结构

### 文档（本特性）

```text
specs/015-scheduled-chat-tasks/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── scheduled-tasks-api.md
│   └── thread-source.md
└── checklists/requirements.md
```

### 源码（改动的真实路径）

```text
agent-backend/
├── src/
│   ├── domain/
│   │   ├── scheduled-task-store.ts        # 新增：tasks.json 读写（原子 + 串行）
│   │   ├── scheduled-task-schedule.ts     # 新增：纯函数（next_run_at / 终止判据 / 状态派生）
│   │   ├── scheduled-task-run-store.ts    # 新增：runs.jsonl 追加与读取
│   │   ├── scheduled-task-runner.ts       # 新增：复用 RunManager 执行一次（含会话复用与重建）
│   │   ├── scheduled-task-events.ts       # 新增：变更信号总线（同 ProducedEvents 形态）
│   │   ├── run-limits.ts                  # 新增：MAX_ACTIVE_THREADS_PER_USER 唯一来源
│   │   ├── thread-store.ts                # 改：meta 增可选 source；create 增 opts
│   │   └── dirs.ts                        # 改：新增 SCHEDULED_TASKS_DIR 常量 + 路径函数
│   ├── infra/
│   │   └── scheduled-task-ticker.ts       # 新增：单心跳巡检 + 派发 + 跳过判据
│   ├── routes/
│   │   ├── scheduled-tasks.ts             # 新增：6 个端点
│   │   ├── chat.ts                        # 改：并发上限常量改从 run-limits 取
│   │   └── threads.ts                     # 改：metaJson 透出 source
│   ├── context.ts                         # 改：装配 scheduledTaskStore / runs / events / runner
│   └── server.ts                          # 改：注册路由 + 启动心跳 + 关停；错误码映射
└── tests/
    ├── unit/scheduled-task-schedule.spec.ts     # 新增
    ├── unit/scheduled-task-store.spec.ts        # 新增
    ├── unit/scheduled-task-runner.spec.ts       # 新增（成功 / 失败 / 跳过 / 数字人不可用）
    └── integration/scheduled-tasks.spec.ts      # 新增（6 端点 + 错误码 + source 透出）

frontend/
├── src/
│   ├── api/
│   │   ├── scheduled-tasks.ts             # 新增：6 个方法
│   │   ├── scheduled-tasks.spec.ts        # 新增
│   │   └── types.ts                       # 改：Conversation.source + 任务/记录类型
│   ├── utils/
│   │   ├── schedule-format.ts             # 新增：时间/频率/次数/结果文案纯函数
│   │   └── schedule-format.spec.ts        # 新增
│   ├── composables/
│   │   ├── useScheduledTasks.ts           # 新增：列表/弹窗/CRUD/启停/SSE
│   │   ├── useScheduledTasks.spec.ts      # 新增
│   │   └── useAppSession.ts               # 改：装配 schedule；onSwitched 刷新
│   ├── components/
│   │   ├── common/BaseIcon.vue            # 改：新增 schedule（闪电）路径
│   │   ├── chat/ChatPanel.vue             # 改：actions-extra 内加闪电按钮；传 source
│   │   ├── chat/MessageList.vue           # 改：顶部渲染来源提示
│   │   ├── chat/ThreadSourceNotice.vue    # 新增（+ spec）
│   │   ├── layout/HistoryItem.vue         # 改：标题前闪电标记
│   │   └── schedule/
│   │       ├── ScheduleEntryButton.vue    # 新增（+ spec）
│   │       ├── SchedulePanel.vue          # 新增：覆盖层容器（+ spec）
│   │       ├── ScheduleTable.vue          # 新增：表头/行/空态（+ spec）
│   │       ├── ScheduleRow.vue            # 新增：六列 + 启停 + 删除（+ spec）
│   │       ├── ScheduleStatus.vue         # 新增：状态文字+圆点（+ spec）
│   │       ├── ScheduleCreateDialog.vue   # 新增：8 项表单校验（含会话模式复选框，+ spec）
│   │       └── ScheduleRunsDialog.vue     # 新增：运行记录 + 筛选 + 跳转（+ spec）
│   ├── views/WorkbenchView.vue            # 改：中栏包装层 + SchedulePanel
│   └── （受 Conversation.source 影响的测试夹具：useThreads / HistoryItem / ChatPanel 相关 spec）
```

**结构决策**：沿用既有四侧分层（`components` → `composables` → `api`，`utils` 纯函数）与后端 `routes` → `domain` → `infra`。不新建顶层目录、不新增依赖、不动 `admin-backend` / `admin-frontend`。

## 契约同步清单（宪章原则七的「四处同步」）

| 位置 | 改动 |
|---|---|
| 契约文档 | `contracts/scheduled-tasks-api.md`（6 端点 + 错误码 + SSE 信号；含 `new_thread_per_run` 与运行记录 `rebuilt`）与 `contracts/thread-source.md`（meta 扩展） |
| 前端类型 | `frontend/src/api/types.ts`：`ScheduledTask`（含 `new_thread_per_run`）/ `ScheduleRun`（含 `rebuilt`）/ `ScheduledTaskCreateRequest` / `Conversation.source` |
| 后端 schema | `routes/scheduled-tasks.ts` 的 body/querystring JSON Schema（`new_thread_per_run` 可选、缺省 `true`）+ `thread-store.ts` 的 `MetaFile.source` |
| 测试 | 后端 6 端点集成测试 + domain 单测（含复用与重建分支）；前端 api/composable/组件/纯函数 spec 与夹具 |

## 存量补测范围结论（宪章「同步影响报告」待办 1）

**待办要求**：`frontend` 的 `src/api/**` 与 `src/composables/**` 中尚无测试的模块，其补测顺序与范围 MUST 在下一个特性的 `plan.md` 给出结论，且 MUST NOT 发起存量补齐专项。

**本次结论**：

| 项 | 结论 |
|---|---|
| 范围 | 维持 `002` 已登记的清单口径，不新增范围。本特性**新增**的模块（`api/scheduled-tasks.ts`、`composables/useScheduledTasks.ts`、`utils/schedule-format.ts`、`components/schedule/**`）**全部从第一次提交起带同名测试**，不进入缺口清单 |
| 顺序 | 不变（① 网络与契约边界 ② 产出与预览 ③ 会话与流式 ④ 其余）；本特性**不改变**该顺序，也不借机推进 |
| 机制 | 仅"触达即补"：本次改动的存量文件（`useAppSession.ts`、`ChatPanel.vue`、`MessageList.vue`、`HistoryItem.vue`、`BaseIcon.vue`、`WorkbenchView.vue`）按宪章「改动部分及其直接受影响的测试」补齐；**不为清单内其余模块补测** |
| 全局地板 | 只可随补测上调，MUST NOT 下调 |

## 平台差异风险登记（宪章原则三）

| 风险 | 说明 | 处置 |
|---|---|---|
| 原子替换在 Windows / Linux 的差异 | `fs.renameSync` 在 Windows 上是 `MoveFileExW(REPLACE_EXISTING)`，可覆盖同名文件；但**杀毒软件占用或跨卷**时可能失败 | 写盘失败向上抛出并落 `error` 日志（`event: 'scheduled_task.store.write_failed'`），**不吞错**；下一轮巡检重试（心跳是天然的重试节拍），并在任务页可见错误 |
| 非 ASCII 任务名 / 会话标题 | 任务名与标题含中文 | 只作 JSON 字段与文件内容，不进路径；会话目录名仍是 UUID（沿用 `ThreadStore`） |
| 行尾符 | `runs.jsonl` 手动检查时可能在 Windows 编辑器下显示异常 | 统一以 `\n` 写入（Node 写字符串不转换），与 `history.jsonl` 同口径 |
| 时间与时区 | 容器默认 UTC、浏览器本地时区 | 存 ISO UTC，界面按本地时区格式化；比较用 epoch，不用字符串 |
| 无数据库的滚动增长 | `runs.jsonl` 会随任务长期运行增长 | 读取侧封顶 200 条（最新优先），写入侧不做删改；量大时在后续特性引入滚动清理，本次登记为已知限制 |

## 质量门禁

- `frontend`：`npm run lint`、`npm run typecheck`、`npm run test:coverage`（新增模块 ≥ 80%）、`npm run build`
- `agent-backend`：`npm run typecheck`、`npm run lint`、`npm run test:all`（单测 + 端点集成；`npm run test` 只跑单测，**不得**作为门禁）、`npm run build`
- **端点计时验证**（宪章原则五）：按 `SC-012` 口径（生产构建、100 任务 / 1000 条记录、每端点 20 次取 P95）实测 5 个端点 + SSE 首帧时延，**实测值 MUST 回填 `spec.md` 的 `SC-012` 结果位**，不允许只写目标值
- 手工验收：按 `quickstart.md` 的 S1~S11 逐项执行（含"隔 1 分钟触发两次""重启不补跑""复用模式连跑 3 次落在同一会话""删除会话后自动重建"四项必须实跑）
- **组件级无障碍验证**：每个新增/变更组件在其自身任务内完成键盘与读屏检查（宪章原则四），跨故事复核（S9）只作回归，不能替代
- 全部门禁在宿主机本地执行（容器不参与测试）

## 风险与行数预算

| 风险 | 现状 | 处置 |
|---|---|---|
| `ChatPanel.vue` 逼近上限 | 487 行 | 本次只加：`actions-extra` 内 1 个入口组件（1 行）、1 个 `@toggle` 处理（1 行）、1 个 `computed` 取会话来源（1 行）、1 个 prop 传递（1 行）≈ +5 行；若超 500，把 `actions-extra` 的两个子项抽成 `ChatActionsExtra.vue`（不改行为） |
| `useChatPanel.ts` 逼近上限 | 492 行 | **不在其中新增任何逻辑**：覆盖层开合状态放在 `useScheduledTasks`（`session.schedule`），`ChatPanel` 直接调 store |
| `server.ts` 逼近上限 | 493 行 | 只加 1 行路由注册 + 心跳启停各 1 行；装配细节移进 `domain/scheduled-task-runner.ts` 的工厂函数，错误码映射加 4 行 |
| `useAppSession.ts` | 306 行 | 只加 store 装配（≈6 行）与 `onSwitched` 内 1 行 |
| 定时任务的"后台执行"没有请求上下文 | 既有链路都以当前选中数字人为作用域 | 执行侧一律用任务绑定的 `agentName`，并**不**复用 `resolveAgentScope`（那是 HTTP 请求的作用域判定）；列表/CRUD 端点仍用 `resolveAgentScope`，两侧职责分开 |
| 心跳与关服竞态 | 关服时可能已派发但未收尾 | `stop()` 先置 `stopped` 标记再清 timer；已开跑的 run 由既有 drain 收尾；重启后按"不补跑"恢复 |
| 运行记录与真实状态可能短暂不一致 | 记录在 run 收尾后追加 | 记录缺失的后果仅为"少一条历史"，任务状态本身以 `tasks.json` 为准；登记为已知限制 |
| 复用模式下多轮共用一条 `history.jsonl` | 复用模式会让单个会话的历史随执行次数线性增长（次数上限 100 时最坏 200 条消息） | 每轮开跑前由 `RunManager` 按既有预算装配历史（内联工具结果有上限、外置结果只留索引），**不新增裁剪逻辑**；若实测首字延迟变差，在后续特性引入上下文预算，本次登记为已知限制 |
| 复用会话"先校验后写入"的并发窗口 | 两个任务不可能共用同一 `reused_thread_id`；同一任务由心跳串行派发且带 `inflight` 判据 | 复用会话的校验与执行都在同一任务串行路径内，无需额外锁；`threadStore.get` 失败即可判定为已删除（无第二种失败语义） |
| 重建会话时的 `source` 漂移 | 重建出的会话若漏写 `source`，左栏闪电标记会消失（`SC-004`） | 重建走的仍是同一个 `threadStore.create({source})` 分支，唯一写入口；集成测试断言重建会话带 `source` |

## 增补修订记录

| 日期 | 变更 | 影响 |
|---|---|---|
| 2026-10-29 | 首个计划版本 | — |
| 2026-10-30 | 按 spec 增补「会话复用模式」：任务新增 `new_thread_per_run` 与 `reused_thread_id`；执行器增加"复用 / 重建"分支；运行记录增 `rebuilt`；创建弹窗由 7 项变 8 项；quickstart 增 S10 | 无架构变更（仍复用 `RunManager` 与同一存储），宪章检查结论不变（9/9 通过，无例外）；`ChatPanel` 行数预算不受影响（新逻辑在 `ScheduleCreateDialog` 与后端） |
| 2026-10-30（分析修复） | 吸收规格分析报告：①补端点计时验证门禁（`SC-012`）；②组件级键盘/读屏验证落到各组件任务；③次数口径回写为 `FR-041` 正文；④SSE 重连有界（1/2/4/8/16s，上限 5 次 → `degraded`）；⑤补重启恢复、多任务同刻、用户隔离、计数口径、覆盖层无副作用等测试任务；⑥ticker 改用 `registerDispatcher` 注入以避免 Phase 2 依赖 Phase 3；⑦运行记录的会话存在性检查归 `domain/` | 宪章合规缺口关闭；实施顺序新增 `T016a`/`T028a`/`T031a`/`T032a`/`T041a`/`T072a`；无架构变更 |
| 2026-10-31（端点落地） | ①`VALIDATION_FAILED` 的 `details` **沿用既有 `string[]`**（每项 `字段名: 说明`），不为此新增第二种错误体——`ApiError.details` 的类型被 `files-upload` 的既有测试依赖，贸然改成对象会波及无关端点；②未声明字段的拒绝走 **`preValidation` 显式校验**（`assertKnownFields`）：Fastify 默认 ajv 是 `removeAdditional: true`，`additionalProperties: false` 只会静默丢字段、不会 400；③`GET runs` 的 `FR-022` 过滤放在 **`run-store.read` 的 `onlyTaskIds` 入参**（域层过滤，`total` 同步收敛），路由只传"仍存在的任务 id"；④用户显式启用会清掉 `agent_unavailable` 标注（若仍不可用，下一次触发按 `FR-055` 再停用一次） | 契约文档 §2/§3/§5 已同步；集成测试 27 条覆盖 6 端点 + 4 错误码 + 隔离 + SSE 首帧 | 无依赖与架构变更 |
| 2026-10-31（实现取舍） | ①**"占时刻"与"计次数"分流**：§1 原写"到点后先写下次数 +1 与 `next_run_at` 再执行"，与 `FR-041`/`FR-043`（跳过不计次数）冲突——被跳过的三种情形发生在派发之后，先 +1 就退不回来。实现改为：心跳只调 `advanceWithoutCount` 推进 `next_run_at`（防重复触发的语义不变），执行器在 `startRun` **成功之后**调 `markTriggered` 计次（其 `nextRunAt` 入参改为可选，避免二次写盘）。②**复用模式 `meta` 不可读按"会话已删"处理**：`ThreadStore.get` 对"目录不存在"与"JSON 不可解析"都抛 `ThreadNotFoundError`，两者在存储层不可区分，故走重建而不是 `T059` 所写的 `failed`（重建后任务仍可用，且不会误停用任务）。③**`server.ts` 行数门禁**：装配搬到 `src/server-schedule.ts`（`buildScheduledTasks`），实例取用口搬到 `src/server-agents.ts`（`createAgentProvider`），`server.ts` 由 493 降到 476 行 | 心跳与执行器职责更清（心跳不关心成败），`store.markTriggered` 语义改为"本轮真正开跑"；`T028a` 的计数口径由 `scheduled-task-runner.spec.ts` 钉住；无新增依赖、无端点契约变更 |

## 复杂度跟踪

无宪章违反项，无需登记例外。行数预算、平台差异与已知限制已在上述两节说明。
