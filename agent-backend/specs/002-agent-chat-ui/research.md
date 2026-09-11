# Phase 0 调研：技术决策

**Feature**: 002-agent-chat-ui | **Date**: 2026-09-10

所有技术栈沿用现有项目（TypeScript ESM + Fastify 5 + pi-agent-core + JSONL/better-sqlite3 存储），本文件只记录缺口能力的方案决策。无 NEEDS CLARIFICATION 残留。

## D1. 工具调用事件的来源与剥离

- **Decision**: 在 [agent-loop.ts](../../../src/infra/agent-loop.ts) 的 `emit` 中拦截 pi-agent-core 的 `tool_execution_start` / `tool_execution_end`，映射为新的 `LlmEvent`：`{type:'tool_call_start', callId, name}` 与 `{type:'tool_call_end', callId, status:'success'|'error'}`；**args / result / partialResult 一律不复制**。run-manager 转发为 SSE 事件 `tool_call`（`{call_id, name, status:'running'}`）与 `tool_call_end`（`{call_id, status}`）。
- **Rationale**: pi-agent-core 原生暴露 toolCallId/toolName（types.d.ts 第 399-414 行），无需修改框架；在 agent-loop 边界剥离参数与结果，保证"0 透出"由单点把关，后续即使框架升级事件结构也不影响契约。
- **Alternatives considered**: ①在 run-manager 层订阅 pi 事件——破坏分层（domain 不应感知 pi 类型），否决；②用 toolName 作配对键——同一工具可并发/连续多次调用，必须用 callId 配对。

## D2. 耗时统计口径

- **Decision**: run-manager 在 `startRun` 时经注入时钟 `now()` 记 `startedAt`，在 `finalizeDone/finalizeAborted/error` 时计算 `durationMs`；done/error SSE 事件附带 `duration_seconds`（保留 1 位小数）；同一值写入历史元数据。
- **Rationale**: 注入时钟已有（`RunManagerDeps.now`），测试可确定性断言；口径为"整轮（含工具循环全部 LLM 往返）"，与 usage 聚合口径（agent-loop 中全跳累加）一致。
- **Alternatives considered**: 前端自行计时——网络延迟与断连重入会污染数据，否决。

## D3. 历史行格式升级与向后兼容

- **Decision**: history.jsonl 行升级为：`{id, role, content, ts, status?, usage?, duration_ms?, attachments?, agent_name?}`（**2026-09-10 修订**：`agent_name` 记录该轮回答的数字人——会话可跨数字人，切换后逐条标注）。`parseLine` 容忍缺省字段：旧行（仅 role/content）读取时合成稳定 `id`（`{threadId}-{行号}`）与缺失时间戳（取线程创建时间）；状态 `status: 'completed'|'failed'`，失败行带 `error:{code,message}`。消息 ID 新行用 `m_{时间戳base36}_{随机4位}`。**thinking 与 tool 调用信息不定义任何落盘字段**，从类型层面杜绝（HistoryMessage 无相应字段）。
- **Rationale**: 单行 JSON 一次 append 天然满足 FR-034 原子性（沿用 per-thread Promise 链）；旧数据零迁移可读。
- **Alternatives considered**: ①元数据存 usage.db 按 thread 关联——跨库 join 且消息级配对脆弱（同 thread 多轮无法区分），否决；②全量迁移旧文件——无收益且引入风险，否决。

## D4. 反馈存储

- **Decision**: history.jsonl 中追加反馈行 `{type:'feedback', message_id, value: 'up'|'down'|null, ts}`；读取历史时顺序合并，同 message_id 后者覆盖前者；`GET /api/threads/:id` 返回消息时携带 `feedback` 字段。接口 `PUT /api/threads/:id/messages/:mid/feedback`，body `{value}`，同值重复提交 = 取消（置 null）。
- **Rationale**: 与消息同文件、同串行链，无并发错乱（FR-017）；append-only 语义简单可审计；反馈行不属于"消息"，parseLine 单独分支处理。
- **Alternatives considered**: ①直接改写消息行——JSONL 追加式存储不支持原地改，需重写整个文件，否决；②存 usage.db——混入非用量语义，且 better-sqlite3 表结构变更无收益，否决。

## D5. 当前数字人与 MCP 状态接口

- **Decision**: 新增 `GET /api/agents/current` → `{agent_name}|{agent_name:null}`；新增 `GET /api/agents/current/mcp` → `mcp_servers:[{name, transport, status:'connected'|'failed'}]`。状态来源：池内实例存在 → 取该实例 mcp-manager 的连接结果（unavailable 名单 → failed）；实例未创建 → 以数字人配置的 mcp_servers 清单为全集，状态一律 `failed`（未连接即中断，与前端红/绿二态一致）。
- **Rationale**: 复用 monitor 路由已验证的 unavailable_mcp 数据源；不引入主动探测，状态滞后来自 MCP 连接生命周期。滞后口径：已连接服务的状态变更由错误回调即时反映（≤5s）；例外是实例首次建连过程（受 MCP_TIMEOUT_MS 30s 上限约束），该窗口内按 failed 返回。
- **Alternatives considered**: 按需主动 ping 每个 MCP——增加探测流量与接口延迟（违反 P95 200ms），否决。

## D6. 模型列表与按消息切换

- **Decision**: 新增 `GET /api/models` → `{models:[{model, is_default}]}`（不出 api_key/base_url）。发消息 body 增加可选 `model` 字段；chat 路由校验该模型存在于 `config.models`（不存在 → 400 `MODEL_NOT_FOUND`），解析出对应 `ModelEntry`（含 apiKey/baseUrl）注入 `StartRunOptions`；agent-factory/llm 层按该 entry 构造本次 run 的 model 与 streamFn，**不重建池内实例**（模型是请求级参数，实例共享 MCP/工具连接）。
- **Rationale**: config.yaml 已是模型权威来源，接口只是只读投影；请求级注入避免按模型维度膨胀实例池（POOL_SIZE 语义不变）。
- **Alternatives considered**: 按 (agent, model) 作池 key——池容量与 MCP 连接数成倍增长，复杂度无对应收益，否决。

## D7. 文件引用（attachments）提交与落盘

- **Decision**: 发消息 body 增加可选 `attachments: [{dir, filename}]`（≤10 个）；chat 路由校验 dir 白名单（9 目录）与文件存在性（不存在 → 400 `FILE_REF_NOT_FOUND`）。提交给 LLM 的 user content 自动追加引用段：`[引用文件] {dir}/{filename}`（文件地址即 dir+filename，与文件接口契约一致）；历史行持久化结构化 `attachments` 数组，历史查询原样返回，前端据此渲染 "@文件名"。
- **Rationale**: content 追加引用段使现有 agent 上下文构建零改动；结构化落盘满足 FR-010 还原要求。
- **Alternatives considered**: 前端自行拼接进 content——历史无法结构化还原 @ 展示（只得到纯文本），否决。

## D8. tmp 上传放开与内联预览

- **Decision**: `UPLOAD_DIRS` 增加 `TMP_DIR`（沿用同一扩展名/50MB 校验）。新增 `GET /api/files/preview?dir=&filename=`：复用 file-access 读文件，按扩展名映射 Content-Type（.txt→text/plain; .json→application/json; .csv→text/csv; .pdf→application/pdf; .xlsx→回退下载头），`Content-Disposition: inline`；仅 LIST_DIRS 白名单；文件不存在 → 404 `FILE_NOT_FOUND`（tmp 清理后同此路径，前端展示错误提示）。
- **Rationale**: 与 download 同构（白名单/穿越校验复用 checkDir），仅差别在响应头与类型映射；.xlsx 前端无法内联渲染，回退下载是最简正确解。
- **Alternatives considered**: 服务端转换 xlsx→HTML——引入重型依赖（违反依赖治理），否决。

## D9. 工作空间文件汇总

- **Decision**: 新增 `GET /api/files/workspace` → `{dirs:[{dir, files:[{filename,size,updated_at}]}]}`，对 9 个白名单目录顺序 list（有界常数次，非 N+1），空目录返回空数组。
- **Rationale**: 避免前端 9 次往返；顺序执行对本地 FS 足够快（每目录 readdir 为 O(文件数)，总量受 50MB×数量约束）。
- **Alternatives considered**: 前端并发 9 次 list——可用但多往返，汇总接口更简单且便于后续加缓存，选择汇总接口。

## D10. SSE 兼容性

- **Decision**: 新增事件类型（`tool_call`、`tool_call_end`）与 done/error 新字段（`duration_seconds`）为向后兼容扩展；旧前端忽略未知 event 类型即可。契约文档 contracts/sse-events.md 取代 001 特性中的旧版描述（标注变更点）。
- **Rationale**: SSE 的 event 分发天然支持未知类型忽略；不破坏既有前端。
- **Alternatives considered**: 版本化 /v2 端点——增量过小，不必要。
