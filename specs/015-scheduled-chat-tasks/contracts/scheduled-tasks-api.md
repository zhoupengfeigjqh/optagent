# 接口契约：定时任务

**特性**：`015-scheduled-chat-tasks` ｜ **版本**：1.1（2026-10-30 增补编辑端点）
**前缀**：`/api/scheduled-tasks` ｜ **作用域**：当前用户（`getCurrentUser()`）+ **服务端当前选中数字人**（`resolveAgentScope`）

通用约定沿用仓库既有口径：

- 成功：`200` / `201` / `204`；失败：`{ "error": { "code": "...", "message": "...", "details"?: ... } }`（`details` 仅在字段级校验失败时出现）。
- 所有时间字段均为 **ISO 8601 UTC 字符串**（如 `2026-10-30T01:00:00.000Z`），客户端按本地时区展示。
- 未选中数字人 → `409 AGENT_NOT_SELECTED`；已选中但不可用 → `409 AGENT_NOT_AVAILABLE`（沿用既有码）。
- 任务不属于当前数字人 → `404 SCHEDULED_TASK_NOT_FOUND`（与"不存在"不可区分，不泄露存在性）。

---

## 1. `GET /api/scheduled-tasks`

任务列表（当前用户 + 当前数字人），按 `created_at` **倒序**。

**响应 200**：

```json
{
  "tasks": [
    {
      "task_id": "b3f1…",
      "name": "日报生成",
      "prompt": "汇总昨天的订单并生成日报",
      "thinking": false,
      "start_at": "2026-10-30T01:00:00.000Z",
      "interval_seconds": 86400,
      "max_runs": 30,
      "deadline_at": "2026-11-29T01:00:00.000Z",
      "new_thread_per_run": true,
      "enabled": true,
      "executed_count": 3,
      "status": "running",
      "terminated": false,
      "can_start": true,
      "disabled_reason": null,
      "next_run_at": "2026-11-02T01:00:00.000Z",
      "last_run_at": "2026-11-01T01:00:00.000Z",
      "agent_name": "数据分析师",
      "created_at": "2026-10-29T08:00:00.000Z",
      "updated_at": "2026-11-01T01:00:42.000Z"
    }
  ]
}
```

**说明**：`status` / `terminated` / `can_start` 是服务端现算的派生字段（前端 MUST NOT 自行推导，避免两处口径）；`tasks` 为空数组表示"还没有任务"（不是错误）。存储损坏 → `500 INTERNAL_ERROR` + 结构化日志，**不返回空数组冒充空列表**（`FR-057`）。复用模式的 `reused_thread_id` 是**服务端内部字段**，不出现在响应中（前端不需要它：会话归属由运行记录与左栏会话体现）。

---

## 2. `POST /api/scheduled-tasks`

创建任务。**不自动启用**（`FR-032`）。

**请求体**（`additionalProperties: false`）：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `name` | string | 是 | trim 后 1~50，同作用域唯一 |
| `prompt` | string | 是 | trim 后非空，长度上限与聊天输入框单条消息上限一致 |
| `thinking` | boolean | 否 | 缺省 `false` |
| `start_at` | string | 是 | ISO 8601，必须晚于当前时刻 |
| `interval_seconds` | integer | 是 | ≥ 1 |
| `max_runs` | integer | 是 | ≥ 1 |
| `deadline_at` | string | 是 | ISO 8601，严格大于 `start_at` |
| `new_thread_per_run` | boolean | 否 | 缺省 `true`（每次执行新建会话）；`false` = 所有执行复用同一会话。创建后不可修改（`FR-060`） |

**响应 201**：`{ "task": ScheduledTask }`（完整对象，含派生字段）。

**错误**：

| 码 | HTTP | 场景 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 任一字段不满足约束；`details` 为字符串数组，每项形如 `字段名: 说明`，首个不符即拒绝（与 Fastify schema 的 first-error 口径一致） |
| `SCHEDULED_TASK_NAME_CONFLICT` | 409 | 同作用域已有同名任务 |

### 2.1 会话复用模式（`new_thread_per_run`）

| 值 | 行为 | 会话标题 |
|---|---|---|
| `true`（缺省） | 每次触发新建一个会话（`FR-036` 的既有口径） | 「任务名 + 本次触发时刻」 |
| `false` | 首次触发建会话，之后每轮都追加到该会话（任务提示词作为新的一轮 user 消息） | 「任务名 + 首次触发时刻」；用户重命名后不覆写 |

- 任务内部保存 `reused_thread_id`（**不下发**给客户端）：首轮写入，会话被删除后由下一次触发重建并更新。
- 取消勾选**不影响**已产生的会话；切换模式不可行（创建后不可改，`FR-060`）。
- 复用模式下运行记录仍**每次一条**，多条记录共享同一 `thread_id` / `thread_title`；被删除后重建的那一条带 `rebuilt: true`。

---

## 3. `PATCH /api/scheduled-tasks/{task_id}/enabled`

启用 / 停用（`FR-013`~`FR-016`）。

**请求体**：`{ "enabled": true }`（必填布尔）。

**响应 200**：`{ "task": ScheduledTask }`（`next_run_at` 已按新状态重算）。

**错误**：

| 码 | HTTP | 场景 |
|---|---|---|
| `SCHEDULED_TASK_NOT_FOUND` | 404 | 任务不存在 / 不属于当前数字人 |
| `SCHEDULED_TASK_EXHAUSTED` | 409 | `enabled=true` 但次数已用尽或已过截止（`FR-016`） |

**语义细则**：

- 启用时若 `next_run_at` 落在过去且未终止 → **推进到下一个未来时刻**（不补跑，`FR-045` 同口径）。
- 停用**不中断**已开始的那一轮对话（`FR-015`），只阻止后续触发。
- 重复启用 / 重复停用是幂等的（返回当前状态）。
- 请求体只接受 `enabled`：出现其他字段（如 `new_thread_per_run`，创建后不可改 `FR-060`）→ `400 VALIDATION_FAILED`。服务端在 `preValidation` 显式拒绝未声明字段，**不依赖** ajv 的 `removeAdditional`（默认会静默丢弃）。
- 用户显式启用会清掉"数字人不可用"的系统停用标注：数字人仍不可用时，下一次触发会重新判定并按 `FR-055` 再次停用，不会留下"假启用"。

---

### 3.1 `PATCH /api/scheduled-tasks/{task_id}` —— 编辑（2026-10-30 增补）

整份替换 7 项可编辑字段（不是字段级 PATCH：缺字段按 `400` 拒绝）。

**请求体**（`additionalProperties: false`）：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `name` | string | 是 | trim 后 1~50，同作用域唯一（排除自身） |
| `prompt` | string | 是 | trim 后非空，长度上限与聊天输入框单条消息上限一致 |
| `thinking` | boolean | 否 | 缺省 `false` |
| `start_at` | string | 是 | ISO 8601；**允许早于当前时刻**（编辑不改变"生效起点"语义，启用时才推进到未来） |
| `interval_seconds` | integer | 是 | ≥ 1 |
| `max_runs` | integer | 是 | ≥ 1（可小于已执行次数：任务随即进入已终止态） |
| `deadline_at` | string | 是 | ISO 8601，严格大于 `start_at` |

**响应 200**：`{ "task": ScheduledTask }`（`next_run_at` 已重置为新的 `start_at`）。

**错误**：

| 码 | HTTP | 场景 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 任一字段不满足约束；`details` 每项形如 `字段名: 说明` |
| `SCHEDULED_TASK_NOT_FOUND` | 404 | 不存在 / 不属于当前数字人 |
| `SCHEDULED_TASK_NAME_CONFLICT` | 409 | 同作用域已有同名任务 |
| `SCHEDULED_TASK_ENABLED` | 409 | 任务仍处于启用状态（须先停用） |

**语义细则**：

- **会话模式不可改**（`FR-060`）：请求体出现 `new_thread_per_run` → `400 VALIDATION_FAILED`（`preValidation` 显式拒绝未声明字段）。
- `executed_count` / `last_run_at` / 已产生的会话与运行记录**均不变**：编辑不追溯历史。
- 编辑**不改变启用状态**：停用中的任务编辑后仍是停用，须用户手动启用（届时按 `PATCH enabled` 推进计划时刻）。
- 其它作用域口径同 §3（用户 + 当前数字人）。

---

## 4. `DELETE /api/scheduled-tasks/{task_id}`

删除任务及其调度配置（`FR-018`~`FR-022`）。

**前置条件**：任务必须处于停用状态。

**响应 204**（无 body）。

**错误**：

| 码 | HTTP | 场景 |
|---|---|---|
| `SCHEDULED_TASK_NOT_FOUND` | 404 | 不存在 |
| `SCHEDULED_TASK_ENABLED` | 409 | 仍处于启用状态（必须先停用） |

**语义细则**：

- 删除是**原子**的：先从集合移除并落盘，再移除内存调度状态；先停心跳侧的在途派发判断，避免"已删任务再触发一次"。
- **不删除**该任务已产生的会话与历史消息（`FR-021`）；该任务的运行记录不再出现在 `GET /runs`（`FR-022`）。

---

## 5. `GET /api/scheduled-tasks/runs`

运行记录（`FR-047`~`FR-052`）。

**查询参数**（`additionalProperties: false`）：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `task_id` | string | 无 | 按单个任务筛选；缺省 = 全部任务 |
| `limit` | integer | 50 | 1~200 |

**响应 200**：

```json
{
  "runs": [
    {
      "run_id": "8a2c…",
      "task_id": "b3f1…",
      "task_name": "日报生成",
      "triggered_at": "2026-11-01T01:00:00.000Z",
      "finished_at": "2026-11-01T01:00:42.000Z",
      "result": "success",
      "reason": null,
      "reason_text": null,
      "thread_id": "1f9e…",
      "thread_title": "日报生成 2026-11-01 09:00:00",
      "rebuilt": false,
      "thread_deleted": false
    }
  ],
  "total": 12
}
```

**说明**：

- 按 `triggered_at` **倒序**返回；`total` 为筛选条件下的记录总数（用于"共 N 条"）。
- `result` = `success` / `failed` / `skipped`；后两者必带 `reason`，`reason_text` 为中文摘要（失败原因截断 200 字）。
- `rebuilt` = 本次触发因原会话已被删除而重建（仅复用模式可能出现）；前端在该条记录上以文字标注"重建会话"。
- `thread_deleted` 由服务端在读取时按会话是否存在回填（一次目录存在性检查，不逐条读 meta）；为 `true` 时前端渲染为不可跳转（`FR-051`）。
- 无记录 → `{ "runs": [], "total": 0 }` 且 HTTP 200（空态不是错误，`FR-052`）。
- **只返回仍存在的任务的记录**（`FR-022`）：任务删除后其历史记录不再出现在响应里，`total` 也随之变化；`runs.jsonl` 文件本身不改写。

---

## 6. `GET /api/scheduled-tasks/events`

变更信号（SSE）。事件名 `scheduled-task`，**负载为空**，与 `/api/produced/events` 同构。

```text
event: scheduled-task
data: 

```

- 建连即推一次（客户端不必判断"是不是还没变化"）；之后仅在**当前用户**的任务发生"执行完成 / 状态变化"时推送；每 25s 一条 `: ping` 注释心跳。
- 语义：只表示"任务列表或运行记录**可能**已变"；前端收到后重新拉列表，并刷新会话列表（新会话与闪电标记由此出现）。
- 信号丢失（断连、进程重启）**无后果**：列表与记录都能从文件重算。前端 MUST NOT 把"没收到信号"呈现为错误。
- 客户端重连 MUST 有界：1s / 2s / 4s / 8s / 16s 退避，最多 5 次；超限置 `degraded` 并提示"实时更新已暂停，可手动刷新"（宪章原则九）。服务端不承担重连控制。

---

## 7. 计数与性能口径

**计数口径**（`FR-041` / `FR-043`）：`executed_count` 只统计**已开跑**的一轮（`result = success | failed`）；`skipped` 的三类情形（上一轮未完成、并发额度已满、数字人不可用）不增加计数，但 `next_run_at` 照样推进。

**性能口径**（`SC-012`，宪章原则五）：

| 端点 | 目标 | 测量方式 |
|---|---|---|
| `GET /api/scheduled-tasks` | P95 ≤ 500ms | 生产构建、100 任务，串行 20 次取 P95 |
| `POST /api/scheduled-tasks` | P95 ≤ 500ms | 同上（含一次原子写盘） |
| `PATCH /api/scheduled-tasks/{id}`（编辑） | P95 ≤ 500ms | 同上（含一次原子写盘） |
| `PATCH /api/scheduled-tasks/{id}/enabled` | P95 ≤ 500ms | 同上 |
| `DELETE /api/scheduled-tasks/{id}` | P95 ≤ 500ms | 同上 |
| `GET /api/scheduled-tasks/runs` | P95 ≤ 500ms | 1000 条记录、`limit=50` |
| `GET /api/scheduled-tasks/events` | 首帧 ≤ 500ms | 建连到首个 `event: scheduled-task` |

> 实测值 MUST 回填 `spec.md` 的 `SC-012` 结果位；未回填视为门禁未通过。

---

## 8. 错误码汇总（新增 4 个）

| 码 | HTTP | 语义 | 前端文案建议 |
|---|---|---|---|
| `SCHEDULED_TASK_NOT_FOUND` | 404 | 任务不存在或不属于当前数字人 | 该定时任务已不存在，请刷新列表 |
| `SCHEDULED_TASK_NAME_CONFLICT` | 409 | 同数字人下名称重复 | 任务名称已存在 |
| `SCHEDULED_TASK_ENABLED` | 409 | 启用中不可删除 / 不可编辑 | 请先停止任务再删除（编辑时为"请先停止任务再编辑"） |
| `SCHEDULED_TASK_EXHAUSTED` | 409 | 已用尽次数或已过截止，不可启动 | 该任务已执行完或已超过截止时间，无法启动 |

> 4 个码 MUST 全局唯一、语义稳定（宪章原则七）；实现时须登记进 `agent-backend/src/server.ts` 的 `DOMAIN_ERROR_STATUS`。

---

## 9. 契约与实现的同步要求

| 位置 | 内容 |
|---|---|
| `agent-backend/src/routes/scheduled-tasks.ts` | 7 个端点的 JSON Schema（body / querystring）与上面的约束逐项对应 |
| `frontend/src/api/types.ts` | `ScheduledTask` / `ScheduleRun` / `ScheduledTaskCreateRequest` / `UpdateScheduledTaskRequest` / `ScheduledTaskListResponse` / `ScheduleRunListResponse` |
| `frontend/src/api/scheduled-tasks.ts` | 7 个方法，路径与方法与本节一致 |
| 测试 | 后端 `tests/integration/scheduled-tasks.spec.ts` 覆盖 7 端点 + 4 错误码；前端 `api/scheduled-tasks.spec.ts` 断言请求形状 |
