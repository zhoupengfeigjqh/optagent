# 接口契约增补：会话来源标记

**特性**：`015-scheduled-chat-tasks` ｜ **版本**：1.0（2026-10-29）
**性质**：`/api/threads` 既有端点的**向后兼容**字段增补（只增不改，缺省不写）

---

## 1. 字段定义

`Conversation` / 会话详情响应新增**可选**字段 `source`：

```ts
export interface ThreadSource {
  /** 来源类型；本期只有定时任务一种，字段保留为可扩展枚举 */
  type: 'scheduled_task'
  /** 产生该会话的定时任务 */
  task_id: string
  /** 任务名快照（任务改名/删除后仍可读） */
  task_name: string
  /** 触发时刻（ISO 8601 UTC） */
  triggered_at: string
}
```

**缺省语义**：字段不存在 = 普通会话（手动创建）。MUST NOT 写 `null`，MUST NOT 给普通会话写空对象——旧前端与旧数据因此完全不受影响。

---

## 2. 磁盘落点

`users/{uid}/user-data/{agentName}/threads/{threadId}/meta.json` 增可选 `source`（与 `thread_id` / `agent_name` / `title` / `created_at` / `updated_at` 同级）：

```json
{
  "thread_id": "1f9e…",
  "agent_name": "数据分析师",
  "title": "日报生成 2026-11-01 09:00:00",
  "created_at": "2026-11-01T01:00:00.000Z",
  "updated_at": "2026-11-01T01:00:42.000Z",
  "source": {
    "type": "scheduled_task",
    "task_id": "b3f1…",
    "task_name": "日报生成",
    "triggered_at": "2026-11-01T01:00:00.000Z"
  }
}
```

**写入时机**：仅 `ThreadStore.create()` 可写（定时任务执行器在创建会话时传入）；`touch()` / `rename()` MUST NOT 修改或清除 `source`（来源是终态事实）。

**读取**：`ThreadStore.get()` / `list()` 透传；损坏的 `source` 按"无来源"处理并落 `warn` 日志（不让一条坏字段毁掉整个会话列表）。

---

## 3. 受影响的端点

| 端点 | 变化 |
|---|---|
| `GET /api/threads` | 列表项新增可选 `source`（**零额外读盘**：列表本就逐个读 `meta.json`） |
| `GET /api/threads/{id}` | 详情顶层新增可选 `source`（与列表同一来源） |
| `POST /api/threads` | **不变**（手动创建的会话不带来源） |

响应片段示例：

```json
[
  {
    "thread_id": "1f9e…",
    "agent_name": "数据分析师",
    "title": "日报生成 2026-11-01 09:00:00",
    "created_at": "2026-11-01T01:00:00.000Z",
    "updated_at": "2026-11-01T01:00:42.000Z",
    "source": {
      "type": "scheduled_task",
      "task_id": "b3f1…",
      "task_name": "日报生成",
      "triggered_at": "2026-11-01T01:00:00.000Z"
    }
  }
]
```

---

## 4. 前端消费点

| 位置 | 用法 |
|---|---|
| `components/layout/HistoryItem.vue` | `source?.type === 'scheduled_task'` → 标题前渲染闪电图标，`aria-label="定时任务会话"`（`FR-039`） |
| `components/chat/MessageList.vue`（经 `ThreadSourceNotice.vue`） | 消息流顶部显示"由定时任务「{task_name}」于 {本地时刻} 触发"（`FR-040`） |
| `composables/useThreads.ts` | 列表项原样保留 `source`，不做二次推导（判据只有一处：`type === 'scheduled_task'`） |

---

## 5. 兼容性与测试

- **旧数据**：无 `source` → 普通会话，列表与详情行为不变（既有测试不改断言即可通过）。
- **旧前端**：多一个字段被忽略，无影响。
- **测试要求**：
  - 后端集成测试断言：定时任务产生的会话在列表与详情中带 `source`；手动创建的不带（字段缺失，而非 `null`）。
  - 后端单测断言：`touch()` 后 `source` 仍在。
  - 前端组件测试：有来源 → 渲染闪电/提示；无来源 → 不渲染（不使用占位）。
