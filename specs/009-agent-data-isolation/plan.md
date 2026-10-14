# 实现计划：按数字人隔离用户数据（历史会话与文件空间）

**Branch**: `009-agent-data-isolation` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: 特性规格 `specs/009-agent-data-isolation/spec.md`（6 个用户故事 / **31 条功能需求** / **11 条成功标准**；澄清共 5 项且全部确认：`/speckit.specify` 阶段 **Q1=A** 存量数据迁移、**Q2=A** 数字人级目录由运行环境惰性创建、**Q3=A** 数据侧身份＝数字人名称；`/speckit.clarify` 阶段 **对话中禁止切换＝严格禁用**、**空对话＝视图态（不落盘）**）

## 摘要

把运行环境（`agent-backend`）的用户数据从"用户级共享一份"改为**按（用户，数字人）二元归属**：

```text
改前： users/{uid}/user-data/{数据准备|共享空间|临时空间|threads}
改后： users/{uid}/user-data/{数字人名称}/{数据准备|共享空间|临时空间|threads}
```

四个支点：

1. **路径工厂（唯一事实源）**：`domain/dirs.ts` 的 `userDataDir` / `threadDir` 增加 `agentName`，全仓库约 40 处调用随之收敛；数字人级目录由**运行环境按需惰性创建**（Q2=A）。
2. **会话归属由"元数据字段"改为"目录位置"**：`meta.agent_name` 从"最近一轮使用"反转为**只读归属键**，跨数字人访问在路径层就解析不到（天然 404，不泄露存在性），不需要额外的过滤层。
3. **聊天前台：对话中禁止切换；切换即进入新的空对话视图（视图态，不落盘）**：仅当"当前对话为空且无进行中轮次"时切换入口可用（FR-015），切换后进入视图态空对话（FR-010）并同步刷新历史列表与文件空间视角，真实会话在**首条消息**时才创建（FR-016）。
4. **存量数据一次性迁移**：按「归属数字人」（当前选中 → 唯一 → 名称升序第一；清单为空则原地保留待以后迁移）做**逐项原子改名**，幂等、可重复执行、不丢不重。

平台侧（`admin-backend` / `admin-frontend`）按 Q2 结论**零改动**，仅以回归用例确认"部署/撤回只写数字人**配置**目录、对数据目录零写入"（FR-030/031/043、用户故事 6）。
**零新增依赖**（宪章原则六）。

## 技术上下文（Technical Context）

**Language/Version**：后端 Node ≥ 20 + TypeScript 6（ESM，`tsc` 直出）；前端 Vue 3.5 + TypeScript 6 + Vite 8（`vue-tsc`）。

**Primary Dependencies**：后端 Fastify 5 / `zod` / `pino`；前端 Vue 3 + 既有 `ant-design-vue` / `tailwindcss` / `axios`。**本次零新增依赖**——隔离由"目录归属 + 既有路径解析 + 既有 `fs` 原子改名"实现。

**Storage**：文件系统（无数据库参与本次改动）。

- 数字人配置：`users/{uid}/agents/{agentName}/`（不动）
- 数字人数据：`users/{uid}/user-data/{agentName}/`（**本次新增的归属层**）
- 会话存储：`users/{uid}/user-data/{agentName}/threads/{threadId}/`（`meta.json` / `history.jsonl` / `tool-events.jsonl` / `summary.json` / `next-actions.json`）
- 唯一 SQLite（`usage.db`）为调用统计，**不在本次范围**

**Testing**：Vitest 5。后端 `tests/unit`（纯逻辑与存储）+ `tests/integration`（端点，Fastify `inject`）；前端与源码同目录 `*.spec.ts`。既有测试全部用 `mkdtempSync` 自建临时根（无共享 helper）。**不得依赖真实外部 LLM**（本次不涉及模型调用）。

**Target Platform**：Linux 容器（交付）／Windows 宿主机（本地测试与门禁）。本特性**引入平台相关行为**（目录改名、非 ASCII 目录名、大小写敏感性），风险与被否决方案见「复杂度跟踪 · 平台差异风险登记」。

**Project Type**：四侧一体的 Web 应用（`agent-backend` / `frontend` / `admin-backend` / `admin-frontend`）。

**Performance Goals**：

- 受影响的端点：`POST /api/agents/:name/select`、`POST /api/threads`、`GET /api/threads`、`GET /api/files/workspace`、`GET /api/files/list`、`POST /api/files/upload` ⇒ 复测并以**本机口径**记录 P95（同机、冷启动后预热 5 次、样本 ≥ 20 次、取 95 分位），目标 **P95 ≤ 500ms**（宪章原则五；端到端的"切换后 1 秒内可交互"由 SC-002 单独度量）；
- 路径解析为**纯字符串拼接**，MUST NOT 引入逐请求的目录扫描；数字人存在性校验复用既有 `loadAgentConfig`（同步读小文件），MUST NOT 为每次请求遍历用户目录；
- 迁移只在**启动期**与**切换数字人成功后**各触发一次，判定为 `existsSync` + `readdirSync`，条目数量级为"每用户 4 个源目录"，MUST NOT 在请求热路径上做全量扫描。

**Constraints**：

- 单文件 **≤ 500 行**（硬门禁）：`domain/dirs.ts` 实测 **504 行**（超限）⇒ 本次**必须先拆再改**（决策 R8）；`routes/files.ts` 488 行接近上限，改动 MUST 保持精简。
- 覆盖率地板**只上不下**（当前 53 / 59 / 42 / 52，实测 54.28 / 60.47 / 43.03 / 53.17）；新增模块（`data-migration.ts`、`agent-scope.ts`）与改动触达模块 MUST ≥ 80%。
- **零新增依赖**；平台 → 运行环境**单向**且以数字人为单位整体覆盖；平台 MUST NOT 触碰 `user-data/**`。
- 前端 MUST NOT 硬编码后端下发的业务常量（空间名、目录清单），一律消费接口下发值。

**Scale/Scope**：单用户工作台（当前 `admin`）；每用户 ≤ 10 个数字人；每数字人 ≤ 数百个文件、≤ 数百个会话；迁移的存量条目数 = 每用户 4 个一级目录（其子项数量不定）。

## 宪章检查（Constitution Check）

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

### 逐条核对（v2.2.0，九条原则）

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 本目录四件套（plan / research / data-model / contracts / quickstart）全中文；规格已收敛（`[NEEDS CLARIFICATION]` 为 0）；行为变更**回写上游条文 6 处**（清单见 spec.md 文首），含两条结论级推翻（001 的"数据是用户级的"、002 §5 的落点路径） |
| 二 代码质量与模块化边界 | **通过（含门禁驱动的拆分）** | 路径工厂**唯一实现**维持在 `domain/dirs.ts`；「当前数字人作用域解析」收敛为 `domain/agent-scope.ts` 一处（合并现有 `routes/files.ts:99 currentAgentFor` 与 threads/chat 各自的判定）；`dirs.ts` 504 行超限 ⇒ 按"抽纯函数"拆出 `domain/scenario.ts`（R8）；改动不新增第二套判定；前端切换逻辑落在 `useAppSession`（276 行），**刻意不触及**存量超限的 `useChatPanel.ts`（525 行，R10） |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 后端：新增 `unit/data-migration.spec.ts`、`unit/agent-scope.spec.ts`，扩展 `unit/dirs.spec.ts`、`unit/thread-store.spec.ts`、`unit/tmp-cleanup.spec.ts`，新增 `integration/agent-isolation.spec.ts`（跨数字人隔离 + 移除后失败），调整既有 integration 的 fixture（§「测试落点」）；前端：新增 `useAgents.spec.ts`、`useThreads.spec.ts`，扩展 `useAppSession.spec.ts`、`error-message.spec.ts`。**测试全部本地执行**（容器不参与测试） |
| 四 无障碍与可用性 | **通过** | 切换数字人后新对话区 MUST 获得焦点或状态播报（`aria-live`，FR-014）；"数字人不可用"以文本提示呈现（不只靠颜色）；新增无自建控件、复用既有 `<dialog>` 与列表语义 |
| 五 性能与数据一致性 | **通过** | 路径解析为纯拼接，零额外 IO；迁移用**目录级原子改名**（同卷内单条 `fs.renameSync` 原子），失败保持原状、无部分提交；不引入 N+1；切换后新建对话 ≤ 1s（SC-002） |
| 六 技术治理与依赖控制 | **通过** | **零新增依赖**；改名用 `node:fs`、判定用既有 `loadAgentConfig`/`listAgents`、前端无新库 |
| 七 接口契约与前后端一致性 | **通过（四处同步）** | 契约增量（本目录 `contracts/api-delta.md` + 上游 `runtime-api-delta.md` 回写）＋ 前端类型与文案（`utils/error-message.ts`）＋ 后端 schema（`routes/threads.ts`、`routes/agents.ts`）＋ 测试用例**同一次改动**更新；新增错误码 `AGENT_NOT_AVAILABLE` 全局唯一登记 |
| 八 测试与部署的简单可控 | **通过** | 四侧各有单条门禁命令（§「门禁命令」）；门禁从当前源码重建；部署后按 `quickstart.md` 做**非交互冒烟**（HTTP 打点）；容器只做部署与运行 |
| 九 优雅降级与故障可观测 | **通过** | 数字人目录不可创建/不可写 → 可读错误、**MUST NOT 回退到共享目录**（FR-050）；越界拒绝、迁移归属决定与冲突项、移除后发送失败 MUST 落结构化日志（含 uid / agent / 请求线索）；迁移失败保持原状并可重跑；重试与超时无新增（无外部依赖） |

**门禁判定：PASS，无宪章例外。** 「复杂度跟踪」中登记的是**存量超限文件的处置**与**平台差异风险**，不是对原则的豁免。

### Phase 1 设计之后复核

复核结论与上表一致，无新增冲突：

- 设计**没有扩大契约面**到新端点：只改既有端点的**作用域语义**、新增 1 个错误码；
- 设计**没有引入第二套判定**：路径归属（`dirs.ts`）、作用域解析（`agent-scope.ts`）、归属选择（`data-migration.ts`）各自只有一处实现；
- 设计**没有触及更多存量超限文件**：只新增两个小模块（预估 `data-migration.ts` ≈ 180 行、`agent-scope.ts` ≈ 60 行），拆分后的 `dirs.ts` 预估 ≈ 200 行、`scenario.ts` 预估 ≈ 320 行。

## 项目结构（Project Structure）

### 文档（本特性）

```text
specs/009-agent-data-isolation/
├── spec.md                    # 已完成（五项澄清已答复并并入：3 项「澄清结论」+ 2 项「Clarifications」）
├── plan.md                    # 本文件
├── research.md                # Phase 0 输出（R1~R12 决策与被否决方案）
├── data-model.md              # Phase 1：目录布局、实体、字段语义、迁移映射
├── contracts/
│   └── api-delta.md           # Phase 1：对上游契约的**精确增量**（含错误码与兼容口径）
├── quickstart.md              # Phase 1：端到端验收与非交互冒烟
├── checklists/
│   └── requirements.md        # 规格质量检查清单
└── tasks.md                   # Phase 2（/speckit.tasks 生成，非本命令产物）
```

**契约落点说明**：沿用本仓库惯例——**修改上游契约**而非另立一套（先例：007 / 008 改 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`）。本特性的 `contracts/api-delta.md` 记录**精确增量与落点小节**，便于在 1100+ 行的上游契约里定位差异。

### 源码（仓库根）

```text
agent-backend/                                          # 运行环境：归属层 + 迁移 + 作用域
├── src/domain/dirs.ts                                  # 改：路径工厂加 agentName；ensureUserDirs 只建 agents/；新增 ensureAgentDataDirs；scenario 部分拆出后 re-export
├── src/domain/scenario.ts                              # 新：从 dirs.ts 拆出的场景解析（Scenario/loadScenario/uploadExtensionsOf/parseSpaceDir/listAvailableDirs/DirValidationError）
├── src/domain/thread-store.ts                          # 改：全部方法加 agentName；threadsRoot 走数字人目录；agent_name 只读（touch 不再覆写）；list 只返回有消息的会话
├── src/domain/history.ts                               # 改：filePath(uid, agent, threadId)
├── src/domain/summary.ts                               # 改：同上
├── src/domain/tool-events.ts                           # 改：同上；artifacts 工厂签名补 agentName
├── src/domain/next-actions.ts                          # 改：同上
├── src/domain/file-access.ts                           # 改：FileAccessOptions 加 agentName；dataRoot = userDataDir(root, uid, agent)
├── src/domain/agent-scope.ts                           # 新：resolveAgentScope(ctx, userId)（未选中 409 / 不可用 409 的唯一实现）
├── src/domain/data-migration.ts                        # 新：resolveOwnerAgent + migrateUserDataLayout（幂等、逐项原子改名、审计日志）
├── src/routes/threads.ts                               # 改：create/list/detail/rename/delete 一律以当前作用域定位；agent_name 不再决定归属
├── src/routes/chat.ts                                  # 改：messages/stop/interaction 走 resolveAgentScope；会话归属随目录
├── src/routes/files.ts                                 # 改：fileAccessFor 注入 agentName；currentAgentFor 改为复用 agent-scope
├── src/routes/files-put.ts                             # 改：FileAccess 注入 agentName
├── src/routes/agents.ts                                # 改：select 成功后建骨架 + 触发一次幂等迁移（归属判定①）
├── src/server.ts                                       # 改：toolEvents.artifacts 签名、tmp 清理遍历“用户 × 数字人”、main() 启动期迁移接线
├── src/domain/produced.ts / workspace-view.ts / tool-context.ts   # 观察项：仅当签名变化时小改（相对路径不变则零改动）
└── tests/{unit,integration}/**                          # 改/新：见「测试落点」

frontend/                                                # 聊天前台：对话中禁止切换；切换即进入空对话视图（不落盘）
├── src/composables/useAppSession.ts                     # 改：onSwitched = startNew()（清空进入视图态，不建会话）+ 刷新列表 + 重取文件空间；注入"是否已有消息"
├── src/composables/useThreads.ts                        # 改：新增 startNew()＝clearActive()；错误映射补新码
├── src/composables/useAgents.ts                         # 改：switchingDisabled 扩展（一轮进行中 ∨ 已有消息）+ 成功与禁用文案
├── src/components/chat/AgentPanel.vue                   # 改：切换按钮禁用态 + 可读原因提示（含辅助技术可感知）
├── src/utils/error-message.ts                           # 改：新增 AGENT_NOT_AVAILABLE 文案（+1 行常量 + 1 行注释）
├── src/api/threads.ts                                   # 观察项：list() 不传 agent（现状即如此）；create(agentName) 保留
└── src/**/*.spec.ts                                     # 改/新：见「测试落点」（含新增 AgentPanel.spec.ts）

admin-backend/ · admin-frontend/                         # **零改动**（Q2=A）：回归确认部署/撤回对 user-data 零写入
```

**结构决策（Structure Decision）**：

- **保持既有分层**，不引入新目录：后端 `routes → domain → infra`；前端 `components → composables → api`。
- **归属由目录结构承载，而不是由字段承载**：会话落在 `user-data/{agent}/threads/` 后，"跨数字人访问"在路径解析阶段即不可能命中，无需在业务层再加"过滤/鉴权"分支——这同时消除 FR-021（不泄露存在性）的实现风险。
- **数字人名称即路径段**：平台已保证名称合法（不含路径分隔符）且**创建后不可修改**（001 `FR-015`），因此名称可作为稳定的目录身份（Q3=A）；运行环境 MUST NOT 自行归一化或改写名称。
- **迁移是一次性的结构搬迁，不是兼容层**：不保留"读写双布局"的兼容代码（否则会形成两套路径口径，违反宪章原则二的唯一职责来源）。

## 技术决策（D1~D14）

> 完整推理、备选方案与被否决理由见 [research.md](./research.md)（R1~R12 与本节 D 编号一一对应）。

| 编号 | 决策 | 理由 | 被否决的方案 |
|---|---|---|---|
| **D1** | 用户数据归属键＝**（用户标识，数字人名称）**；布局 `users/{uid}/user-data/{agentName}/{三空间, threads}` | 需求第 5 条给定的布局；名称稳定且不可改 | 用平台内部 ID 作目录名（与需求不符、需额外映射）；哈希名（不可读、排障成本高） |
| **D2** | 会话存储**一并下沉**到数字人目录：`user-data/{agent}/threads/{threadId}/` | 结构性隔离（路径即归属），跨数字人访问天然 404 | 会话留在用户级 + 用 `meta.agent_name` 过滤（两套判定、可枚举、与 FR-020/021 有冲突） |
| **D3** | `meta.agent_name` 语义反转为**只读归属键**；`touch()` 不再覆写；`list` 不再接受"可选过滤" | 归属不可在生命周期内变更（FR-022） | 保留"最近使用"语义（FR-022 直接不成立） |
| **D4** | 新增 `domain/agent-scope.ts#resolveAgentScope`：未选中 → `409 AGENT_NOT_SELECTED`；选中但数字人不可用 → `409 AGENT_NOT_AVAILABLE` | 单一实现（FR-023）；合并既有 `files.ts:99` 与 threads/chat 的分散判定 | 各路由各写一份判定（双实现漂移） |
| **D5** | 路径工厂加参：`userDataDir(root, uid, agent)`、`threadDir(root, uid, agent, threadId)`；新增 `ensureAgentDataDirs` | 支点最小、影响面可枚举 | 引入 `DataScope` 对象贯穿各存储（改动更大、与既有 `PoolKey` 语义重叠） |
| **D6** | 数字人级目录**惰性创建**：`select` 时建骨架；存储层写路径前兜底 `mkdir`（幂等） | Q2=A；平台零触碰数据目录 | 平台部署时创建空骨架（违背 Q2 结论、需改两侧） |
| **D7** | 存量迁移＝**逐项原子改名**（源子项 → 目标同名子项），目标已存在即**跳过并告警**；空壳源目录删除；幂等判据＝源不存在 | 同卷内单条 `rename` 原子；可中断续跑；不复制、不占双倍空间 | 复制后删除（非原子、中断留半成品）；兼容层读写双布局（两套口径） |
| **D8** | 迁移触发点两处：**启动期**（`main()`，覆盖②唯一→③名称升序第一）与**切换数字人成功后**（覆盖①当前选中） | ① 在启动期不可达（选中态是进程内存），放到 select 后调用才让 FR-040 的①语义真实生效 | 只在启动期（①成死代码）；只在首次访问（时序不确定） |
| **D9** | 平台侧零改动；`admin-*` 仅补回归断言 | Q2=A 的直接推论 | 让平台创建/清理数字人数据目录 |
| **D10** | 前端"切换即进入空对话视图"落在 `useAppSession.onSwitched`（`useThreads.startNew()`＝仅清空）；**不触及** `useChatPanel.ts`（525 行存量超限） | 把改动放进未超限文件，避免借改动做拆分重构 | 改 `useChatPanel`（触发 500 行门禁与拆分） |
| **D11** | `POST /api/threads` 的 `agent_name` 字段**保留但不再决定归属**：归属一律取服务端当前选中；不一致时落 `warn` 并以服务端为准 | 保持既有字段（SC-008"字段逐字不变"），且不静默（原则九） | 删除该字段（破坏既有契约）；客户端值优先（可被误用、与 FR-003 冲突） |
| **D12** | 跨数字人会话/文件一律呈现为**不存在或目录不开放**（404 / 403 `DIR_VALIDATION`），不新增"无权限"类语义 | FR-021 不泄露存在性；复用既有错误码 | 新增 `403 AGENT_SCOPE_FORBIDDEN`（会泄露"该会话存在"） |
| **D13** | **对话中禁止切换（FR-015）**：`useAgents` 的 `switchingDisabled` 由"一轮进行中"扩展为"一轮进行中 **∨ 当前对话已有消息"；"是否已有消息"由 `useAppSession` 注入（不在 agents store 里耦合会话状态）；禁用态与**原因文案**由 `AgentPanel.vue` 呈现 | 落实 FR-015；判定留在 composable 层、只在视图层呈现 | 让服务端拒绝（入口仍可点、无提示，体验差）；把判定写进 `useChatPanel.ts`（存量超限） |
| **D14** | **空对话＝视图态（FR-010 / FR-016）**：`useThreads.startNew()` 只 `clearActive()`、**不**调用创建接口；会话仍由既有"首条消息且无 activeId"路径创建；历史列表只呈现**有消息**的会话，判定基于会话**元数据**且由 `thread-store.list` **单点实现**：判据＝"尚无任何轮次"（`created_at` 与 `updated_at` 相等；毫秒同刻不构成风险，因为一轮必经模型调用；将来若引入不更新 `updated_at` 的写路径 MUST 复核该判据） | 与现状实现一致（现在就是首次发送才建会话）；从根上避免"为切换而留下空会话"；判据只需读 `meta.json`，零额外 IO | 切换时立即 `POST /api/threads`（每次切换留下空会话、列表被塞满）；列表层逐会话读 `history.jsonl` 判断消息数（N+1，违原则五） |

## 影响面清单（文件级）

> "改"＝必须动；"观察"＝只有在签名被迫变化时才动（默认零改动）。

### agent-backend

| 文件 | 动作 | 要点 |
|---|---|---|
| `src/domain/dirs.ts` | 改 | `userDataDir`/`threadDir` 加 `agentName`；`ensureUserDirs` 只建 `agents/`；新增 `ensureAgentDataDirs`；拆出 scenario 部分并 re-export |
| `src/domain/scenario.ts` | 新 | 承接 `Scenario` / `loadScenario` / `uploadExtensionsOf` / `parseSpaceDir` / `listAvailableDirs` / `DirValidationError` / `SCENARIO_FIELD_TYPES` |
| `src/domain/agent-scope.ts` | 新 | `resolveAgentScope`（唯一判定入口） |
| `src/domain/data-migration.ts` | 新 | `resolveOwnerAgent` + `migrateUserDataLayout` + 审计日志 |
| `src/domain/thread-store.ts` | 改 | 全方法加 `agentName`；`threadsRoot` 走数字人目录；`touch` 不再改 `agent_name`；**`list` 只返回有消息的会话**（元数据判据，零额外 IO） |
| `src/domain/history.ts` / `summary.ts` / `tool-events.ts` / `next-actions.ts` | 改 | `filePath(uid, agent, threadId)`；`tool-events` 的 `artifacts` 工厂签名补 `agentName` |
| `src/domain/file-access.ts` | 改 | `FileAccessOptions.agentName` 必填；`dataRoot` 按数字人 |
| `src/routes/threads.ts` | 改 | 7 个端点改走作用域；`create` 的归属取服务端 |
| `src/routes/chat.ts` | 改 | 3 个端点改走作用域 |
| `src/routes/files.ts` | 改 | `fileAccessFor` 注入数字人；`currentAgentFor` 复用 `agent-scope` |
| `src/routes/files-put.ts` | 改 | 同上（1 处装配） |
| `src/routes/agents.ts` | 改 | `select` 成功 → `ensureAgentDataDirs` + 幂等迁移（①） |
| `src/server.ts` | 改 | `toolEvents.artifacts` 签名；`tmp-cleanup` 遍历用户 × 数字人；`main()` 接线启动期迁移 |
| `src/domain/produced.ts` / `workspace-view.ts` / `tool-context.ts` | 观察 | 相对路径不变 → 预期零改动 |

### frontend

| 文件 | 动作 | 要点 |
|---|---|---|
| `src/composables/useAppSession.ts` | 改 | `onSwitched`：`await threads.startNew()`（**仅清空进入视图态，不建会话**）+ `await workspace.load()`；向 `useAgents` 注入"当前对话是否已有消息" |
| `src/composables/useThreads.ts` | 改 | 新增 `startNew()`＝`clearActive()`（**不落盘**）；列表只呈现有消息的会话 |
| `src/composables/useAgents.ts` | 改 | 切换禁用判定扩展为"一轮进行中 **∨ 当前对话已有消息**"（FR-015），被禁止时给出原因；成功提示文案改为"已切换数字人，已开启新对话" |
| `src/utils/error-message.ts` | 改 | 新增 `AGENT_NOT_AVAILABLE: '该数字人已不可用，请重新选择'` |
| `src/components/chat/AgentPanel.vue` | 改 | 切换按钮**禁用态** + 可读原因提示（MUST NOT 仅置灰，FR-007/FR-015）；候选列表与切换入口不变 |
| `src/components/layout/{HistorySidebar,WorkspacePanel}.vue` | 观察 | 列表与视图由 `onSwitched` 驱动刷新，组件自身零改动 |

## 迁移口径（Q1=A 落地）

**归属判定（`resolveOwnerAgent`）**

| 顺序 | 条件 | 结果 |
|---|---|---|
| ① | 该用户当前选中的数字人，且仍在可用清单内 | 用它 |
| ② | 可用清单中**唯一**的数字人 | 用它 |
| ③ | 可用清单有多个且无选中态 | 取**名称升序第一**（`listAgents` 已是名称升序），并落 `info` 日志与审计记录 |
| 兜底 | 可用清单为空 | **不迁移**：原地保留 + `warn` 告警，等下次触发（`select` 后或下次启动） |

**迁移动作（`migrateUserDataLayout`）**：对 `users/{uid}/user-data/` 下的**四个一级源目录**（`数据准备`、`共享空间`、`临时空间`、`threads`）以及其它任何一级条目：

```text
for 源子项 in readdir(源目录):            # 逐项，不是整体
  if 目标存在同名项: 跳过 + warn（不合并、不覆盖）
  else: fs.renameSync(源子项, 目标子项)   # 同卷原子
迁移后源目录为空 → rmdir（消除用户级落点，满足 FR-002）
```

- **幂等**：源不存在 ⇒ 直接返回（可重复执行）；重复执行不产生重复条目。
- **中断安全**：逐项改名，任一时刻的中断只造成"部分已迁"；重跑续迁，MUST NOT 丢条、MUST NOT 覆盖。
- **审计**：归属决定（含③的歧义判定）、每个用户的迁移前后条目数、跳过的冲突项 MUST 落结构化日志（`event: 'data.migration.*'`）。
- **不做**：MUST NOT 读取/改写平台侧任何数据；MUST NOT 迁移 `agents/`（配置目录，不动）。

**触发点与 FR-040 的①可达性**：启动期进程内无选中态（`CurrentAgentStore` 是内存 Map），故启动期实际走②③；`POST /api/agents/:name/select` 成功后在 `ctx.currentAgent.select()` **之后**调用同一个迁移函数，此时①的取值即用户刚选中的数字人——这正好覆盖"启动时清单为空 → 管理员随后部署了数字人 → 用户首次选择"的路径（FR-040 兜底分支的收口）。

## 测试落点

### agent-backend

| 测试文件 | 动作 | 覆盖 |
|---|---|---|
| `tests/unit/dirs.spec.ts` | 改 | 新路径工厂（含 `agentName`）、`ensureAgentDataDirs` 幂等、`ensureUserDirs` 不再建用户级空间、`parseSpaceDir`/`listAvailableDirs` 随数字人（既有 16 例按新布局调整） |
| `tests/unit/data-migration.spec.ts` | 新 | ①②③ 三条判定路径 + 空清单原地保留；幂等（跑两遍）；冲突项跳过 + warn；空壳源目录清除；中断续跑 |
| `tests/unit/agent-scope.spec.ts` | 新 | 未选中 → `AGENT_NOT_SELECTED`；选中但目录缺失/配置损坏 → `AGENT_NOT_AVAILABLE`；正常返回 |
| `tests/unit/thread-store.spec.ts` | 改 | 会话落在数字人目录；`list` 只返回本数字人；`touch` 不改 `agent_name`；删除连带清理（既有 5 例扩展） |
| `tests/unit/tmp-cleanup.spec.ts` | 改 | 按数字人逐一清理（多数字人只清本目录、不漏清） |
| `tests/integration/agent-isolation.spec.ts` | 新 | 三个空间跨数字人互不可见；跨数字人会话语义（404）；移除数字人后发送消息 → 409 `AGENT_NOT_AVAILABLE` + 可读文案；数据保留（文件数/会话数逐项一致） |
| `tests/integration/files-scenario.spec.ts` 等 | 改 | fixture 的 `user-data` 路径改到数字人一级（8 个 describe 的取数逻辑） |
| `tests/integration/deploy-*.spec.ts`（admin-backend） | 改 | 补断言：撤回/部署前后 `user-data/{agent}/**` 逐项不变（用户故事 6） |

### frontend

| 测试文件 | 动作 | 覆盖 |
|---|---|---|
| `src/composables/useAgents.spec.ts` | 新 | `switchTo` 成功即调 `onSwitched`；**当前对话有消息 / 一轮进行中时禁用且不发 `select`**；重复选择同一数字人不触发（幂等）；失败路径 toast |
| `src/composables/useThreads.spec.ts` | 新 | `startNew()` 只清空、**不创建会话**；首条消息才创建；列表不呈现无消息的空会话 |
| `src/composables/useAppSession.spec.ts` | 改 | `onSwitched` 进入空对话视图（**断言未调用创建接口**）+ 列表刷新 + 文件空间重取（既有 2 例扩展） |
| `src/components/chat/AgentPanel.spec.ts` | 新 | 禁用态与原因文案可见（不只置灰）；空对话态可切换 |
| `src/utils/error-message.spec.ts` | 改 | 新错误码文案（+1 例） |

### 门禁命令（本地，逐侧单条）

```text
agent-backend  : npm run typecheck && npm run lint && npm run test:all && npm run build
frontend       : npm run lint && npm run typecheck && npm run test && npm run build
admin-backend  : npm run typecheck && npm run lint && npm run test
admin-frontend : npm run lint && npm run typecheck && npm run test
部署冒烟        : 见 quickstart.md（非交互 HTTP 打点）
```

## 覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）共 20 个模块尚无测试，其**补测顺序与范围** MUST 在特性的 `plan.md` 给出结论；**MUST NOT** 发起存量补齐专项。
（先例：`specs/002-conversation-runtime/plan.md` §4 已确立顺序；`specs/008-data-prep-upload-types/plan.md` §4 已重申常设口径。）

**本次结论**（沿用 008 §4，**不重新排序、不扩大范围**）：

| 项 | 结论 |
|---|---|
| 顺序与范围 | **沿用** `specs/002-conversation-runtime/plan.md` §4 已确立的顺序（① 网络与契约边界 → ② 产出与预览链路 → ③ 会话与流式 → ④ 其余），本次**不重新排序** |
| 机制 | **随改动触达即补**，不立项专项。本次触达 `frontend/src/composables/{useThreads,useAgents,useAppSession}.ts` ⇒ 新建 `useThreads.spec.ts`、`useAgents.spec.ts`，扩展 `useAppSession.spec.ts`，**只覆盖本次改动行为**（视图态新建、禁用判定、切换后刷新），**不为这些模块的其余函数补测** |
| 逐文件 80% 清单 | `frontend/vite.config.ts` 的 80% 门禁清单（现 `:77-102`，20 项）**本次不新增条目**：三个 composable 均属存量模块、其余函数未被改动，强行纳入会与"不追溯"红线冲突。清单内既有条目 `src/utils/error-message.ts`（`:80`）本次新增一条文案常量，MUST 维持 ≥ 80% |
| 新增文件 | `frontend/src/components/chat/AgentPanel.spec.ts` 属**新增文件的测试**（非存量补测），按原则三正常计入覆盖 |
| 地板 | 全局地板（53 / 59 / 42 / 52，实测 54.28 / 60.47 / 43.03 / 53.17）**只上不下**；本地跑 `test:coverage` 后按实测登记，若因新增测试上调则回写 `frontend/vite.config.ts` |

---

## 复杂度跟踪（Complexity Tracking）

| 项 | 必要性 | 被否决的更简方案 |
|---|---|---|
| **拆分 `domain/dirs.ts`（504 行 → 拆出 `scenario.ts`）** | 单文件 500 行是硬门禁，而本次必须改 `dirs.ts`（路径工厂）；宪章治理规定"改动涉及的文件须合规" | ① 继续在 504 行的文件里加代码（直接违规）；② 不动 `dirs.ts` 而在别处另起一套路径拼接（破坏唯一事实源，制造第二套口径） |
| **迁移触发点有两处（启动期 + `select` 后）** | 启动期无选中态 ⇒ FR-040 的①在启动期不可达；若只在启动期实现，①成为死代码且"空清单 → 后来获得数字人"的数据将永不迁移 | 只在启动期（① 死代码、兜底分支不闭环）；只在首次访问（时序不确定、需引入额外的 per-user 标志位） |
| **迁移使用 `fs.renameSync`（逐项原子改名）** | 同卷内单条改名是原子的，可中断续跑、不占双倍空间、无需回滚 | 复制 + 删除（非原子、中断留半成品、双倍磁盘）；整目录改名（目标已存在时无解，无法续跑） |
| **前端新增 `startNew()` 而不改 `useChatPanel.ts`** | `useChatPanel.ts` 存量 525 行（超限），本次改动 MUST NOT 触发它的拆分重构 | 在 `useChatPanel.onSwitchAgent` 里新建对话（会改动超限文件，违反治理"不得借改动之机做大范围重构"） |
| **`routes/files.ts` 488 行（接近上限）** | 只需小改（注入数字人、复用作用域）；若最终超 500 需按"抽纯函数"处理 | 为规避行数而把 handler 搬走（无收益的大改动） |

### 平台差异风险登记（宪章原则三要求）

| 风险 | 现象 | 本次处置 |
|---|---|---|
| **`fs.renameSync` 跨卷不可用** | 源与目标若跨文件系统会抛 `EXDEV` | 本特性下源与目标同在 `OPT_AGENT_ROOT/users/{uid}/user-data/` 内，**必然同卷**；迁移 MUST 校验并**在 `EXDEV` 时明确报错并保持原状**（MUST NOT 静默降级为复制） |
| **非 ASCII 目录名（中文空间名 / 中文数字人名）** | Windows 与 Linux 的编码/规范化差异 | 迁移与路径拼接 MUST 使用 `Buffer` 之外的纯字符串路径 + 既有 `fs-safe.ts` 口径；集成测试含中文数字人名用例。**（2026-10-14 实现期实测追加）** 本机 `fs.rmSync` / `fs.cpSync` 对**含中文的路径会静默失效**（`rmSync` 在 vitest fork 子进程内甚至触发原生崩溃，`exit code 0xC0000409`）；`mkdirSync` / `writeFileSync` / `readdirSync` / `renameSync` / `rmdirSync` 实测正常。因此迁移实现只用 `renameSync` + `rmdirSync`，测试删除/复制中文路径一律走 `fs-safe` 的 `removeDirRecursiveAsync` / `removeFileSafeAsync`（测试用例 `migration.spec.ts`、`agent-removed.spec.ts`、`isolation-observability.spec.ts` 均已按此落地） |
| **大小写敏感性** | Linux 上 `Agent` 与 `agent` 视为两个数字人，Windows 上视为一个 | 平台侧已强制名称唯一；运行环境 MUST 按平台下发名称**原样**使用，MUST NOT 归一化；本地（Windows）测试通过与 Linux 行为差异由集成测试夹具覆盖名称大小写混用场景 |
| **行尾符与目录清单排序** | 迁移的判定③依赖"名称升序第一"⇒ 排序口径须跨平台稳定、可复现 | 复用 `listAgents` 既有的 `a.agent_name.localeCompare(b.agent_name)`（`agent-catalog.ts:84`）作为排序唯一来源，MUST NOT 另写一套；跨平台一致性由测试锁定"同一输入 → 同一结果"（R12） |
| **部署后冒烟** | 容器内无法跑测试 | 部署后按 `quickstart.md` 做一次非交互 HTTP 打点（仅确认可达与状态码），MUST NOT 替代测试结论 |

## 风险与依赖

| 项 | 说明 | 处置 |
|---|---|---|
| 上游条文回写 | 001 的 FR-028 / 假设 / 关键实体、SC-012、SC-019、data-model §三类数据边界；002 §5.1/§5.2 | 与本次实现同批修改（宪章原则一、原则七）；清单见 spec.md 文首 |
| 存量真实数据（`agent-backend/.opt-agent/users/admin/user-data/`） | 本机存在真实文件与 6 个会话 | 迁移实现完成后的**首次本地启动**即完成迁移；`quickstart.md` 给出迁移前后的核对步骤 |
| 前端持久化的 `activeThreadId` | 切换后新建对话会覆写它；重启后恢复的会话可能属于别的数字人 | 恢复失败（404）走既有降级（清空 + 保留输入）；`MUST NOT` 引入按数字人的多键持久化（明确不做，登记在此） |
| 会话运行中的切换 | 切换 MUST NOT 打断在途轮次（FR-014） | 沿用既有"仅在实例取用/轮次边界生效"的口径，不新增中断逻辑 |

## 待办与未决

- 无未决澄清（spec 的 3 项已答复并落定）。
- 需在 `/speckit.tasks` 阶段细化为可勾选任务：迁移模块、作用域模块、`dirs.ts` 拆分、四个存储、六个路由、前端三处、测试与契约回写。

## 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-14 | 初稿 | 由 `/speckit.plan` 生成：技术上下文（零新增依赖、文件系统存储、Vitest 5）、宪章九条逐条核对（PASS）与 Phase 1 复核、D1~D12 技术决策、文件级影响面清单、迁移口径（含①可达性的两处触发点）、测试落点与门禁命令、复杂度跟踪与平台差异风险登记 |
| 2026-10-14 | v1.1 | 按 `/speckit.clarify` 的两项追加澄清同步：**FR-015**（对话中禁止切换）→ 新增 **D13**，影响面补 `useAgents`（禁用判定扩展）、`AgentPanel.vue`（禁用态 + 原因文案）、`useAppSession`（注入"是否已有消息"）；**FR-010/FR-016**（空对话＝视图态、不落盘）→ 新增 **D14**，`useThreads.startNew()` 改为仅 `clearActive()`，测试落点同步（新增 `AgentPanel.spec.ts`、扩展 `useAgents/useThreads/useAppSession` 用例）；摘要第 3 点改写 |
| 2026-10-14 | v1.2 | 按 `/speckit.analyze` 的收口建议更新：新增 **「覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）」** 一节（补足宪章仍生效待办的结论）；**D14** 定死空会话判据（`created_at` 与 `updated_at` 相等，`thread-store.list` 单点实现，零额外 IO）；**性能目标**改为可复测的本机口径（端点清单 + 预热 5 次 / 样本 ≥ 20 / 取 P95），端到端 1 秒目标交还 SC-002；**影响面** `thread-store.ts` 行补"`list` 只返回有消息的会话" |
| 2026-10-14 | v1.3 | 实现期复核：**D7 细化**——迁移的"目标已存在即跳过"增加**空目录例外**（目标同名项是空目录——骨架先建出来/中断留下的空壳——则 `rmdirSync` 让位后直接搬入，救回"半成品"；非空仍是硬冲突不覆盖）；平台差异风险表**登记实测发现**（`fs.rmSync`/`fs.cpSync` 对中文路径静默失效，`renameSync`/`rmdirSync` 正常） |
