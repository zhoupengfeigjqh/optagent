# 实施计划：多步任务规划与滚动执行（028）

- **分支**：`main`（本仓库未注册 `before_plan` git 钩子，未新建特性分支；规格目录为权威落点）
- **日期**：2026-11-25
- **规格**：[spec.md](./spec.md)
- **数据模型**：[data-model.md](./data-model.md)
- **任务清单**：[tasks.md](./tasks.md)
- **输入**：`specs/028-task-planning/spec.md`
- **说明**：本计划基于现有 `agent-backend` 技术栈；**不新增依赖、不新增对外端点**。SSE 仅在 P6（计划进度，v0.12）新增一个 `plan_progress` 事件，其余阶段零新增事件。

## 摘要

在意图聚焦之后、agent loop 之前插入一个**滚动规划阶段**：当「意图聚焦」「任务规划」双开关皆开时，用本轮生效的对话模型（`tools: []`、非流式）产出 1~3 步的计划 JSON；后端做归一化（解析完整工具名、推导 `type` 与 `dependTools`、分配跨批 `seqId`）与六条硬校验；通过后进入执行。

执行阶段**保持单 agent**，通过 pi 的四个钩子实现「按步收窄工具集 + 客观完成判定 + 滚动与失败重规划」：

| 钩子 | 作用 |
|---|---|
| `prepareNextTurn` | 切换 `context.tools` 为当前步可见集合；注入计划快照（原地替换） |
| `afterToolCall` | 只记录调用事实，不改状态 |
| `shouldStopAfterTurn` | 三态归类 + 完成判定 + 出队/推进/终止（唯一状态转移点） |
| `getFollowUpMessages` | 计划未完成但模型停手时续跑 |

**硬边界**：计划与进度不落盘、不跨轮、不进历史；`command` 合规审核仍由 `021` 唯一负责；`systemPrompt` 在 run 内保持不变。

## 技术上下文

**Language/Version**：TypeScript（ESM）/ Node.js ≥ 20。

**Primary Dependencies**：
- `@earendil-works/pi-agent-core` 0.85.1（`runAgentLoop` 的 `AgentLoopConfig` 钩子：`transformContext` / `beforeToolCall` / `afterToolCall` / `shouldStopAfterTurn` / `prepareNextTurn` / `getFollowUpMessages`）
- 既有 `LlmProvider.streamChat`（规划调用复用，`tools: []`、`thinking: false`）
- `yaml` 2.9（本体文件，既有）
- `zod` 4（配置校验，既有）
- **无新增依赖**

**Storage**：
- 运行时：无新增落盘。计划状态为 run 级内存对象，轮末随工具数组丢弃。
- 设计态：SOUL frontmatter 新增 `task_planning`（仅 true 时写键）；平台设计态 `.platform-data/agents/{name}.json` 的 `soul` 增同名布尔键。
- 无迁移脚本：缺键即 false，读写两侧同一 fail-closed 口径。

**Testing**：
- 后端：Vitest；`npm run test`（单元）、`npm run test:integration`、`npm run test:coverage`、`npm run gate`
- 管理端：Vitest（`SoulEditor.spec.ts` 同名同目录）
- 不依赖真实 LLM：规划器与工具均以桩注入
- **测试只在宿主机本地跑**，容器不承担测试（宪章原则三）

**Target Platform**：Linux 容器（部署）/ Windows 本地开发（中文路径，全部走 `node:path`）。

**Project Type**：多端 Web 应用。

**Performance Goals**：
- 规划调用单次 ≤ **20 秒**（`PLAN_TIMEOUT_MS`；2026-11-26 由 5s 提高，**超时即放弃、不重试**）
- 首字延迟增量：仅首轮规划时 P90 ≤ 3 秒；每次重规划 ≤ 1.5 秒
- 执行阶段端点 P95 承诺不变（规划为内存与一次 LLM 调用，不改端点结构）
- 单步工具集裁剪为 O(n) 过滤，`n` = 本轮工具总数（< 100）

**Constraints**：
- 规划 MUST 在工具装配之后（`guarded` 生成于 `agent-factory.ts:373~383`，`runAgentLoopEvents` 调用在 `:444~452`；**规划插入点即这两者之间**）
- `availableNames` 保持全量，不随步收窄
- 只过滤 `guarded`（已包装工具），不过滤裸 `tools`
- 不换 `systemPrompt`（KV-cache）
- 单文件 ≤ 500 行（新增模块）
- 新增模块语句覆盖率 ≥ 80%
- 不修改 `domain/rule-gate/*` 与 `infra/tool-rule-gate.ts` 的判定分支

**Scale/Scope**：
- 单批计划 1~3 步；整轮 ≤ **20** 步、≤ 6 次**失败重规划**（正常滚动不单独设限，只受总步数约束）、每批 ≤ 2 次规划重试。队列耗尽时发起滚动规划，返回 `[]` 即任务完成；首次规划返回 `[]` 则交回主对话
- `doneSummary` ≤ 5 条 × 80 字
- 计划快照 ≤ 1200 字符
- 规划输入历史固定最近 3 轮（仅正文，不含工具结果）

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项 MUST 在「复杂度跟踪」说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文文档与规格驱动 | 通过 | 规格、计划、数据模型、任务清单全中文并含修订记录；实施时回写 `021`（串行前置）与本特性契约；**已按宪章待办第 1 项给出存量补测结论**（见「存量补测结论」小节） |
| 二、代码质量与模块化 | 通过 | 纯函数集中在 `domain/plan/*`（`normalize` / `check` / `state` / `prompt`），IO 与钩子集中在 `infra/plan-orchestrator.ts`；`agent-factory.ts` 只加装配调用（存量已超 500 行 → 见复杂度跟踪） |
| 三、测试完备性 | 通过 | 纯函数同名 spec；编排层用桩覆盖；覆盖率目标 ≥ 80%；宿主本地执行；**平台差异风险已登记于复杂度跟踪** |
| 四、无障碍 | 通过 | 管理端新增复选框复用既有 `soul-editor__switch`（原生 checkbox + 整行 label）；`disabled` 语义与说明文案须在组件 spec 覆盖键盘与读屏断言 |
| 五、性能与一致性 | 通过（有预算） | 规划调用受 20s 硬超时（`Promise.race`）与"超时不重试"保护，最坏等待有界；状态转移在单个钩子内原子完成；不新增 N+1（本体索引带 mtime 缓存） |
| 六、依赖治理 | 通过 | 无新增依赖；不复用 `harness/*` 高层运行时 |
| 七、接口契约两侧同改 | 通过（无新增端点） | 不新增 HTTP 端点与 SSE 事件；内部契约在 `data-model.md` 登记；管理端 SOUL 字段两侧同改 |
| 八、测试部署简单可控 | 通过 | **四侧各自单命令门禁**（`agent-backend` → T801；`admin-backend` / `admin-frontend` → T801a）；不新增部署步骤；规划关闭时与现状零差异 |
| 九、优雅降级与故障可观测 | 通过 | 规划任一环节失败回退既有流程；结构化日志事件见 data-model；不记录工具结果正文 |

## 存量补测结论（宪章待办第 1 项）

宪章文首待办要求：`frontend` 的 `src/api/**`（7 个）与 `src/composables/**`（13 个）共 20 个 0% 模块，其**补测顺序与范围 MUST 在下一个特性的 `plan.md` 给出结论**。本特性即为该"下一个特性"，结论如下。

| 项 | 结论 |
|---|---|
| 本期是否补测 | **否**。本特性 `frontend` 零代码改动（见 `contracts/README.md` §1），补测与本特性验收无因果关系 |
| 是否发起专项 | **否**。宪章「治理 § 适用范围与不追溯」明文 MUST NOT 组织回溯性补齐专项 |
| 顺序（未来若做） | ① `src/composables/useWorkspace*`（三个视图共用、改动最频繁）→ ② `src/api/*`（契约面，须与契约文档同改）→ ③ 其余 composables |
| 范围（未来若做） | 只补「当次需求实际改动到的模块」，逐特性携带；MUST NOT 一次性批量补齐 20 个 |
| 触发条件 | 任一后续特性改动上述模块时，该模块的补测 MUST 随该特性一并交付并计入当次验收 |

## 模块划分

### 新增（`agent-backend`）

```
src/domain/plan/
  types.ts            PlanState / PlanStep / StepStatus / 三态 / 配置常量
  prompt.ts           规划专用 system prompt 与输入素材装配（纯函数）
  parse.ts            LLM 原始输出 → RawStep[]（容错解析，纯函数）
  normalize.ts        完整名解析、type 推导、dependTools 推导、seqId（纯函数）
  check.ts            六条硬校验（纯函数）
  state.ts            状态机：三态归类、完成判定、推进、指纹、终止（纯函数）
  snapshot.ts         计划快照渲染 + 原地替换 + 行级截断（纯函数）
  ontology-facts.ts   本体事实索引（概念 → 行为、函数 → 关联概念），带 mtime 缓存

src/infra/
  plan-orchestrator.ts  规划调用 + 4 个钩子 + 状态持有（唯一含 IO 与日志的层）
```

每个 `domain/plan/*.ts` 同目录同名 `.spec.ts`；`infra/plan-orchestrator.ts` 用桩 LLM 与桩工具覆盖。

### 修改（`agent-backend`）

| 文件 | 改动 | 约束 |
|---|---|---|
| `src/infra/agent-loop.ts` | 透传 4 个可选钩子（由 `opts` 传入，缺省不挂） | 不改变现有 `afterToolCall` 语义；串行配置不动 |
| `src/infra/agent-factory.ts` | 装配后调用 `createPlanOrchestrator`；把钩子传给 `runAgentLoopEvents`；开关读取 | 不改工具装配顺序，不改 `availableNames` 计算 |
| `src/domain/rule-gate/`（端口） | 新增只读查询：按工具名返回 `op_type` 与前置 `related_functions` | 只读，不改判定；不得让 `tool-rule-gate.ts` 出现本体字段名 |
| `src/domain/soul.ts` | 读取 `task_planning` 开关（与 `intent_focus` **同一落点**：SOUL frontmatter 布尔键，`record.task_planning === true`，经 `readSoulField` 逐次读盘） | fail-closed；`config.ts` 只放数值阈值，MUST NOT 在此新增布尔开关 |

### 新增（`frontend`，方案 B：计划进度可见性）

```
src/components/chat/
  PlanProgressBar.vue       单行进度条（纯展示，props 只有 progress）
  PlanProgressBar.spec.ts   role/aria-live、文案、淡出、重规划跳变
src/composables/
  useChatStream.ts          新增 `plan_progress` 分支，写 planProgress ref（不改既有事件处理）
```

约束：
- 只渲染一行 `第 N 步 · 步骤名`，**不列步骤、不带总步数**（FR-034/035）；
- 进度对象**不进 messages**、不进 `doneSummary`、不落库，刷新即丢；
- 结束（`phase: 'done'` / `plan.finished`）后淡出，组件保留 DOM 但不占位（避免正文跳动）；
- 无障碍：`role="status"` + `aria-live="polite"`，文案变化才播报。

### 修改（管理侧）

| 文件 | 改动 |
|---|---|
| `admin-backend`（SOUL 读写） | 新增 `task_planning` 布尔键，缺省 false |
| `admin-frontend`（设计器） | 意图聚焦配置区新增复选框「任务规划」，附固定说明「需同时开启意图聚焦」；`intent_focus` 关闭时置灰但保留已选值 |

## 关键设计决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 计划长度 | 1~3 步 | 长计划单步错误复利；窗口小才能用「只看 current」消歧 |
| 执行主体 | 单 agent | 子 agent 会切断 `FunctionRecord`（`command` 永远缺前置）并叠加串行延迟 |
| 硬约束落点 | `context.tools` | 执行层 `prepareToolCall` 按 `currentContext.tools` 查表（`agent-loop.js:401`），换数组即真硬约束 |
| 完成判定点 | `shouldStopAfterTurn` | `afterToolCall` 是单工具返回，同批其他调用未闭合，出队会导致后续 `Tool not found` |
| `type`/`dependTools` | 后端推导 | 后端有权威数据，让 LLM 填只会造成无谓重规划 |
| 工具名 | 对外裸名 / 对内完整名 | 裸名与本体行为名、`related_functions` 同口径；完整名保证唯一 |
| 重复 action 消歧 | 只看 `current` + 工具收窄 | 「完成」是出队而非打标记，跨步同名天然隔离 |
| `availableNames` | 全量 | 随步收窄会让新挂载的依赖函数被判未注册而拒绝 |
| 计划快照 | messages 原地替换 | `systemPrompt` run 内冻结；追加会累积 8 份计划 |
| 串行前置 | 已上线 | 并行批次下规则闸门存在函数记录竞态 |
| 计划可见性 | 单行进度条（方案 B） | 计划会被滚动/失败重规划改写，展示列表等于对外承诺会变的数字；一行文字只表达"现在在哪"，不表达"还剩几步" |
| 进度条数据源 | `plan_progress` SSE 事件 | 快照（FR-016）是给模型的、`plan.*` 是给日志的，两者都不能直接被前端消费；新增一个只带 `{seqId,label,phase}` 的事件，避免把计划正文泄露到端 |
| 进度条文案 | 默认不带总步数 | 总步数在重规划时会跳变（3→4），带总数等于让系统"自食其言"；若产品坚持，须加跳变闪示且禁用百分比 |

## 复杂度跟踪

| 项 | 说明 | 处理 |
|---|---|---|
| `agent-factory.ts` 存量超 500 行 | 本次只加装配调用（目标 ≤ 40 行增量） | 不拆分存量；增量逻辑全部落在新模块 |
| `agent-loop.ts` 需新增 4 个可选钩子透传 | 属于必要改动 | 只加可选参数与透传，不改既有 `afterToolCall` |
| `domain/plan/state.ts` 逻辑密度最高 | 三态 + 完成判定 + 推进 + 终止 | 拆 `state.ts`（转移）与 `snapshot.ts`（渲染），单文件目标 ≤ 300 行 |
| 规划调用增加一次 LLM 往返 | 不可避免 | 受 20s 硬超时与失败降级保护，超时不重试；SC-005 约束增量延迟 |
| 本体事实索引与 `GateSnapshot` 双视图 | 读同一批 yaml，但**两个加载器能力不同**（闸门侧 `ontology-doc.ts` 只有 `name/response/type`；意图聚焦侧 `ontology-loader.ts` 才有 `relatedConcepts` / `concept` / `relations`） | **两源分离、不得混用**：`type` 与前置函数走 `GateSnapshot`，`dependTools` 走 `OntologyIndex`，在 `plan/ontology-facts.ts` 汇合；缓存按 `ontologyDirSignature` 失效，不新增第二套解析逻辑 |
| Windows / Linux 平台差异（宪章原则三 MUST 登记） | 本特性的归一口径（`normalizeName` 小写、`{服务}__` 前缀剥离）与本体 yaml 读取受文件系统大小写敏感性、CRLF、非 ASCII 路径影响 | 沿用 `020`/`021` 既有口径：一律**内存比较前归一**，不依赖目录名大小写；不新增平台相关分支。被否决方案：改为大小写敏感匹配——MCP 注册名与本体 yaml 不一致时会漏拦写操作，安全代价更高 |
| 管理端新增开关 | 需两端同改 | 复用 `input_rewrite` 的既有读写模式，零新机制 |
| 新增第 4 条 SSE 事件 `plan_progress` | 前端流式状态多一个 ref，事件频率 = 步数（每步 1 次），量级与 `tool_call_*` 同阶 | 只加一个事件分支，复用既有 SSE 通道与断线处理；MUST NOT 引入新端点或轮询 |
| 进度条与工具卡片的时序 | 同一批里"进度条先跳、卡片后出" | 进度条在 `enqueue()` 发出（早于工具执行），卡片在 `tool_call_start` 才出；两者不在同一帧是**预期行为**，不做强制对齐 |

## 阶段划分

| 阶段 | 交付 | 可独立验收 |
|---|---|---|
| P0 | 全局工具串行 | **已完成**（`agent-loop.ts` `toolExecution: 'sequential'`） |
| P1 | `domain/plan` 纯函数（`types` / `parse` / `normalize` / `check` / `state` / `snapshot` / `prompt`）+ 单测 | 无 IO，可穷举 |
| P2 | `domain/plan/ontology-facts.ts` + 规则闸门只读查询端口 | 独立可测 |
| P3 | `infra/plan-orchestrator.ts` + `agent-loop` 钩子透传 + `agent-factory` 装配 | 端到端可跑 |
| P4 | 管理端开关（SOUL + 设计器）+ 观测事件 + 集成测试 + 性能实测 + **回放口径结论（T807）** | 达标后可上线 |
| P5 | 可选增强：`submit_plan` 结构化输出 | 视 P4 数据决定，本期不做 |
| P6 | **计划进度可见性（方案 B）**：`plan_progress` 事件（后端三处 emit）+ `PlanProgressBar.vue` + 两侧测试 | 用户已确认要做（2026-11-25）；不动规划与执行逻辑，纯展示增量 |

## 验收前置条件

1. P0 已上线并回归通过（全局串行）
2. `021` 的 `pause` / `deny` 错误码在日志中可区分（`readToolError` 可读）
3. 桩 LLM 能模拟「合法计划 / 非法 JSON / 字段缺失 / 步数越界」四类输出
