# 运行期契约：意图聚焦（技能与本体能力聚焦）

- **特性**：`016-ontology-skill-focus`
- **版本**：2026-11-04 / v1
- **替代关系**：本契约**整体替换** `specs/013-intent-focus/contracts/intent-focus-api.md` 的工具候选口径；013 的工具候选字段与配置自本特性起废弃。
- **读者**：`agent-backend` 实现与测试、运维配置、后续排障。

## 1. 范围与不变项

### 1.1 本契约覆盖

1. 当前数字人 `SKILL.md` 头部字段（只读）；
2. 当前数字人 `ontology.yaml` 的所需子集（只读）；
3. `intent_focus` 配置块与环境变量；
4. 内部 Laya `/v1/systemone` 的 `noul` 请求 / 响应；
5. 聚焦提示格式；
6. 线程侧车 `intent-focus.jsonl` 记录；
7. 降级与处置结论。

### 1.2 不变项

- 公开 HTTP：`POST /api/threads/{threadId}/messages` 等请求 / 响应字段不变；`skip_intent_focus` 语义不变。
- 历史 / 摘要 / 记忆 schema 不变；聚焦提示不进入这些文件。
- 工具权限、工具清单、Function Calling 语义不变。
- 管理端 / 前端无新增字段、无新增页面。
- 平台仍是技能 / 本体内容的唯一权威源；运行环境只读部署物。

## 2. 配置契约

### 2.1 YAML

```yaml
intent_focus:
  base_url: http://laya:8000
  model: laya-multilingual
  api_key: $DECIS_API_KEY
  timeout_ms: 10000
  threshold: 0.6
  ontology_threshold: 0.6
  max_skills: 32
  max_capabilities: 96
```

| 键 | 必填 | 类型 / 范围 | 缺省 | 说明 |
|---|---|---|---|---|
| `base_url` | 是 | `http(s)://host[:port]` | — | 只到主机端口，不带 `/v1` |
| `model` | 否 | string | `laya-multilingual` | 与 `GET /v1/models` 一致 |
| `api_key` | 是 | string / `$ENV` | — | 不回落 `DEEPSEEK_API_KEY` |
| `timeout_ms` | 否 | 整数 300~10000 | 10000 | 单轮总预算 |
| `threshold` | 否 | 0~1 | 0.6 | **技能**阈值 |
| `ontology_threshold` | 否 | 0~1 | 0.6 | **本体能力**阈值 |
| `max_skills` | 否 | 整数 1~256 | 32 | 技能候选上限 |
| `max_capabilities` | 否 | 整数 1~256 | 96 | 行为 + 函数候选上限 |

**规则**：
- 整块缺失 → 功能不可用；开关开启时记录 `unconfigured`，启动不失败。
- 块存在但必填缺失 / 越界 / 未知键 → 启动失败。
- `threshold` / `ontology_threshold` 可由环境变量覆盖；YAML 值仍校验。
- 环境变量留空视为未设置，不变成 0。

### 2.2 环境变量

| 变量 | 作用 | 优先级 |
|---|---|---|
| `INTENT_FOCUS_THRESHOLD` | 技能阈值 | 高于 YAML `threshold` |
| `INTENT_FOCUS_ONTOLOGY_THRESHOLD` | 本体能力阈值 | 高于 YAML `ontology_threshold` |
| `DECIS_API_KEY` | 由 `api_key: $DECIS_API_KEY` 引用 | — |

`max_skills` / `max_capabilities` 不提供环境变量，避免配置碎片化。

## 3. 输入契约

### 3.1 `SKILL.md` 头部

```markdown
---
name: raw-material-inventory-new
description: 原材料采购和库存本体技能
metadata:
  ontology_id: 1
  ontology_name: 原材料采购和库存
  scenario_id: 1
  scenario_name: 生产调度
---

# 正文……（不读取）
```

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | string | 非空 |
| `description` | 是 | string | 非空 |
| `metadata` | 否 | object | 缺失 → 非本体技能 |
| `metadata.ontology_id` | 否 | string / number | 归一化为 string；空白视为缺失 |
| `metadata.ontology_name` | 否 | string | 空白视为缺失 |
| `metadata.scenario_id` | 否 | string / number | 归一化；仅展示 / 记录 |
| `metadata.scenario_name` | 否 | string | 仅展示 / 记录 |

**判定**：
- `isOntologySkill = ontology_id != null && ontology_name != null`；
- 本体技能必须在当前数字人 `ontology/*/*/ontology.yaml` 中找到 `metadata.ontology_id` 相同的文件，才进入技能聚焦；
- 未匹配 → 不评分、不产生能力，记录 `no_matching_ontology`。

**读取边界**：只读 frontmatter（最多前 64KB）；不读正文；frontmatter 未闭合 / 非法 YAML / 缺 name/description → 跳过该技能并记录。

### 3.2 `ontology.yaml` 所需子集

```yaml
metadata:
  ontology_id: '1'
  ontology_name: 原材料采购和库存
  scenario_id: '1'
  scenario_name: 生产调度
functions:
  - name: checkRawMaterialUnit
    title: 校验采购原材料单位一致性
behaviors:
  - name: CreatePurchaseRecord
    title: 创建原材料采购单
    description: 创建一笔新的原材料采购记录。
    op_type: command
  - name: QueryPurchaseRecords
    title: 查询原材料采购单信息
    description: 根据采购单/原材料/关联客单来查询采购记录列表。
    op_type: query
rules:
  - name: V01_UnitConsistency_Purchase
    behavior: CreatePurchaseRecord
    data_supplements:
      - QueryPurchaseRecords
      - QueryRawMaterials
```

**只读字段**：`metadata.ontology_id` / `ontology_name` / `scenario_id` / `scenario_name`；`functions[].name` / `title`；`behaviors[].name` / `title` / `description` / `op_type`；`rules[].behavior` / `data_supplements`。

**明确不读**：`concepts`、`relations`、`processes`、参数 `params`、`response`、`code_file`、`rule_design`、规则表达式。`related_functions` 不提取、不用于任何补全（仅 `data_supplements` 参与）。

**文件枚举**：`ontology/{scenario}/{ontology}/ontology.yaml`；只接受真实目录 / 真实文件；符号链接跳过；不接受来自 `SKILL.md` 的路径拼接。

## 4. Laya 内部协议契约

### 4.1 请求

沿用既有 `LayaClient.decide`：

```json
{
  "model": "laya-multilingual",
  "state": "帮我创建一笔原材料采购记录",
  "questions": {
    "s1": {
      "type": "noul",
      "instructions": "需要技能「原材料采购和库存本体技能」",
      "criteria": { "true": "需要", "false": "不需要" }
    },
    "c1": {
      "type": "noul",
      "instructions": "需要行为「创建原材料采购单」",
      "criteria": { "true": "需要", "false": "不需要" }
    }
  }
}
```

| 项 | 约定 |
|---|---|
| 路径 | `POST {base_url}/v1/systemone` |
| `state` | 当前用户输入，`prepareState` 后 ≤200 字符；取尾部、对齐句首 |
| `questions` | 每个候选一条；技能 `s1..sN`，能力 `c1..cN` |
| 题型 | **只允许 `noul`**；禁止 `choice` |
| `instructions` | 中文；技能含 name + description 摘要；行为 / 函数含 title（缺失回退 name）+ name；标签 ≤40 字 |
| `criteria` | 固定 `{ true: '需要', false: '不需要' }` |
| 批量 | ≤32 题 / 批；技能 1 批（≤32）；能力 ≤96（≤3 批） |
| 超时 | 总预算 10000ms；按批数均分；单批下限 300ms |
| 重试 | 不重试 |

### 4.2 响应

```json
{
  "model": "laya-multilingual",
  "answers": {
    "s1": { "noul": 0.91 },
    "c1": { "noul": 0.88 }
  },
  "unknown": []
}
```

**处理**：
- 只读取 `answers[qid].noul`；
- 缺失 / 非数字 / 越界 → 视为未评分（不入选）；
- 分数 clamp 到 `[0,1]`；
- `unknown` 中的 qid 不产生分数，不报错；
- 响应结构非法 → 该批失败，计入降级原因。

## 5. 提示契约

### 5.1 格式

```text
本轮可优先参考以下聚焦结果（仅供参考，不必局限）：技能：{name}（{description ≤80 字}）；本体能力：行为：{title}（{name}），函数：{title}（{name}）；技能：{name}
```

- 前缀逐字固定；
- 非本体技能只有 `技能：...`；
- 本体技能先技能说明、后 `本体能力`；
- 空类别省略；无入选时返回空串，不追加；
- 单行；段间 `；`，条目 `，`；
- 总长 ≤1200 字符；
- 只追加一次，位置在本轮 `systemExtra` 末尾；不进入用户消息、历史、摘要、记忆、下一轮。

### 5.2 示例

**本体技能入选（含数据补充）** —— 行为段内直接入选在前、补充行为按本体原序紧随：

```text
本轮可优先参考以下聚焦结果（仅供参考，不必局限）：技能：raw-material-inventory-new（原材料采购和库存本体技能）；本体能力：行为：创建原材料采购单（CreatePurchaseRecord），查询原材料采购单信息（QueryPurchaseRecords），查询原材料基本信息（QueryRawMaterials），函数：校验采购原材料单位一致性（checkRawMaterialUnit），校验采购供应商存在性（checkSupplierExistence）
```

**非本体技能入选** —— 只有技能段，无 `本体能力：`：

```text
本轮可优先参考以下聚焦结果（仅供参考，不必局限）：技能：调度算法（提供调度算法选型与实现指引：覆盖先来先服务、优先级、最短作业优先、轮询、加权公平、贪心与启发式排程，含适用场景、复杂度与实现要点）
```

## 6. 记录契约

文件：`{threadDir}/intent-focus.jsonl`；一行一条；字段见 [data-model.md §5](../data-model.md#5-记录-schema-intent-focusjsonl)。

**硬约束**：
1. 与会话历史物理分离；不写 `history.jsonl`；
2. 运行期没有读取方；
3. 单文件 >256KB 或 >200 行 → 重写保留最近 100 行；
4. 写失败只告警，不影响对话；
5. 旧 013 行（`probabilities` / `actions` / `focus_prompt`）可读，不迁移；
6. 五态必留档（`focused` / `empty` / `skipped` / `degraded` / `unconfigured`），开关关闭不留档。

## 7. 处置与降级

| 场景 | disposition | reason | 用户可见 |
|---|---|---|---|
| 开关关闭 | 不记录 | — | 正常 |
| 卡片 / guidance 跳过 | `skipped` | `skip_flag` / `guidance` | 正常 |
| Laya 未配置 | `unconfigured` | `laya_not_configured` | 正常 |
| 无可聚焦技能 | `empty` | `no_skills` / `no_focusable_skills` | 正常 |
| 技能全部低于阈值 | `empty` | `below_threshold` | 正常 |
| 技能入选、能力为空 | `focused` | null | 正常（只有技能段） |
| 技能 / 能力入选 | `focused` | null | 正常（有提示） |
| Laya 超时 / 全部批次失败 | `degraded` | `timeout` / `laya_unreachable` / `invalid_response` / `all_batches_failed` | 正常 |
| 部分批次失败但有结果 | `focused` / `degraded` | 见 data-model §4 | 正常 |
| 记录写失败 | 记录缺失 | `record_write_failed`（日志） | 正常 |

**失败原则**：不回退主对话模型做聚焦判定；不向用户暴露聚焦错误；不重试。

## 8. 兼容与版本

- 本契约 v1 起生效；013 契约中的 `ToolCandidate` / `probabilities` / `actions` / 工具提示前缀不再适用。
- 新增配置键全部可选；旧 `intent_focus` 块可直接启动（`threshold` 语义变为技能阈值）。
- 公开 HTTP 无版本变更；前端 / 管理端无需发版。
- 后续若调整提示格式或记录字段，必须同时更新本契约与 `data-model.md`，并保留旧记录可读。

## 9. 验收断言（契约级）

1. 技能题、能力题均为 `type: 'noul'`，请求中不存在 `choice`。
2. 技能题 qid 为 `s1..sN`，能力题 qid 为 `c1..cN`，与候选一一对应。
3. 阈值边界：0.60 / 0.61 / 0.82（阈值 0.6）只保留后两个。
4. 非本体技能入选时，提示无 `本体能力`，本体读取 / 能力评分 / 工具评分均为 0。
5. 本体技能入选时，提示中技能说明在能力之前；`data_supplements` 声明的查询行为出现在 `behaviors` 且 `source='supplement'`，函数类不因补充增加。
6. 去重后行为 / 函数同名项各 ≤1。
7. 提示只出现一次，长度 ≤1200，位置在 `systemExtra` 末尾。
8. 记录含 `skills` / `behaviors` / `functions` / `data_supplements` / `prompt`；不含 `probabilities` / `actions`。
9. 开关关闭 / 跳过 / 未配置 / 空结果 / 降级五态可区分。
10. 旧工具聚焦的工具候选构造与评分调用次数为 0。
