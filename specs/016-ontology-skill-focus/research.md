# 技术研究：意图聚焦（技能与本体能力聚焦）

- **特性**：`016-ontology-skill-focus`
- **日期**：2026-11-04
- **输入**：[spec.md](./spec.md)
- **结论**：所有技术未知项已收敛；无待澄清项。实现只改 `agent-backend`，不新增依赖、不新增服务、不改公开 HTTP 接口。

## 研究范围

本特性需要在不改变工具权限、历史 / 摘要 / 记忆的前提下，把 013 的工具聚焦替换为：

1. `SKILL.md` 头部识别（非本体技能 / 本体技能）；
2. 本体文件匹配与解析；
3. 技能与本体行为 / 函数的 `noul` 判定；
4. 规则关联函数补全与去重；
5. 中文聚焦提示铸造与上下文隔离；
6. 旧工具聚焦链路的移除。

## 现状取证

| 事实 | 证据 |
|---|---|
| 现有聚焦按**每个候选工具**构造一条 `noul`，不是 `choice` | `agent-backend/src/domain/intent-focus.ts` 的 `buildQuestions` / `NOUL_CRITERIA` |
| 现有阈值筛选使用 `score >= threshold` | `agent-backend/src/domain/intent-focus.ts` 的 `selectActions` |
| 现有输入上限为 200 字符（取尾部并对齐句首） | `intent-focus.ts` 的 `MAX_STATE_CHARS = 200`、`prepareState` |
| 现有候选上限 96、单批 32、总预算 10 秒 | `intent-focus.ts` 的 `MAX_CANDIDATES` / `MAX_QUESTIONS_PER_BATCH`；`config.ts` 的 `INTENT_FOCUS_DEFAULTS.timeoutMs = 10_000` |
| Laya 单题 256 token、整条序列 1024 token、题数无硬上限 | `intent-focus.ts` 头注释与 013 research |
| 现有聚焦在工具装配**之后**、模型调用之前回调 | `infra/agent-factory.ts` 的 `focusJudge` 块；`run-manager.ts` 的 `AgentRunRequest.focusJudge` |
| 现有 013 未配置 Laya 时**不构造** Runner，因此无法留档 `unconfigured` | `server-attachments.ts` 的 `focusConfig ? new IntentFocusRunner(...) : undefined` |
| `SKILL.md` frontmatter 已含 `metadata.ontology_id` / `ontology_name` | `skills/{name}/SKILL.md` 实际文件与 `agent-instance.ts` 的 frontmatter 解析 |
| `ontology.yaml` 已含 `metadata.ontology_id`、`functions[]`（`name`/`title`）、`behaviors[]`（`name`/`description`/`op_type`）、`rules[]`（`behavior`/`data_supplements`） | `admin-backend/.platform-data/onto_market/生产调度/原材料采购和库存/ontology.yaml` |
| 真实 `behaviors[]` 条目**有 `title`**，但字段位于 `params` 之后，不能按固定位置解析 | 同上，`behaviors` 段（`CreatePurchaseRecord` 的 `title: 创建原材料采购单` 在参数之后） |
| 部署物化目录为 `ontology/{scenario}/{ontology}/ontology.yaml` 与 `skills/{name}/SKILL.md` | `agent-backend/.opt-agent/users/admin/agents/BOM数字人/` 实际目录 |
| 运行环境已有 `yaml`、`zod`、唯一 `LayaClient`，无需新增依赖 | `agent-backend/package.json`、`src/infra/laya-client.ts` |

## 决策

### R1：用「技能聚焦 + 本体能力聚焦」整体替换工具聚焦

**决策**：删除 `AgentRunRequest.focusJudge`、`agent-factory` 的工具候选回调、`intent-focus.ts` 中的工具候选 / 选择 / 提示函数；新流程在 `run-consume.ts` 的 `buildPrompt` 之后、`agent.run` 之前调用。

**理由**：
- 新方案不再需要工具清单，继续保留 `focusJudge(tools)` 会把 domain 与工具装配耦合；
- `run-consume` 已有 `userId` / `agentName` / `threadId` / `messageId` / `userInput` / `skip`，也持有 `systemExtra`，是唯一合适的前置增强点；
- 工具权限、白名单、MCP 装配逻辑不变。

**替代方案**：
- 保留 `focusJudge`，忽略 `tools` 参数：改动小，但留下"domain 依赖工具装配"的错误边界，且无工具场景仍被耦合。
- 在 `agent-factory` 内直接读技能 / 本体：把文件 IO 塞进 infra 装配，违反分层。

### R2：技能与本体能力均使用 `noul`，不使用 `choice`

**决策**：每个技能、每个行为、每个函数各构造一条 `noul` 真值命题，题与题互不竞争，按绝对阈值筛选。

**理由**：
- 现有工具聚焦已验证 `noul` 的可解释性与多选能力；`choice` 会把概率归一化，候选一多阈值失效；
- 技能与能力都需要"多个同时命中"（一个请求可能同时需要多个技能 / 行为）；
- 复用 `LayaClient` 的既有协议与 `criteria: { true:'需要', false:'不需要' }`。

**替代方案**：`choice` 单选 + top-k。放弃：无法表达多选，阈值语义不稳定；与现有 013 的实测结论冲突。

### R3：`SKILL.md` 只读头部，且有界读取

**决策**：新增 `domain/skill-header.ts`：
- 用 `fs.openSync` + `readSync` 读前 64KB，不在内存中读完整正文；
- 只解析第一个 `---` 到下一个 `---` 的 frontmatter；
- `name` / `description` 必填；`metadata.ontology_id` / `scenario_id` 归一化为字符串；`ontology_name` / `scenario_name` 去空白；
- `agent-instance.ts` 复用同一解析器，避免两套 frontmatter 口径。

**理由**：
- 规格明确"不是全部内容"；有界读取比 `readFileSync` 更贴合；
- 现有 `agent-instance.parseFrontmatter` 是私有的，只返回 name/description；新增 metadata 解析必须单一来源；
- 有界读取也避免超大 `SKILL.md` 拖慢聚焦。

**替代方案**：`readFileSync` 后截取 frontmatter。实现简单但实际读了正文，不满足规格的"只读头部"。

### R4：本体文件按目录枚举 + `ontology_id` 建索引，不接受路径拼接

**决策**：
- 只枚举 `agentDir/ontology/{scenario}/{ontology}/ontology.yaml`；
- 只接受 `Dirent.isDirectory()` 的真实目录与 `lstat().isFile()` 的真实文件，符号链接跳过；
- `SKILL.md` 中的 `scenario_name` / `ontology_name` 只用于展示与记录，**不参与路径拼接**；
- 按 `metadata.ontology_id` 归一化后建 `Map<string, OntologyDefinition[]>`；同 ID 多文件全部保留；
- 只取 `metadata`、`functions`、`behaviors`、`rules`，忽略 `concepts` / `relations` / 参数 / 代码文件。

**理由**：
- 避免路径穿越 / 符号链接逃逸，同时不复制 `skill-access` 的安全逻辑；
- 需求第 3 条只要求 `ontology_id` 相同，按 ID 索引最直接；
- 真实本体文件约 1000 行，读取完整 YAML 可接受（仅 1~2 个文件）。

**替代方案**：按 `scenario_name/ontology_name` 拼路径再校验。放弃：名称可能为空 / 不一致，且引入路径注入面。

### R5：技能与能力候选的边界

**决策**：
- 技能候选上限 **32**（当前数字人可聚焦技能），按技能目录排序原序截断；
- 行为 + 函数候选合计上限 **96**，按本体原序、行为在前的顺序截断；
- 单批判定 **32** 题；
- 技能 `qid` 用 `s1..sN`，能力 `qid` 用 `c1..cN`；候选与 qid 一一映射，响应按 qid 回收。

**理由**：
- 与 013 的 96 / 32 实测一致；4 批 × 约 2 秒仍在 10 秒预算内；
- 不透明 qid 避免中文、重名、特殊字符导致的响应对齐错误；现有工具 qid 用工具名是因为工具名唯一且 ASCII，本特性不具备该前提；
- 原序截断保证确定性，便于留档复现。

**替代方案**：用 `name` 作 qid。放弃：跨本体重名、中文 / 空格 / 标点都会增加映射风险。

### R6：严格大于阈值（`score > threshold`）

**决策**：技能与能力筛选均使用 `score > threshold`；等于阈值丢弃。

**理由**：
- 规格反复使用"超过阈值""保留超过阈值的"；用户需求原文也是"超过"；
- 现有工具代码是 `>=`，那是 013 的实现口径；本特性替换后统一为严格大于，避免边界歧义；
- 单测显式覆盖 0.60 / 0.61 / 0.82（阈值 0.6）与"等于阈值"用例。

**替代方案**：沿用 `>=`。放弃：与规格"超过"不一致；计划阶段已记录该差异。

### R7：数据补充只对直接入选行为生效

**决策**：
- 对每个直接入选行为，找 `rules[]` 中 `behavior === 行为 name` 的规则；
- 收集 `rules[].data_supplements`（多条规则取并集），在同一本体 `behaviors[]` 中按 `name` 找到 `title`；
- 追加为**行为**决策：`source='supplement'`、`score=null`、`selected=true`，不受阈值约束；
- 未入选行为不触发补充；悬空行为名丢弃并记录 `missing_supplement_behavior`；`related_functions` 不参与补全。

**理由**：
- 实际本体中 `rules[].data_supplements` 声明的都是查询行为（如 `QueryPurchaseRecords`、`QueryRawMaterials`、`QuerySuppliers`），它们是主行为执行前必须就绪的数据来源，补进**行为**聚焦才能让模型看到"先查什么"；
- `related_functions` 是规则校验用的函数（如 `checkRawMaterialUnit`），属于内部校验实现，不构成用户意图维度的候选；本特性只读 `name` / `title`，补函数会挤出真正需要的行为；
- 数据补充项没有独立评分，`score=null` 比伪造 0 分更诚实，留档可区分直接入选与补充。

**替代方案**：①仍按 `related_functions` 补函数。放弃：与数据补充字段的实际语义不符，且行为与函数分类会被污染。②对补充行为也做一次 noul 评分。放弃：补充项是主行为的必要依赖，评分会让阈值漏掉必要数据来源；再评分也增加批次与延迟。

### R8：去重键、排序与提示分组

**决策**：
- 去重键：`kind + name`（行为、函数分别去重）；跨本体重名合并；
- 合并规则：分数取最高、来源合并（`direct` / `supplement` / `direct+supplement`）、`ontologyIds` 取并集、`title` 取首次出现；
- 排序：直接入选按分数降序、同分原序；数据补充按本体原序 / 行为原序追加；
- 提示按技能分数降序分组；同一本体被多个入选技能引用时，能力归属**分数最高的技能**，其余技能只出技能段，避免能力重复。

**理由**：
- 规格 FR-034 / FR-035 明确"类别 + name"与跨本体合并；
- 提示必须"先技能说明、再本体能力"（FR-047），又不能因多技能共享本体而重复列同一批能力；
- 归属最高分技能是确定性规则，便于测试与留档。

**替代方案**：能力独立成一段、不归属技能。放弃：无法满足"本体技能补充技能聚焦说明"的呈现要求；也难让模型知道能力属于哪个技能。

### R9：提示格式与截断

**决策**：

```text
本轮可优先参考以下聚焦结果（仅供参考，不必局限）：技能：{name}（{description ≤80 字}）；本体能力：行为：{title}（{name}），函数：{title}（{name}）；技能：...
```

- 非本体技能只有 `技能：...`；
- 本体技能先技能说明，再 `本体能力`；空类别省略；
- 段间 `；`，条目 `，`，整体单行；
- 总长 ≤ 1200 字符；超限先删能力条目、再删末尾技能段，只删完整条目并标 `truncated`。

**理由**：
- 直接回应用户"非本体技能仅聚焦技能文件""本体技能补充技能聚焦说明"；
- `title（name）` 兼顾可读性与可追溯性；
- 1200 字符约为 600~900 token，仍在 system prompt 可接受范围；完整条目截断避免半截语义。

**替代方案**：只列 name，不列 description。放弃：用户明确要求本体技能补充技能聚焦说明；纯 name 无法让模型理解技能用途。

### R10：总预算 10 秒、输入 200 字符（规格事实校正）

**决策**：
- `timeoutMs` 沿用 `INTENT_FOCUS_DEFAULTS.timeoutMs = 10_000`；按批数均分，单批下限 300ms；
- `MAX_STATE_CHARS` 沿用 200，取输入尾部并对齐句首。

**理由**：
- Laya `max_sequence_tokens = 1024`；中文 1800 字约 999 token，8000 字会 422；
- 现有 013 实测 32 题 / 批约 1.8~2.2 秒；技能 1 批 + 能力最多 3 批约 8 秒，5 秒预算会系统性降级；
- 200 字符是现有保守值，能覆盖"问题在尾部"的常见输入。

**替代方案**：5 秒总预算、8000 字符输入。放弃：与 Laya 限制和实测延迟冲突。规格已在 plan 阶段回写。

### R11：配置复用与新增

**决策**：
- 技能阈值：沿用 `INTENT_FOCUS_THRESHOLD`（环境变量优先于 YAML `threshold`）；
- 能力阈值：新增 YAML `ontology_threshold` + 环境变量 `INTENT_FOCUS_ONTOLOGY_THRESHOLD`；
- 候选上限：新增 YAML `max_skills`（32）/ `max_capabilities`（96），不新增环境变量；
- `timeout_ms` 不变（300~10000）。

**理由**：
- 现场调技能阈值不必改挂载文件，沿用既有环境变量；
- 能力阈值是新语义，必须有独立键，不能复用技能阈值；
- 候选上限属于部署级防御参数，YAML 足够，避免环境变量碎片化。

**替代方案**：全部用新环境变量。放弃：会破坏现有运维习惯，且 `INTENT_FOCUS_THRESHOLD` 已存在。

### R12：记录复用 013 侧车文件，schema 替换但不迁移

**决策**：
- 继续写 `intent-focus.jsonl`，沿用 256KB / 200 行 / 保留 100 行的滚动策略与 per-thread 串行；
- 记录主体改为 `skills` / `ontology_files` / `behaviors` / `functions` / `data_supplements` / `selected_*` / `prompt`；
- 不再写 `probabilities` / `actions` / `focus_prompt`；`readAll` 对旧行容错（JSON 解析成功即可读，不强制 schema）。

**理由**：
- 规格要求与会话历史物理分离、运行期无读取方；复用现有存储最稳；
- 旧记录只用于历史分析，不需要迁移；严格解析旧 schema 反而会破坏读取；
- 新记录字段与 FR-051 一一对应。

**替代方案**：新建 `ontology-focus.jsonl`。放弃：同一轮会分裂成两个文件，排障要跨文件对齐；用户要求高内聚。

### R13：测试策略

**决策**：
- 纯函数模块（skill-header、loader、candidates、selection、prompt、core）全部单测；
- 编排 / 装配 / 存储用临时目录 + 桩 `LayaDecider` 做集成测试；
- 集成测试不依赖真实 Laya、不改全局配置、不写真实 `.opt-agent`；
- 覆盖五态（focused / empty / skipped / degraded / unconfigured）与旧链路零调用断言。

**理由**：符合宪法原则四（不依赖外部服务、覆盖率 ≥80%）与现有测试结构。

## 未决项

无。以下为**计划内明确不做**，不是未决：

- 不用 `behaviors[].description` 作为缺失 `title` 的展示兜底（本期按规格回退 `name`；后续可单独评估）；
- 不做跨轮缓存、向量索引、人工纠正、界面展示；
- 不做 `concepts` / `relations` 推理；
- 不做旧记录迁移。
