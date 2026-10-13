# 007 契约增量：下一步动作提示卡片

- **特性标识**：`007-next-action-hints`
- **日期**：2026-10-12
- **契约唯一事实源**：本文件是**本特性的增量**；正式条文 MUST 同步回写
  `specs/001-digital-human-platform/contracts/admin-api.md`（§5 数字人设计）与
  `specs/001-digital-human-platform/contracts/runtime-api-delta.md`（运行侧增量），
  并在两处登记修订理由与日期（宪章原则一/七）。两处落地后，本文件与它们 MUST 一致。
- **既有形状零变更**：`GET /api/threads/{id}` 响应、`POST /api/threads/{id}/messages` 的 SSE 事件集合、
  既有 `guidance` 字段语义均**不变**。
- **本特性依赖两条既有事实**（取证见 `../research.md` §3）：① 会话**不绑定**数字人、可跨数字人
  （`thread-store.ts` 的 FR-014 修订）⇒ 需要 §1 的下发前置双判据；② 既有下发形状
  `AgentStarterView.guidance: string` **始终出现**（空串 = 无关联工具）⇒ 本端点的 `guidance` 同口径，
  以保持"与问题实例逐字同形"。

---

## 1. 新增端点：`GET /api/threads/{id}/next-actions`

读取该会话**最新一轮**的下一步动作提示（会话级单快照；语义见 `../data-model.md` §4）。

**下发前置双判据**（缺一即返回空，MUST NOT 省略）：

1. 该快照**归属数字人**的「是否开启下一步动作提示」开关为开（FR-034）；
2. 该快照**归属数字人 = 当前选中数字人**（FR-019 / SC-011）——会话不绑定数字人且可跨数字人，
   而 `actions[].guidance` 是**发送端**按归属数字人的工具铸造、接收端原样注入且不校验，
   故这是消除"用 A 的卡片把 A 的工具引导注入 B 的一轮"的**唯一兜底点**。

### 1.1 请求

| 项 | 值 |
|---|---|
| 方法 / 路径 | `GET /api/threads/{id}/next-actions` |
| 参数 | 无（会话 id 在路径） |
| 鉴权 | 与既有会话接口同口径（当前用户）；跨用户会话一律 404 |
| 幂等 / 缓存 | 纯读；`Cache-Control: no-store`（内容随轮次与开关变化） |

### 1.2 响应 200

```jsonc
{
  "message_id": "m-1750000000000-1",   // 命中快照时为其归属 assistant 消息 id
  "actions": [
    {
      "prompt": "按交付日期梳理这批订单的风险",
      "tools": [
        { "kind": "mcp", "service": "erp", "name": "query_order", "exposed_name": "erp__query_order" }
      ],
      "guidance": "本轮请优先使用以下工具完成任务：erp__query_order"
    }
  ]
}
```

**字段口径**

| 字段 | 类型 | 说明 |
|---|---|---|
| `message_id` | `string \| null` | 无快照、开关关闭、**当前选中数字人与卡片归属不一致**、快照损坏时一律 `null` |
| `actions` | `NextAction[]` | 1~3 条（**有内容才下发**，不存在 0 条的下发形态）；顺序即展示顺序 |
| `actions[].prompt` | `string` | 中文、≤50 字（生成期已校验） |
| `actions[].tools[]` | `{ kind: 'builtin' \| 'mcp'; name: string; service?: string; exposed_name: string }[]` | 与 `AgentStarterTool` **逐字同形**；仅内部使用，前端 MUST NOT 展示 |
| `actions[].guidance` | `string` | **始终出现**（与 `AgentStarterView.guidance: string` 逐字同形；**空串 = 无关联工具 / 引导超 500 字被回落**）；前端 MUST 原样回传，MUST NOT 自行拼装；发送时为空串则 MUST NOT 携带该请求字段 |

**"无内容"的表达**：`{ "message_id": null, "actions": [] }`（**200**，不是 404/204）。
理由：对前端而言"没有建议"是正常态而非错误态（FR-042：降级 MUST NOT 呈现错误）。

### 1.3 错误

| 状态 | code | 触发 |
|---|---|---|
| 404 | `THREAD_NOT_FOUND` | 会话不存在 / 不属于当前用户（与 `GET /api/threads/{id}` 同口径、同码） |
| 500 | `INTERNAL_ERROR` | 未预期异常（统一错误格式 `{ error: { code, message, details? } }`） |

**不存在的错误路径**：快照损坏、开关读取失败、**当前选中数字人与快照归属不一致**、生成尚未完成 ——
四者**一律 200 + 空**，原始错误只进结构化日志（`event: 'next-actions.failed'` / 快照损坏告警）。

### 1.4 端点验收

| 场景 | 期望 |
|---|---|
| 开关为开 + 快照命中 + 归属数字人 = 当前选中 | 200，`message_id` 为该轮 assistant id，`actions` 条数等于快照条数 |
| **当前选中数字人 ≠ 快照归属数字人** | 200，`message_id: null`，`actions: []`（FR-019 / SC-011 的读取期兜底）；切回原数字人后恢复下发 |
| 开关已关（含已持久化快照） | 200，`message_id: null`，`actions: []`（FR-034） |
| 无快照（新会话 / 产出 0 条 / 开关关闭 / 失败轮 / 中断轮） | 200，`message_id: null`，`actions: []` |
| 快照文件损坏 | 200 空 + 一条告警日志 |
| 他人会话 id | 404 `THREAD_NOT_FOUND` |
| 响应时延 | P95 ≤ 500ms（宪章原则五）：计时样本 20 次（冷/热各半），实测值 MUST 登记进 `tasks.md` 同步记录表 |

---

## 2. 既有端点：零变更（显式声明）

| 端点 | 结论 |
|---|---|
| `POST /api/threads/{id}/messages`（SSE） | **零变更**：事件集合（`thinking` / `content` / `tool_call` / `tool_call_end` / `interaction_request` / `done` / `error`）与负载字段全部不变；卡片不经 SSE 下发（生成发生在 `done` 之后） |
| `POST /api/threads/{id}/messages` 的 `guidance` | **语义不变**（004 引入：≤500 字、请求级、不落盘、不进历史）。本特性把卡片关联工具生成的引导经**同一字段**回传，通道与文案口径与问题实例一致 |
| `GET /api/threads/{id}` | **零变更**（不加 `next_actions` 字段）：卡片走 §1 的独立轻量端点，避免改动重载荷响应形状 |
| `POST /api/admin/agents` / `PUT /api/admin/agents/{name}` | `soul` 结构化对象**新增可选布尔字段** `next_action_hints`（见 §3） |

---

## 3. 管理平台契约：`soul.next_action_hints`

| 项 | 值 |
|---|---|
| 字段 | `soul.next_action_hints` |
| 类型 | `boolean`，**可选**，缺省 `false` |
| 语义 | 该数字人是否开启"下一步动作提示"；部署物化为 `SOUL.md` frontmatter 的 `next_action_hints: true`（仅 true 时写键） |
| 响应回显 | 与既有 SOUL 字段同处返回（设计态 JSON 原样），**不派生**新字段 |
| 校验（拒绝式） | 缺省 → `false`；给了**非布尔值** → 保存失败，错误码沿用既有 `ADM_AGENT_INVALID`（`soul.next_action_hints 须为布尔值`） |
| 兼容 | 旧设计态 JSON（无该字段）读取为 `false`；旧字符串 `soul` 升级路径（`fromLegacySoul`）同样落 `false` |
| 部署语义 | 与既有"以数字人为单位的整体覆盖"一致：关闭态产物**不含** `next_action_hints` 键 ⇒ 运行环境无残留（FR-033） |

`admin-api.md` 的 SOUL 字段表 MUST 增列此字段，并同步 `data-model.md` 的设计态字段表。

---

## 4. 物化产物契约：`SOUL.md` frontmatter 新键

```yaml
---
soul_version: 1
intro: …
welcome: …
next_action_hints: true        # 新增；仅在开启时写
next_action_hints_count: 3     # 新增；与开关同进同出，仅开启时写
starters: …
---
```

| 项 | 约束 |
|---|---|
| 键名 | `next_action_hints` / `next_action_hints_count` |
| 取值 | 开关为布尔、**仅 `true` 时写键**；条数为 1~6 的整数、**仅开关开启时写键**（二者都 `false`/缺省不写，沿用"不写空壳"口径） |
| 与 System Prompt 的关系 | frontmatter **不进** System Prompt（`stripFrontmatter` 既有保证）⇒ 开关开/关两种产物的 System Prompt MUST 逐字一致（FR-035 快照测试） |
| 运行侧读取 | 开关：`parseSoulMeta` → `SoulMeta.nextActionHints`；缺省/非布尔/解析失败 → `false`。条数：`SoulMeta.nextActionHintsCount`；缺省/非整数/越界/解析失败 → `3`（收敛式，`readHintCount`） |

---

## 5. 前端类型映射（与契约一一对应，原则七）

```ts
/** 复用既有形状（api/types.ts:58-74）——卡片与问题实例同形同语义 */
export interface ThreadNextSteps {
  message_id: string | null
  actions: AgentStarter[]
}

// ThreadsApi 新增：
nextSteps(threadId: string): Promise<ThreadNextSteps>   // GET /api/threads/{id}/next-actions
```

| 契约字段 | 前端字段 | 可选性一致 | 备注 |
|---|---|---|---|
| `message_id` | `ThreadNextSteps.message_id` | ✅ | `null` ⇒ 不渲染 |
| `actions[].prompt` | `AgentStarter.prompt` | ✅ | 卡片文本 |
| `actions[].tools[]` | `AgentStarterTool[]` | ✅ | 仅内部使用（MUST NOT 展示） |
| `actions[].guidance` | `AgentStarter.guidance` | ✅ | **始终出现**（空串 = 无引导）；仅回传，MUST NOT 自行拼装；发送时为空串则 MUST NOT 携带该请求字段 |

**契约同步的四处（宪章"契约变更的四处同步"）**：契约文档（本节 + `specs/001/.../contracts/*`）、
前端类型定义（`frontend/src/api/types.ts` + `api/threads.ts`）、后端请求/响应 schema
（`agent-backend/src/routes/threads.ts` 的路由 schema 与序列化形状）、测试用例
（`agent-backend/tests/integration/next-actions.spec.ts` + 前端 `useNextSteps.spec.ts`）。
