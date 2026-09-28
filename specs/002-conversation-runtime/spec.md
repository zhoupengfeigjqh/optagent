# 特性规格：对话运行时 · 工具调用记录（002）

- **特性标识**：`002-conversation-runtime`
- **状态**：已实现（2026-09-23）
- **影响范围**：`agent-backend`、`frontend`
- **上游依据**：本文件替代此前代码注释中引用但**在仓库中缺失**的 "spec 002"；
  原引用点（`FR-001`/`FR-002`/`FR-006`/`FR-009`、`V-04`/`V-05`）的语义修订见 §7

---

## 1. 背景与问题

| # | 现象 | 根因 |
|---|---|---|
| P1 | 刷新页面后，之前的工具调用记录彻底消失 | 工具事件只经 SSE 实时推送，从不落盘 |
| P2 | 下一轮对话中模型"不记得"上一轮工具返回了什么 | 请求无状态，且结果从未持久化 |
| P3 | 会话切换后中栏为空态，需手动点选历史 | `activeThreadId` 仅存内存 |

其中 P2 是**既有行为**（工具结果此前被明确丢弃），P1/P3 是本次一并解决的问题。

## 2. 目标与非目标

**目标**

- G1 刷新页面后，历史消息能展示当时的工具调用记录（名称/状态/耗时/体积/结果）
- G2 下一轮对话中模型能"看到"上一轮工具输出：短结果按预算回灌原文，长结果按需自取
- G3 上下文增量有界且可配置，不因工具结果体积膨胀
- G4 多用户、多会话严格隔离

**非目标**

- 不改变"平台 → 运行环境"的单向数据流边界（宪章与 `001` 规格既定）
- 不引入外部对象存储、向量检索、跨会话检索
- 不引入原生 `tool` role 消息流（保持 user/assistant 扁平结构）
- 不把工具**入参原文**落盘或下发
- **思考内容仍不落历史**（`V-04` 不变）

## 3. 术语

| 术语 | 含义 |
|---|---|
| **记录** | `tool-events.jsonl` 中的一行事件（元数据 + 可选内联结果） |
| **内联结果** | 体积 ≤ 内联阈值的结果，正文直接存在记录行里 |
| **外置结果** | 体积 > 内联阈值的结果，正文存于临时空间，记录行只留体积与摘要 |
| **回灌** | 组 prompt 时把工具结果投影进 messages（**不落盘**） |
| **索引** | 组 prompt 时注入 systemPrompt 的外置结果清单（名称·体积·摘要·路径） |

## 4. 功能需求

### 4.1 记录与存储

| 编号 | 需求 | 验收 |
|---|---|---|
| **TR-01** | 每次工具调用在 `threads/{thread_id}/tool-events.jsonl` 追加事件行：开始记 `running`、结束记终态，读取时按 `call_id` 合并（后者覆盖前者） | 一次调用后有 2 行且合并为 1 条记录 |
| **TR-02** | 记录行含 `call_id` / `message_id` / `name` / `status` / `started_at`，终态行含 `duration_ms` / `size` | 字段类型校验通过；`message_id` 等于该轮 assistant 消息 id |
| **TR-03** | `message_id` 在 **run 启动时**生成（而非收尾时），供工具事件归属 | 工具记录与 `done` 事件的 `message_id` 一致 |
| **TR-04** | 结果 ≤ **16 KB**：原文内联 `inline_content`；> 阈值：正文外置为 `临时空间/{thread_id}_toolresult_{call_id}.txt`，记录行只记 `artifact_size` + `summary` | 两个分支各有单测；外置时记录行无 `inline_content` |
| **TR-05** | 单条外置正文落盘上限 **10 MB**，超限截断并标 `truncated: true` | 超限用例：`artifact_size` 恰为上限且标记为真 |
| **TR-06** | 入参只落**短标量摘要**（`args_digest`）：单值 ≤120 字符，最多 8 键，数组/对象只留形状 | 长字符串被截断；嵌套结构显示为 `<数组 N 项>` / `<对象>` |
| **TR-07** | 结果为图片内容块时只落 `[图片 mime ~体积]` 占位，**绝不落 base64** | 图片块不增加记录行体积 |
| **TR-08** | 外置写入失败（或未装配外置能力）时退化为**截断内联**，不丢记录 | 单测覆盖；记录仍可读 |
| **TR-09** | 记录生命周期 = 会话；删除会话时随 `threads/{thread_id}/` 一并删除；外置正文另随临时空间 `{thread_id}_` 前缀清理与"7 天未访问"策略回收 | 删除后目录与文件均不存在 |
| **TR-10** | 追加经 per-thread Promise 链串行化；单行一次 append 保证原子性 | 并发追加后行数与内容正确 |
| **TR-11** | 坏行跳过并告警；整体损坏（无一条合法行）→ 备份后重建并告警 | 与 `history.jsonl` 同口径 |

### 4.2 展示（前端）

| 编号 | 需求 | 验收 |
|---|---|---|
| **TR-12** | `GET /api/threads/{id}` 的消息可附 `tool_calls`：元数据 + 内联结果 + 摘要，**不含外置正文** | 响应体积不随外置结果大小变化 |
| **TR-13** | 新增 `GET /api/threads/{id}/tool-calls/{call_id}` 返回外置正文；正文已被清理返回 **410 `TOOL_RESULT_EXPIRED`**；记录存在但未外置返回 404 | 三种分支各有集成测试 |
| **TR-14** | 正文路径由 `{thread_id, call_id}` **重新推导**，不读记录行里的任何路径；读取前过 `FileAccess.resolveVerified` 白名单与符号链接校验 | 恶意 `call_id` 无法越权；跨用户访问被拒 |
| **TR-15** | 前端工具卡片：内联结果展开即见（不发请求）；外置结果展开才懒加载；已清理显示"内容已被临时空间清理（原 X）"；其他失败提示可重试 | 组件测试覆盖四种展示态 |
| **TR-16** | 流式态与历史态**复用同一卡片组件**；`tool_call_end` 到达后保留卡片并标记终态，不再即时移除 | 卡片渲染与刷新后一致 |
| **TR-17** | `status === 'running'`（只有开始事件）渲染为"进行中/未完成"，不假装有内容 | 组件测试覆盖 |

### 4.3 上下文回灌（模型侧）

| 编号 | 需求 | 验收 |
|---|---|---|
| **TR-18** | 组 prompt 时按**预算**回灌内联结果原文：从最近往前填，单条上限 16 KB、总量 32 KB；预算耗尽的内联结果降级为一行占位 | 预算分配用例（3 档体积） |
| **TR-19** | 回灌内容**只拼进 messages**（对应轮次的 assistant 消息），不写回 `history.jsonl` | `history.jsonl` 内容与改动前一致 |
| **TR-20** | 外置结果在 `systemExtra` 注入索引行（名称 · 体积 · 摘要 · 临时空间路径），最多 **10 条**；无外置结果时该段长度为 0 | 空索引返回空串 |
| **TR-21** | **工具结果正文永不整体自动注入**；`running` 记录不参与回灌 | 大结果正文在 messages 中出现次数为 0 |
| **TR-22** | 投影为**确定性**（同历史 → 同结果），不破坏 prompt 前缀缓存 | 同输入两次组装字节一致 |
| **TR-23** | 未装配 `toolEvents` 时（既有单元测试场景）不落盘、不回灌，行为与改动前完全一致 | 回归用例 |

### 4.4 降级与可观测（宪章原则九）

| 编号 | 需求 | 验收 |
|---|---|---|
| **TR-24** | 工具事件落盘失败 **MUST NOT** 阻断对话：记结构化告警，SSE 照常 | 集成用例：落盘异常时本轮回答正常完成 |
| **TR-25** | 外置正文清理/缺失 → 前端降级为"内容已过期"，元数据卡片仍在 | 组件测试 |
| **TR-26** | 刷新后自动恢复上次会话（URL `?thread=` 优先、`sessionStorage` 兜底）；目标会话已删除时**静默**回空态并清除痕迹 | 工具函数单测 + 手动走查 |
| **TR-27** | 会话切换同步地址栏用 `replaceState`（不产生浏览历史）；URL/存储不可用时静默降级 | 单测覆盖不可用分支 |
| **TR-28** | `done` / `error` 广播**前** MUST 等待工具记录落盘（含外置正文写入），保证前端收到终结事件后立即刷新即可读到完整卡片 | 集成用例：终结事件到达时文件已存在；连续多次运行无偶发失败 |

### 4.5 附：MCP 连接状态自愈（2026-09-23 补充）

**问题**：`streamable-http` 是无状态请求/响应，服务被停掉时**没有 `onClose` 可听**；
旧实现的"重试 5 次后停止"叠加 `agent-factory` 的
`if (!mcp.isAvailable(server)) continue`（该判断位于 `listTools` **之前**，而
`isAvailable` 在降级时已为 false）→ `listTools`/`callTool` 根本不会被调用 →
注释里承诺的"惰性补试兜底"**事实上永不执行**。结果是服务恢复后状态与工具**永久停在不可用**，
只能靠实例换代（空闲回收 / 重启 backend）恢复；若此时无流量，状态还会反向"假绿"。

**处置**（两条互补，均属**客户端侧**）：

| 编号 | 需求 | 参数 |
|---|---|---|
| **TR-29** | 退避表（5s/15s/30s/60s/60s）用尽后**不停止**，转入低频**保活重试**；恢复即经 `adoptClient` 自动接回——状态变绿，且下一轮工具自动齐全（`agent-factory` 每轮都会重新 `listTools`，故**无需实例换代**） | 120s |
| **TR-30** | 新增主动健康探测 `McpManager.probe()`：对**已连接**服务发探针，失败且属连接级错误即降级变红并推送（复用 `degradeOnTransportFailure`，协议类 `McpError` 不误判）；不可用的服务交给 TR-29，不重复探测 | 60s（`IntervalScheduler` 驱动） |
| **TR-31** | 探针优先 MCP `ping`（最轻）；遇 `-32601 Method not found` 记下该服务并回退 `listTools`（工具服务必然实现 `tools/list`） | — |

**明确不做**：**"重新拉起服务"不属于客户端职责**——HTTP 型 MCP 服务的拉起归编排层
（compose 的 `restart: unless-stopped` 已覆盖），客户端只负责"发现不可用 → 退避重连 → 恢复后接回"。
这与业界对 stdio 型（客户端是所有者的才负责重启）与 HTTP 型（编排层负责）的分工一致。

**实测验证（2026-09-23）**：

| 场景 | 结果 |
|---|---|
| 停止 ocr 容器 | 90s 内状态自动 `connected → failed`，日志 `mcp.probe.failed`；未停的 jev **无误判** |
| 启动 ocr 容器 | 约 60s 内自动 `failed → connected`（**无需重启 backend**） |
| 外部不可达服务（hd-algorithm） | 退避用尽后日志"转入保活重试（每 120s）"，持续低频重试 |

## 5. 数据模型

### 5.1 `threads/{thread_id}/tool-events.jsonl`

```jsonl
{"call_id":"call_a1","message_id":"m_abc_0001","name":"read_file","status":"running","started_at":"2026-09-23T09:12:03.120Z","args_digest":{"path":"数据准备/生产计划/9月计划.xlsx"}}
{"call_id":"call_a1","message_id":"m_abc_0001","name":"read_file","status":"success","started_at":"2026-09-23T09:12:03.120Z","duration_ms":84,"size":120,"inline_content":"车间,计划量\n冲压,1200"}
{"call_id":"call_b2","message_id":"m_abc_0001","name":"ocr_image","status":"success","started_at":"2026-09-23T09:12:05.400Z","duration_ms":1620,"size":1843200,"truncated":false,"summary":"识别到 12 页产能表（共 480 行）","artifact_size":1843200}
```

### 5.2 外置正文

- 落点：`users/{userId}/user-data/临时空间/{thread_id}_toolresult_{call_id}.txt`
- 文件名由 `artifactFileName(threadId, callId)` **唯一推导**（`call_id` 做 `[A-Za-z0-9_-]` 安全化并截断 64 字符）
- 落在三个文件空间之内，因此：模型可 `read_file` 按需取回、删会话时随前缀清理、界面可见

### 5.3 参数表

| 参数 | 默认值 | 位置 |
|---|---|---|
| 内联阈值 | 16 KB | `TOOL_INLINE_MAX_BYTES` |
| 单条落盘上限 | 10 MB | `TOOL_ARTIFACT_MAX_BYTES` |
| 单条回灌上限 | 16 KB | `TOOL_REPLAY_ITEM_MAX_BYTES` |
| 回灌总预算 | 32 KB | `TOOL_REPLAY_BUDGET_BYTES` |
| 索引条数上限 | 10 | `TOOL_INDEX_MAX_ITEMS` |
| 占位条数上限 | 20 | `TOOL_PLACEHOLDER_MAX_ITEMS` |
| 摘要字符上限 | 200 | `TOOL_SUMMARY_MAX_CHARS` |

## 6. 接口契约增量

| 接口 | 变更 |
|---|---|
| `GET /api/threads/{id}` | 消息新增可选字段 `tool_calls: ToolCallRecord[]`（仅该轮确有调用时返回） |
| `GET /api/threads/{id}/tool-calls/{call_id}` | **新增**。200 → `{ call_id, name, status, size, content, truncated? }`；410 → `TOOL_RESULT_EXPIRED`；404 → `TOOL_CALL_NOT_FOUND` |
| `POST /api/threads/{id}/messages`（SSE） | **无变化**：`tool_call` / `tool_call_end` 仍只透出工具名与状态，结果不经事件总线外发 |

`ToolCallRecord`（snake_case）：

```ts
{ call_id, name, status, started_at, duration_ms?, size?,
  content?,          // 内联结果正文
  artifact_size?,    // 有值 = 正文在临时空间
  truncated?, summary?, args_digest? }
```

## 7. 对既有规格的修订

| 既有条目 | 原语义 | 修订后 | 理由 |
|---|---|---|---|
| `FR-001` | 工具 **args 永不复制** | 不变：入参原文不落盘/不下发；新增 `args_digest` 短标量摘要 | 保留"不泄漏入参原文"，同时让界面能说明"查了什么" |
| `FR-002` | 工具 **result 永不复制** | **修订**：结果落 `tool-events.jsonl`（供展示与受控回灌），但 **SSE 仍不外发结果**、**上下文永不自动整体注入** | 原语义导致刷新丢失与下一轮失忆；新语义在"可见"与"上下文有界"之间取平衡 |
| `V-04` | 思考与工具均不落历史 | **收窄为"思考不落历史"**；工具记录落**独立文件**（不进 `history.jsonl`） | 保持 `history.jsonl` 的纯净（前端展示源），工具记录与会话同生命周期 |
| `V-05` | 工具徽标 `tool_call_end` 到达即移除 | **修订**：保留并标记终态，本轮收尾时统一交给历史接管 | 让流式态与刷新后的历史展示一致 |

## 8. 宪章符合性

| 原则 | 落实 |
|---|---|
| 二（模块化，≤500 行） | 新增 `tool-result.ts` / `tool-events.ts` / `tool-context.ts` / `ToolCallList.vue`，均为单一职责；`run-manager.ts` 因本次改动触发门禁，按"抽纯函数"拆出 `run-events.ts`（事件类型）/ `run-impl.ts`（Run 实例）/ `message-format.ts`（消息标识与格式化），**603 → 495 行**，外部引用路径经 re-export 保持不变 |
| 三（测试完备） | 后端新增 24 例（`tool-events` 10 + `tool-context` 9 + 主链路 5），前端新增 20 例（卡片 10 + 会话恢复 10） |
| 五（数据一致性） | 追加经 per-thread 串行链；单行 append 原子；投影不落盘、单一权威源 |
| 七（契约两侧同改） | 后端 `routes/threads.ts` 与前端 `api/types.ts` + `api/threads.ts` 同批变更 |
| 九（优雅降级与可观测） | 落盘失败不阻断（TR-24）、正文过期降级（TR-25）、会话恢复失败静默（TR-26）、坏行告警、结构化日志 `tool-events.recover` |

## 9. 验收清单

- [x] 刷新页面后，历史消息展示工具卡片（内联内容可直接展开）
- [x] 大结果点开才拉取；正文被清理时卡片降级不报错
- [x] 下一轮 prompt 含上一轮短结果原文；大结果只在 systemPrompt 留下一行索引
- [x] `history.jsonl` 内容与改动前一致（无工具痕迹、无回灌痕迹）
- [x] 多用户/多会话隔离：路径从鉴权身份推导，恶意 `call_id` 无法越权
- [x] 刷新后自动回到原会话；会话已删除时静默回空态
- [x] 后端 265 单测、29 集成测试全绿；前端 322 测试全绿；两侧 lint 与 `tsc` / `vue-tsc` 通过
