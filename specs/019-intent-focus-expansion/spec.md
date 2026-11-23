# 特性规格：意图聚焦一阶发散（019）

**特性分支**：`019-intent-focus-expansion`
**创建日期**：2026-11-08
**状态**：已实现（与 `016` 同链路，本文只承载增量口径）
**上游特性**：`016-ontology-skill-focus`（技能聚焦 + 本体行为聚焦）

---

## 1. 背景与目标

`016` 的能力聚焦只输出「Laya 判分命中」的本体行为。用户提出：以命中的行为为锚点，沿本体
`relations[]` 做**一阶（可配 0~2 阶）同向发散**，把锚点周边"该看的背景"和"能做的动作"也带进
聚焦结果——但两条去向必须分开：

| 通道 | 内容 | 给模型的作用 |
|---|---|---|
| **聚焦提示**（追加本轮 `systemExtra`） | direct + **上游** N 阶（概念 + 行为） | 该参考什么 |
| **下一步动作提示**（`focusToolTips`） | direct + **下游** N 阶（仅行为） | 能建议用户做什么 |

发散**不判分**（纯内存图遍历，零额外 Laya 调用），因此不改变首字节时间。

---

## 2. 术语与方向口径

- **direct**：Laya 判分命中（分数严格大于阈值）的行为，及其所属概念。
- **上游**：主数据 / 父项 / 被引用方 —— 回答问题时需要读取的背景。
- **下游**：明细 / 业务事实 / 引用方 —— 用户接下来可以操作的实体。
- **聚焦阶数（`intent_focus_depth`）**：`0~2` 的整数，同一数值同时约束两个方向（各自独立计算）。

### 2.1 方向判定（唯一实现：`expansion.ts#relationEnds`）

`ontology.yaml` **不声明**上下游，只能从基数推导。口径（2026-11-08 用户拍板）：

| `relation_type` | 基数 | 上游端 | 下游端 |
|---|---|---|---|
| 仅 `Functional` | N:1 | **`target`** | `source` |
| 仅 `InverseFunctional` | 1:N | `source` | `target` |
| 两者都有 | 1:1 | `source` | `target` |
| 都没有 | M:N | `source` | `target` |

> 记忆法：**箭头即方向**（`source → target` 读作「上游 → 下游」），唯一例外是多对一（`Functional`
> 单独出现）需要反向。`relation_type` 缺失时退回 `cardinality` 解析（`N:1` 反向、其余按箭头），
> 两者都缺则按箭头并标记 `via = arrow`。加载层只保留原始信号，不在解析期判定方向（TR-04）。

### 2.2 邻接定义

```
X 的上游邻居 = { Y | 存在关系 e：e 的下游端 = X，Y = e 的上游端 }
X 的下游邻居 = { Y | 存在关系 e：e 的上游端 = X，Y = e 的下游端 }
```

同向 BFS，`hop ≤ 阶数`，`visited` 去环；同跳按 `concepts[]` 原序输出。

---

## 3. 需求

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-001** | 发散起点 MUST 为**入选行为所属概念**（`behaviors[].concept`）；无概念的行为不参与发散 | 概念缺失时零发散，且记 warning |
| **FR-002** | 阶数 MUST 取数字人设计态参数 `intent_focus_depth`（0~2，缺省 0）；阶数 0 MUST NOT 遍历 `concepts` / `relations` | 阶数 0 的产物与 `016` 语义一致；0 阶不解析关系 |
| **FR-003** | 上游发散 MUST 只进聚焦提示（概念 + 行为）；下游发散 MUST 只进 `focusToolTips` | 两通道互不串台（提示无下游、卡片无上游） |
| **FR-004** | 发散行为 MUST NOT 再判分（`score = null`）；被判分否决过的行为可以经发散复活 | 记录中发散项 `score` 为 `null`，`source` 标 `upstream` / `downstream` |
| **FR-005** | 概念 MUST 全量进入**留档**，不设上限、不截断；提示中概念 MUST 随**五元组**出现（2026-11-13 起不再单独成段：概念单独成段会在五元组里重复一遍，白占预算） | 200 个概念仍全部落留档，且不触发 `truncated`；提示 MUST NOT 出现 `关联概念：` / `上游概念：` 段 |
| **FR-006** | 提示长度上限 MUST 按阶数分档（0→2000 / 1→3000 / 2→4000，2026-11-20 上调）；超限 MUST **按整行丢五元组**（顺序：链尾无行为 → 跳数大 → 起点得分低），且每个入选行为的**第 1 跳行至少保留一条**；路径行丢完后才丢 `直接命中` 行为 | 三档超限用例：整行丢弃、无半截五元组、每起点行为至少一行 |
| **FR-007** | 发散行为单通道 MUST 有上限（`MAX_EXPANDED_BEHAVIORS = 32`），超限按「概念序 → 行为原序」截断并记 `truncated` | 超限用例：条数等于上限、记录标注 |
| **FR-008** | 同一 `ontology_id + name` MUST 去重；direct 行为 MUST 优先（不重复以发散身份出现）；direct 概念 MUST NOT 再作为发散概念 | 去重断言 |
| **FR-009** | 断链 MUST 只告警不猜测：概念未在 `concepts[]` 定义、行为缺 `concept`、关系缺端点 | warning 断言 |
| **FR-010** | `focusToolTips` 的 wire 结构 MUST 不变（`name` / `title` / `ontology_id` / `ontology_name` 四字段，MUST NOT 附加 `source` 等内部字段）；发散溯源只落留档 | 前端聊天侧零改动；wire 结构断言 |

---

## 4. 设计态参数

| 项 | 值 |
|---|---|
| 键名 | `intent_focus_depth`（设计态 JSON 与 `SOUL.md` frontmatter 同名） |
| 范围 | 整数 `0` / `1` / `2` |
| 缺省 | `0`（新建数字人与存量补齐同值，等价于 `016` 行为） |
| 校验（平台） | 拒绝式：`null` / 小数 / 越界 / 非数字 → `VALIDATION_FAILED`，不 clamp |
| 读取（运行） | 缺失 / 坏值 → `0` + 告警（fail-safe 到不扩展） |
| 物化 | 仅当 `intent_focus === true && depth > 0` 写 frontmatter，关闭或 0 阶零残留 |
| 依赖 | 仅在「意图聚焦」开启时有意义；关闭时数值保留（管理台置灰），再次开启即恢复 |

---

## 5. 数据结构

- `OntologyBehavior.concept: string | null`
- `OntologyConcept { name, title }`、`OntologyRelation { name, title, source, target, relationType[], cardinality }`
  （`title` 缺失回退 `name`；2026-11-13 新增，五元组要展示关系语义）
- `ExpandedConcept { ontologyId, ontologyName, name, title, hop, viaConcept, viaRelation }`
- `ExpandedBehavior { ontologyId, ontologyName, name, title, concept, hop, viaConcept, fromConcept }`
  （`concept` = `viaConcept` = 这一跳的**终点**概念；`fromConcept` = 这一跳的**起点**概念，2026-11-13 新增）
- 记录：`behaviors[]` / `tool_tip_behaviors[]` 各项新增 `from_concept`（`direct` 为 `null`）。
  **关系名不落档**：以「同一对概念之间恒有一条关系」为前提，`(from_concept, via_concept)`
  唯一确定关系与方向；该前提被打破（同一对概念出现平行关系）时必须补 `via_relation`。
- `FocusPath { ontologyId, behavior, fromConcept, relation, direction, readability, toConcept, toBehavior|null, hop, score|null }`
  （2026-11-13 新增：一条五元组；`direction` = `upstream` / `downstream`，`readability` = `forward`（顺
  `source→target` 读）/ `reverse`（反读），两者分开表达方向与关系名读向）
- 记录新增 `depth`、`concepts[]`、`tool_tip_behaviors[]`；行为记录新增 `source` / `hop` / `via_concept`，
  `score` 变为 `number | null`

---

## 6. 边界与降级

| 场景 | 处理 |
|---|---|
| 阶数 0 / 意图聚焦关闭 / 卡片入口 / `/技能名` | 完全不发散，产物与 `016` 一致 |
| 本体无 `relations` / 起点概念零邻居 | 零发散，正常 |
| 一阶概念零行为（如客户订单） | 正常，不视为失败 |
| 自环 / 双向成环 | `visited` 去重去环 |
| 同 `ontology_id` 多份物化文件 | 只用提示引用的首份（与 `pickOntology` 一致） |
| 2 阶在稠密本体上接近全量 | 允许；靠行为上限（32）与提示分档上限收敛 |

---

## 7. 验收标准

1. 阶数 0 → 提示只有「直接命中」，卡片只有 direct；
2. 阶数 1 上游（库存 → 原材料）→ 提示多出「上游路径：」段，且只有一行五元组
   `查询原材料库存信息（QueryInventory）—〔原材料库存(RawMaterialInventory)〕—[上游]…←〔原材料(RawMaterial)〕—→查询原材料基本信息（QueryRawMaterials）`，卡片不变；
3. 阶数 1 下游（原材料 → 采购记录）→ 卡片多出下游行为（含 command），提示不变；
4. 二跳同向链（采购记录 → 入库单 → 结算单）在阶数 2 才出现结算单，且**每跳各一行五元组**（不是一行七元组），
   第 2 跳的起点行为 = 第 1 跳的终点行为；
5. 概念 200 个仍全量落留档，且 `truncated = false`；提示里无独立概念段；
6. 三档提示长度上限生效，截断只发生在**整行五元组**（先链尾无行为、再跳数大），`直接命中` 最后才丢；
7. 平台侧：阶数越界保存被拒；关闭或 0 阶时产物无 `intent_focus_depth` 键；
8. 三侧 lint / typecheck / 测试门禁全绿。

---

## 8. 决策

| # | 决策（2026-11-08 用户拍板） |
|---|---|
| 1 | 一阶按**无向邻居**取节点（后由第 2 条细化为"上游/下游分通道"） |
| 2 | 聚焦提示 = 本身 + 上游；下一步动作提示 = 本身 + 下游 |
| 3 | 发散不再判分，直接使用；query 与 command 一视同仁 |
| 4 | 发散中提取的概念同样进入聚焦提示 |
| 5 | 概念不设上限、不截断；提示总上限按阶数分档 **2000 / 3000 / 4000**（2026-11-20 由 1200 / 1600 / 2000 上调） |
| 6 | 新增数字人设计态参数「聚焦阶数」（0~2），新建取 0 |
| 7 | 方向口径：箭头即上下游，`Functional` 单独反向，`1:1` / `M:N` 按箭头 |

### 8.1 2026-11-13 补充决策（聚焦提示形态）

| # | 决策（用户拍板） |
|---|---|
| 8 | 提示改为**一行一条五元组**：`行为—概念—关系—概念—行为`；排版取紧凑元组（每条链一行），不取缩进树 |
| 9 | 起点行为**每行重复**（严格五元组，读者不必跨行拼）；链尾无行为写 `—→（无可用行为）`，**保留整行** |
| 10 | 多跳**逐跳提取**：第 N 跳的起点行为 = 第 N-1 跳的终点行为（行为接续）；中间概念无行为即断链，不向下展开 |
| 11 | 方向与读向分开：`[上游]` / `[下游]` 表方向，关系名后的 `→` / `←` 只表"关系名要不要反读"（N:1 反向时正读） |
| 12 | 概念不再单独成段；只保留 `直接命中` + `上游路径` 两段 |

---

## 9. 修订记录

- 2026-11-20（**本体函数聚焦恢复后，本特性的作用域收窄一句**）：发散起点仍**只有**「Laya 判分命中的
  本体行为」（`capabilitySelection.behaviors`）的 `concept`。`016` 于同日恢复的**本体函数**与
  其「关联概念的 query 行为」**不参与**本特性的发散：函数不成为起点、取数行为不成为起点、
  取数行为自身不再级联；`intent_focus_depth` 对函数链路零影响。提示中函数与取数条目并入
  `直接命中` 段（`016` FR-068），不影响本特性的五元组段与截断顺序。
  - 改动面：无代码改动（`expandNeighborhood` 入参本就不含函数集）；仅澄清口径。
  - 回归红线：加函数前后同一输入的路径行、`paths` 留档与 `tool_tips` 必须逐项一致。

- 2026-11-20（**提示长度上限上调**，用户口径）：提示总上限由 1200 / 1600 / 2000 调整为 **2000 / 3000 / 4000**（阶数 0 / 1 / 2）。
  - **动机**：原值按"每个入选行为一行、最多 32 个技能"估算；实测二阶发散时常在 `直接命中` 段就吃满预算，路径行成批被丢。截断是**整行丢弃**，一次截断即损失一整条五元组，信息损失比多花 token 更严重。
  - **改动面**：`agent-backend/src/domain/intent-focus/prompt.ts` 的 `MAX_PROMPT_CHARS`（1200 → 2000）与 `maxPromptChars` 分档（1600 / 2000 → 3000 / 4000）；`tests/unit/intent-focus-prompt.spec.ts` 断言同步；同步修订 `016` 的 FR-045 与 `001` 契约 `runtime-api-delta.md` R26 的数值登记。
  - **不变项**：截断顺序（链尾无行为 → 跳数大 → 起点得分低）、"每个入选行为的第 1 跳行至少保留一条"、`prompt_truncated` 留档口径、五元组渲染格式与前端零变更。

- 2026-11-13：**聚焦提示改为五元组路径**（`行为—概念—关系—概念—行为`，一行一条，逐跳提取）。
  改动面：新增 `paths.ts`（`buildFocusPaths` + `FocusPath`）与同名单测；`prompt.ts` 去掉
  `关联概念` / `上游概念` / `上游参考` 三段、改行级截断；`OntologyRelation` 补 `title`（缺失回退 `name`）；
  `runner` 日志新增 `focus_paths`。**同轮补 `from_concept`**：发散行为记录带上这一跳的起点概念
  （下游概念不落概念表且下游多源汇聚，缺它无法回答"这条卡片项从哪发散来"）；关系名不落档，
  以"同一对概念之间恒有一条关系"为前提。同步改写 `016` 的 FR-041 / FR-045 / FR-051 与 `001` 契约
  `runtime-api-delta.md` R29。判定逻辑（`expansion.ts#relationEnds`）、留档字段、卡片与前端零变更。
- 2026-11-08：初稿并实现。定位：`016` 的能力聚焦之后追加一次**同向发散**，两通道分开；
  同步改写 `016` 的 FR-020 / FR-041 / FR-045 / FR-051 / FR-060、TR-04、I-5、非目标、关键实体、
  影响面，新增 `016` D9；同步 `001` 契约（`admin-api.md` §5.3 的 `soul` 字段表与校验口径、
  `runtime-api-delta.md` §21.1 与变更登记 R26）。
