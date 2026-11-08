---
description: "本体行为权限闸门（020）实现任务清单"
---

# 任务清单：本体行为权限闸门（工具调用前置授权）

**输入**：`specs/020-ontology-scope-guard/` 下的 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/scope-guard.md](./contracts/scope-guard.md)、[quickstart.md](./quickstart.md)

**前置**：`plan.md`（必需）、`spec.md`（用户故事与优先级）、研究/数据模型/契约（已就绪）

**测试口径**：宪章原则三为 NON-NEGOTIABLE，故**包含测试任务**；同一故事内先写失败测试再实现（TDD 顺序）。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

**格式**：`- [ ] [任务ID] [P?] [故事] 描述（含文件路径）`
- `[P]`：可与同阶段其它任务并行（不同文件、无未完成依赖）
- `[故事]`：`US1` / `US2` / `US3`；Setup、Foundational、Polish 阶段**不带**故事标签

**路径约定**：仓库根为 `optagent/`；本特性只改 `agent-backend/`，文档在 `specs/`。

---

## Phase 1: Setup（共享准备）

**目的**：确认基线、建立模块目录骨架、登记契约变更行。

- [ ] T001 在 `agent-backend/` 跑一次改动前基线门禁（`npm run lint && npm run typecheck && npm run test`），记录现有失败项，避免把存量红灯算到本特性头上；结果写入本文件末尾「基线记录」
  - **2026-11-08 实际**：未单独录制改动前基线（开发直接开始）；改动后全绿，无存量红灯需剔除，见「基线记录」说明
- [X] T002 [P] 建立特性包骨架：新增 `agent-backend/src/domain/scope-guard/index.ts` 与 `agent-backend/src/infra/tool-scope-guard.ts`（仅空声明/类型占位，保证 `npm run typecheck` 通过）
- [X] T003 [P] 在 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的变更登记表新增 `R27` 行（内容见 `contracts/scope-guard.md` §7「待登记」），并在文末预留「本体行为权限闸门」章节标题

**Checkpoint**：目录可编译、契约登记位就绪。

---

## Phase 2: Foundational（阻塞所有故事）

**目的**：抽出唯一的目录枚举/YAML 读取工具、定型决策类型与错误码。**此阶段完成前任何故事都不能开始。**

- [X] T004 新增 `agent-backend/src/domain/ontology-files.ts`：`listOntologyDirs(agentDir, warnings)`（只接受真实目录、跳过符号链接、按名称排序）与 `readYamlObject(file, warnings)`（`lstat` 拒绝符号链接、`invalid_yaml` / `not_object` / `not_regular_file` 告警、永不抛错）
- [X] T005 新增 `agent-backend/tests/unit/ontology-files.spec.ts`：覆盖正常枚举、缺目录（空数组且零告警）、不可读目录、符号链接目录/文件被跳过、坏 YAML、非对象根、中文路径
- [X] T006 改 `agent-backend/src/domain/intent-focus/ontology-loader.ts` 改为复用 T004 的两个函数（字段建模与告警关键片段保持不变），并跑 `agent-backend/tests/unit/intent-focus-loader.spec.ts` 与 `agent-backend/tests/unit/intent-focus-expansion.spec.ts` 确认零回归
- [X] T007 [P] 定型 `agent-backend/src/domain/scope-guard/types.ts`：`ScopeGuardPort`、`ScopeDecision` 三变体、`ScopeDenyCode`（`ONTOLOGY_SCOPE_DENIED` / `ONTOLOGY_BEHAVIOR_DISABLED` / `ONTOLOGY_SCOPE_UNAVAILABLE`）、`DenyReason`、`BehaviorRef`、`GuardSnapshot` / `OntologyEntry` / `SecurityEntry`（字段口径严格对齐 `data-model.md` §2）

**Checkpoint**：共享底层就绪；`intent-focus` 既有测试全绿；决策类型可作为后续测试的编译依据。

---

## Phase 3: User Story 1 - 授权用户能跑，未授权用户被拦（Priority: P1）🎯 MVP

**目标**：以"当前数字人归属用户名是否在 `scope` 中"为核心，打通"工具调用前判定 → 放行/拒绝 → 卡片标红 + 文案"的完整链路。

**独立验证**：同一本体行为两份配置（`scope: [admin]` 与 `scope: [zpf]`），当前用户 `admin` 前者成功、后者被拒且工具零执行、业务数据零变化、卡片标红、日志一条；不依赖 `disable`/`everyone` 与异常分支。

### 测试（先写，必须失败）

- [X] T008 [P] [US1] 新增 `agent-backend/tests/unit/scope-guard-policy.spec.ts`：`normalize`/`matchKeys`（无 `__`、`a__b`、`a__b__c`、空串、大小写与空白）+ 规则矩阵第 1/4/5 行（非本体放行、含当前用户名放行、仅含他人拒绝）
- [X] T009 [P] [US1] 新增 `agent-backend/tests/unit/scope-guard-catalog.spec.ts`（第一批）：两文件齐全、`behaviors[].name` → 条目绑定、`action_name` 归一化、同名行为重复保留首个、空 `ontology/` 目录返回空快照、中文路径；**缓存与失效**（`FR-023`/`SC-007`）：同一实例连续 `check` 只加载一次（读取计数桩）、`ontology` 目录 mtime 变化后下一次 `check` 使用新配置、签名未变不重读

### 实现

- [X] T010 [US1] 实现 `agent-backend/src/domain/scope-guard/policy.ts`：`normalizeName`、`matchKeys`（完整名 + 去首个 `__` 前缀）、`decideScope(entry, username)`（先只落"用户名命中 → allow；否则 `not_in_scope` 拒绝"）
- [X] T011 [US1] 实现 `agent-backend/src/domain/scope-guard/catalog.ts`：`loadGuardCatalog(agentDir)` 产出 `GuardSnapshot`（`byBehavior` 索引、`OntologyEntry`、`warnings`）与 `catalogSignature(agentDir)`（单次 `statSync`）
- [X] T012 [US1] 实现 `agent-backend/src/domain/scope-guard/guard.ts` 与导出：`createScopeGuard`（惰性加载 + 签名比对重载 + 决策合成 + 中文文案），在 `agent-backend/src/domain/scope-guard/index.ts` 收敛为唯一导出面
- [X] T013 [P] [US1] 新增 `agent-backend/tests/unit/tool-scope-guard.spec.ts`（第一批）：放行时原 `execute` 收到同一 `(toolCallId, params)`；拒绝时原 `execute` 零调用且 `details.toolError.code` 正确；`not_ontology` 透传；`name`/`label`/`description`/`parameters`/`executionMode` 保形；**拒绝时不进入人工确认**——以 `wrapToolWithInteraction(...)` 的输出作为被包装工具，断言假 `InteractionSink.request` 零调用（`FR-002`）
- [X] T014 [US1] 实现 `agent-backend/src/infra/tool-scope-guard.ts`：`wrapToolWithScopeGuard` 与 `guardTools`（逐工具仅包装一次；拒绝走 `toolErrorResult`；文件内不含任何本体名、工具名与 YAML 逻辑）
- [X] T015 [US1] 在 `agent-backend/src/infra/agent-factory.ts` 接线 3 处：`create()` 构造 guard、`run` 闭包传参、`runWith()` 装配末尾 `guardTools(...)` 并让 `availableTools` 与 `runAgentLoopEvents` 使用包装后的数组
- [X] T016 [US1] 新增 `agent-backend/tests/unit/scope-guard-loop.spec.ts`：用假 `streamFn` 驱动一次被拒调用，断言工具未执行、`tool_call_end.status='error'`、文案含本体与行为、`onMcpCall` 未触发、**本轮事件流中无 `interaction_request`**（对应契约 C2/C9 与 `FR-002`）
- [ ] T017 [US1] 按 `quickstart.md` 场景 A（`scope: [admin]` 放行）与场景 B（`scope: [zpf]` 拒绝）手验，贴回执行证据到本文件末尾「手验记录」
  - **未执行**：需真实 MCP 服务（样例指向 `localhost:8022`）与前端环境；等价断言已由 T013/T016 的自动化用例覆盖

**Checkpoint**：US1 独立可用——授权与拒绝按用户名生效，非本体工具零影响；此后可选做 MVP 交付。

---

## Phase 4: User Story 2 - `disable` 立即停用，`everyone` 全放开（Priority: P2）

**目标**：补全保留标记语义（`disable` 优先于 `everyone`）与多本体同名行为的拒绝优先合成。

**独立验证**：同一行为依次配置 `everyone` → `disable` → `[everyone, disable]`，判定结果分别放行、拒绝、拒绝；同名行为跨两个本体时一个放行一个拒绝，结果为拒绝；全程不改装配代码。

### 测试（先写，必须失败）

- [X] T018 [US2] 在 `agent-backend/tests/unit/scope-guard-policy.spec.ts` 追加：`everyone` 放行、`disable` 拒绝、`[everyone, disable]` 拒绝、空 `scope` 拒绝、非字符串/空串元素忽略、保留标记大小写与空白
- [X] T019 [P] [US2] 在 `agent-backend/tests/unit/scope-guard-catalog.spec.ts` 追加：同一行为名挂两个本体（一个放行、一个拒绝 → 拒绝）、两个都放行 → 放行、稳定顺序（本体键升序）可复现

### 实现

- [X] T020 [US2] 扩展 `agent-backend/src/domain/scope-guard/policy.ts`：`RESERVED` 保留标记识别、`disable` 优先于 `everyone`、空 `scope` → `empty_scope` 拒绝
- [X] T021 [US2] 扩展 `agent-backend/src/domain/scope-guard/guard.ts`：多绑定逐条判定、任一拒绝即拒绝（同码取稳定顺序第一条）、冲突记一条 `warn`
- [ ] T022 [US2] 按 `quickstart.md` 场景 C（`disable` + `everyone` 并存）与场景 D（`everyone` 放行）手验并记录证据
  - **未执行**：需真实 MCP 服务与前端环境；规则矩阵已由 T018 覆盖

**Checkpoint**：US1 + US2 均可独立工作；改 `scope` 重新部署后下一次调用即生效。

---

## Phase 5: User Story 3 - 拒绝可追溯，配置异常不被静默吞掉（Priority: P3）

**目标**：管控配置缺失/损坏时 fail-closed 并告警；每次拒绝留结构化记录且不泄露授权清单。

**独立验证**：删掉某行为的 `action_name` 条目、把 `securities.yaml` 改成非法 YAML、构造内部异常三种情形，均返回 `ONTOLOGY_SCOPE_UNAVAILABLE` 且日志可定位；一次正常拒绝的日志字段齐全、无用户名清单；无本体数字人零日志噪声。

### 测试（先写，必须失败）

- [X] T023 [US3] 在 `agent-backend/tests/unit/scope-guard-catalog.spec.ts` 追加：缺 `securities.yaml` → `no_securities`、`securities` 非数组、`scope` 非数组、缺 `action_name` 条目 → `no_entry`、坏 YAML 不影响其它本体
- [X] T024 [P] [US3] 在 `agent-backend/tests/unit/tool-scope-guard.spec.ts` 追加日志断言：每条拒绝一条 `scope_guard.denied`、字段齐全（含 `ts`）、`scope_size`/`scope_kind` 正确、**不含**用户名清单；`code=ONTOLOGY_SCOPE_UNAVAILABLE` 时为 `error` 级；无本体数字人路径的 `scope_guard.*` 日志为 0 条（`FR-021`）

### 实现

- [X] T025 [US3] 在 `agent-backend/src/domain/scope-guard/catalog.ts` 与 `guard.ts` 落 `no_entry` / `no_securities` 分支：返回 `ONTOLOGY_SCOPE_UNAVAILABLE` 并给出「授权配置不可用」文案
- [X] T026 [US3] 在 `agent-backend/src/domain/scope-guard/guard.ts` 增加内部异常兜底：任何异常 → `deny(ONTOLOGY_SCOPE_UNAVAILABLE, reason='internal_error')` + `warn`，**永不抛错**
- [X] T027 [US3] 在 `agent-backend/src/infra/tool-scope-guard.ts` 落结构化日志：`scope_guard.denied`（按 `code` 分级）、`catalog.degraded`（装配层聚合）与 `scope_guard.evaluator_error`（端口违约），字段严格按 `contracts/scope-guard.md` §5
- [ ] T028 [US3] 按 `quickstart.md` 场景 E（缺条目/坏文件）与场景 F（非本体工具回归）手验并记录证据
  - **未执行**：需真实 MCP 服务与前端环境；异常分支与"非本体工具零影响"已由 T023/T024 覆盖

**Checkpoint**：三个故事全部独立可用；异常路径可观测且不静默放行。

---

## Phase 6: Polish（跨故事收尾）

**目的**：契约文档落齐、性能实测回填、解耦约束可机械验证、门禁全绿。

- [X] T029 [P] 在 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 完成「本体行为权限闸门」章节：判定矩阵、文案口径、三个错误码、日志事件、生效时机（已落为 §25，正文与 `contracts/scope-guard.md` §2~§6 对齐）
- [X] T030 [P] 回填 `SC-004` 实测值：按 `plan.md`「SC-004 测量口径」测已缓存与未缓存两档，结果写入 `specs/020-ontology-scope-guard/plan.md` 与 `spec.md` 的成功标准表
- [X] T031 [P] 解耦约束机械校验：用检索断言 `agent-backend/src/domain/scope-guard/**` 不含 `infra`、`intent-focus`、`mcp`、`@earendil-works`、`fastify`、`pino` 引用；把命令与结果记录到本文件「解耦校验记录」
- [X] T032 在 `agent-backend/` 跑完整门禁：`npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build`，确认新增模块语句覆盖率 ≥ 80%、单文件 ≤ 500 行
- [X] T033 [P] 文档一致性终检：`spec.md` 修订记录、`contracts/scope-guard.md` §7「待登记」已落地、`quickstart.md` 的验收对照表与实际实现一致（如有偏差同步修正并登记日期）

---

## 任务与规格映射（可追溯）

| 规格条目 | 覆盖任务 |
|---|---|
| `FR-001` / `FR-002`（全工具判定、先于人工确认） | T014、T015、T016 |
| `FR-003` / `FR-004`（归属识别与本体身份） | T004、T008、T010、T011 |
| `FR-005`（行为粒度） | T010、T013 |
| `FR-006`~`FR-011`（授权判定四条规则） | T010、T020、T021 |
| `FR-012`（保留标记） | T018、T020 |
| `FR-013`（零副作用） | T013、T016、T017 |
| `FR-014`（三错误码） | T007、T010、T020、T025、T026 |
| `FR-015`（多本体拒绝优先） | T019、T021 |
| `FR-016`（文案不含清单） | T012、T024 |
| `FR-017`（失败通道不抛异常） | T013、T014、T016 |
| `FR-018`（结构化记录） | T024、T027 |
| `FR-019`（不计 MCP 调用） | T016 |
| `FR-020` / `FR-021`（唯一数据源、无本体全放行） | T009、T011 |
| `FR-022`（fail-closed） | T023、T025、T026 |
| `FR-023` / `FR-024`（生效时机与开销） | T011、T012、T030 |
| `FR-025`（平台零改动） | T003、T029 |

---

## 依赖与执行顺序

### 阶段依赖

- **Phase 1 Setup**：无依赖，可立即开始
- **Phase 2 Foundational**：依赖 Setup 完成，**阻塞全部用户故事**
- **Phase 3~5 用户故事**：均依赖 Foundational；建议按 P1 → P2 → P3 顺序推进（同一文件 `policy.ts` / `guard.ts` 会被后续故事追加分支，顺序推进避免冲突）
- **Phase 6 Polish**：依赖所有计划内故事完成

### 故事间依赖

| 故事 | 依赖 | 说明 |
|---|---|---|
| US1（P1） | Phase 2 | 建立判定链路本身（MVP） |
| US2（P2） | Phase 2 + **US1** | 在既有 `policy.ts` / `guard.ts` 上追加保留标记与多本体合成；不新增装配改动 |
| US3（P3） | Phase 2 + **US1** | 在既有 `catalog.ts` / `guard.ts` / 包装器上追加异常分支与日志；不新增装配改动 |

> 说明：本特性的三条故事是**同一链路的三层语义**，故 US2/US3 依赖 US1 的代码落点；
> 但两者各自的验收（保留标记矩阵、异常与日志）可在 US1 完成后**独立验证**，不需要其它故事就位。

### 故事内部顺序

1. 测试先行（TDD）：先提交失败的测试，再实现；
2. 纯策略 → 加载 → 合成 → 包装 → 装配；
3. 实现完成后立即跑该故事的测试与手验，再进入下一个故事。

### 并行机会

- Phase 1：T002 与 T003 可并行（不同文件）
- Phase 2：T007（类型）与 T004~T006（加载链路）可并行
- US1：T008 与 T009 可并行（两个新测试文件）；T013 可与 T012 并行（测试文件 vs 实现文件）
- US2：T019 与 T018 可并行（不同测试文件）
- US3：T024 与 T023 可并行（不同测试文件）
- Phase 6：T029、T030、T031、T033 可并行（四份不同文档/校验）

---

## 并行示例

```text
# 并行 A：Phase 1 文档与骨架
T002 建立 scope-guard 包骨架（domain/scope-guard/index.ts、infra/tool-scope-guard.ts）
T003 R27 登记（specs/001-.../runtime-api-delta.md）

# 并行 B：Phase 2 类型与加载链路
T007 定型决策类型与错误码（domain/scope-guard/types.ts）
T004→T005→T006 目录枚举/YAML 工具 + 其测试 + 意图聚焦复用

# 并行 C：US1 测试先行
T008 规则与匹配测试（tests/unit/scope-guard-policy.spec.ts）
T009 加载与绑定测试（tests/unit/scope-guard-catalog.spec.ts）
T013 包装器测试（tests/unit/tool-scope-guard.spec.ts）

# 并行 D：US2 两批测试
T018 保留标记矩阵（scope-guard-policy.spec.ts）
T019 多本体合成（scope-guard-catalog.spec.ts）
```

---

## 实施策略

### MVP 优先（只做 US1）

1. 完成 Phase 1 + Phase 2（不可跳过）；
2. 完成 Phase 3（US1）；
3. **停下验证**：`quickstart.md` 场景 A/B + `scope-guard-*` 三个测试文件全绿；
4. 此时已可交付"按用户名授权/拒绝"的最小闭环。

### 增量交付

1. Setup + Foundational → 底座就绪；
2. US1 → 独立验证 → 可演示（授权生效）；
3. US2 → 独立验证 → 可演示（`disable` 紧急关停、`everyone` 放开）；
4. US3 → 独立验证 → 可演示（异常可观测、日志可追溯）；
5. 每个故事都不破坏前一个故事的验收。

### 多人协作

- Phase 1~2 由一人主推（文件少、强顺序）；
- US1 完成后，US2（策略/合成）与 US3（异常/日志）可两人并行，但 `scope-guard-policy.spec.ts`、
  `scope-guard-catalog.spec.ts`、`tool-scope-guard.spec.ts` 分别被两个故事追加，需按"各改各的文件段"约定切分，
  或改为顺序推进以避免同一文件冲突。

---

## 验收清单（全部满足才算完成）

- [X] `FR-001`~`FR-025` 与 `SC-001`~`SC-008` 均有对应任务与验证证据（映射见上表）
- [X] 三个故事各自的**自动化**独立验证均通过（手验三项待真实 MCP 环境，见下）
- [ ] 判定矩阵 11 行（`data-model.md` §3.3）在单测中逐行覆盖（第 9/11 行已覆盖；其余逐行见 `scope-guard-*.spec.ts`）
- [X] 契约 C1~C10（`contracts/scope-guard.md` §8）全部有断言（C11 可选，未加）
- [X] 解耦：`domain/scope-guard/**` 无反向依赖；`agent-factory.ts` 仅 3 处装配点（+37/−6 行，含注释与守卫构造块）
- [X] 门禁全绿、覆盖率 ≥ 80%、单文件 ≤ 500 行、`SC-004` 实测值已回填

---

## 基线记录（T001 回填）

| 项 | 结果 |
|---|---|
| 改动前 `npm run lint` | 未单独录制（开发直接开始，未先跑基线） |
| 改动前 `npm run typecheck` | 未单独录制 |
| 改动前 `npm run test` | 未单独录制 |
| 改动后（2026-11-08） | `lint` 0 error；`typecheck` 0 error；单测 **77 文件 / 1060 用例**（新增 5 个 spec 后）→ 全量覆盖跑 **98 文件 / 1284 用例全绿**；集成 **21 文件 / 224 用例全绿**；`build` 通过；总覆盖率 85.23%（新增模块 93.7%~100%） |

## 手验记录（T017 / T022 / T028 回填）

| 场景 | 配置要点 | 结果 | 证据（日志/截图路径） |
|---|---|---|---|
| A 授权放行 | `scope: [admin]` | **未执行**（需真实 MCP 服务 + 前端） | 自动化等价：`scope-guard-catalog.spec.ts`「用户名命中 → allow」 |
| B 未授权拒绝 | `scope: [zpf]` | **未执行** | 自动化等价：`scope-guard-loop.spec.ts`「未授权 → status=error」 |
| C `disable` 优先 | `scope: [everyone, disable]` | **未执行** | 自动化等价：`scope-guard-policy.spec.ts`「disable 优先于 everyone」 |
| D `everyone` 放开 | `scope: [everyone]` | **未执行** | 自动化等价：`scope-guard-policy.spec.ts`「everyone 放行」 |
| E 配置不可用 | 缺条目 / 坏 YAML | **未执行** | 自动化等价：`scope-guard-catalog.spec.ts`「no_entry / no_securities」 |
| F 非本体工具回归 | 内置工具 / 无同名 MCP 工具 | **未执行** | 自动化等价：`tool-scope-guard.spec.ts`「非本体工具直接透传」+ 集成测试全绿 |

## 解耦校验记录（T031 回填）

| 检查 | 命令 | 结果 |
|---|---|---|
| 反向依赖 | 检索 `agent-backend/src/domain/scope-guard/**` 是否引用 `infra` / `intent-focus` / `mcp` / `@earendil-works` / `fastify` / `pino` | **0 命中** |
| 装配改动范围 | `git diff --numstat agent-backend/src/infra/agent-factory.ts` | **+37 / −6**（3 个装配点：构造 guard、`run` 传参、装配末端 `guardTools`） |
| 复用重构幅度 | `git diff --numstat agent-backend/src/domain/intent-focus/ontology-loader.ts` | **+18 / −55**（净减 37 行，重复的枚举/解析被收敛到 `ontology-files.ts`） |
