# 接口契约增量：按数字人隔离用户数据

**特性**：`009-agent-data-isolation` | **日期**：2026-10-14 | **规格**：[../spec.md](../spec.md) | **计划**：[../plan.md](../plan.md)

本文件记录本特性对**上游契约**的精确增量。沿用仓库惯例——**修改上游契约而不是另立一套**：上游为
`specs/001-digital-human-platform/contracts/runtime-api-delta.md`（运行环境接口口径）与
`specs/001-digital-human-platform/contracts/admin-api.md`（平台侧），本文件只做**增量与落点定位**。

---

## 0. 总原则（一句话）

> **所有涉及会话与文件空间的接口，作用域＝服务端"当前选中数字人"；归属 MUST NOT 由客户端指定。**
> 数据落在 `users/{uid}/user-data/{数字人名称}/`，因此"跨数字人访问"在路径层即不可达，呈现为**不存在**。

四条口径：

1. **作用域来源**：服务端内存的"当前选中数字人"（`CurrentAgentStore`）。未选中 → `409 AGENT_NOT_SELECTED`（既有）；选中但不可用 → `409 AGENT_NOT_AVAILABLE`（**新增**）。
2. **归属不可变**：会话归属在创建时写定（＝其所在目录），此后 MUST NOT 变更。
3. **不泄露存在性**：跨数字人访问 MUST 与"不存在"无法区分（`404`），MUST NOT 返回"存在但无权限"。
4. **路径始终相对数字人数据域**：客户端给出的相对路径不因归属层而变（仍是 `数据准备/生产计划`、`共享空间` 等）。

---

## 1. 错误码

| 错误码 | 状态码 | 语义 | 变更 |
|---|---|---|---|
| `AGENT_NOT_SELECTED` | 409 | 未选定数字人（无法确定作用域） | **不变**（沿用既有文案） |
| `AGENT_NOT_AVAILABLE` | 409 | 已选定，但该数字人对本用户**不可用**（配置目录不存在或配置损坏——典型场景：数字人已被移除并部署） | **新增**（本特性唯一新增错误码） |
| `AGENT_NOT_FOUND` | 404 | 目标数字人不存在或配置损坏（用于显式指定数字人的接口，如 `select`、`detail`） | **不变** |
| `THREAD_NOT_FOUND` | 404 | 会话不存在**或不在当前数字人作用域内** | 语义口径明确（后者不泄露存在性） |
| `DIR_VALIDATION` / `UPLOAD_DIR_FORBIDDEN` / `VALIDATION_FAILED` | 403 / 403 / 400 | 目录不在空间内或不在该数字人场景清单内 | **不变** |
| `SCENARIO_NOT_CONFIGURED` | 503 | 该数字人未配置文件空间场景 | **不变**（message 已含数字人名称） |

> 新增码 `AGENT_NOT_AVAILABLE` MUST 全局唯一、语义稳定（宪章原则七），并在前端 `frontend/src/utils/error-message.ts` 登记文案：`该数字人已不可用，请重新选择`。

---

## 2. 会话接口

| 接口 | 变更 | 请求 | 响应 / 错误 |
|---|---|---|---|
| `POST /api/threads` | **归属来源变更** | body 字段 `agent_name` **保留**（schema 不变），但**不再决定归属**：归属一律取服务端当前选中；两者不一致时落 `warn` 日志并以服务端为准 | `201 { thread_id, title, created_at }`；未选中 → `409 AGENT_NOT_SELECTED`；当前数字人不可用（或 body 指定的数字人配置损坏）→ `409 AGENT_NOT_AVAILABLE` / `404 AGENT_NOT_FOUND` |
| `GET /api/threads` | **作用域变更** | 查询参数 `agent_name` **保留但不再参与作用域**（传了忽略；不报错） | `200`：**只含当前数字人**的会话（按 `updated_at` 倒序，不变）；未选中 → `409 AGENT_NOT_SELECTED` |
| `GET /api/threads/:id` | **作用域变更** | 无 | `200`：仅当该会话属于当前数字人；否则 `404 THREAD_NOT_FOUND` |
| `PATCH /api/threads/:id`（改名） | **作用域变更** | body 不变 | 同上（跨数字人 → `404`） |
| `DELETE /api/threads/:id` | **作用域变更** | 无 | 同上；删除仍连带清理该数字人 `临时空间` 下 `{threadId}_` 前缀的外置正文（路径随归属） |
| `GET /api/threads/:id/tool-calls/:callId` | **路径随归属** | 无 | 不变（`404` / `410 TOOL_RESULT_EXPIRED`）；结果文件位于该数字人临时空间 |
| `GET /api/threads/:id/next-actions` | **作用域变更** | 无 | 同上口径 |

---

## 3. 对话接口（SSE）

| 接口 | 变更 | 说明 |
|---|---|---|
| `POST /api/threads/:id/messages` | **作用域 + 归属校验** | ① 未选中 → `409 AGENT_NOT_SELECTED`；② 当前数字人不可用 → **`409 AGENT_NOT_AVAILABLE`**（FR-032：陈旧上下文发消息必须失败且可读，MUST NOT 静默换用其他数字人）；③ 会话不属于当前数字人 → `404 THREAD_NOT_FOUND`；④ 附件校验按当前数字人场景判定（既有口径不变，仅路径归属变化） |
| `POST /api/threads/:id/stop` | 作用域同上 | 不变 |
| `POST /api/threads/:id/interaction` | 作用域同上 | 不变 |

> **归属不因轮次改变**：执行轮次不再 `touch()` 覆写 `meta.agent_name`；`history.jsonl` 中每条消息的 `agent_name` 仍记录该轮实际数字人（在严格隔离下恒等于归属）。

---

## 4. 数字人接口

| 接口 | 变更 | 说明 |
|---|---|---|
| `GET /api/agents` | 不变 | 可用清单（扫 `agents/`，配置损坏者排除） |
| `GET /api/agents/:name` | 不变 | 详情 |
| `POST /api/agents/:name/select` | **新增副作用（幂等）** | 原有语义不变（覆盖式选中；目标不存在/损坏 → `404 AGENT_NOT_FOUND`）；**新增**：① `ensureAgentDataDirs(root, uid, name)` 惰性建该数字人的数据骨架（三个空间 + `threads`）；② 触发一次**幂等**的存量数据迁移，归属判定①＝**刚选中的这个数字人**（FR-040 的①在此真正生效，见 plan §迁移口径） |
| `POST /api/agents/current/exit` | 不变 | 退出后文件/会话接口回到 `409 AGENT_NOT_SELECTED` |
| `GET /api/agents/current` | **语义定稿（陈旧选中态）** | `{ agent_name: string \| null }`。**陈旧选中态下仍返回该数字人名称，MUST NOT 自动清空**：前端据此提示"该数字人已不可用，请重新选择"，仅在用户显式重选时更新；此时发送消息返回 `409 AGENT_NOT_AVAILABLE`（见 §1 与 §3）。选中态仍是进程内存，重启后为 `null`（本特性不改变该行为） |
| `GET /api/agents/current/mcp`、SSE 快照 | 不变 | — |

---

## 5. 文件空间接口

路径根由 `users/{uid}/user-data/` 变为 `users/{uid}/user-data/{当前数字人}/`；**接口形状与参数不变**（客户端仍传相对路径）。

| 接口 | 变更 | 说明 |
|---|---|---|
| `POST /api/files/upload` | 归属变更 | 暂存目录＝该数字人 `临时空间`；最终落盘＝该数字人数据域内的相对路径；`数据准备` 仍需二级目录（`400`）；可上传类型与字段约束口径**逐项不变** |
| `GET /api/files/list` | 归属变更 | 只列出该数字人数据域内的目录/文件；跨数字人路径不可达（`403`） |
| `GET /api/files/download` / `preview` / `raw` | 归属变更 | 同上 |
| `DELETE /api/files` | 归属变更 | 共享空间只读（`403`）等规则不变 |
| `GET /api/files/rules` | 归属变更 | 算法规则目录仍为 `数据准备/算法规则` |
| `GET /api/files/workspace` | **不变**（归属自动跟随） | 三空间 + 该数字人 `scenario` 的目录清单；未选中 → `409 AGENT_NOT_SELECTED`；未配置场景 → `503 SCENARIO_NOT_CONFIGURED` |
| `POST /api/files/put`（产出回写） | 归属变更 | 目录白名单仍为 `临时空间/后台产出`，落点在该数字人数据域内 |

---

## 6. 产出接口

| 接口 | 变更 | 说明 |
|---|---|---|
| `GET /api/produced`、产出变更信号 | **作用域变更** | 后台产出落盘于**该数字人**的 `临时空间/后台产出`；未选中 → `409 AGENT_NOT_SELECTED`；跨数字人不可见 |

---

## 7. 兼容性与迁移口径（对客户端的可见影响）

| 场景 | 行为 |
|---|---|
| 前端 `create(agentName)` 继续传 `agent_name` | 服务端校验一致（不一致仅落 `warn`），响应不变 ⇒ **前端无需改调用** |
| 前端 `list()` 从未传 `agent_name` | 服务端改为按当前数字人作用域返回 ⇒ **前端无需改调用** |
| 切换数字人后立即新建对话 | 前端行为变化（`useAppSession.onSwitched`）；接口层无新增端点 |
| 存量数据首次迁移 | 由运行环境启动期与 `select` 成功时完成；**客户端无感知**，不需要新的接口或一次性操作 |
| 数字人被移除后界面仍停在它 | 发送消息返回 `409 AGENT_NOT_AVAILABLE`；前端提示"该数字人已不可用，请重新选择"并引导重选 |
| 会话/文件跨数字人请求 | `404 THREAD_NOT_FOUND` / `403 DIR_VALIDATION`（与"不存在"不可区分） |

---

## 8. 上游契约回写清单（与实现同批修改）

| 上游文档 | 需改内容 |
|---|---|
| `specs/001-digital-human-platform/contracts/runtime-api-delta.md` | ① 文件空间与会话的**路径根**（`user-data/{数字人}/`）；② 新增错误码 `AGENT_NOT_AVAILABLE`；③ `POST /api/agents/:name/select` 的幂等副作用（建骨架 + 触发迁移）；④ `GET /api/threads` 的 `agent_name` 参数退出作用域；⑤ 迁移日志事件名（`data.migration.*`） |
| `specs/001-digital-human-platform/spec.md` | **FR-028**、**SC-012**、**SC-019**、`假设`「文件空间场景是数字人级的，文件空间数据是用户级的」、`关键实体`「文件空间场景」条目 |
| `specs/001-digital-human-platform/contracts/admin-api.md` | 部署/撤回作用域说明补一句："数字人级**数据**目录由运行环境创建与持有，平台 MUST NOT 创建/写入/删除" |
| `specs/001-digital-human-platform/data-model.md` | §「三类数据边界」：补入数字人级数据目录归属（平台写入范围不变，仍限于 `agents/**`） |
| `specs/002-conversation-runtime/spec.md` | §5.1／§5.2 落点路径加数字人一级；顺带登记 §5 中 `users/{uid}/threads/` 与实现不一致的既有漂移 |
| `frontend/src/api/types.ts` | 无需新增字段（接口形状不变）；仅错误码文案表新增一行 |
