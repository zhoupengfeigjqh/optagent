# 数据模型：数字人管理平台（Phase 1）

**特性**：`001-digital-human-platform` | **日期**：2026-09-15 | **上游**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)

本文件定义**平台设计态**（平台自己的数据）、**物化产物**（写入 `.opt-agent/` 的运行态形态）与**只读投影**（从运行环境读取的数据）三类数据的结构、字段、校验规则与状态流转。字段名一律用下划线命名（与既有 `MCP.json` / `scenario.json` / 既有接口保持同一口径，降低契约映射成本）。

---

## 0. 三类数据的边界

| 类别 | 存放位置 | 平台权限 | 一对一约束 |
|---|---|---|---|
| **设计态** | `platform-data/`（bind mount） | 读写（平台的唯一权威源） | 平台自身数据，**不与运行环境共享**（`FR-001` 只要求共享**用户数据**目录） |
| **物化产物** | `.opt-agent/users/{uid}/agents/{agent}/` | 部署时**整体覆盖**写入 | 平台是内容来源，运行环境是消费方（`FR-026`） |
| **只读投影** | `agent-backend` 只读端点（内置工具目录、调用统计） | **只读** | 平台 MUST NOT 反写（`FR-005`）。**（2026-09-27）** 容器编排文件与 Docker Engine 已从只读投影中移除——平台不再读它们 |

**判据（与 `FR-028` 同一口径）**：平台在 `.opt-agent/` 产生的写入 **100% 限于** `users/{uid}/agents/{agent}/` 之内；用户文件空间（`数据准备` / `共享空间` / `临时空间`）下的文件与二级目录**一律不触碰**。

---

## 1. 平台设计态：`platform-data/` 布局

```text
platform-data/
├── meta.json                 # 平台元数据（含单调递增 revision，用于并发检测）
├── builtin-tools.json        # 内置工具的本地覆盖（默认空；见 §2 说明）
├── mcp-services.json         # MCP 调用配置（按名称索引）
├── skills/
│   ├── index.json            # SKILL 库索引（元数据）
│   └── {skill-name}/         # SKILL 正文与附件（与库中 SKILL 一一对应）
├── onto_market/              # 本体库（§10，2026-10-03）：结构与市场前两级一致
│   ├── index.json            # 本体索引（含 6 项 metadata 与两个内容指纹，§9）
│   └── {场景}/{本体}/
│       ├── ontology.yaml     # 本体正文（只读快照，市场侧导入）
│       └── securities.yaml   # 行为安全管控（可选，随本体一并同步）
├── agents/
│   └── {agent-name}.json     # 数字人设计态（含五类配置）
├── users/
│   └── {user-id}.json        # 用户与其关联数字人
└── deploy/
    ├── manifest.json         # 部署清单（平台实际分发过的用户与数字人）
    └── history.jsonl         # 部署历史（追加写，逐行一条记录）
```

**写入策略**（`research.md` D4）：所有 JSON 文档采用"写临时文件 → `fsync` → 原子 `rename`"；写入前校验 `meta.revision`，不符即返回 `CONFIG_REVISION_CONFLICT`（`FR-008`、边缘情况「并发编辑」）。

### 1.1 `meta.json`

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `revision` | integer | ✅ | ≥ 1，单调递增 | 每次成功写入平台设计态自增；用于乐观并发控制 |
| `schema_version` | string | ✅ | 语义化版本 | 设计态文档格式版本，供未来迁移 |
| `created_at` / `updated_at` | string | ✅ | ISO8601 | — |

### 1.2 ~~`settings.json`~~（2026-09-27 废止）

原 `settings.json` 只承载一个字段 `target_runtime_form`（当前目标运行形态）。
运行形态概念整体下架后该文件不再存在，其唯一功能性用途（决定 MCP 连接地址取哪一份取值）
已由**单一 `url`** 取代。存量文件若存在则被忽略，不影响启动。
（2026-10-02 清理：仓库遗留的本地 `.platform-data/settings.json` 已删除——现役代码对它零引用，
删除后以 `tests/integration/platform.spec.ts` 的「settings → 404」用例复核无影响。）

> 部署接口所需的乐观锁版本改由部署清单端点（`contracts/admin-api.md` §6.8）提供。

---

## 2. 内置工具目录项（只读投影）

**来源**：`agent-backend` 的可枚举工具目录（`FR-011`，`plan.md` R1/R2）。**平台 MUST NOT 持久化一份副本**——`builtin-tools.json` 默认**不存在**，仅当运行环境目录暂不可读时才可能用于缓存（本期不实现缓存，故该文件不出现）。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | 非空，唯一 | 工具标识，如 `read_file` |
| `label` | string | ✅ | 非空 | 显示名，如 `读取文件` |
| `description_template` | string | ✅ | 非空；**含占位符** | 用途说明的**模板**（`FR-012`）。占位符形态见下 |
| `parameters` | object | ✅ | JSON Schema | 入参说明（`FR-011`、`FR-045` 同构） |
| `writable` | boolean | ✅ | — | 是否具备写能力（`FR-011`） |

**占位符约定**（`FR-012`，`plan.md` R1）：模板中与具体用户/会话相关的取值以 `{...}` 表示，至少包括：

| 占位符 | 含义 | 现状对照（`builtin-tools.ts`） |
|---|---|---|
| `{可用目录}` | 当前数字人可见目录清单（逗号分隔） | 现为运行期 `dirsText` 拼接 |
| `{示例路径}` | 取可用目录首项构造的示例路径 | 现为运行期 `examplePath` 拼接 |
| `{会话标识}` | 当前 run 的 thread_id | 现为运行期 `${threadId}` 拼接 |
| `{临时空间}` | 临时空间显示名 | 现为字面量 `临时空间` |

**校验规则**：平台在列表、选择器与预览中 MUST 保持**模板形态**呈现，MUST NOT 用某个具体用户/会话的取值替换（`FR-012`、`SC-014`）。模板中出现的具体用户目录名或会话标识数量 MUST 为 0。

**异常态**：数字人引用的工具名不在目录中 → 该数字人标记异常并指明失效工具名（`FR-013`），MUST NOT 允许其被保存或部署。

---

## 3. MCP 服务（平台持有）+ 工具清单（探测）

### 3.1 MCP 服务（平台持有，2026-09-27 重定义）

**来源**：**管理员在平台内新建与维护**（`FR-043`）——平台是 MCP 服务配置的**唯一权威源**，
MUST NOT 读取 `docker-compose.yml`、MUST NOT 读取 Docker 容器状态。

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `name` | string | 管理员填写 | 唯一标识；`^[A-Za-z0-9_-]{1,64}$`（会成为运行环境的工具前缀） |
| `description` | string | 管理员填写 | 用途描述（可为空串），供卡片展示 |
| `transport` | string | 管理员填写 | `http` / `stdio` |
| `url` | string \| null | 管理员填写 | **连接地址**（`http` 必填且须为 http(s) 绝对地址；`stdio` 恒为 `null`） |
| `tools` | array | MCP 客户端**探测** | `FR-045` 的工具清单（`[{name, description, parameters}]`）；不可得时以 `tools_error` 给出可读原因 |
| `references` | array | 引用推导 | 引用该服务的「用户 × 数字人」对（不落库） |

> 原 `status`（容器四态）与 `in_compose` 两个字段**已移除**：平台不再读容器运行态，
> "是否仍在编排声明中"的比对也失去前提（`FR-052` 的语义改为"引用的服务已被平台删除"）。

### 3.2 MCP 服务配置（服务级，平台持有）

**存放**：`platform-data/mcp-services.json`，按 `name` 索引。**同一服务只有一份**（`FR-044`）。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | **唯一**；`^[A-Za-z0-9_-]{1,64}$`（首尾空白自动去除） | 服务名（**新建时由管理员指定**，编辑时不可改）；同时是运行环境的工具前缀 |
| `description` | string | ✅ | 可为空串 | **用途描述**，供卡片展示（`FR-006`、`FR-043`） |
| `transport` | enum | ✅ | `http` \| `stdio`（**读写均接受别名 `streamable-http`**，入口归一为 `http`） | `http` 即 MCP 的 **Streamable HTTP** 传输；界面文案显示为 `streamable-http`，落盘与物化统一用规范值 `http`（2026-09-16） |
| `url` | string | 条件 | `transport=http` 时**必填**且须为 `http(s)://` 绝对地址；`stdio` 时恒为 `null`（丢弃） | **唯一连接地址**（2026-09-27：取消按运行形态分形态声明） |
| `command` / `args` | string / array | 可选 | `transport=stdio` 时必填 | 启动命令与参数 |
| `file_args` | object | ✅ | 可为空对象 | 文件参数映射：`{工具名: {取值路径: "url"}}`。取值路径可为顶层参数名（`{"ocr_image":{"image":"url"}}`），也可**穿过数组**（`{"parse_excel_files":{"items[].excelFileUrl":"url"}}`，`[]` 表示"每个元素"，2026-09-16） |
| `rules_fields` | object | ✅ | 形状 `{工具名: 字段名或对象路径}`，键非空、值为合法字段路径（点分对象路径，**不支持数组段**）；缺省/空对象 = 不启用 | **算法规则参数设置**（2026-09-19 新增；当日由 string 版 `rules_field` 升级为按工具映射；**2026-09-22 起值支持对象嵌套**）：声明该工具入参里承载 `array[object]` 规则清单的字段。声明后 HITL 参数确认窗中该字段旁出现「从算法规则选择」入口（嵌套路径的落点与写回见 `contracts/runtime-api-delta.md` §9.7）。**不改变是否走 HITL**（仍只由 `confirmation` 决定，管理端表单随 HITL 模式联动禁用/清空）；保存期非对象/值非法路径即 `VALIDATION_FAILED`（只校验语法、不校验工具 schema），历史存档的 string 版 `rules_field` 与**非法路径**读取时收敛/丢弃；物化进 `MCP.json` 的键同名，空对象不写 |

| `async_tools` | array | ✅ | 可为空数组；元素为**该服务自己的原始工具名**（不含 `{server}__` 前缀），非空且同服务内去重 | **异步工具声明**（2026-09-25 新增）：声明后，该工具调用由运行环境注入 `resultUrl`（签名写直链），服务算完把结果回写到用户空间 `临时空间/后台产出/`；落盘即经 SSE 通知前端，并在下一轮对话注入「后台计算结果」清单（全文见 `contracts/runtime-api-delta.md` §10）。**不改变工具是否同步、也不改变是否走 HITL**——只是给被声明的工具多注入一个回写地址。保存期只校验语法（数组 / 非空 / 去重，否则 `VALIDATION_FAILED`），**不校验工具清单**（工具清单是探测结果，服务不可达时拒保存会把"服务抖动"变成"配置改不了"，与 `rules_fields` 同一取向）；物化进 `MCP.json` 的键同名、**空数组不写**；缺省/空 = 不启用，存量行为零变化 |
| `allowed_tools` | array | ✅ | **新建必填且非空**（trim + 同服务内去重）；保存（`PUT`）**禁止携带**；缺省 = `[]`（存量记录） | **工具白名单**（2026-10-03）：该服务**可见**的原始工具名清单。语义三点：①**空数组 = 不限制**（白名单上线前的存量记录，物化时不写该字段）；②平台详情只呈现白名单里的工具（`tools`），缺失项进 `missing_tools` 供界面标异常；③运行环境装配时按它过滤工具表（**清单外的工具对模型不可见**，见 `contracts/runtime-api-delta.md` §11）。**创建后不可修改**：新建漏传/空数组即 `VALIDATION_FAILED`、`PUT` 携带即 `ADM_MCP_TOOL_SCOPE_LOCKED`（否则"以为限住了实际没限"） |

| `headers` | object | ✅ | 可为空对象；形状 `{头名: 值}`：头名须为合法 HTTP 头名（RFC 7230 token，两端空白 trim、**大小写不敏感下不重复**），值为**单行非空字符串**（trim），**MUST NOT 是掩码形态**；`transport=stdio` 时恒为 `{}`（丢弃）；**缺省 = 沿用存量**，提供 = 全量替换（`{}` 即清空） | **请求头 / 访问令牌**（2026-10-08）：部分 MCP 服务（本体侧「自建发布」的动态容器）要求调用方带 `X-MCP-Token`，**缺了直接 401**——服务本身是好的，只看得到"连不上"。三条纪律：①**存明文**（服务要按原样发送），信任边界与 `agent-backend/.env.local` 同级；②**响应只回掩码**（`maskHeaders`，形如 `6UuE…F3Z`；列表只给 `has_headers` 布尔量），MUST NOT 把掩码提交回来做连接或保存（保存期直接拒）；③**可改**（令牌会轮换，区别于白名单的"创建后不可改"），但"不携带"必须沿用存量——保存调用配置 MUST NOT 顺手清空令牌。物化进 `MCP.json` 的键同名、**空对象不写**（见 `contracts/runtime-api-delta.md` §12） |

> **2026-09-15 变更**：`writable` / `permission_scope` 已从本实体移除（产品决定）；读取历史存档时 MUST 收敛掉这两个字段。

**校验规则**：
1. `transport=http` 时 `url` MUST 为非空且以 `http(s)://` 开头，否则 `VALIDATION_FAILED`；`stdio` 时 `command` MUST 非空。
2. **唯一性**：新建时 `name` 已存在 → `ADM_MCP_SERVICE_EXISTS`（409）；`PUT` 保存不存在的服务 → `ADM_MCP_SERVICE_NOT_FOUND`（404，新建必须走 `POST`）。
3. 数字人所引用的服务若已被删除（或改名）→ 该引用判定为**失效**（`FR-052`）：保存时拦截（`ADM_AGENT_INVALID_REF`），部署前校验与全局异常项汇总均列出。
4. **存量迁移**：旧文档里的 `endpoints`（`{运行形态: 地址}`）在**读取期**收敛为单一 `url`（优先取 `host_local`，否则取第一个非空值），既有配置不丢。
4. 修改调用配置 MUST 自动作用于所有引用它的数字人（`FR-044`），无需逐个改动。
5. `async_tools` 只校验**语法**（数组、元素非空、去重），MUST NOT 因"该工具名不在当前探测到的工具清单里"而拒绝保存——工具清单是探测结果，服务不可达时不构成配置错误（与 `rules_fields` 同一取向）。
6. **`allowed_tools`（工具白名单，2026-10-03）**：**新建必填且非空**（漏传/空数组 → `VALIDATION_FAILED`）；`PUT` **携带即拒**（`ADM_MCP_TOOL_SCOPE_LOCKED`）——它是"创建时定、之后不可改"的边界设置，静默忽略会让客户端以为改成功了。同 `async_tools`：只校验语法，**不校验名字是否存在于当前清单**（名字漂移由详情页的 `missing_tools` 核对呈现）。平台详情只呈现白名单里的工具；运行环境只把白名单里的工具挂给数字人。
7. **`headers`（请求头，2026-10-08）**：逐项判据见上表（头名合法且不重复、值为单行非空、非掩码），违反即 `VALIDATION_FAILED`；`PUT` **不携带即沿用存量**、携带即全量替换（`{}` 清空）；`stdio` 丢弃。**新建/保存响应与详情只回掩码**，明文不进任何响应。

**引用关系**：数字人经 `MCP.json` 的 `servers[].name` 按名称引用；引用关系**不落库**（规格关键实体「引用关系」），按需从数字人设计态推导。

### 3.3 MCP 调用统计（只读投影）

**来源**：`agent-backend` 的只读端点（`plan.md` R4，`research.md` D6）。**口径为 MCP 工具调用次数**。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 服务名 |
| `calls_total` | integer | 调用次数（= `calls_ok + calls_failed`）；**2026-09-23 起口径为最近一年** |
| `calls_ok` | integer | 成功次数（同"最近一年"口径） |
| `calls_failed` | integer | 失败次数（同"最近一年"口径） |
| `last_called_at` | string \| null | 最近调用时间（ISO8601） |

> **2026-09-23**：`calls_*` 口径收紧为**最近一年**——运行环境侧独立累计表 `mcp_call_stats` 已删除，累计值改由"只保留一年"的事件明细 `mcp_call_events` 聚合。平台统计表所需的**四个时间窗**位于**分组行 `groups[]`**（一行 = 一个「服务 × 工具 × 用户」组合）；十四次调整的 `users[]` 与本日的 `tools[]` 两层明细已被它取代（两者都不带时间窗，无法表达统计表所需的列）。完整字段与口径见 `contracts/runtime-api-delta.md` §4.2 / §4.3。

**校验规则**：统计 MUST 在数字人实际调用后**自动更新**（`FR-050`），MUST NOT 依赖人工录入。运行环境不可达时，统计字段整体为"未知"，**不得**以 0 冒充（`FR-009` 可读原因）。

---

## 4. SKILL（平台共享技能库）

**存放**：`platform-data/skills/index.json`（元数据索引）+ `platform-data/skills/{name}/`（正文与附件）。

**全平台共享，是 SKILL 的唯一权威来源**（`FR-036`）：一个 SKILL 可被任意数量的数字人以名称引用，MUST NOT 为每个数字人各存一份。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | 非空；**可作目录名**：不含路径分隔符、`..`、控制字符 | 来自 `SKILL.md` 元数据块（`FR-038`） |
| `description` | string | ✅ | 非空 | 来自元数据块（`FR-038`）；改 `SKILL.md` 正文时**重新解析并同步** |
| `content` | string | ✅ | 可为空正文 | `SKILL.md` 全文（`FR-036` 要求可查看与编辑） |
| `files` | array | ✅ | — | 附件清单（相对路径 + 大小），供展示；在线编辑后同步该项大小 |
| `source` | string | ✅ | — | 安装来源（上传的包名；本体市场导入为 `onto_market:{场景}/{本体}`，见契约 §4.6）；在线编辑**不改写来源**，只更新 `updated_at` |
| `origin` | object | 可选 | — | 本体市场导入的溯源（2026-10-02）：`{ kind: 'onto_market', scenario, ontology, hash }`；缺省 = 外部安装（ZIP 上传等）。`hash` 为导入时的**整包内容指纹**，与市场现算哈希比对即知"市场文件是否变化"（契约 §4.6） |
| `installed_at` / `updated_at` | string | ✅ | ISO8601 | 任一文件在线保存都会刷新 `updated_at` |

**在线编辑（2026-09-16）**：`SKILL.md` 与 `references/` 等附件**全部可编辑**（`PUT /api/admin/skills/{name}/file`，契约 §4.3.1）。三条硬约束：①可编辑 ⇔ **文本且 ≤ 256KB**（只显示了一部分就不许改写，避免保存即丢内容）；②并发保护用**文件内容哈希**而不是全局 `revision`（编辑只影响一个文件）；③**保存即覆盖、平台不保留任何副本**（"编辑快照"已按 2026-09-16 产品决定移除）——因此界面 MUST 在保存前二次确认并讲明"无法恢复"（`SkillFileEditor.vue`）。

**编辑的生效范围**：只改**库里这一份**。数字人目录里的副本由部署写入（`FR-026`），因此**必须重新部署**才会更新——这是"库是唯一权威来源"的直接推论，界面 MUST 在保存后明确提示。

**安装校验（`FR-038` 格式 + `FR-039` 安全）**——两条校验都必须**在写入目标目录之前**完成：

| # | 校验项 | 失败错误码 |
|---|---|---|
| 1 | 压缩包可正常解压 | `SKILL_ARCHIVE_INVALID` |
| 2 | 必须存在根级或单层目录下的 `SKILL.md` | `SKILL_ARCHIVE_INVALID` |
| 3 | `SKILL.md` 含元数据块，且 `name` / `description` 非空 | `SKILL_ARCHIVE_INVALID` |
| 4 | `name` 合法可作目录名 | `VALIDATION_FAILED` |
| 5 | 拒绝绝对路径、`..` 穿越、符号链接（`externalFileAttributes` 符号链接位） | `SKILL_ARCHIVE_UNSAFE` |
| 6 | 解压后总大小 / 文件数 / 嵌套层级未超限 | `SKILL_ARCHIVE_UNSAFE` |
| 7 | 拒绝 ZIP64 之外的畸形条目与重复条目名 | `SKILL_ARCHIVE_UNSAFE` |

**状态流转**：`未安装 → 校验中 → (校验失败：无残留) | (校验通过 → 原子入驻库中)`；`名称冲突 → 等待管理员显式选择「覆盖」或「取消」`（`FR-040`）。**失败 MUST 回滚，MUST NOT 留下半解压残留**（`FR-041`）。

**本体市场导入（2026-10-02）**：安装来源新增**本体市场**（optonto `.data/onto_market`，平台**只读**扫描）。市场侧 SKILL.md 与库内**同一格式**；导入按 `{场景}/{本体}/skills/{技能目录}` **整包目录复制**（不走 ZIP），校验与原子入驻与 ZIP 安装同链路，`source` 记为 `onto_market:{场景}/{本体}`、`origin.hash` 记整包内容指纹。**重名直接拒绝**（不提供覆盖）——市场后续更新不会自动同步：如需更新，先删除库内同名技能再重新导入；"市场文件是否变化"由 `origin.hash` 与市场现算哈希比对判定（契约 §4.6/§4.7）。

**删除**：删除被引用的 SKILL 时，确认环节 MUST 列出受影响的数字人清单并要求二次确认（`FR-042`）；该清单 MUST 与数字人配置中的 SKILL 搭配一致。平台 MUST NOT 为此维护常驻的"被谁引用"浏览视图。

---

## 5. 数字人（设计态）

**存放**：`platform-data/agents/{name}.json`。**设计产物是一个结构化 JSON**（`FR-018`），五类配置齐全。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | 非空，**唯一**；不含路径分隔符、`..`、控制字符 | `FR-015`。冲突或非法 → `AGENT_NAME_TAKEN` / `VALIDATION_FAILED` |
| `soul` | string | ✅ | **非空** | SOUL 全文（`FR-019`）。原样保存与回显（含换行与标点，`FR-017`） |
| `enabled_tools` | string[] | ✅ | 可为空数组；每项 MUST 在内置工具目录中 | 未配置以空集合表示，MUST NOT 缺字段（`FR-018`）。引自目录（`FR-004`）；清单外引用 → 保存/部署被拒（`FR-019`） |
| `mcp_services` | `{name}[]` | ✅ | 可为空数组；每项 MUST 在 MCP 服务清单中 | **以名称引用**，MUST NOT 内嵌连接信息（`FR-018`） |
| `skills` | `{name}[]` | ✅ | 可为空数组；每项 MUST 在 SKILL 库中 | **以名称引用**，MUST NOT 内嵌技能正文（`FR-018`） |
| `scenario` | object | ✅ | — | 文件空间搭配（`FR-020`） |
| `scenario.scenario` | string | ✅ | 非空 | 场景名 |
| `scenario.data_prep_dirs` | string[] | ✅ | 每项拒绝空值、重复值、含路径分隔符或 `..`；**MUST 完整包含预定义目录 `算法规则`**（2026-09-19 新增：平台硬编码、不可移除） | "数据准备"二级目录清单 |
| `scenario.data_prep_fields` | object | ➖ | 键 MUST 在 `data_prep_dirs` 内；值为数组，每项 `{name, type, required}` | **上传表字段约束**（2026-09-17 新增）：目录名 → 字段清单。空清单的目录**不出现**（缺失即"无约束"）；缺省按 `{}` 处理（兼容本字段引入前的文档与请求） |
| `scenario.data_prep_fields[dir][].name` | string | ✅ | 非空、≤64 字符、不含路径分隔符 / `..`、**同目录内唯一** | 字段名＝上传表的表头名 |
| `scenario.data_prep_fields[dir][].type` | string | ✅ | ∈ `string` / `integer` / `number` / `boolean` / `object` / `array` | JSON Schema 基本类型的子集（与运行环境同一枚举） |
| `scenario.data_prep_fields[dir][].required` | boolean | ✅ | MUST 显式为布尔 | `true` = 上传表的表头 MUST 含该字段；`false` = 可选（出现则类型仍须匹配）。不给隐式默认 |
| `updated_at` | string | ✅ | ISO8601 | — |

每个目录的字段数上限：**50**（`MAX_FIELDS_PER_DIR`，防滥用）。

**校验规则**（保存时）：
1. `soul` 非空（`FR-019`）。
2. `enabled_tools` / `mcp_services` / `skills` 三类**只能从平台统一清单中选择**，MUST NOT 接受清单外的不存在引用（`FR-019`）。
3. 引用的内置工具已下线 → 标记异常并指明失效工具名，**保存与部署均 MUT 被拒**（`FR-013`）。
4. 名称冲突或非法 → 拒绝并说明原因（`FR-015`）。
5. 场景：场景名非空且合法；目录清单拒绝空值 / 重复 / 含分隔符 / `..`；字段约束须满足上表约束（**孤儿键**——引用了目录清单外的目录——即拒，不是可忽略的冗余）。
6. 保存后 MUST 能**原样回显**，含换行、标点与条目顺序（`FR-017`）。

> **实现落点**：场景（含字段约束）的判据集中在 `admin-backend/src/domain/config-center/scenario.ts`，名称安全判据在 `naming.ts`（`agent-design.ts` 因 500 行门禁拆分）。保存路径抛首条错误，部署前校验（`deploy/precheck.ts`）经 `scenarioFieldIssues()` **收集全部**问题。

**状态流转**：

```text
（新建）→ 设计态已保存 ──┬─→ 已部署（与部署清单一致）
                        └─→ 已修改未部署（合法状态，规格假设）

任一时刻可进入「异常态」：引用了失效对象（已下线工具 / 编排中已移除或改名的 MCP 服务 / 已不存在的 SKILL）
  └─ 异常态 MUST 可见（卡片异常态 + 全局异常项汇总），MUST NOT 被静默忽略或部署
```

**删除**：被用户关联时 MUST 阻止直接删除，或要求先显式解除关联（`FR-021`，`AGENT_IN_USE`）；未被关联时可删且需二次确认（`FR-022`）。

---

## 6. 用户与关联关系

**存放**：`platform-data/users/{user-id}.json`。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `user_id` | string | ✅ | 非空，唯一；不含路径分隔符、`..` | 对应 `.opt-agent/users/{uid}/`；非法或重复 → `USER_ID_TAKEN` / `VALIDATION_FAILED`（`FR-024`） |
| `agents` | string[] | ✅ | 可为空数组；每项 MUST 是平台内已存在的数字人 | 关联关系（`FR-025`） |

**校验规则**：可关联的 MUST 是平台内已存在的数字人（`FR-025`）；删除仍被部署的用户属引用冲突，须提示并要求二次确认（边缘情况「引用冲突」）。

**注意**：本实体是**平台的业务使用者**（如 `admin`），与平台操作者 `zyw_admin` 是**两个不同概念**，MUST NOT 混用（`research.md` D11、规格假设）。

---

## 7. 部署相关实体

### 7.1 部署清单（`platform-data/deploy/manifest.json`）

界定部署时**允许删除**的范围（`FR-031`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `entries` | array | 每条：`{ user_id, agent_names: string[], last_deployed_at }` |

**规则**：只有"**在清单内且本次不再需要**"的数字人才允许从运行环境移除；**清单之外的内容 MUST NOT 被删除或改写**（`FR-031`、边缘情况「非本平台管辖的内容」）。

### 7.2 部署前校验结果（不持久化，随请求返回）

点击"部署生效"时、**任何写入发生之前**执行，**只读**（`FR-027`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `passed` | boolean | 整体是否通过 |
| `errors` | array | 全部错误项（**一次性列出，不是发现一个就停**）。每条：`{ user_id, agent_name, category, code, message, detail }` |
| `category` | enum | `config_integrity` \| `reference_validity` \| `name_path_safety` \| `target_writable`（四类；**2026-09-27** 原第五类 `runtime_form` 随运行形态下架） |

**校验项**（`FR-027`）：

| # | 类别 | 内容 |
|---|---|---|
| ① | `config_integrity` | SOUL 非空；四类配置文件结构合法且可解析；五类配置无缺字段 |
| ② | `reference_validity` | 引用的内置工具存在于工具目录；引用的 MCP 服务存在于**平台 MCP 服务列表**；引用的 SKILL 存在于共享技能库 |
| ③ | `name_path_safety` | 数字人名、用户标识、技能目录名不含路径分隔符或 `..` |
| ④ | `target_writable` | 目标位置可写 |

**失败处理**：任一不通过 → **阻止本次部署**、**MUST NOT 产生任何写入**、一次性列出全部错误项，每条可定位到具体的用户、数字人与配置类别（`FR-027`、`SC-020`）。校验所需信息读取不到时 MUST **按校验失败处理**，MUST NOT 视为通过（边缘情况「校验所需信息读取不到」）。

### 7.3 部署记录（`platform-data/deploy/history.jsonl`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `deployed_at` | string | ISO8601（`FR-033`） |
| `operator` | string | 固定 `zyw_admin`（`research.md` D11） |
| `users` | array | 每个用户：成功/失败、涉及数字人、失败原因 |
| `validation` | object | 校验结果摘要（含错误项数） |
| `manifest_diff` | array | 与部署清单不一致的差异（如手工删改过的目录，`FR-032`） |

### 7.4 部署执行语义

| 语义 | 要求 | 来源 |
|---|---|---|
| 单向、整体覆盖 | 平台侧为唯一内容来源，不做合并/协商/字段级保留；平台侧未搭配的内容 MUST NOT 残留 | `FR-026`、`SC-018` |
| 作用域 | 限于 `users/{uid}/agents/{agent}/`（含五类配置）；文件空间**内容**一律不触碰 | `FR-028`、`SC-012` |
| 最小单位 | 单用户失败即该用户零写入，其余用户不受影响 | `FR-029`、`SC-004` |
| 幂等 | 相同内容重复部署结果稳定 | `FR-030` |
| 原子性 | 临时目录构建 → 校验 → **目录级原子改名**；失败丢弃 | `FR-008`、`research.md` D8 |
| 生效时机 | 新对话立即生效；进行中的回答不中断，完成当前轮次后切换 | `FR-034` |

---

## 8. 物化产物（`.opt-agent/` 落盘格式）

一次部署后，每个数字人目录的内容如下。**这四个文件 + 技能目录的格式 MUST 与运行环境既有读取口径完全一致**（`agent-backend/src/domain/agent-instance.ts` / `dirs.ts`）。

```text
.opt-agent/users/{uid}/agents/{agent}/
├── SOUL.md          ← 数字人 soul 全文（纯 Markdown 文本）
├── TOOL.json        ← { "enabled": ["read_file", ...] }
├── MCP.json         ← { "servers": [ { name, transport, url|command, file_args } ] }
├── scenario.json    ← { "scenario": "…", "data_prep_dirs": ["…"], "data_prep_fields": { … } }
└── skills/{name}/SKILL.md
```

**字段映射（设计态 → 物化）**：

| 设计态 | 物化产物 | 规则 |
|---|---|---|
| `soul` | `SOUL.md` | 原样写入（utf8，保留换行与标点） |
| `enabled_tools` | `TOOL.json` 的 `enabled` | 原样写入；未配置写 `[]` |
| `mcp_services[].name` | `MCP.json` 的 `servers[]` | **只写 `name`**；`transport` / `url` / `headers` / `file_args` / `confirmation` / `rules_fields` / `async_tools` / `allowed_tools` 取自**调用配置**（`FR-044`、`SC-011`），`url` 直接取调用配置的**唯一 `url`**（2026-09-27：不再有运行形态维度）；非空才写的键：`args` / `headers` / `file_args` / `confirmation`(≠never) / `rules_fields` / `async_tools` / `allowed_tools`。**`headers` 是唯一的"明文凭据"出平台通道**（`FR-064`）：平台响应只回掩码，物化写原文 |
| `skills[].name` | `skills/{name}/SKILL.md` | 从共享技能库**物化**一份副本（`FR-026`）；下次部署按库中版本覆盖 |
| `scenario` | `scenario.json` | 原样写入；`data_prep_dirs` 与各目录的字段条目均**保持顺序**；`data_prep_fields` **仅在非空时写入**（无约束的目录不出现键）——"缺失"与"空对象"对运行环境同义（该目录无约束），故不留空壳（`FR-026`、`SC-018`） |

**已实现示例（现状对照）**：`.opt-agent/users/admin/agents/demo/` 下即为本格式的真实样例（`TOOL.json` / `MCP.json` / `scenario.json` / `SOUL.md` 四件套齐全，`MCP.json` 中 `servers[0].url` 即平台侧调用配置里登记的唯一连接地址）。

---

## 9. 本体（本体库，2026-10-03）

**存放**：`platform-data/onto_market/index.json`（索引）+ `platform-data/onto_market/{场景}/{本体}/` 下的 **`ontology.yaml`（必需）与 `securities.yaml`（可选）**。

**来源**：本体市场（optonto `.data/onto_market`，平台**只读**）中每个 `{场景}/{本体}/` 目录下的同名文件——`ontology.yaml`（本体正文与 6 项 metadata）+ `securities.yaml`（行为安全管控：`confirm` 需人工确认 / `confirm_content` 弹窗文案 / `scope` 权限范围，2026-10-03 扩展）。其余一律不导入：`data_engines.yaml`、`meta.json`、`functions/`、`ontology_versions/`、`skills/`（`FR-060`）。

**身份**：`scenario`（一级目录名）+ `ontology_dir`（二级目录名）的组合；同一目录名可以存在于不同场景。存储路径与市场保持一致，便于人工对照。

### 9.1 索引条目（`index.json` 的 `items[]`）

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `scenario` | string | ✅ | 单个路径段（≤128 字符，不含分隔符/`..`/控制字符；**允许中文与全角括号**） | 市场一级目录名 |
| `ontology_dir` | string | ✅ | 同上 | 市场二级目录名；本体身份的稳定部分 |
| `name` | string | ✅ | 非空 | 展示名：`metadata.ontology_name`，缺失时兜底为 `ontology_dir` |
| `metadata` | object | ✅ | 6 个键，缺项为 `null` | `created_at` / `deployed_version` / `scenario_name` / `scenario_id` / `ontology_name` / `ontology_id` |
| `source` | string | ✅ | 恒为 `onto_market:{场景}` | 来源标记（本体只能从市场来） |
| `hash` | string | ✅ | sha256 hex | 导入时 `ontology.yaml` 的内容指纹（"市场是否变化"的判据之一） |
| `securities_hash` | string \| null | ✅ | sha256 hex 或 `null` | 导入时 `securities.yaml` 的内容指纹；该本体未配置安全管控时为 `null`（判据之二） |
| `installed_at` | string | ✅ | ISO8601 | 首次导入时间（**更新不改**） |
| `updated_at` | string | ✅ | ISO8601 | 最近一次导入/更新时间 |

### 9.2 关键约束

- **只读**：平台 MUST NOT 提供任何编辑本体文件的端点（`FR-059`）；唯一写入口是"从本体市场导入/更新"，写入的是市场快照。`securities.yaml` 同理——**平台不解析其语义**（原样存取与展示），安全管控的执行仍在本体侧/运行环境。
- **变化检测**：`hash`（sha256 of `ontology.yaml`）与 `securities_hash`（sha256 of `securities.yaml`，`null` 表示无该文件）**都与市场现算值一致**才算 `unchanged`，任一不同（含市场新增/移除安全管控）即 `changed`；`ontology.yaml` 无效或缺失/超限 → `invalid`（原因可读，单条失效不影响其它条目）。
- **存量记录**：扩展前导入的记录没有 `securities_hash`，读取时归一为 `null`——若市场有 `securities.yaml` 则自然判为 `changed`，一次更新即补齐（MUST NOT 因缺字段报错）。
- **原子性**：每个文件独立走 `PlatformStore.writeText`（临时文件 → `fsync` → `rename`）；写入顺序为**先文件、后索引**，中途中断只表现为"导入未生效"，不会产生"卡片在、文件缺"的幽灵条目。市场侧移除安全管控时，更新会显式清除库内副本（`PlatformStore.remove`）。
- **一致性**：`listAll()` 以索引为准并按目录实际存在过滤（与技能库同一口径）。
- **上限**：单个文件 ≤ 16MB（全项目单文件口径；实测 `ontology.yaml` 约 30KB、`securities.yaml` 约 1.5KB）。
- **不参与引用**：本体**不被数字人引用**（本期范围），故删除无需引用清单（区别于 SKILL 的 `FR-042`）。

---

## 10. SKILL 与本体库的只读口径（2026-10-03）

| 来源 | 记录标记 | 在线编辑 | 内容变更方式 |
|---|---|---|---|
| 本体市场导入（`§4.6~§4.8`） | `origin.kind = "onto_market"` | **禁止**（`ADM_SKILL_READ_ONLY`，界面不渲染编辑入口） | 只能在「从本体市场导入」窗口执行**更新**（以市场现版本整包替换，`FR-060`） |
| ZIP 上传安装（`§4.4`）／平台侧其它来源 | 无 `origin` | 允许（文本且 ≤256KB，乐观锁 `base_hash`） | 在线编辑，或重新上传 ZIP 覆盖 |

本体库（`§9`）整体只读：平台不提供任何编辑本体文件的端点，写入口只有"从本体市场导入/更新"。

---

## 11. 实体关系图

```text
                 ┌────────────────────┐
                 │  运行环境（只读投影） │
                 │  内置工具目录        │
                 │  调用统计            │
                 └──────┬─────────────┘
                        │ 只读消费（平台 MUST NOT 反写）
                        ▼
   ┌──────────────────────────────────────────────┐
   │            平台设计态（唯一权威源）             │
   │                                              │
   │  MCP 服务配置 ──┐                             │
   │  SKILL ─────────┼── 被引用（名称引用，不落库）─┐ │
   │  内置工具目录项 ─┘                             │ │
   │                                                ▼ │
   │   用户 ──关联──► 数字人 ──五类配置──► 设计产物 JSON │
   └────────────────────┬─────────────────────────┘
                        │ 部署生效：预校验 → 整体覆盖物化
                        ▼
   ┌──────────────────────────────────────────────┐
   │  物化产物 .opt-agent/users/{uid}/agents/{a}/  │
   │  SOUL.md / TOOL.json / MCP.json /             │
   │  scenario.json / skills/{name}/SKILL.md       │
   │  （部署清单记录平台分发过的范围）               │
   └──────────────────────────────────────────────┘
                        │
              （文件空间 data 内容一律不触碰）
```

**引用关系（派生，非实体）**：数字人对 MCP 服务、内置工具、SKILL 的引用由平台**按需从数字人设计态推导**，MUST NOT 作为独立实体持久化，MUST NOT 表现为常驻浏览视图；呈现时机**仅限**破坏性操作的确认环节、部署前校验与全局异常项汇总（规格关键实体「引用关系」）。
