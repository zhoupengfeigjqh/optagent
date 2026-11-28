# 特性规格：多步任务规划与滚动执行（028）

- **特性标识**：`028-task-planning`
- **特性分支**：未自动创建（本仓库未注册 `before_specify` git 扩展钩子；规格目录为权威落点）
- **创建日期**：2026-11-25
- **状态**：设计定稿，plan / tasks 已产出，待实现
- **影响范围**：`agent-backend`（运行期链路）需改动；`frontend` **增量改动 1 处**（v0.12 起：单行计划进度条，只消费 `plan_progress`；不做计划确认弹窗、不渲染步骤列表）；`admin-backend` / `admin-frontend` 需新增一个数字人粒度开关「任务规划」
- **上游依据**：
  `specs/013-intent-focus/spec.md`（意图聚焦开关、判分与跳过判据）、
  `specs/016-ontology-skill-focus/spec.md`（技能与本体行为聚焦、阈值、提示铸造）、
  `specs/019-intent-focus-expansion/spec.md`（一阶发散、五元组与路径渲染）、
  `specs/021-ontology-rule-gate/spec.md`（本体规则闸门：`op_type` 三态、前置函数、暂停/拒绝、写后失效）、
  `specs/002-conversation-runtime/spec.md`（轮次语义、`tool-events.jsonl` 与工具结果回灌）

## 原始输入（用户需求，逐字保留）

> 我是这样想的，
> 1）有个规划开关，若未开启则跳过，每次规划1-3步：
> 若开启则进入规划，然后让LLM根据意图聚焦的内容为起点，进行规划：
> 读取聚焦的本体技能文件，结合意图聚焦结果，以及历史上下文，输出：一个任务序列LIST[JSON]（每一个json围绕一个query或command或function展开执行和审核，其中query可灵活绑定postFuntions进行计算）
> 一个json的demo以及要求如下，由LLM输出
> {
> seqId：任务顺序id，int
> taskName：任务名称，20字以内
> content：任务内容，关于如何做这个任务的引导提示，300字以内
> coreAction：本次任务的核心行为，涵盖当前所有已注册和可访问内外工具名（包括本体行为command和query，本体函数function以及本体以外的工具（也视为function））
> type：任务类型（根据coreAction类型判断，command：写入任务，query：查询任务，function：函数处理）
> }
>
> 2）输出后，有个规划检查器，checkPlan，包括以下硬编码检验环节：
> （1）type类型是否为command/query/function 3种类型之一，不允许为空和其他类型
> （2）type=command，action必须为本体command行为；type=query则action必须为本体query行为；type=function则action必须为非本体行为（command和query），只能是本体函数或其他函数
> 如果校验出错，则输出错误提示并重新规划
> 如果无问题：
>
> 在每个json中，增加一个字段dependTools：依赖的工具
> （1）如果type为command，根据前置规则，提取函数和关联概念，然后根据概念提取query行为
> （2）如果type为query，则为空
> （3）如果type为function，且是本体函数，则根据function关联的概念，找到对应的本体行为query
> （4）如果type为function，但不是本体函数，则为空
> ps：dependTools是一个LIST[STRING]格式
>
> 增加完后，则直接弹窗让用户确认整个规划内容，如果拒绝则本轮对话结束。（请评估是否可以利用当前聊天区的弹窗）
>
> 3）规划完成后，整份规划会临时保存（每一步任务有个主行为，有且只有一个）
> 4）每执行一步任务时，当前agent只能用当前计划内的工具（必须硬约束）
> 5）执行command行为时，审核行为是否合规（当前已有）
> 6）主行为coreAction执行成功，则标记当前这一步任务已完成
> 7）当前任务结束后，重新根据当前任务反馈，判断是否重新规划后续任务，或者是否提前结束整个任务（如任务不可执行了或完全无工具可调用了）。

## 补充输入（clarify 收敛，逐字保留）

> 1 规划在工具集注册装配完后，也就是要让LLM能够看到且能访问的工具集
> 2 工具名记录，必须剔除前缀
> 3 type让后端推导。原则上后端可推导计算的，都不要用LLM
> 4 规划重试次数为2，整个run为6，总步数上限为20，连续无进展2，单批规划1~3步
> （总步数初稿为 10，2026-11-25 经确认调整为 **20**，见修订记录 v0.7）
> 5 弹窗不用了
> 6 4.1 dependTools 必须进该步的可见工具集：按照你推荐来
> 7 4.2 第 6 条的执行时机：不能放在 afterToolCall：按照你推荐来
> 8 4.3 窗口内 command 去重 按照你推荐来
> 9 4.4 重规划的输入需要"已完成步骤结论摘要"：按照你推荐来

> 每次只规划2~3步骤，但是呢，假设第一步和第三步都是同一个行为？
>
> 如果是单Agent，有几个问题请教：
> 1 如何滚动计划和执行
> 2 如果command行为发现有缺失函数，这个是否会影响
> 3 某个行为、函数会多次执行（比如第一步和第七步都要执行A），如何判断第一步执行后，不会把第七步也标注为已执行？

---

## Clarifications

### Session 2026-11-25

- Q: 规划采用「一次性完整计划」还是「滚动规划」？ → A: **滚动规划**。每次只规划 **1~3 步**；待办队列耗尽后再规划下一批。理由：一次性长计划的单步错误会复利。
- Q: 每步是否交给子 agent 执行？ → A: **不交**。保持单 agent。理由是强依赖链场景下子 agent 会切断 `FunctionRecord`、叠加串行延迟。子 agent 的隔离收益改由「按步收窄工具集」获得。
- Q: 规划的输入素材包含什么？ → A: 见 **FR-003**。核心是「意图聚焦结果 + **只含正文的历史（不含工具结果）** + 本轮可访问工具清单 + 命令前置约束 + 上一轮错误反馈（重试时）」。历史固定取最近 **3 轮** user/assistant 正文。
- Q: 是否单独下发聚焦的技能文件（`SKILL.md`）？ → A: **不下发**。意图聚焦产物（`focus.prompt`）已含技能名、本体名与 `ontology_id`，再下发属纯重复；技能正文由执行阶段 `read_skill` 按需读取。原始输入中「读取聚焦的本体技能文件」一项**不采纳**。
- Q: `type` 由 LLM 填还是后端推导？ → A: **后端推导（唯一权威）**。LLM 输出的 `type` 仅用于比对，不一致记告警并以推导值为准。原则：「后端可推导的，不要用 LLM」。
- Q: `coreAction` 存裸名还是完整工具名？ → A: **对外存裸名（必须剔除 MCP 服务前缀），对内解析成完整工具名作为唯一键**。转换在 `normalizePlan` 一次完成；多服务同名导致歧义时报校验失败。
- Q: 计划确认弹窗是否保留？ → A: **不保留**。规划通过校验后直接执行，不打断用户。
- Q: 「这一步做完了」由谁判定？ → A: **系统客观判定**，不看模型自报。判据见 **FR-020** 三条件；判定点是 `shouldStopAfterTurn`（整批工具结果闭合后），**不是** `afterToolCall`。
- Q: `pause`（缺前置函数）算失败吗？ → A: **不算**。归为 `retryable`，模型补调 `dependTools` 后重试；只有 `deny` / 未注册 / 中止才归 `failed` 并触发重规划。
- Q: 同一 `coreAction` 在计划中出现多次会不会误标？ → A: **不会**。工具集按步收窄，同一时刻只有一个 `current`；匹配只针对 `current`，且「完成」是**出队**动作而非打标记。批内只禁止重复的 **command**（`query` / `function` 允许重复）。
- Q: 规划开关与意图聚焦开关的关系？ → A: **规划是聚焦的子开关**。聚焦关闭时规划必须跳过（无聚焦结果可作起点），配置层做硬约束。

---

## 术语与口径

| 术语 | 定义 |
|---|---|
| **任务规划开关** | 数字人设计态布尔开关（SOUL `task_planning`，缺省关闭）。与「意图聚焦」是**逻辑与**关系：两者皆为真才进入规划。 |
| **计划（Plan）** | 当前批次的任务序列，长度 1~3；一次 run 内可有多批。 |
| **步骤（Step）** | 计划中的一项，**有且只有一个**核心行为。 |
| **核心行为（coreAction）** | 该步骤的主工具。对外展示为裸名（去 MCP 前缀），对内解析为完整工具名作为唯一键。 |
| **依赖工具（dependTools）** | 该步执行前后可能需要调用的辅助工具，由后端推导，**必须进入该步可见工具集**。 |
| **当前步（current）** | 待办队列首位，正在执行的步骤。 |
| **待办队列（queue）** | 尚未执行的步骤，长度 1~3。 |
| **已完成摘要（doneSummary）** | 已完成步骤的一句话结论（≤80 字/条），只留结论不留过程，作为重规划输入。 |
| **可见工具集** | `current.coreAction ∪ current.dependTools ∪ 全部内置工具`（内置工具取自 `builtinToolNames()`，当前 7 个）。通过 `AgentContext.tools` 下发，构成硬约束。 |
| **三态结果** | `success` / `retryable` / `failed`。工具返回后按错误码归类，决定后续动作。 |
| **滚动规划** | 每批只规划 1~3 步；**队列正常耗尽**后再规划下一批（计入 `rollCount`）。不设独立上限，只受总步数约束。 |
| **失败重规划** | 由步骤失败 / 连续无进展 / 写后失效风险触发的重新规划（计入 `replanCount`），输入额外带失败原因；上限 **6**。 |
| **计划快照** | 注入给模型的进度文本（每步**原地替换**，不追加）。 |

**六条硬口径**：

1. **双开关前置**：`task_planning` 与 `intent_focus` 同时为真才进入规划；任一关闭即零规划调用。
2. **规划在装配之后**：规划调用 MUST 发生在本轮工具装配完成之后，其工具清单 MUST 来自本轮 `availableNames`，MUST NOT 取自 `ontology.yaml` 声明。
3. **后端优先**：凡后端可推导的字段（`type`、`dependTools`、完整工具名、`seqId`）MUST 由后端计算，MUST NOT 依赖 LLM 输出。
4. **硬约束**：执行第 N 步时，模型可见工具集 MUST 仅含该步声明的工具；越界调用由执行层查表拒绝。
5. **不落盘、不跨轮**：计划与进度 MUST NOT 写入 `history.jsonl`、`summary.json`、`intent-focus.jsonl` 或任何持久化产物；每轮新建、轮末丢弃。
6. **不改规则闸门**：`command` 的合规审核仍由 `021` 唯一负责；本特性 MUST NOT 新增审核逻辑，MUST NOT 修改 `rule-gate` 的判定语义。

---

## 用户场景与测试 *(必填)*

### 用户故事 1 - 单步任务被正确规划与执行（优先级：P1）

某数字人已开启「意图聚焦」与「任务规划」。用户提出「帮我核对原材料缺口，不够就补采购」。系统在工具装配完成后调用一次规划，产出 2 步计划：① `QueryInventory`（query）② `CreatePurchaseRecord`（command，`dependTools` 含库存检查函数）。校验通过后直接进入执行。第 1 步仅 `QueryInventory` 与全部内置工具可见；成功返回后系统判定该步完成、出队、切换到第 2 步，此时 `CreatePurchaseRecord` 与其依赖函数可见。第 2 步成功后计划完成，模型收尾回答。

**为什么是这个优先级**：这是功能本体——「规划 → 按步硬约束 → 客观判定 → 推进」的最小闭环。

**独立测试**：以桩规划器固定输出两步计划，跑一轮：
- 断言规划发生在工具装配之后，且输入的工具清单等于本轮 `availableNames`；
- 断言第 1 步执行时 `context.tools` 只含该步三集合，不含第 2 步的 command；
- 断言第 1 步成功后 `current` 推进到第 2 步，且 `doneSummary` 新增一条；
- 断言全程未产生计划确认弹窗、未新增 SSE 事件。

---

### 用户故事 2 - `command` 缺前置函数时可补调而非重规划（优先级：P1）

第 2 步是 `CreatePurchaseRecord`，规则闸门发现其前置函数无结果，返回 `pause`。系统将其归类为 `retryable` 而非 `failed`，保持当前步不推进；因 `dependTools` 已进入可见工具集，模型成功补调该函数，随后重试 command 并成功。

**为什么是这个优先级**：`pause` 误判为 `failed` 会触发一次完整重规划，浪费 LLM 往返且大概率产出同一计划——这是本特性最容易出现的性能黑洞。

**独立测试**：桩工具第一次返回 `RULE_FUNCTIONS_MISSING_CODE`，第二次成功；断言未触发重规划、`attempts === 2`、最终状态 `done`。

---

### 用户故事 3 - 写后失效触发失败重规划（优先级：P2）

两个 command 连续：第 1 个执行后规则闸门使所有函数记录失效，第 2 个 command 的前置已过期。系统在推进时识别「写后失效风险」，触发一次重规划，新计划在 command 前插入重算步骤。

**为什么是这个优先级**：这是「滚动」相对「一次性规划」的核心价值——一次性规划无法预判运行时的写后失效。

**独立测试**：桩规划器第一批返回 `[command, command]`，第二批返回 `[function, command]`；断言第二批在第二次 `shouldStopAfterTurn` 内被请求，且 `replanCount === 1`。

---

### 用户故事 4 - 卡死与预算兜底（优先级：P2）

模型连续两轮不推进任何计划内动作（指纹不变）。系统判定卡死，请求重规划；重规划次数或总步数超限后转软收尾，模型收到理由并正常总结，本轮不异常中断。

**独立测试**：桩模型连续两轮只调计划外工具；断言 `idleTurns` 达阈值后触发重规划，超限后走 `suspendTools` 而非 `abortRunFatal`。

---

### 边界场景

| 场景 | 期望 |
|---|---|
| 「任务规划」开、「意图聚焦」关 | 不进入规划，零新增调用，记 `plan.skipped`（reason=`focus_disabled`） |
| 本轮 `availableNames` 为空 | 不进入规划，记 `plan.skipped`（reason=`no_tools`） |
| 工具全被权限闸门拒掉 / 主模型 provider 不支持工具循环 | 不走 loop 也不规划，记 `plan.skipped`（reason=`no_tools` / `no_loop_provider`）——**早退分支也必须留痕**（2026-11-26） |
| 规划输出非法 JSON（重试 2 次仍失败） | 放弃规划，回退既有对话流程，不阻塞用户 |
| `coreAction` 裸名对应多个完整名 | 校验失败并要求规划器改用完整名；不猜测 |
| 步数 > 3 | 校验失败，带上限提示重试 |
| 首次规划返回 `[]` | **不视为失败**：结束规划，交回主对话正常回答（FR-004a①） |
| 滚动规划返回 `[]` | 任务完成：`plan.finished(reason=completed)`（FR-004a②） |
| 批内出现两个相同 command | 校验失败，要求把重复的 command 推迟到下一批（MUST NOT 合并进同一步） |
| 同一计划有两个不同 command（各占一步） | 正常形态，允许 |
| 模型调用计划外工具 | 执行层返回 `Tool xxx not found`，状态不推进，记入 `extraCalls` |
| 模型在同批内多次调用同一 `coreAction` | 允许（条件 C 支持分页/分批） |
| 用户中途点停止 | 走既有 `run.stop()`，与规划无关 |
| 规划调用本身超时 | **直接放弃规划、不重试**（2026-11-26），回退既有流程 |

---

## 功能需求

### 开关与触发

- **FR-001**：新增数字人布尔开关 `task_planning`（SOUL frontmatter，缺省关闭）。**开关位置在数字人管理平台的「意图聚焦」配置区内**（复选框「任务规划」+ 固定说明「需同时开启意图聚焦」），**只有勾选后本轮才进入规划**。与 `intent_focus` 为**逻辑与**：任一关闭即零规划调用、零新增日志（除一条 `plan.skipped`）。
- **FR-002**：规划 MUST 在本轮工具装配完成（内置 + MCP + 包装）之后、`runAgentLoopEvents` 启动之前发生。工具清单 MUST 来自本轮 `availableNames`。若本轮意图聚焦结果为**空**（未产出 `focus.prompt`），MUST 跳过规划（记 `plan.skipped`，reason=`empty_focus`）——「以意图聚焦为起点」在无起点时不可满足。
- **FR-003**：规划调用的输入 MUST 只由下表构成（**六段 system prompt** + 历史 messages + 重试反馈），且 MUST NOT 额外读取其他素材：

| # | 组成 | 来源 | 约束 |
|---|---|---|---|
| 1 | 规划专用 system prompt | 新模块 `plan/prompt.ts` | 六段结构：角色 / 聚焦起点 / **本体关系** / **可用函数** / 命令前置约束 / 输出格式；**角色段 MUST 写明三条硬要求**（① 优先从聚焦的技能/行为/函数出发；② 每步 `coreAction` MUST 在可用工具清单中有唯一对应；③ MUST NOT 绕开可用工具清单自行规划行为）；**输出格式段 MUST 要求「多个彼此独立的对象即使动作相同也各占一步、禁止合并」**（2026-11-28）；MUST NOT 复用主对话 system prompt |
| 2 | 意图聚焦结果 | `run-consume` 产出的 `focus.prompt`（已在 `systemExtra`） | MUST 以**显式标题**标注为「本轮规划的首选起点」（如「［意图聚焦结果｜本轮规划的首选起点］」），段末 MUST 声明「coreAction 不得超出可用工具清单，清单里也没有时省略该步并说明缺口」；**该段已含选中技能名、本体名与 `ontology_id`，MUST NOT 再单独下发技能文件（全文或章节列表）**；**直通**——聚焦侧已按阶数剪到 4000 / 5000 / 6000，本段 MUST NOT 再做业务截断（旧口径「≤2000 字按行截断」会从末尾切掉「图路径」，2026-11-26 修订），仅保留 8000 字防御性硬顶 |
| 3 | 本体关系 | 本体索引（`ontology.yaml` 的 `relations[]` / `concepts[]` / `behaviors[]`） | MUST 按**本体名称 + `ontology_id`** 分段；每段 MUST 含两部分：① `source —关系名→ target` 三元组列表（只取这三项，不带基数与关联字段）；② 每个概念的关联行为（**command 与 query 分列**）。概念无行为时必须标「（无可用行为）」；行为在 `ontology.yaml` 存在但不在 `availableNames` 时必须标「（未挂载）」，**MUST NOT 因此省略** |
| 4 | 可用函数 | 本体索引 `functions[]` + `availableNames` 中的非行为工具 | MUST 分两组：**本体函数**（`name｜title｜关联概念`）、**非本体函数**（`name｜title｜内置/外部`）；**MUST NOT 在本段列本体行为**（已在第 3 段）；不可达的函数 MUST NOT 列出 |
| 5 | 命令前置约束 | 规则闸门快照 `GateSnapshot.behaviorIndex`——它是 `Map<归一裸名, BehaviorRuleBucket>`，前置函数在 `bucket.pre[].relatedFunctions`，**桶键不含本体维度**：同名即同一工具（同一接口、同一功能），跨本体同名行为的规则与前置函数**按名合并**，不需要本体消歧 | MUST 覆盖**本轮可用的全部 command**（含无前置函数者，标注「（无）」）；**不设字数上限、不截断函数列表**；不可用的 command 不列（计划里也不会出现） |
| 6 | 历史上下文 | `buildPromptMessages` 的产物 | **只取最近 3 轮的 user / assistant 正文，MUST NOT 含 `toolResult`** |
| 7 | 上一轮错误反馈（仅重试时） | `check` 产出的结构化失败项 | 必须定位到「第 N 步 / 字段 / 实际值」 |

- **FR-004**：规划 MUST 以单次非流式聚合调用完成（`tools: []`、`thinking: false`），产出严格 JSON 数组。字段定义：

```
seqId      int     批内顺序
taskName   string  ≤ 20 字
content    string  ≤ 300 字
coreAction string  裸工具名（剔除服务前缀）
type       string  command | query | function（仅作比对，后端重算）
```

`goal` MUST NOT 由 LLM 输出（顶层保持「纯数组」，避免改成 `{goal, steps}` 破坏 FR-004 与解析器）；MUST 由后端取本轮用户原话截断 ≤40 字生成。

- **FR-004a**：规划输出**允许空数组 `[]`**，语义按场景区分：① **首次规划**（本轮尚无任何已执行步骤）返回 `[]` = 该请求无需工具即可回答 → MUST 结束规划阶段、**交回主对话正常回答**，MUST NOT 视为失败、MUST NOT 记 `plan.failed`；② **滚动规划**（队列耗尽后再规划）返回 `[]` = **已无剩余步骤、任务完成** → `plan.finished(reason=completed)`。`[]` 是**唯一的完成信号**：后端 MUST 只判数组长度，MUST NOT 用「模型是否有工具调用意图」等间接迹象推测完成。

- **FR-005**：JSON 解析失败、字段缺失、步数越界（**> 3**）时 MUST 携带**具体失败项**重试；单批重试上限 **2** 次；超限则放弃规划并回退既有流程（不阻塞用户）。**空数组不属越界**：首次 `[]` 走 FR-004a①，滚动 `[]` 走 FR-004a②。**超时 MUST NOT 重试**（2026-11-26）：超时的成因是"慢"，原样重发只会把首字延迟放大 2~3 倍；单次超时即放弃规划（`plan.abandoned(reason=timeout)`）并回退。为配合该口径，单次上限由 5s 提高到 **20s**（见 NFR-001）。
- **FR-006**：解析 MUST 容忍 markdown 代码块围栏与首尾空白；MUST NOT 做「从自由文本中推断性修补 JSON」的行为。

### 归一化（补全，不校验）

- **FR-007**：`coreAction` MUST 由后端解析为模型可见的**完整工具名**作为内部唯一键；对外的 `coreActionLabel` 为**剔除服务前缀**的裸名。服务前缀的真实形态是 **`{服务名}__{工具名}`**（MCP 适配器产出，**不存在 `mcp__` 三段式**），裸名 = 第一个 `__` 之后的部分。归一 MUST 复用 `ontology-doc.ts` 的 `matchKeys` / `normalizeName`（`matchKeys` 已同时返回完整名与去前缀名），MUST NOT 新写归一口径，MUST NOT 自行 `startsWith('mcp__')` 判断。解析结果为 0 个或多个候选时 MUST 标记失败（交 FR-010 判定），MUST NOT 默认取第一个。
- **FR-007a**：**两种名字 + 一个派生键 MUST 分离**，混用会导致「工具全部不可见」的静默故障：实体名① **裸名**（`QueryInventory`，`focus.prompt` 与本体 yaml 的形态）用于 LLM 输出与展示；实体名② **完整工具名**（原样大小写，如 `svc__QueryInventory`）存入 `PlanStep.coreAction`，用于过滤 `AgentContext.tools` 与比对 `toolCall.name`；③ **派生键**（`normalizeName` = trim + 小写，`matchKeys` 再展开「去前缀名」）**不是名字、不落库、不给模型看**，只用于查 `availableNames` 与 `behaviorIndex`。`availableNames` 是 **`ReadonlySet<string>` 且只含派生键、不携带原样名**，因此解析 MUST 额外建「派生键 → 原样工具名[]」映射（来源为本轮 `guarded` 数组），MUST NOT 只靠 `availableNames` 反推原名，MUST NOT 把派生键/裸名写进 `coreAction`。两侧 MUST NOT 统一成单一命名：全用完整名会把本体钉死在服务名上、且「未挂载」行为无完整名；全用裸名无法区分多服务同名且 SDK 按原样精确匹配；全用小写注册需改装配层与既有 HITL / 权限白名单。
- **FR-008**：`type` MUST 由后端推导（唯一权威），依据规则闸门快照 `behaviorIndex` 的**命中判定 + `command` 布尔**（注意：这里的"三分类"与 FR-018 的"结果三态"**不是同一概念**，命名上 MUST 区分）：命中且 `command===true` → `command`；命中且 `command===false` → `query`；未命中 → `function`。桶键为归一裸名、不含本体维度；**同名即同一工具**，跨本体同名行为按名合并，不需要消歧。LLM 输出值若不一致 MUST 记告警并以推导值为准，MUST NOT 因此重规划。
- **FR-009**：`dependTools` MUST 由后端推导，规则如下，且结果 MUST 转成完整工具名并过滤掉不在 `availableNames` 的项：

| 步骤类型 | dependTools |
|---|---|
| `command` | ① 该行为前置规则的 `related_functions`（**函数本身**）；② 这些函数 `related_concepts` 所指概念的**同本体 query 行为** |
| `query` | 空 |
| `function`（本体函数） | 其 `related_concepts` 所指概念的**同本体 query 行为** |
| `function`（非本体工具） | 空 |

推导细则：

- **`command` 的两层缺一不可**：第 ① 层（前置函数本身）必须进集合，否则一旦撞 `pause`，模型要补调的前置函数**不在可见工具集里**，无法补调 → 死锁。第 ② 层（这些函数关联概念的 query 行为）是给前置函数提供输入数据用的。
- **「同本体」的含义**：概念所属本体 = 当前 `coreAction` 所在本体；跨本体的同名概念不参与。
- **结果 MUST 去重**：多个前置函数可能指向同一概念、多个概念可能暴露同一 query 行为，最终集合是集合并集。
- **`coreAction` 自身不在 `dependTools` 里**：可见工具集是 `{coreAction} ∪ dependTools ∪ 全部内置工具`（FR-014），重复列入无意义。
- **数据源分两处**：第 ① 层来自 `GateSnapshot.behaviorIndex` 的 `bucket.pre[].relatedFunctions`；第 ② 层来自 `intent-focus/ontology-loader` 的 `functions[].relatedConcepts` 与 `behaviors[].concept`（闸门侧 `ontology-doc.ts` 读不到 `related_concepts`）。两者在 `plan/ontology-facts.ts` 汇合。

- **FR-010**：`seqId` MUST 由 run 级自增计数器分配，跨批次连续，MUST NOT 每批重置。

### 校验

- **FR-011**：校验 MUST 分两步且顺序固定：`normalizePlan`（只补全，幂等）→ `checkPlan`（只判定，不改数据）。
- **FR-012**：`checkPlan` MUST 包含以下六条，任一失败即整批作废。**此处失败处理是「规划重试」（计入 `planRetryCount`，上限 2 次，见 FR-005），不是执行期的「失败重规划」（`replanCount`，上限 6）**——两者计数与上限不同，MUST NOT 混用：

| 编号 | 校验 | 失败处理 |
|---|---|---|
| C0 | `coreAction` 解析为唯一完整名且 ∈ `availableNames` | 规划重试，点名步骤与可用工具 |
| C1 | `type` ∈ {command, query, function} | 防御性；归一后几乎不触发 |
| C2 | 类型与本体角色一致 | 规划重试，说明「实际是 X 类型」 |
| C3 | `dependTools` 每项 ∈ `availableNames` | 规划重试，列出缺失项 |
| C4 | 批内无重复的 `command`：每个 command 至多占一步（`query` / `function` 允许重复） | 规划重试，要求把重复的 command 推迟到下一批 |
| C5 | 步数 ∈ [1,3]（**滚动规划的 0 步 = 完成，不走 C5**，见 FR-004a）、`taskName` ≤20 字、`content` ≤300 字、`coreAction` 非空 | 规划重试，指明字段与上限 |

- **FR-013**：校验通过后计划 MUST 临时保存于 run 级状态（与 `FunctionRecord` 同级），MUST NOT 持久化、MUST NOT 跨轮。

### 执行与硬约束

- **FR-014**：执行第 N 步时，`AgentContext.tools` MUST 恰好等于 `{coreAction} ∪ dependTools ∪ 全部内置工具`；切换 MUST 在 `prepareNextTurn` 完成。过滤对象 MUST 是已包装的工具数组（`guarded`），MUST NOT 过滤裸工具数组。
  - **「全部内置工具」MUST 取自唯一来源 `builtinToolNames()`**（`domain/builtin-tool-catalog.ts`），MUST NOT 硬编码清单、MUST NOT 另维护第二份名单。当前目录共 7 个：`read_file`、`write_file`、`list_dir`、`grep_files`、`calculator`、`read_skill`、`grep_skill`；新增内置工具时自动生效。
  - 内置工具在规则闸门里**原样执行、不判定、不记录**（`tool-rule-gate.ts`），因此 `write_file`（仅临时空间顶层）常驻不破坏「一步一个 command」：它写的是临时产物，不是业务数据，也不参与本体规则判定。
- **FR-015**：传给规则闸门的 `availableNames` MUST 保持**全量**，MUST NOT 随步收窄。否则新挂载的依赖函数会被判为未注册而拒绝。
- **FR-016**：计划快照 MUST 注入 messages（MUST NOT 注入 `systemPrompt`），且 MUST **原地替换**上一条快照消息，MUST NOT 追加。单条快照上限 **1200 字符**，超限按**整行**丢弃。
- **FR-017**：整个 run 内 `systemPrompt` MUST 保持不变（不得随步重建），以保住 KV-cache。

### 完成判定

- **FR-018**：工具返回后 MUST 归入三态之一。**三态（`success` / `retryable` / `failed`）是本特性新建的分类，现有代码中不存在 `retryable`**——它是对既有两套分类的归一：① 规则闸门 `PrepareResult` 五态（`function` / `behavior` / `pause` / `deny` / `fatal`）；② 工具结果的二元判定（正常 / 带 `details.toolError`）。映射口径：`pause → retryable`；`deny` / `fatal` / 未注册 → `failed`。归类依据统一失败标记（`readToolError`）：

| 态 | 判据 |
|---|---|
| `success` | `isError === false` |
| `retryable` | `isError === true` 且 code ∈ {`RULE_FUNCTIONS_MISSING_CODE`, 参数校验失败, 工具执行异常} |
| `failed` | `isError === true` 且 code ∈ {`RULE_DENIED_CODE`, `ABORTED`, 未注册} |
| 不计入三态 | `isError === true`、**无 code**，且 message 命中 SDK 固定文案 `Tool <name> not found` |

**判定顺序 MUST 固定**：先看 `isError`，再取 `readToolError()` 的 code，最后才用 message 兜底。原因是 **SDK 侧的错误结果 `details` 恒为 `{}`**（`createErrorToolResult` 只放 `content` + 空 `details`），因此「参数校验失败」「工具执行异常」「`Tool not found`」三类在 `afterToolCall` 里都**没有 code 可读**：

- 无 code 的 `isError === true` **默认归 `retryable`**（覆盖参数校验与执行异常）；
- 只有 message 精确匹配 `Tool <name> not found` 时例外，归「不计入三态」——该文案是 SDK 的固定产出，MUST 用字面前缀/正则匹配，MUST NOT 做模糊文本猜测。

参数校验失败的分类**不依赖 provider 返回专用码**（它不返回），这是本特性 MUST 接受的现状，MUST NOT 为此新增依赖或改 SDK。

- **FR-019**：判定点 MUST 是 `shouldStopAfterTurn`（整批 `toolResults` 闭合后），MUST NOT 放在 `afterToolCall`。
- **FR-020**：步骤完成的充要条件为三条同时成立：A) `coreActionOk === true`；B) 整批已闭合；C) `lastCoreActionTurn < 当前 turn`。C 用于支持「一步内多次调用同一工具」（分页、分批）。
- **FR-021**：完成 MUST 以**出队**表达（`queue.shift()` + 追加 `doneSummary`），MUST NOT 用「按名字打标记」实现；已完成步骤 MUST NOT 回退为 `pending`。
- **FR-021a**：**一步只承载一个 command，多个 command MUST 各占一步**。该口径由三处**硬约束**叠加保证，MUST NOT 依赖模型自觉：① 结构上 `coreAction` 为单值；② FR-009 的 `dependTools` MUST NOT 含其它 command，配合 FR-014 的可见工具集使步内第二个 command 不可调用；③ FR-012 C4 拒绝批内重复 command（同一 command 占两步），重复者 MUST 推迟到下一批，MUST NOT 合并进同一步。提示词第 6 段中的同类措辞仅为**软引导**，MUST NOT 作为校验依据。
- **FR-022**：同一 `coreAction` 连续 `retryable` 达 **3** 次 MUST 转为 `failed` 并触发重规划。
- **FR-023**：结论摘要 MUST 由后端从成功结果截取（≤80 字/条），MUST NOT 额外调用 LLM；`doneSummary` 保留最近 **5** 条。摘要 MUST 先清洗：剥 Markdown 表格、剥悬空引导语（`结果：` / `如下：` / 结尾冒号）、剥复述式开头（`当前这一步已执行完毕：`）；清洗后不足 **6** 字时 MUST 用「步骤名（行为名）已完成」兜底，**MUST NOT** 留下没有任何事实的空壳结论（2026-11-26 实测：模型写「…**结果：** + 表格」时旧实现只剩悬空引导语）。

### 推进、重规划与终止

- **FR-024**：队列非空时 MUST 直接推进到下一步，MUST NOT 重规划（**步与步之间零规划调用**）。队列**耗尽**时 MUST 发起**滚动规划**（`rollCount += 1`，输入含 `doneSummary` + 工具清单）：返回 1~3 步则入队继续；返回 `[]` 则 `plan.finished(reason=completed)`。步骤失败、连续无进展、写后失效风险时 MUST 发起**失败重规划**（`replanCount += 1`，额外带失败原因）。两类计数 **MUST 分开**：`rollCount` 不单独设上限（只受总步数 20 约束），`replanCount` 上限 6；MUST NOT 合并为一个计数，否则正常长任务会被“重规划超限”误杀。**滚动调用本身失败** MUST 沿用 FR-005 的 2 次重试；**滚动调用超时** MUST 直接 `plan.finished(reason=plan_exhausted)` 并走软收尾（不重试，同 FR-005）；MUST NOT 无限滚动。
- **FR-025**：重规划输入 MUST 为「目标 + `doneSummary` + 失败原因 + 可用工具清单」，MUST NOT 重传完整历史。
- **FR-026**：`getFollowUpMessages` MUST 在「计划未完成且模型本 turn 未调用工具」时注入「继续第 N 步」，且 MUST 受 `idleTurns` 上限约束。
- **FR-027**：终止条件 MUST 完整覆盖六类：① 正常完成（滚动规划返回 `[]`）→ **直接收尾，MUST NOT 走 `suspendTools`**；② 总步数超限（**20**）；③ 失败重规划超限（**6**）；④ 卡死（连续无进展 2）；⑤ 不可执行（工具清单为空、首次规划重试耗尽或超时等）；⑥ 用户中断。**②~⑤ 超限 MUST 走软收尾**（`suspendTools`），MUST NOT 使用 `abortRunFatal`；⑥ 走既有 `run.stop()`。**滚动次数不单独计上限**，只受 ② 约束；`[]` 完成 MUST NOT 计入任何超限。判定优先级 MUST 为「先判 `[]` 完成，再判超限」——第 20 步恰好完成且滚动返回 `[]` 时 MUST 记为正常完成。
- **FR-028**：连续无进展 MUST 用状态指纹（`seqId:coreActionOk:attempts`）判定，MUST NOT 用「连续 N 个 turn 无工具调用」。

### 交互与观测

- **FR-029**：`command` 的合规审核 MUST 完全复用 `021` 规则闸门；本特性 MUST NOT 新增审核逻辑、MUST NOT 修改闸门语义、MUST NOT 修改 `tool-rule-gate.ts` 的判定分支。
- **FR-030**：本特性 MUST NOT 新增对外 HTTP 端点。SSE 事件**只允许一个** `plan_progress`（见 FR-034），且只承载单行进度；MUST NOT 推送计划正文、MUST NOT 新增确认弹窗或计划面板。
- **FR-031**：观测 MUST 使用结构化日志事件（见 data-model 的事件表），MUST NOT 记录工具结果正文（对齐 `021` 的 `FR-040`）。
- **FR-032**：全局工具批次串行（`toolExecution: 'sequential'`）是本特性的**前置依赖**，MUST 已上线；本特性 MUST NOT 依赖并行执行。
- **FR-033**：规划的 `coreAction` MUST 优先落在本轮意图聚焦的覆盖集合内（直接命中行为 + 上下发散行为 + 关键函数 + 关联概念取数行为）。若某步 `coreAction` 不在该集合但仍在 `availableNames` 内，MUST 记录 `plan.step.out_of_focus` 告警事件，MUST NOT 阻断执行——聚焦可能漏选，硬拒会造成计划不可完成。
- **FR-034（计划进度可见性，方案 B）**：聊天区 MUST 用**单行进度条**展示"当前执行到哪一步"，数据只来自 `plan_progress` 事件 `{ seqId, label, phase }`，`phase ∈ {running, replanned, done}`。
  - 发出时机 MUST 恰好三处：① 装批与步推进（`enqueue()` 与 `shouldStopAfterTurn` 的完成分支，即 `refreshVisible()` 同点）；② 重规划装批后（`replanAfterFailure()` / `roll()`）；③ 本轮收尾（`terminate()`）。
  - **默认折叠为一行**；允许点击展开**本轮已经出现过的步骤**（只读、按 `seqId` 去重），MUST NOT 渲染未来步骤或总数承诺（方案 C 的"完整计划表"已否决：重规划会让整张列表跳变，比一行文字更刺眼，且会把"会改的计划"固化成"承诺"）。展开态为轻量 popover，遮挡输入区即视为违规。
  - MUST NOT 写入对话历史、MUST NOT 进入 `doneSummary`、MUST NOT 持久化；刷新页面不恢复。
  - 本轮结束（`plan.finished`）后 MUST 淡出，MUST NOT 在历史里留下"曾经承诺 N 步"的痕迹。
  - 无障碍：容器 MUST 为 `role="status"` + `aria-live="polite"`，只在文案变化时播报，MUST NOT 抢占正文朗读（宪章原则四）。
- **FR-035（进度条文案口径，待确认）**：文案 MUST 为「第 N 步 · <步骤名>」，**默认不带总步数**——总步数会被滚动规划与失败重规划改写，"共 3 步"变"共 4 步"会让用户认为系统失信。若产品要求显示总数，则 MUST 在数字跳变时给出一次可感知提示（进度条闪烁），且 MUST NOT 使用百分比进度（同上理由）。
- **FR-036（计划留档，2026-11-26）**：每轮**真的产出过步骤**的计划 MUST 追加一条过程事实到 `user-data/{数字人}/threads/{thread_id}/plan.jsonl`（与 `intent-focus.jsonl` 同层）。
  - **只记录、不参与上下文组装**：运行期 MUST NOT 有任何读取方，`readAll` 只服务事后分析与测试；MUST NOT 写入 `history.jsonl`（计划与快照绝不进历史，避免被「读历史即装配上下文」带回模型）。
  - 记录字段：`at` / `thread_id` / `agent_name` / `goal` / `reason` / `total_steps` / `rolls` / `replans` / `duration_ms` / `done_summary` / `steps[]`（`seq_id` / `task_name` / `type` / `core_action` / `status` / `attempts`）。MUST NOT 记录工具结果正文（与 FR-031 同口径）。
  - 发点唯一：`terminate()` 内、软收尾之前，一轮最多一条。跳过规划、首轮 `[]`、装配失败等**空轮 MUST NOT 写入**。
  - **有界**：单线程保留最近 **100** 条，超限即重写（临时文件 + 原子改名）；同线程写入 MUST 串行，避免交错。
  - 写入失败 MUST 只告警（`plan.record.failed`），MUST NOT 抛出、MUST NOT 影响本轮对话。
- **FR-037（规划门禁，2026-11-26）**：数字人开启 `task_planning` 时，MUST 在发起规划调用前，用**意图聚焦同一条 laya 通道**判定一次"这轮是否涉及多个对象或多个任务，即是不是一步就能完成"；分数 ≥ `intent_focus.plan_threshold` 才发起规划。
  - 配置：`plan_threshold`（0~1；**缺键 = 门禁关闭**，行为与门禁前一致）、`plan_timeout_ms`（缺省 5000，不得大于 `timeout_ms`）；环境变量 `INTENT_FOCUS_PLAN_THRESHOLD` 可覆盖阈值。
  - 零成本前置：数字人未开 `task_planning` MUST NOT 判定（不产生额外 laya 调用）；`focus` 未产出提示词时本就不走规划。
  - **fail-open**：判定超时 / HTTP 失败 / 分数缺失 MUST 继续走规划，MUST NOT 把复杂任务降级为直聊；失败 MUST 记 `plan.gate.degraded`。
  - 判据口径（2026-11-28 用户拍板翻转）：多个对象（两个及以上彼此独立的事物）**即使动作相同也算多个对象**，或多个任务（两个及以上动作，或存在先后步骤），一律判为"不是一步能完成"→ 走多步规划；**原"同一动作查询多个对象算一个任务"的口径已废**（每个对象独立执行、独立核对，接受多一次往返的代价）。单批上限仍 3 步，超过 3 个对象由滚动规划续批；规划提示词同步要求"一个对象占一步、禁止把多个对象合并到同一步"。
  - 可观测：`intent-focus.jsonl` MUST 记录 `plan_score` / `plan_round_ms`；因门禁跳过规划 MUST 记 `plan.skipped reason=below_threshold`（含 `plan_score` 与 `threshold`）。
  - **聚焦能力前置（2026-11-27）**：规划必须从聚焦行为或函数起算，因此本轮 MUST 至少**直接命中**一个本体行为或本体函数才允许规划（上/下游发散只算参考，不算起点）。只命中技能（含非本体技能）而行为/函数全部未入选时 MUST 跳过规划并记 `plan.skipped reason=no_focus_capability`，且 MUST NOT 再发起门禁判定（已确定不规划就不白花一次 laya 调用）。该判据**不适用 fail-open**：`hasCapability === false` 是事实而非判定失败；判据缺席（未接入该判据的调用方）按"允许规划"处理。

---

## 非功能需求

- **NFR-001（性能）**：规划调用单次上限 **20 秒**（2026-11-26 由 5 秒提高：规划提示词含全量本体索引 + 全工具清单，5 秒会误伤冷启动/慢网络）；**超时即放弃、不重试**，故整轮因规划新增的等待上界为单次 20 秒。执行阶段端点 P95 承诺不变。
- **NFR-002（一致性）**：状态转移 MUST 原子（一次 `shouldStopAfterTurn` 内完成全部判定与推进）。
- **NFR-003（依赖）**：MUST NOT 新增第三方依赖。
- **NFR-004（模块化）**：新增纯函数模块 MUST 单文件 ≤ 500 行；状态机与渲染 MUST 与 IO 分离。
- **NFR-005（测试）**：新增模块语句覆盖率 ≥ 80%；纯函数 MUST 同名同目录 spec。
- **NFR-006（降级）**：规划任一环节失败 MUST 回退到既有对话流程；MUST NOT 因规划失败导致本轮不可用。

---

## 成功判据

- **SC-001**：开启规划后，LLM 产出的计划 MUST 一次通过校验的比例 ≥ 90%（2 次重试内 ≥ 98%）。
- **SC-002**：执行第 N 步时，`context.tools` 与 FR-014 公式 MUST 100% 一致；越界调用 MUST 100% 被拒绝。
- **SC-003**：步骤完成判定与人工回放核对的一致率 ≥ 98%；`pause` 被误判为 `failed` 的比率 MUST 为 0。
- **SC-004**：任何单一用户输入 MUST 在有限步内结束（总步数 ≤**20**、失败重规划 ≤6、无进展 ≤2），MUST NOT 出现无限循环；滚动次数不设独立上限，由总步数约束。
- **SC-005**：开启规划后首字延迟增量 P90 ≤ 3 秒（仅规划调用一次时）或 ≤ 1.5 秒/次重规划。**统计口径**：20 秒是硬超时上限（NFR-001），**超时样本触发降级且不计入延迟统计**——否则 P90 指标与超时预算自相矛盾。
- **SC-006**：规划关闭时，链路行为、日志、token 消耗与上线前完全一致（零增量）。
- **SC-007**：「以意图聚焦为起点」可度量：抽样回放中，`coreAction` 落在聚焦覆盖集合内的步骤占比 ≥ **80%**；低于该值视为提示词失效，需调整第 1、2 段的表达。

> 回放类判据（**SC-001 / SC-003 / SC-007**）依赖真实样本与统计脚本，无对应产品代码。其统计口径与最小样本量由任务 **T807** 落实；若本期不做回放，MUST 在本节登记为「**上线后观测**」，MUST NOT 伪装成本期验收项。

---

## 影响面评估

| 侧 | 是否改动 | 说明 |
|---|---|---|
| `agent-backend` | **是** | 新增 `domain/plan/*`、`infra/plan-orchestrator.ts`；改 `infra/agent-factory.ts`（装配与钩子）；`infra/agent-loop.ts` 需透传 4 个钩子 |
| `admin-backend` | **是** | SOUL 新增 `task_planning` 布尔键；改 `input_rewrite` 同款读写归一 |
| `admin-frontend` | **是** | 设计器新增复选框「任务规划」，位置在意图聚焦配置区；说明文案「需同时开启意图聚焦」 |
| `frontend` | **是（增量，方案 B）** | 消费 `plan_progress` 渲染**单行进度条**（FR-034 / FR-035）：不新增计划面板、不做确认弹窗、不写对话历史。既有工具卡片因串行化而顺序变化，需回归一次 |

---

## 修订记录

| 日期 | 版本 | 变更 | 说明 |
|---|---|---|---|
| 2026-11-25 | v0.1 | 初稿 | 依据 10 轮设计讨论收敛；含 9 点 clarify、6 条硬口径、32 条 FR、6 条 SC |
| 2026-11-25 | v0.2 | 规划输入收敛 | 取消单独下发技能文件（`focus.prompt` 已含技能名 / 本体名 / `ontology_id`）；「规则与本体事实」段收敛为「命令前置约束」；system prompt 由六段减为五段 |
| 2026-11-25 | v0.3 | 前置约束不截断 | 命令前置约束 MUST 覆盖全部可用 command（含无前置者标「（无）」），取消 400 字上限与函数列表截断；改为在 `plan.requested` 记录 `command_count` / `system_chars` 做可观测 |
| 2026-11-25 | v0.4 | 强调以聚焦为起点 | 第 1、2 段各强调一次「必须从意图聚焦结果出发」；聚焦为空时跳过规划（FR-002）；新增「越界但不阻断」的观测口径（FR-033）与可度量判据（SC-007） |
| 2026-11-25 | v0.5 | command 一步一个 | 明确**一步只承载一个 command，多个 command MUST 各占一步**。新增 FR-021a 写死三层保证（`coreAction` 单值 / `dependTools` 不含其它 command / C4 拒绝批内重复）；C4 失败处理由「合并或推迟」改为「只允许推迟到下一批」（合并进同一步违反一步一个 command）；边界场景补「同一计划两个不同 command 各占一步属正常形态」。**不引入执行层单次拦截**：同一 command 在一步内多次调用仍允许（多笔写入），由条件 C 支持 |
| 2026-11-25 | v0.6 | 与现有代码对齐 | ① 开关落点由 `config.ts` 改为 `domain/soul.ts`（`intent_focus` 同款，`config.ts` 只放 env 阈值，无布尔开关）；② 前置约束来源精确为 `behaviorIndex`（`Map<归一裸名, bucket>`）的 `bucket.pre[].relatedFunctions`；桶键不含本体维度，**同名即同一工具，跨本体同名按名合并、不做消歧**；③ 明确结果三态为**新建分类**（现存代码无 `retryable`），给出与 `PrepareResult` 五态 / `details.toolError` 的映射，判定顺序 `isError → code → message`；SDK 错误结果 `details` 恒为 `{}`，无 code 时默认 `retryable`，仅 `Tool <name> not found` 精确匹配归不计三态；④ 服务前缀真实形态为 `{服务名}__{工具名}`，**无 `mcp__` 三段式**；⑤ 拆分「`type` 三分」与「结果三态」的同名术语冲突；⑥ 新增 FR-007a：裸名 / 完整工具名 / 归一键三套口径分离——`availableNames` 只含归一键且不携带原样名，解析须现场建「归一键 → 原样工具名[]」映射；`coreAction` MUST 存原样完整名（SDK 按 `t.name === toolCall.name` 精确匹配、大小写敏感） |
| 2026-11-25 | v0.7 | 完成判据与预算 | ① 新增 FR-004a：规划输出允许空数组 `[]`——**首次 `[]` = 无需工具，交回主对话**；**滚动 `[]` = 任务完成**；`[]` 是唯一完成信号，MUST NOT 用「模型有无工具调用意图」推测。② 明确**步与步之间零规划调用**，只在队列耗尽（滚动）或失败（重规划）时调用。③ `rollCount` 与 `replanCount` **分开计数**：正常滚动不设独立上限，只受总步数约束；失败重规划上限 6。④ 总步数上限 **10 → 20**。⑤ C5 与边界场景按「首次/滚动」区分 0 步语义；第 6 段提示词加「无需工具或已无剩余步骤则输出 `[]`」。⑥ FR-001 明确开关位置在**数字人管理平台的意图聚焦配置区**，未勾选即零规划调用 |
| 2026-11-25 | v0.8 | 一致性核查修正 | 依 `/speckit.analyze` 修正：① FR-027 改为六类终止，明确 **① 正常完成不走 `suspendTools`**、②~⑤ 超限走软收尾、⑥ 走 `run.stop()`，并写死「先判 `[]` 再判超限」；② 术语表拆分「滚动规划」与「失败重规划」，删除“队列耗尽或步骤失败”的混称；③ C0~C5 的失败处理统一为「规划重试（`planRetryCount`）」，与执行期「失败重规划（`replanCount`）」区分；④ FR-024 补滚动调用自身的失败/超时处理；⑤ FR-003 改为「六段 system prompt + 历史 + 重试反馈」，修正“六部分 vs 七行”的不一致；⑥ 用户故事 3 更名「写后失效触发失败重规划」；⑦ 状态更新为「设计定稿，待实现」 |
| 2026-11-25 | v0.9 | 二轮核查修正 | 依第二轮 `/speckit.analyze` 修正：① 更正修订记录顺序（v0.7 应在 v0.8 之前）；② SC-005 补统计口径——**5 秒硬超时样本触发降级且不计入延迟 P90**；③ 任务侧对齐：`T102s` 空数组返回空 `RawStep[]` 属合法、Phase 5 更名「滚动与失败重规划」、`T101` 按 data-model §5 的 **16 项**常量、`T504` 明确两个**不同** command、`T603` 明确触发**失败重规划**、`T204s` 补 FR-029「判定结果未变」回归断言；④ `plan.md` 原则八说明与 P4 交付物补「四侧门禁」与「回放口径结论」 |
| 2026-11-25 | v0.10 | 实施落地（T806） | 编排器 `agent-backend/src/infra/plan-orchestrator.ts` + 规划调用适配 `plan-llm.ts` 落地；`agent-loop.ts` 透传四个可选钩子、`agent-factory.ts` 在工具装配之后挂载；`domain/soul.ts` 与 `admin-backend` / `admin-frontend` 三侧同改 `task_planning`（与 `intent_focus` 逻辑与，聚焦关闭即置灰保留值）；规划输入新增请求字段 `focusPrompt`（第 2 段只吃聚焦原文，不吃 `systemExtra`）。测试：`agent-backend` `npm run gate` 全绿（139 files / 1857 tests，All files 87.39% stmts / 80.13% branch）；`admin-backend` / `admin-frontend` 类型检查与开关单测通过。**性能实测（T803）与抽样回放（T807）本期不做**，按登记口径列为「上线后观测」，不作验收项 |
| 2026-11-25 | v0.11 | 收尾：写后失效 + 集成测试 | ①**T502 落地**：`advanceBatch` 在推进点用 `isStale`（`hasEver && !has`）探测下一步的 `dependTools`，命中则 `needsReplan` + `staleStep`（不标 failed），重规划原因记 `stale_functions`；②**修复一处真实死锁**：原实现只在装批时刷新可见工具集，步与步之间不刷新 → 推进到第 2 步后模型只看到第 1 步的工具（`Tool not found`），现于 `shouldStopAfterTurn` 的完成分支补 `refreshVisible()`；③新增进程内集成用例 `plan-basic` / `plan-pause` / `plan-replan` / `plan-stall`（真实 pi loop + 真实闸门 + 真实编排器，仅桩掉两处 LLM），新增事件断言 `plan-events.spec.ts` 与开关单测 `soul-task-planning.spec.ts`；④门禁：`agent-backend` 146 files / 1887 tests / 87.53% stmts，`frontend` 128 files / 1478 tests，`admin-backend` 725 tests，`admin-frontend` 687 tests 全绿。T803/T807 仍为上线后观测 |
| 2026-11-25 | v0.12 | 新增：计划进度可见性（方案 B） | 用户确认在聊天区展示执行进度。**新增 FR-034**：单行进度条，只消费 `plan_progress` 事件 `{ seqId, label, phase }`，三处发出（装批/推进、重规划装批、收尾）；不渲染列表、不入历史、结束淡出、`role="status"` + `aria-live="polite"`。**新增 FR-035**：文案「第 N 步 · 步骤名」，默认不带总步数（总步数会被重规划改写，带总数等于向用户承诺会变的数字）——口径待产品确认。**修订 FR-030**：由「MUST NOT 新增任何 SSE 事件」收窄为「只允许 `plan_progress` 一个事件、不新增 HTTP 端点」。影响面表 `frontend` 由「否」改为「是（增量）」。方案 C（折叠面板列全部步骤）已否决，理由记录在 FR-034。**本条仅记录需求与方案，代码未动**（见 `plan.md` P6、`tasks.md` Phase 9） |
| 2026-11-26 | v0.13 | 段 2 改为直通 | 同日在 `019` 修丢边后路径行变多，而段 2 仍二次截到 2000 字（`truncateByLines` 从末尾丢），恰好切掉三节之末的「图路径」。改为：段 2 **直通** `focus.prompt`（聚焦侧已按阶数剪到 4000 / 5000 / 6000），**MUST NOT 业务截断**，仅保留 8000 字防御性硬顶、超硬顶仍按行截断。**修订 FR-003 第 2 行**与 `data-model.md` §1.1 第 2 行；`FOCUS_PROMPT_MAX_CHARS` 更名 `FOCUS_PROMPT_HARD_CAP_CHARS`；`plan-prompt.spec.ts` 新增「段 2 直通」「超硬顶按行截断」两例 |
| 2026-11-26 | v0.14 | 摘要与事件口径修正 | ① **FR-023 补摘要清洗**：剥表格 + 剥悬空引导语（`结果：`/`如下：`/结尾冒号）+ 剥复述式开头；清洗后不足 6 字用「步骤名（行为名）已完成」兜底。实测模型写「…**结果：** + 表格」时旧实现只剩悬空引导语，滚动规划拿到零事实。② **`plan.step.started` 改为每步一次**（`data-model.md` §10）：此前只在装批发，同批推进的第 2 步起没有该事件，`visible_tool_count` 无法观测；现由装批与推进点共用同一发点，需重规划时被替换的步不发。③ 实验脚本观测点由 `streamChat` 扩到 `loopOptions().streamFn`（主对话的真实出口），此前「主对话 0 次」是拦截位置错位。改动面：`src/domain/plan/state.ts`、`src/infra/plan-orchestrator.ts`、`scripts/experiment-plan-flow.ts` 及对应单测 |
| 2026-11-26 | v0.16 | 规划超时与降级留痕 | ① `PLAN_TIMEOUT_MS` 由 **5s 提到 20s**（规划提示词含全量本体 + 全工具，5s 误伤冷启动/慢网络）；② **超时不再计入重试**——单次超时即 `plan.abandoned(reason=timeout)` 并放弃规划，最坏等待由 3×5s 收敛为 1×20s（FR-005 / FR-024 / NFR-001 / SC-005 同步改写）；③ `callPlanWithTimeout` 增加 `Promise.race` **硬超时**（`abort()` 只是发信号，provider 不响应时会挂死会话）；④ 装配层早退分支（无可用工具 / 非 Pi provider）补 `plan.skipped`（`no_tools` / `no_loop_provider`），规划开关同轮只读一次 |
| 2026-11-26 | v0.17 | 计划进度可见性落地（Phase 9） | ① **FR-034 允许展开**：原「MUST NOT 渲染完整步骤列表」修订为「默认折叠为一行；可展开**本轮已出现的步骤**（只读、按 `seqId` 去重），MUST NOT 渲染未来步骤或总数承诺」；位置定为**输入区上方常驻单行**（不占对话长度、重规划只改一行文字、结束淡出）。② 后端落地：`domain/plan/types.ts` 新增 `PlanProgress` / `PlanProgressPhase`；`infra/plan-orchestrator.ts` 三处发点（`enqueue` 装批与步推进 / 重规划装批 `replanned` / `terminate` `done`），空轮零发；`agent-loop.ts` 接收 `planProgress`（begin 期间积压）与 `onPlanProgress`（实时回调）并入事件队列；`run-events.ts` 新增 SSE 类型，`run-consume.ts` 只转发不留痕。③ 前端落地：`PlanProgressBar.vue`（`role="status"` + `aria-live="polite"`、展开只列已见步骤、`replanned` 闪一次并提示「计划已调整」、结束 1.5s 淡出）、`useChatStream` 按 `seqId` 合并、`ChatPanel.vue` 挂在输入区上方。④ 测试：`plan-progress.spec.ts` 4 例、`PlanProgressBar.spec.ts` 6 例、`useChatStream.plan-progress.spec.ts` 4 例 |
| 2026-11-26 | v0.18 | 规划门禁（FR-037） | 用户要求：开了规划后仍需用 laya 判一次"这轮是否多对象/多任务（不是一步能完成）"，过阈值才走规划；判定与阈值**放在意图聚焦模块与配置块内**（不新增独立配置块）。① **新增 FR-037**：`intent_focus.plan_threshold`（0~1，缺键=门禁关闭，缺省 0.4）、`plan_timeout_ms`（缺省 2000，不得大于 `timeout_ms`）、环境变量 `INTENT_FOCUS_PLAN_THRESHOLD`；未开 `task_planning` 的数字人零额外调用；**fail-open**（超时/失败/无分数一律走规划）。判据明确"同一动作查多对象算一个任务"（避免把批量查询拆步变慢）。② 落点：新增 `domain/intent-focus/plan-gate.ts`（题面 + `judgePlanGate` + `planGateBlocks`）；`runner.ts` 在能力判定后用剩余预算单独判一次（不并入技能批，避免污染 013 的"全批失败"降级语义），分数写入 `intent-focus.jsonl` 的 `plan_score` / `plan_round_ms`；`run-consume` → `AgentRunRequest.planScore` → `agent-factory` 用 `planGateBlocks` 分流并记 `plan.skipped(below_threshold)`；`server-attachments` 注入 `isTaskPlanning`；`server.ts` 注入阈值。③ 测试：`plan-gate.spec.ts` 7 例、`intent-focus-runner.spec.ts` 门禁 4 例、`config.spec.ts` 门禁 5 例；后端 **124 files / 1690 tests** 全绿 |
| 2026-11-26 | v0.19 | 门禁口径落地与超时放宽 | 用户要求：① **默认阈值 0.4 落到真实 `config.yaml`**——此前只写在代码缺省值里，而语义是"缺键=关闭"，`agent-backend/config.yaml` 未写该键导致门禁实际关闭；现补 `plan_threshold: 0.4`（加载实测 `planThreshold=0.4`）。② 判定题面固化为"问题复杂、涉及多个对象或多个任务、也就是不是一步能完成"（`plan-gate.ts` 题面早已如此，本次只确认口径），并保留"同一动作查多对象算一个任务"。③ `plan_timeout_ms` 缺省由 2000 **提到 5000**：门禁与意图聚焦共用 laya，冷启动首包常超 2s，2s 会把正常判定打成超时并 fail-open（等于白花一次调用）；放宽只让判定更准，失败仍 fail-open，不增加最坏路径风险。落点：`config.ts` 缺省值 + `config.yaml` / `config.example.yaml` 同步；测试：`config.spec.ts` 缺省断言同步，门禁三份 spec **77 passed** |
| 2026-11-26 | v0.20 | 配置分层收敛（批次 1） | 审查发现"同一参数多真源 + 形态相关值写进共用文件"，先修致命项：① **`intent_focus.base_url` 支持 `$VAR` 引用**（原先只有 `api_key` 支持）——此前 `config.yaml` 两形态共用一份，容器里 `127.0.0.1:8103` 指向容器自身，意图聚焦与规划门禁在容器形态必然失效；现 yaml 写 `$INTENT_FOCUS_BASE_URL`，本地 `http://127.0.0.1:8103`、容器 `http://laya:8000`。② **compose 去掉 `environment` 覆盖**（`PUBLIC_BASE_URL` / `ADMIN_BACKEND_URL`）且 `env_file` 只留 `.env`——原先注入 `.env` + `.env.local`，后者的本地地址会把容器地址顶掉；`PUBLIC_BASE_URL` 不再硬编码在入库文件里。③ **`.env` 转为容器端私产**（`git rm --cached` + gitignore），恢复缺失的 `.env.example`（全量键 + 两形态对照，无密钥）。④ `DECIS_API_KEY` 纳入 `envSchema` 声明。测试：`config.spec.ts` 40 例（新增 base_url `$VAR` 解析与空值拒绝），本地实测 `baseUrl=http://127.0.0.1:8103` |
| 2026-11-26 | v0.21 | 配置收敛（批次 2~4） | 承接 v0.20 审查结论，把"一个参数一个真源"落实到代码：① **删除 5 个 `INTENT_FOCUS_*_THRESHOLD` 环境变量**（与 yaml 同名双真源，`config.spec.ts` 改为断言"遗留 env 不再生效"）。② **`MCP_TIMEOUT_MS` / `MCP_CONNECT_TIMEOUT_MS` / `LLM_MAX_RETRIES` / `LLM_RETRY_MAX_DELAY_MS` 迁入 `config.yaml` 的 `runtime` 块**（随工具语义与模型能力变，不是机器属性；`mcp_timeout_ms` 缺省取 90000 = 原部署值）。③ **`UPLOAD_MAX_MB` / `PREVIEW_MAX_MB` / `READ_TRUNCATE_KB` 降为代码常量**（`domain/limits.ts`；跨四侧契约与 `read_file` 返回语义）。④ **新增 `plan` yaml 块三项**（`timeout_ms` 20000 / `total_steps_max` 20 / `replan_max_per_run` 6，越界拒绝启动），经 `PlanLimits` + `DEFAULT_PLAN_LIMITS` 注入 `plan-orchestrator` 与 `advanceBatch.limits`，其余 13 项规划常量仍是算法不变量。⑤ **启动可观测**：`config.effective` 摘要（密钥不出现在摘要内）+ `config.unknown_env` 告警（拼错或已废弃的 env，不拒绝启动）。⑥ 管理端与 MCP 服务统一为"私产 `.env` + 入库 `.env.example`"，`admin-backend/.env`（含 AUTH_SECRET）移出索引。测试：`config.spec.ts` **43 例**（新增 runtime/plan 缺省、逐项生效、越界与矛盾、遗留 env 不生效、摘要不含密钥、拼错 env 检出共 6 例），后端 **124 files / 1694 tests** 全绿，`docker compose config` 通过 |
| 2026-11-27 | v0.22 | 规划资格收紧：无聚焦行为/函数不规划 | 用户要求：规划必须从聚焦行为或函数起算。**修订 FR-037** 新增聚焦能力前置——本轮至少直接命中一个本体行为或本体函数才允许规划；只命中技能（含非本体技能）而行为/函数全部未入选时 MUST 跳过规划并记 `plan.skipped(no_focus_capability)`，且 MUST NOT 再发起门禁判定（不白花一次 laya 调用）。该判据**不适用 fail-open**（`false` 是事实而非判定失败；缺席按允许处理）。落点：`intent-focus/runner.ts` 新增结果字段 `hasCapability`（无能力时跳过 `judgePlanGate`）、`plan-gate.ts` 新增纯函数 `planCapabilityBlocks`、`run-manager.ts` 新增 `AgentRunRequest.planEligible`、`run-consume.ts` 透传、`agent-factory.ts` 新增分流分支。测试：`plan-gate.spec.ts` +2 例、`intent-focus-runner.spec.ts` +2 例（含"只命中技能 → 不判门禁"），`agent-backend` `npm run gate` 全绿 |
| 2026-11-28 | v0.23 | 提示词三点硬要求 + 门禁口径翻转 | 用户拍板：① **段 1（角色）** 改写为三条硬要求——优先从意图聚焦的技能/行为/函数出发、每步 `coreAction` MUST 在可用工具清单中有唯一对应、MUST NOT 绕开清单自行规划行为；**段 6（输出格式）** 新增「多个彼此独立的对象即使动作相同也各占一步、禁止合并」「不得规划清单外的行为/服务/接口」，并说明超过 3 个对象先排前 3 步、剩余由滚动规划续批。② **FR-037 门禁口径翻转**：「同一动作查询多个对象算一个任务」改为「即使动作相同，只要对象不同也算多个对象 → 走多步规划」，`plan-gate.ts` 题面与 `criteria` 同步，废除原"批量查询算一个任务"口径。测试：`plan-gate.spec.ts` +1 例（断言"即使动作完全相同"且 `not.toContain('算一个任务')`）、`plan-prompt.spec.ts` +2 例（段 1 三条要求 / 段 6 单对象单步）。已知取舍：多对象任务会真实产生多轮执行往返（原设计的"负优化"权衡被用户明确推翻）。③ 段 2 措辞由「唯一起点」改为「首选起点」并与段 1「优先」对齐，段末声明 `coreAction` 不得越出可用工具清单；同步 `spec.md` FR-003 第 2 行与 `data-model.md` 示例。 |
| 2026-11-28 | v0.24 | 滚动规划授权提前结束 | 用户要求并采纳推荐措辞：`renderContinueInput` 的 roll 分支由「若仍有必要的后续步骤，输出 1~3 步；若任务已完成，输出 []」收紧为「仅当仍有必要的后续步骤时才输出 1~3 步；目标已完全达成时直接输出 []，不要为了凑步骤而新增无意义的动作」——既反向授权"够了就停"以对抗 LLM 惯性续排，又守住"必要步骤必须排"、避免过早终止（与 v0.23 的"多对象即多步"口径不冲突）。`failure` 分支与初始规划不受影响。测试：`plan-batch.spec.ts` 补断言。 |
| 2026-11-26 | v0.15 | 计划留档（`plan.jsonl`） | 新增 **FR-036**：每轮真正产出过步骤的计划追加一条过程事实到线程目录的 `plan.jsonl`，**只写不读、不参与上下文组装**、与 `history.jsonl` 物理分离；发点唯一（`terminate()`，软收尾之前），空轮不写；单线程保留最近 **100** 条（超限写临时文件 + 原子改名重写），同线程串行写；写入失败只告警（`plan.record.failed`），不影响对话。落点：新增 `src/domain/plan/store.ts`（`PlanStore`），`src/infra/plan-orchestrator.ts` 新增可选 `record` 回调，`src/infra/agent-factory.ts` 以工厂级 `PlanStore` 接线 |

---

## 附录：关键代码落点

| 能力 | 落点 |
|---|---|
| 计划留档（`plan.jsonl`，FR-036） | `agent-backend/src/domain/plan/store.ts`（`PlanStore`，唯一落盘点） |
| 规划资格（无聚焦行为/函数不规划，FR-037） | `agent-backend/src/domain/intent-focus/runner.ts`（`hasCapability`）+ `agent-backend/src/infra/agent-factory.ts`（`planCapabilityBlocks` 分流） |
| 全局工具串行（前置，已上线） | `agent-backend/src/infra/agent-loop.ts:176-194` |
| 工具装配与 `availableNames` | `agent-backend/src/infra/agent-factory.ts:207-393` |
| 规则闸门快照（`behaviorIndex`：`Map<归一裸名, bucket>`，命中判定 + `command` 布尔） | `agent-backend/src/domain/rule-gate/catalog.ts:89-116` |
| 缺前置函数判定 | `agent-backend/src/domain/rule-gate/gate.ts:118-142` |
| 写后失效 | `agent-backend/src/infra/tool-rule-gate.ts:141-144` |
| 统一失败标记 | `agent-backend/src/domain/tool-error.ts:38-59` |
| 本体装载（概念/关系/行为所属概念） | `agent-backend/src/domain/intent-focus/ontology-loader.ts:35-76` |
| 概念 → query 行为（取数口径） | `agent-backend/src/domain/intent-focus/concept-queries.ts:33-68` |
| 工具名归一 | `agent-backend/src/domain/ontology-doc.ts:49-70` |
| 软收尾 / 硬中止 | `agent-backend/src/domain/tool-suspension.ts:41-65` |
| pi 钩子定义 | `agent-backend/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:74-255` |
| pi 执行层工具查表（硬约束点） | `agent-backend/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:400-408` |
