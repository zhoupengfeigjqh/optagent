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
| R9 | HITL 参数确认窗**算法规则选择**：MCP 服务配置新增 `rules_fields`（`{ 工具名: 字段名 }`，当日由 string 版 `rules_field` 升级），`interaction_request`/快照新增可选 `rules_field`（单次交互粒度投影），新增 `GET /api/files/rules`（只读） | 新增端点 + 配置字段 + 可选事件字段 | 否（`rules_fields` 缺省 `{}` 不启用，存量快照不写该键；历史 string 版存档读取收敛为 `{}`） |

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

### 1.4 本期目录内容（共 5 项，行为 MUST 与现状等价）

| `name` | `label` | `writable` | `description_template` |
|---|---|---|---|
| `read_file` | 读取文件 | `false` | 读取用户空间（数据准备/共享空间/临时空间）下的文件内容。支持 .csv/.xlsx/.txt/.json/.pdf/.md/.log；xlsx 自动转 CSV，pdf 提取文本层。大文件返回截断内容，可用 offset 继续分段读取。参数 path 为相对空间的路径，如 "{示例路径}"。 |
| `write_file` | 写入临时文件 | **`true`** | 把内容写入临时空间，文件名会自动要求以 "{会话标识}_" 开头。数据准备与共享空间为只读，写入会被拒绝。写成功后可用路径 临时空间/{filename} 告知用户下载。 |
| `list_dir` | 列目录 | `false` | 列出指定目录的文件（名称/大小/更新时间）。目录限：{可用目录}。 |
| `grep_files` | 检索文件内容 | `false` | 在文本类文件（.csv/.txt/.json/.md/.log）中按正则检索关键词；xlsx/pdf 会被跳过（请改用 read_file）。可指定目录，缺省检索全部开放目录。 |
| `calculator` | 计算器 | `false` | 计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/round/floor/ceil/min/max/pow 函数与常量 pi/e。 |

**不变式（MUST 由单测守住）**：`renderTemplate` 用现状的运行期取值渲染后，结果 MUST 与改造前 `buildBuiltinTools` 产出的 `description` **逐字相等**。这是本重构的安全性保证——改造**只改变元数据的组织方式，不改变任何对模型可见的文本**。

### 1.5 入参说明

`parameters` 沿用现状的 JSON Schema 字面量（含 `required` 与 `description`），不做语义改动。注意现状中 `parameters` 带 `as never` 断言（因 `AgentTool` 的类型未暴露该字段）——迁入纯数据目录后可去除该断言，属**类型层改善**，不影响运行期行为。

---

## §2 R2 — 新增 `GET /api/builtin-tools`

**用途**：向管理平台提供**可枚举的内置工具目录**（`FR-011` 的唯一来源）。

**归属**：`agent-backend/src/routes/`，与既有路由同构注册（`registerBuiltinToolRoutes(app, ctx)`），前缀沿用 `/api`。

**请求**：无参数（工具数固定为 5，无需分页；响应仍带 `total` 以保持形态一致）。

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

平台需按服务统计 MCP 的累计调用次数、成功/失败次数与最近调用时间，且 MUST **在数字人实际调用后自动更新**。运行环境是**唯一确切知道工具调用发生的地方**；日志解析不可靠（各 MCP 服务日志格式自定，"HTTP 请求数"≠"工具调用次数"）——见 `research.md` D6。

### 4.2 计数点

在 MCP 工具适配层（工具调用完成处）按**服务名**累计：成功一次 `calls_ok += 1`，失败一次 `calls_failed += 1`，并更新 `last_called_at`。事件明细（`mcp_call_events`，一次调用一行）同时记录**调用发起用户** `user_id`——取自强制穿透的运行上下文 `uid`（七次调整已保证运行环境侧必可得），供按用户明细聚合（十四次调整，2026-09-16）。计数持久化到既有 `UsageDb`（`better-sqlite3`）——**不引入新依赖、不新增数据库引擎**（原则六）；`user_id` 列对旧库**打开即自愈**（`PRAGMA table_info` 判定后 `ALTER TABLE ADD COLUMN`）。

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
      "last_called_at": "2026-09-15T06:12:33.000Z",
      "windows": {
        "h24":  { "ok": 3, "failed": 1, "total": 4 },
        "d7":   { "ok": 12, "failed": 2, "total": 14 },
        "d30":  { "ok": 30, "failed": 2, "total": 32 },
        "d365": { "ok": 40, "failed": 2, "total": 42 }
      },
      "users": [
        { "user_id": "admin", "calls_total": 30, "calls_ok": 29, "calls_failed": 1, "last_called_at": "2026-09-15T06:12:33.000Z" },
        { "user_id": "zpf",   "calls_total": 12, "calls_ok": 11, "calls_failed": 1, "last_called_at": "2026-09-14T09:00:00.000Z" }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `stats_available` | boolean | 统计存储是否可读；为 `false` 时 `items` 为空 |
| `items[].calls_total` | integer | 累计调用次数（= `calls_ok + calls_failed`） |
| `items[].last_called_at` | string \| null | 最近调用时间（ISO8601），从未调用为 `null` |
| `items[].windows` | object | 按时间窗聚合（任务 2026-09-15）：`h24`（最近24h）/ `d7`（最近7天）/ `d30`（最近30天）/ `d365`（最近一年），每窗 `{ ok, failed, total }`。数据源为**每次调用一行**的事件明细表 `mcp_call_events`（只保留一年，与最长统计窗对齐），MUST NOT 从日志文件解析 |
| `items[].users` | array | 按用户的调用明细（十四次调整，2026-09-16）：每项 `{ user_id, calls_total, calls_ok, calls_failed, last_called_at }`，在事件明细表上按 `user_id` 聚合（故只覆盖**最近一年**，与 `windows` 同口径）；`user_id` 为 `null` 表示升级前的历史事件未记录归属（平台侧显示"未归属"）；服务无事件明细行时为空数组 |

**关键约束**：
- **只读**，无副作用。
- 统计口径为 **MCP 工具调用次数**（`research.md` D6），MUST 与本契约一致，MUST NOT 在未来悄悄改为"HTTP 请求数"。
- 未出现过的服务**不出现在 `items` 中**（平台侧以 0 呈现）。

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
| 实例仅在**空闲超时**（`IDLE_TIMEOUT_MS`，默认 10 分钟）或**池满 LRU** 时被回收 | `agent-pool.ts` 的 `evictIdle` / `lruEvictOne` |
| **没有任何**配置变化检测（无 `mtime` 比对、无失效接口、无版本号） | 全模块搜索 `mtime`／`invalidate`／`reload`／`statSync` 均无命中 |

**后果**：部署生效后，只要池中已有该数字人的实例，**新对话会继续使用旧配置**——最长可达 10 分钟。症状是"我明明部署了，数字人却没变"，且**不报任何错**，属最难排查的一类静默缺陷。

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
| 缩短 `IDLE_TIMEOUT_MS` | 只是把"最长 10 分钟"改成"最长 N 秒"，**没有解决**"立即生效"，且会显著增加实例重建开销（MCP 重连、模型重载） |
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

**2026-09-19 新增 `rules_fields`**（HITL 规则选择器声明，配合 R9；当日由 string 版 `rules_field` 升级为按工具映射）：MCP 服务调用配置的可选字段，形状 `{ 工具名: 字段名 }`——声明该工具入参里承载 `array[object]` 规则清单的字段。语义边界：

- **不改变是否走 HITL**——是否弹参数确认窗仍只由 `confirmation` 决定；`confirmation: never` 时参数由模型直接填写，`rules_fields` 不生效（无挂起点即无快照即无入口）；不在确认范围内的工具的映射同样不生效（工具未被包装）；
- 装配时按**当前工具名**查映射，且该工具 schema 确实含此字段时，运行环境把字段名带进 interaction 快照（快照内仍叫 `rules_field`，单次交互粒度的投影）；
- 物化口径与 `confirmation` 相同：空对象不写该字段；平台侧保存期校验（非对象/值非非空字符串即 `VALIDATION_FAILED`），运行环境加载期校验（非法即 `AgentConfigError`）；历史存档的 string 版 `rules_field` 读取时收敛为 `{}`；
- 管理端表单联动（产品决定，2026-09-19）：该设置独立成栏、位于 HITL 栏之下并与「URL铸造参数设置」平级；HITL = 无需确认 → 栏禁用且所填清空；仅指定工具 → 工具列只列勾选工具、清单外声明级联清掉；全部工具 → 全部可选。「字段」下拉 = 该工具参数 Schema 中 `type: "array"` 的入参。

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
  "rules_field": "rules"        // 可选（R9）：服务按工具声明（rules_fields 映射）且
}                               //       工具 schema 含该字段时才有；快照内为单次交互投影
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
- 控件映射：`enum→下拉`、`boolean→开关`、`integer/number→数字输入`、`string→输入框`（description 含「多行」→ 多行文本）、`object/array→JSON 文本`；required 标星 + 本地校验；
- 倒计时取 `timeout_seconds`，归零按拒绝关闭；终验失败展示后端逐字段错误并保持弹窗。

### 9.7 算法规则选择（R9，2026-09-19）

**交互**：HITL 参数确认窗中，快照声明了 `rules_field` 的 JSON 字段旁渲染「从算法规则选择」按钮（未声明不渲染）；点击弹结构化表格——列 = 最新规则文件表头，行首勾选，**优先级列（表头匹配 `priority`/`优先级`）就地编辑**（数字文本转数字，留空则不携带该键），其余列只读；确认后勾选行原样生成 `array[object]`（**键 = 表头列名，值 = 该行该列的值**）写回 JSON 编辑框（可再手改），提交仍走 §9.4 服务端终验。

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
