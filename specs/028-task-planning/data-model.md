# 数据模型：多步任务规划与滚动执行（028）

- **规格**：[spec.md](./spec.md)
- **计划**：[plan.md](./plan.md)
- **日期**：2026-11-25
- **说明**：本特性**不新增持久化产物**。以下结构全部为 run 级内存对象；落盘仅 SOUL 的一个布尔键。

---

## 1. 规划输入素材（FR-003 的精确展开）

规划调用 = **1 个 system prompt + N 条 messages**，`tools: []`，`thinking: false`，非流式聚合。

### 1.1 system prompt 的六段

| # | 段落 | 内容要点 | 长度约束 |
|---|---|---|---|
| 1 | 角色与目标 | 「你是任务分解器。只输出计划，不执行任何工具」+ **「必须从意图聚焦结果出发」+「coreAction 必须从第 3、4 段中提取」** | 固定，≤400 字 |
| 2 | 起点上下文 | 意图聚焦结果（`focus.prompt` 原文），**段首用显式标题声明为「本轮规划起点」**；该段已含选中技能名、本体名与 `ontology_id`，**MUST NOT 再单独下发技能文件内容** | **直通**（聚焦侧已按阶数剪到 4000 / 5000 / 6000），不做业务截断；仅 8000 字防御性硬顶，超硬顶按行截断（2026-11-26 由「≤2000 字按行截断」修订，旧口径会从末尾切掉「图路径」） |
| 3 | 本体关系 | 按本体分段的「关系三元组 + 概念关联行为（command/query 分列）」 | 不设上限；见下方形态 |
| 4 | 可用函数 | 本体函数（含关联概念）+ 非本体函数（内置/外部）；**不列本体行为** | 不设上限 |
| 5 | 命令前置约束 | **本轮可用的全部 command** → 其前置函数裸名；无前置者标「（无）」 | **不设上限、不截断** |
| 6 | 输出格式与禁用项 | 严格 JSON 数组（**空数组 `[]` = 无需工具 / 已完成**）、字段定义、1~3 步、**一步一个 command**（多个 command 各占一步，同一 command 不占两步）、不得输出解释 | 固定，≤400 字 |

**第 3 段：本体关系的实际形态**

```
［本体关系｜按本体分段］

■ 原材料采购和库存（ontology_id=1）

关系：
- RawMaterial —HasRawInventory→ RawMaterialInventory
- PurchaseRecord —RecordsRawMaterial→ RawMaterial
- PurchaseRecord —OrderedFromSupplier→ Supplier
- CustomerOrder —ContainsPurchaseRecord→ PurchaseRecord
- Supplier —HasCapability→ DeliveryCapability

概念与可执行行为：
- RawMaterial（原材料）
    query：QueryRawMaterials、QueryRawMaterialDetail
    command：CreateRawMaterial、UpdateRawMaterial
- RawMaterialInventory（原材料库存）
    query：QueryInventory、QueryInventoryWarning
    command：UpdateInventorySafetyStock
- PurchaseRecord（原材料采购记录）
    query：QueryPurchaseRecords
    command：CreatePurchaseRecord、DeletePurchaseRecord
- Supplier（供应商）
    query：QuerySuppliers
    command：CreateSupplier
- CustomerOrder（客户订单）
    （无可用行为）
- DeliveryCapability（交货能力）
    query：QueryDeliveryCapability
    command：UpdateDeliveryCapability（未挂载）

■ 另一个本体（ontology_id=2）
（同结构）
```

三条渲染规则：

1. 关系**只取 `source —关系名→ target`**，不带 cardinality、关联字段、关系说明
2. 概念按 `concepts[]` 原序、行为按 `behaviors[]` 原序（保证同输入同输出）
3. 行为在 `ontology.yaml` 存在但不在 `availableNames` → 标「（未挂载）」但**保留**；概念无任何行为 → 显式标「（无可用行为）」

**为什么保留未挂载行为**：本体视图的价值是让模型理解业务对象的完整结构。删掉它们会让「这个概念本来有写能力、只是当前不可用」这条信息消失，模型反而可能编造一个不存在的 action。标注 + 校验兜底（C0）比隐藏更安全。

**第 4 段：可用函数的实际形态**

```
［可用函数］

本体函数：
- sumRawNotArrivalQty｜原材料未到位数量｜关联概念 PurchaseRecord
- checkSafetyStock｜安全库存校验｜关联概念 RawMaterialInventory
- calcLeadTime｜计算交货周期｜关联概念 DeliveryCapability

非本体函数：
- read_file｜读取文件｜内置
- write_file｜写入临时文件｜内置
- list_dir｜列目录｜内置
- grep_files｜检索文件内容｜内置
- calculator｜计算器｜内置
- read_skill｜读取技能文件｜内置
- grep_skill｜检索技能内容｜内置
- purchase_order_export｜导出采购单｜外部
```

两条规则：

1. 本体函数只标 `related_concepts`，**不展开这些概念的 query 行为**（第 3 段已有，重复会翻倍）
2. 不可达（不在 `availableNames`）的函数**不列**——列了只会诱导模型调用不存在的工具

**为什么第 3、4 段分开**：第 3 段回答「业务上有什么、彼此怎么连」，是模型推理的骨架；第 4 段回答「凭哪些函数能算出来」，是取数工具。混在一起会让模型把「函数」误当「业务对象」，写出 `coreAction` 指向函数却当成 command 的计划。

**「以意图聚焦为起点」的实际文案**（第 1 段与第 2 段各强调一次，防漂移）：

```
[第 1 段]
你是任务分解器。根据给定上下文把用户的请求拆成 1~3 个可执行步骤，只输出计划。

【必须遵守】
1. 优先从下方「意图聚焦结果」给出的技能、关键行为、本体函数与图路径出发；聚焦结果已覆盖的能力不得另辟路径。
2. 每一步的 coreAction 都必须在下方可用工具清单（本体行为、本体函数、非本体函数）中有唯一对应，且必须使用清单里的裸名。
3. 不得绕开可用工具清单自行规划行为：清单里没有的能力、服务或接口，一律不得出现在计划里。

[第 2 段]
［意图聚焦结果｜本轮规划的首选起点］
以下内容是本轮已经过聚焦判定的能力与路径，请优先以此为起点设计计划：
<focus.prompt 原文>

聚焦结果之外的必要能力，只能从下方可用工具清单中选择（coreAction 不得超出清单）；清单里也没有时，省略该步并在 content 中说明缺口，不得虚构工具或接口。
```

**为什么两处都写**：第 1 段是规则声明，第 2 段紧跟素材——模型对新前置指令的遵循度明显高于远距离指令。只写在第 1 段时，长清单（工具列表、前置约束）会把这条约束稀释掉。

**为什么不下发技能文件**：意图聚焦的产物本身已经包含技能信息，样例（`intent-focus/prompt.ts` 头部注释即真实形态）：

```
［聚焦参考］以下为背景知识，不是工具清单；工具调用仍以工具清单为准。
技能 raw-material-inventory → 本体 原材料采购和库存（ontology_id=1）

关键行为
· 查询原材料库存信息 QueryInventory @RawMaterialInventory
```

技能名、本体名、`ontology_id` 三样都在里面。而技能全文（真实样例 `raw-material-inventory/SKILL.md` 为 **18.78 KB**）是概念属性表与规则细则，对"拆成几步"没有帮助；执行阶段模型可用 `read_skill` 按需读取。**再下发一遍技能内容属于纯重复。**

**第 5 段为什么只给 command → 前置函数**：这是规划器做"是否值得把某个函数单独成步"的唯一依据。以下两类信息**本段刻意不重复下发**：

| 不重复下发 | 理由 |
|---|---|
| 本体函数的 `related_concepts` | 第 4 段列函数时已逐条标注，本段再写一遍等于把函数清单抄第二次 |
| 概念 → query 行为的映射 | 后端会在 `dependTools` 里自动补齐，不需要模型再算一遍 |

**第 5 段为什么不设字数上限**：前置约束属于「硬约束类信息」——规划器漏掉一个前置函数，产出的计划在运行时就会撞 `pause`，需要一次额外往返才能恢复。相比之下多花几百 token 的代价小得多。因此本段**覆盖全部可用 command、完整列出函数、不截断**。

**第 5 段的实际形态**（三种情况都要出现）：

```
命令前置约束（本轮可用 command 共 3 个）：
- CreatePurchaseRecord：前置函数 sumRawNotArrivalQty、checkSafetyStock
- UpdateInventorySafetyStock：前置函数 checkSafetyStock
- DeletePurchaseRecord：（无）
```

**唯一的边界不是字数，而是可用性**：不可用的 command（不在 `availableNames`）不列——因为计划里根本不会出现它，列了反而诱导规划器使用未挂载的工具。

**可观测代替截断**：`plan.requested` 事件记录 `system_chars`，本段异常膨胀时能在日志里看到，但**不截断**。

**第 6 段的实际形态**（固定文案，≤400 字；**这段是软约束**，只负责减少试错轮次，硬约束见下方「这一段是软约束，不是硬约束」）：

```
［输出格式］
只输出一个 JSON 数组。不要输出解释、标题、前后缀文字，不要包 Markdown 代码围栏。

每个元素的字段：
- seqId：整数，从 1 开始
- taskName：≤20 字，动宾短语
- content：≤300 字，写清这一步做什么、用哪个工具、产出什么
- coreAction：工具裸名（不带 MCP 服务前缀），必须来自上面的本体行为或可用函数
- type：command（写入）| query（查询）| function（函数处理）

若本次无需任何工具（或已无剩余步骤），输出空数组 []。

禁止：
- 一次给出多于 3 步
- 一个步骤里安排多个 command（一步只能有一个 coreAction；多个 command 请各占一步）
- 同一个 command 安排成两步（同一 command 只占一步）
- 使用上面未出现的 coreAction
- 输出 JSON 之外的任何文字

示例：
[{"seqId":1,"taskName":"查询原材料库存","content":"调用 QueryInventory 查询全部原材料库存，记录每个物料的在库数量","coreAction":"QueryInventory","type":"query"}]
```

三条规则：

1. 字段定义与 §2 的 `RawStep` **同源**——改一侧必须同改另一侧，否则提示词与解析器漂移
2. 超出 400 字时**只压缩示例，不删字段与禁止项**：示例缺了模型会自己编格式，禁止项缺了模型会输出解释文字
3. `type` 只作比对（权威判定在后端按 `availableNames` 反查），因此文案里**不解释**类型判定细节，避免占用字数

**这一段是软约束，不是硬约束**

第 6 段（连同第 1~5 段的全部措辞）只是**提示词里的软约束**——模型完全可能不照做。它的作用是**减少试错轮次**，不承担正确性。正确性由下面三处**硬约束**兜底：

| 硬约束 | 位置 | 模型违反时真实发生什么 |
|---|---|---|
| C4：批内同一 command 至多占一步 | `checkPlan` | 整批作废，携带失败项重规划（多一次 LLM 往返） |
| `coreAction` 单值 + FR-014 可见工具集 | 数据结构 / `prepareNextTurn` | 步内第二个 command 根本不可见，调用得 `Tool xxx not found`，不执行 |
| FR-009 `dependTools` 不含其它 command | `normalizePlan` | 同上，第二个 command 进不了工具集 |

所以「一步一个 command」写进提示词只是**提前告知**：模型照做则一次通过，不照做也调不动第二个 command，最坏是多花一轮重规划。**MUST NOT 把提示词当校验用**——校验只认 C4。

**「一个 command 独占一步」的确切范围**：

| 情形 | 是否允许 | 软/硬 | 依据 |
|---|---|---|---|
| 同一份计划里 Step1=`CreatePurchaseRecord`、Step2=`UpdateInventorySafetyStock`（**两个不同 command**） | **允许，且是正常形态** | 硬（允许） | 每步各有一个 `coreAction`，按步收窄工具集 |
| 同一步里安排**两个 command** | **禁止，且结构上不可能** | 硬（挡住） | `coreAction` 是单值；FR-014 可见工具集 = `{coreAction} ∪ dependTools ∪ 全部内置工具`，`dependTools` 只含前置函数与 query 行为，内置工具不含本体 command |
| 同一份计划两步都是 `CreatePurchaseRecord` | **禁止** | 硬（挡住） | C4 校验，重规划要求把重复的 command 推迟到下一批 |
| 同一步内多次调用**同一个** command（多笔写入） | **允许** | 硬（放行） | 条件 C（`lastCoreActionTurn < turnIndex`）就是为步内多次调用设的 |
| 上一批执行完，下一份计划里再出现 `CreatePurchaseRecord` | **允许** | 硬（放行） | C4 只作用于单次规划输出 |
| 失败步由重规划新建同 `coreAction` 的新步骤 | **允许** | 硬（放行） | 属新批次，新计划 |
| `query` / `function` 在同一份计划内重复 | **允许** | 硬（放行） | 幂等，重复无副作用 |

**为什么 command 必须一步一个**：一步就是一次「单工具作业」，可见工具集只放当前 `coreAction`（加前置函数与全部内置工具）。若把两个 command 塞进一步，第 2 个 command 会被 `Tool xxx not found` 拒掉，这一步要么白跑、要么靠模型自己发第二轮——把「分几步」的判断交给运行时，比交给规划器更不可控。反过来，两步同 command 也不行（C4）：那等于把同一件事拆成两半，中途失败后仅凭 `coreAction` 无法区分「第一笔写没写」，而 `done → pending` 被明确禁止，恢复语义就崩了。

原则：**后端知道的事实不等于该告诉 LLM 的事实；只下发"影响决策"的部分。**

### 1.2 messages 的组成

| 顺序 | 角色 | 内容 | 来源 | 约束 |
|---|---|---|---|---|
| 1 | `user` | 历史轮用户输入（最近 3 轮） | `buildPromptMessages` 的 messages 过滤 | **只取正文** |
| 2 | `assistant` | 历史轮助手回答（最近 3 轮） | 同上 | **只取正文** |
| 3 | `user` | 本轮用户输入（原话） | 同上 | 原话，非改写版 |
| 4 | `user` | 上一轮校验失败的结构化反馈（**仅重试时**） | `check` 产出 | 定位到「第 N 步 / 字段 / 实际值」 |

**MUST NOT 进入规划输入的素材**：

| 素材 | 原因 |
|---|---|
| **技能文件（`SKILL.md`）全文或章节列表** | 技能名 / 本体名 / `ontology_id` 已在第 2 段（`focus.prompt`）中；正文细节由执行阶段 `read_skill` 按需读取。再下发属纯重复 |
| `toolResult` 消息 | token 极高，且「规划下一步」需要的是意图与约束，不是原始数据 |
| 工具调用卡片（`toolTips`） | 属于执行期提示，规划阶段会误导成"必须调用" |
| 滚动摘要（`summary.json`） | 与 3 轮正文重复，且可能含已完成任务的旧结论 |
| 规则求值结果 | 规划只需知道"前置函数是哪些"，不需要是否通过 |
| 计划确认相关素材 | 本特性无确认环节 |

### 1.3 历史轮数的取法与边界

```
取 messages 中 role ∈ {user, assistant} 的最近 6 条（= 3 轮）
若不足 6 条：取全部可用条目，不补齐、不伪造
若单条超 1500 字：尾部截断并附「（已截断）」
```

## 2. 规划输出（LLM 原始）

```typescript
interface RawStep {
  seqId: number;        // LLM 填，后端会重排
  taskName: string;     // ≤20 字
  content: string;      // ≤300 字
  coreAction: string;   // 裸工具名（去 MCP 前缀）
  type: 'command' | 'query' | 'function';  // LLM 填，仅作比对
}
```

对应的 JSON 形态（写入提示词的示例）：

```json
[
  {
    "seqId": 1,
    "taskName": "查询原材料库存",
    "content": "调用 QueryInventory 查询全部原材料库存，记录每个物料的在库数量",
    "coreAction": "QueryInventory",
    "type": "query"
  },
  {
    "seqId": 2,
    "taskName": "创建采购记录",
    "content": "根据上一步得到的库存缺口，对缺口大于 0 的物料调用 CreatePurchaseRecord 补采购",
    "coreAction": "CreatePurchaseRecord",
    "type": "command"
  }
]
```

## 3. 归一化产物（内部权威）

```typescript
type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface PlanStep {
  seqId: number;              // run 级自增，跨批连续
  taskName: string;
  content: string;

  coreActionLabel: string;    // 对外：裸名（原样大小写，无服务前缀）
  coreAction: string;         // 对内：完整工具名（原样大小写，唯一键）；MUST NOT 存归一键
  type: 'command' | 'query' | 'function';   // 后端推导
  dependTools: string[];      // 后端推导，完整工具名

  status: StepStatus;
  coreActionOk: boolean;      // 该步 coreAction 是否成功过
  attempts: number;           // coreAction 调用次数（含重试）
  lastCoreActionTurn: number; // 最后一次 coreAction 所在 turn
}
```

### 3.1 字段来源对照

| 字段 | 来源 | 是否由 LLM 决定 |
|---|---|---|
| `taskName` / `content` | LLM | 是 |
| `coreActionLabel` | LLM 输出（原样） | 是 |
| `coreAction` | 后端解析（`matchKeys` + `availableNames`） | 否 |
| `type` | 后端推导（`behaviorIndex`） | 否 |
| `dependTools` | 后端推导（前置函数 + `related_concepts` → query 行为） | 否 |
| `seqId` | 后端分配 | 否 |
| `status` / `coreActionOk` / `attempts` / `lastCoreActionTurn` | 运行时写入 | 否 |

### 3.2 两种名字 + 一个派生键（混用会导致「工具全部不可见」的静默故障）

只有**两个实体名字**，第三个不是名字、是查找用的派生键：

| | 形态 | 谁产出 | 用途 | MUST NOT |
|---|---|---|---|---|
| **实体名 ①：裸名** | `QueryInventory`（原样大小写，无前缀） | LLM 输出 / 本体 yaml / `focus.prompt` | 展示（`coreActionLabel`）、第 3 段渲染 | MUST NOT 用于过滤 `tools` |
| **实体名 ②：完整工具名** | `svc__QueryInventory`（原样大小写） | `guarded` 数组的 `tool.name` | 存入 `coreAction`；过滤 `AgentContext.tools`；比对 `toolCall.name` | MUST NOT 归一后再存（小写后 SDK 精确匹配必失败） |
| **派生键（不是名字）** | `queryinventory` / `svcinventory`（trim + 小写，可再去前缀） | `normalizeName` / `matchKeys`，**运行时算，不落库** | 只用于查 `availableNames` 与 `behaviorIndex` | MUST NOT 写进 `coreAction`，MUST NOT 给模型看 |

派生键有两套构造，用途不同、MUST NOT 互换：`matchKeys(toolName)` 产出**两个**键（完整名 + 去前缀名，均小写）——`availableNames` 与 `behaviorIndex` 走这套；`normalizeName(stripServicePrefix(toolName))` 只产出**一个**去前缀小写键——`FunctionRecord` 走这套。

**为什么不统一成一种**（三个方案都试过，代价都更高）：

| 方案 | 后果 |
|---|---|
| 全用**完整名** | 本体 yaml 与 `focus.prompt` 必须写 `rawmcp__QueryInventory`——本体文件被钉死在某个 MCP 服务名上，换部署/换服务名即全废；且「未挂载」行为没有完整名，第 3 段无法渲染 |
| 全用**裸名** | 多服务同名工具无法区分（`matchKeys` 存在的前提就是"只试一种会漏拦"）；且 SDK 按 `t.name === toolCall.name` 精确匹配，必须有真实注册名 |
| 全用**归一键（小写）** | 要把所有工具 `name` 改成小写注册，连带改 HITL 卡片展示、权限白名单、既有 MCP 适配器——为省一层转换改半个装配层，不划算 |

所以：**规划阶段只认裸名（业务视角，不感知部署），执行阶段只认完整名（部署视角，SDK 精确匹配），翻译由 `normalizePlan` 一次性完成**。派生键只是翻译时用的比较形式，不构成第三套命名。

**关键事实**：`collectAvailableNames` 用 `matchKeys` 登记的是**归一键**，所以 `availableNames: ReadonlySet<string>` **不含原样名**。解析 `coreAction` 时必须自行维护「归一键 → 原样工具名[]」映射（由 `guarded` 数组现场构建），否则拿不回原样名；命中多个原样名时按 FR-007 判为歧义失败。

**执行期的两套口径并存**（不是同一套）：

| 环节 | 用哪套 | 代码证据 |
|---|---|---|
| 判「是否已注册」 | 归一键 | `availableNames`（`agent-factory.ts:497`）+ 规则闸门 `prepare` |
| SDK 真正查找工具 | **原样完整名，大小写敏感** | `currentContext.tools?.find((t) => t.name === toolCall.name)` |
| 过滤可见工具集 | 原样完整名 | `PlanStep.coreAction` 与 `tool.name` 直接比较 |

因此模型在执行阶段必须输出**原样完整名**；它看到的工具定义里就是原样名，所以正常路径自然成立。若规划阶段把归一键写进 `coreAction`，第 1 步就会 `Tool xxx not found`，且现象是「一个工具都调不到」。

## 4. 计划整体状态

```typescript
interface PlanState {
  goal: string;                 // 后端生成：本轮用户原话截断 ≤40 字（不从 LLM 取，见下）
  queue: PlanStep[];            // 待办，1~3
  current: PlanStep | null;

  doneSummary: string[];        // 已完成结论，≤5 条 × 80 字

  turnIndex: number;
  totalSteps: number;
  rollCount: number;            // 正常滚动次数（队列耗尽后再次规划），不设独立上限
  replanCount: number;          // 失败驱动重规划次数，上限 6
  planRetryCount: number;

  idleTurns: number;
  lastFingerprint: string;

  seenCallIds: Set<string>;     // 钩子幂等
  extraCalls: string[];         // 计划外调用（仅观测）
}
```

**`goal` 为什么不由 LLM 给**：`RawStep` 只有五个字段（§2），若让 LLM 再产出 `goal`，顶层就得从「严格 JSON 数组」改成 `{goal, steps}` 对象，连带改 FR-004 与解析器。按「后端可推导的不用 LLM」原则，`goal` 直接取**本轮用户原话截断 ≤40 字**——它天然就是用户视角的目标，不需要模型复述一遍。

**生命周期**：在 `agent-factory.runWith` 内创建，与 `createFunctionRecord` **同层级、同生命周期**（每轮新建、轮末丢弃），但**不复用其容器**——`FunctionRecord` 只暴露 `add/has/get/hasEver/invalidate/epoch/size/activeSize`，没有自由扩展位，`seenCallIds` / `extraCalls` / `idleTurns` 均为本特性新字段。

## 5. 配置常量

| 常量 | 值 | 依据 |
|---|---|---|
| `PLAN_MIN_STEPS` | 1 | spec FR-012 C5 |
| `PLAN_MAX_STEPS` | 3 | spec 钉死 |
| `PLAN_RETRY_MAX` | 2 | clarify 第 4 条 |
| `REPLAN_MAX_PER_RUN` | 6 | 同上（**仅计失败驱动**，不含正常滚动）；2026-11-26 起可由 `config.yaml` 的 `plan.replan_max_per_run` 覆盖 |
| `TOTAL_STEPS_MAX` | **20** | 同上（2026-11-25 由 10 调整，见 spec v0.7）；2026-11-26 起可由 `plan.total_steps_max` 覆盖 |
| `ROLL_MAX_PER_RUN` | 无（只受 `TOTAL_STEPS_MAX` 约束） | FR-024 |
| `IDLE_TURNS_MAX` | 2 | 同上 |
| `RETRYABLE_MAX_PER_STEP` | 3 | FR-022 |
| `TASK_NAME_MAX` | 20 | clarify |
| `CONTENT_MAX` | 300 | clarify |
| `SUMMARY_LINE_MAX` | 80 | FR-023 |
| `SUMMARY_KEEP` | 5 | FR-023 |
| `SNAPSHOT_MAX_CHARS` | 1200 | FR-016 |
| `PLAN_TIMEOUT_MS` | 20000 | NFR-001（2026-11-26 由 5000 提高；**超时不重试**，`callPlanWithTimeout` 以 `Promise.race` 硬超时兜底）；2026-11-26 起可由 `plan.timeout_ms` 覆盖 |
| `HISTORY_TURNS` | 3 | FR-003 |
| `BUILTIN_TOOL_NAMES` | **取自 `builtinToolNames()`**（不硬编码）；当前 = `read_file` / `write_file` / `list_dir` / `grep_files` / `calculator` / `read_skill` / `grep_skill` | FR-014 |

## 6. 状态机

### 6.1 状态转移

| from | 事件 | to | 附加动作 |
|---|---|---|---|
| `pending` | 成为 `current` | `running` | 切换工具集 + 注入快照 |
| `running` | 本批有 `success` 且 C 满足 | `done` | 追加 `doneSummary`；`totalSteps+=1`；出队 |
| `running` | 本批有 `success` 但 C 不满足 | `running` | 无（等待下一批） |
| `running` | 本批只有 `retryable` | `running` | `attempts+=1` |
| `running` | `retryable` 连续 3 次 | `failed` | 触发重规划 |
| `running` | 有 `failed` | `failed` | 触发重规划 |
| `running` | 本批无工具调用 | `running` | 由 `getFollowUpMessages` 续跑 |
| `done` | 队列**非空** | `pending` | `current = queue.shift()`；切换工具集 + 注入快照（**不重规划**） |
| `done` | 队列**耗尽** → 滚动规划 | 见下一行 | `rollCount += 1`；输入含 `doneSummary` + 工具清单 |
| （滚动返回 1~3 步） | — | `pending` | 新批替换 `queue`，`current = queue.shift()`，`seqId` 继续自增 |
| （滚动返回 `[]`） | — | 终止 | `plan.finished(reason=completed)`；这是**唯一**正常完成信号 |
| `done` | — | — | 计划全部完成后的终态，不可回退 |
| `failed` | 重规划成功 | — | 整批作废，新批替换 |
| `skipped` | — | — | 终态（当前实现下步骤不会被 skip，保留供扩展） |

### 6.2 禁止的转移

| 禁止 | 理由 |
|---|---|
| `done → running` | 已完成不可重做 |
| `done → pending` | 会让模型重复执行 `command`，副作用不可撤销 |
| `failed → running` | 失败步不再重试；需要重试时由重规划新建同 `coreAction` 的新步骤 |

## 7. 完成判定（FR-020 的三条件）

```typescript
const stepDone =
  current.coreActionOk === true &&                  // A
  current.lastCoreActionTurn < state.turnIndex;     // C
// B（整批闭合）由 shouldStopAfterTurn 的调用时机天然满足
```

**C 的必要性**：支持「一步内多次调用同一工具」。若去掉 C，首次成功后立即出队并替换工具集，同批后续的第二次调用会因工具不可见而报 `Tool xxx not found`。

## 8. 三态归类表

**三态是本特性新建的分类，现有代码里不存在**（全仓 `retryable` 零命中）。下表右列给出「从哪个既有实现映射过来」，实现时 MUST 从既有物派生，MUST NOT 假设已有三态枚举可直接复用。

| 错误码 / 情形 | 态 | 后续 | 既有实现的对应物 |
|---|---|---|---|
| （无错误） | `success` | 检查完成条件 | 工具结果无 `details.toolError` |
| `RULE_FUNCTIONS_MISSING_CODE` | `retryable` | 补调 `dependTools` 后重试 | 规则闸门 `PrepareResult.pause`（`tool-rule-gate.ts:109`，本轮可继续） |
| 参数校验失败（provider / 工具 schema） | `retryable` | 模型修正参数重试 | `details.toolError` 且 code 非 RULE 码 |
| 工具执行异常（业务错误） | `retryable` | 模型判断重试或换路径 | 同上 |
| `RULE_DENIED_CODE`（规则条件不满足 / 配置不可用 / 未注册） | `failed` | 触发重规划 | `PrepareResult.deny` / `fatal`（`tool-rule-gate.ts:89,114`） |
| `ABORTED` | `failed` | 终止 | `classifyLlmFailure` 的 `aborted` 分支（`llm-error.ts:113`） |
| `Tool xxx not found`（执行层查表失败） | 不计入三态 | 记 `extraCalls`，状态不推进 | **SDK 直接产出**（`pi-agent-core` 的 `agent-loop`），不在本仓 src |

**判定顺序 MUST 固定**：`isError` → `readToolError()` 的 code → message 兜底。原因是 **SDK 侧错误结果的 `details` 恒为 `{}`**（`createErrorToolResult` 只写 `content` + 空 `details`），所以「参数校验失败」「工具执行异常」「`Tool not found`」在 `afterToolCall` 里**都读不到 code**：

- 无 code 的 `isError === true` → **默认 `retryable`**（参数校验 / 执行异常）；
- 仅 message 字面匹配 `Tool <name> not found` → 不计入三态。该文案是 SDK 固定产出，MUST 精确匹配，MUST NOT 模糊猜测。

## 9. 计划快照格式

```
［执行进度］目标：<goal>

1. [done]    <taskName>   <coreActionLabel>
2. [doing]   <taskName>   <coreActionLabel>   ← 你现在在这一步
3. [pending] <taskName>   <coreActionLabel>

已完成结论：
· <doneSummary[0]>
· <doneSummary[1]>

约束：只执行当前这一步；完成后系统会推进到下一步。
```

**渲染规则**：

1. 状态标签在行首
2. `doneSummary` 最多 5 条
3. 总长 ≤ 1200 字符，超限**整行丢弃**（不留半截）
4. 每步注入时**替换**上一条带 `［执行进度］` 标记的消息

## 10. 观测事件

| 事件 | 字段 | 级别 |
|---|---|---|
| `plan.skipped` | `reason` ∈ {`switch_off`, `focus_disabled`, `empty_focus`, `no_tools`, `no_loop_provider`}（`no_loop_provider` = 非 Pi provider 无法跑工具循环，2026-11-26） | info |
| `plan.requested` | `retry`, `tool_count`, `history_turns`, `command_count`, `system_chars` | info |
| `plan.parsed` | `steps`, `raw_chars` | debug |
| `plan.rejected` | `failures[{code, seq_id, field, detail}]` | warn |
| `plan.abandoned` | `retry`, `reason` | warn |
| `plan.started` | `goal`, `steps[{seq_id, type, core_action}]` | info |
| `plan.step.out_of_focus` | `seq_id`, `core_action`（不在聚焦覆盖集合内时告警，不阻断） | warn |
| `plan.step.started` | `seq_id`, `core_action`, `type`, `visible_tool_count` | info。**每进入一步发一次**（2026-11-26）：批首步由装批发出，同批推进由推进点补发；与 `plan.step.done` 一一对应。需要重规划时被替换的那一步不发（等新批装批时再发） |
| `plan.step.done` | `seq_id`, `attempts`, `turns` | info |
| `plan.step.failed` | `seq_id`, `error_code`, `attempts` | warn |
| `plan.step.stalled` | `seq_id`, `idle_turns`, `fingerprint` | warn |
| `plan.replanned` | `kind`（`roll` / `failure`）, `count`, `reason`, `goal_changed` | info |
| `plan.finished` | `reason` ∈ {`completed`, `steps_exhausted`, `replan_exhausted`, `plan_exhausted`, `stalled`, `unavailable`, `aborted`}, `total_steps`, `rolls`, `replans`, `duration_ms` | info |
| `plan.record.failed` | `err`（回调自身抛错）| warn。留档失败不改本轮结果（FR-036）；文件侧失败由 `PlanStore` 的 logger 走同一事件名 |

**MUST NOT** 记录：工具结果正文、计划快照全文、用户原话（对齐 `021` 的 `FR-040`）。

### 10.1 计划留档 `plan.jsonl`（FR-036，2026-11-26）

落点：`user-data/{数字人}/threads/{thread_id}/plan.jsonl`（与 `intent-focus.jsonl` 同层），一行一条，JSONL。

| 字段 | 说明 |
|---|---|
| `at` | 写入时刻（ISO 8601） |
| `thread_id` / `agent_name` | 归属，便于跨线程分析时定位 |
| `goal` | 本轮目标（≤40 字，与 `PlanState.goal` 同源） |
| `reason` | 终止原因，取值同 `plan.finished.reason` |
| `total_steps` / `rolls` / `replans` | 与 `plan.finished` 同名同义 |
| `duration_ms` | 从编排器创建到 `terminate()` 的实际耗时 |
| `done_summary` | 已完成结论（≤5 × 80 字，与滚动规划输入同源） |
| `steps[]` | `{seq_id, task_name, type, core_action, status, attempts}`，**不含步骤正文与工具结果** |

约束：

1. **只写不读**：运行期无任何读取方，`readAll` 仅服务事后分析与测试；不写入 `history.jsonl`。
2. **发点唯一**：`terminate()` 内、`suspendTools` 之前；空轮（跳过 / 首轮 `[]` / 装配失败）不写。
3. **有界**：单线程保留最近 **100** 条，超限写 `plan.jsonl.tmp` 后原子改名覆盖。
4. **失败隔离**：同线程写入串行（per-thread Promise 链），任一条失败只记 `plan.record.failed`，不抛出。

## 11. 与既有结构的关系

| 既有结构 | 关系 |
|---|---|
| `GateSnapshot.behaviorIndex` | **只读**用于 `type` 推导与 `command` 前置函数；不修改。结构是 `Map<归一裸名, BehaviorRuleBucket>`，前置函数在 **`bucket.pre[].relatedFunctions`**（不是 `behaviorIndex.pre[...]`）；桶键**不含本体维度**——同名即同一工具（同一接口/同一功能），跨本体同名行为按名合并，**不需要** `ontologyKey` 消歧 |
| `GateSnapshot.validBehaviorNames` 等 | 不使用 |
| `OntologyIndex`（`intent-focus/ontology-loader`） | **只读**用于 `dependTools` 推导（`behaviors[].concept`、`functions[].relatedConcepts`（yaml 为 `related_concepts`）、`concepts`）。该加载器目前每轮全量读盘，mtime 缓存由本特性新增。**规则闸门侧的 `OntologyFunctionDoc` 只有 `name/response/type`，读不到 `related_concepts`，MUST NOT 用它推 `dependTools`** |
| `PrepareResult` 五态（`function` / `behavior` / `pause` / `deny` / `fatal`） | 归一到本特性的**结果三态**，见 §8；不修改五态本身 |
| `mcp-tool-adapter` 的工具命名 | 实际是 `{服务名}__{工具名}`，**没有 `mcp__` 三段式**；裸名靠 `matchKeys` 取第一个 `__` 之后部分 |
| `FunctionRecord` | 完全不读不写；由 `021` 独占 |
| `ToolSuspension` | 终止时调用 `suspendTools`（软收尾） |
| `AgentContext.tools` | SDK 字段，普通数组（非冻结）；每步在 `prepareNextTurn` 原地替换 |
| `tool-events.jsonl` | 不写入计划；工具结果照常落盘 |

**内聚边界**（三条不跨界的线）：

1. **两套本体读取器不得混用**：闸门侧 `ontology-doc.ts`（只有 `name` / `response` / `type`，服务注册校验与前置函数）与意图聚焦侧 `intent-focus/ontology-loader.ts`（有 `concept` / `relatedConcepts` / `relations`，服务 dependTools 与第 3 段渲染）。本特性只在 `src/domain/plan/ontology-facts.ts` 汇合两者，**其它 plan 模块 MUST NOT 直接 import 任一 loader**。
2. **状态只在一处改**：全部转移在 `shouldStopAfterTurn`；`afterToolCall` 只记录事实（`coreActionOk` / `attempts` / `lastCoreActionTurn`），不判完成、不出队——沿用 `021` 的分工。
3. **`availableNames` 与可见工具集语义相反**：前者是规则闸门判「是否注册」的**全量**集合（FR-015，MUST NOT 随步收窄），后者是 `AgentContext.tools` 的**逐步收窄**结果。代码里 MUST 用不同变量名（`availableNames` vs `visibleTools`），MUST NOT 混用。

**执行期安全不变量（不能被规划改动）**：`prepareNextTurn` 只替换 `AgentContext.tools` 的**成员**，不拆包装层——每次工具调用仍依次经过 `ruleGateTools`（规则闸门）与 `guardTools`（权限 scope），与规划关闭时完全一致。因此过滤对象 MUST 是 `guarded` 数组；若过滤裸 `tools` 数组，规则与权限**两层同时失效**。`availableNames` 保持全量（FR-015），规则闸门判「是否注册」不受收窄影响。
