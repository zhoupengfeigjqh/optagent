# 契约：本体行为权限闸门（模块 · 工具结果 · 日志）

**特性**：`020-ontology-scope-guard`
**范围**：运行环境 `agent-backend` 内部契约 + 对模型/前端可见的工具结果语义
**结论先行**：**本次不新增、不修改任何 HTTP 端点、SSE 事件与持久化字段**；对模型可见的变化只有"某次工具调用返回失败结果"。

---

## 1. 模块端口契约（`domain/scope-guard`）

### 1.1 工厂

```ts
createScopeGuard(input: {
  agentDir: string;          // 数字人配置目录（只读）
  username: string;          // 当前数字人的归属用户标识
  warn?: (warnings: string[]) => void;  // 加载期告警出口（一次重载回调一次，交装配层写日志）；缺省静默
}): ScopeGuardPort
```

**约束**：

- 构造不读盘（惰性加载发生在第一次 `check`）；
- 不接收 logger、HTTP 对象、MCP 对象、工具对象；不引用 `infra/**`、`intent-focus/**`、`mcp/**`、`@earendil-works/**`、`fastify`、`pino`；
- 不抛异常；`agentDir` 不存在时返回空快照（全放行）。

### 1.2 `ScopeGuardPort`

```ts
interface ScopeGuardPort {
  check(toolName: string): ScopeDecision;   // 永不抛错
  invalidate(): void;                       // 丢弃缓存；下一次 check 重载
}
```

| 前置条件 | 后置条件 |
|---|---|
| `toolName` 任意字符串（含空串） | 返回三变体之一；**不产生副作用**（除内部缓存与 `warn`） |
| 目录被替换 | 下一次 `check` 使用替换后的内容（签名比对） |
| 文件损坏/缺失 | 返回 `deny`（`ONTOLOGY_SCOPE_UNAVAILABLE`）或 `not_ontology`，控制流不中断 |

### 1.3 决策类型

```ts
type ScopeDecision =
  | { kind: 'not_ontology' }
  | { kind: 'allow'; behavior: BehaviorRef; rule: 'everyone' | 'user' }
  | { kind: 'deny'; behavior: BehaviorRef | null; code: ScopeDenyCode;
      reason: DenyReason; message: string };

type ScopeDenyCode =
  | 'ONTOLOGY_SCOPE_DENIED'        // 未授权（含 scope 含 disable；2026-11-09 合并）
  | 'ONTOLOGY_SCOPE_UNAVAILABLE';  // 管控配置不可用

type DenyReason =
  | 'not_in_scope' | 'empty_scope' | 'disabled'
  | 'no_entry' | 'no_securities' | 'internal_error';
```

判定矩阵见 [data-model.md](../data-model.md) §3.3（唯一权威条目清单）。

---

## 2. 工具结果契约（对模型 / 前端可见）

拒绝**不是异常**，而是一次"工具执行失败"：

| 项 | 取值 |
|---|---|
| 真实工具 `execute` | **零调用**（内置 / MCP 一律如此） |
| MCP 服务请求 | **零发出**（`mcp.callTool` 不被调用） |
| 业务数据副作用 | **零**（不写文件、不落库、不发异步回传） |
| 返回值 | `toolErrorResult(message, code)` **再追加终局指令块**：`content = [拒绝原因, 终局指令]`；`details.toolError = { code, message }`（**不含**指令） |
| 运行时翻牌 | `afterToolCall` → `patch.isError = true` → SSE `tool_call_end.status = 'error'` → 卡片标红 |
| 会话历史 | 与既有失败工具一致（`status='error'`，刷新后一致） |
| 本轮对话 | **继续但已挂起**（见下表）：模型据终局指令说明原因并收尾，不中断流 |
| MCP 调用统计 | **不计数**（`onMcpCall` 由真实调用触发，此处不发生） |
| 人工确认（HITL） | **不进入**（判定先于确认，不出确认弹窗） |

> 前三条是"拒绝"的硬语义，也是 `SC-002` / `SC-003` 的判据。

### 2.1 拒绝之后：本轮挂起（2026-11-09）

`guardTools` 每次装配新建一份挂起状态（**按轮隔离**，不落实例、不跨轮）：

| 阶段 | 行为 |
|---|---|
| 首次拒绝 | 置挂起 + 返回「拒绝原因 + 终局指令」；本轮其余调用不再执行 |
| 挂起后第 1 次调用 | 不判定、不执行，返回「本轮已停止执行工具，请直接结束回答。」（沿用首次拒绝的码） |
| 挂起后第 2 次调用 | 同上，并触发兜底出口 `onSuspendedExhausted()`（装配层 ⇒ `run.stop()`，与用户点"停止"同路径） |
| 兜底出口 | 每次装配**最多触发一次**；走 `ABORTED` 收尾，**不写业务错误码** |

**边界**：同一批次的并发调用（`parallel` 模式）无法撤回——本状态只覆盖**后续批次**，
且该边界 MUST 在规格（`FR-026`）中显式声明，不得表述为"拒绝后一个工具都不会执行"。

**为什么是"软收尾"而不是"硬中止"**：权限不足是用户可理解、可求助的状态，直接切断会让用户只看到一条红卡片
却没有解释；而 021 的规则拒绝是"配置/数据不成立，继续对话会产生误导"，两者刻意不同（见
`specs/021-ontology-rule-gate/contracts/rule-gate.md` §4 的差异说明）。

---

## 3. 错误码

| 错误码 | 触发条件 | `reason` | 日志级别 | 建议用户动作 |
|---|---|---|---|---|
| `ONTOLOGY_SCOPE_DENIED` | `scope` 含 `disable`（**即使同时含 `everyone`**）；或 `scope` 不含 `everyone` 且不含当前用户名（含空 `scope`） | `disabled` / `not_in_scope` / `empty_scope` | `warn` | 联系管理员为该行为授权或恢复启用 |
| `ONTOLOGY_SCOPE_UNAVAILABLE` | 该本体的 `securities.yaml` 缺失/不可解析/结构非法，或缺该 `action_name` 条目，或判定内部异常 | `no_entry` / `no_securities` / `internal_error` | `error` | 联系管理员重新部署该本体 |

**唯一性**：两个码此前未被任何端点或工具使用；与既有 `HITL_*` 系列互不重叠，语义稳定。

> **2026-11-09 修订**：`disable` 不再单列 `ONTOLOGY_BEHAVIOR_DISABLED`，对外并入"未授权"。
> `reason: 'disabled'` 与 `scope_kind: 'disable'` 保留，日志仍可区分"显式停用"与"没被授权"。

---

## 4. 文案契约

`message` 由 `domain/scope-guard` 统一铸造（包装器不拼文案）。模板（`{本体}` / `{行为}` 用展示名）：

| 场景 | 文案 |
|---|---|
| 未授权（**含 `scope` 含 `disable`**） | `本体行为「{本体}/{行为}」未授权给当前用户，已拒绝执行。` |
| 管控不可用 | `本体行为「{本体}/{行为}」的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。` |
| 管控不可用（归属未知，**仅限** `reason=internal_error`） | `本体的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。` |
| 终局指令（首次拒绝时**追加**在拒绝原因之后，不替换） | `本轮已因权限不足停止执行工具，后续工具调用不再执行；请向用户说明原因并结束本轮回答。` |
| 挂起后再次调用工具 | `本轮已停止执行工具，请直接结束回答。` |

> 末行是 `FR-016`"文案须讲清本体与行为"的**唯一豁免**：仅当判定内部异常导致行为归属不可知时使用，其余情形一律带本体名与行为名。

**禁止项**：

- 不得包含 `scope` 中的用户名清单或其他用户的标识；
- 不得包含内部配置键名（`disable` / `everyone`）、文件路径或堆栈；
- 不得只给错误码而不给说明。

---

## 5. 日志事件契约

### 5.1 `scope_guard.denied`（每次拒绝一条，级别按 `code` 决定）

```jsonc
{
  "ts": "2026-11-08T12:34:56.789Z",
  "event": "scope_guard.denied",
  "code": "ONTOLOGY_SCOPE_DENIED",
  "reason": "not_in_scope",
  "user_id": "zpf",
  "agent_name": "采购助手",
  "thread_id": "t_...",
  "tool_name": "mes__CreatePurchaseRecord",
  "ontology": "生产调度/原材料采购和库存",
  "behavior": "CreatePurchaseRecord",
  "scope_kind": "users",
  "scope_size": 1
}
```

### 5.2 `scope_guard.catalog.degraded`（加载期异常，聚合一条）

```jsonc
{ "event": "scope_guard.catalog.degraded", "user_id": "zpf", "agent_name": "采购助手",
  "warnings": ["…/securities.yaml:invalid_yaml:…"] }
```

### 5.3 `scope_guard.suspended`（挂起后的每次工具调用一条，`warn`）

```jsonc
{ "ts": "2026-11-09T12:34:56.789Z", "event": "scope_guard.suspended",
  "code": "ONTOLOGY_SCOPE_DENIED", "user_id": "zpf", "agent_name": "采购助手",
  "thread_id": "t_...", "tool_name": "mes__DeletePurchaseRecord", "attempts": 1 }
```

只记"被拦了几次"：判定字段（`reason` / `scope_kind` / `scope_size` / `ontology` / `behavior`）
已由首条 `scope_guard.denied` 承载，MUST NOT 重复。

**禁止**：工具入参、`scope` 具体名单、`securities.yaml` / `ontology.yaml` 原文、用户提问内容。

---

## 6. 生效时机

| 场景 | 生效时点 |
|---|---|
| 部署（整只数字人目录原子改名） | 下一次工具调用（目录签名变化即重载；不需要重启、不需要新建会话） |
| 仅替换本体文件（非部署路径） | 同上（签名基于 `ontology` 目录 mtime） |
| 会话正在进行的同一轮 | 以每次调用时的快照为准；不保证"轮内一致"，保证"每次调用都读完整文件" |
| 实例池回收 / 换代 | 快照随实例丢弃，下次构建时重读 |

---

## 7. 对既有契约的影响

| 既有契约 | 影响 |
|---|---|
| `runtime-api-delta.md` §8（配置指纹换代 R7） | **不改语义**；本闸门额外用目录签名补偿"指纹不含 `ontology/**`"（研究 D6） |
| `runtime-api-delta.md` §9.1（工具失败标记口径） | **沿用**：拒绝走 `toolError` 标记通道，不新增状态值 |
| MCP 工具白名单（R12） | **不变**：白名单决定"模型看得见什么"，闸门决定"看得见的能否执行" |
| HITL（R8） | **顺序变化**：判定先于确认；被拒不产生 `interaction_request` |
| 前端 `frontend` | **零改动**：只消费 `isError` 与正文，不读错误码 |
| 管理平台 | **零改动**：`securities.yaml` 已原样下发，平台仍不解析语义 |

**已登记**（2026-11-08）：`specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的变更登记表已新增
`R27`（本体行为权限闸门），并在文末 §25 落完整语义：判定矩阵、文案口径、两个错误码、
三个日志事件、生效时机、生效面与回滚路径。本文件 §2~§6 是该章节的口径来源，两者如有偏差以 §25 为对外契约。

---

## 8. 验收断言（供测试与手验对照）

| # | 断言 |
|---|---|
| C1 | 非本体工具（内置 / 无同名行为的 MCP 工具）→ 原 `execute` 收到**同一** `(toolCallId, params)` |
| C2 | 拒绝时原 `execute` 零调用，`details.toolError.code` ∈ 三个码之一 |
| C3 | `scope: [disable, everyone]` → `ONTOLOGY_SCOPE_DENIED`（`reason='disabled'`） |
| C4 | `scope: []` → `ONTOLOGY_SCOPE_DENIED`（`reason='empty_scope'`） |
| C5 | 行为无 `action_name` 条目 → `ONTOLOGY_SCOPE_UNAVAILABLE`（`reason='no_entry'`） |
| C6 | 同一行为两个本体、一个放行一个拒绝 → 拒绝 |
| C7 | 文案不含任何授权用户名；日志不含 `scope` 名单 |
| C8 | 包装后 `name` / `label` / `description` / `parameters` / `executionMode` 与包装前一致 |
| C9 | 拒绝经 `afterToolCall` 后 `tool_call_end.status='error'` |
| C10 | 目录签名变化后，同一 guard 实例的下一次 `check` 使用新配置 |
| C11 | 首次拒绝的 `content` 为 `[拒绝原因, 终局指令]` 两块，且 `details.toolError.message` **仍是**拒绝原因原文 |
| C12 | 拒绝后同轮再调其他工具：真实 `execute` 零调用、`check` 不再被调用、返回「本轮已停止执行工具」 |
| C13 | 挂起后第 2 次调用触发 `onSuspendedExhausted`，且每次装配最多触发一次 |
| C14 | 两次 `guardTools` 装配的挂起状态互不影响（按轮隔离） |
| C15 | 模型拒绝后仍调工具 → 本轮以 `done` 正常结束（非 `error` / `ABORTED`）；兜底中断时才走 `ABORTED` |
