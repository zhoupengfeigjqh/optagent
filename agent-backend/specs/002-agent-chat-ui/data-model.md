# Phase 1 数据模型

**Feature**: 002-agent-chat-ui | **Date**: 2026-09-10

## 存储格式：history.jsonl（升级）

每行一个 JSON 对象，两类行：

### 消息行（message）

```json
{
  "id": "m_lxyz12_ab3f",
  "role": "user|assistant",
  "content": "正文",
  "ts": "2026-09-10T08:00:00.000Z",
  "status": "completed|failed",
  "usage": { "input_tokens": 123, "output_tokens": 456 },
  "duration_ms": 4200,
  "attachments": [{ "dir": "生产计划", "filename": "a_20260910_080000.csv" }],
  "error": { "code": "LLM_ERROR", "message": "LLM 调用失败" }
}
```

| 字段 | 必含 | 说明 |
|---|---|---|
| id | 新行必含 | 消息唯一标识，线程内唯一；格式 `m_{base36时间戳}_{4位随机}` |
| role / content | 必含 | 沿用旧语义；**不含思考内容、不含工具调用信息（类型层面无此字段）** |
| ts | 新行必含 | ISO8601；旧行缺省时读取回填线程创建时间 |
| status | 仅 assistant | `completed`（默认，可省略）/ `failed` |
| usage / duration_ms | 仅 assistant 完成轮 | 整轮聚合；失败轮若已消耗则照常记录 |
| attachments | 仅 user 可选 | @ 文件引用，≤10 个 |
| error | 仅 failed 行 | 错误码与信息 |
| agent_name | 可选 | **2026-09-10 新增**：该轮回答的数字人；会话可跨数字人，user/assistant 成对写入 |

### 反馈行（feedback）

```json
{ "type": "feedback", "message_id": "m_lxyz12_ab3f", "value": "up", "ts": "..." }
```

- `value`: `"up" | "down" | null`（null = 取消）
- 合并规则：按行序，同 message_id 后者覆盖前者；最终值随历史查询返回为消息的 `feedback` 字段
- 反馈行不影响 `convertToLlm`（提交给 LLM 时过滤，仅消息行参与）

### 旧格式兼容

旧行 `{role, content}`：读取时合成 `id = "{threadId}-{行号}"`，`ts` 回填线程创建时间，无 usage/duration/feedback 字段（前端按缺省渲染）。写路径只产生新格式。

## 内存/传输实体

### SsePayload（扩展）

| 事件 | data | 说明 |
|---|---|---|
| thinking | `{delta}` | 不变；不落盘 |
| content | `{delta}` | 不变 |
| tool_call | `{call_id, name, status:'running'}` | **新增**；仅工具名与标识，无入参 |
| tool_call_end | `{call_id, status:'success'|'error'}` | **新增**；无结果内容 |
| done | `{finish_reason, usage:{input_tokens,output_tokens}, duration_seconds, message_id, agent_name}` | **变更**：+duration_seconds、+message_id（前端对消息做反馈需用）；**+agent_name**（2026-09-10：会话可跨数字人） |
| error | `{error:{code,message}, duration_seconds?, usage?, agent_name}` | **变更**：+duration_seconds、+usage（可统计时提供）；**+agent_name** |

### FileReference

`{dir: string, filename: string}` —— **2026-09-13 修订**：dir 为三空间相对路径
（`数据准备/{业务子目录}`、`共享空间`、`临时空间`）；文件地址 = dir + "/" + filename。

### McpServiceStatus

`{name: string, transport: 'stdio'|'http', status: 'connected'|'failed'|'unknown'}` —— 池内实例存在时取实际连接结果；实例未创建或首次建连进行中为 `unknown`（不得以 `failed` 兜底）。

### ModelInfo

`{model: string, is_default: boolean}` —— config.yaml models 的只读投影（不含 api_key/base_url）。

## 状态流转

**消息轮次**：`running（SSE 流中）→ completed（done，落盘 usage/duration）| failed（error 事件，落盘 error 元数据）| aborted（stop，不落消息行，usage 照记——沿用 FR-027 语义）`

**反馈**：`none → up ⇄ down → none（同值重复提交=取消）`，互斥由"单值覆盖"天然保证。

## 校验规则

- `attachments`：dir 过 checkDir 白名单与穿越校验；文件须存在；数组 ≤ 10
- `model`：须命中 config.models，否则 400 MODEL_NOT_FOUND
- `feedback.value`：枚举校验，非法值 400 VALIDATION_FAILED
- `preview`：dir/filename 同 download 校验；扩展名 ∈ {.txt,.json,.csv,.pdf,.xlsx}
