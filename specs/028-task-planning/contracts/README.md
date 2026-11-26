# 契约：多步任务规划与滚动执行（028）

- **规格**：[../spec.md](../spec.md)
- **数据模型**：[../data-model.md](../data-model.md)
- **日期**：2026-11-25

## 1. 对外契约

**本特性不新增、不修改任何对外契约。**

| 契约面 | 结论 |
|---|---|
| HTTP 端点 | 零新增、零修改 |
| SSE 事件 | 零新增、零修改（`thinking` / `content` / `tool_call` / `tool_call_end` / `interaction_request` / `done` / `error` 全部保持原样） |
| `history.jsonl` | 零新增字段；计划与进度不写入 |
| `tool-events.jsonl` | 零新增字段；工具结果照常落盘 |
| `intent-focus.jsonl` | 零新增字段 |
| `summary.json` | 不读取、不写入 |
| 前端 | 无代码改动要求 |

**一条对外可见的行为变化**：工具批次由并行改为严格串行（Phase 0 已上线）。表现为同一 `tool_call` 批次内事件的发出顺序与模型输出顺序一致。前端若存在依赖「完成顺序」的逻辑，需回归一次，但契约字段不变。

## 2. 设计态契约（管理端）

| 契约面 | 变更 | 缺省 |
|---|---|---|
| SOUL frontmatter | 新增布尔键 `task_planning` | 缺键即 `false`（fail-closed） |
| `.platform-data/agents/{name}.json` 的 `soul` | 新增同名布尔键 | 读取归一化恒有该键，缺省 `false` |
| 写入规则 | 仅在 `true` 时写键（与 `input_rewrite` / `term_normalize` 同口径） | — |

**前置关系（界面语义）**：`task_planning` 与 `intent_focus` 为**逻辑与**。`intent_focus` 关闭时，复选框置灰不可编辑但**保留已选值**，重新开启后恢复（与 `019` 的「聚焦阶数」同口径，不静默清空）。

## 3. 内部契约（模块间）

本特性内部有 4 条跨模块契约，均登记在 [../data-model.md](../data-model.md)：

| 编号 | 契约 | 位置 |
|---|---|---|
| IC-001 | `parse` → `RawStep[]` 或结构化错误，不抛异常 | data-model §2 |
| IC-002 | `normalize` 只补全、幂等；不校验、不抛异常 | data-model §3 |
| IC-003 | `check` 只判定、不改数据；失败返回 `{code, seqId, field, detail}[]` | data-model §2（`RawStep`）、§3.1（字段来源）、spec FR-012 |
| IC-004 | `state` 是唯一状态转移点，输入为整批 `toolResults` + 当前 `PlanState`，输出为转移后的 `PlanState` 与终止信号 | data-model §6、§7 |
| IC-005 | `AgentRunRequest.focusPrompt?: string`：`run-consume` 把本轮 `focus.prompt` 原文单独传入，供规划第 2 段使用；缺省 = 无聚焦结果 → `plan.skipped(empty_focus)`。MUST NOT 复用 `systemExtra`（其中含滚动摘要 / 产出清单 / 卡片指令） | `src/domain/run-manager.ts`、`src/domain/run-consume.ts` |
| IC-006 | `RuleGatePort.lookupBehavior(toolName)`：只读返回 `{ toolName, command, relatedFunctions, ref }` 或 `null`；不改判定分支、不写 `FunctionRecord`（FR-029 回归断言见 `rule-gate-gate.spec.ts`） | `src/domain/rule-gate/gate.ts` |

## 4. 与既有模块的只读契约

| 既有模块 | 本特性如何使用 | 约束 |
|---|---|---|
| `domain/rule-gate` | 只读查询 `opType` 与前置 `relatedFunctions` | 不修改判定语义；不写 `FunctionRecord` |
| `domain/intent-focus/ontology-loader` | 只读 `behaviors[].concept`、`functions[].relatedConcepts`、`concepts` | 不修改装载逻辑；新增带 mtime 缓存的封装层 |
| `domain/tool-error` | 复用 `readToolError` 读取统一失败标记 | 不新增错误码 |
| `domain/tool-suspension` | 终止时调用 `suspendTools` | 不使用 `abortRunFatal` |
| `infra/agent-loop` | 透传 4 个可选钩子 | 不改变既有 `afterToolCall` 与串行配置 |
