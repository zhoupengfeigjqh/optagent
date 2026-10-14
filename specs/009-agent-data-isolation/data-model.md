# 数据模型：按数字人隔离用户数据

**特性**：`009-agent-data-isolation` | **日期**：2026-10-14 | **规格**：[spec.md](./spec.md) | **计划**：[plan.md](./plan.md) | **研究**：[research.md](./research.md)

本文件描述本特性的**数据归属与落盘形态**：改前 / 改后的目录布局、实体与字段、校验规则、状态与生命周期、存量迁移映射，以及平台侧与运行环境侧的数据边界。

---

## 1. 目录布局（改前 / 改后）

### 1.1 改前（现状，实测）

```text
.opt-agent/
├── usage.db                                    # MCP 调用统计（SQLite，本次不动）
└── users/
    └── {uid}/                                  # 例：admin
        ├── agents/                             # 数字人【配置】目录（本次不动）
        │   └── {数字人名称}/
        │       ├── SOUL.md
        │       ├── TOOL.json / MCP.json
        │       ├── scenario.json               # 文件空间场景（数字人级，已有）
        │       └── skills/**
        └── user-data/                          # 【数据】根（用户级——本次要改的就是这一层）
            ├── 数据准备/{二级目录}/**           # Agent 只读
            ├── 共享空间/**                      # Agent 只读
            ├── 临时空间/**                      # Agent 可读写 + 后台产出
            └── threads/{threadId}/             # 会话：meta.json / history.jsonl / tool-events.jsonl / summary.json / next-actions.json
```

证据：`agent-backend/src/domain/dirs.ts:70-90`（`userDataDir` 返回 `users/{uid}/user-data`，`threadDir` 在其下拼 `threads/{threadId}`）、`:92-99`（`ensureUserDirs` 建三个空间 + `threads` + `agents`）。

### 1.2 改后（本特性目标）

```text
.opt-agent/
└── users/
    └── {uid}/
        ├── agents/{数字人名称}/**               # 【配置】：不变
        └── user-data/
            ├── {数字人名称A}/                    # ★ 新增的归属层（= 数据域的根）
            │   ├── 数据准备/{二级目录}/**
            │   ├── 共享空间/**
            │   ├── 临时空间/**
            │   │   └── 后台产出/**               # 相对路径不变
            │   └── threads/{threadId}/**         # ★ 会话一并下沉，归属由位置表达
            └── {数字人名称B}/
                └── …（同上，互不可见）
```

- **归属键**：`(uid, 数字人名称)`。同一数字人被多个用户使用时天然隔离（归属键含 `uid`）。
- **数字人级目录的创建**：运行环境**按需惰性创建**（Q2=A）——`select` 成功后、会话创建前、文件写入前兜底；平台侧部署**不创建、不写入、不删除**。
- **`user-data/` 的直属子项只应是数字人目录**（迁移完成后）；`数据准备` / `共享空间` / `临时空间` / `threads` 这几个名字**不许可**再作为 `user-data` 的直接子项存在（FR-002）。

---

## 2. 实体与字段

| 实体 | 身份 | 关键属性 | 与本次的关系 |
|---|---|---|---|
| **用户** | `uid`（当前系统为单用户 `admin`，见 `domain/current-user.ts`） | 关联数字人集合（平台侧维护）、数据根 | 不变 |
| **数字人（配置）** | `(uid, 数字人名称)`，落点 `users/{uid}/agents/{名称}/` | SOUL、TOOL、MCP、SKILL、`scenario.json` | 不变（FR-060） |
| **数字人数据域** | `(uid, 数字人名称)`，落点 `users/{uid}/user-data/{名称}/` | 三个文件空间 + `threads/` | **新增的归属层级** |
| **文件空间** | 数据域内的固定一级目录（`数据准备` / `共享空间` / `临时空间`） | 可上传类型、Agent 可写性（`dirs.ts:58-62 SPACE_POLICIES`） | **归属由用户级改为数字人级**（策略本身不变，FR-024） |
| **会话（thread）** | `threadId`（uuid），落点 `{数据域}/threads/{threadId}/` | `meta.json` / `history.jsonl` / `tool-events.jsonl` / `summary.json` / `next-actions.json` | **归属由元数据改为目录位置**，生命周期内不可变更 |
| **当前选中数字人** | 每用户一份（服务端内存） | `userId → agentName` | 不变（仍为内存态），但取用前新增**可用性校验** |
| **数字人可用清单** | `listAgents(root, uid)` 的返回值（扫 `agents/` 且配置可加载） | `agent_name`、描述 | 语义不变，被复用于"可用性判定"与迁移的归属候选 |
| **归属数字人** | 迁移时的目标数字人 | 由判定顺序确定 | **仅迁移期存在的概念**，判定结果落审计 |
| **存量共享数据** | 改前的 `user-data/{三空间,threads}` | 文件与会话 | **迁移来源**，迁移后不再存在 |

### 2.1 会话元数据字段语义

`threads/{threadId}/meta.json`（`domain/thread-store.ts:46-52`）：

| 字段 | 改前语义 | 改后语义 |
|---|---|---|
| `thread_id` | 会话标识 | 不变 |
| `title` | 标题 | 不变 |
| `created_at` / `updated_at` | 时间戳 | 不变 |
| **`agent_name`** | **"最近一轮使用的数字人"**（每轮 `touch()` 覆写，`thread-store.ts:142`；`chat.ts:190` 调用） | **该会话的归属数字人（只读）**：创建时写定，`touch()` **MUST NOT** 覆写；与所在目录名一致 |

> `history.jsonl` 中每条消息携带的 `agent_name`（由 `run-finalize.ts` 写入）**保留**：它是该轮实际执行的数字人，属信息量，不参与归属判定（在严格隔离下恒等于会话归属）。

---

## 3. 校验规则

| 规则 | 内容 | 依据 |
|---|---|---|
| 名称合法性 | 数字人名称 MUST 不含路径分隔符、`..`（平台侧强制，`001 FR-015`）；运行环境 MUST **原样**用作目录名，MUST NOT 归一化、MUST NOT 改写大小写 | FR-001、边界情况「数字人名称与目录名」 |
| 路径安全 | 所有客户端传入的相对路径 MUST 经既有 `parseSpaceDir` 校验（穿越、绝对路径、反斜杠 → `400`；空间外/清单外 → `403`）；路径**始终**相对数字人数据域解析 | FR-003 |
| 目录白名单 | 一级必须是三空间之一；`数据准备` 必须且仅可带二级目录且在**该数字人** `scenario.json` 的清单内；其余空间不允许二级目录（`临时空间/后台产出` 对文件浏览 API 仍判 `400`） | 现状不变（`dirs.ts:429-464`） |
| 作用域 | 未选中数字人 → `409 AGENT_NOT_SELECTED`；选中但不可用 → `409 AGENT_NOT_AVAILABLE` | FR-013、FR-032 |
| 空会话判定 | 会话**尚无任何轮次**（`meta.json` 的 `created_at` 与 `updated_at` 相等）⇒ 视为"空对话"：MUST NOT 出现在列表、MUST NOT 被自动删除、MUST NOT 为判定而读取 `history.jsonl`（零额外 IO，由 `thread-store.list` 单点实现） | FR-016 |
| 归属一致性 | 会话与其目录同属一个数字人；跨数字人访问 MUST 呈现为"不存在"（`404`） | FR-020/021/022 |

---

## 4. 状态与生命周期

### 4.1 会话归属不可变

```text
创建（POST /api/threads）──► 归属 = 当时当前选中的数字人（写定目录位置）
        │
        ├─ 续聊 / 改名 / 删除 / 读取 ──► 只能在其归属数字人的作用域内进行
        └─ 跨数字人请求 ──────────────► 404 THREAD_NOT_FOUND（不泄露存在性）
```

### 4.2 数字人的增删与数据的可见性

| 事件 | `agents/{名称}/`（配置） | `user-data/{名称}/`（数据） | 用户可见性 |
|---|---|---|---|
| 关联并部署 | 写入（整体覆盖） | **不触碰** | 清单出现该数字人；数据目录在首次使用时惰性创建 |
| 移除关联并部署 | 删除该数字人目录（其余数字人不受影响） | **完整保留**（FR-031） | 清单不含它；其会话与文件不可见、不可访问；陈旧上下文发消息 → `409 AGENT_NOT_AVAILABLE`；`GET /api/agents/current` **仍返回该名称**（不自动清空，仅在用户显式重选时更新） |
| 同名重新关联并部署 | 重新写入 | **复用（复活）**同一目录的数据 | 数据重新可见且可用（Q3=A） |
| 运行环境人工创建的数据目录 | — | 保留在原处 | 不对用户可见（无对应数字人）；MUST NOT 被清理 |

### 4.3 迁移状态机（一次性结构搬迁）

```text
[改前布局]
   │  启动期触发（②唯一 / ③名称升序第一）        或  select 成功后触发（①当前选中）
   ▼
[判定归属] ── 清单为空 ──► [原地保留] ──(用户首次选择某数字人)──► 回到 [判定归属]（①）
   │
   ▼（有归属）
[逐项改名] 源子项 ─rename─► 目标子项 ；目标已存在同名项 ─► 跳过 + warn
   │
   ├─ 任一时刻中断 ──► 保持已迁部分；重跑续迁（源不存在即已完成的等价判据）
   ▼
[完成] 源目录全空 ─► rmdir（清除用户级落点）
```

---

## 5. 存量迁移映射表

| 步骤 | 源 | 目标 | 规则 |
|---|---|---|---|
| 1 | `user-data/数据准备/**` | `user-data/{归属}/数据准备/**` | 逐项 `rename`；目标同名项存在 → 跳过 + `warn` |
| 2 | `user-data/共享空间/**` | `user-data/{归属}/共享空间/**` | 同上 |
| 3 | `user-data/临时空间/**` | `user-data/{归属}/临时空间/**` | 同上（含 `后台产出/**`） |
| 4 | `user-data/threads/{threadId}/` | `user-data/{归属}/threads/{threadId}/` | 同上；序号稳定（`readdir` 后按名称排序后再处理，保证可复现） |
| 5 | 其它一级条目（若存在） | 同上按同名目标 | 同上（不丢弃非预期条目） |
| 6 | 迁移后的空源目录 | — | `rmdir`（MUST NOT 留下用户级落点） |

**幂等判据**：源条目不存在 ⇒ 已迁移完成；**MUST NOT** 覆盖目标同名项；**MUST NOT** 产生重复条目。
**审计字段**：`event`（`data.migration.start` / `.owner` / `.moved` / `.skipped` / `.done` / `.blocked`）、`uid`、`owner_agent`、`moved_count`、`skipped[]`、`reason`。

---

## 6. 与平台侧的数据边界（不变，仅回归确认）

| 写入方 | 允许写入范围 | 本特性后 |
|---|---|---|
| 平台（`admin-backend` 部署） | `users/{uid}/agents/{agent}/**` | **不变**（数字人级数据目录由运行环境惰性创建，平台不创建） |
| 平台（撤回） | 删除 `users/{uid}/agents/{agent}/` | **不变** |
| 平台对 `user-data/**` | **零写入、零删除** | **不变**（FR-031/043、用户故事 6） |
| 运行环境 | `users/{uid}/user-data/{agent}/**`（+ 迁移期一次性搬迁） | 归属层加深一层 |

> 该边界即"配置 vs 数据"划分：配置可被整体覆盖，数据永不因部署而改动。本特性只把**数据的归属**从用户级细化为数字人级，不改变这条边界本身，但需回写 `001/spec.md` 的 FR-028 / 假设 / 关键实体与 `001/data-model.md` 的「三类数据边界」（其中"三空间文件是用户共享的一份"的表述已失效）。

---

## 7. 与本次相关的关键常量（不新增）

| 常量 / 函数 | 位置 | 说明 |
|---|---|---|
| `SPACE_PREP` / `SPACE_SHARED` / `SPACE_TMP` / `SPACES` | `domain/dirs.ts:24-27` | 三空间名（前端不硬编码，一律消费接口下发值） |
| `THREADS_DIR = 'threads'` | `domain/dirs.ts:30` | 会话目录名（下沉后仍为该名，位于数据域内） |
| `PRODUCED_DIR = 临时空间/后台产出` | `domain/dirs.ts:39-40` | 相对路径不变 |
| `SPACE_POLICIES` / `DATA_PREP_UPLOAD_EXTS` | `domain/dirs.ts:58-67` | 可上传类型与写权限（本次不变） |
| `userDataDir` / `threadDir` / `ensureAgentDataDirs` | `domain/dirs.ts` | **签名变更点**：`userDataDir(root, uid, agent)`、`threadDir(root, uid, agent, threadId)`、`ensureAgentDataDirs(root, uid, agent)` |
| `listAgents` | `domain/agent-catalog.ts:66-85` | 可用清单；名称升序（迁移③复用） |
| `resolveAgentScope` | `domain/agent-scope.ts`（新） | 作用域与可用性判定的唯一入口 |
| `resolveOwnerAgent` / `migrateUserDataLayout` | `domain/data-migration.ts`（新） | 归属判定与逐项迁移 |
