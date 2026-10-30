# 接口契约：数字人管理平台（admin-api）

**特性**：`001-digital-human-platform` | **版本**：1.2 | **日期**：2026-10-17

**1.2（2026-10-17）变更**：①新增 §5.6 设计器候选目录端点（一次返回全量候选，修复设计器只取卡片列表第一页导致第 9 个 SKILL / MCP 服务选不到）；②§10 本体库调整——索引去冗余（身份由 `metadata` 派生，字段 `hash` 更名 `ontology_hash`）、`securities.yaml` 转为必需文件、移除 `has_securities`。

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

**候选枚举类接口不使用分页**：设计器需要的"全部可选对象"（如 §5.6 的 `GET /api/admin/agents/catalog`）MUST 一次返回全量，MUST NOT 复用卡片列表的 `page/page_size`——否则超过 8 个的候选会静默缺席。

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
| `ADM_SKILL_MODIFIED` | 409 | 库内技能内容与导入时不一致（被人工改过），需显式确认才能被市场更新覆盖 | — |
| `ADM_SKILL_READ_ONLY` | 409 | 本体市场来源的 SKILL 为只读，在线编辑被拒（内容只能经市场更新整体替换） | `FR-062` |
| `ADM_ONTOLOGY_NOT_FOUND` | 404 | 本体不在本体库中（或本体文件缺失） | — |
| `ADM_ONTOLOGY_EXISTS` | 409 | 本体库中已存在同一「场景 + 本体目录名」的本体，重复导入被拒 | — |
| `ADM_MCP_SERVICE_NOT_FOUND` | 404 | MCP 服务不存在 | — |
| `ADM_MCP_SERVICE_EXISTS` | 409 | MCP 服务名称已存在（新建重名，2026-09-27） | `FR-043` |
| `ADM_DEPLOY_VALIDATION_FAILED` | 409 | 部署前校验不通过（阻止部署，`details.errors` 列出全部错误项） | `FR-027`、`SC-020` |
| `ADM_DEPLOY_TARGET_NOT_WRITABLE` | 409 | 目标位置不可写 | `FR-027` |
| `ADM_USER_ID_TAKEN` | 409 | 用户标识已存在或非法 | `FR-024` |
| `ADM_USER_NOT_FOUND` | 404 | 用户不存在 | — |
| `ADM_CONFIG_REVISION_CONFLICT` | 409 | 并发编辑冲突（`revision` 不符） | `FR-008` |
| `ADM_STORAGE_UNAVAILABLE` | 503 | 平台设计态存储不可写 | — |
| `ADM_RUNTIME_UNREACHABLE` | 503 | 运行环境只读依赖不可达（工具目录／调用统计） | `FR-011`、`FR-050` |
| `ADM_UNAUTHENTICATED` | 401 | 未认证：凭据缺失或验签失败（§11；**预登记，未实施**） | `FR-065` |
| `ADM_FORBIDDEN` | 403 | 越权：已认证但角色非管理员访问 `/api/admin/*`（§11；**预登记，未实施**） | `FR-066` |

> **2026-09-27 变更**：随 MCP 服务改为平台内全人工配置，**移除四个码**——
> 启停白名单类、运行形态缺地址类、Docker 不可达类、编排声明不可读类（正文提及处已一并清理，
> 故此处不再以代码格式回引旧名）。平台不再读容器编排声明、不再读 Docker 容器运行态，
> 也不再持有"目标运行形态"（详见 §1 与 §3）。新增 `ADM_MCP_SERVICE_EXISTS`。
> （该次变更后）全表共 **21 个**码（4 个复用 + 17 个 `ADM_` 前缀码）。
>
> **2026-10-15 变更**：①**补登** §11「身份与分权」的两个码 `ADM_UNAUTHENTICATED`（401）与
> `ADM_FORBIDDEN`（403）——此前它们只作为"建议错误码"出现在 §11 的约束表里，未进本表，
> 而 `npm run check:contract` 按"契约**全文**出现的码逐一比对四处"的口径核对，故门禁持续报红。
> 现按"本表 = 契约已登记的码集合（含预登记）"补登；**不改变任何既有端点的行为**——§11 仍未实施，
> 无校验钩子，两码当前在运行期不可达，此处只冻结**命名与状态码**（实现阶段若改名，按既有先例
> 直接删除本表对应行即可）。②**修正计数**：上文 2026-09-27 记录里的"21 个"停留在当日、
> 未随 10-02／10-03 的三次新增更新；**现全表 27 个**（4 个复用 + 23 个 `ADM_` 前缀码）。

### 0.5 保存交互（全部写接口的通用约定，2026-09-25）

管理界面上**每一个保存动作**（数字人设计／MCP 调用配置／MCP 新建／SKILL 文件／用户关联）MUST 遵循**同一模式**。本节不是新发明——`useAgentDesign.save()` 已是符合形态，本节把该形态固化为**全部保存点的统一口径**。

**四条原则**

| # | 原则 | 判据（可测） |
|---|---|---|
| ① | **草稿锚定实体标识** | 表单草稿**只在实体标识变化时**从服务端回填（切换 MCP 服务／切换 SKILL 文件／切换数字人）。同一实体的任何服务端刷新（保存后重载、并发更新、列表轮询）**MUST NOT** 重置草稿——否则用户**未提交的输入**会被静默丢弃 |
| ② | **响应即元数据源** | 保存响应用于更新 `revision`（或按实体语义的等价基准，如 SKILL 文件的 `hash`），**MUST NOT 为回填表单而二次请求详情**。为满足此条，响应 MUST 携带**本次保存后的权威元数据**；对"表单字段需要服务端规范化回显"的实体（MCP 调用配置见 §3.3、数字人设计见 §5.4），响应 MUST 是**保存后的完整实体** |
| ③ | **忙态只锁动作按钮** | `disabled` **MUST NOT** 绑到表单控件（输入框／复选框／下拉／编辑表格）。写接口通常在百毫秒级完成，控件级的"禁用→恢复"会退化为无意义的视觉抖动（"闪一下"）；按钮自身的"保存中…"已足以表达进行态 |
| ④ | **新建走弹窗，建成即探测**（2026-09-27） | 新建类实体（MCP 服务）MUST 由**弹窗**采集基础字段并做本地校验；**创建成功 MUST 关闭弹窗并进入详情页**补全其余配置，同时**自动发起一次探测/测试**（MCP 服务 → §3.6）。创建失败 MUST NOT 关闭弹窗、MUST NOT 丢失已填内容；**创建中 MUST 禁止关闭弹窗**（防"以为没建成"而重复创建） |

**为什么这些原则必须同时成立**（各自的典型反例）：

- 只做 ② 不做 ①：保存后重载会连用户的**未提交编辑**一起覆盖；
- 只做 ① 不做 ②：为刷新 `revision` 而重载，若该详情接口含**实时探测**（如 MCP 工具清单，§3.2），探测抖动会让依赖它的渲染分支（复选框清单 ⇄ 手填文本框）来回切换——同样是闪；
- 缺 ③：全平台只有个别控件绑 `busy` 时，会制造"为什么只有它会闪"的不一致观感；
- 缺 ④：新建的实体若连接地址不可达，管理员要自己再点一次测试才发现——"建成即探测"把这一步前移，代价只是一次自动调用（失败不回滚创建，仅如实呈现）。

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
| `has_headers` | boolean | 是否配置了**请求头**（2026-10-08；卡片标「需请求头」用）。**只给布尔量**——请求头里通常是访问令牌，列表 MUST NOT 下发任何值（连掩码也不给） |

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
| `confirmation` | string \| object | 调用确认策略（HITL）：`never`（默认）/ `always` / `{ tools: [...] }` |
| `allowed_tools` | array | **工具白名单**（2026-10-03）：该服务**可见**的原始工具名清单（不含 `{server}__` 前缀）。**空数组 = 不限制**（白名单上线前的存量服务语义，物化时不写该字段）。新建时**必填非空**；**2026-10-15 起可在 §3.3 调整**（缺省沿用存量、提供即全量替换且必须非空） |
| `tool_labels` | object | **工具显示名**（2026-10-27）：`{原始工具名: 人读名称}`，空对象 = 未配置（清单与意图聚焦命题回退英文工具名）。值 1~40 字单行字符串，空串/超长/含控制字符即 `VALIDATION_FAILED`。**语义与 `headers` 同口径：缺省 = 沿用存量，提供 = 全量替换**（`{}` 即清空）。MUST 回显（详情会覆盖表单，漏登等于"保存一次就清空"）。物化时**非空才写**进 `MCP.json`，且按 `allowed_tools` 过滤孤儿键 |
| `headers` | object | **请求头（值已掩码）**（2026-10-08）：`{头名: 掩码值}`，空对象 = 未配置。用于需要访问令牌的服务（本体侧「自建发布」要求 `X-MCP-Token`，缺了直接 401）。**明文令牌 MUST NOT 出现在任何响应里**：每个值都掩码（长值 `6UuE…3F`，短值整串掩掉）。界面 MUST NOT 把掩码提交回来做连接或保存（保存期直接拒，见 §3.3）。完整语义见 `runtime-api-delta.md` §12 |
| `missing_tools` | array | 白名单里**当前服务清单中已不存在**的工具名（下架/改名）——界面据此在该条目上标异常。**只在探测成功时才有意义**：服务不可达时恒为 `[]`（核对不了由 `tools_error` 表达，MUST NOT 把它呈现成"工具不存在"） |
| `tools` | array | 每项：`{ name, label, description, parameters }`（`FR-045`；`label` 为 2026-10-27 新增的**工具显示名**，未配置即空串）。**只含白名单里的工具**（顺序与 `allowed_tools` 一致）；白名单为空（不限制）时即服务全量。`parameters` 的根标题按 `runtime-api-delta.md` §23：服务端 `Tool.title` 以 `x-title` 表达（服务端未声明则原样透传） |
| `tools_truncated` | boolean | `tools` 是否被截断（**先按白名单过滤、后截断**——反过来的话，白名单里排在截断线之后的工具会被误判成"不存在"） |
| `tools_error` | string \| null | 工具清单不可得时的可读原因（`null` = 可得） |
| `available_tools` | array | **本次探测到的全部工具**（2026-10-15）：形状同 `tools`，顺序 = 服务返回顺序，有界同 `TOOLS_LIMIT`（100）。**用途只有一个**——工具范围弹窗的勾选基准（§3.3 界面口径）：`tools` 是白名单投影，拿它做基准就永远加不进一个当前不在白名单里的工具。探测成功时 `tools ⊆ available_tools`。不含任何凭据 |
| `available_tools_truncated` | boolean | `available_tools` 是否被截断（与 `tools_truncated` 各自独立：前者按全量截断，后者按白名单过滤后截断） |
| `references` | array | 引用该服务的数字人（**仅在详情视图呈现**；MUST NOT 作为常驻浏览视图，见 §7.1 说明） |
| `revision` | integer | 平台设计态当前版本（乐观锁基准） |

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`（工具清单不可得时 `tools` 为空且 `tools_truncated=false`，并在响应中给出 `tools_error` 字段，**不报错**）

> **2026-09-27 变更**：`endpoints`（按运行形态键控的对象）收敛为**单一 `url`**；
> `compose_declaration`（编排原始声明投影）随启停页一并移除。`status` / `in_compose` 同 §3.1。

> **2026-09-28 注记（响应时长与界面义务）**：本端点**内含一次对该 MCP 服务的实时探测**
> （`listTools`，见 `domain/mcp/service-list.ts` 的 `safeTools`）。服务正常时为毫秒~百毫秒级；
> **服务不可达时最坏等待 = `MCP_TIMEOUT_MS` × 2**（建连与调用各计一次超时；默认 10s → 最长约 20s），
> 此时仍返回 200 并以 `tools_error` 说明原因（**不报错**）。
> 因此：
> - 界面 MUST **在发起请求时立即切到详情视图并显示加载态**（标题用已知服务名），
>   MUST NOT 停留在列表上"点了没反应"（原则五"反馈 ≤100ms"、原则九"等待可感知"）；
> - 加载期间「保存调用配置」「删除服务」MUST 为禁用态——此时 `revision` 尚未到手，
>   保存只会因缺乐观锁基准而静默失效；
> - 读取失败 MUST 停在详情页给出可读原因与「重试」，MUST NOT 默默退回列表。
>
> 该"同步探测"是本端点的**已知性能代价**（与原则五的 P95 ≤500ms 存在张力，已登记）；
> 根治方案是把工具清单拆为独立端点懒加载（待排期），当前以加载态兜住可感知性。

### 3.3.1 `POST /api/admin/mcp/services`（新建，2026-09-27）

**用途**：在平台内**新建**一个 MCP 服务。MCP 服务不再从容器编排声明派生，
平台是唯一权威源——管理员新建什么就有什么。

**请求体**：与 §3.3 的请求体相同，另加 `name` 与 `allowed_tools`；`revision` 可选（带了即做乐观锁校验）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `name` | string | ✅ | **全局唯一**；须匹配 `^[A-Za-z0-9_-]{1,64}$`（会成为运行环境的工具前缀）；首尾空白自动去除 |
| `allowed_tools` | array | ✅ | **工具白名单**（2026-10-03）：非空字符串数组（该服务的**原始工具名**），trim + 同服务内去重；**缺字段或空数组即 `VALIDATION_FAILED`**——MUST 在创建这一步就问清楚，不留"全部工具放行"的后门（创建后可在 §3.3 调整）。**只校验语法、不校验名字是否存在**（判据见下） |
| 其余字段 | — | — | 见 §3.3 |

**响应 201**：`{ ...完整调用配置, "revision": 13, "affected_agents": [] }`（形状与 §3.3 响应一致，含 `allowed_tools` 与**掩码后的** `headers`）

**错误码**：`ADM_MCP_SERVICE_EXISTS`（重名）、`VALIDATION_FAILED`（名称非法／`transport` 非法／`http` 缺 `url`／`url` 非 http(s) 地址／`allowed_tools` 缺失或为空）、`ADM_RUNTIME_UNREACHABLE`（**目标连不上**，见下）、`ADM_CONFIG_REVISION_CONFLICT`

**关键约束（2026-10-03，创建前必须先连上）**：
1. 校验顺序：**先**纯字段校验（名称／重名／白名单非空／地址写法，避免为注定失败的新建去连服务）→ **再**对目标发起一次 `listTools` 探测；
2. **连不上即创建失败**，且**不落盘**（库里 MUST NOT 留下记录）——否则会留下一条"没有工具范围"、等价于全部放行的服务；探测失败按 `ADM_RUNTIME_UNREACHABLE` 返回可读原因；
3. 走一遍探测的**收益**：管理员据此在界面上勾选白名单（工具清单来自 §3.9）。

**前端交互（2026-10-03 改版）**：本端点由**新建弹窗**调用，弹窗为**两步**：
① 基本信息（`name` / `description` / `transport` / `url` 或 `command`）→ 调 §3.9 探测 →
② 从探测到的工具里**多选**（**默认不勾选，至少选一个**）→ 才提交本端点。
其余调用配置由服务端补默认（`file_args: {}`、`confirmation: "never"`、`rules_fields: {}`、`headers: {}`），
创建成功后再到详情页（§3.3）补全。**探测失败或白名单未选 → 弹窗 MUST NOT 关闭**（§0.5 原则 ④），
错误留在窗内；创建成功 → 进入该服务详情页并**沿用既有的"自动测试一次"**（§3.6；与"创建前必然探测过一次"不冲突：前者验证连接与能力，后者取的是工具清单）。

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
| `headers` | object | 可选 | **请求头**（2026-10-08）：`{头名: 值}`（真实值，仅 `http` 有意义，`stdio` 丢弃）。逐项判据：头名合法（RFC 7230 token）、**大小写不敏感下不重复**、值为**单行非空字符串**、**MUST NOT 是掩码形态**（`6UuE…3F`/`••••`，违反即 `VALIDATION_FAILED` 并提示填真实值）；头名与值两端 trim。**语义：缺省 = 沿用存量**（保存调用配置 MUST NOT 顺手清空令牌）、**提供 = 全量替换**（`{}` 即清空）。物化时**非空才写**进 `MCP.json`（同上口径）。完整语义见 `runtime-api-delta.md` §12 |
| `confirmation` | string \| object | 可选 | 调用确认策略（HITL）：`never`（缺省）/ `always` / `{ tools: string[] }`（非空）；非法即 `VALIDATION_FAILED` |
| `allowed_tools` | array | 可选 | **工具白名单**（2026-10-03；**2026-10-15 起可在此调整**）：非空字符串数组（该服务的**原始工具名**），trim + 同服务内去重。**空数组／非数组／含非字符串元素即 `VALIDATION_FAILED`**——空数组的语义是"不限制"（物化时不写该字段，数字人据此可见该服务的**全部**工具），与"一个都不给"正好相反，MUST NOT 被静默接受。**语义与 `headers` 同口径：缺省 = 沿用存量，提供 = 全量替换**（保存调用配置 MUST NOT 顺手清空白名单）。**只校验语法、不校验名字是否存在**（漂移由 §3.2 的 `missing_tools` 呈现） |
| `tool_labels` | object | 可选 | **工具显示名**（2026-10-27）：`{原始工具名: 人读名称}`，值 1~40 字单行、非空；空串/超长/含控制字符即 `VALIDATION_FAILED`。**语义与 `headers` 同口径：缺省 = 沿用存量，提供 = 全量替换**（`{}` 即清空）。不属于凭据，无需掩码 |
| `revision` | integer | ✅ | 乐观锁 |

> **存量迁移（2026-09-27）**：旧文档里的 `endpoints`（`{运行形态: 地址}`）在**读取期**收敛为
> 单一 `url`（优先取 `host_local`，否则取第一个非空值），既有配置不丢；写回后只剩 `url`。

> **界面口径（2026-10-03）**：「后台计算（异步工具）」的选择器**只列出在入参 schema 中声明了
> `resultUrl` 的工具**——判据与运行环境注入逻辑同一口径（`declaresResultUrl`），避免"勾了不生效"。
> 四点 MUST：① 清单不可得（`tools_error` 非空）时回退**手填**并给出原因；② 清单被截断
> （`tools_truncated`）时同样给出手填入口；③ **已声明但不在可选范围内**（该工具未声明
> `resultUrl` 或已不在清单中）的项 MUST 仍保留展示并可取消（否则会持续告警却无从取消）；
> ④ 上述过滤**只是界面引导**——服务端仍按本表"只校验语法、不校验工具清单"处理，MUST NOT 据此收紧校验。

> **2026-09-15 变更**：`writable` / `permission_scope` 字段已从调用配置中**移除**（产品决定）。旧客户端提交这两个字段时不再报错（字段被忽略），响应与物化产物中 MUST NOT 再出现；运行环境的 `MCP.json` 因此不再产生 `write` / `permission_boundary`。

> **界面口径（2026-10-15，工具范围调整）**：白名单的唯一调整入口是「工具清单」页签的
> 「重新探测」——探测成功后界面 MUST 弹出**工具范围弹窗**：以本次探测结果
> （§3.2 的 `available_tools`）为勾选基准、按当前白名单预勾选、**必须至少勾一个**
> （本地拦一次 + 服务端 400，见上表）、探测失败时 MUST NOT 弹窗（拿不到可信基准，
> 勾选等于凭空造范围，此时只如实展示 `tools_error`）。
> 弹窗保存时 MUST 把**其余字段按当前详情原样回填**（本端点载荷是全量替换语义，
> 漏传即被补成默认值），但 **MUST NOT 回传 `headers`**（详情回的是掩码，回传等于把真令牌
> 换成掩码；缺省即沿用）。
> 保存成功后界面 MUST **就地**更新白名单与 `revision`、MUST NOT 为回填而重载详情
> （§0.5 原则 ①②：重载会整表重填、丢掉未提交的草稿，并多打一次实时探测），
> 且 MUST 提示"引用该服务的数字人将在下次部署时生效"（`affected_agents`）。
> 取消 MUST NOT 改动任何东西（不发请求）。

**响应 200**：保存后的完整调用配置 + 新 `revision` + `affected_agents`（受影响的数字人名清单，供界面提示）

**响应字段 MUST 与请求体字段一一对应**（含 `command`／`args`／`updated_at`；`headers` 以**掩码**形态对应）：界面据此**原地更新 `revision`**、不再为回填而二次请求详情（§0.5 原则 ②）。漏登字段会让客户端"保存成功却丢配置"——`2026-09-25` 实测：`command`／`args` 缺失，客户端只能靠重载详情兜底，从而引入整表覆盖与探测抖动。
**`headers` 的掩码回执另有用途**（2026-10-08）：界面拿它**就地刷新**请求头展示（详情不重载，故不会连带触发一次 MCP 实时探测）。

**错误码**：`ADM_MCP_SERVICE_NOT_FOUND`、`VALIDATION_FAILED`（含 `allowed_tools` 为空数组或形状非法）、`ADM_CONFIG_REVISION_CONFLICT`

### 3.9 `POST /api/admin/mcp/probe`（2026-10-03）

**用途**：**新建前的工具清单探测**——对一个**尚未登记**的连接目标连一次，取回其工具清单，供新建流程勾选白名单（§3.3.1）。

与 §3.6 的分工：`test` 只回答"**已登记**的服务通不通"（未登记即 404）；本端点回答"这个**新**目标有哪些工具"，因此 **MUST NOT 要求服务已存在**。

**请求体**：`{ "name"?: "ocr", "transport": "http", "url": "http://…/mcp", "command"?: "…", "args"?: ["…"], "headers"?: {"X-MCP-Token": "…"} }`
（`name` 仅用于报错文案可读，不参与连接；`headers` 为**真实值**——新建目标没有"存量"可沿用，缺省即空，写法非法仍按 400 返回）

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 是否探测成功 |
| `tools` | array | `[{ name, description, parameters }]`（**有界**：最多 `TOOLS_LIMIT`=100 项；`parameters` 根标题口径同 `runtime-api-delta.md` §23 —— 服务端 `Tool.title` → `x-title`） |
| `tools_truncated` | boolean | 是否因超过上限而截断 |
| `error` | string \| null | `ok=false` 时的可读原因；`ok=true` 时为 `null` |
| `error_code` | string \| null | `ok=false` 时的错误码（如 `ADM_RUNTIME_UNREACHABLE`） |
| `target` | object | **实际探测目标** `{ transport, url, command }`——界面上 MUST 展示 |
| `checked_at` | string | ISO8601 |

**关键约束**：
1. **不落盘**：本端点只是探测，MUST NOT 创建或修改任何服务记录；
2. **连接层面的失败不报错**（HTTP 200 + `ok: false` + 可读原因）：失败要留在新建弹窗里，由管理员决定重试或放弃；
3. **目标写法非法**（`transport` 不认识 / 缺 `url`）仍是 400 `VALIDATION_FAILED`——那属表单校验该拦住的问题；
4. 探测用的客户端与 §3.6 同一实现（`McpClientService.listTools`），避免"平台测通了、运行环境连不上"的协议口径漂移。

**错误码**：`VALIDATION_FAILED`（目标写法非法）

### 3.6 `POST /api/admin/mcp/services/{name}/test`

**用途**：发起测试 = **连通性检查 + 一次实际能力验证**（`FR-047`）。

> **服务 MUST 已登记**：未登记的服务 → `ADM_MCP_SERVICE_NOT_FOUND`（`requireConfig` 前置校验）。
> 这正是"**新建弹窗内不提供测试、改为创建成功后自动测一次**"的原因（§0.5 原则 ④、§3.3.1）。

**请求体（可选）**：携带 `{ transport, url, command?, args?, headers? }` 时按**表单当前（尚未保存）的值**探测；缺省按已保存的调用配置测试。

> **`headers` 的缺省语义**（2026-10-08）：**不携带 = 用已保存的请求头**。理由与其它字段一致但也必须写清：详情回显的是**掩码**，界面"未改动请求头"时手上没有真值可提交；若把"没带 `headers`"读成"没有请求头"，管理员改完地址点「发起测试」会被一个与配置无关的 401 挡住——而保存是沿用存量的，两边行为就对不上了。想显式测"不带请求头"就传 `{}`（与 §3.3 的"提供 = 全量替换"同义）。

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 是否成功 |
| `connectivity` | object | `{ ok, duration_ms, error_code?, message? }` |
| `capability` | object | `{ ok, method, duration_ms, error_code?, message? }`（如 `ping`） |
| `target` | object | **实际被测目标** `{ transport, url, command }`——界面上 MUST 展示，否则"测的是谁"不可见。**不含请求头**：那是凭据，回显会给"令牌进日志/截图"开口子 |
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

**响应 200**：`items` 每项：`{ name, description, installed_at, updated_at, source, origin? }`（`origin` 为本体市场导入的溯源与内容指纹，见 §4.6；缺省 = 外部安装）

### 4.2 `GET /api/admin/skills/{name}`

**用途**：查看单个 SKILL 的元数据与**正文全文**（`FR-036`）。

**响应 200**：`{ name, description, content, content_hash, files, source, origin?, installed_at, updated_at, revision }`（`content_hash` 为 `SKILL.md` 内容哈希，供详情页直接改正文时作乐观锁基准；`revision` 为平台全局版本；`origin` 见 §4.6）

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
| `editable` | boolean | 是否可在线编辑：**文本且完整**（二进制、超 256KB 均为 `false`）；**本体市场来源的技能恒为 `false`**（只读快照，2026-10-03，`FR-062`） |

**关键约束**：路径安全口径 MUST 与安装侧一致（复用同一套判定）——拒绝绝对路径、盘符、`..` 穿越、控制字符，且解析后的绝对路径必须落在该技能目录内；只返回目录内真实存在的**普通文件**（目录与符号链接不返回）。

**错误码**：`ADM_SKILL_NOT_FOUND`（技能或文件不存在）、`VALIDATION_FAILED`（`path` 缺失或路径非法）

### 4.3.1 `PUT /api/admin/skills/{name}/file`

**用途**：**编辑并保存**技能内单个文件（2026-09-16：全部文件可编辑，含 `references/` 等附件）。保存只更新**共享技能库**。

**只读例外（2026-10-03，`FR-062`）**：技能记录的 `origin.kind === "onto_market"`（从本体市场导入）时，**本端点一律拒绝**（`ADM_SKILL_READ_ONLY`，HTTP 409）——它是市场快照，内容只能经 §4.8 的「更新」以市场现版本整体替换。**拦截在写盘之前**（拒绝时文件内容零变化）；**界面 MUST NOT 渲染编辑入口**（服务端仍是权威）。

**请求体**：`{ "path": "references/手册.md", "content": "…", "base_hash": "<GET 返回的 hash>" }`

**响应 200**：`{ name, path, size, hash, updated_at, revision }`（`hash` 为保存后的新基准值）

**可编辑判据（与 `GET` 的 `editable` 同一口径，服务端同样强制）**

| 情形 | 结果 |
|---|---|
| 文本且 ≤ 256KB | 可编辑（二进制、超 256KB 一律拒写——界面不显示编辑入口，服务端也拒绝，避免"保存时静默丢掉未显示的部分"） |
| **技能来源为 `onto_market`** | `ADM_SKILL_READ_ONLY`（只读快照，改用 §4.8 更新） |
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

### 4.6 `GET /api/admin/skills/onto-market`

**用途**：列出**本体市场**（optonto `.data/onto_market`，平台**只读**）中可导入的技能，并完成一次"市场文件是否变化"的检查（2026-10-02）。市场目录形态：`{场景}/{本体}/skills/{技能目录}/SKILL.md`（可含附件子目录）。

**响应 200**：`{ configured, reason, items }`

| 字段 | 说明 |
|---|---|
| `configured` | 是否配置了 `ONTO_MARKET_DIR`；`false` 时功能不可用（**不报错**） |
| `reason` | 无法列出时的可读原因（未配置 / 目录不存在 / 不可读）；正常为 `null` |
| `items[].scenario` / `ontology` / `skill_dir` | 市场侧三级路径（导入请求参数） |
| `items[].name` / `description` | 来自 SKILL.md frontmatter；解析失败为 `null` 并置 `invalid_reason`（该条不可导入） |
| `items[].files` / `hash` | 文件清单与**整包内容指纹**（sha256，路径参与哈希） |
| `items[].status` | `new`（可导入）/ `unchanged`（已导入且市场无变化）/ `changed`（已导入但市场文件已变化，**可经 §4.8 更新**）/ `conflict`（库内同名但非市场来源）/ `invalid`（市场侧格式无效） |

**差异判定**：`status` 由库内同名技能的 `origin.hash` 与市场现算哈希比对得出——打开本接口即完成一次"市场文件是否变化"的检查。

### 4.7 `POST /api/admin/skills/onto-market/install`

**用途**：从本体市场导入一个技能到共享技能库（2026-10-02）。按 `{scenario}/{ontology}/skills/{skill}` 读取市场目录**整包**（对市场只读），复用 ZIP 安装的全部校验与**原子入驻**（§4.4 关键约束同样适用）。

**请求体**：`{ "scenario": "生产调度", "ontology": "原材料采购和库存", "skill": "raw-material-inventory" }`

**响应 201**：`{ name, description, files, installed_at, overwritten: false }`

**错误码**：`ADM_SKILL_NAME_TAKEN`（**重名直接拒绝**——`install` 不提供覆盖；市场文件的更新走 §4.8）、`VALIDATION_FAILED`（未配置 `ONTO_MARKET_DIR`、路径越界、缺 `SKILL.md`、frontmatter 无效、超限等）

**关键约束**：①对市场**只读**，MUST NOT 写/删/改 optonto 任何文件；②导入记录 `source = "onto_market:{场景}/{本体}"` 与 `origin`（含内容指纹）；③库仍是唯一权威来源（`FR-036`）——市场后续更新**不会**自动同步，由管理员经 §4.8 显式更新。

### 4.8 `POST /api/admin/skills/onto-market/update`

**用途**：用市场现版本**更新**一份已从本体市场导入的技能（2026-10-02）。检测到 `changed`（§4.6）后，管理员无需"先删再导"，直接整包原子替换（零时间窗，区别于两步操作——窗口内部署不会物化出缺技能的数字人）。

**请求体**：`{ "scenario": "…", "ontology": "…", "skill": "…", "confirm": false }`（`confirm` 仅在服务端报 `ADM_SKILL_MODIFIED` 后重试时置 `true`）

**覆盖边界**（四重校验，缺一不可）：①库内存在同名技能（不存在 → `VALIDATION_FAILED`，提示走 §4.7 导入）；②该技能 `origin` 为 `onto_market` 且 `scenario`/`ontology` 与本次一致（非市场来源 → `ADM_SKILL_NAME_TAKEN`，市场里挪过位置 → `VALIDATION_FAILED`）；③库内**当前内容**哈希仍等于 `origin.hash`，否则必须 `confirm: true` 显式确认（人工修改随更新被丢弃，**MUST NOT 静默覆盖**）。

**响应 200**：`{ name, description, files, installed_at, overwritten: true, locally_modified, affected_agents }`

| 字段 | 说明 |
|---|---|
| `installed_at` | 保留**首次导入**时间（更新不改变安装时间） |
| `locally_modified` | 更新前库内内容与导入时不一致（本次丢弃了人工修改） |
| `affected_agents` | 设计里引用该技能的数字人名清单——运行副本需**重新部署**才更新（部署即全量物化，`SC-009`） |

**错误码**：`ADM_SKILL_MODIFIED`（库内版本被人工修改且未确认）、`ADM_SKILL_NAME_TAKEN`（库内同名技能非市场来源）、`VALIDATION_FAILED`（同名不存在／来源位置不符／参数与路径问题，同 §4.7）

**关键约束**：①ZIP 上传等**其他来源**的技能永不接受市场覆盖（`FR-036`）；②更新后 `origin.hash` 换为市场现哈希，后续 `changed` 判定从新基准起算；③运行中的会话：重部后 `read_skill` 即读新内容，但 System Prompt 里的技能 `name`/`description` 为实例构建时快照，实例重建后刷新。

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

**`scenario` 的结构**（`FR-020`；字段约束为 2026-09-17 新增；目录级可上传类型为 2026-10-13 新增）：

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["生产计划", "产线电价"],
  "data_prep_fields": {
    "生产计划": [
      { "name": "产线编号", "type": "string",  "required": true },
      { "name": "计划量",   "type": "integer", "required": false }
    ]
  },
  "data_prep_uploads": {
    "生产计划": [".csv", ".xlsx", ".txt"],
    "产线电价": [".json"]
  }
}
```

- `data_prep_fields` 的键 MUST 在 `data_prep_dirs` 内；**只出现有约束的目录**（空清单不出现）。
- `type` ∈ `string` / `integer` / `number` / `boolean` / `object` / `array`（JSON Schema 基本类型子集，与运行环境同一枚举）。
- `required` 为 `true` 时，上传表的表头 MUST 含该字段；`false` 表示可选（出现则类型仍须匹配）。
- **该键恒出现在响应中**（历史文档缺该键时，服务端读取即补为 `{}`），客户端无需判空；请求体可省略（按无约束处理）。
- 完整字段表与校验规则见 `data-model.md` §5；字段值的实际判定（上传表表头预检）在运行环境侧，见 `runtime-api-delta.md` §3.1。
- `data_prep_uploads`（**目录级可上传文件类型白名单**，2026-10-13 新增）的键 MUST 在 `data_prep_dirs` 内；**只出现被配置的目录**（未配置的目录不出现，缺失 ≡ 使用平台默认 `.csv`、`.xlsx`）。
- 其值为**非空**字符串数组，每项为小写含前导点的扩展名，∈ `.xlsx` / `.xls` / `.csv` / `.txt` / `.pdf` / `.json` / `.html` / `.zip` / `.jpg` / `.png` / `.jpeg`（2026-10-14 增 `.xls`，2026-10-20 增 `.html`，顺序即服务端归一顺序）；同目录内 MUST NOT 重复；服务端保存时按上述顺序归一。
- 为空数组、含非法项、或引用 `data_prep_dirs` 清单外的目录 ⇒ **拒绝保存**（`VALIDATION_FAILED`）。
- **该键可省略**（请求体与响应体皆然）；历史文档缺该键时按"全部目录使用平台默认"处理，客户端无需迁移。
- 该配置仅约束**数据准备空间**的**用户上传**；共享空间与临时空间的可上传类型不由此字段影响。

**`soul` 的结构**（004 起为结构化对象；`next_action_hints` 为 **007** 新增，`intent_focus` 为 **013** 新增）：

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| `intro` | string | ✅ | 只给前台 | 角色简介（≤100 字） |
| `welcome` | string | ✅ | 只给前台 | 首屏欢迎语（≤100 字） |
| `starters` | array | ➖ | 只给前台 | 问题实例；每项 `{ prompt, tools: [{ kind, name, service? }] }` |
| `mission` | string | ✅ | 进提示词 | 主要使命（≤4000 字） |
| `capability_tags` | string[] | ➖ | 进提示词 | 能力标签（≤20 项、单项 ≤20 字） |
| `forbidden` | string[] | ➖ | 进提示词 | 绝对禁止（≤20 项、单项 ≤100 字） |
| `prompt_extra` | string | ➖ | 进提示词 | 补充说明（≤4000 字） |
| `next_action_hints` | boolean | ➖ | **运行环境开关** | 下一步动作提示（007）：开启后该数字人每轮回答下方出现可点击卡片。缺省 `false`；**仅 `true` 时**物化进 `SOUL.md` 的 frontmatter |
| `next_action_hints_count` | number | ➖ | **运行环境开关（参数）** | 开关开启时**每轮最多几条**提示（007）：`1~6` 的整数，缺省 `3`；**与开关同进同出**——仅开关开启时物化进 frontmatter，关闭态不写该键 |
| `intent_focus` | boolean | ➖ | **运行环境开关** | 意图聚焦（013）：开启后该数字人每轮对话在调主模型**之前**先做一次意图判定。缺省 `false`；**仅 `true` 时**物化进 frontmatter；与 `next_action_hints` **互相独立** |

- `next_action_hints` 为**拒绝式校验**：键缺失 = `false`（不写该键的老表单 / 004 期存档照常保存）；键在但非布尔（`"true"` / `1` / `null` / `{}`…）→ `VALIDATION_FAILED`，MUST NOT 做隐式转换（"显示关闭、运行环境却已开启"是最难排查的错配）；
- `next_action_hints_count` 同样**拒绝式**：键缺失 = `3`；`null` / 小数 / 越界 / 非数字 → `VALIDATION_FAILED`（不做 round / clamp）；开关关闭时**数值仍被保留**（管理台输入框置灰、不回退），只是不写进产物；
- `intent_focus` 与 `next_action_hints` **同一口径**：键缺失 = `false`（013 之前的存档照常打开与保存）；非布尔 → `VALIDATION_FAILED`；关闭态不写该键（部署零残留）；
- 响应中**恒有这三个键**（读取归一化时缺省补 `false` / `3` / `false`）；
- **对模型行为零影响**：它们只进 frontmatter，正文（System Prompt）在开 / 关两态逐字一致（`FR-035` / `FR-034`）。运行环境侧的读取、生成与端点口径见 `runtime-api-delta.md` §16、§21。

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

### 5.6 `GET /api/admin/agents/catalog`

**用途**：设计器候选目录（2026-10-17）。设计器需要**全量**候选（内置工具 / MCP 服务 / SKILL / 本体），而卡片列表接口固定 8 条一页（`paging.ts`，服务端写死且不接受客户端覆盖）。设计器此前直接调卡片列表并只取 `page=1`，于是库里第 9 个 SKILL / MCP 服务在界面上**根本选不到**，且没有任何提示。本端点一次返回全部候选，**不参与分页**；卡片列表自身行为不变。

**响应 200**：

```json
{
  "builtin_tools": [
    { "name": "read_file", "label": "读取文件", "description_template": "…", "parameters": {}, "writable": false }
  ],
  "builtin_tools_error": null,
  "mcp_services": [
    { "name": "ocr", "description": "…", "transport": "http", "url": "http://…", "has_headers": false, "allowed_tools": ["ocr_image"] }
  ],
  "skills": [
    { "name": "pdf-parse", "description": "…", "installed_at": "…", "updated_at": "…", "source": "zip" }
  ],
  "ontologies": [
    {
      "metadata": { "scenario_name": "生产调度", "ontology_name": "原材料采购和库存", "…": "…" }
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `builtin_tools` | array | 运行环境内置工具目录的**全量**投影（字段同 §2.1） |
| `builtin_tools_error` | string \| null | 工具目录不可读时的可读原因。此时其余两类候选照常返回；与 §5.2/§5.4 的降级口径一致——引用内置工具的保存会被拒绝（`ADM_RUNTIME_UNREACHABLE`） |
| `mcp_services` | array | 平台侧 MCP 服务清单全量（字段同 §3.1） |
| `skills` | array | 共享技能库全量条目（字段同 §4.1，不含正文） |
| `ontologies` | array | 本体库全量条目的**身份**（2026-10-17）：每项只有 `{ metadata }`（`scenario_name` / `ontology_name` 即两段身份），**不含两个文件的正文**（正文由部署物化时从库内读）。设计器以 `{场景名}/{本体名}` 作为引用值、以 `{场景名}-{本体名}` 作为显示名 |

**关键约束**：①**不分页、不截断**（候选枚举语义，不属于卡片列表）；②只读，不落盘；③内置工具不可达 **MUST NOT** 使整个端点失败——否则 MCP / SKILL / 本体候选会被连带清空；④本体候选与 §10.1 同源（同一 `OntologyStore` 视图），因此同样只含 `metadata` 里 6 项齐全的记录，脏数据已被 `toRecord()` 剔除。

**错误码**：无新增（平台自身故障按兜底码处理）。

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

**用途**：删除用户。属引用冲突场景，界面 MUST 提示并要求二次确认（边缘情况「引用冲突」）。

**执行顺序（2026-10-20 修订）**：MUST **先撤回该用户的部署**（清 `users/{uid}/agents/**`、移出部署清单），**再**删除平台侧记录。

- 顺序不可颠倒：撤回失败时用户仍在平台、可重试；若先删平台记录，后续部署的目标集合里再也不会有该用户，"实际清理由后续部署决定"就成了永不发生的承诺（遗留部署会继续对外服务）。
- 用户文件空间 `users/{uid}/user-data/**` MUST NOT 被删除或修改（`FR-028`）：撤回的是**能力**，不是数据。
- 撤回失败 → 整个删除失败，用户与运行环境均保持原样。

**响应 204**

**错误码**：`ADM_USER_NOT_FOUND`、`ADM_DEPLOY_TARGET_NOT_WRITABLE`（撤回失败，删除未发生）

### 6.5 `POST /api/admin/deploy/validate`

**用途**：**只读**预检，让管理员在真正部署前看到全部错误项（`FR-027` 的界面化）。与 `6.6` 的校验逻辑**同一实现**，MUST NOT 形成两套判定。

**请求体**：`{ "user_ids": ["admin"] }`（**省略字段**表示全部用户；**空数组 MUST 被拒绝**（`VALIDATION_FAILED`），`[]` 与"未指定"不得同义；未知用户 → `ADM_USER_NOT_FOUND`，`details.user_ids` 列出具体标识，2026-10-20）

**响应 200**：`{ "passed": boolean, "errors": [ { user_id, agent_name, category, code, message, detail } ] }`

`category` ∈ `config_integrity` \| `reference_validity` \| `name_path_safety` \| `target_writable`（四类；原第五类 `runtime_form` 随运行形态下架，2026-09-27）。

**关键约束**：校验 MUST 一次性列出**全部**错误项（不是发现一个就停）；错误读取不到即按失败处理。

### 6.6 `POST /api/admin/deploy`

**用途**：**部署生效**（`FR-026`）。流程 MUST 为：**只读预校验（`FR-027`）→ 全部通过才写入**。

**请求体**：`{ "user_ids": ["admin"], "revision": 13 }`（**省略字段**表示全部用户；空数组 MUST 被拒绝，未知用户 `details.user_ids` 列出具体标识；2026-10-20）

**响应 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `users` | array | 每用户：`{ user_id, ok, agents: [{ name, action: "written"|"removed", ok }], error? }` |
| `manifest_diff` | array | **部署前**与运行环境的差异（agent 级，`FR-032`）：`agent_missing_in_runtime`（期望有、运行环境缺，可能被手工删除）、`agent_unexpected_in_runtime`（曾由平台分发、本次不再需要，将被清掉）。差异是写入前快照，部署后即为一致；失败用户**不产生**差异条目（原因见 `users[].error`） |
| `history_id` | string | 对应 `§6.7` 的一条记录 |

**错误码**：`ADM_DEPLOY_VALIDATION_FAILED`（`details.errors` 列出全部错误项；**运行环境写入次数 MUST 为 0**，`SC-020`）、`ADM_DEPLOY_TARGET_NOT_WRITABLE`、`ADM_AGENT_INVALID_REF`（单因同码时直接返回该码）、`ADM_CONFIG_REVISION_CONFLICT`

**关键约束**（`SC-004`、`SC-012`、`SC-018`）：
- 原子性：以**用户为最小单位**，失败即该用户零写入；实现为"临时目录构建 → 校验 → 目录级原子改名"（`research.md` D8）。
- 幂等：相同内容重复部署结果稳定（`FR-030`）。
- 作用域：仅写 `users/{uid}/agents/{agent}/`；**文件空间数据 100% 不变**（`FR-028`）。**（2026-10-14 修订，`009-agent-data-isolation`）** 数据域已归到数字人一级（`users/{uid}/user-data/{数字人}/{空间}`）：平台对 `users/{uid}/user-data/**` **零创建、零写入、零删除**——不预建目录骨架、不因"未关联的数字人数据目录"存在而清理它（未纳管 ≠ 可清理）；同名数字人重新关联并部署后，既有数据自动重新可见（身份＝名称）。
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
| `§3.1` 的 `items` 元素 | `McpServiceListItem` | 字段名、可选性完全对齐（含单一 `url` 与 `has_headers` 布尔量） |
| `§3.2` 的响应 | `McpServiceDetail` | 调用配置 + 工具清单 + 引用；`headers` 为**掩码值**（`McpHeaders`） |
| `§3.3.1` 的请求体 | `McpServiceCreatePayload` | 名称由管理员指定 |
| `§3.3` / `§3.3.1` 的响应 | `McpServiceConfigSaved` | 完整调用配置 + `revision` + `affected_agents`；`headers` 同为掩码（界面据此**就地刷新**请求头展示，不重载详情） |
| `§5.3` 的响应 | `AgentDesign` | 五类配置字段与设计态 JSON 一致 |
| `§5.6` 的响应 | `AgentCatalog` | `builtin_tools` / `builtin_tools_error` / `mcp_services` / `skills`，全量不分页 |
| `§6.6` 的响应 | `DeployResult` | 含 `manifest_diff` |
| `§10.1` 的 `items` 元素 | `OntologyListItem` | 6 项 metadata 以对象承载（缺项 `null`）；身份字段 `scenario` / `ontology_dir` / `name` / `source` 由 metadata 派生；不下发任何文件正文 |
| `§10.2` 的响应 | `OntologyDetail` | 记录 + `ontology.yaml` 全文 + `securities.yaml` 全文（两个文件均为必需）——只读视图的数据源 |
| `§10.4` 的 `items` 元素 | `OntologyMarketItem` | 含 `status` 与市场侧两个文件的指纹 |
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

---

## §10 本体管理（2026-10-03 新增）

**定位**：一级导航的第二个功能区（MCP 服务与 SKILL 管理之间）。本体来自**本体市场**（optonto `.data/onto_market`，平台**只读**），导入 **`ontology.yaml` 与 `securities.yaml`（两个都是必需文件，2026-10-17 起）**（`data-model.md` §9）；平台侧**只读**——没有任何编辑本体的端点。

**身份**：`metadata.scenario_name`（场景名）+ `metadata.ontology_name`（本体名）。**身份即 URL**：详情与删除都是 `/{scenario_name}/{ontology_name}`，两段顺序与 `metadata` 字段、与部署路径 `ontology/{场景}/{本体}/` 完全一致（2026-10-17）。两者都 MUST 是**安全路径段**（不含分隔符/`..`/控制字符，≤128 字符；中文与全角括号合法）。

**身份的存储与下发口径（2026-10-17）**：库内 `index.json` 与**所有响应**都**只有 `metadata` 一份来源**——不再下发 `scenario` / `ontology_dir` / `name` / `source` 这些副本字段（它们只服务过卡片文案与 URL，而两者现在都直读 `metadata`）。入库时强校验两个名字与市场目录名完全一致（不一致 → `VALIDATION_FAILED`）。

### 10.1 `GET /api/admin/ontologies`

**用途**：本体卡片列表（`FR-058`）。

**查询参数**：`page`（服务端固定 8 项/页）

**响应 200**：`items` 每项：

```jsonc
{
  "metadata": {                        // 6 项，缺项为 null；身份只在这里
    "created_at": "2026-07-15 16:05:02",
    "deployed_version": "v1.0",
    "scenario_name": "生产调度",
    "scenario_id": 1,
    "ontology_name": "原材料采购和库存",
    "ontology_id": 1
  },
  "ontology_hash": "…sha256…",         // ontology.yaml 的内容指纹
  "installed_at": "2026-10-03T…",
  "updated_at": "2026-10-03T…"
}
```

**关键约束**：列表 MUST NOT 下发任何文件全文（正文按需在 §10.2 取）。

### 10.2 `GET /api/admin/ontologies/{scenario_name}/{ontology_name}`

**用途**：本体详情——记录 + 文件**全文**，供只读视图渲染（`FR-059`）。

**响应 200**：§10.1 的字段 + 下列字段 + `revision`

| 字段 | 说明 |
|---|---|
| `content` / `size` | `ontology.yaml` 全文与字节数 |
| `securities_content` / `securities_size` | `securities.yaml` 全文与字节数（必填文件，恒有值） |

**错误码**：`ADM_ONTOLOGY_NOT_FOUND`（记录不存在，或库内缺 `ontology.yaml` / `securities.yaml` 任一文件）。路径只给一段时不存在该路由（`404`），没有"缺参 400"。

### 10.3 `DELETE /api/admin/ontologies/{scenario_name}/{ontology_name}`

**用途**：从本体库删除（`FR-061`）；目录整体移除（`ontology.yaml` 与 `securities.yaml` 一并清除）。本体**不被数字人引用**，故无需引用清单与二次确认清单（区别于 SKILL 的 §4.5）。

**响应 204**

**错误码**：`ADM_ONTOLOGY_NOT_FOUND`

> **路径 vs 请求体的命名边界（2026-10-17）**：寻址用 `metadata` 的名字（`/{scenario_name}/{ontology_name}`）；**导入/更新的请求体仍是 `{ scenario, ontology_dir }`**——那是本体市场的两级目录名（见 §10.5/§10.6）。两者语义相同，切换发生在"市场目录 → 平台库"的边界上。

### 10.4 `GET /api/admin/ontologies/onto-market`

**用途**：列出本体市场里可导入的本体及其差异状态（`FR-060`）。打开本接口即完成一次"市场侧 `ontology.yaml` / `securities.yaml` 是否变化"的检查。

**响应 200**：`{ configured, reason, items }`

| 字段 | 说明 |
|---|---|
| `configured` | 是否配置了 `ONTO_MARKET_DIR`；`false` 时功能不可用（**不报错**） |
| `reason` | 无法列出时的可读原因；正常为 `null` |
| `items[].scenario` / `ontology_dir` | 市场侧两级路径（导入/更新请求参数） |
| `items[].name` / `metadata` | 解析自 `ontology.yaml` 的 `metadata` 段；解析失败为 `null` 并置 `invalid_reason` |
| `items[].size` / `ontology_hash` | `ontology.yaml` 字节数 / **内容指纹**（sha256） |
| `items[].securities_size` / `securities_hash` | 市场侧 `securities.yaml` 的字节数与内容指纹（该文件为必需，缺失即整条 `invalid`） |
| `items[].status` | `new`（可导入）/ `unchanged`（已导入且**两个基准文件**都未变）/ `changed`（已导入但任一文件已变，**可经 §10.6 更新**）/ `invalid`（缺 `ontology.yaml` 或 `securities.yaml`、超限、YAML 无效） |

**关键约束**：对市场**只读**，MUST NOT 写/删/改 optonto 任何文件；单条 `invalid` MUST NOT 拖垮整个列表。

### 10.5 `POST /api/admin/ontologies/onto-market/import`

**用途**：从本体市场导入一个本体（`ontology.yaml` 与 `securities.yaml` 均为必需）到平台本体库。

**请求体**：`{ "scenario": "生产调度", "ontology_dir": "原材料采购和库存" }`

**响应 201**：`{ metadata, installed_at, overwritten: false }`（身份只在 `metadata` 的两个名字里）

**错误码**：`ADM_ONTOLOGY_EXISTS`（**重复导入直接拒绝**——同一「场景 + 目录名」已存在，界面应改用 §10.6）、`VALIDATION_FAILED`（未配置 `ONTO_MARKET_DIR`、路径越界、`ontology.yaml` 或 `securities.yaml` 缺失/超限、YAML 无效、**`metadata` 与市场路径不一致**等）

**关键约束**：①对市场只读；②落盘条目只记 `metadata` + `ontology_hash` + `securities_hash` + 时间；③落盘 `platform-data/onto_market/{场景}/{本体}/` 下的同名文件（前两级结构与市场一致）；④入库强校验 `metadata.scenario_name` / `ontology_name` 与市场路径完全一致。

### 10.6 `POST /api/admin/ontologies/onto-market/update`

**用途**：用市场现版本更新已导入的本体（`FR-061`）。

**请求体**：同 §10.5

**响应 200**：同 §10.5 但 `overwritten: true`；`installed_at` 保留**首次导入**时间。

**错误码**：`VALIDATION_FAILED`（**库内不存在该本体** → 提示先导入；参数与市场侧问题同 §10.5）

**关键约束**：①整体替换两个文件（单文件原子写；市场侧缺任一文件时该条 `invalid`、更新被拒且库内快照保持不变）；②更新后 `ontology_hash` / `securities_hash` 换为市场现哈希，后续 `changed` 判定从新基准起算；③与 SKILL 不同**没有"人工修改确认"**——本体只读、平台无编辑通道，库内内容必然等于上次导入的市场快照。

## §11 身份与分权（2026-10-08 登记，**未实施**）

> 对应 `spec.md` 的 `FR-065` / `FR-066` 与「假设」中"管理端不引入登录与多角色权限"的**修订**。
> 端点细节（登录 / 登出 / 会话刷新）在实施阶段补全；本节先登记**契约级约束**，以便与 `FR-065` 同批落地。

| 项 | 规定 |
|---|---|
| 凭据 | 请求 MUST 携带**服务端可验签**的会话凭据（HttpOnly Cookie 或等价的签名令牌）；MUST NOT 接受客户端自述式标识（如裸 `X-User-Id`） |
| 未认证 | 缺失或验签失败 MUST 返回 **401**（建议错误码 `ADM_UNAUTHENTICATED`），响应 MUST NOT 含任何业务数据 |
| 越权 | 已认证但角色非管理员访问 `/api/admin/*` MUST 返回 **403**（建议错误码 `ADM_FORBIDDEN`） |
| 主体 | 响应与日志中的操作者 MUST 为经校验的真实主体（替换常量 `zyw_admin`，见 `domain/error-codes.ts` 的 `PLATFORM_OPERATOR`） |
| 审计面 | 部署、删除、改写 `headers` 令牌等关键写操作 MUST 记录「主体 / 时间 / 动作 / 目标 / trace_id」 |
| 兼容与回滚 | 生效前不带凭据的既有行为 MUST 保持不变（存量零变化）；回滚 = 移除校验钩子，数据侧无残留 |

**与既有章节的关系**：本节**不改变**任何既有端点的请求/响应结构（只新增 401/403 两种拒绝），故 §8「契约与前端类型的映射」与 §9「与既有接口的一致性声明」无需修订；唯一受影响的是前端必须新增"登录态与 401/403 处理"这一条链路，属实施阶段的前端契约增量。

**错误码登记状态（2026-10-15）**：上表的 `ADM_UNAUTHENTICATED` / `ADM_FORBIDDEN` 已补登进 §0.4 总表（及后端 `domain/error-codes.ts`、前端 `constants/error-messages.ts` 两处码表），故 `npm run check:contract` 恢复通过；两码当前**不可达**（本节仍未实施、无边界的校验钩子），登记只冻结命名与状态码。
