# 数据模型：本体行为权限闸门

**输入**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)

**性质**：本特性**不新增持久化数据**。下述结构全部是运行期内存模型（由部署产物解析而来）与日志字段，
重启即重建、部署即刷新。没有数据库、没有迁移、没有写回平台的路径。

---

## 1. 数据来源与归属

```text
.opt-agent/users/{用户}/agents/{数字人}/ontology/{场景}/{本体}/
├── ontology.yaml      # 行为清单（behaviors[].name）与本体身份（metadata）
└── securities.yaml    # 行为管控条目（securities[].action_name / .scope）
```

| 项 | 说明 |
|---|---|
| 权威源 | 管理平台（本体市场导入 → 平台原样下发）；运行环境**只读** |
| 写入方 | 平台部署（目录级原子改名）；运行环境**永不写** |
| 生命周期 | 随数字人实例创建而加载、随目录签名变化而重载、随实例释放而丢弃 |
| 失效判据 | `statSync({agentDir}/ontology).mtimeMs` 变化（研究 D6） |

---

## 2. 内存模型

### 2.1 `GuardSnapshot`（一次加载的完整结果）

| 字段 | 类型 | 说明 |
|---|---|---|
| `signature` | `string` | 加载时的目录签名（`mtimeMs` 或 `missing`），用于判断是否需要重载 |
| `byBehavior` | `Map<string, BehaviorBinding[]>` | 归一化行为名 → 绑定列表（同一名称可挂多个本体） |
| `ontologies` | `Map<string, OntologyEntry>` | 本体键（`{场景}/{本体}`）→ 本体条目，供文案与日志取展示名 |
| `warnings` | `string[]` | 加载期告警（坏文件、缺字段、同名重复等），由调用方写日志 |

**不变量**：

1. `byBehavior` 的键恒为 `normalizeName(behaviorName)`（去首尾空白 + 小写）；
2. `byBehavior` 的值**不为空数组**（无绑定即不存在该键）；
3. 同一个 `OntologyEntry` 内的行为名唯一（重复保留首个并告警）；
4. 快照不可变：重载即整份替换，不做增量修改（避免"半新半旧"）。

### 2.2 `OntologyEntry`（一个本体目录）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | `{场景目录名}/{本体目录名}`，稳定且唯一 |
| `scenarioName` | `string` | `metadata.scenario_name`，缺失回退场景目录名（仅用于展示） |
| `ontologyName` | `string` | `metadata.ontology_name`，缺失回退本体目录名（仅用于展示） |
| `status` | `'ok' \| 'no_securities'` | `no_securities` = 文件缺失/不可解析/`securities` 非数组 → 该本体所有行为判定为"管控不可用" |
| `behaviors` | `BehaviorBinding[]` | 该本体声明的行为（去重后） |
| `entries` | `Map<string, SecurityEntry>` | 归一化 `action_name` → 管控条目 |

### 2.3 `BehaviorBinding`

| 字段 | 类型 | 说明 |
|---|---|---|
| `behaviorName` | `string` | `behaviors[].name` 原文（用于文案与日志） |
| `ontologyKey` | `string` | 所属本体（判定时据此取 `status` 与 `entries`） |

> 绑定不缓存判定结果：授权结论依赖"当前用户名"，而用户名由实例决定；缓存结论会让多用户部署下的判定串味。

### 2.4 `SecurityEntry`

| 字段 | 类型 | 说明 |
|---|---|---|
| `actionName` | `string` | `securities[].action_name` 原文（日志用） |
| `scope` | `string[]` | 归一化后的 `scope`：保留标记（`everyone` / `disable`）与用户名；空值与非字符串元素已剔除 |
| `ignored` | `number` | 被剔除的元素个数（仅用于告警，不参与判定） |

**校验规则**（加载期）：

| 输入形态 | 处理 |
|---|---|
| `securities` 不是数组 / 文件缺失 / YAML 不可解析 | 本体 `status = 'no_securities'` + 告警 |
| 条目不是对象 / `action_name` 缺失或非字符串 | 丢弃该条目 + 告警 |
| `scope` 缺失或不是数组 | 按空 `scope` 处理（判定为拒绝）+ 告警 |
| `scope` 元素非字符串、空串或全空白 | 剔除并计入 `ignored` |
| 同一 `action_name` 重复 | 保留首个 + 告警 |
| `behaviors` 不是数组 / 元素缺 `name` | 丢弃该行为 + 告警 |

---

## 3. 判定（纯函数层）

### 3.1 输入

| 名称 | 来源 | 说明 |
|---|---|---|
| `toolName` | 运行期工具名 | 可能带 MCP 服务前缀 `{服务名}__` |
| `username` | 数字人实例的归属用户标识 | 即 `users/{用户名}/` 的那一段，服务端确定 |
| `snapshot` | 当前缓存快照 | 由签名决定是否重载 |

### 3.2 归一化

```text
normalize(name) = trim(name).toLowerCase()

候选键（按序，任一命中即视为本体行为）：
  k1 = normalize(toolName)
  k2 = normalize( 去掉第一个 "__" 及其之前的部分 )   # 无 "__" 时不存在该候选
```

- 同时查两个候选：**完整名**（兼容"工具名本身就是行为名"的服务）与**去首个前缀名**（当前 MCP 装配形态）；
- 两个候选都命中 → 按"多绑定"处理（拒绝优先），不做优先级猜测；
- 归一化只用于**比对**，展示与日志一律用原文；
- **已知限制（登记）**：若某个 MCP 服务名自身含 `__`，去首个前缀后仍不到行为名，该工具会被判为"非本体行为"
  （放行）。平台侧服务名为安全标识、约定不含 `__`；如未来出现，需在平台侧约束或扩展候选规则。

### 3.3 判定矩阵（唯一权威口径）

| # | 行为命中 | 本体 `status` | 条目 | `scope` 内容 | 结论 | 错误码 |
|---|---|---|---|---|---|---|
| 1 | 否 | — | — | — | 放行（非本体行为） | — |
| 2 | 是（1 个） | `ok` | 有 | 含 `disable` | 拒绝（停用优先；对外并入"未授权"） | `ONTOLOGY_SCOPE_DENIED`（`reason='disabled'`、`scope_kind='disable'`） |
| 3 | 是（1 个） | `ok` | 有 | 含 `everyone`（无 `disable`） | 放行 | — |
| 4 | 是（1 个） | `ok` | 有 | 含当前用户名 | 放行 | — |
| 5 | 是（1 个） | `ok` | 有 | 不含当前用户名 | 拒绝 | `ONTOLOGY_SCOPE_DENIED` |
| 6 | 是（1 个） | `ok` | 有 | 空（或无有效元素） | 拒绝 | `ONTOLOGY_SCOPE_DENIED` |
| 7 | 是（1 个） | `ok` | **无**该 `action_name` | — | 拒绝 | `ONTOLOGY_SCOPE_UNAVAILABLE` |
| 8 | 是（1 个） | `no_securities` | — | — | 拒绝 | `ONTOLOGY_SCOPE_UNAVAILABLE` |
| 9 | 是（多个本体） | 混合 | 混合 | 混合 | **拒绝优先**：任一条为拒绝即拒绝（同码取稳定顺序第一条），全部放行才放行 | 取该拒绝条目的码 |
| 10 | 是（多个本体） | 全部放行 | — | — | 放行 | — |
| 11 | 判定过程内部异常 | — | — | — | 拒绝（安全默认）+ 告警 | `ONTOLOGY_SCOPE_UNAVAILABLE` |

**稳定顺序**：本体按 `ontologyKey` 升序（`localeCompare('zh-Hans-CN')` 之外的普通字典序，保证跨平台一致）。

**保留标记**：`everyone` / `disable` 归一化后识别；用户名与之**不做**特殊比较（即某个真实用户名恰好叫 `everyone`
时按保留标记处理，这是刻意取舍，避免"以名字表达授权"）。

### 3.4 输出 `ScopeDecision`

| 变体 | 字段 | 用途 |
|---|---|---|
| `not_ontology` | — | 包装器直接透传原工具 |
| `allow` | `behavior`、`rule`（`everyone` / `user`） | 透传原工具；`rule` 仅用于调试与日志（不落常规日志） |
| `deny` | `behavior`（可能为 `null`）、`code`、`reason`、`message` | 包装器据此返回失败结果并记日志 |

`reason` ∈ `disabled` / `not_in_scope` / `empty_scope` / `no_entry` / `no_securities` / `internal_error`，
用于日志与单测断言（不进入用户文案）。

`message` 是**唯一**的中文拒绝文案来源，模板见 `contracts/scope-guard.md` §4。

### 3.5 拒绝后的本轮状态（`SuspendState`，2026-11-09）

| 字段 | 类型 | 语义 |
|---|---|---|
| `suspended` | `boolean` | 本轮是否已出现过拒绝（置位后**不再判定、不再执行**） |
| `code` | `ScopeDenyCode` | 触发挂起的码；后续软拒绝沿用同一码（不新增错误码） |
| `attempts` | `number` | 挂起后被调用次数：`1` = 软拒；`>1` = 触发兜底 |
| `exhausted` | `boolean` | 兜底出口是否已触发（**每次装配最多一次**） |

**生命周期**：`guardTools(tools, guard, ctx)` 在每次装配（= 每轮 `runWith`）内新建一份，随工具数组一起丢弃——
**按轮隔离**，不需显式清理，也不会跨轮污染。

**时间线**：

| 事件 | 真实工具执行 | 返回 |
|---|---|---|
| 第 1 次拒绝 | 否 | `content = [拒绝原因, 终局指令]`（`details.toolError` 只含拒绝原因） |
| 挂起后第 1 次调用 | 否 | 「本轮已停止执行工具，请直接结束回答。」+ `scope_guard.suspended` |
| 挂起后第 2 次调用 | 否 | 同上 + 触发 `onSuspendedExhausted()`（装配层 ⇒ `run.stop()`，`ABORTED` 收尾） |
| 第 3 次及以后 | 否 | 同上，但**不再**触发兜底出口 |

**并发边界**：`parallel` 模式下同一 batch 的工具已同时发起，无法撤回；挂起只对**后续批次**生效。

---

## 4. 日志字段

### 4.1 `scope_guard.denied`（每次拒绝一条）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ts` | `string` | ✅ | ISO-8601 时间戳（`FR-018` 的"时间"）；由日志框架注入，写入方须确认存在 |
| `event` | `string` | ✅ | 固定 `scope_guard.denied` |
| `code` | `string` | ✅ | 三个错误码之一 |
| `reason` | `string` | ✅ | 见 3.4 |
| `user_id` | `string` | ✅ | 当前数字人的归属用户 |
| `agent_name` | `string` | ✅ | 数字人 |
| `thread_id` | `string` | ➖ | 当轮会话（装配时传入） |
| `tool_name` | `string` | ✅ | 模型调用的完整工具名（含服务前缀） |
| `ontology` | `string` | ➖ | `{场景}/{本体}`；未命中本体时缺省 |
| `behavior` | `string` | ➖ | 行为名原文；未命中时缺省 |
| `scope_kind` | `'everyone' \| 'disable' \| 'users' \| 'unavailable'` | ➖ | 管控配置形态（不落具体名单） |
| `scope_size` | `number` | ➖ | `scope` 有效元素数 |

**禁止**：入参内容、`scope` 具体用户名清单、`securities.yaml` 原文。

### 4.2 `scope_guard.catalog.degraded`（加载期异常）

| 字段 | 说明 |
|---|---|
| `event` | 固定 `scope_guard.catalog.degraded` |
| `agent_name` / `user_id` | 归属 |
| `warnings` | 加载告警列表（截断至 20 条） |

触发条件：坏 YAML、缺 `securities.yaml`、`scope` 结构非法、行为缺名、同名重复。
级别：`warn`（`alert: true` 由装配层附加）。

---

## 5. 与规格实体的映射

| 规格实体（`spec.md` §关键实体） | 本模型中的落点 |
|---|---|
| 本体行为 | `BehaviorBinding` + `OntologyEntry.ontologyName` |
| 行为管控条目 | `SecurityEntry`（只取 `action_name` / `scope`） |
| 授权范围 | `SecurityEntry.scope`（保留标记 + 用户名） |
| 数字人归属用户 | `createScopeGuard({ username })` 的入参，来自实例 `key.userId` |
| 权限判定结果 | `ScopeDecision`（三变体）+ `ScopeDenyCode` |

---

## 6. 状态与生命周期

```text
[未加载] --首次 check--> [已加载(signature=S)] --signature 变化--> [重载中] --> [已加载(signature=S')]
                              │                                            │
                              └── 加载失败（无目录）→ [空快照(signature)] ←┘

[实例释放] → 全部丢弃（与 ChatAgent.dispose 同生命周期）
```

| 事件 | 行为 |
|---|---|
| 数字人无 `ontology/` 目录 | 空快照；所有工具 `not_ontology` 放行；**零告警** |
| 目录被整体替换（部署） | 签名变化 → 下一次 `check` 重载；当前调用使用重载后的结果 |
| 同一实例并发调用 | 重载是同步整体替换，不出现半新半旧；重复重载只多读一次盘 |
| 重载期间文件被替换 | 读到的是替换前或替换后的完整文件（目录级原子改名），不会读到半个文件 |
| 判定内部异常 | 返回 `deny(ONTOLOGY_SCOPE_UNAVAILABLE, reason='internal_error')`，不抛 |
