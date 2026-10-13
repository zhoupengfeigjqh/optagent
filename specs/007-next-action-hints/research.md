# 007 技术研究：下一步动作提示卡片

- **特性标识**：`007-next-action-hints`
- **日期**：2026-10-12
- **前置**：`spec.md`（三项待澄清已收敛）、`.specify/memory/constitution.md` v2.2.0
- **结论**：全部技术未知项已收敛，无需新增任何第三方依赖（宪章原则六）。

---

## 0. 需求的三个硬约束如何决定方案

| 约束（来自 spec） | 对方案的直接决定 |
|---|---|
| FR-007：生成 MUST NOT 阻塞/延迟本轮回答的完成与渲染 | 生成只能是**轮末一次独立的 fire-and-forget 调用**，不能塞进主回答的模型循环，也不能拖住 `done` 事件 |
| FR-011：引导句由**界面固定渲染** | 展示层只消费"卡片的提示词列表"，不消费任何模型生成的引导句 |
| FR-013/FR-024：卡片文本可见、关联工具不可见且要作为隐藏引导 | 模型输出必须是**结构化结果**（文本与工具引用分离），并复用 004 的隐藏引导通道 |

---

## 1. 技术决策

### D1 生成时机与执行体：轮末独立一次 LLM 调用（照搬 `SummaryStore` 范式）

- **决策**：`RunManager.finalizeDone` 在"消息与工具记录已落盘、`done` 已广播"之后，`void` 触发一次独立生成；生成使用**默认模型**（`llm()` 惰性单例），不带工具、不走 agent loop。
- **理由**：
  1. 现状先例唯一且同构——`summary.ts:88-94` 的 `trigger()`：per-thread `Map<string, Promise>` 串行链 + `AbortController` 超时 + `catch` 只记日志，**永不 reject、永不阻塞对话**；
  2. 主回答循环（`agent-loop.ts`）是"带工具的多跳循环"，把卡片塞进去会污染正文流、事件流与 token 记账；
  3. 放在 `done` 之后触发，天然满足 FR-007（`done` 已先发出，前端已可渲染完整答案）。
- **落点**：`finalizeDone` 末尾紧随既有 `void this.deps.summary?.trigger(...)`（`run-manager.ts:451-452`）。
- **模型选择**：与摘要同口径用默认模型，不跟随请求级 `model` 覆盖——本功能是附加能力，MUST NOT 为它构造临时 provider（避免为附加能力增加实例化路径）。

### D2 输出形态：严格 JSON（`{actions:[{prompt,tools}]}`），失败即空

- **决策**：生成只接受结构化 JSON；解析与形态卫生照搬 `view-links.ts:75-90` 的口径——非法 JSON / 超长 / 形态不符一律返回空，**不抛错、不打日志**。
- **理由**：卡片必须同时承载"可见文本"与"不可见工具引用"，两者只有结构化才可稳定分离；自然语言 + 括号注释的写法无法可靠剥离（而工具英文名一旦留在文本里就直接违反 FR-003）。
- **容错**：容忍模型常见的 ```` ```json ```` 代码块围栏与顶层裸数组；其余形态一律丢弃。

### D3 可用工具清单来源：复用 `runWith` 已装配的工具集（唯一来源）

- **决策**：`infra/agent-factory.ts` 的 `runWith` 在装配完 `tools`（内置 + MCP，`AgentTool` 自带 `description`）之后，把 `{ name, description }` 摘要写入 `AgentRunRequest` 上由 run-manager 提供的可变槽位；`finalizeDone` 把它交给生成。
- **理由**：
  1. **工具装配只有一处**（原则二）。若让 domain 层自行枚举 MCP 工具，就要再次 `mcp.listTools()` + 白名单过滤 + 可用性判定，必然与装配处漂移；
  2. MCP 工具的 `description` 只有 `listTools` 才知道，静态配置（`MCP.json` 的 `allowed_tools`）拿不到描述，自行枚举会**静默丢掉用途摘要**（违反 FR-002）；
  3. 该槽位是"出口参数"，不改变既有装配语义，也不改变 `LlmEvent` 联合类型（比新增内部事件更小的改动面）。
- **退化**：直聊分支（`tools.length === 0`，非 pi provider 或无工具）槽位为空 → 生成仍进行，但工具引用一律判定越界被丢弃（等价于"只能给不关联工具的建议"）。

### D4 已调用工具来源：`RunImpl.calledTools`

- **决策**：在 `run-manager.consume` 的 `tool_call_start` 分支把工具名加入 `run.calledTools: Set<string>`。
- **理由**：`run.toolCalls` 是"进行中调用"的活表，`tool_call_end` 即删除，轮末已空；改读 `tool-events.jsonl` 虽可行（`flush` 先于 `done`），但引入一次额外 IO 与解析，而"本轮调过哪些工具"本就由运行期事件流具备。

### D5 存储形态：会话级单快照 `next-actions.json`，覆盖写 + 原子改名

- **决策**：`threadDir(root,userId,threadId)/next-actions.json`，内容
  `{ message_id, agent_name, created_at, actions:[{prompt,tools,guidance}] }`；
  写盘走"临时文件 + `fs.renameSync`"（同 `routes/files.ts:267` 的上传落定写法），失败保持旧快照并告警。
- **理由**：FR-015/FR-017/FR-018 要求"只展示最新一轮、刷新不丢、存储有界"——**单文件覆盖**就是这三条的最简实现（无需按轮追加、无需回收历史）；原子改名满足原则五（状态变更原子替换，MUST NOT 部分提交）。

### D6 轮开始清空，且 `clear` MUST 与 `trigger` 同链

- **决策**：`startRun` 触发一次 `nextActions.clear(userId, threadId)`；`clear` 与 `trigger` 走**同一条 per-thread 串行链**。
- **理由**：清空若不入链，会出现"第 N 轮的 `trigger` 仍在飞、第 N+1 轮的 `clear` 先执行，随后第 N 轮把过期快照写回"的竞态——用户会在新一轮流式中看到上一轮卡片（违反 FR-015 与边界情况"流式未结束不得出现卡片"）。入链后顺序恒为「N 轮写入 → N+1 轮清空」。
- **附带收益**：清空同时覆盖三条边界——新一轮开始时旧卡片立即消失、失败轮/中断轮不留卡片、用户在两轮之间抢发消息不会看到过期引导。

### D7 下发通道：新增轻量端点 + 有界拉取（不改 SSE、不改详情接口）

- **决策**：
  1. **新增** `GET /api/threads/{id}/next-actions`（读快照 + 按当前开关判定 + 用户隔离）；
  2. 前端在"本轮完成"与"进入/切换会话"两处调用它；
  3. 本轮完成后的拉取窗口为 `[0, 1500, 3500, 6000]` ms（**最后一次 MUST 晚于生成超时上限**），任一命中即停，全部为空即不展示；
  4. `POST /api/threads/{id}/messages` 的 SSE 事件与 `GET /api/threads/{id}` 的响应形状**零变更**。
- **理由**：`done` 到达时生成必然还没开始（FR-007 决定了顺序），因此"轮末补出"只能靠一次有界的读取；独立轻量端点避免为重拉 50 条消息而扩容详情接口，也把契约面收敛到一个小接口（跨侧同改成本最低）。**不存在任何加载态**（FR-007/FR-014），失败即"这一轮没有建议"。
- **过期响应防护**：拉取按 `threadId + 请求序号` 丢弃过期响应（用户在新一轮里切会话或抢发时，旧请求的结果不得渲染）。

### D8 可见性判定在服务端 + 客户端各一道，判据唯一

- **决策**：服务端按**双判据**返回——「快照存在 ∧ 快照归属数字人的当前开关为开」∧「**快照归属数字人 = 当前选中数字人**」；客户端再按 `message_id` 必须等于当前消息列表中的该条消息 id 才渲染。
- **理由**：
  1. 服务端的开关判定是 FR-034（关闭后连已持久化快照也不得展示）的唯一实现；
  2. **第二条判据是"跨数字人越权"的唯一兜底点**（FR-019 / SC-011）：会话**不绑定**数字人、可跨数字人（`thread-store.ts` 的 FR-014 修订），而 `guidance` 由发送端铸造、`run-manager` 接收端原样注入且不校验 ⇒ 若不判，就会出现"用数字人 A 的卡片把 A 的工具名注入数字人 B 的一轮"。放在读取期而非点击期，是因为"点击 → 发送"之间服务端没有介入机会；
  3. 客户端的 `message_id` 匹配是"竞态兜底"（快速连发时旧快照不得挂到新气泡下）。
  三者是不同职责，不构成重复实现。

### D9 提示词合规判定：一处纯函数

- **决策**：`isCompliantPrompt(text, toolIds)`（纯函数，唯一实现）丢弃规则：
  1. trim 后为空；2. 长度 > **50**（按 Unicode 码点计，中文 1 字）；3. 命中任一工具标识符（`name` / `exposed_name` / MCP 服务名，大小写不敏感的子串匹配）；
  4. 含 `snake_case` / `kebab-case` / `CamelCase` 形态的标识符 token（正则判定，"工具英文名"的可判定形态）；5. 与已接受条目重复。
- **理由**：用户要求"严格遵守全部中文、不要工具英文名"。第 3 条是**精确可判定**的硬门禁（工具名一律不得出现）；第 4 条兜住"模型自造标识符"与英文缩写；**不**采用"禁止任何拉丁字母"，否则会误杀"Excel 文件"这类合法中文表述。
- **工具引用校验**：`toolExposedName(ref)`（复用 `soul.ts:101-103`）必须命中本轮可用工具清单，否则丢弃**该引用**、保留卡片文本（spec 边界情况）。
- **引导文案**：复用 `buildStarterGuidance`（`soul.ts:111-115`）——与问题实例**同一实现、同一文案**（FR-024 要求"功能与之一致"）；超 **500 字**（`POST .../messages` 的 `guidance` 上限）时丢弃引导、保留卡片文本。

### D10 产出条数与降级

- **决策**：最多 3 条（FR-043）；单次生成超时上限 **5 s**、最多 1 次尝试、无重试（FR-008）；任何失败 → 空结果 + 一条结构化告警（`{ alert: true, event: 'next-actions.failed', scope: 'system' }`，经 `createThrottledWarn` 合并），MUST NOT 影响本轮回答与历史（FR-040~FR-042）。
- **理由**：原则九（降级可感知、原始错误可观测、重试超时有界、降级路径有测试）；`summary.ts` 的 `logger.warn` + `createThrottledWarn`（`routes/agents.ts:23` 先例）是既有口径。
- **时延口径**：生成超时 5 s、前端最后一次拉取 6 s ⇒ **最迟 6 s 内用户一定能确定"有没有建议"**。`spec` 的 SC-001 已按同一口径写明：界面**不存在加载/占位态**（悬而未决态出现率 0%）＋生成成功时 **P90 ≤ 5 s** ＋最迟 **6 s** 可确定有无提示（analyze M1 修订，消除"规格写 5 s、实现最迟 6 s"的口径漂移）。

### D11 开关落点：SOUL 结构化配置的一个布尔字段 → SOUL.md frontmatter 新键

- **决策**：设计态 `SoulDesign` 新增 `next_action_hints: boolean`（缺省 `false`）；物化时**仅在为 `true`** 时写 frontmatter 键 `next_action_hints: true`（沿用"不写空壳键"口径）；运行环境 `parseSoulMeta` 读取该键 → `SoulMeta.nextActionHints`，并提供 `isNextActionsEnabled(root,userId,agentName)`（读 SOUL.md → 判据失败/异常一律 `false`，fail-closed + 告警）。
- **理由**：
  1. 用户要求开关放在"数字人管理里的 SOUL 里"，按数字人粒度 —— 正好是 SOUL 结构化配置的位置；
  2. frontmatter **不进 System Prompt**（`stripFrontmatter` 已保证）⇒ 自动满足 FR-035（开关不改变人格提示词语义）；
  3. 缺省 `false` ⇒ 存量数字人零行为变化（FR-031）；关闭态不写键 ⇒ 部署"整体覆盖"后运行环境不会残留开启配置（FR-033）。
- **判据复用**：`normalizeSoulDesign` 的拒绝式校验链（`readRequiredText` / `readTextList` 同族）新增 `readBool`：缺省 `false`，**给了非布尔值即报错**（把 typo 挡在保存期，与既有字段同口径）。

### D12 前端放置与复用：新模块承载状态，`onTurnFinished` 是唯一挂钩点

- **决策**：
  1. 新 composable `useNextSteps.ts`（`createNextStepsStore` + `useNextSteps()` 注入访问器），在 `useAppSession.ts` 里装配并 `provide`；
  2. 挂钩点是**既有的** `onTurnFinished`（`useAppSession.ts:184` 现为 `() => threads.refresh()`），改为"刷新会话 + 启动一次拉取窗口"；
  3. 卡片视觉抽成 `SuggestionCard.vue`，**首页问题实例与消息尾部共用**（`data-test` 由使用方传入）；
  4. 点击 → 复用 `common/ConfirmDialog.vue` → 复用既有 `onSend`（含 `guidance` 隐藏通道）。
- **理由**：`useChatStream.ts` 已 **496 行**（贴近 ≤500 硬门禁）→ MUST NOT 在其中新增状态；`onTurnFinished` 语义正是"一轮结束后的善后"，且 `useAppSession.ts` 仅 254 行，余量充足。卡片与问题实例共用组件是 FR-012/TR-04 的最小实现（原则二"同一职责唯一实现"）。
- **数据形状复用**：卡片 = `{ prompt, tools: AgentStarterTool[], guidance: string }`，与 `AgentStarter`（`api/types.ts:58-74`）**逐字相同** ⇒ 前端零新类型语义、发送载荷与 `onStarterClick` 完全同款（Q3 的"功能完全一致"）。

---

## 2. 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 把"引导句 + 卡片"放进主回答的同一次模型调用（输出末尾附加结构化块） | 需要从**用户可见的流式正文里剥离**尾部结构块（流式截断边界不可靠）；一旦剥离失败就把 JSON 暴露给用户；且生成时机被绑在回答完成前，与 FR-007 冲突 |
| 把生成放进 `agent-loop`，在 `done` 前 `await` 生成（卡片随 `done` 一次性下发） | 会**推迟 `done`** 最长 5 s：正文已流完却仍在显示"生成中"，等于把附加能力的失败/时延转嫁给主回答收尾（FR-007 明确禁止） |
| SSE 连接在 `done` 后**不关闭**，用 `next_actions` 事件补推 | 需要改 `routes/chat.ts` 的 `done → reply.raw.end()` 与前端"读到 EOF 才算结束"的口径；生成是 run 之外的火忘调用，拿不到 reply 引用 ⇒ 会引入跨层耦合；契约与断连语义风险大于收益 |
| 只拉一次（`done` 后延迟 2 s） | 无重试的固定延迟命中率低（生成时延抖动），且"晚 2 s 也没到就永远没有"对用户不可解释；有界多次拉取（末次晚于超时上限）才与超时上限自洽 |
| 卡片数据随 `GET /api/threads/{id}` 下发（002 的 `tool_calls` 侧车范式） | 该接口是重载荷（消息页 + 工具记录），本功能需要的是"轮末再问一次"，复用它会为一次小读取付出整页重取；且会改动既有响应形状，扩大回归面（本次按最小契约面处理） |
| 轮末让 domain 自行枚举 MCP 工具（`mcp.listTools` + 白名单） | 与 `runWith` 的装配判据**双份实现**（原则二），且需要 domain 反向依赖 infra 的 `McpManager`；一旦白名单/可用性口径变更就会漂移 |
| 用 Markdown 列表 + `（工具：read_file）` 承载工具引用 | 工具英文名会直接进入可见文本 ⇒ 违反 FR-003；且靠正则从自然语言里剥离工具名不可靠 |
| 卡片按轮追加落盘（历史轮保留） | 与 Q2 结论（仅最新一轮）冲突，且需要"清理与回收"策略；单快照覆盖是最简且存储有界 |
| 引入 Popover / 卡片动画库 / 提示词模板引擎 | 平台原生 `<button>` + 既有 CSS 变量已足够（原则六：能不加依赖就不加） |
| 开关独立成 `suppress.json` 之类的新配置文件 | 用户明确"放在 SOUL 里"；新配置文件还会引入"未部署/未搭配即残留"的一致性风险（与平台唯一权威源的口径冲突） |

---

## 3. 与既有契约/不变式的相容性核对

| 项 | 核对结论 |
|---|---|
| 平台 → 运行环境单向、以数字人为单位整体覆盖 | **不破坏**：开关作为 SOUL 结构化字段随物化下发；关闭态不写 frontmatter 键 ⇒ 部署后无残留（FR-033） |
| SOUL frontmatter 不进 System Prompt | **不破坏**：`stripFrontmatter` 未改；FR-035 的快照测试守住"开关开/关的 System Prompt 逐字一致" |
| 用户消息气泡与历史不含隐藏引导 | **不破坏**：`guidance` 仍走既有 `systemExtra` 通道（不落盘、不进历史）；卡片数据落在**独立快照文件**里，不进 `history.jsonl` |
| 回答正文、工具记录、视图入口展示逐字不变 | **不破坏**：新增渲染仅追加在 `MessageViewLinks` 之后；`I-1`/`I-2` 由回归用例守住 |
| 发送链路唯一 | **不破坏**：卡片发送复用 `useChatPanel.onSend`（与 `onStarterClick` 同一入口） |
| 既有 496 行的 `useChatStream.ts` | **不触碰**：挂钩点改在 `useAppSession` 的 `onTurnFinished` |
| 既有 `run-manager.ts`（477 行） | 本次新增约 29 行会**超过 500 行硬门禁** ⇒ 按 D13 拆分（见 `plan.md` §1 D13 与复杂度跟踪） |
