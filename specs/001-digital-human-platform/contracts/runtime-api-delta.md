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
| `POST /api/threads/:id/messages` 的 `attachments` 校验 | 同一引用在不同数字人下可能合法/非法，按**本轮数字人**判定 |
| `SCENARIO_NOT_CONFIGURED`（503） | 错误码不变，message 改为指名数字人 |

**平台侧的对应约束**：部署 MUST 把 `scenario.json` 写入**该数字人目录内**（`FR-026`），MUST NOT 依赖任何用户级共享配置文件（`data-model.md` §8）。

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
    proxy_pass http://admin-backend:3000;
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

新增两个服务（`research.md` D2/D3）：

```yaml
  admin-backend:
    build: ./admin-backend
    container_name: optagent-admin-backend
    environment:
      - PUBLIC_BASE_URL=http://admin-backend:3000   # 若需要
    volumes:
      - ./platform-data:/app/platform-data           # 平台设计态（读写）
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
