# 数据模型：本体行为规则闸门

- **特性**：`021-ontology-rule-gate`
- **日期**：2026-11-09
- **口径来源**：[spec.md](./spec.md) 与 [research.md](./research.md)
- **性质**：本特性**不新增任何持久化结构**。下文全部是**内存结构**（加载快照 + 轮内记录）与
  **日志/事件字段**；唯一的持久化面变化是失败轮 `error` 对象多一个可选 `details`（见 §6）。

---

## 1. 本体文档（加载期，只读）

一个本体目录 `{agentDir}/ontology/{场景}/{本体}/` 解析出一份 `OntologyDoc`：

| 字段 | 类型 | 来源 | 缺省 / 非法时 |
|---|---|---|---|
| `key` | `string` | `{场景}/{本体}`（目录名） | 必有 |
| `scenarioName` | `string` | `metadata.scenario_name` | 回退场景目录名 |
| `ontologyName` | `string` | `metadata.ontology_name` | 回退本体目录名 |
| `behaviors` | `{ name, title, opType }[]` | `behaviors[]` | `name` 非空字符串，否则丢弃 + 告警 |
| `rules` | `unknown[]` | `rules[]` | 非数组 → 空数组 + 告警 |
| `functions` | `{ name, response, type }[]` | `functions[]` | `name` 非空字符串，否则丢弃 + 告警 |

> `behaviors` 的解析是 020 与本特性的**共用**判据（唯一来源 `domain/ontology-doc.ts`）；
> `rules` / `functions` 只有本特性消费。

## 2. 规则（`RuleSpec`，加载期归一）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 规则名（日志与文案的唯一标识） |
| `title` | `string` | 展示标题 |
| `description` | `string` | 规则描述（原文） |
| `behavior` | `string` | 绑定行为名（归一后比对；空 → 整条规则忽略 + 告警） |
| `position` | `'前置' \| '后置'` | 其他取值 → 整条规则忽略 + 告警 |
| `relatedFunctions` | `string[]` | 声明需要的函数名（非字符串元素丢弃） |
| `dataSupplements` | `string[]` | 附带数据补充项（本特性只随全文反馈，不据此自动取数） |
| `design` | `RuleDesign \| null` | `rule_design` 归一结果；缺失/空 → `null` |
| `passMessage` / `failMessage` | `string` | 判定文案（可为空串） |
| `raw` | `Record<string, unknown>` | 原始条目（"规则全部内容反馈"的唯一来源，不二次拼装） |

**索引**：`behaviorIndex: Map<归一行为名, { pre: RuleSpec[]; post: RuleSpec[] }>`，
同一行为可挂多个本体（多本体同名行为 → 规则合并，见 `research.md` D8）。

## 3. 规则设计（`RuleDesign`，求值期）

```
RuleDesign
├── combine: 'and' | 'or'                     # 缺省/非法 → and
├── groups: RuleConditionGroup[]
│    ├── combine: 'and' | 'or'                # 缺省/非法 → and
│    └── conditions: RuleCondition[]
│         ├── function: string                # 必须非空；建议 ∈ related_functions（未声明时仍求值）
│         ├── field: string                   # 路径语法见 §3.1
│         ├── operator: OperatorCode          # 全集见 §3.2
│         └── values: string[]                # 恒为字符串数组
├── passMessage?: string
└── failMessage?: string
```

**归一规则（读侧，静默）**：

| 输入 | 处理 |
|---|---|
| `combine` 非 `and` / `or` | 归为空串，按 `and` 用 |
| `values` 非数组 | 单值包裹为数组；元素统一 `String()` |
| `operator` 不在全集 | 该条件保留但**恒判不成立** + 告警 |
| 组内 `conditions` 非数组 / 非对象 | 该组忽略 + 告警 |
| `groups` 非数组 / 为空 | 整段设计视为"未设计"（`null`） |
| 条件缺 `function` / `field` | 该条件恒判不成立 + 告警 |
| 组数 / 每组条数超限（>5） | **照常求值**（设计期约束，不在此拒绝） |

### 3.1 `field` 路径语法

```
path    := segment ('.' segment)*
segment := name ['[]']
```

| 形态 | 含义 | 读取方式 |
|---|---|---|
| `pass` | 顶层字段 | 对象取键 |
| `detail.qty` | 嵌套对象 | 逐段下行 |
| `items` | 数组容器 | 取该数组本身（配 `contains` / `empty`） |
| `items[].qty` | 元素层字段 | 逐元素投影出 `qty` 数组（缺失元素丢弃） |
| `a[].b[].c` | 多层数组叠加 | 同上递归 |

- 任一段缺失 → **字段缺失**（`found=false`），不猜测、不补默认值；
- 投影结果为空数组 → 视为字段缺失（对本特性的条件形态而言"没有任何元素"与"没有该字段"同义）。

### 3.2 算子全集与取值个数

| 码 | 取值个数 | 语义 | 不成立条件（一律返回 false，不抛） |
|---|---|---|---|
| `eq` | 1 | 相等 | 类型强制后不等；对象/数组按 JSON 文本比较 |
| `ne` | 1 | 不等 | 类型强制后相等 |
| `gt` / `gte` / `lt` / `lte` | 1 | 数值比较 | 任一侧转不出数字 |
| `between` | 2 | 闭区间 `[v0, v1]` | 任一侧转不出数字 |
| `contains` | 1 | 字符串子串 / 数组成员 | 实际值既非字符串也非数组 |
| `not_contains` | 1 | 上者取反 | 实际值既非字符串也非数组（**类型不适用一律判不成立，不因取反变成立**） |
| `starts_with` / `ends_with` | 1 | 前后缀 | 实际值非字符串 |
| `matches` | 1 | 正则匹配 | 正则非法 / 文本超长（>4096） |
| `in` / `not_in` | ≥1 | 集合成员 | — |
| `empty` / `not_empty` | 0 | 空 / 非空 | — |

**"空"的口径**：`undefined` / `null` / `''` / 空数组 / 无键对象。

## 4. 轮内函数执行记录（`FunctionRecord`）

| 项 | 口径 |
|---|---|
| 生命周期 | 一轮对话一个实例；轮结束即丢弃（不落盘、不进历史） |
| 键 | 去 MCP 服务前缀 + 去首尾空白 + 小写后的工具名（`stripServicePrefix` 后归一） |
| 值 | 该函数**最后一次调用**的结果：成功 → 业务数据（§5）；执行报错 / 超时 / 无结果 → `null` |
| 写入时机 | 每次**真正发出**的调用返回后（成功与失败都写）；未发出的调用（被权限闸门拒绝、被前置规则暂停、中止后未执行）**不写** |
| 覆盖 | 同名多次调用 → **最后一次覆盖**（失败以 `null` 覆盖成功值）；同一函数只有一条 |
| 语义 | **键存在 = 本轮已执行过**（值可能为 `null`）；`null` 不触发暂停与注册校验，但其一切条件判不成立 |
| 上限 | 单条序列化 ≤256 KB；条目 ≤64；超限丢弃 + 告警（丢弃 = 键不存在 = 未执行 → 触发暂停 / 注册校验） |
| 查询 | `has(name)` / `get(name)`；比对同样走归一 |

> `null` 与"键不存在"是**两种不同状态**，实现里不得用 `null` 表示"没调过"，也不得用 `undefined` 与 `null` 混用。

**为什么键要剥前缀**：`related_functions` 写的是裸函数名（`checkRawMaterialUnit`），
而模型看到的 MCP 工具名是 `{服务名}__checkRawMaterialUnit`。

## 5. 业务数据抽取（记录值的唯一来源）

```
工具返回值（AgentToolResult：{ content: [{ type:'text', text }], details }）
  ├─ content 是文本块数组 → 拼接 text，按下面"字符串"继续
  │
  └─ 解析后的业务值
       ├─ 是对象且含 data 且含 success|error|status  → 取 data      （统一信封）
       ├─ 是对象                                    → 取对象本身    （扁平服务）
       ├─ 是数组                                    → { count, items }
       ├─ 是字符串                                  → 按 JSON 解析；失败 → {}
       └─ content 块数组（裸块数组）                 → 文本块拼接后按字符串处理
```

> **必须先解 `AgentToolResult` 信封**：真实 MCP 适配器与内置工具返回的都是
> `{ content: [{ type:'text', text }], details: {} }`，业务字段在 `text` 里（JSON 文本）。
> 少了这一步，记录里存的是信封本身，`rule_design` 的条件会全部读不到字段。

抽取后再判"是否为对象"；不是对象（数字/布尔/纯文本）→ 记为 `{}`（无可用字段）。
序列化体积按抽取后的值计算（§4 上限）。

> 第一行的"统一信封"判据是 `spec.md` `FR-006` 的唯一口径（同时含 `data` 与 `success`/`error`/`status` 之一）。
> 不要扩展成"只要含 `data` 就取 `data`"——扁平服务里 `data` 可能是普通业务字段。

## 6. 判定结果与对外字段

### 6.1 前置判定（`PrecheckResult`）

| `kind` | 触发 | 后续动作 |
|---|---|---|
| `function` | 工具不是本体行为（且非内置） | 执行 → 成功后记录 |
| `behavior` | 是本体的行为，但**无前置规则** | 执行 → 成功后追加后置提示 |
| `pause` | 前置规则有 `related_functions` 未记录 | **不执行**；返回失败结果（规则全文 + 缺失函数清单） |
| `deny` | 求值 `false`、规则结构不可用、或**规则引用了未注册函数** | **不执行**；挂起本轮工具并返回三段式卡片（三者靠 `reason` 区分：`condition_false` / `config_unavailable` / `unregistered`） |

`pause` / `deny` 的载荷：`{ message: string; details: string[] }`，`deny` 另带
`reason: 'unregistered' | 'condition_false' | 'config_unavailable'`（文案唯一来源
`rule-gate/format.ts`）。

**`postHint` 的三态返回**（后置规则校验在**执行成功之后**）：

| 返回 | 触发 | 后续动作 |
|---|---|---|
| `null` | 该行为没有后置规则 | 结果原样返回 |
| `{ kind: 'append', text, rules }` | 有后置规则且其函数**全部已注册** | 追加文本块后返回 |
| `{ kind: 'blocked', message, details, rules }` | 有后置规则且存在**未注册**函数 | **不追加**后置提示；业务结果**完整保留**并追加阻断说明；挂起本轮 |

**与规格"裁决四态"的对照**（`spec.md` §关键实体）：

| 规格裁决 | 实现变体 | 是否执行行为 | 是否记录 |
|---|---|---|---|
| 直接执行（无前置规则，且是本体行为） | `behavior` | 是 | 否 |
| 直接执行（非本体行为，即"函数"） | `function` | 是 | **是**（成功与失败都记，失败记 `null`） |
| 暂停（缺函数，且函数**已注册**） | `pause` | 否 | 否 |
| 允许（求值通过） | `behavior` | 是 | 否 |
| 拒绝并挂起本轮（求值不成立 / 规则不可用） | `deny`（`reason` = `condition_false` / `config_unavailable`） | 否 | 否 |
| 阻断（前置规则引用**未注册**函数） | `deny`（`reason` = `unregistered`） | 否 | 否 |
| 阻断（后置规则引用未注册函数，行为**已成功**） | `postHint` → `blocked` | **是（已发生）** | 否 |

### 6.2 拒绝卡片正文（2026-11-09 起）

| 段 | 来源 | 说明 |
|---|---|---|
| 结论 | `PrepareResult.deny.message` | 一句话（含本体/行为/原因），也是 `details.toolError.message` 的唯一来源 |
| 明细 | `PrepareResult.deny.details`（`string[]`，3~6 条） | 行为、规则名、`fail_message` 原文 / 未注册函数名、不成立的条件摘要 |
| 终局指令 | `RULE_TERMINAL_NOTICE` | 要求模型停止调用工具、向用户说明并结束回答 |

明细与终局指令由 `denyCardBody(details)` 拼成**第二个文本块**；`serializeToolResult` 以换行
拼接后进 `tool-events.jsonl` 的 `inline_content`，因此模型看到的与卡片展开内容是同一份。
`details.toolError.message` 仍是**结论原文**（不掺明细与终局指令）。

> **历史兼容**：改动前的失败轮 `error` 里仍有可选 `details` / `reason`
> （`unregistered` / `condition_false` / `config_unavailable`）。这两个字段与前端映射保留，
> 只为读旧记录；新拒绝不再产生失败轮（`spec.md` `FR-045`~`FR-047`）。

### 6.3 工具失败标记（暂停与拒绝共用既有通道）

`details.toolError = { code, message }`：暂停为 `ONTOLOGY_RULE_FUNCTIONS_MISSING`，
拒绝为 `ONTOLOGY_RULE_DENIED`。由 `agent-loop` 的 `afterToolCall` 翻成 `isError: true`
→ 卡片失败态 + 模型可读文案。**后置阻断例外**：行为确实执行成功，结果**不带**失败标记，
只在正文末尾追加阻断说明。

### 6.4 本轮工具挂起状态（`ToolSuspension`，2026-11-09）

| 字段 | 类型 | 语义 |
|---|---|---|
| `suspended` | `boolean` | 本轮是否已出现过拒绝（置位后不再判定、不再执行） |
| `code` | `string` | 触发挂起的码；后续拦截沿用同一码（不新增错误码） |
| `attempts` | `number` | 挂起后被拦截次数：`1` = 软拒；`>1` = 触发兜底纯中止 |
| `exhausted` | `boolean` | 兜底出口是否已用（单轮最多一次） |
| `onExhausted` | `() => void \| undefined` | 装配层接到 `req.interruptRun`（`ABORTED` 收尾） |

生命周期：装配层**每轮 `createToolSuspension` 一次**，随工具数组丢弃；020 / 021 **共享同一实例**。

## 7. 结构化日志字段

| 事件 | 级别 | 字段 |
|---|---|---|
| `rule_gate.paused` | `info` | `user_id` `agent_name` `thread_id` `tool_name` `ontology` `behavior` `rules`（规则名数组） `missing_functions` |
| `rule_gate.denied` | `warn` | 同上 + `rule` + `reason`（`condition_false` / `config_unavailable` / `unregistered`） + `failed_conditions`（`{rule, function, field, operator}` 数组，最多 10 条） |
| `rule_gate.blocked` | `error` | `user_id` `agent_name` `thread_id` `tool_name` `ontology` `behavior` `rules` `phase`（`pre` / `post`） `unregistered_functions` `executed`（后置阻断时 `true`） |
| `rule_gate.suspended` | `warn` | `user_id` `agent_name` `thread_id` `tool_name` `code` `attempts`（**不重复**判定字段，2026-11-09 新增） |
| `rule_gate.unavailable` | `error` | 同上 + `reason`（`bad_rules` / `bad_design` / `evaluator_error`） `warnings` |
| `rule_gate.catalog.degraded` | `warn` | `user_id` `agent_name` `warnings`（最多 20 条） |
| `rule_gate.record.dropped` | `warn` | `tool_name` `bytes` / `count` `reason`（`oversize` / `overflow`） |
| `rule_gate.posted` | `info` | `user_id` `agent_name` `thread_id` `tool_name` `behavior` `rules` |

**公共字段**：以上每个事件 MUST 含 `ts`（ISO 8601 时间戳，对齐 `spec.md` `FR-035` / `SC-005` 的"含时间"）
与 `event`（事件名本身）；`unavailable` MUST 另含 `alert: true`。

**不记录**：函数结果正文、工具入参、规则 `values` 原文（只记字段名与算子）。`record.dropped` 允许记
`bytes` / `count` 等体积与条数元信息（见 `FR-040` 的修订口径）。

## 8. 判定矩阵（单测必须覆盖的组合）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 工具是内置工具 | 不判定、不记录，原样执行 |
| 2 | 工具不是任何本体行为 | 执行 → 成功即记录；后置不追加 |
| 3 | 本体行为，无前置规则 | 执行（记录不写） |
| 4 | 有前置规则，`related_functions` 缺 1 个 | 暂停；文案列出缺失函数；行为不执行 |
| 5 | 有前置规则，缺 2 条规则的函数 | 暂停；**两条**规则全文都反馈 |
| 6 | 函数齐备，`design` 求值 true | 执行 |
| 7 | 函数齐备，`design` 求值 false | 拒绝 + 挂起本轮（软收尾） |
| 8 | 函数齐备，前置规则无 `design` | 执行（不阻断）+ 告警 |
| 9 | `design` 结构非法 | 拒绝 + 挂起 + 告警（`rule_gate.unavailable`） |
| 10 | 有后置规则，执行成功 | 原文完整 + 追加规则全文 |
| 11 | 有后置规则，执行失败 | 不追加 |
| 12 | 同一函数同轮成功两次 | 记录 1 条，值取后者 |
| 13 | 同一函数先成功后失败 | 值取 `null`（**失败覆盖成功**），键仍存在 |
| 14 | 上一轮记录过、本轮未调 | 本轮视为缺函数 → 注册校验 → 已注册则暂停 |
| 15 | 内置工具与函数同名 | 内置优先（不记录） |
| 16 | 单条结果超 256 KB | 丢弃 + 告警 → 键不存在 = 未执行 → 暂停 / 注册校验 |
| 17 | 前置规则引用**未注册**函数 | **阻断**：不执行 + 挂起本轮 + `reason=unregistered`，**不进入暂停**，`details` 点名该函数 |
| 18 | 前置规则函数**已注册**但未执行 | **暂停**（不阻断），提示先执行 |
| 19 | 服务里存在但被白名单过滤（未挂载） | 视为未注册 → 阻断（同 17） |
| 20 | 函数执行失败（记录 `null`） | 不触发暂停/注册校验；其条件全不成立 → 拒绝 + 挂起（`condition_false`） |
| 21 | 后置规则引用未注册函数、行为执行成功 | 行为照常执行并落库；**不追加**后置提示、业务正文保留；挂起本轮 + `reason=unregistered`，追加说明含"已执行成功、数据已写入" |
| 22 | 后置规则函数全部已注册 | 正常追加（`postHint` → `append`） |

> 第 4~8 行默认"函数全部已注册"，用于隔离前置判定本身的语义；注册校验的矩阵在 17~19 行。
