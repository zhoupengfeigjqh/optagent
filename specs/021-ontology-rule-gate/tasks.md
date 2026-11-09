---
description: "本体行为规则闸门（021）实现任务清单"
---

# 任务清单：本体行为规则闸门（前置规则判定与后置规则提示）

**输入**：`specs/021-ontology-rule-gate/` 下的 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/rule-gate.md](./contracts/rule-gate.md)、[quickstart.md](./quickstart.md)

**前置**：`plan.md`（必需）、`spec.md`（用户故事与优先级）、研究 / 数据模型 / 契约（已就绪）

**测试口径**：宪章原则三为 NON-NEGOTIABLE，故**包含测试任务**；同一故事内先写失败测试再实现（TDD 顺序）。所有测试在**宿主机本地**执行，容器不承担测试。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

**格式**：`- [ ] [任务ID] [P?] [故事] 描述（含文件路径）`
- `[P]`：可与同阶段其它任务并行（不同文件、无未完成依赖）
- `[故事]`：`US1` / `US2` / `US3`；Setup、Foundational、Polish 阶段**不带**故事标签
- **测试先行的豁免**：标注「集成用例」的任务（T030/T035/T042）依赖装配与接线完成，**允许在实现之后编写**，但必须在实现完成的同一变更集内补齐；其余测试任务 MUST 先写并确认失败

**路径约定**：仓库根为 `optagent/`；本特性改 `agent-backend/`（主）与 `frontend/`（一条错误码文案 + 一处 `details` 透传），文档在 `specs/`。

**硬约束（每个任务都受其约束）**：
- `domain/rule-gate/**` 是**纯领域包**：MUST NOT import `../infra/**`、`./scope-guard/**`、`./intent-focus/**`、`./mcp/**`、`@earendil-works/**`、`fastify`、`pino`、`node:fs`；
- 规则求值 MUST 是**硬编码解析 + 纯计算**，MUST NOT 调用 LLM、MUST NOT 发网络请求、MUST NOT 读时钟；
- 本特性新增错误码**总数 2 个**（`ONTOLOGY_RULE_FUNCTIONS_MISSING` 暂停、`ONTOLOGY_RULE_DENIED` 中止），MUST NOT 再有第三个；
- 单文件 ≤ 500 行；新增模块语句覆盖率 ≥ 80%；零新增依赖。

---

## Phase 1: Setup（共享准备）

**目的**：确认基线、建立模块骨架、核对契约登记位。

- [ ] T001 在 `agent-backend/` 跑一次改动前基线门禁（`npm run typecheck && npm run lint && npm run test`）并把结论写入本文件末尾「基线记录」，避免把存量红灯算到本特性头上
- [ ] T002 [P] 建立特性包骨架：新增 `agent-backend/src/domain/rule-gate/index.ts`（仅占位导出，保证 `npm run typecheck` 通过）与 `agent-backend/src/infra/tool-rule-gate.ts`（空声明占位）
- [ ] T003 [P] 核对契约登记位：`specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的 `R28` 行与 §26 章节（plan 阶段已写入）与 [contracts/rule-gate.md](./contracts/rule-gate.md) 一致；不一致则以契约为准修正

**Checkpoint**：目录可编译、契约登记位就绪。

---

## Phase 2: Foundational（阻塞所有故事）

**目的**：抽出 `ontology.yaml` 的唯一解析入口、定型端口与规则类型、实现四个纯函数模块。**此阶段完成前任何故事都不能开始。**

- [ ] T004 新增 `agent-backend/src/domain/ontology-doc.ts`：`normalizeName`（去空白 + 小写）、`stripServicePrefix`（去首个 `__` 前缀）、`matchKeys`（完整名 + 去前缀名）、`ontologySignature(agentDir)`（`{agentDir}/ontology` 的 `mtimeMs`，缺失为 `missing`）、`parseOntologyDoc(raw, warnings, dirName)`（`metadata` 展示名 / `behaviors[]` / `rules[]` 原样 / `functions[]` 的 `name`+`response`+`type`；结构非法只告警不抛）、`loadOntologyDocs(agentDir, warnings)`（经 `ontology-files.ts` 枚举与读取）
- [ ] T005 改 `agent-backend/src/domain/scope-guard/policy.ts` 与 `agent-backend/src/domain/scope-guard/catalog.ts`：名称归一、行为解析、目录签名改为从 `ontology-doc.ts` 再导出/调用（**判定语义与告警片段逐字不变**），并跑 `agent-backend/tests/unit/scope-guard-policy.spec.ts`、`scope-guard-catalog.spec.ts` 确认零回归
- [ ] T006 [P] 新增 `agent-backend/tests/unit/ontology-doc.spec.ts`：三段解析与缺省、`behaviors[].name` 空值丢弃 + 告警、`rules` 非数组、`functions` 缺 `response`、符号链接目录跳过、中文路径、签名变化
- [ ] T007 定型 `agent-backend/src/domain/rule-gate/types.ts`：`RuleGatePort`、`PrepareResult` 四变体、`FunctionRecord`、`RuleSpec` / `RuleDesign` / `RuleConditionGroup` / `RuleCondition`、`OperatorCode`（16 个）、`GateSnapshot`、两个错误码常量（对齐 [data-model.md](./data-model.md) §2/§3/§4/§6 与 [contracts/rule-gate.md](./contracts/rule-gate.md) §1）
- [ ] T008 [P] 新增 `agent-backend/tests/unit/rule-gate-design.spec.ts`（先失败）：`combine` 非法 → 按 `and`；`groups` 非数组/为空 → `null`；组内 `conditions` 非数组/空组剔除；`values` 非数组 → 单值包裹 + `String()`；`operator` 不在 16 全集 → 条件标记非法；条件缺 `function`/`field` → 非法条件；组数/条数超 5 **不拒绝**（`research.md` D1）
- [ ] T009 [P] 新增 `agent-backend/tests/unit/rule-gate-field-path.spec.ts`（先失败）：`pass` / `detail.qty` / `items` / `items[].qty` / `a[].b[].c`；空串与空段非法；任一段缺失 → `found=false`；投影为空 → 视为缺失；`declaredTypeOf` 吃"属性映射"与 JSON Schema（先解 `properties`、`[]` 下钻 `items.properties`）两形态
- [ ] T010 [P] 新增 `agent-backend/tests/unit/rule-gate-operators.spec.ts`（先失败）：16 算子 × {`boolean` / `integer` / `number` / `string` / 未声明}；`between` 闭区间含两端；`contains` 字符串子串与数组成员；`not_contains` 类型不适用时**判不成立**；`matches` 非法正则与超长（>4096）→ false 且不抛；`empty`/`not_empty` 六种"空"；取值个数与算子不符 → 条件不成立
- [ ] T011 实现 `agent-backend/src/domain/rule-gate/design.ts`：`OPERATOR_CODES`、`valueCountOf`、`isOperatorCode`、`normalizeDesign(raw, warnings)`（读侧静默归一，对齐 [data-model.md](./data-model.md) §3）
- [ ] T012 实现 `agent-backend/src/domain/rule-gate/field-path.ts`：`parseFieldPath` / `readField` / `declaredTypeOf`（纯函数，无 IO）
- [ ] T013 实现 `agent-backend/src/domain/rule-gate/operators.ts`：`coerce`（按声明类型强制，`boolean` 只认 `true`/`false`）、`compare`（16 分支全 total）、`isEmptyValue`、`REGEX_MAX_INPUT = 4096`
- [ ] T014 [P] 新增 `agent-backend/tests/unit/rule-gate-catalog.spec.ts`（先失败）：规则归一（`position` 只认"前置"/"后置"，其他忽略 + 告警；`behavior` 空 → 忽略 + 告警）、按行为索引的稳定顺序、`functions[].response` 索引、多本体同名行为合并、签名变化触发重载（读取计数桩）、坏文件不抛
- [ ] T015 实现 `agent-backend/src/domain/rule-gate/catalog.ts`：`loadGateCatalog(agentDir, signature)`（`behaviorIndex`：前置/后置规则分组、`functionResponses`）+ `catalogSignature` 复用 `ontology-doc`

**Checkpoint**：纯计算底座就绪；`ontology-doc` 与 `020` 的既有单测全绿；`design`/`field-path`/`operators`/`catalog` 的单测全绿。

---

## Phase 3: User Story 1 - 前置规则：缺函数先补，齐备才算（Priority: P1）🎯 MVP

**目标**：打通"本体行为执行前 → 缺函数暂停 / 求值放行 / 求值拒绝并中止整轮"的完整链路，含轮内函数记录的写入与读取、失败轮原因下发与前端文案。

**独立验证**：同一本体行为的两种输入——①模型直接调用（校验函数未执行）→ 暂停且行为不执行、无业务副作用；②先补调函数再调用 → 指令齐备时按 `rule_design` 求值，`true` 放行、`false` 拒绝并中止本轮。不依赖后置规则与跨轮场景。

### 测试（先写，必须失败）

- [ ] T016 [P] [US1] 新增 `agent-backend/tests/unit/rule-gate-evaluate.spec.ts`：组内 `and`/`or` × 组间 `and`/`or` 组合；**多组（3 组以上）由根 `combine` 合成**；多条前置规则合成（任一 false 即 false）；**不短路**（失败条件全部收集，最多 10 条）；函数未记录 / 字段缺失 → 该条件不成立；空组与非法条件
- [ ] T017 [P] [US1] 新增 `agent-backend/tests/unit/rule-gate-record.spec.ts`（第一批）：业务数据抽取四形态（**信封判据 = 同时含 `data` 与 `success`/`error`/`status` 之一** → 取 `data`；扁平 → 取本体；数组 → `{count, items}`；文本按 JSON 解析）；只记成功（有 `details.toolError` 不记）；同名多次成功 → 取最新；键名去服务前缀 + 归一
- [ ] T018 [P] [US1] 新增 `agent-backend/tests/unit/rule-gate-gate.spec.ts`（第一批）：`prepare` 四结局——非本体行为 → `function`；本体行为无前置规则 → `behavior`；缺函数 → `pause`（`details` 列出缺失函数、`message` 含规则名与"请先执行"）；求值 false → `deny`（含 `fail_message`）；无 `rule_design` 的前置规则 → `behavior` + 告警；坏 `rules`/坏 `design` → `deny` + `unavailable` 告警；公共函数未在本体 `functions[]` 声明 → 按未声明类型求值 + 告警（**不拒绝**）；**端口永不抛**
- [ ] T019 [P] [US1] 新增 `agent-backend/tests/unit/tool-rule-gate.spec.ts`（第一批）：`pause`/`deny` 时**原 `execute` 零调用**、返回 `details.toolError.code` 分别为 `ONTOLOGY_RULE_FUNCTIONS_MISSING` / `ONTOLOGY_RULE_DENIED`；`function`/`behavior` 透传同一 `(toolCallId, params)`；内置工具不判定不记录，且**与某函数同名时仍按内置优先**；`onDeny` 恰好调用一次；`name`/`description`/`parameters`/`label`/`executionMode` 保形；暂停/拒绝日志字段齐全且**含 `ts`**
- [ ] T020 [P] [US1] 在 `frontend/src/utils/error-message.spec.ts` 补用例（先失败）：`ONTOLOGY_RULE_DENIED` + `details: string[]` → 逐条换行拼接；`details` 缺失/类型不符 → 固定兜底文案；其他错误码文案逐字不变
- [ ] T021 [P] [US1] 新增 `agent-backend/tests/unit/rule-gate-format.spec.ts`（先失败）：`pauseMessage` 含本体/行为/规则名 + 缺失函数清单；`denyMessage` + `denyDetails` 3~6 条且含行为、规则名、`fail_message` 原文（有则必含）、未成立条件摘要；`ruleBlock` 覆盖规则的**全部字段**（`name`/`title`/`description`/`behavior`/`position`/`related_functions`/`data_supplements`/`rule_design`/`pass_message`/`fail_message`）；同一输入渲染稳定（可作快照断言）

### 实现（后端）

- [ ] T022 [US1] 实现 `agent-backend/src/domain/rule-gate/evaluate.ts`：`evaluateDesign(design, ctx)` → `{ passed, failed }`，两级合成、不短路、失败条件上限 10（对齐 [data-model.md](./data-model.md) §3 与 `research.md` D1）
- [ ] T023 [US1] 实现 `agent-backend/src/domain/rule-gate/record.ts`：`createFunctionRecord()`（`add` 内部判成败 → 抽业务数据 → 归一键覆盖；`has` / `get` / `size`），业务数据抽取口径对齐 [data-model.md](./data-model.md) §5（信封判据以 `FR-006` 为准）
- [ ] T024 [US1] 实现 `agent-backend/src/domain/rule-gate/format.ts`：`pauseMessage` / `denyMessage` / `denyDetails` / `ruleBlock`（规则全文渲染）——**文案唯一来源**，包装器与装配层不拼字
- [ ] T025 [US1] 实现 `agent-backend/src/domain/rule-gate/gate.ts`：`createRuleGate({ agentDir, warn? })`——惰性加载 + 签名重载；`prepare` 合成（识别 → 无前置规则 → 缺函数优先 → 求值 → `deny`）；全函数 `try/catch` 兜底为 `deny(unavailable)`；`invalidate`
- [ ] T026 [US1] 在 `agent-backend/src/domain/rule-gate/index.ts` 收敛唯一导出面（工厂 + 端口类型 + `createFunctionRecord` + 两个错误码常量），并确认 `domain/rule-gate/**` 的 import 清单符合硬约束
- [ ] T027 [US1] 实现 `agent-backend/src/infra/tool-rule-gate.ts` 的 prepare 路径：`ruleGateTools` / 单工具包装（内置过滤 → `prepare` → `pause` 返回 `toolErrorResult(message, 'ONTOLOGY_RULE_FUNCTIONS_MISSING')` / `deny` 调 `onDeny` 后返回 `toolErrorResult(message, 'ONTOLOGY_RULE_DENIED')`），日志 `rule_gate.paused` / `denied` / `unavailable`（均含 `ts`）
- [ ] T028 [US1] 中止接线：`agent-backend/src/types.ts` 加 `HistoryErrorInfo.details?: string[]`；`agent-backend/src/domain/llm-error.ts` 的 `toHistoryErrorInfo` "有才写"透传 `details`；`agent-backend/src/domain/run-impl.ts` 加 `ruleAbort`；`agent-backend/src/domain/run-manager.ts` 的 `AgentRunRequest` 加 `abortRun?`；`agent-backend/src/domain/run-consume.ts` 传入实现（写 `ruleAbort` + `run.stop()`）并让 `error` 分支优先按 `ONTOLOGY_RULE_DENIED` 走 `finalizer.error`
- [ ] T029 [US1] 在 `agent-backend/src/infra/agent-factory.ts` 接线：`create()` 构造 `ruleGate`（与 `scopeGuard` 并列）；`runWith()` 内 `createFunctionRecord()` + 取 `buildBuiltinTools` 产物的 `builtinNames` + `ruleGateTools(...)` 后**再** `guardTools(...)`（021 在内、020 在外），`availableTools` 与 `runAgentLoopEvents` 使用最终数组
- [ ] T030 [US1] 新增 `agent-backend/tests/unit/rule-gate-loop.spec.ts`（集成用例，允许在 T027~T029 之后写）：假 `streamFn` 两跳——首次调用被暂停（`tool_call_end.status='error'`、行为零执行）→ 补调函数成功（记录写入）→ 二次调用放行，并**显式断言"暂停未清空记录"**（`FR-008`）；另一用例：求值 false → 事件流出现 `error(code='ONTOLOGY_RULE_DENIED')` 且 `details` 3~6 条、**无 `done`**、`onMcpCall` 未计数、后续无新模型调用（`FR-032` 并行批次语义）

### 实现（前端）

- [ ] T031 [US1] 在 `frontend/src/utils/error-message.ts` 增加 `ONTOLOGY_RULE_DENIED` 的**受控原文透传**（`details` 为 `string[]` 时换行拼接；否则固定文案"本体行为未通过规则校验，本轮已中止"），并保留"不展示后端 `message`"的既有口径

**Checkpoint**：US1 全链路可用——暂停、放行、拒绝并中止三种结局均可在自动化用例中复现；前端能看到逐条原因。

---

## Phase 4: User Story 2 - 每轮重建记录：上一轮的函数结果不算数（Priority: P2）

**目标**：把"轮内记录"的生命周期与覆盖语义钉死：每轮新建、只记成功、失败不覆盖、同名最新、有界并告警。

**独立验证**：第 1 轮跑齐函数再调用行为（通过）；第 2 轮直接调用（应暂停）；同一轮内同一函数失败一次后成功（按成功值放行）、成功后又失败（保留成功值）。

**依赖**：T023 / T029 已建立记录与接线（本阶段是语义锁定与边界补全，不是从零实现）。

- [ ] T032 [P] [US2] 扩充 `agent-backend/tests/unit/rule-gate-record.spec.ts`：失败不覆盖已有成功值；同轮三次成功 → 1 条且取最后一次；单条序列化 > 256 KB → 丢弃；条目 > 64 → 丢弃；丢弃时产生 `reason` 明确的告警；`FR-008`（判定/暂停不清空记录）与内置工具 / 本体行为不经此路径（在包装器层断言）
- [ ] T033 [US2] 在 `agent-backend/src/domain/rule-gate/record.ts` 落实边界：单条 256 KB、条目 64、超限丢弃并通过 `warn` 出口上报（对齐 [data-model.md](./data-model.md) §4 与 `research.md` D12）
- [ ] T034 [US2] 在 `agent-backend/src/infra/agent-factory.ts` 固化生命周期：`createFunctionRecord()` 只在 `runWith()` 内创建（每轮一次），MUST NOT 提到实例级；在 `agent-backend/tests/unit/tool-rule-gate.spec.ts` 增一条"两次 run 之间记录不共享"的断言
- [ ] T035 [US2] 在 `agent-backend/tests/unit/rule-gate-loop.spec.ts` 新增跨轮用例（**集成用例**，允许在 T034 之后写）：第 1 轮补调函数并放行，第 2 轮直接调用 → 仍 `pause`（记录已清零）
- [ ] T036 [US2] 在 `agent-backend/src/infra/tool-rule-gate.ts` 增 `rule_gate.record.dropped` 日志（`ts` / `tool_name` / `reason` / `bytes` 或 `count`），并在 `tool-rule-gate.spec.ts` 断言该事件出现且不含结果正文

**Checkpoint**：跨轮不串味、覆盖语义与上限均被用例锁定。

---

## Phase 5: User Story 3 - 后置规则：行为做完，把推导提示递到模型手上（Priority: P3）

**目标**：本体行为**执行成功**后，把 `position: 后置` 的规则全文附着在结果之后；无后置规则时结果逐字不变。

**独立验证**：同一行为配置/不配置后置规则各执行一次成功调用：前者原始正文完整 + 末尾多出后置块与"请继续调用相关函数"；后者结果逐字相同；行为执行失败时一律不追加。

- [ ] T037 [P] [US3] 在 `agent-backend/tests/unit/rule-gate-gate.spec.ts` 增 `postHint` 用例：无后置 → `null`；单条 → 含规则名/描述/`related_functions`/`data_supplements` 与**`pass_message`、`fail_message`（有则必含，`FR-028`）**；多条 → 文件内顺序全部追加；多本体同名行为 → 合并；`postHint` 永不抛
- [ ] T038 [P] [US3] 在 `agent-backend/tests/unit/tool-rule-gate.spec.ts` 增追加用例：成功 → 原始 `content` 顺序与内容逐字保留 + 追加块（文本块拼接后与记录同源，`FR-031`）；失败（`details.toolError`）→ 不追加；`function` 角色 → 永不追加
- [ ] T039 [US3] 在 `agent-backend/src/domain/rule-gate/format.ts` 增 `postBlock(rules)`（明确分界 + 规则全文 + "请继续调用相关函数完成推导"引导），复用 `ruleBlock`
- [ ] T040 [US3] 在 `agent-backend/src/domain/rule-gate/gate.ts` 实现 `postHint(toolName)`（按行为找后置规则 → 渲染 → 返回 `{ text, rules }`；无规则返回 `null`）
- [ ] T041 [US3] 在 `agent-backend/src/infra/tool-rule-gate.ts` 实现执行后追加（仅 `role='behavior'` 且成功）、`rule_gate.posted` 日志（含 `ts`）；确认 `details` 与其他字段原样保留
- [ ] T042 [US3] 在 `agent-backend/tests/unit/rule-gate-loop.spec.ts` 增端到端用例（**集成用例**，允许在 T039~T041 之后写）：成功后该次 `tool_call_end` 的结果文本以原始正文开头、以后置块结尾；同一轮内该行为不被记入函数记录

**Checkpoint**：三个故事各自独立可验证；后置提示不影响任何判定路径。

---

## Phase 6: Polish 与横切事项

**目的**：解耦红线、性能口径、文档一致性与全量门禁。

- [ ] T043 [P] 解耦红线自检：对 `agent-backend/src/domain/rule-gate/**` 与 `agent-backend/src/domain/ontology-doc.ts` 执行 grep 断言，确认不含 `infra/`、`scope-guard`、`intent-focus`、`mcp/`、`@earendil-works`、`fastify`、`pino`、`node:fs` 的 import（`ontology-doc.ts` 经 `ontology-files.ts` 读文件，允许间接依赖）
- [ ] T044 [P] `SC-004` 实测：按 [spec.md](./spec.md) 的测量口径表（5 本体 × 8 行为 × 2 条前置规则，各 50 次、丢前 5 次、取增量 P95）测"已缓存"与"未缓存首次"两档，把结果回填 `spec.md` 的 `SC-004` 表与本文件「基线记录」
- [ ] T045 文档一致性复核：`contracts/rule-gate.md` 与实现逐项对齐（端口签名、包装器六步、两个错误码与其通道、`details` 形状、日志含 `ts`）；`runtime-api-delta.md` 的 R28/§26 无需改写即一致；`spec.md` 修订记录已含 plan 阶段与 analyze 阶段两组校正；逐条勾 `plan.md`「完成定义」
- [ ] T046 全量门禁（本地）：`cd agent-backend && npm run gate`（typecheck → lint → test:coverage → build）与 `cd frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build` 全绿；新增模块覆盖率 ≥ 80%；确认 `agent-backend/package.json` 零依赖变化
- [ ] T047 按 [quickstart.md](./quickstart.md) 场景 A~F 在真实数字人上手验（暂停 / 自愈 / 拒绝中止 / 后置提示 / 跨轮 / 无规则本体），把证据与结论写入本文件末尾「手验记录」
- [ ] T048 [P] 复核既有回归面：`agent-backend/tests/unit/` 下 `scope-guard-*`、`tool-scope-guard`、`intent-focus-*` 全绿（解析重构 + 装配顺序变更的回归门槛）

---

## 需求覆盖映射（FR / SC → 任务）

| 需求 | 任务 |
|---|---|
| FR-001 / FR-002 / FR-003 / FR-004 / FR-005（轮内记录、范围、只记成功、键归一、覆盖） | T017、T023、T032、T033、T034 |
| FR-006 / FR-007（记录值形态与信封判据、体积上限） | T017、T023、T032、T033 |
| FR-008 / FR-040（不因判定失败回滚、记录不落盘、日志只记元信息） | T023、T030、T032、T034 |
| FR-009 / FR-010 / FR-011（时机、来源、匹配） | T015、T025、T029 |
| FR-012 / FR-013 / FR-014（无规则直通、多规则全部参与、暂停条件） | T018、T025 |
| FR-015 / FR-016（暂停反馈规则全文 + 缺失清单；失败结果通道 + 暂停码） | T018、T021、T024、T027 |
| FR-017 / FR-018 / FR-019 / FR-020 / FR-021（纯计算求值、语义、16 算子、比较口径、缺值、公共函数类型） | T008~T013、T016、T018、T022 |
| FR-022（缺 `rule_design` 不阻断 + 告警） | T018、T025 |
| FR-023 / FR-024 / FR-025（true 放行、false 拒绝并中止、结构非法 fail-closed） | T018、T025、T027、T028、T030 |
| FR-026 ~ FR-031（后置提示全套） | T037、T038、T039、T040、T041、T042 |
| FR-032 ~ FR-036（中止语义含并行批次、错误码、文案、日志含 `ts`、统计口径） | T021、T024、T027、T028、T030、T036 |
| FR-037 / FR-038 / FR-039（数据源、缓存与生效、无旁路开关） | T004、T015、T025 |
| SC-001（判定矩阵一致率） | T016、T008~T010 |
| SC-002 / SC-003（零执行、零跨轮复用） | T030、T035 |
| SC-004（性能） | T044 |
| SC-005（文案含行为名与规则名、日志含时间） | T019、T021、T024、T027、T031 |
| SC-006（非本体与无本体零变化） | T019、T048 |
| SC-007（后置附加率） | T038、T042 |
| SC-008（门禁与覆盖率） | T046 |

---

## 依赖关系与执行顺序

### 阶段依赖

- **Phase 1（Setup）**：无依赖，可立即开始
- **Phase 2（Foundational）**：依赖 Phase 1 —— **阻塞所有故事**（`types` / `design` / `field-path` / `operators` / `catalog` / `ontology-doc` 是三者共同前提）
- **Phase 3（US1）**：依赖 Phase 2
- **Phase 4（US2）**：依赖 Phase 3（记录与接线由 US1 建立，本阶段补语义与边界）
- **Phase 5（US3）**：依赖 Phase 3（需要包装器与 `format.ruleBlock`）；与 US2 无文件冲突，可并行
- **Phase 6（Polish）**：依赖 US1~US3 完成

### 故事间依赖

- **US1（P1）**：Foundational 之后可独立完成与验证（MVP）
- **US2（P2）**：必须建立在 US1 的记录接线上；US1 未完成时无法独立验证
- **US3（P3）**：只依赖 US1 的包装器与文案骨架，与 US2 互不影响

### 任务级串行点（不可并行）

- T004 → T005（020 改为复用，必须先有 `ontology-doc`）
- T007 → T008/T009/T010（类型先定）
- T011/T012/T013 与 T008/T009/T010 一一对应（同文件"先测试后实现"）
- T025 → T027 → T029（端口 → 包装器 → 装配）
- T028 与 T029 需相邻完成（`abortRun` 类型先于装配使用）
- T030 依赖 T027 + T028 + T029
- T039/T040/T041 依次依赖
- T044、T046、T047 依赖全部实现完成

### 并行机会

- Phase 2 内：T008/T009/T010 三个测试文件互相独立，可并行；T006 与 T011~T013 也可并行（不同文件）
- Phase 3 内：T016~T021 六个测试文件可并行编写；T022/T023/T024 三个实现文件互相独立可并行
- Phase 5 内：T037/T038 两个测试文件可并行
- 前端（T020/T031）与后端实现互不阻塞，可并行推进

---

## 并行示例

```bash
# Phase 2：先并行写三个纯函数测试（不同文件、互不依赖）
Task: "写 agent-backend/tests/unit/rule-gate-design.spec.ts"
Task: "写 agent-backend/tests/unit/rule-gate-field-path.spec.ts"
Task: "写 agent-backend/tests/unit/rule-gate-operators.spec.ts"

# Phase 3：先并行写六个测试（US1 的全部失败基线）
Task: "写 agent-backend/tests/unit/rule-gate-evaluate.spec.ts"
Task: "写 agent-backend/tests/unit/rule-gate-record.spec.ts"
Task: "写 agent-backend/tests/unit/rule-gate-gate.spec.ts"
Task: "写 agent-backend/tests/unit/tool-rule-gate.spec.ts"
Task: "写 agent-backend/tests/unit/rule-gate-format.spec.ts"
Task: "写 frontend/src/utils/error-message.spec.ts 的新用例"

# Phase 3：三个实现文件互相独立，可并行
Task: "实现 agent-backend/src/domain/rule-gate/evaluate.ts"
Task: "实现 agent-backend/src/domain/rule-gate/record.ts"
Task: "实现 agent-backend/src/domain/rule-gate/format.ts"
```

---

## 实施策略

### MVP 优先（只做 US1）

1. 完成 Phase 1 + Phase 2（底座）
2. 完成 Phase 3（US1）
3. **停下验证**：暂停 / 放行 / 拒绝并中止三条路径全部通过单测与进程内端到端
4. 此时已可交付"未校验的调用挡得住"这一核心价值（后置提示缺失不影响正确性）

### 增量交付

1. Setup + Foundational → 底座就绪（不可演示）
2. US1 → 独立验证 → 可演示（MVP）
3. US2 → 独立验证（跨轮隔离）→ 可演示
4. US3 → 独立验证（后置提示）→ 可演示
5. 每个故事都不破坏前一个故事的用例

### 并行团队策略

1. 全员先完成 Setup + Foundational（`ontology-doc` + 四个纯函数模块是公共底座）
2. 之后：A 负责 US1（后端主链 + 中止接线）、B 负责前端 T020/T031 与 US3 的文案部分、
   C 负责 US2 的记录边界与跨轮用例
3. 三者只在 `tool-rule-gate.ts` / `gate.ts` / `format.ts` 有交叠，按 US1 → US2 → US3 顺序合并即可

---

## 基线记录

> 由 T001 / T044 / T046 / T047 回填。

- **改动前基线（T001）**：待填（门禁结论 + 是否有存量红灯）
- **SC-004 测量结果（T044）**：待填（已缓存 P95 / 未缓存首次 P95 / 样本量 / 环境）
- **全量门禁（T046）**：待填（后端 `npm run gate` 与前端四条命令的结论、覆盖率数字）
- **手验记录（T047）**：待填（场景 A~F 的结果与证据）

---

## 修订记录

- 2026-11-09：初版（47 条）。
- 2026-11-09（analyze 修订）：按 `/speckit.analyze` 结论补齐三处覆盖缺口与四处口径——
  ①新增 **T021**（`rule-gate-format.spec.ts`，`format.ts` 的专属单测，宪章原则三）并使后续任务整体顺延为 **48 条**；
  ②T019 补"内置工具与函数同名按内置优先"与"日志含 `ts`"断言；③T030 显式断言"暂停未清空记录"（`FR-008`）
  与"中止后无新模型调用"（`FR-032` 并行批次）；④T037 补 `pass_message` / `fail_message` 断言（`FR-028`）；
  ⑤T032/T036 补记录边界与 `ts`；⑥T030/T035/T042 标注「集成用例」豁免"测试先行"；⑦映射表与依赖/并行章节同步重编号。
