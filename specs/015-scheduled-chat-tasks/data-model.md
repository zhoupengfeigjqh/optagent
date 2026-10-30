# 数据模型：聊天区定时任务

**特性**：`015-scheduled-chat-tasks` ｜ **日期**：2026-10-29 ｜ **依据**：[spec.md](./spec.md) 的「关键实体」

本特性**不引入数据库**，数据以文件形式落在数字人数据域内。以下字段同时是接口契约（`snake_case`）与磁盘格式的权威定义。

---

## 1. 存储布局

```text
agent-backend/.opt-agent/users/{userId}/user-data/{agentName}/scheduled-tasks/
├── tasks.json     # 任务集合（整体读、原子替换写）
└── runs.jsonl     # 执行记录（逐行追加，只增不改）
```

- `userId` / `agentName` 由**目录位置**承载，文件内不再重复保存为权威字段；`agent_name` 仍写入任务对象，用于执行期自校验（发现与目录不一致即停用该任务并落日志，避免"跨数字人执行"）。
- 目录缺失 = 没有任务（不是错误）；`tasks.json` 存在但不可解析 = 存储损坏（抛错 + 日志，**不静默清空**）。

**`tasks.json` 文件结构**（版本字段用于后续迁移）：

```json
{
  "version": 1,
  "tasks": [ /* ScheduledTask[]，见 §2 */ ]
}
```

---

## 2. 实体：定时任务（ScheduledTask）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `task_id` | string | UUID，服务端生成 | 稳定标识；运行记录通过它关联 |
| `name` | string | 必填，trim 后 1~50 字符，同（用户，数字人）内唯一 | 列表首列；会话名前缀 |
| `prompt` | string | 必填，长度上限与聊天输入框单条消息上限一致 | 每次执行作为该会话的首条 user 消息 |
| `thinking` | boolean | 必填，默认继承创建时聊天区的当前值 | 与聊天区思考开关同一语义，只作用于本任务 |
| `start_at` | string | ISO 8601 UTC，必须晚于创建时刻 | 首次触发时刻（秒级） |
| `interval_seconds` | integer | ≥ 1 | 执行频率（间隔秒数） |
| `max_runs` | integer | ≥ 1 | 执行次数上限 |
| `deadline_at` | string | ISO 8601 UTC，严格大于 `start_at` | 有效截止时刻（秒级） |
| `new_thread_per_run` | boolean | 默认 `true`；创建后不可修改（`FR-059`/`FR-060`） | `true` = 每次执行新建会话；`false` = 复用同一会话 |
| `reused_thread_id` | string \| null | 仅 `new_thread_per_run === false` 时有值 | 复用模式下的会话标识（首轮创建时写入，重建后更新为最新会话） |
| `enabled` | boolean | 默认 `false`（创建不自动启用） | 三角启动按钮的状态 |
| `executed_count` | integer | ≥ 0，默认 0 | 已执行次数；**只有已开跑的一轮**（`success` / `failed`）计数，`skipped` 不计（`FR-041` / `FR-043`） |
| `next_run_at` | string \| null | ISO 8601 UTC；`null` 表示无待执行时刻 | 调度判据：`enabled && next_run_at <= now` 即触发 |
| `last_run_at` | string \| null | ISO 8601 UTC | 最近一次触发时刻（展示与排障用） |
| `disabled_reason` | enum \| null | `'agent_unavailable'` / `null` | 系统自动停用的原因；用户手动停用为 `null` |
| `agent_name` | string | 与所在目录一致 | 执行期身份（不取"当前选中数字人"） |
| `created_at` / `updated_at` | string | ISO 8601 UTC | 列表按 `created_at` 倒序 |

**派生字段（不落盘，接口下发时现算）**：

| 字段 | 计算 |
|---|---|
| `status` | `enabled && !isTerminated && next_run_at !== null` → `'running'`，否则 `'idle'` |
| `terminated` | `executed_count >= max_runs` 或 `now > deadline_at` |
| `can_start` | `!terminated && disabled_reason === null` → 启动按钮可用 |

> 刻意不把 `status` 落盘：它是 `enabled` + 次数 + 截止 + 当前时刻的函数，落盘就会漂移（原则五"不落第二份可漂移的状态"）。

---

## 3. 实体：执行记录（ScheduleRun）

`runs.jsonl` 每行一个 JSON 对象：

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | UUID，单条记录标识 |
| `task_id` | string | 所属任务 |
| `task_name` | string | 触发时刻的任务名快照（任务改名/删除后记录仍可读） |
| `agent_name` | string | 归属数字人 |
| `triggered_at` | string | 计划触发时刻（ISO UTC） |
| `finished_at` | string \| null | 收尾时刻；`skipped` 时等于 `triggered_at` |
| `result` | enum | `'success'` / `'failed'` / `'skipped'` |
| `reason` | enum \| null | `'previous_run_active'` / `'busy_limit'` / `'agent_unavailable'` / `'run_failed'` / `null` |
| `reason_text` | string \| null | 面向用户的中文原因摘要（失败时为错误消息，长度截断到 200 字符） |
| `thread_id` | string \| null | 执行产生的会话；`skipped` 时为 `null` |
| `thread_title` | string \| null | 会话名快照（= 任务名 + 触发时刻；复用模式下为该会话创建时的名称） |
| `rebuilt` | boolean | 复用模式下本次触发因原会话已被删除而重建会话；`skipped` 或新建模式下为 `false` |
| `thread_deleted` | boolean | 展示标记：读取时若会话已不存在则回填 `true`（不落盘）；判定 MUST 由 `domain/` 层（`thread-store` 的存在性检查）提供，路由层只做映射 |

**为什么存快照**（`task_name` / `thread_title`）：运行记录的价值是"追溯历史"，任务被删除或改名后，历史仍应说清"当时是哪个任务、哪次会话"。

---

## 4. 实体：会话来源标记（ThreadSource）

写入 `threads/{thread_id}/meta.json` 的可选字段：

```json
{
  "thread_id": "…",
  "agent_name": "…",
  "title": "日报生成 2026-10-30 09:00:00",
  "created_at": "2026-10-30T01:00:00.000Z",
  "updated_at": "2026-10-30T01:00:42.000Z",
  "source": {
    "type": "scheduled_task",
    "task_id": "…",
    "task_name": "日报生成",
    "triggered_at": "2026-10-30T01:00:00.000Z"
  }
}
```

- `source` **缺省不写**（普通会话与历史数据完全不受影响）。
- 会话标题在创建时预置，因此不会回落到"首条用户消息前 20 字"。
- 前端 `Conversation.source?: ThreadSource`：列表接口据此画左栏闪电标记，详情接口据此在消息流顶部显示来源提示。

---

## 5. 状态流转

### 5.1 任务生命周期

```text
[创建] ──enabled=false──> 未开始(idle, 白色)
                              │  ▲
                     启用(开) │  │ 停用(关)
                              ▼  │
                          执行中(running, 绿色)
                              │
        次数用尽 / 超过截止 ────┴──> 未开始(idle) + terminated=true（启动按钮禁用）
```

| 事件 | `enabled` | `next_run_at` | `executed_count` | 说明 |
|---|---|---|---|---|
| 创建成功 | `false` | `start_at`（预置） | 0 | 列表首位、状态"未开始" |
| 启用 | `true` | 若 `next_run_at` 为过去时刻且未终止 → 推进到下一个未来时刻 | 不变 | `FR-014`；不补跑 |
| 停用 | `false` | 保留（下次启用时重算） | 不变 | `FR-015`：不打断已开始的一轮 |
| 到点触发 | `true` | 推进到"`next_run_at + interval`，若 ≤ now 则继续推进到 > now" | +1（先占后跑） | 重启不重复触发 |
| 一轮成功 | `true` | 已推进 | 已 +1 | 追加 `success` 记录 |
| 一轮失败 | `true` | 已推进 | 已 +1 | 追加 `failed` 记录（含原因） |
| 复用会话被用户删除 | `true`（保持） | 已推进 | 已 +1 | 下一次触发自动新建会话并更新 `reused_thread_id`（记录 `rebuilt=true`），任务不停用 |
| 上一轮未结束 | `true` | 推进（不占用） | 不变 | 追加 `skipped`（`previous_run_active`） |
| 并发额度已满 | `true` | 推进（不占用） | 不变 | 追加 `skipped`（`busy_limit`） |
| 数字人不可用 | `false` | `null` | 不变 | `disabled_reason='agent_unavailable'` + `skipped` 记录 |
| 次数用尽 / 超截止 | `true`（保持） | `null` | 不变 | 派生 `terminated`，不再触发 |
| 删除 | — | — | — | 仅在 `enabled=false` 时允许；会话与历史保留 |

### 5.2 执行一次的状态机（runner）

```text
触发
 ├─ 数字人配置不可用 ────────────> skipped(agent_unavailable) + 自动停用 + 广播
 ├─ 该任务上一轮仍在执行 ───────> skipped(previous_run_active)
 ├─ 确定本轮会话（见 5.3）
 │   ├─ new_thread_per_run = true ───> 新建会话（title = 任务名 + 本次触发时刻，带 source）
 │   └─ new_thread_per_run = false
 │       ├─ reused_thread_id 的会话仍存在 ─> 复用（不建会话、不改标题）
 │       └─ 会话已被删除 ─────────────────> 新建会话（带 source）+ rebuilt = true，更新 reused_thread_id
 ├─ acquireQuota 失败(额度满) ───> skipped(busy_limit)
 ├─ 取实例失败 / 池满 ───────────> failed(run_failed, 原因) [计入次数]
 └─ startRun → done/error → settle
     ├─ done ───────────────────> success
     └─ error / status=failed ──> failed(run_failed, 原因截断 200 字)
```

### 5.3 会话归属（由 `new_thread_per_run` 决定）

| 模式 | 首轮 | 后续轮次 | 会话标题 | `reused_thread_id` |
|---|---|---|---|---|
| `true`（默认，每次新建对话） | 新建会话，名称「任务名 + 本次触发时刻」 | 每轮各新建一个会话 | 各自独立 | 恒为 `null` |
| `false`（复用同一会话） | 新建会话，名称「任务名 + 首次触发时刻」 | 追加到同一会话（任务提示词作为新的一轮 user 消息） | 保持创建时名称；用户重命名后不覆写（`FR-063`） | 首轮写入；会话被删后更新为新会话 |

**不变式**：

1. 同一任务在同一时刻最多只有一轮执行（心跳串行 + `inflight` 判据），因此复用会话不会被并发写入。
2. 每轮开跑前都会重新校验 `reused_thread_id` 的会话存在性，因此"用户随时删会话"不会导致本轮写进已删目录。
3. 两种模式产生的会话都带 `source`，来源标记与左栏闪电图标不因模式不同而缺失。
4. 会话不存在是**正常分支**（重建），不写 `failed`、不消耗次数。

---

## 6. 校验规则（前后端同一套）

| 字段 | 规则 | 失败提示（中文） |
|---|---|---|
| `name` | trim 后非空 | 请填写任务名称 |
| `name` | 长度 ≤ 50 | 任务名称不能超过 50 个字符 |
| `name` | 同（用户，数字人）唯一 | 任务名称已存在 |
| `prompt` | trim 后非空 | 请填写任务提示词 |
| `prompt` | ≤ 聊天输入框单条消息上限 | 任务提示词超出长度上限（当前 N 字） |
| `start_at` | 可解析的时刻 | 请选择执行开始时间 |
| `start_at` | `> now` | 开始时间必须晚于当前时间 |
| `interval_seconds` | 整数且 ≥ 1 | 执行频率必须是不小于 1 的整数秒 |
| `max_runs` | 整数且 ≥ 1 | 执行次数必须是大于等于 1 的整数 |
| `deadline_at` | 可解析的时刻 | 请选择有效截止时间 |
| `deadline_at` | `> start_at` | 有效截止时间必须晚于开始时间 |
| `interval × max_runs` | 允许越过 `deadline_at` | 不报错（两者都是硬约束，先到者终止） |

---

## 7. 索引与读取模式

| 场景 | 读取方式 | 成本 |
|---|---|---|
| 任务列表 | 读一次 `tasks.json`（全量） | O(任务数)，任务 ≤100 |
| 心跳巡检 | 每轮扫描 `users/*/user-data/*/scheduled-tasks/tasks.json` | O(用户 × 数字人)，单用户场景下为个位数文件 |
| 运行记录 | 逆序读 `runs.jsonl`，`limit` 封顶 200，可选 `task_id` 过滤 | O(记录数) 的一次顺序读，不逐条查会话 |
| 左栏闪电标记 | 会话列表已读 `meta.json`，`source` 随列表下发 | 零额外 IO（`FR-039`） |
| 运行记录 → 会话是否存在 | **不逐条 `get`**：前端点击跳转失败（404）时标注"会话已删除" | 避免 N+1（原则五） |
| 复用模式的会话存在性校验 | 每轮触发前一次 `threadStore.get`（单文件读），失败即判定为已删除 | O(1)，仅复用模式，每轮一次 |
