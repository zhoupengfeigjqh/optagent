# 数据模型：数字人管理平台（Phase 1）

**特性**：`001-digital-human-platform` | **日期**：2026-09-15 | **上游**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)

本文件定义**平台设计态**（平台自己的数据）、**物化产物**（写入 `.opt-agent/` 的运行态形态）与**只读投影**（从运行环境读取的数据）三类数据的结构、字段、校验规则与状态流转。字段名一律用下划线命名（与既有 `MCP.json` / `scenario.json` / 既有接口保持同一口径，降低契约映射成本）。

---

## 0. 三类数据的边界

| 类别 | 存放位置 | 平台权限 | 一对一约束 |
|---|---|---|---|
| **设计态** | `platform-data/`（bind mount） | 读写（平台的唯一权威源） | 平台自身数据，**不与运行环境共享**（`FR-001` 只要求共享**用户数据**目录） |
| **物化产物** | `.opt-agent/users/{uid}/agents/{agent}/` | 部署时**整体覆盖**写入 | 平台是内容来源，运行环境是消费方（`FR-026`） |
| **只读投影** | 容器编排文件、Docker Engine、`agent-backend` 只读端点 | **只读** | 平台 MUST NOT 反写（`FR-005`） |

**判据（与 `FR-028` 同一口径）**：平台在 `.opt-agent/` 产生的写入 **100% 限于** `users/{uid}/agents/{agent}/` 之内；用户文件空间（`数据准备` / `共享空间` / `临时空间`）下的文件与二级目录**一律不触碰**。

---

## 1. 平台设计态：`platform-data/` 布局

```text
platform-data/
├── meta.json                 # 平台元数据（含单调递增 revision，用于并发检测）
├── settings.json             # 平台级设置（当前目标运行形态）
├── builtin-tools.json        # 内置工具的本地覆盖（默认空；见 §2 说明）
├── mcp-services.json         # MCP 调用配置（按名称索引）
├── skills/
│   ├── index.json            # SKILL 库索引（元数据）
│   └── {skill-name}/         # SKILL 正文与附件（与库中 SKILL 一一对应）
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

### 1.2 `settings.json`

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `target_runtime_form` | string | ✅ | 必须是**已声明的运行形态标识**之一 | 当前目标运行形态（`FR-057`）。默认 `container_network` |

**运行形态标识（本期固定两种）**：

| 标识 | 中文名 | 连接地址形态 |
|---|---|---|
| `container_network` | 容器编排内网 | 容器服务名，如 `http://ocr:8000/mcp` |
| `host_local` | 宿主机本地 | 宿主机可达地址，如 `http://127.0.0.1:8000/mcp` |

**校验规则**：`target_runtime_form` MUST 为上述枚举之一（`VALIDATION_FAILED`）。切换它属于破坏性操作，MUST 提示"既有部署产物将按新形态重新物化"并要求二次确认（`FR-057`、`FR-007`）；切换本身**不写入** `.opt-agent/`，须由随后的"部署生效"落地。

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

## 3. MCP 服务（本体，只读投影）+ MCP 服务配置（服务级，平台持有）

### 3.1 MCP 服务本体（只读）

**来源**：根目录 `docker-compose.yml` 中声明的服务（`FR-043`）+ Docker Engine 的实际状态。**平台 MUST NOT 要求二次登记**，新增服务后 MUST 无需改代码即可识别。

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `name` | string | compose 服务名 | 唯一标识 |
| `transport` | string | 调用配置 | `http` / `stdio` |
| `status` | enum | Docker Engine | `running` / `stopped` / `abnormal` / `unknown`（`FR-043`） |
| `in_compose` | boolean | compose 声明 | 为 `false` 表示调用配置指向的目标已不存在或改名（`FR-052`） |
| `tools` | array | MCP 客户端 | `FR-045` 的工具清单（`[{name, description, parameters}]`） |

### 3.2 MCP 服务配置（服务级，平台持有）

**存放**：`platform-data/mcp-services.json`，按 `name` 索引。**同一服务只有一份**（`FR-044`）。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | 非空，唯一 | 与 compose 服务名对齐 |
| `description` | string | ✅ | 可为空串 | **用途描述**，供卡片展示（`FR-006`、`FR-043`） |
| `transport` | enum | ✅ | `http` \| `stdio`（**读写均接受别名 `streamable-http`**，入口归一为 `http`） | `http` 即 MCP 的 **Streamable HTTP** 传输；界面文案显示为 `streamable-http`，落盘与物化统一用规范值 `http`（2026-09-16） |
| `endpoints` | object | ✅ | **至少一个键** | **按运行形态分别声明的连接地址**（`FR-056`）。键为运行形态标识，值为地址 |
| `endpoints.container_network` | string | 建议必填 | 合法 URL 或 `host:port` | 容器编排内网地址 |
| `endpoints.host_local` | string | 可选 | 合法地址 | 宿主机本地地址 |
| `command` / `args` | string / array | 可选 | `transport=stdio` 时必填 | 启动命令与参数 |
| `file_args` | object | ✅ | 可为空对象 | 文件参数映射：`{工具名: {取值路径: "url"}}`。取值路径可为顶层参数名（`{"ocr_image":{"image":"url"}}`），也可**穿过数组**（`{"parse_excel_files":{"items[].excelFileUrl":"url"}}`，`[]` 表示"每个元素"，2026-09-16） |
| `rules_fields` | object | ✅ | 形状 `{工具名: 字段名}`，键值均非空串；缺省/空对象 = 不启用 | **算法规则参数设置**（2026-09-19 新增；当日由 string 版 `rules_field` 升级为按工具映射）：声明该工具入参里承载 `array[object]` 规则清单的字段。声明后 HITL 参数确认窗中该字段旁出现「从算法规则选择」入口（详见 `contracts/runtime-api-delta.md` §9.7）。**不改变是否走 HITL**（仍只由 `confirmation` 决定，管理端表单随 HITL 模式联动禁用/清空）；保存期非对象/值非非空串即 `VALIDATION_FAILED`，历史存档的 string 版 `rules_field` 读取时收敛为 `{}`；物化进 `MCP.json` 的键同名，空对象不写 |

> **2026-09-15 变更**：`writable` / `permission_scope` 已从本实体移除（产品决定）；读取历史存档时 MUST 收敛掉这两个字段。

**校验规则**：
1. `endpoints` MUST 至少含一个运行形态键，否则 `VALIDATION_FAILED`（`FR-056`）。
2. **部署物化时**：目标运行形态的键 MUST 存在；缺失即**部署前校验不通过**（`RUNTIME_FORM_NOT_CONFIGURED`），MUST NOT 回退到另一形态的地址（`FR-057`、边缘情况「MCP 连接地址与部署目标运行形态不匹配」）。
3. `name` 在 compose 中不存在或已改名 → 该配置标记 `in_compose: false` 为异常态，并给出具体差异（`FR-052`）；引用它的数字人 MUST 被部署前校验拦截。
4. 修改调用配置 MUST 自动作用于所有引用它的数字人（`FR-044`），无需逐个改动。

**引用关系**：数字人经 `MCP.json` 的 `servers[].name` 按名称引用；引用关系**不落库**（规格关键实体「引用关系」），按需从数字人设计态推导。

### 3.3 MCP 调用统计（只读投影）

**来源**：`agent-backend` 的只读端点（`plan.md` R4，`research.md` D6）。**口径为 MCP 工具调用次数**。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 服务名 |
| `calls_total` | integer | 累计调用次数 |
| `calls_ok` | integer | 成功次数 |
| `calls_failed` | integer | 失败次数 |
| `last_called_at` | string \| null | 最近调用时间（ISO8601） |

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
| `source` | string | ✅ | — | 安装来源（上传的包名）；在线编辑**不改写来源**，只更新 `updated_at` |
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
| `category` | enum | `config_integrity` \| `reference_validity` \| `name_path_safety` \| `target_writable` \| `runtime_form` |

**校验项**（`FR-027` + `FR-057` 追加第 ⑤ 项）：

| # | 类别 | 内容 |
|---|---|---|
| ① | `config_integrity` | SOUL 非空；四类配置文件结构合法且可解析；五类配置无缺字段 |
| ② | `reference_validity` | 引用的内置工具存在于工具目录；引用的 MCP 服务存在于容器编排声明；引用的 SKILL 存在于共享技能库 |
| ③ | `name_path_safety` | 数字人名、用户标识、技能目录名不含路径分隔符或 `..` |
| ④ | `target_writable` | 目标位置可写 |
| ⑤ | **`runtime_form`** | 每个被引用 MCP 服务在**目标运行形态**下都有连接地址（`FR-056`/`FR-057`） |

**失败处理**：任一不通过 → **阻止本次部署**、**MUST NOT 产生任何写入**、一次性列出全部错误项，每条可定位到具体的用户、数字人与配置类别（`FR-027`、`SC-020`）。校验所需信息读取不到时 MUST **按校验失败处理**，MUST NOT 视为通过（边缘情况「校验所需信息读取不到」）。

### 7.3 部署记录（`platform-data/deploy/history.jsonl`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `deployed_at` | string | ISO8601（`FR-033`） |
| `operator` | string | 固定 `zyw_admin`（`research.md` D11） |
| `target_runtime_form` | string | 本次部署所用的目标运行形态（`FR-057`） |
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
| `mcp_services[].name` | `MCP.json` 的 `servers[]` | **只写 `name`**；`transport` / `url` / `file_args` 取自**调用配置**（`FR-044`、`SC-011`），`url` 按**目标运行形态**取 `endpoints[target_runtime_form]`（`FR-056`） |
| `skills[].name` | `skills/{name}/SKILL.md` | 从共享技能库**物化**一份副本（`FR-026`）；下次部署按库中版本覆盖 |
| `scenario` | `scenario.json` | 原样写入；`data_prep_dirs` 与各目录的字段条目均**保持顺序**；`data_prep_fields` **仅在非空时写入**（无约束的目录不出现键）——"缺失"与"空对象"对运行环境同义（该目录无约束），故不留空壳（`FR-026`、`SC-018`） |

**已实现示例（现状对照）**：`.opt-agent/users/admin/agents/demo/` 下即为本格式的真实样例（`TOOL.json` / `MCP.json` / `scenario.json` / `SOUL.md` 四件套齐全，`MCP.json` 中 `servers[0].url = http://ocr:8000/mcp` 正是 `endpoints.container_network` 的取值）。

---

## 9. 实体关系图

```text
                 ┌────────────────────┐
                 │  运行环境（只读投影） │
                 │  内置工具目录        │
                 │  compose 声明        │
                 │  容器状态/日志/统计  │
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
