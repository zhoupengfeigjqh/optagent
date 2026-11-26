# 契约：多步任务规划与滚动执行（028）

- **规格**：[../spec.md](../spec.md)
- **数据模型**：[../data-model.md](../data-model.md)
- **日期**：2026-11-25

## 1. 对外契约

**本特性不新增、不修改任何 HTTP 端点；Phase 9（2026-11-26）起新增 1 个 SSE 事件 `plan_progress`**，其余契约零修改。

| 契约面 | 结论 |
|---|---|
| HTTP 端点 | 零新增、零修改 |
| SSE 事件 | **新增 1 个：`plan_progress`**（见 §1.1）；`thinking` / `content` / `tool_call` / `tool_call_end` / `interaction_request` / `done` / `error` 全部保持原样 |
| `history.jsonl` | 零新增字段；计划与进度不写入 |
| `tool-events.jsonl` | 零新增字段；工具结果照常落盘 |
| `intent-focus.jsonl` | 零新增字段 |
| `summary.json` | 不读取、不写入 |
| 前端 | 新增 `PlanProgressBar.vue` 消费 `plan_progress`；未消费该事件的旧前端行为不变（事件被忽略） |

### 1.1 `plan_progress`（唯一新增事件，FR-034 / FR-035）

```
event: plan_progress
data: {"seq_id":2,"label":"查询库存","phase":"running"}
```

| 项 | 口径 |
|---|---|
| `seq_id` | 当前步编号；重规划后允许跳变（滚动规划的正常形态，不是进度倒退） |
| `label` | 步名（`taskName`），不是模型原话；空串不下发 |
| `phase` | `running` 进入某步 / `replanned` 重规划装批后进入新步 / `done` 本轮收尾 |
| 发点 | **恰好三处**：装批与步推进（`enqueue`、`shouldStopAfterTurn` 完成分支）、重规划装批（`replanned`）、`terminate`（`done`，仅一次） |
| 空轮 | **零发**：首轮 `[]`、无可用工具、无聚焦结果都不发 |
| 持久化 | **不落盘、不进 `history.jsonl`、不进尾部块、刷新不恢复** |
| 载荷边界 | MUST NOT 携带计划正文、失败原因或工具结果（FR-030 / FR-031） |
| 前端形态 | 默认折叠为输入区上方一行「第 N 步 · 步名」；展开只列**本轮已出现的步骤**（只读、按 `seq_id` 去重）；结束淡出 1.5s |

**一条对外可见的行为变化**：工具批次由并行改为严格串行（Phase 0 已上线）。表现为同一 `tool_call` 批次内事件的发出顺序与模型输出顺序一致。前端若存在依赖「完成顺序」的逻辑，需回归一次，但契约字段不变。

### 1.2 规划门禁（FR-037，2026-11-26）

**运行侧配置**（`config.yaml` 的 `intent_focus` 块内，不新增独立块）：

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `plan_threshold` | 0~1 | **缺键 = 门禁关闭** | 分数 ≥ 该值才走规划；环境变量 `INTENT_FOCUS_PLAN_THRESHOLD` 可覆盖 |
| `plan_timeout_ms` | 300~10000 | 5000 | 单次判定超时；不得大于 `timeout_ms`；超时 fail-open（仍走规划） |

**`intent-focus.jsonl` 增量字段**（只增不改）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_score` | number \| null | 门禁分数；`null` = 没判（门禁关闭 / 未开规划 / 判定失败） |
| `plan_round_ms` | number \| null | 门禁判定耗时（毫秒） |

**日志增量**：`plan.gate.degraded`（判定失败，fail-open）、`plan.skipped reason=below_threshold`（含 `plan_score` / `threshold`）。均为日志，不新增 SSE 事件。

### 1.3 运行侧配置落点（v0.20，2026-11-26）

**规则**：一个参数只有一个真源，真源由"它因什么而变"决定。

| 类别 | 判据 | 落点 |
|---|---|---|
| 密钥 | 有泄密风险 | env（`.env.local` 本地 / `.env` 容器），`config.yaml` 只允许 `$VAR` 引用 |
| 拓扑/进程 | 随部署点、容器名、端口、路径变 | env：`PUBLIC_BASE_URL` / `ADMIN_BACKEND_URL` / `INTENT_FOCUS_BASE_URL` / `PORT` / `OPT_AGENT_ROOT` / 池与超时 |
| 业务口径 | 随产品策略与模型能力变 | `config.yaml`：`models[]`、`intent_focus` 阈值与上限、`plan_threshold` / `plan_timeout_ms` |
| 实现不变量 | 改了就是改规格 | 代码常量（`domain/plan/types.ts`） |

**形态差异只有三项**（同一份 `config.yaml` 两形态通用）：

| 键 | 本地 `.env.local` | 容器 `.env` |
|---|---|---|
| `PUBLIC_BASE_URL` | `http://<本机 LAN IP>:3000` | `http://<宿主 LAN IP>:82` |
| `ADMIN_BACKEND_URL` | `http://127.0.0.1:3001` | `http://admin-backend:3001` |
| `INTENT_FOCUS_BASE_URL` | `http://127.0.0.1:8103` | `http://laya:8000` |

`config.yaml` 对应写法：`intent_focus.base_url: $INTENT_FOCUS_BASE_URL`、`intent_focus.api_key: $DECIS_API_KEY`。
`docker compose` 的 `backend.env_file` 只注入 `.env`，**MUST NOT** 再用 `environment` 覆盖其中任何键。

**v0.21 补充（2026-11-26，配置收敛批次 2~4）**

| 变更 | 内容 |
|---|---|
| 删除 env 覆盖 | `INTENT_FOCUS_*_THRESHOLD` 5 个；同名 yaml 键是唯一真源 |
| env → yaml | `MCP_TIMEOUT_MS` → `runtime.mcp_timeout_ms`（缺省 90000）；`MCP_CONNECT_TIMEOUT_MS` → `runtime.mcp_connect_timeout_ms`（10000）；`LLM_MAX_RETRIES` → `runtime.llm_max_retries`（2）；`LLM_RETRY_MAX_DELAY_MS` → `runtime.llm_retry_max_delay_ms`（15000） |
| env → 代码常量 | `UPLOAD_MAX_MB` 5 / `PREVIEW_MAX_MB` 5 / `READ_TRUNCATE_KB` 128（`src/domain/limits.ts`） |
| 新增 yaml 块 | `plan.timeout_ms`（20000，1000~600000）、`plan.total_steps_max`（20，1~100）、`plan.replan_max_per_run`（6，0~50）；越界拒绝启动 |
| 校验 | `runtime.mcp_connect_timeout_ms` 不得大于 `mcp_timeout_ms`；`runtime` / `plan` 块 `.strict()`，拼错键拒绝启动 |
| 启动可观测 | `config.effective`（密钥不出现在摘要内）+ `config.unknown_env`（拼错/已废弃 env 告警，不拒绝启动） |
| 服务清单 | `admin-backend` 无 yaml（无业务口径，全 env）；`ocr/jev/bom/laya/fresh` 全 env，容器统一读 `.env` |

---

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
