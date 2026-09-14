# Data Model: 数字人Agent对话后端

> 实体来源：spec.md「Key Entities」+ req_final.md。
> 存储分两类：**文件系统**（`.opt-agent/`，用户数据与对话）与
> **SQLite 全局单库**（usage.db，Token 用量）。运行期内存对象单列一节。

## 1. 用户（User）

本期固定内置 `admin`；所有访问经 `current-user` 抽象取 `user_id`。

| 字段    | 类型   | 说明                                             |
| ------- | ------ | ------------------------------------------------ |
| user_id | string | 用户标识；目录维度 `.opt-agent/users/{user_id}/` |

**校验/规则**：目录惰性创建（首次使用时建）；JWT 接入后 user_id 来自 token，
业务层不感知（FR-002）。

## 2. 数字人配置（AgentConfig，只读）

路径：`.opt-agent/users/{user_id}/agents/{agent_name}/`

| 字段          | 来源文件                 | 说明                                                                                   |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| agent_name    | 目录名                   | 标识                                                                                   |
| soul          | `SOUL.md` 全文           | 人格/语气，追加到 System Prompt                                                        |
| skills        | `skills/{name}/SKILL.md` | 仅解析 **YAML frontmatter**（name/description 等）追加到 System Prompt；技能实现不加载 |
| enabled_tools | `TOOL.json`              | 从 6 个内置工具中声明启用                                                              |
| mcp_servers   | `MCP.json`               | 外部 MCP 服务声明（含传输方式 stdio/http、命令/URL、权限边界声明）                     |

**校验/规则**：后端只读（FR-012）；配置文件缺失/损坏 → 该数字人不出现在列表，
记告警日志；`MCP.json` 中含写能力的服务必须有权限边界声明（FR-024）。

## 3. Agent 实例（AgentInstance，内存对象，不落盘）

key = `(user_id, agent_name)`。**不持有对话历史**（FR-013）。

| 字段           | 说明                                              |
| -------------- | ------------------------------------------------- |
| key            | `{user_id, agent_name}`                           |
| system_prompt  | soul + skills frontmatter 拼装产物                |
| tools          | 已启用的内置工具（经 file-access 代理绑定）       |
| mcp_clients    | MCP 连接集（含 `unavailable: string[]` 降级标记） |
| llm_client     | LlmProvider 引用（全局单例即可）                  |
| active_threads | 进行中的 run 数（判定"空闲"依据）                 |
| last_active_at | 空闲超时（10min）与 LRU 排序依据                  |

**状态流转**：

```
[创建] --首次消息触发--> 就绪（含降级就绪：部分 MCP 不可用）
就绪 --最后活跃超 10min 且无活跃 run--> [回收]
就绪 --LRU 淘汰（仅空闲实例）--> [回收]
就绪 --未知异常崩溃--> [销毁]（记崩溃日志，下次发消息重建）
```

**MCP 建连时机（保首字延迟指标 SC-001）**：实例创建**不等待 MCP 建连**——
System Prompt/工具/LLM 就绪后即进入可用状态，MCP **异步并发建连**；
建连完成前或失败的 server 标记 `unavailable`，调用到走降级提示。
（避免 30s 建连超时击穿 5s 首字延迟。）

**容量约束**：全局 ≤5（可配）；池满且无空闲可淘汰 → 409 拒绝（FR-015）。

## 3.1 用户当前选中数字人（内存状态）

| 字段                 | 说明                                   |
| -------------------- | -------------------------------------- |
| user_id → agent_name | 进程内 Map；`select` 写入（**覆盖式**）、`exit` 清除 |

**规则**（**2026-09-10 修订**）：1 用户同时最多选中 1 个数字人；`select` 为覆盖式——
选中另一个**直接覆盖**，**无需先 exit**（原 409 `AGENT_SWITCH_REQUIRED` 已移除）；
创建 thread 与发消息须处于选中态（409 `AGENT_NOT_SELECTED`）；exit/重启不销毁 Agent 实例。

## 4. 对话（Thread）

路径：`.opt-agent/users/{user_id}/user-data/threads/{thread_id}/`

| 字段                    | 类型    | 说明                                   |
| ----------------------- | ------- | -------------------------------------- |
| thread_id               | UUID    | **后端生成**（FR-008）                 |
| user_id                 | string  | 归属                                   |
| agent_name              | string  | **最近一轮使用的数字人**（会话可跨数字人） |
| title                   | string  | 默认取首条 user 消息前 20 字；可重命名 |
| created_at / updated_at | ISO8601 | updated_at 用于列表倒序                |

**实体文件**：

- `meta.json`：**thread 元数据存储**——`{ "thread_id", "agent_name", "title",
"created_at", "updated_at" }`。重命名写此文件；每轮对话完成更新 `updated_at`
  并把 `agent_name` 更新为**该轮使用的数字人**（**2026-09-10 修订**：会话不绑定数字人）；
  列表接口读各 thread 目录的 meta.json 排序（数量级小，满足 P95）。
- `history.jsonl`：每行 `{"role":"user"|"assistant","content":"...","agent_name":"..."}`；
  仅存 user/assistant 原文（FR-009）；`agent_name` 记录该轮回答的数字人（**2026-09-10 修订**）；
  追加写不分片。
- `summary.json`：`{ "summary": "...", "covered_count": 40 }`
  （摘要文本 + 已覆盖消息序号）。

**校验/规则**：删除 thread 连带删除 history/summary 及 `临时空间/` 下该
thread_id 前缀全部文件（FR-010）；history 坏行跳过、整体损坏重建并告警（FR-029）。

## 5. 消息（Message）

history.jsonl 行记录：

| 字段       | 类型                    | 校验         |
| ---------- | ----------------------- | ------------ |
| role       | `"user" \| "assistant"` | 仅这两类落盘 |
| content    | string                  | 非空         |
| agent_name | string（可选）          | 该轮数字人；旧行缺省（**2026-09-10 修订**） |

**上下文注入策略**（FR-017/018）：最近 20 条完整注入；更早全部并入滚动摘要，
摘要作为 System Prompt 一部分；窗口外每攒满 20 条异步增量重写
（旧摘要 + 新归档 20 条 → 新摘要），失败用旧摘要不阻塞。

## 6. 文件（受管文件）

> **2026-09-13 修订**：本节由原"7 业务目录 + `shared/` + `tmp/`"模型改为**三空间**模型，
> 旧目录已彻底删除且不提供兼容/迁移（见 §6.1）。

| 属性     | 说明                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 目录类别 | `数据准备/`（Agent 只读，按 scenario 业务子目录组织）、`共享空间/`（Agent 只读，扁平）、`临时空间/`（Agent 唯一可写）     |
| 命名     | 用户上传追加 `_YYYYMMDD_HHMMSS`；临时空间内 Agent 产出强制 `{thread_id}_{timestamp}_{filename}`                          |
| 限制     | 单文件 ≤50MB；扩展名按空间区分（见下权限矩阵）                                                                           |
| 清理     | `临时空间/` 中 7 天未访问自动清除（**访问时间实现**：read_file 读到该空间文件时用 `fs.utimes` 手动刷新 mtime——atime 在 relatime/noatime 挂载下不可靠；清理按该时间判断）；删 thread 连带清除其前缀文件 |

**上传扩展名**（FR-005）：

- `数据准备/`：仅 `.csv`、`.xlsx`
- `共享空间/`、`临时空间/`：`.csv/.xlsx/.txt/.json/.pdf` + 图片 `.jpg/.jpeg/.png/.bmp/.webp/.gif/.tif/.tiff`

**`dir` 参数形态**（files/chat 附件等 API 统一）：posix 相对路径 ——
`数据准备/{业务子目录}`、`共享空间`、`临时空间`；数据准备 MUST 带子目录，
另两个空间 MUST NOT 带子目录。

**权限矩阵**（FR-022，由 file-access 代理层强制）：

| 目录              | Agent 读 |        Agent 写         | 用户上传 | 用户删除 |
| ----------------- | :------: | :---------------------: | :------: | :------: |
| `数据准备/{子目录}` |    ✅    |           ❌            |    ✅    |    ✅    |
| `共享空间/`       |    ✅    |           ❌            |    ✅    |    ❌（403 `FILE_READONLY`） |
| `临时空间/`       |    ✅    | ✅（须 thread_id 前缀） |    ✅    |    ✅    |

违规写入抛 `PermissionError` + 记日志，不中断对话。

### 6.1 场景配置（Scenario，FR-007a）

**位置**：`users/{user_id}/scenario.json`（与 `user-data/`、`agents/` 平级，由管理员预定义）。

```json
{
  "scenario": "生产调度",
  "data_prep_dirs": ["生产计划", "产线信息", "切换时间", "求解时间", "产线电价", "目标优先级", "使用规则"]
}
```

**校验/规则**：

- `data_prep_dirs` 目录名 MUST 通过校验：不允许 `/`、`\`、`..`，长度 ≤64，去重
- 后端按 **mtime 缓存**并**热加载**（改文件无需重启）；加载成功时**惰性创建**数据准备子目录
- **缺失或损坏**：后端进程 MUST NOT 退出；业务 API（files/workspace/chat 附件校验等）
  MUST 返回 **503 `SCENARIO_NOT_CONFIGURED`**，消息为"用户未设置场景信息，请联系管理员"
- 初始化（`ensureUserDirs`）只创建 数据准备/共享空间/临时空间 + threads + agents；
  数据准备子目录由 scenario 加载时创建

## 7. Token 用量记录（UsageRecord，SQLite）

**表 `usage_records`**（全局单库 `usage.db`）：

| 列            | 类型                     | 说明         |
| ------------- | ------------------------ | ------------ |
| id            | INTEGER PK AUTOINCREMENT |              |
| user_id       | TEXT NOT NULL            | 多用户隔离列 |
| thread_id     | TEXT NOT NULL            |              |
| agent_name    | TEXT NOT NULL            |              |
| input_tokens  | INTEGER NOT NULL         |              |
| output_tokens | INTEGER NOT NULL         |              |
| created_at    | TEXT NOT NULL (ISO8601)  |              |

**索引**（章程 IV：高频查询字段）：

- `idx_usage_thread (thread_id)`
- `idx_usage_agent (agent_name)`
- `idx_usage_created (created_at)`
- 汇总查询为 `SUM(input_tokens), SUM(output_tokens) GROUP BY …`，按过滤条件走索引。

**规则**：每轮对话一条（FR-028），**含被 stop 中断的轮次**（token 已真实消耗，
成本照算；消息本身按 FR-027 丢弃不入 history）；写入失败记日志但不影响对话响应；
按日 `usage-*.log` 仅审计备份。

## 8. 运行（Run，内存对象）

由 run-manager 管理，每 thread 最多一个活跃 run。

| 字段                             | 说明                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| thread_id / user_id / agent_name | 归属                                                            |
| abort_controller                 | stop/关机中断用                                                 |
| emitter                          | 事件总线（SSE 订阅者 + 落盘器订阅者；广播骨架为二期"续推"预留） |
| buffer                           | 本轮 content 累积（用于最终落盘；中断轮丢弃）                   |
| state                            | `running → draining → done \| aborted \| error`                 |

**状态流转**：

```
running --客户端断开--> running（loop 照跑，仅 SSE 退订；后续步骤收尾不新开）
running --stop 信号--> aborted（丢弃未保存内容）
running --关机--> draining（当前消息写完落盘，15s 宽限后 abort）
running --正常完成--> done（content 落盘 + usage 记录 + 触发摘要检查）
```
