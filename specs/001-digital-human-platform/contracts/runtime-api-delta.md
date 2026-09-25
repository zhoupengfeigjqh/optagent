# 接口契约（运行环境侧改动）：runtime-api-delta

**特性**：`001-digital-human-platform` | **版本**：1.0 | **日期**：2026-09-15

本文件登记本特性对**既有运行环境**的全部改动，对应 `plan.md` § 对既有运行环境的改动（R1~R4）。按宪章「不追溯」与"不得借改动之机放大范围"，本特性对运行环境的改动**只做两件事**：内部把内置工具元数据收拢为单一来源，以及新增两个**只读**端点；**不改动任何既有端点的行为、响应结构与错误码**。

> **契约落点说明**：本特性新增的两个运行环境端点登记在**本文件**，而非 `contracts/backend-api.md`——因为**该文件并不存在**（`specs/` 下只有本特性目录，全仓库搜索命中 0）。该缺口已登记为 `plan.md` 待办 1。

---

## §0 改动总览

| # | 改动 | 类型 | 影响既有行为 |
|---|---|---|---|
| R1 | 内置工具元数据收拢为**单一来源**（纯数据目录） | 内部重构 | 否 |
| R2 | 新增 `GET /api/builtin-tools`（只读） | 新增端点 | 否 |
| R3 | 场景读写位置＝数字人级（**已实现**，本特性仅消费） | 声明 | 已在既有特性中完成 |
| R4 | 新增 `GET /api/mcp-call-stats`（只读）+ MCP 工具调用计数点 | 新增端点 + 一处计数 | 否 |
| R5 | `gateway/nginx.conf`：新增 2 条 location，删除 3 段过时注释 | 配置 | 否 |
| R6 | `docker-compose.yml`：新增 2 个服务，清理 2 个过时 test profile | 编排 | 否 |
| R7 | 数字人配置**"变化即失效"**：取用池中实例前比对配置指纹 | 行为变更 | 否（端点契约不变，但**实例复用时机改变**） |
| R8 | MCP 工具调用**人工参数确认**（HITL）：`interaction_request` SSE 事件 + `POST /api/threads/{id}/interaction`，MCP 服务配置新增 `confirmation` 策略字段 | 新增事件/端点/配置字段 | 否（`confirmation` 缺省 `never`，存量行为零变化） |
| R9 | HITL 参数确认窗**算法规则选择**：MCP 服务配置新增 `rules_fields`（`{ 工具名: 字段名或对象路径 }`——2026-09-19 由 string 版 `rules_field` 升级、**2026-09-22 支持对象嵌套**），`interaction_request`/快照新增可选 `rules_field`（单次交互粒度投影），新增 `GET /api/files/rules`（只读） | 新增端点 + 配置字段 + 可选事件字段 | 否（`rules_fields` 缺省 `{}` 不启用，存量快照不写该键；历史 string 版存档读取收敛为 `{}`，存档里的**非法路径**读取时一并丢弃） |
| R10 | 新增内置工具 **`read_skill`**：补齐 SKILL 正文与 `references/` 附件的读取通道（此前只有 frontmatter 摘要进 System Prompt），内置工具目录由 5 项增至 6 项 | 新增工具 + 目录项 | 否（须在 `TOOL.json` 的 `enabled` 里显式声明；存量数字人不声明即零变化） |
| R11 | MCP **异步工具与后台产出**：调用配置新增 `async_tools`（按工具名声明哪些工具异步）；新增签名 `POST /api/files/put`（服务回写结果）、`GET /api/produced`（产出列表）、`GET /api/produced/events`（SSE 信号）；正文池组装时注入「后台计算结果」段 | 新增配置字段 + 3 个端点 + 一处提示词段 | 否（`async_tools` 缺省 `[]` 不启用；未声明工具不注入、不落盘、不依赖新端点） |

**对既有前端（对话工作台）的影响：无。** R2/R4 的消费方是 `admin-backend`（服务端到服务端），既有 `frontend` 不调用它们，故其 `src/api/types.ts` 与 `src/utils/error-message.ts` **无需改动**。

---

## §1 R1 — 内置工具目录收拢为单一来源

### 1.1 问题（`FR-011`、`FR-012` 的现状缺口）

当前工具元数据**散落在两处且无一致性机制**：

| 位置 | 内容 | 问题 |
|---|---|---|
| `agent-backend/src/infra/builtin-tools.ts` | 每个工具的 `name` / `label` / `description` / `parameters`，**内联在 `if (on('xxx'))` 分支内** | 工具清单是**隐式**的（靠分支存在与否表达），**无可枚举目录**；说明为运行期字符串拼接，**模板不可读** |
| `agent-backend/src/domain/agent-instance.ts` | `BUILTIN_TOOL_NAMES` | 与上者**重复**，新增工具时易漏改 |

### 1.2 目标结构

新增 `agent-backend/src/domain/builtin-tool-catalog.ts`，导出**纯数据目录**（无副作用、可单测）：

```ts
export interface BuiltinToolCatalogEntry {
  name: string;
  label: string;
  /** 含占位符的用途说明模板（FR-012） */
  description_template: string;
  /** JSON Schema 形态的入参说明 */
  parameters: Record<string, unknown>;
  /** 是否具备写能力（FR-011） */
  writable: boolean;
}

export const BUILTIN_TOOL_CATALOG: readonly BuiltinToolCatalogEntry[];
export function listBuiltinTools(): BuiltinToolCatalogEntry[];
export function findBuiltinTool(name: string): BuiltinToolCatalogEntry | undefined;
/** 渲染模板中的占位符（供 buildBuiltinTools 复用） */
export function renderTemplate(template: string, values: Partial<TemplateValues>): string;
```

`builtin-tools.ts` 改为**消费**该目录（保留现有 `AgentTool` 装配与异常翻译行为不变），`agent-instance.ts` 的 `BUILTIN_TOOL_NAMES` 改为从目录派生，从而**消除重复**。

### 1.3 占位符约定（`FR-012`）

| 占位符 | 含义 | 现有运行期取值 |
|---|---|---|
| `{可用目录}` | 当前数字人可见目录清单（`、` 分隔） | `dirsText` |
| `{示例路径}` | 可用目录首项构造的示例路径 | `examplePath` |
| `{会话标识}` | 当前 run 的 thread_id | `threadId` |
| `{临时空间}` | 临时空间显示名 | 字面量 `临时空间` |

### 1.4 目录内容（2026-09-23 起共 6 项；**前 5 项**行为 MUST 与现状等价）

| `name` | `label` | `writable` | `description_template` |
|---|---|---|---|
| `read_file` | 读取文件 | `false` | 读取用户空间（数据准备/共享空间/临时空间）下的文件内容。支持 .csv/.xlsx/.txt/.json/.pdf/.md/.log；xlsx 自动转 CSV，pdf 提取文本层。大文件返回截断内容，可用 offset 继续分段读取。参数 path 为相对空间的路径，如 "{示例路径}"。 |
| `write_file` | 写入临时文件 | **`true`** | 把内容写入临时空间，文件名会自动要求以 "{会话标识}_" 开头。数据准备与共享空间为只读，写入会被拒绝。写成功后可用路径 临时空间/{filename} 告知用户下载。 |
| `list_dir` | 列目录 | `false` | 列出指定目录的文件（名称/大小/更新时间）。目录限：{可用目录}。 |
| `grep_files` | 检索文件内容 | `false` | 在文本类文件（.csv/.txt/.json/.md/.log）中按正则检索关键词；xlsx/pdf 会被跳过（请改用 read_file）。可指定目录，缺省检索全部开放目录。 |
| `calculator` | 计算器 | `false` | 计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/round/floor/ceil/min/max/pow 函数与常量 pi/e。 |
| `read_skill` | 读取技能文件 | `false` | 读取本数字人所配置技能内的文件：path 省略时读该技能的 SKILL.md（技能入口说明），也可读 references/ 等其他文档（如 "references/算法详解.md"）；path 为目录时返回该目录下的文件清单。技能名取自系统提示中的「技能」小节。仅文本文件；内容过大时返回截断片段，可用 offset 继续读。 |

**不变式（MUST 由单测守住）**：`renderTemplate` 用现状的运行期取值渲染后，**前 5 项**的结果 MUST 与改造前 `buildBuiltinTools` 产出的 `description` **逐字相等**。这是本重构的安全性保证——改造**只改变元数据的组织方式，不改变任何对模型可见的文本**；`read_skill` 为 2026-09-23 新增，不在此不变式内（其 golden 文本单独断言）。

#### 1.4.1 `read_skill`（2026-09-23 新增）

**为什么加**：SKILL 此前**只把 frontmatter 的 `name`/`description` 注入 System Prompt**——正文与 `references/` 附件**没有任何读取通道**：内置文件的沙箱 `FileAccess` 只覆盖用户三空间（`users/{uid}/user-data/{数据准备|共享空间|临时空间}`），而技能物化在 `users/{uid}/agents/{agent}/skills/**`，是**另一个子树**，`read_file` 一律被拒（`目录不在白名单: skills`）。结果是配了 SKILL 的数字人只知道"我有这个技能"，拿不到怎么做的正文。

**落点与安全口径**：领域实现 `agent-backend/src/domain/tools/read-skill.ts`（**只读**，不经 `FileAccess`，自带一套校验）：

- 技能名限定为**单个目录名**（拒分隔符、`..`、控制字符），且必须真实存在于**本数字人**的技能根下；
- 技能内相对路径：拒绝绝对路径与盘符、`..` 穿越、控制字符；`\` 按分隔符归一；缺省/空串为 `SKILL.md`；
- 解析后的绝对路径 MUST 落在该技能目录内（`path.relative` 前缀校验）+ realpath 校验（防符号链接逃逸）；
- 只读**真实存在的普通文件**；`path` 为目录时返回其文件清单（**路径一律相对技能根**，便于模型直接回填给 `path`）；符号链接一律拒绝；
- **预期内的用法问题**（技能/文件不存在、二进制）以**可读文本**返回（含可用技能/文件清单，不静默留白）；
- **越权**（非法技能名、路径越界、符号链接、非普通文件）上抛 `SkillAccessError` → 向模型返回拒绝文案，并记 `file.access.denied`（`alert: true`）——与文件越权同一审计口径。
- 沙箱根由 `agent-factory` 在**每次 run 装配工具时**注入（`users/{uid}/agents/{agent}/skills`），故**天然隔离到当前数字人**，读不到别的数字人或别的用户的技能。

**启用方式**：与其他内置工具一致，MUST 在 `TOOL.json` 的 `enabled` 里显式声明（`FR-023` 白名单）。**存量数字人**若要用，需在管理平台勾选「读取技能文件」并**重新部署**后生效——这是刻意的：技能读取与"配置了哪些技能"一样，属显式配置，MUST NOT 隐式开启。

### 1.5 入参说明

`parameters` 沿用现状的 JSON Schema 字面量（含 `required` 与 `description`），不做语义改动。注意现状中 `parameters` 带 `as never` 断言（因 `AgentTool` 的类型未暴露该字段）——迁入纯数据目录后可去除该断言，属**类型层改善**，不影响运行期行为。

---

## §2 R2 — 新增 `GET /api/builtin-tools`

**用途**：向管理平台提供**可枚举的内置工具目录**（`FR-011` 的唯一来源）。

**归属**：`agent-backend/src/routes/`，与既有路由同构注册（`registerBuiltinToolRoutes(app, ctx)`），前缀沿用 `/api`。

**请求**：无参数（工具数固定为 6，无需分页；响应仍带 `total` 以保持形态一致）。

**响应 200**

```json
{
  "items": [
    {
      "name": "read_file",
      "label": "读取文件",
      "description_template": "读取用户空间（数据准备/共享空间/临时空间）下的文件内容。…如 \"{示例路径}\"。",
      "parameters": { "type": "object", "required": ["path"], "properties": { "path": { "type": "string", "description": "相对路径，如 \"{示例路径}\"" }, "offset": { "type": "number" }, "limit": { "type": "number" } } },
      "writable": false
    }
  ],
  "total": 5
}
```

**关键约束**：
- **只读端点**，无副作用，无请求体，无鉴权（沿用运行环境既有口径）。
- `description_template` MUST 保持**占位符形态**，MUST NOT 替换为任何具体用户/会话取值（`FR-012`、`SC-014`）。
- 目录 MUST NOT 由调用方（平台）硬编码；运行环境新增或下线工具后，本端点 MUST 自动反映（`FR-011`、`SC-013`）。

**错误码**：`INTERNAL_ERROR`（500，兜底）。

---

## §3 R3 — 场景读写位置（已实现，仅声明）

**现状**：场景（`scenario.json`）已由用户级改为**数字人级**，落在 `users/{uid}/agents/{agent}/scenario.json`。读取口径：`agent-backend/src/domain/dirs.ts` 的 `scenarioPath(root, userId, agentName)` / `loadScenario` / `parseSpaceDir`。

**对既有接口的影响**（已在既有特性中完成，本特性**不再改动**，仅作为平台物化目标的依据）：

| 既有接口 | 行为变化 |
|---|---|
| `/api/files/*`（`upload`/`list`/`download`/`preview`/`DELETE`/`workspace`） | 目录合法性改为按**当前选中数字人**的场景清单判定；未选中数字人时 `409 AGENT_NOT_SELECTED` |
| `POST /api/files/upload` | 数据准备目录带字段约束时，暂存后落盘前校验上传表（`400 FILE_SCHEMA_INVALID` + `details[]` 逐条问题，失败不落盘），详见 §3.1；单文件上限 **5MB**（413 `FILE_TOO_LARGE`，与平台 SKILL ZIP 导入同一全局约束） |
| `GET /api/files/workspace` | 目录项（dirs）新增 `fields`（字段约束，无约束为 `[]`）：供前端上传入口做**只读提示**；权威校验在上传路由，前端 MUST NOT 自行判定 |
| `POST /api/threads/:id/messages` 的 `attachments` 校验 | 同一引用在不同数字人下可能合法/非法，按**本轮数字人**判定 |
| `SCENARIO_NOT_CONFIGURED`（503） | 错误码不变，message 改为指名数字人 |

**平台侧的对应约束**：部署 MUST 把 `scenario.json` 写入**该数字人目录内**（`FR-026`），MUST NOT 依赖任何用户级共享配置文件（`data-model.md` §8）。

### 3.1 `scenario.json` 扩展：目录字段约束（2026-09-17 新增；2026-09-17 当日补完上传校验）

**用途**：声明"数据准备某二级目录的上传表**必须有哪些表头、各是什么类型**"。**校验已实现**：运行环境（`agent-backend`）是**唯一权威**——上传路由在暂存后、落盘前校验，前端不做同款校验（避免双实现漂移），仅经 `workspace` 接口下发的 `fields` 在上传入口做**只读提示**。

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["生产计划"],
  "data_prep_fields": {
    "生产计划": [{ "name": "产线编号", "type": "string", "required": true }]
  }
}
```

**运行环境读取口径**（`agent-backend/src/domain/dirs.ts` 的 `parseScenarioFields`）：运行环境是**消费方**，非法内容一律**丢弃并告警**，MUST NOT 因此让整个场景不可用。丢弃判据：整体非对象 / 某目录值非数组 / 项非对象 / 字段名非法（空、含分隔符或 `..`、超 64 字符）/ 类型不在枚举内 / `required` 非布尔 / 同目录内重名（留首个）/ 目录不在**有效目录清单**内（孤儿约束）。空清单的目录**不写入结果**——`data_prep_fields` 缺失或某目录无键 = **该目录无约束**；本字段是后加的，历史 `scenario.json` 自然按"无约束"处理（零迁移）。

**字段取值类型**：`string` / `integer` / `number` / `boolean` / `object` / `array`（JSON Schema 基本类型子集；与平台设计态、管理界面**同一枚举**，三处 MUST 同步）。

**类型判定规则（供未来的上传预检使用，本期只落配置）**：数据准备空间的上传白名单为 `.csv` / `.xlsx`（`SPACE_POLICIES`），故字段值取自**上传表的表头**，而单元格内容在判定时是**文本**：

| 类型 | 判定规则 |
|---|---|
| `string` | 无需解析，表头存在即可 |
| `integer` | 整数字面量（可带正负号，不含小数点与指数） |
| `number` | 数字字面量（允许小数与指数） |
| `boolean` | 仅 JSON 字面量 `true` / `false`（**不**接受 `TRUE` / `1` / `是` 等宽松写法） |
| `object` | 可 `JSON.parse` 且顶层为对象（**第一版不做嵌套校验**） |
| `array` | 可 `JSON.parse` 且顶层为数组（**第一版不做元素校验**） |

`required: true` = 表头 MUST 存在；`false` = 表头可缺，**出现则类型仍须匹配**。判定规则的唯一实现在 `agent-backend/src/domain/field-check.ts`（判据以本表为准）；平台侧（admin-backend / admin-frontend）**只生成配置、不做取值判定**。

**校验执行口径**（`agent-backend/src/domain/field-check.ts`，上传路由 `POST /api/files/upload` 在暂存后、落盘前调用；仅"数据准备空间且该目录有约束"时触发，共享/临时空间与无约束目录不触发）：

- **解析**：`.csv` 按逗号分隔（支持 `"` 引用与 `""` 转义、`\r\n` / `\n`），编码 UTF-8（去 BOM）优先，出现替换字符回退 **GBK**（中文 Excel 导出常见编码）；`.xlsx` 复用既有 `xlsx` 依赖，仅**第一个 sheet**，单元格取**显示文本**（`raw: false`，日期等按格式串判定），前置 **ZIP 魔数**（`PK\x03\x04`）校验（SheetJS 对非 zip 输入不抛错，需确定性拦截损坏文件）。
- **取值判定**：全量数据行逐行判定；**空单元格跳过**（`required` 语义是表头必含，不做行级必填）；全空行丢弃，**行号按"表头为第 1 行"的非空数据行顺序计**；重复表头取首个匹配列；超长取值（>32 字符）截断展示。
- **失败响应**：`400` + 错误码 **`FILE_SCHEMA_INVALID`**，响应体 `error.details` 为**逐条中文问题清单**（缺必填表头一次性列全；逐行指出"第 N 行「字段」取值 … 类型不符（期望…）"；超过 `MAX_ISSUES = 30` 条截断为"…等 N 处"）；失败文件**不落盘**（暂存清理）。
- **前端展示**（`frontend`）：`ApiError.details` 透传至 `ErrorInfo`；`FILE_SCHEMA_INVALID` 是 D13（不直接展示后端 message）的**唯一例外**——问题清单按文件动态生成，按码分派无法承载，`toUserMessage` 直接换行拼接 `details` 展示；上传入口（`UploadMenu`）按 `workspace` 接口 dirs 的 `fields` 做只读提示（`表头须含：A、B；可选：C(integer)`），MUST NOT 自行判定。

---

## §4 R4 — 新增 `GET /api/mcp-call-stats` 与计数点

### 4.1 问题（`FR-049`、`FR-050`）

平台需按服务统计 MCP 的调用次数、成功/失败次数与最近调用时间，且 MUST **在数字人实际调用后自动更新**。运行环境是**唯一确切知道工具调用发生的地方**；日志解析不可靠（各 MCP 服务日志格式自定，"HTTP 请求数"≠"工具调用次数"）——见 `research.md` D6。

（2026-09-23 追加）平台统计表要求**一行 = 一个「用户 × 服务 × 工具」组合**，并列出四个时间窗——见 §4.3 的 `groups`。按服务、按用户等更粗视角一律由它折叠得出，不再并列返回第二套明细。

### 4.2 计数点

在 MCP 工具适配层（工具调用完成处）**每次调用落一行事件明细** `mcp_call_events`，各维度统计均由该表聚合。2026-09-23 起**只有这一张表**：原按服务名的独立累计表 `mcp_call_stats` 已删除（明细本就只保留一年，不存在"全历史累计"需求；一张停写后冻结在切换时刻的表比删掉更容易被误读）。

口径为 **MCP 工具调用次数**：一次 `tools/call` 记一行；**调用未发出**（如 `file_args` 沙箱校验失败）不记。逐列记录：

| 列 | 来源与口径 |
|---|---|
| `service_name` | MCP 服务名（适配器里的 `serverName`） |
| `tool_name` | **MCP 服务自己的工具名**（如 `ocr` 下的 `ocr_image`），不含暴露给模型的 `{server}__` 前缀（2026-09-23：粒度由服务下钻到工具） |
| `ok` | 调用成功/失败（失败含"服务不可用"） |
| `called_at` | 调用时刻（ISO8601） |
| `user_id` | 调用发起用户，取自强制穿透的运行上下文 `uid`（七次调整已保证运行环境侧必可得），供按用户明细聚合（十四次调整，2026-09-16） |
| `thread_id` | 当前会话 id，取自同一上下文的 `sid`（2026-09-23：把事件接回具体对话） |
| `duration_ms` | **含 `McpManager` 内部一次重试**的用户感知耗时，MUST NOT 当作单次尝试耗时（2026-09-23） |
| `error_kind` | 仅失败有值：`unavailable` / `protocol` / `transport`；MUST NOT 存错误原文（长度与脱敏不可控，细节看运行日志），判定复用 `McpManager` 既有的连接级判据（2026-09-23） |

计数持久化到既有 `UsageDb`（`better-sqlite3`）——**不引入新依赖、不新增数据库引擎**（原则六）。新增列对旧库**打开即自愈**（`PRAGMA table_info` 判定后 `ALTER TABLE ADD COLUMN`；建在这些列上的索引 MUST 在补列**之后**创建）；老行的新列为 `null`，界面按"未归属·升级前记录"呈现（不静默留白）。

### 4.3 端点

**`GET /api/mcp-call-stats`**

**请求**：无参数。

**响应 200**

```json
{
  "stats_available": true,
  "items": [
    {
      "name": "ocr",
      "calls_total": 42,
      "calls_ok": 40,
      "calls_failed": 2,
      "last_called_at": "2026-09-23T06:12:33.000Z"
    }
  ],
  "groups": [
    {
      "service": "ocr",
      "tool_name": "ocr_image",
      "user_id": "admin",
      "calls_total": 30,
      "calls_ok": 29,
      "calls_failed": 1,
      "last_called_at": "2026-09-23T06:12:33.000Z",
      "windows": {
        "h24":  { "ok": 3,  "failed": 1, "total": 4 },
        "d7":   { "ok": 12, "failed": 2, "total": 14 },
        "d30":  { "ok": 20, "failed": 2, "total": 22 },
        "d365": { "ok": 29, "failed": 1, "total": 30 }
      }
    },
    {
      "service": "ocr",
      "tool_name": "ocr_pdf",
      "user_id": null,
      "calls_total": 12,
      "calls_ok": 11,
      "calls_failed": 1,
      "last_called_at": "2026-09-22T09:00:00.000Z",
      "windows": {
        "h24":  { "ok": 0,  "failed": 0, "total": 0 },
        "d7":   { "ok": 1,  "failed": 0, "total": 1 },
        "d30":  { "ok": 11, "failed": 1, "total": 12 },
        "d365": { "ok": 11, "failed": 1, "total": 12 }
      }
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `stats_available` | boolean | 统计存储是否可读；为 `false` 时 `items` 与 `groups` 均为空数组 |
| `items[]` | array | **服务级汇总**（供平台**卡片**展示"最近一年调用次数"）：每项 `{ name, calls_total, calls_ok, calls_failed, last_called_at }` |
| `items[].calls_total` | integer | 该服务的调用次数（= `calls_ok + calls_failed`）。**2026-09-23 起口径为最近一年**（独立累计表已删，改由只保留一年的事件明细聚合）；`calls_ok` / `calls_failed` / `last_called_at` 同此口径 |
| `groups[]` | array | **平台统计表的行**（2026-09-23）：按「**服务 × 工具 × 用户**」分组，`service` + `tool_name` + `user_id` 三元组唯一，每项字段见下 |
| `groups[].service` | string | MCP 服务名 |
| `groups[].tool_name` | string \| null | **MCP 服务自己的工具名**（如 `ocr` 下的 `ocr_image`），不含暴露给模型的 `{server}__` 前缀；`null` = 升级前的历史事件未记录工具名 |
| `groups[].user_id` | string \| null | 调用发起用户；`null` = 升级前的历史事件未记录归属 |
| `groups[].calls_total` / `calls_ok` / `calls_failed` | integer | 该组合的调用次数/成功/失败，等于 `windows.d365`（同一保留期口径） |
| `groups[].last_called_at` | string \| null | 该组合的最近调用时间（ISO8601）；从未调用为 `null` |
| `groups[].windows` | object | 按时间窗聚合（任务 2026-09-15）：`h24`（最近24h）/ `d7`（最近7天）/ `d30`（最近30天）/ `d365`（最近一年），每窗 `{ ok, failed, total }`。数据源为**每次调用一行**的事件明细表 `mcp_call_events`（只保留一年，与最长统计窗对齐），MUST NOT 从日志文件解析 |

**关键约束**：
- **只读**，无副作用。
- 统计口径为 **MCP 工具调用次数**（`research.md` D6），MUST 与本契约一致，MUST NOT 在未来悄悄改为"HTTP 请求数"。
- 未出现过的服务**不出现在 `items` 中**（平台侧以 0 呈现）；**超过一年未被调用**的服务同理——事件明细只保留一年，与该保留策略一致。
- `groups` 是**最细粒度**：更粗的视角（按服务、按用户）MUST 由它折叠得出，MUST NOT 再并列返回第二套明细数组（十四次调整的 `users[]` 与 `tools[]` 已在 2026-09-23 被 `groups` 取代——两者都不带时间窗，无法表达统计表所需的列）。
- `null` 是 `tool_name` / `user_id` 的**合法取值**（表示该维度在升级前未落库），平台侧 MUST 显示"未归属·升级前记录"而非空白。

**错误码**：`INTERNAL_ERROR`（500）。

### 4.4 与 `FR-005` / `SC-017` 的关系

本端点与 `FR-048`（平台读容器日志）都属"平台**只读采集运行观测**"。`SC-017` 现表述为"运行环境 → 平台的反向数据通道数量为 **0**"，与二者存在口径张力。**处置**（已登记于 `plan.md` § 已知口径差异）：

- 「严格单向」约束的是**配置数据流**——平台 MUST NOT 从运行环境反向**导入配置**，运行环境 MUST NOT **回写平台配置**；
- **运行观测的只读采集不在其列**；
- `spec.md` 的 `FR-005` / `SC-017` MUST 在实现前补入该限定，并在 `checklists/requirements.md` 追加澄清项。

---

## §5 R5 — `gateway/nginx.conf` 改动

新增两条 location（`research.md` D10）：

```nginx
# ---- 数字人管理平台：管理服务接口（最长前缀，优先于 /api/）----
location /api/admin/ {
    proxy_pass http://admin-backend:3001;   # 2026-09-20：容器内 admin-backend 统一改监听 3001（与本地形态同一口径）
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    client_max_body_size 60m;   # 与 SKILL ZIP 上传上限对齐
}

# ---- 数字人管理平台：管理界面静态资源 ----
location /admin/ {
    proxy_pass http://admin-frontend:80;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**同时 MUST 删除**文件中三段「待接入」注释（`/mcp/`、`/skill/`、`/designer/`）——它们描述的是"三个独立平台"的旧设想，与 `FR-001`（四个功能区合成**一个**平台）不一致，留着会误导后续实现。

---

## §6 R6 — `docker-compose.yml` 改动

> 2026-09-20 更新（两轮）：① admin-backend 容器形态配置由 compose `environment` 逐行声明收敛为
> `env_file` 注入（与 backend 段同模式）；② 当日稍后统一为分层约定——两个后端均为
> `.env`（入库：agent=形态默认值 / admin=容器形态）+ `.env.local`（本机私产，gitignore）
> + `.env.example`（= .env.local 的创建样板）；compose 形态差异项（`PUBLIC_BASE_URL`）
> 仍由 `environment` 单点覆盖。下方为历史决策记录。

新增两个服务（`research.md` D2/D3）：

```yaml
  admin-backend:
    build: ./admin-backend
    container_name: optagent-admin-backend
    environment:
      - PUBLIC_BASE_URL=http://admin-backend:3001   # 若需要
    volumes:
      - ./admin-backend/.platform-data:/app/.platform-data  # 平台设计态（读写；与 .opt-agent 布局对称）
      - ./agent-backend/.opt-agent:/app/.opt-agent   # 物化目标（读写）
      - ./docker-compose.yml:/app/docker-compose.yml:ro  # 编排声明（只读投影，FR-043）
      - /var/run/docker.sock:/var/run/docker.sock    # 容器状态/日志/启停（见下方风险）
    depends_on:
      - agent-backend
    restart: unless-stopped

  admin-frontend:
    build: ./admin-frontend
    container_name: optagent-admin-frontend
    restart: unless-stopped
```

**必须标注的风险**：挂载 `/var/run/docker.sock` **等价于授予宿主机 root 权限**。缓解措施见 `research.md` D3（操作白名单收口在单一模块、不暴露任意 API 透传端点、health 端点报告 socket 可达性）。该风险 MUST 同时写入实现说明与 `quickstart.md` 的部署说明。

**同时 MUST 清理**：`backend-test` 与 `ocr-test` 两个 `profiles: ["test"]` 服务及其 `Dockerfile.test`——与宪章 2.0.0「容器 MUST NOT 承担任何测试职责」直接冲突（`plan.md` Complexity Tracking）。**新子项目 MUST NOT** 新增任何 `Dockerfile.test` 或 test profile。

---

## §7 兼容性与回滚

| 项 | 结论 |
|---|---|
| 既有端点行为 | **零改动**（仅新增 2 个只读端点） |
| 既有前端 | **零改动**（不消费新端点） |
| 既有测试 | 既有 26 个用例 MUST 继续全过；R1 的重构 MUST 新增"模板渲染结果与改造前逐字相等"的单测 |
| 回滚 | R1/R2/R4 集中在 `agent-backend` 的三个文件 + 一个新增文件，可整体回滚；R5/R6 为纯配置，可整体回滚 |
| 数据迁移 | 无（不新增数据表结构之外的迁移；`UsageDb` 增加计数表，采用 `CREATE TABLE IF NOT EXISTS`） |

---

## §8 R7 — 数字人配置"变化即失效"（`FR-034`）

### 8.1 问题（在 `/speckit.analyze` 修复阶段发现）

`FR-034` 要求"**其后的新对话立即使用新配置**"。但运行环境当前的设计使这一条**不成立**：

| 事实 | 出处 |
|---|---|
| 数字人配置**只在实例创建时读取一次** | `agent-factory.ts` 的 `create()` 调用 `loadAgentConfig(agentDir)` |
| 实例按 `(user_id, agent_name)` 缓存在**实例池**中，`getOrCreateAgent` 命中即直接返回缓存 | `server.ts` 的 `ctx.getOrCreateAgent`、`agent-pool.ts` |
| 实例仅在**空闲超时**（`IDLE_TIMEOUT_MS`，默认 30 分钟）或**池满 LRU** 时被回收 | `agent-pool.ts` 的 `evictIdle` / `lruEvictOne` |
| **没有任何**配置变化检测（无 `mtime` 比对、无失效接口、无版本号） | 全模块搜索 `mtime`／`invalidate`／`reload`／`statSync` 均无命中 |

**后果**：部署生效后，只要池中已有该数字人的实例，**新对话会继续使用旧配置**——最长可达 30 分钟。症状是"我明明部署了，数字人却没变"，且**不报任何错**，属最难排查的一类静默缺陷。

### 8.2 目标方案

在**取用池中实例之前**比对**配置指纹**：对数字人目录下的关键文件（`SOUL.md`／`TOOL.json`／`MCP.json`／`scenario.json`／`skills/**`）取**修改时间与大小的组合摘要**（或内容摘要），与实例创建时记录的指纹不一致即**丢弃该实例并重建**。

**落点**：`agent-factory` 记录指纹；`server.ts` 的 `getOrCreateAgent` 在 `pool.get(key)` 命中后先做指纹比对，不一致则 `pool.remove(key)` 再 `create(key)`。

**理由**：
- 沿用 `agent-catalog.ts` 既有的 **"现扫现解析、配置修复后无需重启即可重现"** 思路，保持运行环境内部一致；
- **不让平台参与**——平台无需调用运行环境的"失效"接口，因此平台故障不会导致部署不生效，也避免了管理面↔数据面的额外耦合（`FR-005` 的单向性不受影响）；
- 每次取用只需 stat 少量文件（配置体量极小），对 P95 无实质影响。

### 8.3 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 平台部署后调用一个"失效"接口 | ①引入平台 → 运行环境的**控制类**调用，管理面耦合进运行期；②平台不可达时部署静默不生效，与 `FR-026`「使运行环境无需依赖平台即可独立加载」相悖 |
| 缩短 `IDLE_TIMEOUT_MS` | 只是把"最长 30 分钟"改成"最长 N 秒"，**没有解决**"立即生效"，且会显著增加实例重建开销（MCP 重连、模型重载） |
| 部署时直接重启 `agent-backend` 容器 | 会**中断进行中的回答**，直接违反 `FR-034`；且平台不应拥有重启数据面的权限 |
| 每次请求都重建实例 | 放弃池化的全部收益（MCP 建连与模型加载成本高），违反原则五对性能的要求 |

### 8.4 不变式（MUST 由单测守住）

1. 池中存在某数字人实例、且其配置目录被改动后，**下一次取用 MUST 返回新实例**（配置内容与磁盘一致）；
2. 配置**未**变化时，取用 MUST 命中同一实例（**池化收益不被破坏**）；
3. 指纹比对 MUST NOT 中断正在执行的轮次——只在**取用**时机判定，`activeThreads > 0` 的实例不因指纹变化被立即销毁（沿用池既有的"只淘汰空闲实例"约束）。

---

## §9 R8 — MCP 工具调用人工参数确认（HITL，2026-09-17）

### 9.1 语义

被平台声明为"需人工确认"的 MCP 工具，在**执行前挂起**：运行环境经 SSE 下发该工具的参数 Schema 与模型提议值，用户在前端**确认/修改/拒绝**后，工具以用户确认的入参执行；拒绝或超时按"工具返回结构化错误"收尾，模型自行组织话术，**对话轮次正常完结**（业界惯例：LangGraph `interrupt`/resume、Claude Desktop 批准交互）。弹窗 UI 由工具自带的 `inputSchema` **动态驱动**，与具体 MCP 服务零绑定——新增需确认工具 = 平台改配置 + 部署，零代码。

### 9.2 配置面（平台权威源）

MCP 服务调用配置新增 `confirmation` 字段（缺省 `never`，**存量行为零变化**）：

```jsonc
// mcp-services.json（平台侧，admin-backend）
{ "confirmation": "never" }                        // 直跑
{ "confirmation": "always" }                       // 该服务全部工具
{ "confirmation": { "tools": ["query_price"] } }   // 仅列出的原始工具名（不含 server 前缀）
```

经部署物化进运行环境 `MCP.json` 的 server 条目（`never` 时**不写该字段**）；运行环境 `agent-instance.ts` 在加载期校验形状，非法即 `AgentConfigError` 挡下该数字人（不把 typo 静默当 never）。

**2026-09-19 新增 `rules_fields`**（HITL 规则选择器声明，配合 R9；当日由 string 版 `rules_field` 升级为按工具映射）：MCP 服务调用配置的可选字段，形状 `{ 工具名: 字段名或对象路径 }`——声明该工具入参里承载 `array[object]` 规则清单的字段。语义边界：

- **不改变是否走 HITL**——是否弹参数确认窗仍只由 `confirmation` 决定；`confirmation: never` 时参数由模型直接填写，`rules_fields` 不生效（无挂起点即无快照即无入口）；不在确认范围内的工具的映射同样不生效（工具未被包装）；
- 装配时按**当前工具名**查映射，且该**路径在工具 schema 里走得通**时（沿 `properties` 逐段下行、末段存在即算走得通；与旧实现强度一致，**不要求**末段是数组），运行环境把路径带进 interaction 快照（快照内仍叫 `rules_field`，单次交互粒度的投影）；
- **2026-09-22：取值从"顶层字段名"泛化为"对象路径"**（`rules` / `input.targetPriorities`）。起因：规则数组常嵌在入参对象内部（真实形态 `hd_scheduling_submit` 的 `input.targetPriorities`——`input` 承载 7 个排产输入项，规则清单只是其一），只认顶层会让这类声明**静默失效**：配置已保存、界面也回显，只是入口永不出现。语法：分段用 `.`、**只走对象**、不支持数组段（`items[].rules` 判非法——"写第几个元素"没有业务含义）；两侧同一判据（`agent-backend/src/domain/rules-field-path.ts` 与 `admin-backend/src/domain/mcp/rules-field-path.ts` 同构，与 `file-arg-path.ts` 同一约定）；
- 物化口径与 `confirmation` 相同：空对象不写该字段；平台侧保存期校验（非对象 / 值不是合法字段路径即 `VALIDATION_FAILED`；**只校验语法、不校验工具 schema**——工具清单是探测结果，服务不可达时拒保存会把"服务抖动"变成"配置改不了"），运行环境加载期校验（非法路径即 `AgentConfigError`）；历史存档的 string 版 `rules_field` 读取时收敛为 `{}`，**存档里的非法路径读取时一并丢弃**（否则一次部署就会让整只数字人加载失败，破坏面止于"该声明不生效"，与 `confirmation` 的收敛口径一致）；
- 管理端表单联动（产品决定，2026-09-19）：该设置独立成栏、位于 HITL 栏之下并与「URL铸造参数设置」平级；HITL = 无需确认 → 栏禁用且所填清空；仅指定工具 → 工具列只列勾选工具、清单外声明级联清掉；全部工具 → 全部可选。「字段」下拉 = 该工具参数 Schema 里的 array 入参**按对象路径列出**（2026-09-22 起含嵌套；只沿对象下行、不进入数组元素）。

### 9.3 SSE 事件（非终结事件）

`POST /api/threads/{id}/messages` 的流中新增：

```
event: interaction_request
data: {
  "interaction_id": "i_…",      // 挂起点标识（提交/拒绝按它配对）
  "call_id": "c_…",             // 对应 tool_call 的 call_id
  "tool_name": "svc__query",    // 运行环境侧工具全名（含 server 前缀）
  "title": "确认调用参数：svc__query",
  "schema": { … },              // 工具的 inputSchema（JSON Schema draft 子集）
  "proposed_args": { … },       // 模型提议值（预填，用户可改）
  "required": [ … ],
  "timeout_seconds": 300,       // 超时按拒绝收尾
  "rules_field": "rules"        // 可选（R9）：服务按工具声明（rules_fields 映射）且该路径在
                                //   工具 schema 里走得通时才有——字段名**或对象路径**
                                //   （如 input.targetPriorities，2026-09-22）
}                               //   快照内为单次交互粒度的投影（非全局配置）
```

### 9.4 端点

**`POST /api/threads/{id}/interaction`**（202，幂等：同一 `interaction_id` 重复提交返回首次结果）

```jsonc
// 请求
{ "interaction_id": "i_…", "action": "submit", "args": { … } }  // submit 必填 args
{ "interaction_id": "i_…", "action": "reject" }
// 响应
{ "accepted": true, "result": "settled" | "already-resolved" }
```

| 错误码 | 状态 | 语义 |
|---|---|---|
| `INTERACTION_NOT_FOUND` | 404 | 挂起点不存在（线程无进行中 run / id 错） |
| `INTERACTION_EXPIRED` | 409 | 等待已超时（不可复活，模型已收到拒绝结果） |
| `SCHEMA_VALIDATION_FAILED` | 400 | 服务端按挂起时 schema 终验失败，**挂起点保持可重提**；`error.message` 为逐字段中文清单 |

**`GET /api/threads/{id}`** 响应新增 `pending_interaction` 快照（含 `remaining_seconds`）：SSE 断连/页面刷新后前端据此**重建弹窗**。

### 9.5 不变式（MUST 由单测守住）

1. `confirmation` 缺省/`never` 时行为与改造前**完全一致**（无事件、无挂起、无端点依赖）；
2. 提交终验在**服务端**（JSON Schema 子集校验器 `domain/interaction-schema.ts`），前端校验只做体验；
3. run 被 stop/中断时全部挂起点按拒绝收尾，**不泄漏悬挂 promise**；超时同拒绝语义；
4. 并发上限 3：单 run 同时等待的挂起点超过 3 个时 FIFO 排队，落定一个放行一个；
5. 交互全生命周期（挂起/提交/拒绝/超时/中断收尾）落结构化运行日志（`event: 'interaction'`），**不落敏感参数值**；
6. 该机制**不绕过**文件安全层：确认后的 args 仍走既有 `file_args` 铸造与沙箱校验。

### 9.6 前端契约

- `frontend` 新增通用组件 `InteractionDialog.vue`：props 仅 `{ request: InteractionRequest }`、emits 仅 `submit(args)`/`reject()`——**组件内禁止出现任何具体工具/MCP 服务名**；
- 控件映射（**2026-09-23 起按 schema 递归**）：`enum→下拉`、`boolean→开关`、`integer/number→数字输入`、`string→输入框`（description 含「多行」→ 多行文本）；`object` 且声明了 `properties` → **子字段逐行**（任意深度递归）；`array` 且 `items.type=object` → **表格**（一行一个元素；列 = `items.properties` 的键，不足时补"值里实际出现的键"）；`array` 且 `items` 为标量/枚举 → **列表**（一行一项）；其余形状（无 `properties` 的自由对象、数组套数组、`items` 缺失）→ **JSON 文本框**（逃逸舱）。required 标星 + 本地校验；
- 行内操作条：分组/表格/列表行提供「按 JSON 编辑 / 按表单编辑」切换（任一层都可手动切回或切出）；表格另有「＋ 添加行」与每行「删除」；`@` 文件引用与结构化文件卡片仍**只挂文本类控件**（表格单元格不挂，避免在格子里展开面板）；
- 分层（宪章原则二，各自带同名测试）：控件推导与值逻辑在 `utils/arg-schema.ts` / `utils/arg-values.ts`（纯函数），值路径读写在 `utils/json-path.ts`（2026-09-23 起支持数组下标），表单状态在 `composables/useInteractionForm.ts`，单节点递归渲染在 `components/chat/InteractionField.vue`（单元格/列表项用 `cell` 模式只出控件本体），`InteractionDialog.vue` 只做外壳；
- 倒计时取 `timeout_seconds`，归零按拒绝关闭；终验失败展示后端逐字段错误并保持弹窗。

### 9.7 算法规则选择（R9，2026-09-19）

**交互**：HITL 参数确认窗中，快照声明了 `rules_field` 的**字段那一行**渲染「从算法规则选择」按钮（未声明不渲染；2026-09-23 前为"顶层 JSON 字段旁"，见下方该日修订）；点击弹结构化表格——列 = 最新规则文件表头，行首勾选，**优先级列（表头匹配 `priority`/`优先级`）就地编辑**（数字文本转数字，留空则不携带该键），其余列只读；确认后勾选行原样生成 `array[object]`（**键 = 表头列名，值 = 该行该列的值**）写回 JSON 编辑框（可再手改），提交仍走 §9.4 服务端终验。

**2026-09-22：`rules_field` 为对象路径（如 `input.targetPriorities`）时的落点与写回**：

- **落点**——弹窗只渲染**顶层**字段（顶层对象一律是 json 文本框，没有分字段控件），故入口挂在 `rules_field` **首段**对应的顶层控件旁；按钮 aria-label、旁注与选择器标题都写明完整目标路径，避免"到底填到哪个字段"含糊；
- **写回**——把勾选生成的数组**深写**进该 JSON 编辑框文本的对应位置（中间层缺失即创建空对象；中间层存在但不是对象、或编辑框文本不是合法 JSON → **只报错、不覆盖**，避免破坏用户已填的其他输入项）；顶层字段（`rules`）保持既有的整段替换语义；
- **预勾选**——取编辑框**当前文本**按路径解析出的值（不是 `initForm` 时模型提议值那份旧快照），用户手改过 JSON 后再打开选择器也能正确反勾。

**2026-09-23：弹窗改为按 schema 递归渲染后，落点与写回的收敛**

- **起因**：真实工具把 7 个排产输入项包在一个顶层 `input` 对象里（`input.targetPriorities` 只是其一），而旧实现只渲染**顶层**字段、`object/array` 一律塌成一个 JSON 文本框——"字段逐行""入口在它那一行"在界面上根本不成立，入口只能挂在祖先 JSON 框下方、靠旁注说明它到底改哪里。该 MCP 服务由第三方提供、**不可改**，因此只能在客户端补通用能力（§9.6 的控件映射同步改为递归）；
- **落点**：`rules_field` 改为按**完整路径**匹配"能被结构化渲染到的**最长前缀**"（`utils/arg-schema.ts: rulesAnchorOf`）。路径全程可渲染 → 入口就在目标那一行（与它要影响的表格/JSON 框同属一个字段块）；中途撞上 JSON 逃逸舱（祖先对象未声明 `properties`）→ 落点退到该祖先那一行，`exact = false`，写回仍按**完整路径**；
- **写回**：不再"往 JSON 文本里塞字符串"，而是按值路径**深写进结构化模型**（`utils/json-path.ts: setAtPath`，2026-09-23 起支持数组下标）。因此"当前不是合法 JSON，请先修正后再选择规则"只在**目标路径上仍有祖先处于 JSON 编辑态**时才会出现（`composables/useInteractionForm.ts: applyRules`）；结构化路径下不存在"把文本解析回来"这一步，也就不会再因半截文本而拒绝；
- **预勾选/反勾**口径不变（仍取当前模型值按路径解析），只是取值来源从"编辑框文本"变为"模型"；
- **单文件行数**：原 `InteractionDialog.vue` 已超宪章 500 行硬门禁，本次按"拆子组件 / 抽 composable / 抽纯函数"三种方式拆分到位。

**数据源端点（新）**：`GET /api/files/rules` —— 取「数据准备/算法规则」中 `updated_at` 最新的规则文件（`.xlsx`/`.csv`），**服务端解析**（运行环境已带 `xlsx` 依赖；CSV 按 UTF-8 解码，xlsx 先验 ZIP 魔数防"改后缀文本"蒙混），返回：

```jsonc
{
  "filename": "rules_20260919.xlsx",
  "updated_at": "2026-09-19T08:00:00.000Z",
  "columns": ["规则编码", "规则名称", "优先级"],   // 表头（保持文件内顺序）
  "rows": [{ "规则编码": "R001", "…": "…" }],        // 数据行（键 = 表头列名）
  "priority_column": "优先级"                        // 表头里匹配 priority/优先级 的列；无则 null
}
```

| 错误码 | 状态 | 语义 |
|---|---|---|
| `FILE_NOT_FOUND` | 404 | 目录暂无文件 / 目录不可读 / 文件已被清理 |
| `FILE_TOO_LARGE` | 413 | 超过预览上限（与预览同一上限） |
| `FILE_SCHEMA_INVALID` | 422 | 解析失败：损坏、空表头/重复列名、行数超上限（1000） |

**组件**：`RulePickerDialog.vue`——`load` 由父级注入（会话环境取 `session.files.rules()`），组件不直接发请求；`initialValue` 反勾选（当前参数值里与某行全等的元素预勾选）。**不加表头兜底列**：「数据准备」目录的字段约束已保证规则文件必有优先级列（预定义目录「算法规则」，2026-09-19）。

---

## §10 R11 — MCP 异步工具与后台产出（2026-09-25）

### 10.1 语义与动机

**异步工具**：调用后**立刻返回受理**（携带 `job_id` 与面向用户的提示语），实际计算在 MCP 服务侧后台进行；算完后由服务把结果**回写**到该用户的空间；平台落盘时通知前端，并在**下一轮对话**把「最近产出」清单注入提示词，供模型按需读取。

**为什么需要**：部分算法类 MCP 工具的计算耗时**远超平台侧超时**（`MCP_TIMEOUT_MS` 默认 30s；本机 `.env` 为 5min，且 `callTool` 失败后**重试 1 次**）。同步阻塞导致三个问题：

| 问题 | 表现 |
|---|---|
| 用户干等 | 一轮对话被单个工具阻塞数分钟 |
| **超时后重试 → 重复提交** | 算法侧可能收到两次同样的任务（超时只 reject 不取消底层调用） |
| 失败无痕迹 | 超时后只剩一句"外部服务调用失败"，任务状态无从查询 |

**真实形态**：`hd_scheduling_submit` 的 `description` 明示"阻塞等待算法回调，等待上限 = 求解时间 + 60 秒兜底缓冲"——`solvingTime > 240s` 时必然超时。

**范围**：异步是**按工具声明**的能力，不是服务级模式；**未声明的工具与既有同步路径行为完全一致**（见 §10.6 不变式 1）。

### 10.2 配置面（平台权威源）

MCP 服务调用配置新增 `async_tools` 字段（缺省 = 不启用）：

```jsonc
// mcp-services.json（平台侧，admin-backend）
{ "async_tools": [] }                      // 缺省语义：本服务无异步工具（存量行为零变化）
{ "async_tools": ["submit_ocr"] }          // 仅列出的**原始工具名**（不含 {server}__ 前缀）
```

| 环节 | 判据 | 非法处理 |
|---|---|---|
| 平台保存期（`admin-backend`） | 必须为数组；元素为非空字符串；**同服务内去重** | `VALIDATION_FAILED` |
| 物化（`materialize.ts`） | **非空才写**进 `MCP.json` 的 `servers[].async_tools`（对齐 `file_args`/`rules_fields` 口径） | — |
| 运行环境加载期（`agent-instance.ts`） | 形状非法即抛 `AgentConfigError`（把 typo 挡在加载期，不静默当空） | 该数字人整体不可用 |
| 装配期（`agent-factory` / `mcp-tool-adapter`） | 命中声明的工具，其 `inputSchema` **MUST** 声明 `result_url` 参数；缺失即**告警**（否则"配了但服务收不到回写地址"会静默失效） | 告警不阻断（服务侧尚未改造时不至于整只数字人不可用） |

**注入时机**：命中声明的工具，在 `execute` 内**仿 `injectRuntimeContext`** 注入 `result_url`（运行环境提供的值、覆盖模型填写、**对 LLM 隐藏**——`exposeSchema` 同款处理）。注入位置见 §10.6 不变式 2。

### 10.3 回写通道（新端点）

服务算完后把结果 POST 回运行环境——这是**既有"签名读直链"（`GET /api/files/raw`）的镜像**，复用同一密钥（`fileSignSecret`）与同一验签设施：

**`POST /api/files/put?u={userId}&d={dir}&exp={ts}&sig={hmac}&filename={名字}`**（body = 结果字节）

| 参数 | 规定 |
|---|---|
| `u` | 归属用户（签名绑定，篡改即验签失败） |
| `d` | **允许写入的目录**（user-data 相对路径）；试点固定 `临时空间/后台产出` |
| `exp` | 过期时刻；**MUST ≥ 任务最长时长**（否则服务算完发现票已过期） |
| `sig` | HMAC-SHA256 |
| `filename` | 由服务提供；**不含路径分隔符、不含 `..`、非空** |
| `summary` | **由服务提供**的一行摘要（面向人可读，如"识别到 47 行文字"）；**可缺省**；不参与验签；长度上限 200 字符（超出**截断**而非拒绝——一次已经算完的任务不该因为摘要过长而失败） |

**签名 payload MUST 与读方向隔离**——读方向**保持既有三段格式不变**（零存量影响），写方向用**四段新格式**：

```
读（不变，三段）：{userId}\n{relPath}\n{exp}
写（新增，四段）：put\n{userId}\n{dir}\n{exp}
```

> 必要性：若写方向沿用读方向的形状，一张"读某文件"的签名即可被用于"**写**该文件"，权限被放大。
> 段数不同（3 vs 4）⇒ 两种 payload **不可能碰撞**；而读方向格式不变 ⇒ **存量签名 URL 全部继续有效**（不会出现"改动后 24h 内正在回源的调用被 403"）。

**归属提示参数**（2026-09-25 补口径——初稿只定义了签名覆盖的四个参数，未规定 `sid` / `call_id` / `tool` 的来源，而 §10.4 的 sidecar 与落盘前缀都依赖它们）：

| 参数 | 含义 | 谁填 |
|---|---|---|
| `sid` | 发起该任务的会话（= `thread_id`）；决定落盘文件名的 `{prefix}` | 运行环境铸造 URL 时预置 |
| `call_id` | 关联那次"已受理"的工具调用（前端挂载点） | 同上 |
| `tool` | 运行环境侧工具全名（含 `{server}__` 前缀） | 同上 |

服务侧**只需原样回传**（把收到的 `result_url` 直接 POST，或在其上追加 `filename`），**无需理解这三个参数**。

**`sid`/`call_id`/`tool` 不参与验签**：决定"写到**哪个用户的哪个目录**"的字段（`u` / `d` / `exp`）全部在签名内；只决定"这条产出**怎么归档**"的字段在签名外——与 `filename` 同一处置，篡改它们只影响元数据与文件名前缀，**不构成越权**（用户由 `u` 锁定、子目录由 `d` 锁定）。

**`job_id` 的确定**（2026-09-25 补口径）：取自 `filename` 的**主干**（去掉扩展名）。服务回写 `filename=j_123.json` ⇒ 落盘 `{prefix}_j_123.json`、sidecar `{prefix}_j_123.meta.json`、`job_id = j_123`（与 §10.4 的 `{prefix}_{jobId}.{ext}` 布局同一件事的两种写法）。

**落盘**：平台校验文件名后，补 `{prefix}_` 前缀（`prefix = sid ?? uid`；`sid` 缺失或非法时回退 `uid`）写入 `{user-data}/{d}/{prefix}_{filename}`；写入走 `FileAccess` 的**受控子目录写入**（新增方法，agent 的 `write_file` 权限不变，见 §10.6 不变式 4）。

**响应**：`202 { "path": "临时空间/后台产出/th_x_j_1.json", "size": 1234 }`

| 错误码 | 状态 | 语义 |
|---|---|---|
| `FILE_SIGN_INVALID` | 403 | 签名无效或已过期（与读直链同码） |
| `VALIDATION_FAILED` | 400 | 文件名非法（含分隔符/`..`/空）或目录不在允许范围 |

**幂等**：验签无状态（不查库），同一 URL 在有效期内可重放；同名重复写入即覆盖，**幂等无害**。缓解面靠**时效短 + 目录范围窄**。

### 10.4 产出存储

**位置**：`users/{uid}/user-data/临时空间/后台产出/`

```
{prefix}_{jobId}.{ext}          ← 结果正文（扩展名由服务决定）
{prefix}_{jobId}.meta.json      ← 元数据 sidecar（运行环境生成）
```

**元数据字段**（sidecar）：

| 字段 | 必需 | 说明 |
|---|---|---|
| `job_id` | ✅ | 服务侧任务号（幂等键、状态查询的键） |
| `uid` | ✅ | 归属用户 |
| `sid` | 建议 | **发起该任务的会话 = thread_id**；决定产出能否"接回"某次对话 |
| `call_id` | 建议 | 关联那次"已受理"的工具调用（前端挂载点） |
| `tool` | ✅ | 运行环境侧工具全名（含 `{server}__` 前缀） |
| `created_at` / `finished_at` | ✅ | 提交时刻 / 回写时刻 |
| `status` | ✅ | `done`（回写即完成）；失败由服务侧状态查询工具给出，不落此文件 |
| `summary` | 建议 | 一行摘要（列表展示 + 清单注入省 token） |
| `size` / `filename` | ✅ | 正文体积与文件名 |
| `read_at` | 可选 | **已读时刻**（2026-09-25 新增，见 §10.5 ⑤）：缺省 = **未读**。MUST 写在**本 sidecar 内**、与产出**同生命周期**——随产出一起被清理，未读数因此自然归零；MUST NOT 另立独立文件（否则会漂移出"未读数 > 0 而列表为空"的悬空状态） |

**用 sidecar 而非单一 `index.jsonl`**：**不漂移**——正文与元数据同目录同生命周期，被清理时一起消失，不产生"列表里有、点开是空的"悬空引用。

**生命周期**：随临时空间既有规则（7 天未访问清理）。该规则 MUST **覆盖本二级目录**——`tmp-cleanup.ts` 原先只扫 `临时空间/` 下的**顶层文件**、子目录被直接跳过（2026-09-25 补口径，实现内同步修正），否则"随临时空间清理"这句不成立。清理口径与顶层一致（`max(atime, mtime)` 超 7 天即删，正文与 sidecar 同生命周期、一起消失）。若产出需要长期留档，MUST 换落点（本特性不做）。

### 10.5 消费侧

**① SSE 信号**（`GET /api/produced/events`）

- 事件名 `produced`，**负载为空**（信号语义：只表示"产出可能已变"）
- 形态照抄既有 MCP 状态推送：建连即推一次 → 之后按 `userId` 过滤推送 → 25s 心跳 → 关闭时退订
- **信号丢失无后果**：产出物本身是文件，"有哪些"可从目录**重算**；离线期间到达的产出在下次打开页面时由列表接口读出

**② 产出列表**（`GET /api/produced?limit=50`）

```jsonc
{ "items": [ { "job_id": "j_123", "sid": "th_9f8e", "tool": "ocr__submit_ocr",
               "filename": "th_9f8e_j_123.json", "size": 1843200,
               "summary": "识别到 12 页产能表", "status": "done",
               "agent_name": "生产调度助手",
               "created_at": "…", "finished_at": "…" } ] }
```

- `agent_name`（2026-09-25 新增）为**查询期联结字段**：由运行环境按 `sid` 反查该会话 meta 的 `agent_name`。**MUST NOT 落 sidecar**——会话可跨数字人，`agent_name` 是其**最近一轮**取值，落盘即第二份会漂移的真相（原则五）。`sid` 缺失、或会话 meta 不存在/损坏（对话已删除）时该字段**缺省**，界面显示"未知"；`GET /api/produced` 不因此报错。

**③ 提示词注入**：正文池组装时，扫产出目录取最近 N 条，拼进 `systemExtra`（与「工具结果索引」并列、措辞一致）：

```
【后台计算结果】（需要内容时用 read_file 按路径读取）
- ocr__submit_ocr · 2 分钟前 · 已完成 · 128 KB · 临时空间/后台产出/th_9f8e_j_123.json
```

- 清单是**每轮现算的投影，不落盘索引**（目录即索引）
- **无产出时该段长度为 0**（不占一个字符）
- **只注入当前会话的产出**（`sid === thread_id`）：产出目录是**用户级**的，而 sidecar 的 `sid` 记录了"哪次对话提交的它"——不过滤就会把别的对话的任务结果污染进本轮上下文。`GET /api/produced` 则返回该用户的**全部**产出（界面自行按会话呈现）（2026-09-25 补口径）
- 正文**按需 `read_file` 读取**，MUST NOT 把产出正文直接注入提示词（结果可能数 MB）

**④ 任务状态查询**：由**服务侧**提供工具（如 `get_job_status` / `list_jobs`），模型按需调用；**平台不维护任务表**。理由：状态真源在服务侧（只有它知道进度与失败原因），且服务不可用时调用本身的失败即为信号。

**⑤ 已读状态与未读提示**（2026-09-25 新增）

**语义**：产出是**用户级**的，"已读"记录的是**用户本人看没看过**——与模型是否读过产出**无关**（模型读不读由 ③ 的提示词注入决定，不影响未读数）。

| 项 | 规定 |
|---|---|
| 判定 | sidecar 的 `read_at` **缺失 = 未读**；存在 = 已读 |
| 存储 | **写在 sidecar 内**（与产出同生命周期，见 §10.4）——清理产出即清理已读状态，未读数自然归零 |
| 标记时机 | **用户点开某条产出查看时**标记该条已读。**打开列表本身不标记**（否则"未读"无从表达、角标永远是 0）。任何查看入口（铃铛面板／对话内工具卡片）MUST 调用**同一个**标记接口，保证两处状态一致 |
| 未读数 | **由界面自算**（列表项里未读的条数），**不新增计数端点、不落额外状态**（原则五：目录即索引） |
| 首次上线 | 存量产出没有 `read_at` ⇒ **一律视为未读**（不做数据迁移；用户点开即清） |

**新增端点**：`POST /api/produced/read`（批量标记已读）

```jsonc
// 请求
{ "job_ids": ["ocr_1790…_8bcccfd2"] }
// 响应 200
{ "marked": 1 }   // 实际写入 read_at 的条数
```

- **批量**：界面一次提交全部待标记的 `job_id`，避免逐条写文件；
- **幂等**：对已标记过的条目重复调用 MUST 无害（**不改动**原有 `read_at`）；
- **不存在的 `job_id` 一律忽略**（产出可能已被 7 天清理）——这不是调用方的错误，不报错，只体现在 `marked` 的差值里；
- **错误码**：`VALIDATION_FAILED`（缺 `job_ids`，或元素为空字符串）。
  （`job_ids` 为标量时由 Fastify 的 ajv 按既有约定**强转为单元素数组**，与其它端点一致，本端点不另立规则。）

**⑥ 界面形态**（2026-09-25 新增）

| 元素 | 规定 |
|---|---|
| 入口 | 对话工作台**右上角铃铛**（`ChatHeader` 的按钮位之一），带**未读角标**（数字；0 时**不显示**） |
| 在线更新 | 订阅 `GET /api/produced/events`：收到信号即**重拉一次列表**并重算未读数（**不轮询**） |
| 离线补齐 | **打开页面时主动拉一次列表**——信号丢失无后果（①），未读数由列表现算 |
| 面板内容 | 每条：**工具名** / **数字人名称**（由 `sid` 反查 `agent_name`，缺省显示"未知"）/ **状态**（sidecar `status`，**原样透出、不翻译**；回写即 `done`）/ **创建时间**（`created_at`，绝对时间）/ **完成时间**（`finished_at`，绝对时间）/ 摘要（`summary`；缺省时给一句话兜底而不是留白）/ 体积 / **发起它的会话**（由 `sid` 反查）；**未读条带叹号**（2026-09-25 扩充元信息） |
| 查看 | 点开 → **面板内切到正文视图**，**同样显示上述元信息**并附加正文（数据来自 ⑦ 的 `GET /api/produced/raw`，正文可能数 MB，走上限拦截），并**同时标记已读**（叹号消失、角标递减）。正文**默认结构化展示**（JSON 对象 → 键值行、对象数组 → 表格、其他数组 → 列表；可**一键切回原始 JSON**），解析不了时**回落原样 `<pre>`**（2026-09-26 补）。**不复用右侧文件预览**：那个端点的 `dir` 是空间顶层目录，装不下二级产出目录（2026-09-25 实测踩过：误把 `relPath` 当 `dir` 传 → `VALIDATION_FAILED`） |
| 跳转 | 由 `sid` 跳转到发起它的那次对话（可选增强，不影响上述语义） |

**⑦ 产出读取**（`GET /api/produced/raw?job_id=…`，2026-09-25 新增）

界面要"点开看正文"，但**不能走 `files` 系列接口**：它们的 `dir` 语义是**空间顶层目录**（`数据准备` 的二级目录还须命中 `scenario.json` 清单），而产出落在**二级目录** `临时空间/后台产出/`。因此产出**以自己的身份（`job_id`）读取**：

| 项 | 规定 |
|---|---|
| 定位 | 按 `job_id` 在产出目录内查找（**无界**，不受列表 50 条上限影响——界面可能点开更旧的条目）。查不到 → 404 `FILE_NOT_FOUND`，与"已被 7 天清理"**同一语义**（界面据此给可读降级，MUST NOT 报成通用错误） |
| 返回 | 结果字节；`content-type` **固定** `text/plain; charset=utf-8` + `x-content-type-options: nosniff`——**不按扩展名推断**，避免产出内容被浏览器当作 HTML 等主动内容渲染 |
| 上限 | 超 `previewMaxMb` → 413 `FILE_TOO_LARGE`（与预览同口径） |
| 解析边界 | 正文**原样返回**。**前端 MAY 解析它用于展示**（结构化渲染、按需取名）；解析失败、是标量、或超展示阈值时 **MUST 回落原样 `<pre>`**（展示层不得因解析失败而白屏）。**运行环境服务端 MUST NOT 解析正文**——存储、列表投影、提示词注入、清理一律当**不透明文本**；展示层解析 **MUST NOT** 参与权限判定、清理决策或任何服务端行为（只影响界面呈现）（§10.3、§10.6 不变式 8）（2026-09-26 补） |
| 续命 | 读取**算一次访问**：刷新临时空间的访问时间（与"7 天未访问清理"一致）；**列表扫描则不续命**（§10.4，否则产出永不清理） |

### 10.6 不变式（MUST 由单测守住）

1. `async_tools` 缺省/空数组时，行为与改造前**完全一致**——不注入 `result_url`、不产生产出目录、不依赖任何新端点；
2. `result_url` 的注入发生在 `execute` 内部、**HITL 挂起之后**——签名 URL MUST NOT 出现在 `interaction_request` 的 `proposed_args` 快照里；
3. **读写签名 payload 形状隔离**（读三段、写四段）：读签名 MUST NOT 能用于写；且**读方向格式不变**，存量签名 URL 零失效；
4. 产出落盘走 `FileAccess` 的受控子目录写入（顶层白名单 + 无 `..` + 目录真实存在 + 文件名前缀校验），MUST NOT 绕过文件安全层；agent 的 `write_file` 权限**不变**；
5. 产出清单是每轮现算的投影，**无产出时该段长度为 0**；产出正文 MUST NOT 被自动注入；
6. 声明了 `async_tools` 但服务 schema 未声明 `result_url` → **装配期告警**（不静默失效）；
7. **已读状态与产出同生命周期**：已读标记 MUST 写在 sidecar 内、随产出一起被清理，未读数随之归零——MUST NOT 出现"未读数 > 0 但列表为空"的悬空状态（这正是"已读状态不另立独立文件"的理由）；且**打开列表不标记已读**，只有**点开某条查看**才标记（§10.5 ⑤）。
8. **解析边界（2026-09-26 补）**：正文是**不透明文本**——**运行环境服务端 MUST NOT 解析**它（存储/投影/注入/清理均不解析）；**前端 MAY 为展示而解析**（结构化渲染），但 **MUST** 在解析失败/标量/超阈值时**回落原样展示**，且展示层解析 **MUST NOT** 参与权限判定、清理决策或任何服务端行为——它只影响**界面如何呈现**。
9. **服务侧结果形状（2026-09-26 补）**：服务返回（同步返回与异步回写 body）**MUST** 是标准 JSON，且 **`status` 取值域恒为 `"success"` / `"failed"`**——业务细分码（如 `80`/`2`/`90`）MUST 放独立字段（建议 `code`）。平台与界面 **MUST NOT** 对 `status` 做取值映射，也 **MUST NOT** 因某个服务的业务码差异而分支判读（§10.7）。

### 10.7 服务侧契约（`ocr-service` / `jev-service`；结果形状 2026-09-26 统一为标准 JSON）

**范围**：**异步能力**只加在 `ocr-service` 的 `ocr_image` 一个工具上——异步是**按工具声明**的能力，未声明的服务/工具**行为**零变化；第三方 MCP 服务一律不动。

**结果形状统一（2026-09-26）**：`ocr-service` 与 `jev-service` 的工具返回（同步返回；若有异步则为回写 body）**MUST 是标准 JSON**，**MUST NOT 用自然语言纯文本**；且**成功与失败形状一致**，都以 `status` 判读：

| | 形状 |
|---|---|
| 成功 | `{"status":"success", …该工具的业务字段}` |
| 失败 | `{"status":"failed","message":"<可读原因>"}` |

- **`status` 取值域 MUST 只有 `"success"` / `"failed"`**（2026-09-26 统一）：平台与界面**不做任何映射**，直接据此判成败。业务细分状态（如排产的 `80` / `2` / `90`）MUST 放**独立字段**（建议 `code`），MUST NOT 挤进 `status`；
- 该约束**同样适用于异步回写 body**（见《异步 MCP 服务接入约定》§4.3）：body 的 `status` 亦是 `success|failed`，业务码在 `code` 里；
- 既有用**数值型 `status`** 的服务（如排产 `80/2/90`）**MUST 改造**为 `{"status":"success"|"failed","code":80|2|90,…}`（其余业务字段不变）。

各工具的成功结果：

| 工具 | 成功结果（示例） |
|---|---|
| `ocr__ocr_image` | `{"status":"success","message":"识别到 12 行文字","text":"…多行识别文字…"}` |
| `jev__noul` | `{"status":"success","type":"noul","noul":0.95}` |
| `jev__choice` | `{"status":"success","type":"choice","choice":"billing","confidence":0.81,"probabilities":{…}}` |
| `jev__score` | `{"status":"success","type":"score","score":1.05,"confidence":0.92,"legend":{…},"probabilities":{…}}` |

- `jev-service` **当前没有异步路径**（三个工具未声明 `result_url`），本次只改其**同步返回**——此前**失败路径返回的是纯文本错误文案**（`str(JevError)`），与成功的 JSON 形状不一致，调用方要靠"是不是自然语言"猜成败；
- 失败原因仍是**面向人可读**的中文文案（宪章原则九：降级可感知），只是改由 `message` 字段承载；
- **平台侧零改动**：平台仍"原样存、原样读"（§10.3），JSON 的价值在于人与模型读到即可判读；
- 两个服务的镜像都需**重建**才生效：`docker compose up -d --build ocr jev`（`up -d` 不会重建镜像）。

**工具签名变化**（`ocr_image` 新增一个**可选**参数）：

| 参数 | 必填 | 说明 |
|---|---|---|
| `image` | ✅ | 不变 |
| `result_url` | ❌ | **结果回写地址**。由平台在把该工具声明为异步时**自动注入**（且对 LLM 隐藏）；缺省/空 = **同步模式** |

**结果形状（标准 JSON，2026-09-26 起；同步返回与异步回写为同一份形状）**：

```jsonc
{
  "status": "success" | "failed",  // success = 拿到了可用文字；failed = 其余（下载/解码失败、图片无文字、回源地址不可信）
  "message": "识别到 12 行文字",     // 一行给人看的结论；失败时就是错误原因
  "text": "…多行识别文字…"          // 失败时恒为空串
}
```

- **MUST NOT** 用纯文本作结果：成败与原因必须可被结构化判读（此前是"成功给文本、失败给一句话"，调用方需靠猜）；
- 平台对本 JSON **仍不解析**（§10.3"原样存、原样读"）——它的价值在于**人和模型读到即可判读**，以及给摘要提供稳定的取值来源。

**两条路径**（`result_url` 即开关，服务侧无需第二个配置）：

| `result_url` | 行为 |
|---|---|
| 缺省 / 空 | **同步**：校验 → 下载 → 识别 → 返回**上述 JSON 文本** |
| 有值且通过 host 白名单 | **异步**：**立即返回受理** `{"job_id":"…","status":"accepted","message":"…"}`；识别在后台线程进行，完成后把**上述 JSON** `POST` 回 `result_url` |

**回写形状**：`POST {result_url}&filename={job_id}.json`，body = **标准 JSON**（utf-8，`content-type: application/json; charset=utf-8`）。`job_id` 形如 `ocr_<毫秒时间戳>_<随机 8 位>`（时间戳在前便于人眼排序，随机后缀防同毫秒碰撞）。落盘名由运行环境补 `{prefix}_` 前缀 ⇒ `{prefix}_ocr_….json`（§10.3/§10.4 口径）。

**失败也要回写**：识别失败（下载/解码/无文字）**MUST 照常回写** `status="failed"` 的结果——不回写的话界面上什么都不出现，用户无法区分"还在算 / 失败了 / 挂了"（与 §4.4 同一口径）。

**摘要口径**（`summary` 参数，决定界面标题）：失败 → `message`（错误原因）；成功 → `text` 的**首个非空行**。限 200 字符。

**安全（MUST）**：`result_url` **MUST** 过与回源下载**同一份** host 白名单（`OCR_URL_ALLOW_HOSTS`）——否则一个被模型幻觉出来、或被篡改的 `result_url` 就能让本服务向任意主机发 POST（**SSRF**）。未通过校验时**忽略该参数并降级为同步**，且在返回文案里说明（不静默）。

**可测性**：结果形状构造、受理响应构造、回写 URL 拼装（保留原有 query）、`job_id` 生成与 `POST` 回写都放在 `ocr_core`（**不依赖模型**），单测在宿主机本地跑（原则三）。

### 10.8 跨会话找回产出：`list_dir` 可用目录（2026-09-25）

**问题**：产出清单只注入**发起会话**（§10.5 ①，`sid === threadId`）。换个会话问，模型既看不到清单、也不知道产出落在哪里——文件在、权限也够，但对模型而言是"**门没挂牌子**"。

**处置（只改"可见性提示"，隔离与权限一字不动）**：

| 项 | 规定 |
|---|---|
| 可用目录清单 | 运行期清单（`domain/dirs.ts` 的 `listAvailableDirs`）在**末尾**追加 `临时空间/后台产出`，从而进入 `list_dir` 说明文本（`{可用目录}` 占位符的运行期取值）。模型据此可自行 `list_dir` → `read_file` 取回别会话的产出 |
| 注入过滤 | **MUST NOT** 放宽（§10.5 ①）：跨会话产出**仍不自动进上下文**，只由模型**按需**列出与读取 |
| 权限 | **MUST NOT** 新增：产出目录本就在 `FileAccess` 白名单内（顶层是 `临时空间`，`resolveSafe` 对临时空间**不限二级目录**），此前即可读——本次**只是告知**，不改变任何校验 |
| 追加位置 | **MUST** 追加在**末尾**：`{示例路径}` / `{首个目录}` 两个占位符取 `availableDirs[0]`，末尾追加可保证这两处取值**逐字不变**（§1.4 的等价不变式因此不受影响） |

**与文件浏览 API 的口径差异（刻意，MUST NOT "修一致"）**：管理端/前端的文件浏览走 `parseSpaceDir`，口径是"**非数据准备空间不支持二级目录**"——`临时空间/后台产出` 在那条链路上会被判 `400`。两者差异是**有意**的：产出是运行环境的内部产物，只对模型的**内置工具**（`read_file` / `list_dir` / `grep_files`，均经 `FileAccess`）开放，不进管理端文件浏览。

**管理端工具目录不受影响**：`/api/admin/builtin-tools` 仍以 `{可用目录}` **模板形态**呈现（`FR-012`、`SC-014`），MUST NOT 替换为具体取值（`tests/integration/builtin-tools.spec.ts` 已守住该约束）。
