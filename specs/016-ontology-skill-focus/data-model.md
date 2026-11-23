# 数据模型：意图聚焦（技能与本体行为聚焦）

- **特性**：`016-ontology-skill-focus`
- **日期**：2026-11-04（2026-11-06 修订：能力只到行为；删除函数、规则与数据补充；记录只写入选行为。2026-11-20 修订：函数窄口径恢复，行为与函数共用候选上限、各自阈值；取数行为不判分）
- **输入**：[spec.md](./spec.md)、[research.md](./research.md)
- **范围**：运行环境侧（`agent-backend`）的只读领域模型、判定中间态、提示语法与线程侧车记录。无数据库、无表、无迁移。

## 1. 不变量

| # | 不变量 |
|---|---|
| **DM-1** | 技能判定只使用 `SKILL.md` 头部（`name`、`description`、`metadata`），不读正文。 |
| **DM-2** | 本体判定只使用 `ontology.yaml` 的 `metadata`、`behaviors` 与 `functions`（函数只取 `name` / `title` / `description` / `related_concepts`，2026-11-20）；不读 `rules` / `functions[].params` / `functions[].response` / 参数正文 / 代码文件；`concepts` / `relations` 仅阶数 > 0 时读取。 |
| **DM-3** | 非本体技能只产生技能决策；不产生本体文件、行为决策。 |
| **DM-4** | 未匹配到任何 `ontology.yaml` 的本体技能不产生技能候选（按需求第 3 条不选中）。 |
| **DM-5** | 技能、行为、函数判定均为 `noul`；入选条件为 `score > threshold`（行为与函数各自阈值），等于阈值即丢弃。 |
| **DM-6** | 去重键为 `ontology_id + name`；跨本体同名不合并。 |
| **DM-7** | 记录只写线程侧车 `intent-focus.jsonl`，不写历史 / 摘要 / 记忆；运行期无读取方。 |
| **DM-8** | 每轮判定独立；本体解析只在本轮内缓存，不跨轮复用。 |
| **DM-9** | 记录中的行为明细**只含入选行为**，不写恒定字段（类别 / 是否入选 / 入选来源）。 |

## 2. 输入实体

### 2.1 SkillHeader（技能头部）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 技能标识；frontmatter 非空字符串 |
| `description` | string | 是 | 技能用途说明；frontmatter 非空字符串 |
| `metadata` | SkillMetadata | 否 | 缺失视为非本体技能 |
| `dirName` | string | 是 | 技能目录名（用于排序、留档；不参与题面） |

**校验**：
- `name` / `description` 去首尾空白后不得为空；否则该技能解析失败、跳过并记录。
- `metadata` 不是对象 → 按空对象处理（非本体技能），不抛整轮错误。
- `ontology_id` / `scenario_id` 允许数字或字符串，统一 `String(value).trim()`；空白视为缺失。
- `ontology_name` / `scenario_name` 只接受字符串，去空白。

### 2.2 SkillMetadata

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ontologyId` | string \| null | 否 | 归一化后的本体 ID |
| `ontologyName` | string \| null | 否 | 本体名称（展示 / 记录） |
| `scenarioId` | string \| null | 否 | 场景 ID（展示 / 记录） |
| `scenarioName` | string \| null | 否 | 场景名称（展示 / 记录） |

**派生**：
- `isOntologySkill = ontologyId !== null && ontologyName !== null`。
- 只有 `ontologyId` 或只有 `ontologyName` → 非本体技能。

### 2.3 OntologyDefinition（本体定义）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | string | 是 | 相对数字人目录的路径（POSIX 分隔符，用于留档） |
| `ontologyId` | string | 是 | `metadata.ontology_id` 归一化值 |
| `ontologyName` | string \| null | 否 | `metadata.ontology_name` |
| `scenarioId` | string \| null | 否 | `metadata.scenario_id`（仅解析，不参与判定） |
| `scenarioName` | string \| null | 否 | `metadata.scenario_name`（仅解析，不参与判定） |
| `behaviors` | OntologyBehavior[] | 是 | 缺失按空数组 |
| `functions` | OntologyFunction[] | 是 | 缺失按空数组（2026-11-20 恢复解析） |

**校验 / 归一化**：
- `metadata.ontology_id` 空白 → 该文件丢弃并记录 `missing_ontology_id`。
- `behaviors[].name` 空白 → 该条目丢弃并记录。
- `functions[].name` 空白 → 该条目丢弃并记录（不告警）。
- `title` 非字符串或空白 → 视为缺失；`title ?? name`。
- `functions[].related_concepts` 非数组 / 元素非字符串 → 按空数组处理（不告警）。
- `rules` 出现时**忽略**：不解析、不告警、不进入任何下游结构。

### 2.4 OntologyBehavior

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 行为标识 |
| `title` | string | 是 | 中文标题；缺失时回退 `name`（解析期即兜底） |
| `description` | string | 是 | 行为描述；缺失为空串（题面降级顺序 `description → title → name` 在此之后统一裁决） |
| `opType` | string \| null | 否 | `command` / `query` 等；仅解析，不参与题面 |

### 2.5 OntologyFunction（2026-11-20 恢复）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 函数标识 |
| `title` | string | 是 | 中文标题；缺失时回退 `name` |
| `description` | string | 是 | 函数描述；缺失为空串；题面降级顺序同行为 |
| `relatedConcepts` | string[] | 是 | `related_concepts` 归一化后的概念名；缺失为空数组 |

**约束**：只解析这四个字段；`params` / `response` MUST NOT 被读取或透传（`FR-020`）。

> 2026-11-06：`OntologyFunction` 与 `OntologyRule` 类型已删除。
> 2026-11-07：`description` 纳入建模（此前未解析），作为行为题面的首选展示文本。
> 2026-11-20：`OntologyFunction` **窄口径恢复**（四字段）；`OntologyRule` 仍不恢复。

## 3. 判定实体

### 3.1 FocusCandidateBase

| 字段 | 类型 | 说明 |
|---|---|---|
| `qid` | string | 不透明题号：技能 `s1..sN`，行为 `c1..cN` |
| `name` | string | 技能 / 行为标识 |
| `label` | string | 题面展示文本，≤ 40 字 |
| `index` | number | 原序下标，用于同分稳定排序 |

### 3.2 SkillCandidate

| 字段 | 类型 | 说明 |
|---|---|---|
| `header` | SkillHeader | 技能头部 |
| `matchedOntologies` | OntologyDefinition[] | 匹配到的本体（非本体技能为空） |
| `isOntologySkill` | boolean | 派生 |
| `excludedReason` | string \| null | 仅用于未进入候选的技能：`no_matching_ontology`、`invalid_header` |

**可聚焦规则**：
- 非本体技能 → 候选；
- 本体技能且 `matchedOntologies.length > 0` → 候选；
- 本体技能且无匹配 → 不生成候选、不评分，但仍以
  `SkillDecision{ selected:false, score:null, reason:'no_matching_ontology' }` 进入记录，
  便于 FR-014 追溯。

### 3.3 CapabilityCandidate

| 字段 | 类型 | 说明 |
|---|---|---|
| `qid` | string | 不透明题号 `c1..cN`（行为与函数共用同一序列） |
| `kind` | `'behavior' \| 'function'` | 候选类别（2026-11-20 恢复）：决定阈值与题面措辞 |
| `name` | string | 行为 / 函数名 |
| `title` | string | 展示标题（解析期已用 `name` 兜底） |
| `description` | string | 行为 / 函数描述；题面首选（空则降级 `title`，再降级 `name`），≤40 字截断 |
| `ontologyId` | string | 来源本体 ID |
| `ontologyName` | string \| null | 来源本体名 |
| `relatedConcepts` | string[] | 仅函数非空：函数依赖的概念名 |
| `index` | number | 原序下标 |

> 2026-11-06：候选只剩行为一类，`kind` 已删除；`ontologyPath` / `ownerSkillNames` 从未落地。
> 2026-11-20：`kind` 恢复（行为 / 函数两值），`relatedConcepts` 新增；两类共用 `max_capabilities`
> 与同一批题，收集序为「本体枚举序 → `behaviors[]` → `functions[]`」。

### 3.4 SkillDecision

| 字段 | 类型 | 说明 |
|---|---|---|
| `header` | SkillHeader | 技能头部（记录时扁平化） |
| `isOntology` | boolean | 是否本体技能 |
| `ontologyId` | string \| null | 关联本体 id（一个本体技能恒只有一个本体；非本体 / 未匹配为 null） |
| `score` | number \| null | 无效 / 未评分时为 null |
| `selected` | boolean | 是否 `score > skillThreshold` |
| `reason` | string \| null | `below_threshold` / `no_matching_ontology` / `not_scored` |

### 3.5 CapabilityDecision

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 行为名 |
| `title` | string | 展示标题 |
| `ontologyId` | string | 归属本体 ID（去重键的一部分） |
| `ontologyName` | string \| null | 归属本体名 |
| `score` | number | 入选分数（恒 > 阈值） |
| `index` | number | 原序下标（同分稳定） |

> 2026-11-06：`kind` / `selected` / `source` / `reason` / `ontologyIds` 已删除——
> 决策集合只表达入选行为，其余字段恒为常量或可由分数推导。

### 3.5.1 FunctionDecision（2026-11-20）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 函数名 |
| `title` | string | 展示标题 |
| `ontologyId` | string | 归属本体 ID |
| `ontologyName` | string \| null | 归属本体名 |
| `score` | number | 入选分数（恒 > `ontology_function_threshold`） |
| `relatedConcepts` | string[] | 函数依赖的概念名 |
| `index` | number | 原序下标 |

### 3.5.2 ConceptQueryDecision（2026-11-20，取数行为）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 行为名（同本体 `op_type: query`） |
| `title` | string | 展示标题 |
| `ontologyId` | string | 归属本体 ID |
| `ontologyName` | string \| null | 归属本体名 |
| `concept` | string | 该行为所属概念（即触发取数的关联概念） |
| `index` | number | 原序下标 |

**约束**：不判分（`score` 恒 `null`）、不参与发散、不作为新的取数起点（`FR-066`）。

### 3.6 DataSupplement（已删除）

2026-11-06 起不再存在：规则不解析、查询行为不再补入。

### 3.7 IntentFocusOutcome

| 字段 | 类型 | 说明 |
|---|---|---|
| `disposition` | `'focused' \| 'empty' \| 'skipped' \| 'degraded' \| 'unconfigured'` | 处置结论 |
| `reason` | string \| null | 具体原因 |
| `prompt` | string | 提示原文；无提示为空串 |
| `skills` | SkillDecision[] | 全部已解析关联技能决策（含未匹配本体的本体技能） |
| `behaviors` | CapabilityDecision[] | 入选行为（只有入选集合） |
| `functions` | FunctionDecision[] | 入选函数（只有入选集合；2026-11-20） |
| `conceptQueries` | ConceptQueryDecision[] | 关联概念取数行为（不判分；2026-11-20） |
| `truncated` | boolean | 候选是否被上限截断 |
| `promptTruncated` | boolean | 提示是否被长度上限截断（阶数分档，见 FR-041） |
| `batches` | number | 实际提交批数 |
| `warnings` | string[] | 坏文件 / 无效技能 / 符号链接跳过等；≤50 条 |
| `error` | string \| null | 降级原因（内部错误摘要） |

## 4. 状态与处置

```text
开关关闭（disabled）           → 不记录，返回 ""
开关开启 + 卡片 / guidance     → skipped（记录）
开关开启 + Laya 未配置          → unconfigured（记录）
开关开启 + 可聚焦技能为 0       → empty / no_skills（记录）
开关开启 + 技能全部低于阈值     → empty / below_threshold（记录）
开关开启 + 技能入选、能力为空   → focused（记录，提示只有技能段）
开关开启 + 技能入选、能力入选   → focused（记录，提示含能力段）
Laya 超时 / 全部批次失败        → degraded（记录）
部分批次失败但有可用结果        → 有入选则 focused（记录 error），无入选则 degraded
```

**判定优先级**：`disabled` > `skipped` > `unconfigured` > `empty` / `focused` / `degraded`。

**原因枚举**：

| disposition | reason |
|---|---|
| `skipped` | `skip_flag` / `guidance` |
| `unconfigured` | `laya_not_configured` |
| `empty` | `no_skills` / `no_focusable_skills` / `below_threshold` |
| `degraded` | `timeout` / `laya_unreachable` / `invalid_response` / `all_batches_failed` / `internal_error` |
| `focused` | `null` |

## 5. 记录 schema（`intent-focus.jsonl`）

### 5.1 TypeScript 形状

```ts
interface IntentFocusRecord {
  at: string;                  // ISO8601
  thread_id: string;
  agent_name: string;
  message_id: string | null;
  seq: number;                 // 线程内递增
  input: string;               // 截断后的判定输入
  input_truncated: boolean;
  disposition: 'focused' | 'empty' | 'skipped' | 'degraded' | 'unconfigured';
  reason: string | null;
  model: string | null;
  round_ms: number | null;
  candidates: number;           // 技能 + 行为候选总数
  batches: number;
  truncated: boolean;
  skills: SkillFocusRecord[];
  behaviors: CapabilityFocusRecord[];   // 只写入选行为（含 source='concept_query' 的取数项）
  functions: FunctionFocusRecord[];     // 只写入选函数（2026-11-20）
  prompt: string;
  prompt_truncated: boolean;
  warnings: string[];           // 坏文件 / 无效技能 / 符号链接跳过等，不含用户可见错误
  error: string | null;
}

interface SkillFocusRecord {
  name: string;
  description: string;
  is_ontology: boolean;
  ontology_id: string | null;   // 一个本体技能恒只有一个本体；非本体技能为 null
  score: number | null;
  selected: boolean;
  reason: string | null;
}

interface CapabilityFocusRecord {
  name: string;
  title: string;
  ontology_id: string;        // 归属本体（去重键的一部分）
  ontology_name: string | null;
  score: number;              // 恒 > 阈值（明细只含入选行为）
}

interface FunctionFocusRecord {   // 2026-11-20
  name: string;
  title: string;
  ontology_id: string;        // 归属本体（去重键的一部分）
  ontology_name: string | null;
  score: number;              // 恒 > ontology_function_threshold
  related_concepts: string[]; // 函数依赖的概念名
}

interface IntentFocusRecordDraft extends Omit<IntentFocusRecord, 'at' | 'seq'> {
  at?: string;
}
```

### 5.2 记录约束

- 一文件一行一条，追加写；`at` / `seq` 由 `IntentFocusStore` 补齐。
- 滚动：单文件 > 256KB 或 > 200 行 → 重写保留最近 100 条，临时文件 + 原子改名。
- 并发：per-thread Promise 链串行。
- 写失败：只告警，不影响对话；记录可缺失。
- 运行期无读取方；`readAll` 仅测试 / 事后分析。
- 旧行（含 `probabilities` / `actions` / `focus_prompt`）可被 `readAll` 读出；新代码不写这些字段，不强制旧 schema。
- `input` 为 `prepareState` 后的文本；`input_truncated` 标记是否截断。
- `prompt` 为最终追加文本；跳过 / 未配置 / 空结果时为空串。
- `candidates` 计数包含技能与行为候选；`batches` 只计实际调用的批数。
- `skipped` / `unconfigured` 不读取技能与本体：`candidates=0`、`batches=0`、`round_ms` 接近 0；
  `skills` / `behaviors` 为空数组，`warnings` 可为空。
- `behaviors` 只写入选行为（2026-11-20 起含 `source: 'concept_query'` 的取数项，`score` 为 `null`）；
  不写 `kind` / `selected`，记录不出现 `data_supplements`。
- `functions` 只写入选函数；未入选函数与未入选行为一样不落档（`FR-070`）。
- 019 引入的 `source` / `hop` / `via_concept` / `from_concept` 与 `tool_tip_behaviors` 字段
  以 `FR-051` 与 `intent-focus/store.ts` 为准（本节为 016 初版形态，未逐条回写）。
- `warnings` 最多 50 条（超出的尾部丢弃），避免坏文件很多时单条记录失控。

### 5.3 记录示例

```json
{
  "at": "2026-11-04T08:12:33.120Z",
  "thread_id": "th_01",
  "agent_name": "BOM数字人",
  "message_id": "msg_01",
  "seq": 1,
  "input": "帮我创建一笔原材料采购记录",
  "input_truncated": false,
  "disposition": "focused",
  "reason": null,
  "model": "laya-multilingual",
  "round_ms": 3120,
  "candidates": 41,
  "batches": 3,
  "truncated": false,
  "skills": [
    {
      "name": "raw-material-inventory-new",
      "description": "原材料采购和库存本体技能",
      "is_ontology": true,
      "ontology_id": "1",
      "score": 0.91,
      "selected": true,
      "reason": null
    }
  ],
  "behaviors": [
    {
      "name": "CreatePurchaseRecord",
      "title": "创建原材料采购单",
      "ontology_id": "1",
      "ontology_name": "原材料采购和库存",
      "score": 0.88
    },
    {
      "name": "QueryPurchaseRecords",
      "title": "查询原材料采购单信息",
      "ontology_id": "1",
      "ontology_name": "原材料采购和库存",
      "score": 0.67
    }
  ],
  "prompt": "本轮的任务与以下技能或本体行为密切相关，请重点关注（仅供参考，不必局限）\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'；关联行为：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords））",
  "prompt_truncated": false,
  "warnings": [],
  "error": null
}
```

## 6. 提示语法

### 6.1 产生式

> ⚠ 本节保留 016 初版语法。019 起（`直接命中：` / `上游路径：` 两段、长度按阶数 2000/3000/4000）
> 与 2026-11-20（首行前缀含「本体函数」、函数与取数行为并入 `直接命中` 行、剪枝顺序
> 「路径行 → 取数条目 → 函数条目 → 行为条目」）的改动，**以 `spec.md` 的 FR-041 / FR-068 为准**。

```text
prompt        = prefix, "\n", item, { "\n", item }
prefix        = "本轮的任务与以下技能或本体行为密切相关，请重点关注（仅供参考，不必局限）"
item          = index, "）", item_body
index         = "1" | "2" | ...            // 截断后重新连续编号
item_body     = non_ontology_body | ontology_body
non_ontology_body = skill_name, "（非本体技能）"
ontology_body = skill_name, "（", "本体技能", "；", ontology_ref,
                [ "；关联行为：", entry, { "、", entry } ], "）"
ontology_ref  = [ "ontology_name='", ontology_name, "'，"], "ontology_id='", ontology_id, "'"
entry         = title, "（", name, "）"
```

**约束**：
- 首行固定前缀；其后每个入选技能一行，行号从 `1` 连续编号（截断后重新编号）。
- 片段内中文分号 `；`、条目中文 `、`；片段内换行压成空格，不产生额外行。
- `description` 不进入提示（技能只出现 `name`）。
- `title` / `name` 保留原文；`title` 缺失时 `title = name`；本体无 `ontology_name` 时只写 `ontology_id='X'`。
- 关联本体写成一组显式字段：`ontology_name='…'，ontology_id='…'`。
- **一个本体技能恒只有一个本体**（`SKILL.md` 的单个 `ontology_id`）：每行至多一组本体字段；同一 `ontology_id` 被物化成多份文件时只取首份，不重复输出。
- 非本体技能不产生本体/行为部分。
- 本体技能无任何入选行为时不产生空的 `关联行为：` 段。
- MUST NOT 出现 `关联函数：` 段。
- 同一本体只出现一次行为块；归属分数最高的入选技能。
- 总长 ≤ 1200 字符；超限依次删末尾技能的行为条目 → 整个末尾技能行，保持完整条目。

### 6.2 示例

```text
本轮的任务与以下技能或本体行为密切相关，请重点关注（仅供参考，不必局限）
1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'；关联行为：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords））
2）plain-skill（非本体技能）
```

## 7. 规则与算法约束

### 7.1 ID 归一化

```text
normalizeId(v) = v == null ? null : String(v).trim() || null
```

- `ontology_id: 1` 与 `ontology_id: '1'` 归一化后相同。
- 空字符串、纯空白 → null。
- 匹配只比较 `ontologyId`；`ontologyName` 不参与匹配。

### 7.2 阈值

- 技能：`score > config.skillThreshold`。
- 行为：`score > config.ontologyBehaviorThreshold`（2026-11-20 由 `ontologyThreshold` 改名）。
- 函数：`score > config.ontologyFunctionThreshold`（2026-11-20 新增，缺省 0.8）。
- 分数先 clamp 到 `[0, 1]`；非有限数、缺失、越界（clamp 前非数字）→ 不入选。
- 规则不再提供任何"免疫阈值"的入选项：所有行为一视同仁；函数同理。
- 取数行为不判分、不受任何阈值约束（由函数命中带出）。

### 7.3 去重

| 类别 | 键 | 合并 |
|---|---|---|
| 行为 | `ontology_id + name` | 最高分、`title` 首次 |
| 函数 | `ontology_id + name`（与行为互不相交，二者键空间独立） | 最高分、`title` 首次 |
| 取数行为 | `ontology_id + name` | 只出现一次；已被行为直接命中时不重复（`FR-067`） |

- 去重后「本体 + 名称」唯一；**跨本体同名各自保留**（各自归属自己的本体）。
- 去重分两处：**候选构造阶段**按 `ontology_id + name` 先去重（同一题不重复送判定、不挤占 `max_capabilities`）；**选择阶段**再做一次同键去重（保留最高分）。
- `ontology_id` 恒为该项唯一归属。
- 去重后行为总数 MUST ≤ 96（`FR-027`）；超限按分数序截断，`truncated = true`。

### 7.4 排序

1. 行为：`score` 降序；同分按候选原序（本体枚举序 / 行为数组序）。
2. 提示：技能按分数降序；行为按上述顺序。

### 7.5 截断

| 对象 | 上限 | 行为 |
|---|---|---|
| 技能候选 | 32 | 原序截断，`truncated=true` |
| 行为 + 函数候选 | 96（合计） | 按「本体枚举序 → 行为 → 函数」截断，`truncated=true` |
| 行为结果 | 96 | 去重后超限按分数序截断，`truncated=true` |
| 函数结果 | 96 | 去重后超限按分数序截断（与行为结果各自独立计数） |
| 单批题数 | 32 | 分批；批数计入 `batches` |
| 判定输入 | 200 字符 | 取尾部、对齐句首，`input_truncated=true` |
| 技能题面标签 | 40 字 | 截断 |
| 提示技能说明 | 80 字 | 截断 |
| 提示总长 | 1200 字符 | 删完整条目，`prompt_truncated=true` |
| 记录文件 | 256KB / 200 行 | 保留最近 100 行 |

## 8. 配置模型

```yaml
intent_focus:
  base_url: http://laya:8000
  model: laya-multilingual
  api_key: $DECIS_API_KEY
  timeout_ms: 10000          # 300~10000
  skill_threshold: 0.8       # 技能阈值；环境变量 INTENT_FOCUS_SKILL_THRESHOLD 优先
  ontology_behavior_threshold: 0.8    # 行为阈值；INTENT_FOCUS_ONTOLOGY_BEHAVIOR_THRESHOLD 优先
  ontology_function_threshold: 0.8    # 函数阈值；INTENT_FOCUS_ONTOLOGY_FUNCTION_THRESHOLD 优先
  max_skills: 32             # 可选，1~256
  max_capabilities: 96       # 可选，1~96；键名保留，语义为「行为与函数候选合计上限」
```

> 2026-11-20：`ontology_threshold` 更名为 `ontology_behavior_threshold`，**旧键不再接受**
> （`strict()` 启动即报错）；新增 `ontology_function_threshold`。

**约束**：
- `intent_focus` 整块缺失 → 功能不可用；开关开启时记录 `unconfigured`，启动不失败。
- 块存在但字段不全 / 越界 → 启动失败（与 013 一致）。
- 未知键 → 启动失败（`strict()`），避免拼写错误被静默忽略。
- `skill_threshold` / `ontology_behavior_threshold` / `ontology_function_threshold` 环境变量优先，
  但 YAML 值仍校验；旧键 `ontology_threshold` 属未知键 → 启动失败。
- `timeout_ms` 上限 10000；`max_*` 上限 256。

## 9. 兼容性

- **013 记录**：旧字段 `probabilities` / `actions` / `focus_prompt` 不再写入；`readAll` 仍可读旧行，不做迁移。
- **013 配置**：`intent_focus` 块保留；`skill_threshold` 语义从工具阈值改为技能阈值，值域不变；新增键均可选。
- **016 旧记录行**：可能含旧形态 `functions` / `data_supplements` / `kind`，`readAll` 原样读出；新代码不写 `data_supplements` / `kind`，`functions` 自 2026-11-20 起按新形态写入（入选函数），不做迁移。
- **公开 HTTP**：`skip_intent_focus` 字段、SSE 事件、历史 schema 不变；无新增请求 / 响应字段；`tool_tips` 结构不变。
- **前端 / 管理端**：无字段、无页面改动。
- **平台数据**：只读部署物；不反向写回；不修改 `SKILL.md` / `ontology.yaml`。

## 10. 需求映射

| 需求 | 数据落点 |
|---|---|
| FR-011 / FR-012 | `SkillHeader.metadata`、`OntologyDefinition.ontologyId`、`SkillCandidate.matchedOntologies` |
| FR-016 / FR-021 | `SkillDecision.score` / `CapabilityDecision.score`；`noul` 题面 |
| FR-019 | 非本体技能无 `OntologyDefinition` / 行为决策 |
| FR-030~FR-035 | 规则不建模（无落点）；去重键 `ontology_id+name`；`functions[].related_concepts` 用于取数（无 `related_functions`）；记录无 `data_supplements` |
| FR-065~FR-070 | `CapabilityCandidate.kind` / `FunctionDecision` / `ConceptQueryDecision` / `FunctionFocusRecord` |
| FR-041 / FR-047 / FR-048 | 提示语法 §6、`SkillFocusRecord` / `CapabilityFocusRecord` |
| FR-050 / FR-051 | `IntentFocusRecord` |
| FR-061 / FR-062 | 配置模型 §8 |
