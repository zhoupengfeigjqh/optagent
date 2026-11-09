# 契约：规则闸门（模块端口 + 对外语义）

- **特性**：`021-ontology-rule-gate`
- **日期**：2026-11-09
- **范围**：`agent-backend` 内部模块契约 + 对外可见语义（工具结果、SSE `error` 载荷、日志）。
- **无端点变更声明**：本特性**不新增、不修改任何 HTTP 端点**，**不新增 SSE 事件类型**，
  **不新增请求字段**。唯一对外形状变化是失败轮 `error` 对象多一个可选 `details`（§5）。

---

## 1. 模块导出面（唯一）

```ts
// domain/rule-gate/index.ts
export { createRuleGate, createFunctionRecord } from './…';
export type {
  RuleGatePort,          // prepare / postHint
  FunctionRecord,        // add / has / get / size
  PrepareResult,         // function | behavior | pause | deny
  GateSnapshot,          // 只读快照（测试与诊断用）
  RuleGateInput,         // { agentDir, warn? }
  RuleSpec, RuleDesign, RuleCondition, OperatorCode,
} from './…';
export const RULE_GATE_CODES = ['ONTOLOGY_RULE_FUNCTIONS_MISSING', 'ONTOLOGY_RULE_DENIED'] as const;
```

```ts
export interface RuleGatePort {
  /** 执行前：识别工具角色 + 前置判定。**永不抛错**（异常收敛为 deny/unavailable）。 */
  prepare(toolName: string, record: FunctionRecord): PrepareResult;
  /** 执行后：需要追加的后置提示块；无后置规则返回 null。**永不抛错**。 */
  postHint(toolName: string): { text: string; rules: string[] } | null;
  /** 强制丢弃缓存（测试与运维入口） */
  invalidate(): void;
}

export type PrepareResult =
  | { kind: 'function' }                                   // 非本体行为（且非内置）
  | { kind: 'behavior' }                                   // 本体行为，可执行
  | { kind: 'pause'; message: string; details: string[] }   // 缺函数：不执行，本轮继续
  | { kind: 'deny';  message: string; details: string[] };  // 求值不成立 / 规则不可用：不执行 + 中止

export interface FunctionRecord {
  add(toolName: string, result: unknown): void;             // 内部判成败与上限
  has(toolName: string): boolean;
  get(toolName: string): unknown;
  readonly size: number;
}
```

**契约保证**：

1. `prepare` / `postHint` / `add` **永不抛错**——本特性不得让一次坏数据把整轮对话弄崩；
2. `prepare` 是**纯判定**：不写文件、不发网络、不改入参；
3. `FunctionRecord` 的读取与写入都用同一套名称归一（`stripServicePrefix` + trim + lower）；
4. `deny` 的判定与文案**只在一处生成**，包装器与装配层不拼字。

## 2. 包装器契约（`infra/tool-rule-gate.ts`）

```ts
export interface RuleGateContext {
  gate: RuleGatePort;
  record: FunctionRecord;
  /** 平台内置工具名（来自 buildBuiltinTools 的产物，唯一来源在装配层） */
  builtinNames: ReadonlySet<string>;
  /** 中止出口（由 run-consume 接线到 run 状态 + AbortController） */
  onDeny(reason: { code: 'ONTOLOGY_RULE_DENIED'; message: string; details: string[] }): void;
  logger: Logger;
  userId: string;
  agentName: string;
  threadId?: string;
}

export function ruleGateTools(tools: AgentTool[], ctx: RuleGateContext): AgentTool[];
```

逐步语义（`execute`）：

| 步 | 条件 | 动作 |
|---|---|---|
| 1 | `builtinNames.has(name)` | **原样执行**；不判定、不记录、不追加 |
| 2 | `prepare` → `function` | 执行；正常返回且无 `details.toolError` 时 `record.add`（成功才记） |
| 3 | `prepare` → `behavior` | 执行；正常返回时追加 `postHint` 文本块 |
| 4 | `prepare` → `pause` | **不执行**；返回 `toolErrorResult(message, 'ONTOLOGY_RULE_FUNCTIONS_MISSING')` |
| 5 | `prepare` → `deny` | **不执行**；`onDeny(...)` 中止整轮；返回 `toolErrorResult(message, 'ONTOLOGY_RULE_DENIED')` |
| 6 | 执行抛异常 | 异常上抛（由 pi loop 兜底）；不记录、不追加 |

**保形**：包装只替换 `execute`，`name` / `description` / `parameters` / `label` / `executionMode` 原样保留。

**顺序约束**：本包装器 MUST 位于 020 权限闸门**内侧**（`guardTools(ruleGateTools(tools))`），
因此 020 拒绝的调用不会进入本包装器（规格 `FR-009`）。

## 3. 状态与语义

| 状态 | 工具是否执行 | 业务副作用 | 本轮走向 | 模型可见 |
|---|---|---|---|---|
| `pause` | 否 | 无 | 继续（模型可补调函数后重试） | 规则全文 + 缺失函数清单 + "请先执行完善" |
| `deny`（求值 false） | 否 | 无 | **中止**（不再发起模型/工具调用） | 同上（含 `fail_message`），随后收到整轮失败 |
| `deny`（规则不可用） | 否 | 无 | **中止** | 同上（说明"规则配置不可用"） |
| `behavior` 成功 | 是 | 正常 | 继续 | 原结果 + 后置规则全文（若有） |
| `function` 成功 | 是 | 正常 | 继续 | 原结果（**不加任何东西**） |

## 4. 错误码（全局唯一）

| 码 | 通道 | 语义 | 前端处理 |
|---|---|---|---|
| `ONTOLOGY_RULE_FUNCTIONS_MISSING` | 工具失败结果（`details.toolError`） | 前置规则所需函数未执行（规格 `FR-016`） | 无需新增映射：卡片按失败态展示正文 |
| `ONTOLOGY_RULE_DENIED` | SSE `error` + 失败轮 `error.code` | 规则求值不成立 / 规则不可用，本轮已中止（规格 `FR-033`） | **需新增映射**：固定文案 + `details` 原文透传（§6） |

**数量约束**：本特性新增错误码总数 **2 个**（暂停 1 + 中止 1），MUST NOT 再有第三个；
两者的"通道—码"对应关系由规格 `FR-016` / `FR-033` 冻结，实现期不得互换或合并。

与既有码不冲突：020 的三码是 `ONTOLOGY_SCOPE_DENIED` / `ONTOLOGY_BEHAVIOR_DISABLED` /
`ONTOLOGY_SCOPE_UNAVAILABLE`；本特性不复用、不改写它们。

## 5. 失败轮 `error` 载荷的形状增量

```jsonc
{
  "code": "ONTOLOGY_RULE_DENIED",
  "message": "本体行为「原材料采购和库存/CreatePurchaseRecord」未通过前置规则校验，本轮已中止。",
  "details": [
    "行为：原材料采购和库存/CreatePurchaseRecord",
    "规则：采购-供应商名称一致（V05_SupplierExistence）",
    "结论：供应商名称不存在，禁止创建采购单",
    "未成立条件：checkSupplierExistence.pass eq \"true\""
  ]
}
```

- `details` 为 `string[]`，3~6 条，**只在 `code === 'ONTOLOGY_RULE_DENIED'` 时出现**；
- 该字段同时进入 SSE `error.data.error` 与 `history.jsonl` 的失败行（**同形**，沿用既有不变式）；
- 字段"有才写"：其他错误码不写 `details`，旧前端忽略未知字段即可。

## 6. 前端消费契约

`frontend/src/utils/error-message.ts` 增加一条**受控透传**：

```ts
if (code === 'ONTOLOGY_RULE_DENIED') {
  // details 为后端生成的中文逐条原因（与 FILE_SCHEMA_INVALID 同口径的例外）
  if (Array.isArray(details) && details.length > 0 && details.every(isString)) return details.join('\n')
  return '本体行为未通过规则校验，本轮已中止'
}
```

- 仍遵守"前端不直接展示后端 `message`"的既有口径：这里展示的是 **`details` 列表**，
  而不是 `message`；
- 未知码兜底逻辑不变；不新增 UI 组件、不改 `ErrorNotice`。

## 7. 日志事件（结构化，字段见 data-model §7）

`rule_gate.paused` / `rule_gate.denied` / `rule_gate.unavailable` / `rule_gate.catalog.degraded` /
`rule_gate.record.dropped` / `rule_gate.posted`。

- 每个事件 MUST 含 `ts`（ISO 8601）与 `event`（事件名），对齐 `FR-035` / `SC-005` 的"含时间"；
- `unavailable` MUST 为 `error` 级并带 `alert: true`（配置问题需运维介入）；
- 任一事件 MUST NOT 记录函数结果正文、工具入参、规则 `values` 原文；`record.dropped` MAY 记
  `bytes` / `count` 等元信息（`FR-040` 修订口径）。

## 8. 明确不做的事

- 不新增端点、不新增 SSE 事件类型、不新增请求字段；
- 不修改 `POST /api/threads/{id}/messages` 的请求/响应形状（`details` 是 `error` 对象的可选增补）；
- 不在管理平台侧新增规则编辑/校验/下发逻辑（`rules` 现状已整包下发）；
- 不消费 `data_supplements`（只随全文反馈给模型）；
- 不提供"关闭闸门"的开关、不做规则结果的持久化或审计留存。
