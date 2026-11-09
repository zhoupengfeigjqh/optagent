# 契约：规则闸门（模块端口 + 对外语义）

- **特性**：`021-ontology-rule-gate`
- **日期**：2026-11-09
- **范围**：`agent-backend` 内部模块契约 + 对外可见语义（工具结果、SSE `error` 载荷、日志）。
- **无端点变更声明**：本特性**不新增、不修改任何 HTTP 端点**，**不新增 SSE 事件类型**，
  **不新增请求字段**。2026-11-09 软收尾后，拒绝只改变**工具结果正文**与 `tool_call_end.status`，
  不再新增失败轮 `error` 字段（历史失败行的 `details` / `reason` 仅为兼容保留，见 §5）。

---

## 1. 模块导出面（唯一）

```ts
// domain/rule-gate/index.ts
export { createRuleGate, createFunctionRecord } from './…';
export { RULE_TERMINAL_NOTICE, denyCardBody } from './format.js';   // 拒绝卡片正文（2026-11-09）
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

> 2026-11-09：新增 `RULE_TERMINAL_NOTICE`（拒绝后的终局指令，模型可见）与 `denyCardBody(details)`
> （把明细逐条 + 终局指令拼成卡片追加正文）——文案的唯一来源仍在 `format.ts`，包装器只引用。

```ts
export interface RuleGatePort {
  /** 执行前：识别工具角色 + 前置判定（缺函数 → 注册校验 → 暂停/阻断 → 求值）。**永不抛错**。 */
  prepare(input: PrepareInput): PrepareResult;
  /** 执行后（仅行为成功后）：后置规则判定；无后置规则返回 null。**永不抛错**。 */
  postHint(input: PostHintInput): PostHintResult;
  /** 强制丢弃缓存（测试与运维入口） */
  invalidate(): void;
}

export interface PrepareInput {
  toolName: string;
  record: FunctionRecord;
  /** 本轮挂载给模型的工具名（已归一集合）——注册校验的唯一判据（规格 FR-043） */
  available: ReadonlySet<string>;
}
export type PostHintInput = PrepareInput;

export type PrepareResult =
  | { kind: 'function' }                                    // 非本体行为（且非内置）
  | { kind: 'behavior' }                                    // 本体行为，可执行
  | { kind: 'pause'; message: string; details: string[] }    // 缺函数但**已注册**：不执行，本轮继续
  | { kind: 'deny'; message: string; details: string[]
      reason: 'unregistered' | 'condition_false' | 'config_unavailable' };
                                                            // 不执行 + 挂起本轮（共用拒绝码，靠 reason 区分）

export type PostHintResult =
  | null                                                     // 无后置规则
  | { kind: 'append'; text: string; rules: string[] }         // 函数全部已注册 → 追加
  | { kind: 'blocked'; message: string; details: string[]
      rules: string[] };                                     // 存在未注册函数 → 不追加 + 中止

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
  /** 本轮挂载给模型的工具名（含内置，已归一）——注册校验的唯一判据，由装配层从最终工具数组生成 */
  availableNames: ReadonlySet<string>;
  /**
   * 本轮工具挂起状态（`domain/tool-suspension.ts`，2026-11-09）。
   *
   * 与 020 权限闸门**共享同一份实例**：装配层每轮 `createToolSuspension` 一次，
   * 兜底出口（`onExhausted`）接到 `req.interruptRun`（纯中止，与用户点"停止"同路径）。
   */
  suspension: ToolSuspension;
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
| 0 | `interceptSuspended(suspension)` 为真 | **不判定、不执行**；累加 `attempts`，第 2 次触发一次兜底纯中止；返回 `toolErrorResult(SUSPENDED_MESSAGE, suspension.code)` |
| 1 | `builtinNames.has(name)` | **原样执行**；不判定、不记录、不追加 |
| 2 | `prepare` → `function` | 执行；返回后**无论成败**都 `record.add`（失败记 `null`；未真正发出的调用不会走到这里） |
| 3 | `prepare` → `behavior` | 执行；成功后调 `postHint`：`append` → 追加文本块；`blocked` → **不追加后置提示**、`suspendTools(suspension, 'ONTOLOGY_RULE_DENIED')`，在业务结果后追加阻断说明 + 终局指令；`null` → 原样返回 |
| 4 | `prepare` → `pause` | **不执行**；返回 `toolErrorResult(message, 'ONTOLOGY_RULE_FUNCTIONS_MISSING')` |
| 5 | `prepare` → `deny` | **不执行**；`suspendTools(suspension, 'ONTOLOGY_RULE_DENIED')` 挂起本轮；返回「结论 + 明细 + 终局指令」三段式卡片（`ONTOLOGY_RULE_DENIED`） |
| 6 | 执行抛异常（**仅步骤 2 的 `function` 角色**） | 异常上抛（由 pi loop 兜底）；**记 `null`**（该次调用已发出）；不追加。`behavior` 角色无论成败**都不记录**（规格 `FR-002`：本体行为 MUST NOT 进函数记录） |

**保形**：包装只替换 `execute`，`name` / `description` / `parameters` / `label` / `executionMode` 原样保留。

**顺序约束**：本包装器 MUST 位于 020 权限闸门**内侧**（`guardTools(ruleGateTools(tools))`），
因此 020 拒绝的调用不会进入本包装器（规格 `FR-009`）。

## 3. 状态与语义

| 状态 | 工具是否执行 | 业务副作用 | 本轮走向 | 模型可见 |
|---|---|---|---|---|
| `pause`（缺函数，函数**已注册**） | 否 | 无 | 继续（模型可补调函数后重试） | 规则全文 + 缺失函数清单 + "请先执行完善" |
| `deny`（求值 false） | 否 | 无 | **挂起本轮其余工具 → 软收尾**（模型总结后 `done`） | 「结论 + 明细 + 终局指令」三段式卡片 |
| `deny`（规则不可用） | 否 | 无 | **挂起本轮 → 软收尾** | 同上（说明"规则配置不可用"） |
| `deny`（**函数未注册**，前置） | 否 | 无 | **挂起本轮 → 软收尾**（不可自愈） | 同上，点名未注册函数与下一步检查建议 |
| `postHint.blocked`（**函数未注册**，后置） | **是（已执行成功）** | **已发生** | **挂起本轮 → 软收尾** | 业务结果**完整保留** + 阻断说明（"已执行成功、数据已写入"）+ 终局指令 |
| `behavior` 成功 | 是 | 正常 | 继续 | 原结果 + 后置规则全文（若有） |
| `function` 成功或失败 | 是 | 正常 | 继续 | 原结果（**不加任何东西**）；失败时记录为 `null` |
| 本轮已挂起后的任意调用 | 否 | 无 | 继续拦（第 2 次触发一次纯中止兜底） | `SUSPENDED_MESSAGE`（"本轮已停止执行工具，请直接结束回答"） |

## 4. 错误码（全局唯一）

| 码 | 通道 | 语义 | 前端处理 |
|---|---|---|---|
| `ONTOLOGY_RULE_FUNCTIONS_MISSING` | 工具失败结果（`details.toolError`） | 前置规则所需函数未执行（规格 `FR-016`） | 无需新增映射：卡片按失败态展示正文 |
| `ONTOLOGY_RULE_DENIED` | **工具失败结果**（`details.toolError`，2026-11-09 起；此前为 SSE `error` + 失败轮） | 规则求值不成立 / 规则不可用 / 函数未注册，本次调用被拒绝且挂起本轮（规格 `FR-033`） | 无需新增映射：卡片按失败态展示正文（含结论 + 明细 + 终局指令）；错误码映射保留用于历史失败行 |

**数量约束**：本特性新增错误码总数 **2 个**（暂停 1 + 拒绝 1），MUST NOT 再有第三个；
两者的"通道—码"对应关系由规格 `FR-016` / `FR-033` 冻结，实现期不得互换或合并。

**拒绝内部的原因分类**（不新增码，只进卡片明细与日志 `reason`，规格 `FR-044`）：

| `reason` | 触发 | 可自愈 |
|---|---|---|
| `unregistered` | 规则引用的函数未注册（前置 → 不执行；后置 → 已执行后放弃提示） | 否（配置问题） |
| `condition_false` | `rule_design` 求值为 `false` | 否 |
| `config_unavailable` | `rules` 段或 `rule_design` 结构非法、求值器异常 | 否 |

与既有码不冲突：020 的两码是 `ONTOLOGY_SCOPE_DENIED`（含 `disable`）/
`ONTOLOGY_SCOPE_UNAVAILABLE`；本特性不复用、不改写它们。

> 2026-11-09：020 的 `ONTOLOGY_BEHAVIOR_DISABLED` 已并入 `ONTOLOGY_SCOPE_DENIED`
> （对外统一"未授权"，`reason: 'disabled'` 保留），本特性的"不复用"结论不受影响。

### 4.1 与 020 权限闸门的收尾口径（2026-11-09 对齐）

| 维度 | 020 权限拒绝 | 021 规则拒绝 |
|---|---|---|
| 本轮是否继续 | **继续（软收尾）**：其余工具不再执行，模型据终局指令总结后正常 `done` | **同左**（2026-11-09 由硬中止改为软收尾） |
| 挂起状态 | `domain/tool-suspension.ts`，装配层每轮新建 | **与 020 共享同一份实例**（021 在内侧，必须看到同一份状态） |
| 有界退出 | 第 2 次被拦 → `interruptRun`（`ABORTED`） | 同左（同一个 `onExhausted` 出口） |
| 错误码 | `ONTOLOGY_SCOPE_DENIED` / `ONTOLOGY_SCOPE_UNAVAILABLE` | `ONTOLOGY_RULE_DENIED`（+ 日志 `reason` 三分类） |
| 卡片正文 | 拒绝文案 + 终局指令 | 结论 + 明细 + 终局指令（多一段逐条原因） |

两者共用「工具失败标记」通道、共享挂起机制与「文案唯一来源」原则；差异只在错误码与正文段落。

## 5. 拒绝卡片正文（2026-11-09 起）

拒绝不再产生失败轮，`details` 由**卡片正文**承载（而非 SSE `error` 载荷）：

```text
本体行为「原材料采购和库存/CreatePurchaseRecord」未通过前置规则校验，本次调用已拒绝。
行为：原材料采购和库存/CreatePurchaseRecord
规则：采购-供应商名称一致（V05_SupplierExistence）
结论：供应商名称不存在，禁止创建采购单
未成立条件：checkSupplierExistence.pass eq "true"

本轮已因规则校验停止执行工具，后续工具调用不再执行；请向用户说明原因并结束本轮回答。
```

- 第一段是 `PrepareResult.deny.message`（结论）；第二段是 `details` 逐条（明细，
  3~6 条）；末段是 `RULE_TERMINAL_NOTICE`（终局指令）。明细与终局指令由
  `denyCardBody(details)` 拼成第二个文本块，模型与卡片看到的是同一份（`FR-031`）。
- `details.toolError.message` 仍是**结论原文**，不掺入明细与终局指令。
- 后置阻断时，业务结果正文**逐字保留**，阻断说明与终局指令追加在其后；该结果**不带**
  失败标记（行为确实执行成功）。

**历史兼容**：改动前已落盘的失败轮 `error` 仍可能含
`{ code: 'ONTOLOGY_RULE_DENIED', reason, details }`；`toHistoryErrorInfo` 与前端映射保留，
只为读旧记录，MUST NOT 再产生新的同类失败行。

## 6. 前端消费契约（2026-11-09 起零改动）

- 拒绝复用既有工具失败卡片：`resultText` 由 `serializeToolResult` 把多个文本块以换行拼接，
  卡片用 `<pre>`（`white-space: pre-wrap`）渲染，多行正文照常显示，**无需新增组件或映射**；
- `ONTOLOGY_RULE_DENIED` 的文案映射与 `details` 受控透传（初版新增）保留，仅用于展示历史失败行；
- 未知码兜底逻辑不变；不新增 UI 组件、不改 `ErrorNotice`。

## 7. 日志事件（结构化，字段见 data-model §7）

`rule_gate.paused` / `rule_gate.denied` / `rule_gate.suspended` / `rule_gate.blocked` /
`rule_gate.unavailable` / `rule_gate.catalog.degraded` / `rule_gate.record.dropped` / `rule_gate.posted`。

- 每个事件 MUST 含 `ts`（ISO 8601）与 `event`（事件名），对齐 `FR-035` / `SC-005` 的"含时间"；
- `rule_gate.denied`（首次拒绝，`warn`）承载判定字段；`rule_gate.suspended`（挂起后每次被拦，`warn`）
  只记 `tool_name` / `code` / `attempts`，MUST NOT 重复判定字段（`FR-047`）；
- `rule_gate.blocked` MUST 为 `error` 级，含 `phase`（`pre` / `post`）与 `unregistered_functions`，
  后置阻断另带 `executed: true`（`FR-041` / `FR-042` / `SC-009`）；
- `unavailable` MUST 为 `error` 级并带 `alert: true`（配置问题需运维介入，软收尾不降级可观测性）；
- 任一事件 MUST NOT 记录函数结果正文、工具入参、规则 `values` 原文；`record.dropped` MAY 记
  `bytes` / `count` 等元信息（`FR-040` 修订口径）。

## 8. 明确不做的事

- 不新增端点、不新增 SSE 事件类型、不新增请求字段；
- 不修改 `POST /api/threads/{id}/messages` 的请求/响应形状（软收尾后连失败轮 `error` 都不再新增字段）；
- 不在管理平台侧新增规则编辑/校验/下发逻辑（`rules` 现状已整包下发）；
- 不消费 `data_supplements`（只随全文反馈给模型）；
- 不提供"关闭闸门"的开关、不做规则结果的持久化或审计留存。
