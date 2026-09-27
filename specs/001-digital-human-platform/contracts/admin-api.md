# 接口契约：数字人管理平台（admin-api）

**特性**：`001-digital-human-platform` | **版本**：1.1 | **日期**：2026-09-27

本契约定义**管理界面（`admin-frontend`）↔ 管理服务（`admin-backend`）**之间的全部接口。按宪章原则七，本文件与 `admin-frontend/src/api/types.ts` **一一映射**；契约变更 MUST 四处同步（本文件、前端类型定义、后端请求/响应 schema、测试用例）。

编号形态沿用既有惯例（`§N 资源` / `### N.M 端点`），与代码中既有的 `§4.2`、`§5.4` 引用方式一致（`research.md` D12）。

---

## §0 通用约定

### 0.1 基址与同源

- 全部路径以 **`/api/admin/`** 开头，由 `gateway` 按最长前缀分发到 `admin-backend:3001`（容器内与本地形态统一口径，2026-09-20；`research.md` D10）。
- 管理界面走**同源相对路径**，MUST NOT 直连后端容器端口（宪章「技术栈与工程约束」）。
- 请求与响应体均为 `application/json`，除 `§4.4` 的 SKILL 上传为 `multipart/form-data`。
- 字段命名一律**下划线**，与既有接口及 `.opt-agent` 文件格式保持同一口径。

### 0.2 分页（`FR-006`、`SC-022`、`SC-023`）

**卡片列表**（MCP 服务 / SKILL / 数字人 / 用户）统一使用：

| 参数 | 类型 | 默认 | 约束 | 说明 |
|---|---|---|---|---|
| `page` | integer | 1 | ≥ 1 | 页码，从 1 开始 |

**每页固定 `page_size = 8`**（4 列 × 2 行），由服务端固定，**不接受客户端覆盖**（`FR-006` 要求"每页固定 8 项"）。

响应统一为：

```json
{ "items": [], "total": 0, "page": 1, "page_size": 8, "total_pages": 0 }
```

**非卡片类的长列表**（MCP 工具清单、部署历史、异常项汇总）MUST 具备**有界返回**（`limit` + 条数上限），MUST NOT 无界返回（`FR-006`）。

### 0.3 错误响应（`FR-009`、原则七）

统一错误体，与既有运行环境**完全一致**（复用 `frontend/src/api/http.ts` 的 `parseErrorResponse` 契约）：

```json
{ "error": { "code": "MCP_SERVICE_NOT_FOUND", "message": "MCP 服务不存在：ocr2" } }
```

- `message` MUST 可读且**可定位**（具体的字段/文件/条目），MUST NOT 只返回"操作失败"。
- 校验类错误 MAY 附带 `details`，形如 `{ "errors": [ { "user_id", "agent_name", "category", "code", "message" } ] }`，用于**一次性列出全部错误项**（`FR-027`、`SC-020`）。

### 0.4 错误码总表

**全局唯一性**（原则七：「错误码 MUST 全局唯一且语义稳定，MUST NOT 出现同码不同义」）。下表 **复用** 运行环境既有码，并**新增** `ADM_` 前缀码；`ADM_` 前缀保证与既有码表零碰撞，同时可一眼区分来源。

| 错误码 | HTTP | 含义 | 来源 |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | 参数不合法（复用既有码，语义一致） | 复用 |
| `NOT_FOUND` | 404 | 路径不存在（兜底，复用既有码） | 复用 |
| `INTERNAL_ERROR` | 500 | 内部错误（复用既有码） | 复用 |
| `SERVICE_UNAVAILABLE` | 503 | 依赖服务暂不可用（复用既有码） | 复用 |
| `ADM_AGENT_NAME_TAKEN` | 409 | 数字人名称已存在或非法 | `FR-015` |
| `ADM_AGENT_IN_USE` | 409 | 数字人已被用户关联，须先解除关联 | `FR-021` |
| `ADM_AGENT_INVALID_REF` | 400 | 数字人引用了清单外的内置工具/MCP/SKILL | `FR-013`、`FR-019` |
| `ADM_AGENT_NOT_FOUND` | 404 | 数字人不存在（由 §5.3 与 §5.5 使用） | — |
| `ADM_SKILL_NAME_TAKEN` | 409 | SKILL 名称与库中已有项冲突，须显式选择覆盖 | `FR-040` |
| `ADM_SKILL_ARCHIVE_INVALID` | 400 | 压缩包格式校验失败（缺 `SKILL.md`／元数据缺字段／不可解压） | `FR-038` |
| `ADM_SKILL_ARCHIVE_UNSAFE` | 400 | 压缩包安全校验失败（越界路径／符号链接／超限） | `FR-039` |
| `ADM_SKILL_NOT_FOUND` | 404 | SKILL 不在共享技能库中 | — |
| `ADM_MCP_SERVICE_NOT_FOUND` | 404 | MCP 服务不存在 | — |
| `ADM_MCP_SERVICE_EXISTS` | 409 | MCP 服务名称已存在（新建重名，2026-09-27） | `FR-043` |
| `ADM_DEPLOY_VALIDATION_FAILED` | 409 | 部署前校验不通过（阻止部署，`details.errors` 列出全部错误项） | `FR-027`、`SC-020` |
| `ADM_DEPLOY_TARGET_NOT_WRITABLE` | 409 | 目标位置不可写 | `FR-027` |
| `ADM_USER_ID_TAKEN` | 409 | 用户标识已存在或非法 | `FR-024` |
| `ADM_USER_NOT_FOUND` | 404 | 用户不存在 | — |
| `ADM_CONFIG_REVISION_CONFLICT` | 409 | 并发编辑冲突（`revision` 不符） | `FR-008` |
| `ADM_STORAGE_UNAVAILABLE` | 503 | 平台设计态存储不可写 | — |
| `ADM_RUNTIME_UNREACHABLE` | 503 | 运行环境只读依赖不可达（工具目录／调用统计） | `FR-011`、`FR-050` |

> **2026-09-27 变更**：随 MCP 服务改为平台内全人工配置，**移除四个码**——
> 启停白名单类、运行形态缺地址类、Docker 不可达类、编排声明不可读类（正文提及处已一并清理，
> 故此处不再以代码格式回引旧名）。平台不再读容器编排声明、不再读 Docker 容器运行态，
> 也不再持有"目标运行形态"（详见 §1 与 §3）。新增 `ADM_MCP_SERVICE_EXISTS`。
> 全表共 **21 个**码（4 个复用 + 17 个 `ADM_` 前缀码）。

### 0.5 保存交互（全部写接口的通用约定，2026-09-25）

管理界面上**每一个保存动作**（数字人设计／MCP 调用配置／MCP 新建／SKILL 文件／用户关联）MUST 遵循**同一模式**。本节不是新发明——`useAgentDesign.save()` 已是符合形态，本节把该形态固化为**全部保存点的统一口径**。

**三条原则**

| # | 原则 | 判据（可测） |
|---|---|---|
| ① | **草稿锚定实体标识** | 表单草稿**只在实体标识变化时**从服务端回填（切换 MCP 服务／切换 SKILL 文件／切换数字人）。同一实体的任何服务端刷新（保存后重载、并发更新、列表轮询）**MUST NOT** 重置草稿——否则用户**未提交的输入**会被静默丢弃 |
| ② | **响应即元数据源** | 保存响应用于更新 `revision`（或按实体语义的等价基准，如 SKILL 文件的 `hash`），**MUST NOT 为回填表单而二次请求详情**。为满足此条，响应 MUST 携带**本次保存后的权威元数据**；对"表单字段需要服务端规范化回显"的实体（MCP 调用配置见 §3.3、数字人设计见 §5.4），响应 MUST 是**保存后的完整实体** |
| ③ | **忙态只锁动作按钮** | `disabled` **MUST NOT** 绑到表单控件（输入框／复选框／下拉／编辑表格）。写接口通常在百毫秒级完成，控件级的"禁用→恢复"会退化为无意义的视觉抖动（"闪一下"）；按钮自身的"保存中…"已足以表达进行态 |

**为什么三条必须同时成立**（各自的典型反例）：

- 只做 ② 不做 ①：保存后重载会连用户的**未提交编辑**一起覆盖；
- 只做 ① 不做 ②：为刷新 `revision` 而重载，若该详情接口含**实时探测**（如 MCP 工具清单，§3.2），探测抖动会让依赖它的渲染分支（复选框清单 ⇄ 手填文本框）来回切换——同样是闪；
- 缺 ③：全平台只有个别控件绑 `busy` 时，会制造"为什么只有它会闪"的不一致观感。

**与并发控制的关系**：`revision` 为**全局单例**（`.platform-data/meta.json`），任何写操作都会使其递增。因此 ② 中"用响应更新 `revision`"是保证**下一次保存不报 `ADM_CONFIG_REVISION_CONFLICT`** 的必要条件——MUST NOT 为了省一次赋值而丢弃响应里的 `revision`。

**唯一允许整表重载的场合**：**实体标识变化**（用户主动切换目标）——此时覆盖草稿正是期望行为。

---

## §1 平台健康

### 1.1 `GET /api/admin/platform/health`

**用途**：报告平台全部外部依赖的可达性，供排查与冒烟确认（`quickstart.md`）。

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `platform_data` | object | `{ writable: boolean, path: string }` |
| `opt_agent` | object | `{ readable: boolean, writable: boolean, path: string }` |

**错误码**：无（依赖不可达以字段表达，便于一次性看到全部问题）。

> **2026-09-27 变更**：`compose_file` / `docker` / `runtime_form` 三个字段**已移除**，
> 原 §1.2（读取设置）、§1.3（运行形态列表）、§1.4（切换运行形态）**三个端点整体下架**：
> MCP 服务改为平台内全人工配置后，平台不再读容器编排声明、不再读 Docker 容器运行态，
> 也不再持有"目标运行形态"这一等概念（`FR-056`、`FR-057` 随之废止，见 `spec.md`）。
> 部署接口所需的乐观锁版本改由 §6.8 的部署清单端点提供。

---

## §2 内置工具目录

> 数据来源为**运行环境**（`FR-011`），平台只做只读投影；`plan.md` R1/R2 定义其落地方式。

### 2.1 `GET /api/admin/builtin-tools`

**用途**：列出可枚举的内置工具目录（`FR-011`），供数字人设计的工具选择器与只读目录视图（`FR-054`）使用。

**查询参数**

| 参数 | 类型 | 默认 | 约束 | 说明 |
|---|---|---|---|---|
| `limit` | integer | 50 | 1~200 | 有界返回（`FR-006`） |

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | array | 每项：`{ name, label, description_template, parameters, writable }`（见 `data-model.md` §2） |
| `total` | integer | 总数 |
| `truncated` | boolean | 是否因 `limit` 被截断 |

**关键约束**：`description_template` MUST 保持**占位符模板**形态（`{可用目录}` / `{示例路径}` / `{会话标识}` / `{临时空间}`），MUST NOT 替换为具体取值（`FR-012`、`SC-014`）。

**错误码**：`ADM_RUNTIME_UNREACHABLE`

---

## §3 MCP 服务

### 3.1 `GET /api/admin/mcp/services`

**用途**：卡片列表（`FR-043`）。**清单来源为平台侧调用配置**（2026-09-27 起）——
平台是 MCP 服务配置的**唯一权威源**：管理员在平台内新建什么就有什么，
MUST NOT 读取容器编排声明或容器运行状态。

**查询参数**：`page`（见 §0.2）

**响应 200**：`items` 每项：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 服务名（同时是运行环境的工具前缀，须匹配 `^[A-Za-z0-9_-]{1,64}$`） |
| `description` | string | **用途描述**（未填写为空串）——满足 `FR-006` 对卡片信息的要求 |
| `transport` | string | `http` / `stdio`（规范值；界面按 `streamable-http` 展示 `http`） |
| `url` | string \| null | **连接地址**（`http` 必有；`stdio` 为 `null`） |

**错误码**：无（清单恒可得：它就在平台设计态里）

> **2026-09-27 变更**：`status`（容器四态）、`in_compose`、`configured`、`abnormal_reason`
> 四个字段**已移除**——平台不再读 Docker 容器状态，且每条记录都由管理员手工新建，
> "是否已配置/是否在编排中"这类比对失去前提（`FR-052` 的语义见 §7.2 异常汇总）。

### 3.2 `GET /api/admin/mcp/services/{name}`

**用途**：服务详情——调用配置 + 工具清单（`FR-044`、`FR-045`）。

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` / `transport` / `description` / `url` | — | 同 `3.1` |
| `command` / `args` | string / array \| null | `stdio` 时有效 |
| `file_args` | object | 文件参数映射：`{工具名: {取值路径: "url" \| "url:from=<来源路径>"}}`；取值路径可为顶层参数名或穿过数组（`items[].excelFileUrl`，2026-09-16）；派生模式 2026-09-18 |
| `rules_fields` | object | 算法规则参数设置：`{工具名: 字段名或对象路径}`（2026-09-19 新增；2026-09-22 支持对象嵌套）；空对象 = 不启用 |
| `async_tools` | array | **异步工具声明**（2026-09-25 新增）：该服务**原始工具名**（不含 `{server}__` 前缀）清单；声明后运行环境调用这些工具时注入 `result_url`（签名写直链），服务算完把结果回写到用户空间。空数组 = 不启用（完整语义见 `runtime-api-delta.md` §10） |
| `confirmation` | string \| object | 调用确认策略（HITL）：`never`（默认）/ `always` / `{ tools: [...] }` |
| `tools` | array | 每项：`{ name, description, parameters }`（`FR-045`） |
| `tools_truncated` | boolean | 工具清单是否被截断 |
| `tools_error` | string \| null | 工具清单不可得时的可读原因（`null` = 可得） |
| `references` | array | 引用该服务的数字人（**仅在详情视图呈现**；MUST NOT 作为常驻浏览视图，见 §7.1 说明） |
| `revision` | integer | 平台设计态当前版本（乐观锁基准） |

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`（工具清单不可得时 `tools` 为空且 `tools_truncated=false`，并在响应中给出 `tools_error` 字段，**不报错**）

> **2026-09-27 变更**：`endpoints`（按运行形态键控的对象）收敛为**单一 `url`**；
> `compose_declaration`（编排原始声明投影）随启停页一并移除。`status` / `in_compose` 同 §3.1。

### 3.3.1 `POST /api/admin/mcp/services`（新建，2026-09-27）

**用途**：在平台内**新建**一个 MCP 服务。MCP 服务不再从容器编排声明派生，
平台是唯一权威源——管理员新建什么就有什么。

**请求体**：与 §3.3 的请求体相同，另加 `name`；`revision` 可选（带了即做乐观锁校验）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `name` | string | ✅ | **全局唯一**；须匹配 `^[A-Za-z0-9_-]{1,64}$`（会成为运行环境的工具前缀）；首尾空白自动去除 |
| 其余字段 | — | — | 见 §3.3 |

**响应 201**：`{ ...完整调用配置, "revision": 13, "affected_agents": [] }`（形状与 §3.3 响应一致）

**错误码**：`ADM_MCP_SERVICE_EXISTS`（重名）、`VALIDATION_FAILED`（名称非法／`transport` 非法／`http` 缺 `url`／`url` 非 http(s) 地址）、`ADM_CONFIG_REVISION_CONFLICT`

### 3.3.2 `DELETE /api/admin/mcp/services/{name}`（删除，2026-09-27）

**用途**：删除服务。**若该服务正被数字人引用**，界面 MUST 先经 `§7.1` 取出受影响数字人清单、
提示并要求二次确认（原 `FR-051` 的"关闭前提示引用"能力迁移到**删除**上）。

**请求体（可选）**：`{ "revision": 13 }`（带了即做乐观锁校验）

**响应 204**：无响应体

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`、`ADM_CONFIG_REVISION_CONFLICT`

> 删除后引用它的数字人会变成"引用失效"：保存时被 `ADM_AGENT_INVALID_REF` 拦截、
> 部署预检与全局异常汇总（§7.2）都会列出该失效引用。

### 3.3 `PUT /api/admin/mcp/services/{name}`

**用途**：保存**调用配置**（`FR-044`）。修改 MUST **自动作用于所有引用它的数字人**（下次部署生效），MUST NOT 要求逐个改动数字人。服务 MUST 已存在（新建见 §3.3.1）。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `description` | string | ✅ | **用途描述**（供卡片展示，满足 `FR-006`；可为空串） |
| `transport` | string | ✅ | `http` \| `stdio`；**接受别名 `streamable-http`（含 `streamable_http`/大小写变体），响应与落盘统一为 `http`**（2026-09-16） |
| `url` | string | 条件 | `transport=http` 时**必填**，且须为 `http(s)://` 绝对地址；`stdio` 时**丢弃**（与 http 丢弃 `command`/`args` 对称） |
| `command` / `args` | — | 条件 | `transport=stdio` 时 `command` 必填 |
| `file_args` | object | ✅ | 可为 `{}`；键为**取值路径**（顶层参数名或 `items[].excelFileUrl` 这类穿过数组的路径），值为 `"url"` 或 `"url:from=<取值路径>"`；**路径写法非法或派生来源形状不相容即 `VALIDATION_FAILED`**（与运行环境同一判据，见 `agent-backend/src/domain/file-arg-path.ts`） |
| `rules_fields` | object | 可选 | 可为 `{}`；形状 `{工具名: 字段名或对象路径}`，值非法即 `VALIDATION_FAILED`。**只校验语法、不校验工具清单**（清单是探测结果，服务不可达时不构成配置错误） |
| `async_tools` | array | 可选 | 可为 `[]`；元素为**非空字符串**（该服务的**原始工具名**），**同服务内去重**，违反即 `VALIDATION_FAILED`。**只校验语法、不校验工具清单**（同上）；物化时**非空才写**进 `MCP.json`（对齐 `file_args`/`rules_fields` 口径） |
| `confirmation` | string \| object | 可选 | 调用确认策略（HITL）：`never`（缺省）/ `always` / `{ tools: string[] }`（非空）；非法即 `VALIDATION_FAILED` |
| `revision` | integer | ✅ | 乐观锁 |

> **存量迁移（2026-09-27）**：旧文档里的 `endpoints`（`{运行形态: 地址}`）在**读取期**收敛为
> 单一 `url`（优先取 `host_local`，否则取第一个非空值），既有配置不丢；写回后只剩 `url`。

> **2026-09-15 变更**：`writable` / `permission_scope` 字段已从调用配置中**移除**（产品决定）。旧客户端提交这两个字段时不再报错（字段被忽略），响应与物化产物中 MUST NOT 再出现；运行环境的 `MCP.json` 因此不再产生 `write` / `permission_boundary`。

**响应 200**：保存后的完整调用配置 + 新 `revision` + `affected_agents`（受影响的数字人名清单，供界面提示）

**响应字段 MUST 与请求体字段一一对应**（含 `command`／`args`／`updated_at`）：界面据此**原地更新 `revision`**、不再为回填而二次请求详情（§0.5 原则 ②）。漏登字段会让客户端"保存成功却丢配置"——`2026-09-25` 实测：`command`／`args` 缺失，客户端只能靠重载详情兜底，从而引入整表覆盖与探测抖动。

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`、`VALIDATION_FAILED`、`ADM_CONFIG_REVISION_CONFLICT`

### 3.6 `POST /api/admin/mcp/services/{name}/test`

**用途**：发起测试 = **连通性检查 + 一次实际能力验证**（`FR-047`）。

**请求体（可选）**：携带 `{ transport, url, command?, args? }` 时按**表单当前（尚未保存）的值**探测；缺省按已保存的调用配置测试。

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 是否成功 |
| `connectivity` | object | `{ ok, duration_ms, error_code?, message? }` |
| `capability` | object | `{ ok, method, duration_ms, error_code?, message? }`（如 `ping`） |
| `target` | object | **实际被测目标** `{ transport, url, command }`——界面上 MUST 展示，否则"测的是谁"不可见 |
| `checked_at` | string | ISO8601 |

**关键约束**：失败 MUST 返回**明确的失败原因**（超时／连接被拒／协议不匹配等），MUST NOT 把失败误报为成功（`FR-047`、`SC` 验收场景）。

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`、`VALIDATION_FAILED`（body 的 `transport` 非法）

> **2026-09-27 下架**：原 §3.4（`/start`）、§3.5（`/stop`）、§3.7（`/logs`）三个端点
> **整体移除**——MCP 服务改为全人工配置，平台不再读容器运行态，故"启停"与"运行日志"
> 失去前提（`FR-046`、`FR-048` 随之废止，见 `spec.md`）。原 `/start`、`/stop` 端点
> 承载的"关闭前提示引用（`FR-051`）"能力**迁移到 §3.3.2 删除**上。

### 3.8 `GET /api/admin/mcp/stats`

**用途**：调用次数汇总统计（`FR-049`）。数据显示口径为 **MCP 工具调用次数**（`research.md` D6）。

**响应 200**：`items` 每项：`{ name, calls_total, calls_ok, calls_failed, last_called_at, windows, users }`——`windows` 为时间窗聚合（`h24`/`d7`/`d30`/`d365`，每窗 `{ ok, failed, total }`）；`users` 为**按用户**调用明细（十四次调整，2026-09-16）：`[{ user_id, calls_total, calls_ok, calls_failed, last_called_at }]`，只覆盖**最近一年**（与事件明细保留期同口径），`user_id` 为 `null` 表示升级前的历史事件未记录归属；数据透传自运行环境 `GET /api/mcp-call-stats`（见其契约 §4.3）

**关键约束**：运行环境不可达时 MUST 明确标注为"未知"，**MUST NOT 以 0 冒充**（`FR-009`）；响应含 `stats_available: boolean`。

**错误码**：无（不可达以字段表达）

---

## §4 SKILL 管理

### 4.1 `GET /api/admin/skills`

**用途**：卡片列表，展示技能名与描述（`FR-035`）。

**查询参数**：`page`

**响应 200**：`items` 每项：`{ name, description, installed_at, updated_at, source }`

### 4.2 `GET /api/admin/skills/{name}`

**用途**：查看单个 SKILL 的元数据与**正文全文**（`FR-036`）。

**响应 200**：`{ name, description, content, content_hash, files, source, installed_at, updated_at, revision }`（`content_hash` 为 `SKILL.md` 内容哈希，供详情页直接改正文时作乐观锁基准；`revision` 为平台全局版本）

**错误码**：`ADM_SKILL_NOT_FOUND`

### 4.3 `GET /api/admin/skills/{name}/file`

**用途**：读取技能内**单个文件**（`SKILL.md` 与 `references/` 等附件一律可查看）。

**查询参数**：`path`（必填，库内相对路径，如 `SKILL.md`、`references/手册.md`；`\` 按分隔符归一）

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 技能名 |
| `path` | string | 归一化后的相对路径 |
| `size` | integer | 文件字节数 |
| `binary` | boolean | 含 NUL 或非 UTF-8 → `true`，此时 `content` 为 `null`（不提供预览） |
| `truncated` | boolean | 超出上限（256KB）→ `true`，`content` 只含前 256KB |
| `content` | string \| null | 文本内容；二进制为 `null` |
| `hash` | string | **内容哈希（sha256）**：编辑保存时作为乐观锁基准回传 |
| `editable` | boolean | 是否可在线编辑：**文本且完整**（二进制、超 256KB 均为 `false`） |

**关键约束**：路径安全口径 MUST 与安装侧一致（复用同一套判定）——拒绝绝对路径、盘符、`..` 穿越、控制字符，且解析后的绝对路径必须落在该技能目录内；只返回目录内真实存在的**普通文件**（目录与符号链接不返回）。

**错误码**：`ADM_SKILL_NOT_FOUND`（技能或文件不存在）、`VALIDATION_FAILED`（`path` 缺失或路径非法）

### 4.3.1 `PUT /api/admin/skills/{name}/file`

**用途**：**编辑并保存**技能内单个文件（2026-09-16：全部文件可编辑，含 `references/` 等附件）。保存只更新**共享技能库**。

**请求体**：`{ "path": "references/手册.md", "content": "…", "base_hash": "<GET 返回的 hash>" }`

**响应 200**：`{ name, path, size, hash, updated_at, revision }`（`hash` 为保存后的新基准值）

**可编辑判据（与 `GET` 的 `editable` 同一口径，服务端同样强制）**

| 情形 | 结果 |
|---|---|
| 文本且 ≤ 256KB | 可编辑（二进制、超 256KB 一律拒写——界面不显示编辑入口，服务端也拒绝，避免"保存时静默丢掉未显示的部分"） |
| 新内容 > 256KB | `VALIDATION_FAILED`，提示改用 ZIP 覆盖安装 |
| 目标文件不存在 | `ADM_SKILL_NOT_FOUND`（在线编辑只改已存在的文件，不新建） |

**并发保护**：`base_hash` 与当前内容哈希不符 → `ADM_CONFIG_REVISION_CONFLICT`，**本次保存不执行**（MUST NOT 静默覆盖他人改动）。用**文件内容哈希**而非全局 `revision`：编辑只影响一个文件，用全局版本号会把"别处改了调用配置"误报成"这个文件被人改过"。

**`SKILL.md` 额外规则**：`description` 按新正文**重新解析并写入索引**（卡片描述不脱节）；`name` 与技能名不一致 → `VALIDATION_FAILED`（技能名是数字人的引用键，改名 MUST 走重新安装）。

**原子性与可恢复性**：写入为"临时文件 → `fsync` → `rename`"，失败不改动原文件；**保存即覆盖，平台不保留任何副本**（"编辑快照"已按 2026-09-16 产品决定移除）——界面 MUST 在保存前二次确认并讲明"保存后无法恢复"。

**生效范围**：库内即改；**引用了该 SKILL 的数字人 MUST 重新部署**才会拿到新版本（§6 部署语义）。运行环境侧无需额外动作——配置指纹覆盖 `skills/**`，部署写入后下一次取用即用新实例。

**错误码**：`ADM_SKILL_NOT_FOUND`、`VALIDATION_FAILED`、`ADM_CONFIG_REVISION_CONFLICT`、`ADM_STORAGE_UNAVAILABLE`

### 4.4 `POST /api/admin/skills/install`

**用途**：上传 ZIP 安装 SKILL 到**共享技能库**（`FR-037`、`FR-038`）。安装目标 MUST 是共享技能库，MUST NOT 直接写入某个数字人的技能目录。

**请求**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | file | ✅ | ZIP 压缩包 |
| `overwrite` | string | 可选 | `"true"` 表示名称冲突时**显式选择覆盖**（`FR-040`）；缺省时冲突即返回 `ADM_SKILL_NAME_TAKEN` |

**响应 201**：`{ name, description, files, installed_at, overwritten: boolean }`

**错误码**：`ADM_SKILL_ARCHIVE_INVALID`（`FR-038`）、`ADM_SKILL_ARCHIVE_UNSAFE`（`FR-039`）、`ADM_SKILL_NAME_TAKEN`（`FR-040`）、`VALIDATION_FAILED`

**关键约束**：①全部校验 MUST 在写入目标目录**之前**完成（`FR-039`）；②失败 MUST 回滚，MUST NOT 留下半解压残留（`FR-041`）；③覆盖 MUST 整体替换为一个**原子操作**（`FR-040`），并使所有引用该 SKILL 的数字人在下次部署时同步获得新内容。

### 4.5 `DELETE /api/admin/skills/{name}`

**用途**：删除库中 SKILL。被引用时界面 MUST 先经 `§7.1` 列出受影响的数字人清单并二次确认（`FR-042`）。

**响应 204**

**错误码**：`ADM_SKILL_NOT_FOUND`

---

## §5 数字人设计

### 5.1 `GET /api/admin/agents`

**用途**：卡片列表（`FR-014`）。卡片 MUST 至少含名称与用途描述；异常实体以可辨识异常态呈现且不影响其余卡片（`FR-006`）。

**查询参数**：`page`

**响应 200**：`items` 每项：`{ name, description, abnormal: boolean, abnormal_reason: string|null, updated_at }`

### 5.2 `POST /api/admin/agents`

**用途**：新建数字人（`FR-015`）。

**请求体**：见 `data-model.md` §5 的字段表（`soul` 必填非空）

**响应 201**：完整设计态 + `revision`

**错误码**：`ADM_AGENT_NAME_TAKEN`、`VALIDATION_FAILED`、`ADM_AGENT_INVALID_REF`

### 5.3 `GET /api/admin/agents/{name}`

**用途**：查看单个数字人的**全部配置内容**（`FR-014`）。

**响应 200**：`{ name, soul, enabled_tools, mcp_services, skills, scenario, abnormal, abnormal_reason, updated_at, revision }`

**`scenario` 的结构**（`FR-020`；字段约束为 2026-09-17 新增）：

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["生产计划", "产线电价"],
  "data_prep_fields": {
    "生产计划": [
      { "name": "产线编号", "type": "string",  "required": true },
      { "name": "计划量",   "type": "integer", "required": false }
    ]
  }
}
```

- `data_prep_fields` 的键 MUST 在 `data_prep_dirs` 内；**只出现有约束的目录**（空清单不出现）。
- `type` ∈ `string` / `integer` / `number` / `boolean` / `object` / `array`（JSON Schema 基本类型子集，与运行环境同一枚举）。
- `required` 为 `true` 时，上传表的表头 MUST 含该字段；`false` 表示可选（出现则类型仍须匹配）。
- **该键恒出现在响应中**（历史文档缺该键时，服务端读取即补为 `{}`），客户端无需判空；请求体可省略（按无约束处理）。
- 完整字段表与校验规则见 `data-model.md` §5；字段值的实际判定（上传表表头预检）在运行环境侧，见 `runtime-api-delta.md` §3.1。

**错误码**：`ADM_AGENT_NOT_FOUND`（复用 `AGENT_NOT_FOUND` 语义，因属平台自有命名空间故加前缀；**同名不同义的情况在本契约中不存在**）

### 5.4 `PUT /api/admin/agents/{name}`

**用途**：编辑任意一类配置并保存（`FR-017`）。保存后 MUST 能原样回显，含换行、标点与条目顺序。

**请求体**：五类配置 + `revision`

**响应 200**：保存后的完整设计态 + 新 `revision`

**错误码**：`ADM_AGENT_NAME_TAKEN`（改名冲突）、`ADM_AGENT_INVALID_REF`、`VALIDATION_FAILED`、`ADM_CONFIG_REVISION_CONFLICT`

### 5.5 `DELETE /api/admin/agents/{name}`

**用途**：删除数字人（`FR-021`、`FR-022`）。被用户关联时 MUST 阻止或要求先解除关联。

**响应 204**

**错误码**：`ADM_AGENT_IN_USE`、`ADM_AGENT_NOT_FOUND`

---

## §6 用户与部署

### 6.1 `GET /api/admin/users`

**用途**：用户卡片列表（`FR-023`）。每张卡片 MUST 展示用户名与其已关联数字人角色名清单；可展开查看每个数字人的搭配摘要（引用的 MCP 服务、内置工具、SKILL）及其异常标记——该页兼作**部署前核对总账**。

**查询参数**：`page`；`expand=summary`（含搭配摘要）

**响应 200**：`items` 每项：

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | string | 用户标识 |
| `agents` | array | 每个：`{ name, abnormal, abnormal_reason }` |
| `deployed_at` | string \| null | **部署状态**（取自部署清单，`FR-031`）：`null` = 从未部署过（新建用户即如此，**或已被 §6.9 撤回**）；界面据此显示"未部署／已部署 + 最近一次时间"，并在卡片上勾选部署对象（2026-09-16） |
| `summary` | array \| null | `expand=summary` 时返回：每个数字人的 `{ name, mcp_services, enabled_tools, skills }` |

### 6.2 `POST /api/admin/users`

**用途**：新建用户（`FR-024`）。

**请求体**：`{ "user_id": "admin", "agents": ["demo"], "revision": 12 }`

**响应 201**：`{ user_id, agents, revision }`

**错误码**：`ADM_USER_ID_TAKEN`、`VALIDATION_FAILED`、`ADM_CONFIG_REVISION_CONFLICT`

### 6.3 `PUT /api/admin/users/{user_id}`

**用途**：编辑用户，含**增加或移除其关联的数字人**（`FR-024`、`FR-025`）。可关联的 MUST 是平台内已存在的数字人。

**请求体**：`{ "agents": ["demo", "demo2"], "revision": 13 }`

**响应 200**：`{ user_id, agents, revision }`

**错误码**：`ADM_USER_NOT_FOUND`、`VALIDATION_FAILED`、`ADM_CONFIG_REVISION_CONFLICT`

### 6.4 `DELETE /api/admin/users/{user_id}`

**用途**：删除用户。属引用冲突场景，界面 MUST 提示并要求二次确认（边缘情况「引用冲突」）。**注意**：删除平台侧用户**不删除** `.opt-agent/` 中该用户的数据目录（受 `FR-028` 约束）；实际清理由后续"部署生效"按部署清单语义决定。

**响应 204**

**错误码**：`ADM_USER_NOT_FOUND`

### 6.5 `POST /api/admin/deploy/validate`

**用途**：**只读**预检，让管理员在真正部署前看到全部错误项（`FR-027` 的界面化）。与 `6.6` 的校验逻辑**同一实现**，MUST NOT 形成两套判定。

**请求体**：`{ "user_ids": ["admin"] }`（缺省表示全部用户）

**响应 200**：`{ "passed": boolean, "errors": [ { user_id, agent_name, category, code, message, detail } ] }`

`category` ∈ `config_integrity` \| `reference_validity` \| `name_path_safety` \| `target_writable`（四类；原第五类 `runtime_form` 随运行形态下架，2026-09-27）。

**关键约束**：校验 MUST 一次性列出**全部**错误项（不是发现一个就停）；错误读取不到即按失败处理。

### 6.6 `POST /api/admin/deploy`

**用途**：**部署生效**（`FR-026`）。流程 MUST 为：**只读预校验（`FR-027`）→ 全部通过才写入**。

**请求体**：`{ "user_ids": ["admin"], "revision": 13 }`（缺省全部用户）

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `users` | array | 每用户：`{ user_id, ok, agents: [{ name, action: "written"|"removed", ok }], error? }` |
| `manifest_diff` | array | 与部署清单不一致的差异（如手工删改过的目录，`FR-032`） |
| `history_id` | string | 对应 `§6.7` 的一条记录 |

**错误码**：`ADM_DEPLOY_VALIDATION_FAILED`（`details.errors` 列出全部错误项；**运行环境写入次数 MUST 为 0**，`SC-020`）、`ADM_DEPLOY_TARGET_NOT_WRITABLE`、`ADM_AGENT_INVALID_REF`（单因同码时直接返回该码）、`ADM_CONFIG_REVISION_CONFLICT`

**关键约束**（`SC-004`、`SC-012`、`SC-018`）：
- 原子性：以**用户为最小单位**，失败即该用户零写入；实现为"临时目录构建 → 校验 → 目录级原子改名"（`research.md` D8）。
- 幂等：相同内容重复部署结果稳定（`FR-030`）。
- 作用域：仅写 `users/{uid}/agents/{agent}/`；**文件空间数据 100% 不变**（`FR-028`）。
- 整体覆盖：平台侧未搭配的内容 MUST NOT 残留（`FR-026`）。
- 生效时机：新对话立即生效；进行中的回答不中断（`FR-034`）。
- **整体覆盖**（2026-09-16）：目标用户的 `agents/` 目录以本次产物为准——不在本次产物里的一切条目（含手工放进该目录的内容）都会被清除。这是"去掉关联再部署仍删不掉该数字人"的根治办法；用户文件空间（`user-data/**`）一律不触碰（`FR-028`、`SC-012`）。

### 6.7 `GET /api/admin/deploy/history`

**用途**：部署历史（`FR-033`、`SC-008`）。**有界返回**。

**查询参数**：`limit`（默认 20，1~100）

**响应 200**：`{ "items": [ { id, deployed_at, operator, result, user_count, error_count, users, validation, manifest_diff } ], "truncated": boolean }`

> **2026-09-27**：`target_runtime_form` 字段随运行形态下架；存量记录的该字段在读取时被忽略（JSONL 只追加的容错口径）。

- `result`：`succeeded`（全部成功）/ `partial`（部分成功）/ `failed`（失败）——按**失败用户数**判定（`users` 里 `ok === false` 的个数，`error_count` 即该数）；
- `users` / `validation` / `manifest_diff`：逐用户结果（失败原因在该用户的 `error`）、校验摘要、与运行环境的差异（字段口径见 `data-model.md` §7.3）。**界面的「展开」据此还原"失败的是谁、哪个数字人、为什么"**，MUST NOT 为此另设详情端点；
- **界面呈现**（2026-09-16 十三次调整）：表格**每页固定 5 条**（翻页在已拉取到的记录内进行——组件按本端点上限 100 拉取，`truncated` 为真时明确告知"更早的记录未拉取"），每行可展开查看 `users` / `manifest_diff` 明细。

### 6.8 `GET /api/admin/deploy/manifest`

**用途**：查看部署清单（`FR-031`），界定部署时允许删除的范围。

**响应 200**：`{ "items": [ { user_id, agent_names, last_deployed_at } ], "total": 0, "revision": 13 }`

> **2026-09-27**：响应新增 `revision`（平台设计态当前版本）。部署接口（§6.6）需要乐观锁版本，
> 而"目标运行形态"下架后 `/platform/settings` 已不存在，故由部署功能区自己的读端点提供。

### 6.9 `POST /api/admin/deploy/withdraw`

**用途**：**撤回部署**（用户卡片上的「撤回」）。清空该用户在运行环境中的**全部数字人目录**——这些数字人随即失去能力。

**请求体**：`{ "user_id": "zpf", "revision": 13 }`（`revision` 必填，乐观锁）

**响应 200**：`{ "user_id": "zpf", "withdrawn": ["生产计划助手"] }`（`withdrawn` 取自**运行环境实际内容**，而非部署清单）

**关键约束**：
1. 只动 `users/{user_id}/agents/`（整目录下架）；**用户文件空间与其余目录一律保留**——撤回的是"能力"，不是数据；
2. 平台侧的**用户关联与数字人设计态不受影响**，需要时重新部署即可恢复；
3. 部署清单里该用户的条目同时移除，§6.1 的 `deployed_at` 随之变为 `null`（卡片显示"未部署"）；
4. 与 §6.6 同一套纪律：乐观锁先行；未知用户 → `ADM_USER_NOT_FOUND`；目标不可写 → `ADM_DEPLOY_TARGET_NOT_WRITABLE`（失败**不改动**运行环境）。

> 说明：原先占用本节的 `GET /api/admin/deploy/targets`（可选部署目标清单）已于 2026-09-16 删除；部署对象改由 §6.1 的用户卡片勾选。

---

## §7 派生信息（引用关系与异常汇总）

> 规格关键实体「引用关系」明确：引用关系**不落库**、**不做常驻浏览视图**；其呈现时机**仅限**破坏性操作的确认环节、部署前校验与全局异常项汇总。因此本节的接口 MUST NOT 被任何常驻页面轮询调用。

### 7.1 `GET /api/admin/references`

**用途**：**仅供破坏性操作的确认环节**查询引用关系（`FR-042`、`FR-051`、`FR-013`）。界面 MUST 在管理员触发删除后**才**调用（MCP 服务的"删除前提示引用"见 §3.3.2）。

**查询参数**

| 参数 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `target_type` | string | ✅ | `builtin_tool` \| `mcp_service` \| `skill` \| `agent` \| `user` |
| `target_name` | string | ✅ | 目标名称 |

**响应 200**：`{ "target_type": "skill", "target_name": "pdf-parse", "affected": [ { "user_id": "admin", "agent_name": "demo" } ] }`

**错误码**：`VALIDATION_FAILED`

### 7.2 `GET /api/admin/anomalies`

**用途**：**全局异常项汇总视图**（`FR-055`，落在数字人部署功能区内作为分区/页签）：一次列出全平台所有引用了失效对象的数字人及其所属用户，并可跳转到对应编辑位置。**有界返回。**

**查询参数**：`limit`（默认 50，1~200）

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | array | 每条：`{ user_id, agent_name, category, target_name, detail }`；`category` ∈ `builtin_tool` \| `mcp_service` \| `skill` |
| `total` | integer | 总数 |
| `truncated` | boolean | 是否被截断 |
| `edit_path` | string | 前端可直接使用的编辑跳转路径模板（避免前端硬编码路由，原则七） |

**关键约束**：MUST 一次视图内可见全部受影响数字人，MUST NOT 要求管理员逐个翻查（`SC-016`）。

---

## §8 契约与前端类型的映射

按宪章原则七，`admin-frontend/src/api/types.ts` MUST 与本契约**一一映射**：

| 本契约 | 前端类型 | 说明 |
|---|---|---|
| `§3.1` 的 `items` 元素 | `McpServiceListItem` | 字段名、可选性完全对齐（含单一 `url`） |
| `§3.2` 的响应 | `McpServiceDetail` | 调用配置 + 工具清单 + 引用 |
| `§3.3.1` 的请求体 | `McpServiceCreatePayload` | 名称由管理员指定 |
| `§3.3` / `§3.3.1` 的响应 | `McpServiceConfigSaved` | 完整调用配置 + `revision` + `affected_agents` |
| `§5.3` 的响应 | `AgentDesign` | 五类配置字段与设计态 JSON 一致 |
| `§6.6` 的响应 | `DeployResult` | 含 `manifest_diff` |
| `§0.4` 的错误码 | `ADMIN_ERROR_CODES` 常量 + `error-message.ts` 中文文案映射 | 前端 MUST NOT 直接展示后端 `message`（沿用既有 `frontend` 的口径） |

**错误码文案**：前端 MUST 按 `code` 分派中文文案（新增 `ADM_*` 码的文案映射表），未知码回退通用文案并保留原码——与既有 `frontend/src/utils/error-message.ts` **同一实现思路**，避免两套错误展示习惯。

---

## §9 与既有接口的一致性声明

| 项 | 口径 |
|---|---|
| 错误 envelope | 与 `/api/*` **完全一致**：`{ error: { code, message, details? } }`（原则七） |
| 字段命名 | 下划线，与既有接口及 `.opt-agent` 文件一致 |
| 分页 | 卡片列表固定 8 项/页（`FR-006`）；消息类接口的既有 `limit`/`offset` 惯例**沿用**于非卡片长列表的 `limit` |
| 鉴权 | **无**（`research.md` D11）；操作者固定 `zyw_admin`，仅用于审计字段 |
| 与既有 `/api/*` 的隔离 | `/api/admin/` 由网关按**最长前缀**分发到 `admin-backend`，不进入 `agent-backend`（`research.md` D10） |
