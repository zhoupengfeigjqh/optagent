# 研究：意图聚焦指代改写（027）

**目的**：把规格中的关键实现选择钉死，并记录"为什么不用另一种做法"。全部结论基于仓库现状核查（非推测），引用到的文件均在本次阅读范围内。

---

## R1 指代判断用什么模型、什么题面

**决策**：复用既有 `LayaClient.decide`（`agent-backend/src/infra/laya-client.ts`），提交**单条** `noul` 命题，`qid = need_rewrite`；`state` = 本轮输入经 `prepareState`（尾部 200 字符、句首对齐）后的文本。

**理由**：
- 规格第 1、2 条要求"先用 Laya 做单条 true/false"；`noul` 恰是非题，且题目之间互不竞争（与技能 / 行为判定同口径）；
- `state.ts#prepareState` 已实现"尾部 200 字符 + 句首对齐 + truncated 标注"，直接复用可保证与既有判定口径逐字一致（宪章原则二"唯一实现"）；
- 直接调用 `decide` 而非复用 `BatchDecider`：改写判定只有 1 题、无分批需求；`BatchDecider` 的分批超时分配只会引入无意义的 100ms 扣减。

**备选与否决**：
- 用主对话模型做 true/false 判断 → 多一次 LLM 调用、输出不可结构化、失败面更大；
- 用 `choice` 多选 → 语义不对（这是二值判断，不是选择）。

**阈值**：`score > rewrite_threshold`（严格大于，等于不改写），缺省 0.8，环境变量 `INTENT_FOCUS_REWRITE_THRESHOLD` 优先。理由：`noul` 分数非归一化概率，0.8 是 2026-11 产品口径（与技能 / 行为同值），但语义不同故保留独立旋钮。

**实证约束**：`laya-client.ts` 的单题 `instructions` 建议 ≤25 字、`criteria` 用朴素措辞（实测加判据可显著拉开正负样本间隔）。命题文案据此设计（见契约 §3）。

---

## R2 改写用哪条链路、怎么取"当前模型"

**决策**：实现 `RewriteLlm` 端口（`agent-backend/src/infra/rewrite-llm.ts`），内部走既有 `LlmProvider.streamChat`：`tools: []`、`thinking: false`、自建 `AbortController` + 超时；模型由**本轮生效模型**决定（`StartRunOptions.model` → `ModelSelection`），未指定时用默认模型单例。

**理由**：
- 规格第 3 条"调用当前 LLM 模型"= 与本轮主对话同一模型；`run-consume` 已把 `opts.model` 传给 `agent.run`，同一份 `ModelSelection` 可直接传判定口；
- `server.ts` 已有 `llm()` 惰性单例与"请求级模型覆盖构造临时 provider"的既有逻辑（`agent-factory.ts` 的 `providerFor`）。把该函数提升为 `server.ts` 内共享实现并同时传给 `agent-factory` 与 `buildAttachments`，可保证两处模型解析**同源**（含测试注入 fake 的路径）；
- `streamChat` 是防腐接口（`contracts/internal-interfaces.md §1`），业务层不直连厂商 HTTP（宪章原则二 / 六）。

**备选与否决**：
- 新建独立 HTTP 客户端直连 DeepSeek → 违反"防腐接口"与"零新增依赖"，且会绕过重试口径；
- 复用 Agent 实例的 `run()` → 会挂工具、写历史、产卡片，直接违背"不落历史 / 只用于聚焦"。

**调用形态**：非流式聚合（收集 `content_delta`），不产生 SSE 事件、不进入 `run` 事件流；`error` 事件视为失败并降级。

---

## R3 改写素材怎么编码

**决策**：**单条 user 消息**承载全部素材，system prompt 固定输出约束；不把历史轮次作为多轮 messages 传入。

**理由**：
- 多轮 messages 会让模型倾向"接着对话"而不是"执行改写"，尤其在历史末尾是 assistant 回答时；
- 既有 `SummaryStore` 已用同一手法（`domain/summary.ts`：把 transcript 拼进一条 user prompt），行为可预期、易于单测；
- 素材边界更清晰：便于断言"只含最近 2 轮 + 当前输入、不含工具 / 思考 / 附件路径"。

**格式**（契约 §6，`FR-020` 验收已按此口径书写：`messages` 恒 1 条）：

```text
【最近对话】
用户：……
助手：……
（最多 2 组，按时间正序，缺失则省略该组）
【当前输入】
……
请把【当前输入】改写为不依赖上文即可独立理解的简洁表述，只输出改写结果。
```

**备选与否决**：多轮 messages + 末尾 user = 当前输入 → 模型可能直接回答当前输入（尤其当它是问句），失败率与污染风险更高。

---

## R4 历史轮次如何取"前 2 轮"

**决策**：读 `HistoryStore.readAll`，过滤 `status === 'failed'` 与空白正文，**从尾部向前配对** user + assistant，取最多 2 对，再按时间正序输出；只取 `role` / `content`。

**理由**：
- `history.jsonl` 本身不保存工具消息（`parseLine` 白名单只认 `role` / `content` 等，工具信息在 `tool-events.jsonl`），因此"不含工具"天然成立；
- `readRecent(…, n)` 只按条数截取，无法保证"完整轮次"（可能以 assistant 开头）；逆序配对可避免半个轮次；
- 失败轮可能只有 user 无 assistant，跳过它比留下半组更干净。

**备选与否决**：
- 用 `readRecent(4)` → 语义是"4 条消息"，不是"2 轮"，且可能截到半组；
- 拼接摘要 → 摘要不含逐轮原文，改写质量无保障且引入新依赖路径。

**已知代价**：每轮多一次 `history.jsonl` 读盘（KB 级）。已在 `plan.md` 复杂度跟踪登记，并明确"单次读盘、非循环内查询"，不构成 N+1。

---

## R5 插入位置与顺序

**决策**：在 `IntentFocusRunner.run()` 内，**`no_skills` / `no_focusable_skills` 两个早退之后、技能分批评分之前**执行改写阶段；此后所有 `decider.decideAll` 与留档使用改写后的 `state`。

**理由**：
- 规格 FR-004 / D6 要求"短路后、评分前"：无技能轮次本就没有聚焦产出，先判定再改写是纯浪费；
- 术语替换发生在**发送前**（`POST /api/term-normalize` + 用户确认），进入 `run-consume` 的 `opts.userMessage` 已是最终文本，因此"术语替换后"天然满足；运行期 MUST NOT 再触碰术语表（I-5）；
- 不改 `run-consume` 的调用位置，只改 runner 内部顺序，回归面最小。

**顺序（最终）**：

```text
意图聚焦开关 → skip → 未配置 → 读技能头部 / 本体索引
  → 无技能（empty/no_skills）→ 直接留档
  → 无可聚焦技能（empty/no_focusable_skills）→ 直接留档
  → 输入重写开关关闭？→ 跳过改写（state = 原文）
  → 指代判断（1 条 noul）→ false → state = 原文
                           → true  → 取历史 → 改写 → state = 改写（经 200 字截断）
  → 技能评分 → 行为评分 → 发散 → 提示铸造 → 留档
```

**备选与否决**：把改写放进 `server-attachments` 的 `judge` 外层包装 → 无法复用 runner 内的短路结论，会重新扫目录或重复判定开关。

---

## R6 预算与超时如何切分

**决策**：
- 阶段 `deadline = startedAt + config.timeoutMs`（缺省 10s，现有字段）；
- 指代判断超时 = `min(config.timeoutMs, max(MIN_REWRITE_JUDGE_MS, deadline - now))`，`MIN_REWRITE_JUDGE_MS = 300`；
- 改写超时 = `min(config.rewriteTimeoutMs, deadline - now - 100)`；若 < 300ms → 不发起改写，按原话继续（原因 `budget_exhausted`）；
- 判定与改写都**不重试**（与 Laya 口径一致）。

**理由**：保证整体不越过 10s 阶段预算；剩余预算不足时宁可放弃改写，也不让首字时间被拖长（SC-005）。100ms 余量留给后续技能评分，避免改写吃光预算导致聚焦本身失败。

**备选与否决**：固定 5s + 固定 3s 各自独立 → 最坏可叠加到 8s，再遇技能评分必然超预算。共享预算可避免叠加。

---

## R7 结果归一化与 100 字截断

**决策**（纯函数 `normalizeRewrite`）：
1. 去除首尾空白；
2. 去掉整段代码围栏（``` 包裹）；
3. 若首行是"改写为：/重写为：/输出："类前缀 → 去掉前缀；
4. 剥离首尾成对引号（`"` `“”` `'` `「」`）；
5. 多行时取**第一行非空**内容（多句改写以一行输出）；
6. 按**码点**截断到 100 个字符（`[...text].slice(0, 100)`），置 `truncated = 原文码点数 > 100`；
7. 归一后为空 → 视为失败（回退原话，原因 `empty_output`）。

**理由**：100 字按字符计（与 200 字符截断同口径）；用 `slice` 会切开代理对（emoji / 生僻字），项目既有 `clip` 已采用码点口径（`soul.ts` 的 `clip`）。不强制问句（用户 2026-11-19 明确）。

**备选与否决**：
- 截到 100 加省略号 → 实际有效内容仅 99 字，且与"≤100 字"断言口径不一致；
- 保留多行 → 判定素材出现换行噪声，且记录字段含换行不便检索。

---

## R8 留档字段与兼容

**决策**：`IntentFocusRecord` 追加（可选字段，铸造时恒写）：

| 字段 | 类型 | 缺省 | 含义 |
|---|---|---|---|
| `need_rewrite` | boolean \| null | `null` | 判定结论；`null` = 未执行（关 / 跳 / 短路 / 未配置 / 降级） |
| `rewrite_score` | number \| null | `null` | 单条命题分数 |
| `rewrite_query` | string | `''` | 改写结果；空 = 未改写 |
| `rewrite_truncated` | boolean | `false` | 改写结果是否被 100 字截断 |
| `rewrite_ms` | number \| null | `null` | 改写（含判定到改写完成）耗时 |
| `rewrite_history_turns` | number | `0` | 实际参与的历史轮次数 |
| `rewrite_reason` | string \| null | `null` | `below_threshold` / `llm_failed` / `empty_output` / `budget_exhausted` / `switch_off` / `no_history` |

**理由**：
- 规格 FR-040 要求四形态（真 / 假 / 未执行 / 失败）都能区分；`need_rewrite=null` + `rewrite_reason` 可表达；
- 字段**可选**是为了让存量记录（无这些键）仍能被 `readAll` 解析，且既有 `record.spec` 夹具不必全量改写；新记录由 `buildRecordDraft` 恒写，保证"每轮都有"；
- `input` / `input_truncated` 语义不变（仍是**送入判定的原始文本**），改写结果单列 `rewrite_query`，避免分析时把两者混淆。

**备选与否决**：把 `input` 改成改写后文本 → 会破坏既有分析口径（"用户说了什么"与"聚焦看到了什么"必须可区分），也违背"不改既有字段语义"（FR-033）。

---

## R9 管理侧两个开关如何落地

**决策**（`admin-backend/src/domain/config-center/soul-design.ts`）：
- `SoulDesign` 增 `input_rewrite?: boolean`、`term_normalize?: boolean`；
- `normalizeSoulDesign`：`readBool` 拒绝式（键缺失 = false；非布尔 → `VALIDATION_FAILED`）；**不随 `intent_focus` 收敛为 false**（关闭时值保留）；
- `renderSoulMd`：`intent_focus === true && input_rewrite === true` 才写 `input_rewrite: true`；`term_normalize` 同理；
- `withSoulDefaults`：非布尔收敛到 false，纳入变更检测；
- `emptySoulDesign` 显式落 `false`（与前端 `JSON.stringify` 脏检查同形）。

**理由**：与 007 / 013 / 019 完全同范式——"未搭配的内容不残留"、"关闭时数值保留、管理台置灰"。区别在于 007 的 `next_action_hints` 是**运行期依赖**（归一化时被强制收敛为 false），而这两个是**运行期也要求 AND**，但设计态值必须保留以便再次开启；故只在物化时施加 AND，不在保存时清空。

**备选与否决**：
- 保存时把值清成 false → 管理员关闭一次意图聚焦就丢配置（019 明确否决过同类做法）；
- 只在前端施加 AND → 绕过前端直接调 API 就能写出"意图聚焦关着但开关为 true"的配置，运行期语义会漂移。

---

## R10 术语替换闸门与前端零改动

**决策**：`agent-backend/src/routes/term-normalize.ts` 的 `enabled` 改为 `isIntentFocusEnabled(...) && isTermNormalizeEnabled(...)`；前端 `useTermNormalize.review` 不动。

**理由**：
- 前端本来就"无脑预检"，`applied:false` 时直接按原话发送、无弹窗（`useTermNormalize.ts` 第 106 行）；开关关闭只需服务端返回 `applied:false`；
- 闸门只有一处（端点），避免前端与服务端各判一次产生"前端弹了、服务端没替换"的错配（TR-08 / I-5）；
- 关闭时 MUST NOT 读术语文件：`enabled=false` 分支在 `loadTermTable` 之前返回，天然满足。

**备选与否决**：
- 前端先查 SOUL 开关再决定是否预检 → 需要新增接口字段 / 缓存，且与"服务端为唯一判定点"冲突。

---

## R11 如何保证"原话零污染"

**决策**：改写结果只作为 `run()` 内的局部变量 `focusState` 使用；`IntentFocusInput.userInput` 只读；`run-consume` 的 `prompt.messages` / `storedUserMessage` / `systemExtra` 不接收任何改写文本；留档单独字段。

**理由**：
- 单一事实源：`opts.userMessage`（术语替换确认后）是唯一用户输入；
- `IntentFocusRunner.judge` 的返回类型只有 `{ prompt, toolTips }`，结构上就**无法**回传改写文本（不需要额外的防御性检查）；
- `record` 与会话历史物理分离（`intent-focus.jsonl` vs `history.jsonl`），且记录无运行期读取方。

**验证**：集成测试断言：本轮 `history.jsonl` 的 user 行 === 请求 `content`；SSE 与详情接口文本不含改写内容；`systemExtra` 提示只含五元组 / 技能说明（既有格式），不含改写原文。

---

## R12 测试如何注入（不依赖真实服务）

**决策**：
- 判定：`DecideClient` 结构子集（既有 `batch-decider.ts` 的口径）以对象桩注入 `IntentFocusRunnerDeps.client`；
- 改写：`RewriteLlm` 端口以桩注入；`agent-backend` 侧单独为 `infra/rewrite-llm.ts` 用假 `LlmProvider`（`streamChat` 返回 `content_delta` / `error`）测聚合、超时、无工具；
- 历史：直接写临时目录的 `history.jsonl`（集成）或注入 `readHistory` 桩（单元）；
- 管理端：`admin-backend` 用既有 service 夹具；`admin-frontend` 用 `mount(SoulEditor)`。

**备选与否决**：真实 Laya / 真实 DeepSeek → 不稳定、慢、需要 key；既有 013/016 已全部用桩，保持一致。

---

## R13 三开关组合矩阵（验证口径）

| 意图聚焦 | 输入重写 | 术语替换 | 指代判断 | 改写 | 术语替换 | 说明 |
|---|---|---|---|---|---|---|
| 关 | 任意 | 任意 | 0 | 0 | 0 | 本特性与替换整体不存在 |
| 开 | 关 | 关/开 | 0 | 0 | 仅开关开时执行 | 只保留替换能力 |
| 开 | 开 | 关 | 1 | 按判定 | 0 | 改写基于用户输入原文 |
| 开 | 开 | 开 | 1 | 按判定 | 按命中 | 改写基于替换后文本 |

术语替换发生在**发送前**，因此上表"术语替换"一栏与判定 / 改写的先后是：替换（并确认）→ 判定 → 改写 → 评分。

---

## 未解决项

无。规格中的 `[NEEDS CLARIFICATION]` 已在 clarify 阶段清零；本文件所有决策均落到具体文件与接口，可直接进入实施。
