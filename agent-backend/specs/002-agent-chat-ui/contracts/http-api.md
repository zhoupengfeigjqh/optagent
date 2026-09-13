# 契约：REST 接口（变更/新增）

**Feature**: 002-agent-chat-ui | **Base**: `/api` | 错误体统一 `{error:{code,message,details?}}`

## 变更接口

### GET /api/threads/:id（历史返回升级）

查询参数 `limit`（≤200，默认 50）、`offset` 不变。`messages` 元素升级为：

```json
{
  "id": "m_lxyz12_ab3f",
  "role": "user|assistant",
  "content": "...",
  "ts": "2026-09-10T08:00:00.000Z",
  "status": "completed|failed",
  "usage": {"input_tokens": 123, "output_tokens": 456},
  "duration_seconds": 4.2,
  "attachments": [{"dir": "生产计划", "filename": "a.csv"}],
  "feedback": "up|down|null",
  "error": {"code": "...", "message": "..."},
  "agent_name": "ops"
}
```

`status/usage/duration_seconds/attachments/error/agent_name` 可缺省（旧数据/不适用）；`feedback` 恒返回（默认 null）。**任何消息不含思考内容与工具调用信息。**
`agent_name` 为该轮回答的数字人（**2026-09-10 修订**：会话不绑定数字人，同一会话内可切换，user/assistant 成对返回）。

### POST /api/files/upload（放开 tmp）

- `dir` 白名单扩展为 10 个：7 业务目录 + shared + tmp
- tmp 目录校验规则与其他目录一致（扩展名 .csv/.xlsx/.txt/.json/.pdf，≤50MB）
- **2026-09-13 修订**：扩展名白名单新增图片 `.jpg/.jpeg/.png/.bmp/.webp/.gif/.tif/.tiff`（供 OCR 识别与内联预览）
- 其余行为（时间戳落盘名、413/400 错误）不变

## 新增接口

### GET /api/models

→ `200 {"models": [{"model": "deepseek-chat", "is_default": true}, ...]}`（不含 api_key/base_url）

### GET /api/agents/current

→ `200 {"agent_name": "xxx"}`；未选中 → `200 {"agent_name": null}`

### GET /api/agents/current/mcp

→ `200 {"agent_name": "xxx", "mcp_servers": [{"name": "erp", "transport": "http", "status": "connected|failed|unknown"}]}`

- 未选中数字人 → `200 {"agent_name": null, "mcp_servers": []}`
- 状态来源：池内活跃实例的实际连接结果，三态语义：
  - `connected` — 已建连可用
  - `failed` — 建连失败，实例已降级并标记该服务不可用
  - `unknown` — **尚无连接结果**（实例未创建，或首次建连进行中）
- 实例未创建时 MUST 返回配置清单全列、状态一律 `unknown`；MUST NOT 以 `failed` 兜底
  （否则切换数字人后尚未发起对话时，前端会把"尚未建连"误呈现为"断线故障"）
- 滞后口径：已连接服务的状态变更由连接错误回调即时反映（≤5s，FR-019/SC-005）；
  建连为异步（不阻断实例就绪），建连耗时上限 MCP_TIMEOUT_MS（默认 30s），期间状态为 `unknown`
- 断线检测（2026-09-12 新增）：建连成功后连接意外断开（server 进程退出 / 网络中断，
  经 MCP SDK transport onclose 回调检测）→ 立即将该 server 标记为 `failed` 并触发推送；
  主动 close（实例回收）不误标。`connected` 由此代表真实活性而非"建连那一刻的快照"
- 自动重连（2026-09-12 新增）：断线/建连失败后按退避表 5s→15s→30s→60s→60s 最多重连 5 次
  （约 3 分钟窗口，覆盖 server 重启/网络抖动）；成功即清零计数并推送 `connected`。
  5 次全败后停止后台重试，之后 `callTool`/`listTools` 命中不可用 server 时惰性补试一次，
  server 恢复后于下次使用时自愈，无永久后台重试

### GET /api/agents/current/mcp/events（SSE，2026-09-12 新增）

MCP 状态推送流，替代前端轮询。

→ `200 text/event-stream`；事件 `mcp-status`，`data` 为与 GET .../mcp 相同的快照 JSON

- 连接建立即推送一次当前快照；之后每当内部事件总线发出变更（建连落定、连接断开、
  select/exit 选中变化）按**当时选中**重算快照再推（交错事件不会推错数字人）
- 25s 心跳注释行保活；客户端断开即退订
- 快照计算异常（如选中数字人配置损坏）时推送 `{agent_name:null, mcp_servers:[]}`，不断开流

### PUT /api/threads/:id/messages/:mid/feedback

请求：`{"value": "up|down|null"}`；同值重复提交 = 取消（置 null）。

→ `200 {"message_id": "m_...", "feedback": "up|down|null"}`

错误：`404 THREAD_NOT_FOUND` / `404 MESSAGE_NOT_FOUND` / `400 VALIDATION_FAILED`（非法 value）

### GET /api/files/preview?dir=&filename=

内联预览（区别于 download 的 attachment）：

- `200`：Content-Type 按扩展名映射（.txt→text/plain; charset=utf-8、.json→application/json、.csv→text/csv; charset=utf-8、.pdf→application/pdf、.xlsx→application/octet-stream + attachment 回退）；`Content-Disposition: inline`
- 预览大小上限：10MB（`PREVIEW_MAX_MB` 可配，默认 10）；超限 → `413 FILE_TOO_LARGE`（预览仅供在线查看，完整文件走 download）
- `404 FILE_NOT_FOUND`：文件不存在或已被 tmp 清理
- `400 VALIDATION_FAILED`：非法 dir/filename；`403 UPLOAD_DIR_FORBIDDEN`：非白名单目录

### GET /api/files/workspace

→ `200 {"dirs": [{"dir": "生产计划", "files": [{"filename": "a.csv", "size": 123, "updated_at": "..."}]}, ...]}`

固定返回全部 9 个白名单目录（7 业务 + shared + tmp），空目录 files 为 `[]`。

### GET /api/files/raw（2026-09-13 新增，MCP 签名直链回源）

无会话下载端点：**URL 即凭证**，供 MCP 服务（OCR 等，无磁盘访问权）凭 backend 签发的 URL 回源取文件。
签名铸造与 file_args 机制详见 `specs/003-ocr-mcp-signed-url/spec.md`。

- 参数：`u`（用户）、`p`（user-data 相对路径）、`exp`（过期 epoch ms）、`sig`（HMAC-SHA256 hex）
- `200`：文件字节；Content-Type 按扩展名映射（未知 octet-stream）；`Cache-Control: no-store`
- `403 FILE_SIGN_INVALID`：验签失败或已过期（时效 24h）
- `404 FILE_NOT_FOUND`：文件不存在或越权（验签后仍过 FileAccess 沙箱）
- `400`：缺参

## 不变接口（确认满足前端需求，无需变更）

- `POST /api/threads`、`GET /api/threads`（默认 10 条/更多 100 条由前端 limit/offset 控制）、`PATCH/DELETE /api/threads/:id`
- `POST /api/threads/:id/stop`
- `GET /api/agents`、`GET /api/agents/:name`、`POST /api/agents/:name/select`（**覆盖式**：切换无需先 exit，**2026-09-10 修订**）、`POST /api/agents/current/exit`
- `GET /api/files/list`、`GET /api/files/download`
- `GET /api/usage/summary`
