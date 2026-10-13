# 007 数据模型：下一步动作提示卡片

- **特性标识**：`007-next-action-hints`
- **日期**：2026-10-12
- **范围**：设计态（平台）→ 物化（SOUL.md）→ 运行态（快照文件）→ 下发（接口）→ 前端类型，五段形状 MUST 一一对应（宪章原则七）
- **口径来源**：`spec.md`（FR/I/SC）、`research.md`（D1~D12）

---

## 1. 实体总览

| 实体 | 归属 | 生命周期 | 落点 |
|---|---|---|---|
| **下一步动作开关**（`next_action_hints`） | 数字人（设计态 → 物化 → 运行态读取） | 随数字人配置 | 平台设计态 JSON → `SOUL.md` frontmatter → 运行环境只读 |
| **下一步动作提示**（NextAction） | 一轮回答 | 随该轮生成 | 仅存在于快照文件与下发响应中 |
| **会话提示快照**（NextActionsSnapshot） | 会话（每会话一份） | 轮开始清空 → 轮末覆盖 | `users/{uid}/user-data/threads/{tid}/next-actions.json` |
| **本轮可用工具摘要**（RuntimeToolBrief） | 一轮 run | 单轮内存态 | `runWith` 装配期写入 `AgentRunRequest.runtime`（**不落盘**） |
| **内联引导**（guidance） | 一条提示 | 与提示同生共死 | 快照内的字段（隐藏，不展示）；仅点击时随请求回传 |

---

## 2. 下一步动作开关（`next_action_hints`）与其条数参数（`next_action_hints_count`）

### 2.1 设计态（平台唯一权威源）

| 字段 | 类型 | 必填 | 缺省 | 校验 |
|---|---|---|---|---|
| `soul.next_action_hints` | boolean | 否 | `false` | 给了非布尔值 → **拒绝保存**（`ADM_AGENT_INVALID`，同既有 SOUL 字段的拒绝式口径） |
| `soul.next_action_hints_count` | number | 否 | `3` | 1~6 的整数；**键缺失才取缺省**，`null` / 小数 / 越界 / 非数字 → **拒绝保存**（`readPositiveInt`，与开关同口径） |

- 载体：`admin-backend/src/domain/config-center/soul-design.ts` 的 `SoulDesign`；
  `emptySoulDesign()` / `fromLegacySoul()`（旧字符串 SOUL 升级）/ `normalizeSoulDesign()` / `isSoulDesign()` 四处 MUST 同步。
- 存量兼容：旧设计态 JSON 无该字段 → `false` + 条数 `3`（零行为变化，FR-031）。
- 上限常量：`SOUL_LIMITS.nextActionHintsMin = 1` / `nextActionHintsMax = 6` / `nextActionHintsDefault = 3`
  （前端输入框的 `min`/`max`/初值与后端校验共用同一组数字）。
- **同进同出**：条数只在开关开启时有意义；开关关闭时**数值仍被保留**（管理台输入框置灰、不回退），
  但物化产物不写条数键——于是"开启态产物 = 关闭态产物 + 开关与条数两行"，关闭态与 007 之前逐字一致。

### 2.2 物化产物（`SOUL.md` frontmatter）

```yaml
---
soul_version: 1
intro: …
welcome: …
next_action_hints: true        # 仅在为 true 时写；false/缺省不写键（不写空壳）
next_action_hints_count: 3     # 与开关同进同出：仅开关开启时写；缺省/坏值一律落 3
starters: …
---
```

正文（提示词）**不新增任何小节** ⇒ System Prompt 语义不受开关影响（FR-035）。

### 2.3 运行态读取

- `soul.ts` 的 `SoulMeta` 新增 `nextActionHints: boolean` 与 `nextActionHintsCount: number`；
  `parseSoulMeta` 读取 frontmatter 键 `next_action_hints`（非布尔/缺失 → `false`）与
  `next_action_hints_count`（缺省/非整数/越界 → 收敛到 `3`，`readHintCount`）。
- 新增 `isNextActionsEnabled(optAgentRoot, userId, agentName): boolean`：只读该数字人的 `SOUL.md` → `parseSoulMeta` → `.nextActionHints`；**读失败/解析失败一律返回 `false`**（fail-closed）并告警。
- 新增 `nextActionHintsCount(optAgentRoot, userId, agentName): number`：同上读盘 → `.nextActionHintsCount`；**读失败返回缺省 `3`**（条数只是"生成几条"的上限，读不到按缺省走，不必像开关那样关到 0）。
- `next-actions.ts` 的 `NextActionsStore` 新增依赖 `NextActionsDeps.hintCount`：生成时取
  `hintCount(userId, agentName) ?? maxActions` 作为该轮的条数上限，并把它写进生成提示词
  （`0~N 件事` / `数量 0~N 个`），`sanitizeActions` 也按它裁剪。

**状态转换（单数字人视角）**

| 当前 | 事件 | 结果 |
|---|---|---|
| 关 | 平台改开 + 部署 | 后续轮次产生并展示卡片；历史快照（此前不存在）无关 |
| 开 | 平台改关 + 部署 | 后续轮次不再生成、不再调用模型（FR-032/SC-007）；**已持久化的快照也不得展示**（FR-034，读取期判定） |
| 开 | 部署未变 | 一切照旧 |

---

## 3. 下一步动作提示（NextAction）

| 字段 | 类型 | 必填 | 约束（生成期校验，违反即丢弃该条） |
|---|---|---|---|
| `prompt` | string | 是 | 中文自然语言指令；trim 后非空；**≤ 50 字**（Unicode 码点）；MUST NOT 命中任何工具标识符；MUST NOT 含 `snake_case`/`kebab-case`/`CamelCase` 形态 token；同一轮内不重复 |
| `tools[]` | `SoulToolRef[]` | 否 | `{ kind: 'builtin', name }` 或 `{ kind: 'mcp', service, name }`；`toolExposedName(ref)` MUST ∈ 本轮可用工具清单，越界即丢弃**该引用**（保留卡片文本） |
| `guidance` | string | **是（始终出现）** | 由 `buildStarterGuidance(tools)` 派生（与问题实例**同一实现/同一文案**）；**无关联工具时为空串**（与既有 `AgentStarterView.guidance: string` 逐字同形，`identity: 空串 = 无引导`）；长度 > 500 字时 MUST 回落为空串（保留卡片文本与 `tools[]`；上限来自既有 `POST .../messages` 的 `guidance` 约束） |

**条数上限**：单轮 0~3 条（超出取前 3 条）；0 条等价于"本轮无需下一步"。

**展示与隐藏的边界（不变式）**

| 内容 | 用户可见 | 进模型上下文 | 进历史 |
|---|---|---|---|
| `prompt` | ✅（卡片文本 / 确认弹窗 / 发送后的用户消息） | ✅（作为用户消息） | ✅（作为用户消息） |
| `tools[].exposed_name` | ❌ | ❌（不注入） | ❌ |
| `guidance` | ❌ | ✅（本轮 `systemExtra`，请求级） | ❌ |

---

## 4. 会话提示快照（`next-actions.json`）

### 4.1 落盘形状

```jsonc
{
  "message_id": "m-1750000000000-1",   // 归属的 assistant 消息 id（run 启动时预生成）
  "agent_name": "交付助理",             // 卡片归属数字人：读取期双判据都按它判定（FR-019/FR-034）
  "created_at": "2026-10-12T08:00:00.000Z",
  "actions": [
    {
      "prompt": "按交付日期梳理这批订单的风险",
      "tools": [{ "kind": "mcp", "service": "erp", "name": "query_order" }],
      "guidance": "本轮请优先使用以下工具完成任务：erp__query_order"
    }
  ]
}
```

- 路径：`threadDir(root, userId, threadId)/next-actions.json`（与 `summary.json` 同目录）。
- **每会话至多一份**：轮末整体覆盖（FR-018）；写盘 = 临时文件 + `fs.renameSync` 原子替换。
- 大小上限：解析时设 64 KB 上限，超限视为损坏（脏文件防护）。
- 损坏/不可读 → 视为"无快照"并告警（同 `summary.json` 口径），MUST NOT 抛错。

### 4.2 状态转换（单会话视角）

| 当前 | 事件 | 结果 |
|---|---|---|
| 无快照 | 用户发送消息（run 开始） | `clear`（入链）→ 仍无快照 |
| 无快照 | 该轮成功完成、开关为开且产出 **≥1 条** | 触发生成 → 1~3 条 → **写入快照** |
| 无快照 | 该轮成功完成但**产出 0 条** | **不写快照**（保持无）：清空已由本轮开始时的 `clear` 完成，「无建议」与「无快照」是同一状态 |
| 无快照 | 该轮成功完成但开关为关 | **不生成**（无额外模型调用）、**不写快照**（保持无） |
| 无快照 | 该轮失败/中断 | 不写入 ⇒ 保持无快照（FR-040 + 边界情况） |
| 无快照 | 该轮成功结束但生成链路失败 | 不写入 ⇒ 等价"本轮无建议"，回答不受影响（FR-042） |
| 有快照 | 刷新页面 / 重进会话 | 读快照 → 展示（`message_id` 匹配时）→ 满足 FR-015 |
| 有快照 | 用户发送下一轮（run 开始） | `clear`（入链，排在上一轮写入之后）→ 旧卡片立即消失（FR-017） |
| 有快照 | 当前选中数字人切换为他人 | 读取期一致性判定为不一致 ⇒ 返回空 ⇒ 不展示（FR-019 / SC-011）；**快照不删**，切回后重新展示。此"消失"是**有意取舍**（见 FR-019、`spec.md` 非目标），非缺陷 |
| 有快照 | 数字人被关闭该开关并重新部署 | 读取期开关判定为关 ⇒ 返回空 ⇒ 不展示（FR-034） |
| 有快照 | 删除会话 | 随 `threads/{tid}/` 一并删除（既有生命周期，无需额外清理） |

> **不写"空快照"的理由**：快照的存在即代表"有建议"。开场 `clear` + 只在 ≥1 条时写入，使「无建议」「开关关闭」「生成失败」「开关关闭后重新部署」四种情形在存储层收敛为同一状态（文件不存在），读取路径无需区分，端点也无需为它们各写一条分支。

### 4.3 并发与一致性

| 关注点 | 处置 |
|---|---|
| 同一会话的两轮生成乱序 | 与本会话的 `clear`/`trigger` 共用一条 per-thread 串行链（D6），顺序恒为「N 写入 → N+1 清空」 |
| 写盘中断 | 临时文件 + 原子改名；失败保持旧快照 + 告警，MUST NOT 抛错 |
| 跨用户访问 | 路径由 `userId` 派生（与 `summary.json` 同口径），读取前走既有会话归属校验（`threadStore.get(userId, threadId)` 404） |
| 读取期开关判定成本 | 每次读取多读一个小文本文件（`SOUL.md`）；失败即当作关闭（fail-closed），不缓存（避免与部署覆盖产生陈旧判定） |
| **跨数字人越权（FR-019 / SC-011）** | 会话不绑定数字人且可跨数字人（既有行为），而 `guidance` 由**发送端**铸造、接收端原样注入且不校验 ⇒ 若只按"快照存在 + 归属数字人开关为开"下发，就会出现"A 的卡片在 B 下被点击、把 A 的工具名注入 B 的一轮"。**处置**：下发前再做一次一致性判定——`snapshot.agent_name` MUST 等于**当前选中数字人**（`ctx.currentAgent.current(userId)`，运行环境已有该概念），不一致即返回空。这是**读取期**唯一的兜底点（点击与发送之间没有服务端介入的机会），故不得省略 |

---

## 5. 本轮可用工具摘要（`RuntimeToolBrief`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | **暴露名**：内置工具为本名；MCP 为 `{server}__{tool}` |
| `description` | string | 用途摘要（内置来自 `BUILTIN_TOOL_CATALOG` 的模板渲染；MCP 来自 `listTools`），可能为空串 |

- 来源：`runWith` 装配完 `tools` 后写入 `AgentRunRequest.runtime.availableTools`（单轮内存态，**不落盘**）。
- 用途：① 生成提示词时作为"能力边界"上下文；② 生成结果里工具引用的**合法性判据**（越界即丢弃）。
- 缺失时（直聊分支）：清单为空 ⇒ 所有工具引用被丢弃。

---

## 6. 接口与前端类型映射（契约一致性，原则七）

| 运行态形状 | 接口形状（`GET /api/threads/{id}/next-actions`） | 前端类型（`frontend/src/api/types.ts`） |
|---|---|---|
| 快照 `message_id` | `message_id: string \| null` | 同名字段 |
| 快照 `actions[].prompt` | `actions[].prompt` | `AgentStarter.prompt`（**复用**） |
| 快照 `actions[].tools[]` | `actions[].tools[]`（含派生 `exposed_name`） | `AgentStarterTool`（**复用**） |
| 快照 `actions[].guidance` | `actions[].guidance`（**始终出现**，空串 = 无引导） | `AgentStarter.guidance: string`（**复用**，必填） |

- 前端**不新增**语义类型，只新增一个容器类型 `ThreadNextSteps = { message_id: string | null; actions: AgentStarter[] }`；
  与问题实例共用同一形状（含 `guidance: string` **始终出现**）⇒ 发送载荷与 `onStarterClick` 逐字同款（Q3）。
- 无快照 / 开关关闭 / **当前选中数字人与卡片归属不一致** / 快照损坏 → `{ "message_id": null, "actions": [] }`（前端按空数组即不渲染，无错误态）。
- 前端发送时 `guidance === ''` MUST 不携带该字段（与既有 `onStarterClick` 的空串处理一致），使"无引导"与"有引导"在请求体上不产生歧义。
