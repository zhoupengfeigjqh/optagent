# Quickstart：端到端验证指南

**Feature**: 002-agent-chat-ui | 前置：Node.js ≥ 20，已 `npm install`，`.env` 与 `config.yaml` 已配置（`config.yaml` models ≥ 2 条以验证模型切换）

## 启动

```bash
npm run dev   # 或 node --env-file=.env --watch ...（按 package.json 脚本）
```

## 场景 1：工具调用事件 + 耗时（US1 / FR-001~006）

1. `POST /api/agents/:name/select` 选中带工具的数字人；`POST /api/threads {"agent_name": "..."}`
2. `POST /api/threads/:id/messages`（`{"content": "列出生产计划目录的文件"}`），用 `curl -N` 观察 SSE
3. **预期**：出现 `event: tool_call`（含 name、call_id，无入参）→ `event: tool_call_end`（无结果内容）→ `event: done` 含 `duration_seconds` 与 `message_id`；全程无 `result`/`args` 字段出现

## 场景 2：历史元数据与零思考/工具落盘（US2 / FR-007~012）

1. 以 `"thinking": true` 完成一轮带工具调用的对话
2. `GET /api/threads/:id` 查询历史
3. **预期**：每条消息有 `id/ts`；assistant 消息有 `usage/duration_seconds`；全量响应中不出现思考文本与任何工具名字段；`grep -c '"type"' .opt-agent/**/history.jsonl` 仅命中反馈行

## 场景 3：反馈互斥（US3 / FR-013~017）

1. 取场景 1 done 的 `message_id`
2. `PUT /api/threads/:id/messages/:mid/feedback {"value":"up"}` → 再 `{"value":"down"}` → 再 `{"value":"down"}`（取消）
3. `GET /api/threads/:id` **预期**：feedback 依次为 up → down → null；对伪造 mid 提交返回 404 MESSAGE_NOT_FOUND

## 场景 4：当前数字人与 MCP 状态（US4 / FR-018~021）

1. `GET /api/agents/current` → 返回当前选中；exit 后再查 → `agent_name: null`
2. select 后 `GET /api/agents/current/mcp` → 各服务 status ∈ connected/failed
3. 会话进行中调用 `POST /api/agents/:other/select` → **预期** 200（覆盖式切换，无需 exit；进行中的 run 不受影响，下一轮消息生效）

## 场景 5：模型列表与切换（US5 / FR-022~024）

1. `GET /api/models` → 列表含默认标识，且无 api_key 字段
2. 发消息带 `"model": "<第二项>"` → 正常完成；带 `"model": "not-exist"` → 400 MODEL_NOT_FOUND 且未产生 run

## 场景 6：三空间上传 / 预览 / @ 引用（US6 / FR-025~030）

> **2026-09-13 修订**：`dir` 取值由 `tmp` 改为三空间相对路径。

1. `POST /api/files/upload`（dir=临时空间，1.csv）→ 201；
   dir=数据准备/生产计划 传 .xlsx → 201，传 .txt → 400（该空间仅 csv/xlsx）；
   dir=数据准备（不带子目录）→ 400；dir=数据准备/不存在 → 403
2. `GET /api/files/preview?dir=临时空间&filename=...` → 200 且 `Content-Disposition: inline`、Content-Type 为 text/csv；预览不存在文件 → 404
3. 发消息带 `attachments: [{dir:"临时空间", filename:"..."}]` → done 后 `GET /api/threads/:id`，该 user 消息含 attachments 且 content 中带引用段；引用不存在文件 → 400 FILE_REF_NOT_FOUND

## 场景 7：工作空间汇总（US7 / FR-030）

1. 在三个空间各放文件（数据准备放在某个 scenario 子目录下），`GET /api/files/workspace` →
   **预期**：`scenario` 为场景名；`spaces` 三项；数据准备下 `dirs` 数量等于 `data_prep_dirs` 数量，
   有文件的目录 `files` 非空、空目录 `[]`；共享空间的 `deletable` 为 `false`
2. 隐藏 `scenario.json` 后再次调用 → **预期**：503 `SCENARIO_NOT_CONFIGURED`

## 回归

- `npm run test`（unit + integration 全绿，核心覆盖率 ≥80%）
- 旧格式 history.jsonl（仅 role/content 行）可被正常读取：消息带合成 id、无 usage 字段，不影响新对话
