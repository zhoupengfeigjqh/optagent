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
| **FR-005** | 概念 MUST 全量进入提示与留档，**不设上限、不截断** | 200 个概念仍全部出现，且不触发 `truncated` |
| **FR-006** | 提示长度上限 MUST 按阶数分档（0→1200 / 1→1600 / 2→2000）；超限 MUST 先丢上游行为、再丢直接命中行为，概念段永不丢 | 三档超限用例：概念全量保留、无半截条目 |
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
- `OntologyConcept { name, title }`、`OntologyRelation { name, source, target, relationType[], cardinality }`
- `ExpandedConcept { ontologyId, ontologyName, name, title, hop, viaConcept, viaRelation }`
- `ExpandedBehavior { ontologyId, ontologyName, name, title, concept, hop, viaConcept }`
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

1. 阶数 0 → 提示只有「关联概念 + 直接命中」，卡片只有 direct；
2. 阶数 1 上游（库存 → 原材料）→ 提示多出「上游概念 + 上游参考」，卡片不变；
3. 阶数 1 下游（原材料 → 采购记录）→ 卡片多出下游行为（含 command），提示不变；
4. 二跳同向链（采购记录 → 入库单 → 结算单）在阶数 2 才出现结算单；
5. 概念 200 个仍全量输出，且 `truncated = false`；
6. 三档提示长度上限生效，截断只发生在行为段；
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
| 5 | 概念不设上限、不截断；提示总上限按阶数分档 1200 / 1600 / 2000 |
| 6 | 新增数字人设计态参数「聚焦阶数」（0~2），新建取 0 |
| 7 | 方向口径：箭头即上下游，`Functional` 单独反向，`1:1` / `M:N` 按箭头 |

---

## 9. 修订记录

- 2026-11-08：初稿并实现。定位：`016` 的能力聚焦之后追加一次**同向发散**，两通道分开；
  同步改写 `016` 的 FR-020 / FR-041 / FR-045 / FR-051 / FR-060、TR-04、I-5、非目标、关键实体、
  影响面，新增 `016` D9；同步 `001` 契约（`admin-api.md` §5.3 的 `soul` 字段表与校验口径、
  `runtime-api-delta.md` §21.1 与变更登记 R26）。
