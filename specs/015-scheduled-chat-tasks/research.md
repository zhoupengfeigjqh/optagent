# 技术研究：聊天区定时任务

**特性**：`015-scheduled-chat-tasks` ｜ **日期**：2026-10-29

本文件解决 `plan.md` 技术上下文中的全部决策点。所有结论均已落到具体文件与接口，无遗留 `NEEDS CLARIFICATION`。

---

## D1 调度机制：单心跳巡检 vs 每任务定时器

**Decision**：新增 `infra/scheduled-task-ticker.ts`，用**一个** `setInterval(1000)`（`unref()`）巡检全部已启用任务；到点任务由 `next_run_at` 判据选出后派发，派发不阻塞下一轮巡检。不使用 cron 表达式，也不为每个任务单独建 timer。

**Rationale**：
- 任务的启停、删除、次数用尽、截止到期、重启恢复，全部是"下次该不该触发"的判断；收敛到一个纯函数（`scheduled-task-schedule.ts`）后可以完全单测，不必调度真实时钟。
- 每任务一个 timer 需要与持久化状态做双向同步（建/删/改/启停/重启），任何一处漏清就是幽灵触发，且 timer 数量随任务线性增长。
- 秒级精度足够：`SC-003` 允许 ≤5s 偏差，1s 巡检的固有延迟最多 1s。
- 无新依赖：cron 库要引入依赖且需求只定义"固定间隔秒数"（原则六）。

**Alternatives considered**：
- *每任务 `setTimeout` 链*：重启后要重建全部定时器，且"错过不补跑"需要在启动期做二次判断，逻辑分散。
- *cron 表达式（node-cron 等）*：语义超出需求，多一个依赖与一套表达式校验。
- *外部调度（系统 crontab 调 HTTP）*：把功能可用性绑到部署环境，违背"一条 compose 拉起全栈"与原则八。

---

## D2 任务存储形式：JSON 文件 + 追加日志

**Decision**：
- `users/{uid}/user-data/{agent}/scheduled-tasks/tasks.json`：任务集合，整体读、整体写，写入走"临时文件 + `rename` 原子替换"，同（用户，数字人）粒度串行。
- `users/{uid}/user-data/{agent}/scheduled-tasks/runs.jsonl`：执行记录逐条追加。

**Rationale**：
- 与 `threads/` 同域，**数字人隔离由目录位置承载**，与 `ThreadStore` 的既有口径一致（不需要在每处再校验 agent）。
- 平台部署只覆盖数字人配置目录与 `scenario.json`，不触碰 `user-data/`，任务因此不因重新部署被抹掉（符合"文件空间内容保留"的既有部署语义）。
- 不引入数据库：项目规模与数据量（任务 ≤100、记录按 200 条读取）用文件完全够，`better-sqlite3` 已存在但只为 usage 记账，再开一张表会引入迁移成本（原则六）。
- 记录用 `jsonl` 追加而非改写 JSON 数组：运行记录只增不改，追加是 O(1)，改写整个数组会在长跑后变成 O(n) 且放大"写一半"的风险。

**Alternatives considered**：
- *SQLite 表*：需要迁移脚本、并发写锁语义，收益是查询能力——本场景不需要。
- *按任务一个文件*（`tasks/{id}.json`）：删除/启停要跨文件操作，列表要扫目录，名称唯一校验还得全量扫描，反而更复杂。

---

## D3 触发执行：复用 `RunManager` 内部链路

**Decision**：`domain/scheduled-task-runner.ts` 按固定顺序调用既有方法：`loadAgentConfig` → `threadStore.create({title, source})` → `runManager.acquireQuota` → `getOrCreateAgent` → `agent.mcpReady(timeout)` → `runManager.startRun` → `run.subscribe` 捕获 `done`/`error` → `await run.settled` → 追加记录 + `threadStore.touch` + 广播信号。

**Rationale**：
- 历史落盘、usage 记账、工具事件、下一步动作提示、并发上限、思考开关、崩溃回收（`onCrash`）全部在这一条链上；另写一套"定时执行"必然与手动对话漂移（原则二"同一职责只有一处实现"）。
- 不走 HTTP 回环：回环要伪造请求上下文、重复一次参数校验，并让后台能力依赖"HTTP 服务可用 + 端口可访问"。
- `RunImpl` 在没有订阅者时也能正常运行（事件总线为空集合，落盘不依赖订阅者），因此后台执行不需要"假 SSE 客户端"。

**Alternatives considered**：
- *HTTP 自调用 `POST /api/threads/:id/messages`*：需要传 SSE 并消费整条流，还要处理 409/断连；契约上会多出"内部调用者的身份"问题。
- *直接调用 `agent.run()` 并自行落盘*：绕过 `RunManager` 的配额、崩溃回收与统一落盘，等于第二套实现。

---

## D4 次数与并发的口径（对 spec 假设的落地细化）

**Decision**：
- 只有**真正开跑的一轮**（`success` / `failed`）计入 `executed_count`。
- 未开跑而结束的三种情况记为 `skipped`、**不计次数**：① 同一任务上一轮仍在执行；② 用户并发额度已满（`THREAD_BUSY_LIMIT`）；③ 数字人不可用（同时把任务自动停用）。
- 不自动重试；失败原因写入记录。

**Rationale**：spec `FR-041`/`FR-044` 的口径是"每次触发（无论成功失败）+1"，语境是"已经跑了一轮"；把"根本没跑起来"也算进次数，会让用户在一个忙碌时段白白消耗次数，与"次数是用户买到的执行机会"这一直觉冲突，也违反 `FR-043` 对跳过"不计入次数"的明文要求。

**Alternatives considered**：*全部计入*（简单但会误伤）；*失败不计数*（会让无限失败的任务永远不终止，与 `FR-042` 冲突）。

---

## D5 会话来源标记的落点

**Decision**：扩展会话元数据 `meta.json`：可选 `source = { type: 'scheduled_task', task_id, task_name, triggered_at }`；`ThreadMeta`/`MetaFile`/`metaJson()` 三处同步；前端 `Conversation.source?`。

**Rationale**：
- 来源是**会话级**事实；写在 meta 上，会话列表接口零额外读盘就能带上标记（左栏闪电图标需要它，`FR-039`）。
- 与既有"可选字段有值才写"的口径一致（`HistoryMessage` 的可选字段就是这样），旧数据天然兼容。
- 会话标题按"任务名 + 触发时刻"预置在 `create()`，因此不依赖"首条消息前 20 字"的默认标题回落。

**Alternatives considered**：*消息级字段*（每条消息带来源）——无法回答"这个会话是不是定时任务"，且会让历史行变胖；*按标题前缀嗅探*——把展示文案当数据，改名即失效。

---

## D6 前端实时性：SSE 纯信号 vs 轮询

**Decision**：新增 `GET /api/scheduled-tasks/events`（SSE，事件名 `scheduled-task`，**负载为空**，建连即推一次 + 25s 心跳）。前端收到信号后刷新任务列表，并调用 `threads.loadList()` 刷新左栏；不切换当前会话。

**Rationale**：
- 与既有 `produced/events`、MCP 状态推送同构，前端已有手写 SSE 解析，无新依赖。
- 纯信号 + 可重算：断连、刷新、信号丢失都无后果（列表与记录都能从文件重算），符合原则九"降级不掩盖问题"。
- 轮询会带来空闲请求与 5~10s 的可见延迟，而 `SC-004` 要求标记 100% 出现。

**Alternatives considered**：*10s 轮询*（简单但延迟 + 无谓请求）；*推送完整数据*（负载与序列化成本无收益，且要处理增量合并）。

**重连策略（2026-10-30 补，宪章原则九）**：断连后指数退避 1s / 2s / 4s / 8s / 16s，**最多 5 次**；超限把订阅状态置 `degraded`，界面显示"实时更新已暂停，可手动刷新"。理由：既有的 `produced` 订阅是"断开就重连"的简单循环，在服务重启/网络抖动下会变成无界重试；本特性带"实时刷新会话侧栏"的副作用，无界重连会把失败放大成持续请求。被否决的替代：*无限重连*（违反"重试有界"）、*断开即放弃不提示*（用户会把"没刷新"当成"任务没执行"）。

---

## D7 覆盖层的实现形态

**Decision**：`SchedulePanel.vue` 挂在 `WorkbenchView` 中栏槽位内，与 `ChatPanel` 同级，外层包装 div 设 `position: relative`，面板 `position: absolute; inset: 0`，背景色用 `--color-surface`。

**Rationale**：
- 需求是"覆盖整个聊天区（不含左侧任务栏）"：中栏即聊天区，左栏在 `AppShell` 网格的另一列，天然不被覆盖。
- `ChatPanel.vue` 已 487 行，把覆盖层挂在外层可以完全不改它的骨架。
- Esc 由覆盖层自己监听（打开时关闭自己），不影响 `ChatPanel` 既有"Esc 终止本轮"的瀑布；`<dialog>` 的 Esc 仍在最前。

**Alternatives considered**：*路由页*（整页切换、三栏重排、返回态处理）；*`<dialog>`*（遮住左栏，与需求冲突）；*挂在 `ChatPanel` 内部*（行数超限风险）。

---

## D8 日期时间选择与时间语义

**Decision**：创建弹窗用已安装的 `ant-design-vue` 的 `a-date-picker` + `show-time`（秒精度）；表单值用 `dayjs` 处理，提交前转 `toISOString()`；服务端存 ISO UTC，触发判定用 `Date.parse` 的 epoch。

**Rationale**：`ant-design-vue` 与 `dayjs` 已在依赖表（`datapage` 已用 antd），零新增依赖；秒级选择原生支持。存 UTC 避免"字符串比较 + 时区推断"的双重不确定性（`FR-058`）。

**Alternatives considered**：*原生 `input[type=datetime-local]`*（无秒级支持差异、样式与既有界面割裂）；*自建时间选择器*（无必要）。

---

## D9 校验归属：前端即时 + 服务端权威

**Decision**：同一套规则写两处但**目的不同**：前端用于即时字段提示（体验），服务端用于权威拒绝（含 `details.field`），错误码统一 `VALIDATION_FAILED`。

**Rationale**：前端校验不能作为安全边界；服务端校验不能给出即时体验。两者文案口径一致（逐条见 `data-model.md` §6 校验表），避免"前端能过、后端拒绝"的悬空体验。

**Alternatives considered**：*只做服务端*（每次错误都要一次往返）；*只做前端*（可绕过，且 `FR-026`/`FR-030` 是硬规则）。

---

## D10 错误码与状态映射

**Decision**：新增 4 个领域错误码，映射进 `server.ts` 的 `DOMAIN_ERROR_STATUS`：

| 错误码 | HTTP | 触发场景 |
|---|---|---|
| `SCHEDULED_TASK_NOT_FOUND` | 404 | 任务不存在（或不属于当前作用域，与"不存在"不可区分） |
| `SCHEDULED_TASK_NAME_CONFLICT` | 409 | 同一数字人下任务名重复 |
| `SCHEDULED_TASK_ENABLED` | 409 | 启用中删除（必须先停用） |
| `SCHEDULED_TASK_EXHAUSTED` | 409 | 启动一个次数用尽 / 已过截止的任务 |

**Rationale**：与既有错误码风格（大写下划线、语义稳定、全局唯一）一致；每种失败都有唯一码，前端可分别给出可读文案（`FR-056`）。

**Alternatives considered**：*复用 `VALIDATION_FAILED`*——会让"名称冲突"与"字段非法"无法区分，违反"同码不同义"禁令。

---

## D11 测试策略

**Decision**：

| 层 | 覆盖 |
|---|---|
| `scheduled-task-schedule.ts` | 纯函数表驱动：首跑时刻、间隔推进、次数用尽、跨截止、边界（恰好等于截止 / 恰好等于次数） |
| `scheduled-task-store.ts` | 临时目录：创建/读写往返、原子替换后无 `.tmp` 残留、名称冲突、损坏 JSON 抛错、并发写不互相覆盖 |
| `scheduled-task-runner.ts` | 桩 `RunManager`/`threadStore`/`agent`：成功、失败、跳过（上一轮未完 / 额度满）、数字人不可用 → 停用 |
| `routes/scheduled-tasks.ts` | Fastify `inject`：6 端点状态码 + 响应体 + 4 个错误码 + `source` 透出 |
| 前端 | 每个新组件 spec（props / emit / 边界：空列表、禁用态、校验失败、加载失败）；`useScheduledTasks` spec（含 SSE 信号触发刷新、SSE 断开不报错）；`schedule-format` 纯函数 spec |

**Rationale**：宪章原则三要求"每个端点有集成测试、核心业务有三类单测、降级路径有测试"。心跳本身不做真实时钟测试（避免 flaky），把可测判断全部下沉到纯函数。

**Alternatives considered**：*假时钟驱动心跳*（可行但对"派发不 await"与文件 IO 的耦合过强，收益低）；*端到端等待真实 60s 触发*（只放在 `quickstart.md` 手工验收）。

---

## D12 已知限制（登记）

1. `runs.jsonl` 只增不删，长期运行会增长；读取封顶 200 条，清理留待后续特性。
2. 进程在"已开跑但未收尾"时被强杀 → 该轮的执行记录缺失（次数已 +1，任务状态不会被重复触发）。取舍理由：次数先占后跑，宁可少一条记录，不可重复跑一轮。
3. 定时任务页的列表刷新依赖 SSE 信号；信号断连时需重新打开页面或切换数字人才看到最新次数（不视为错误，界面不谎报状态）。
4. 任务与数字人强绑定：数字人被删除后任务自动停用但保留记录，用户可自行删除。

---

## D13 会话复用模式（2026-10-30 增补）

**Decision**：任务增加 `new_thread_per_run`（默认 `true`）。为 `false` 时任务保存 `reused_thread_id`，首轮建会话、后续轮次把任务提示词作为**新增 user 消息**追加到同一会话；每次触发前用 `threadStore.get` 校验会话存在，已删除则新建并更新 `reused_thread_id`，记录标 `rebuilt`。

**Rationale**：
- 复用会话语义与"用户在聊天区继续追问同一会话"完全一致，因此**不需要新的执行路径**——`RunManager.startRun` 本来就按 `threadId` 组织单轮，历史由 `HistoryStore` 从该会话读；差异只在"用哪个 threadId"。
- 会话存在性用 `get`（单文件读）判定的成本是 O(1)，且 `ThreadNotFoundError` 已是既有语义，不必新增错误码。
- 默认 `true` 保证升级前后行为一致（`FR-064`）；不做"模式可改"是为了避免"哪几轮在哪个会话"无法解释。

**Alternatives considered**：
- *复用会话时把任务提示词拼成一条"累计消息"*：破坏"每轮一次问答"的历史结构，消息气泡与耗时/usage 记账都对不上。
- *会话被删即停用任务*（更保守）：用户删一次会话就让任务失效，与"无人值守"目标冲突（已由澄清 Q1 否决）。
- *模式可改（PATCH）*：需要额外端点、额外确认语义（改后已有会话如何归属），收益不足以抵消复杂度。

**已知限制**：复用会话的历史随执行次数线性增长（次数上限 100 时最坏 200 条消息），本轮不做额外上下文裁剪，依赖 `RunManager` 既有预算；若实测首字延迟变差，后续特性引入上下文预算。
