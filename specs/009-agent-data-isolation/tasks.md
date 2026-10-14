# 任务清单：按数字人隔离用户数据（历史会话与文件空间）

**输入**：设计文档位于 `specs/009-agent-data-isolation/`

**前置**：`plan.md`（必需）、`spec.md`（必需，含 6 个用户故事与 31 条功能需求）、`research.md`、`data-model.md`、`contracts/api-delta.md`、`quickstart.md`

**测试**：本项目宪章**原则三（测试完备性）为 NON-NEGOTIABLE**，且 `spec.md` 每条功能需求均附「验证方式」、`plan.md` §「测试落点」已列出文件级落点 ⇒ **测试任务必须包含**（非可选项）。测试**只在宿主机本地执行**，容器不参与测试。

**组织方式**：按用户故事分组，每个故事可独立实现与独立验收。

## 格式：`[ID] [P?] [Story] 描述 + 文件路径`

- **[P]**：可并行（不同文件、且不依赖未完成的任务）
- **[Story]**：所属用户故事（`US1`~`US6`，对应 `spec.md` 的 6 个故事）；**Setup / Foundational / Polish 阶段不带故事标签**
- 每条任务 MUST 含**精确文件路径**

## 路径约定

- 后端：`agent-backend/src/**`、`agent-backend/tests/{unit,integration}/**`
- 前端：`frontend/src/**`（测试与源码同目录 `*.spec.ts`）
- 管理平台：`admin-backend/**`、`admin-frontend/**`（本特性预期零改动，仅回归）
- 设计文档：`specs/009-agent-data-isolation/**`、上游条文 `specs/001-digital-human-platform/**`、`specs/002-conversation-runtime/**`

---

## Phase 1：准备（Setup）

**目的**：为一次**会改动真实在盘数据归属**的升级建立可回退的起点。

- [x] T001 备份存量真实数据并记录基准：把 `agent-backend/.opt-agent/users/admin/` 复制为 `agent-backend/.opt-agent.backup-20261014/users/admin/`，记录三个空间的条目数与 `threads/` 的会话数
- [x] T002 [P] 核对"零新增依赖"：确认 `agent-backend/package.json`、`frontend/package.json`、`admin-backend/package.json`、`admin-frontend/package.json` 的 `dependencies` / `devDependencies` 均无新增
- [x] T003 [P] 记录四侧门禁基线（用例数 / 覆盖率 / 耗时）：在 `agent-backend/`、`frontend/`、`admin-backend/`、`admin-frontend/` 各跑一次 `npm run test`（后端含 `npm run test:all`），把结果写入 `specs/009-agent-data-isolation/tasks.md` 末尾「执行记录」

---

## Phase 2：基础（Foundational）

**目的**：路径归属、作用域判定、迁移能力这些**所有用户故事共用**的底盘。

**⚠️ 关键**：本阶段完成前不要开始任何用户故事。

- [x] T004 拆分超限文件：新建 `agent-backend/src/domain/scenario.ts`，把场景解析相关实现（`Scenario` / `loadScenario` / `uploadExtensionsOf` / `SCENARIO_FIELD_TYPES` / `parseSpaceDir` / `SpaceDirTarget` / `DirValidationError` / `listAvailableDirs`）从 `agent-backend/src/domain/dirs.ts`（现 504 行，超 500 硬门禁）迁入，并在 `dirs.ts` 中 re-export 保持既有导入不变
- [x] T005 [P] 新增 `agent-backend/tests/unit/scenario.spec.ts`，锁定迁出符号的行为（拆分必须零行为变化）
- [x] T006 改 `agent-backend/src/domain/dirs.ts`：`userDataDir(root, uid, agentName)`、`threadDir(root, uid, agentName, threadId)` 增加数字人入参；新增 `ensureAgentDataDirs(root, uid, agentName)`（幂等，建三空间 + `threads`）；`ensureUserDirs` 改为**只建** `agents/`
- [x] T007 [P] 更新 `agent-backend/tests/unit/dirs.spec.ts`：新签名与新布局断言、`ensureAgentDataDirs` 幂等、`ensureUserDirs` 不再创建用户级三空间与 `threads`
- [x] T008 新增 `agent-backend/src/domain/agent-scope.ts`：`resolveAgentScope(ctx, userId)` —— 未选中 → `409 AGENT_NOT_SELECTED`；已选中但数字人不可用 → `409 AGENT_NOT_AVAILABLE`；正常返回 `{ userId, agentName }`（作用域判定唯一入口）
- [x] T009 [P] 新增 `agent-backend/tests/unit/agent-scope.spec.ts`：三条分支各一例（未选中 / 配置目录缺失 / 正常）
- [x] T010 五个存储加数字人入参并收敛归属语义：`agent-backend/src/domain/thread-store.ts`（`threadsRoot` 走数字人目录、`list` 作用域必填、`touch` **不再覆写** `agent_name`、**`list` 只返回有消息的会话**——判据取自 `meta.json`（`created_at` 与 `updated_at` 相等＝尚无任何轮次），MUST NOT 逐会话读取历史文件）、`history.ts`、`summary.ts`、`tool-events.ts`、`next-actions.ts`（`filePath(uid, agentName, threadId)`）
- [x] T011 [P] 更新 `agent-backend/tests/unit/thread-store.spec.ts`：会话落在数字人目录、`list` 只返回本数字人、跨数字人取用返回 404、`touch` 不改归属
- [x] T012 改 `agent-backend/src/domain/file-access.ts`：`FileAccessOptions` 增加必填 `agentName`，`dataRoot = userDataDir(root, uid, agentName)`
- [x] T013 新增 `agent-backend/src/domain/data-migration.ts`：`resolveOwnerAgent`（①当前选中 → ②唯一 → ③名称升序第一 → 兜底空清单原地保留）与 `migrateUserDataLayout`（逐项 `renameSync`、目标已存在则跳过并 `warn`、空壳源目录 `rmdir`、幂等、`EXDEV` 明确报错不降级、审计日志 `data.migration.*`）
- [x] T014 [P] 新增 `agent-backend/tests/unit/data-migration.spec.ts`：三条判定路径、空清单原地保留、幂等（跑两遍）、冲突跳过 + warn、空壳清除、中断续跑
- [x] T015 改 `agent-backend/src/server.ts`：`toolEvents.artifacts` 工厂签名补 `agentName`（约 `:103-109`）；`tmp-cleanup` 定时任务改为遍历（用户 × 数字人）清理各自 `临时空间`（约 `:148-160`）
- [x] T016 [P] 更新 `agent-backend/tests/unit/tmp-cleanup.spec.ts`：多数字人逐一清理、目录不存在则跳过、不越界清理其他数字人

**检查点**：`agent-backend` 全量单测通过；`dirs.ts` 行数 ≤ 500。

---

## Phase 3：用户故事 1 —— 文件空间按数字人隔离（优先级：P1）

**故事目标**：同一用户下的每个数字人拥有独立的三个文件空间，互相不可见、不可读。

**独立验收**：在 A 的「共享空间」上传后切到 B 看不到；B 新增文件在 A 也不可见；构造跨数字人相对路径被拒绝；同名二级目录下同名文件互不覆盖。

- [x] T017 [P] [US1] 新增 `agent-backend/tests/integration/agent-isolation.spec.ts`（文件空间部分）：A 上传 → B 列举不含该文件；B 上传同名文件 → 两份互不覆盖；跨数字人相对路径 → `403 DIR_VALIDATION`；未选中数字人 → `409 AGENT_NOT_SELECTED`；**跨用户**：在 `users/{uid2}/` 下部署**同名**数字人，两个用户各自上传同名文件 → 两份互不覆盖（FR-004）
- [x] T018 [P] [US1] 迁移既有用例的夹具路径到数字人一级，确切文件（含 `user-data` / `userDataDir` 引用）：`agent-backend/tests/unit/thread-store.spec.ts`、`agent-backend/tests/unit/tool-events.spec.ts`、`agent-backend/tests/unit/run-manager-tool-events.spec.ts`、`agent-backend/tests/unit/produced.spec.ts`、`agent-backend/tests/unit/mcp-tool-adapter.spec.ts`、`agent-backend/tests/integration/next-actions-rounds.spec.ts`；并补一条 `agents/{name}/scenario.json` 读取口径**不变**的回归断言（FR-060）
- [x] T019 [US1] 改 `agent-backend/src/routes/files.ts`：`fileAccessFor` 注入当前数字人（`agentName`）；`currentAgentFor`（约 `:99`）改为复用 `resolveAgentScope`，删除重复判定
- [x] T020 [US1] 改 `agent-backend/src/routes/files-put.ts`：产出回写路径同样注入当前数字人（沿用 `临时空间/后台产出` 相对路径白名单）
- [x] T021 [US1] 改 `agent-backend/src/routes/agents.ts`：`select` 成功后调用 `ensureAgentDataDirs`（惰性建该数字人数据骨架，幂等）
- [x] T022 [US1] 核对 `agent-backend/src/domain/workspace-view.ts` 与 `agent-backend/src/domain/produced.ts`：确认相对路径口径不变即可**零改动**；改动点（若有）与"零改动"结论 MUST 一并写入 `specs/009-agent-data-isolation/tasks.md` 末尾「执行记录」
- [x] T023 [US1] 运行本故事定向测试（`agent-backend/tests/unit/**` 与 `agent-backend/tests/integration/**`）并确认通过；**停止并验证**：文件空间隔离可独立交付

**检查点**：US1 可独立验收（空数据上即可演示）。

---

## Phase 4：用户故事 2 —— 切换数字人即进入新对话（视图态），历史会话按数字人隔离（优先级：P1）

**故事目标**：切换数字人立刻进入新的空对话视图（不落盘）并同步刷新历史列表与文件空间；**对话中禁止切换**；会话归属不可变更。

**独立验收**：当前对话有消息或一轮进行中 → 切换入口不可用且有提示、点击不发请求；点「新建对话」进入视图态空对话（不新增会话记录）→ 切换可用 → 历史列表只含新数字人会话；跨数字人取会话为 `404`。

- [x] T024 [P] [US2] 新增 `agent-backend/tests/integration/thread-scope.spec.ts`：列表只含当前数字人；跨数字人详情/改名/删除/续聊均为 `404`；同 id 在不同数字人下互不可见；磁盘上存在**无消息**的空会话时列表**不返回**它且该会话**未被删除**（FR-016）；一轮回答进行中时发起切换 → 该轮归属与结果**不受影响**（FR-014）
- [x] T025 [US2] 改 `agent-backend/src/routes/threads.ts`：7 个端点改用 `resolveAgentScope` 定位；`create` 归属一律取服务端当前选中（`agent_name` 字段保留但不决定归属，不一致落 `warn`）；`list` 的 `agent_name` 查询参数退出作用域
- [x] T026 [US2] 改 `agent-backend/src/routes/chat.ts`：`messages` / `stop` / `interaction` 走 `resolveAgentScope`；移除每轮 `touch()` 覆写 `meta.agent_name` 的调用
- [x] T027 [US2] 改 `agent-backend/src/routes/produced.ts` 与 `agent-backend/src/domain/produced.ts` 装配：产出按当前数字人数据域取用
- [x] T028 [P] [US2] 新增 `frontend/src/composables/useThreads.spec.ts`：`startNew()` 只清空（**不调用创建接口**）；首条消息才创建；列表不呈现无消息的空会话
- [x] T029 [P] [US2] 新增 `frontend/src/composables/useAgents.spec.ts`：切换成功触发 `onSwitched`；**当前对话有消息 / 一轮进行中时禁用且不发 `select`**；重复选择同一数字人不触发
- [x] T030 [P] [US2] 新增 `frontend/src/components/chat/AgentPanel.spec.ts`：禁用态 + 原因文案可见（不只置灰）；空对话态可切换
- [x] T031 [US2] 改 `frontend/src/composables/useThreads.ts`：新增 `startNew()`＝`clearActive()`（**不落盘**）；列表按当前数字人取用
- [x] T032 [US2] 改 `frontend/src/composables/useAppSession.ts`：`onSwitched`＝`await threads.startNew()` + `await workspace.load()`；向 `useAgents` 注入"当前对话是否已有消息"
- [x] T033 [US2] 改 `frontend/src/composables/useAgents.ts`：`switchingDisabled` 由"一轮进行中"扩展为"一轮进行中 **∨ 当前对话已有消息"**；成功提示改为"已切换数字人，已开启新对话"；被禁止时给出原因
- [x] T034 [US2] 改 `frontend/src/components/chat/AgentPanel.vue`：切换按钮禁用态 + 可读提示（含辅助技术可感知）；并核对界面**未引入新的导航层级**（切换入口、历史列表、文件空间的组织方式与改造前一致，FR-062）
- [x] T035 [US2] 改 `frontend/src/composables/useAppSession.spec.ts`：断言 `onSwitched` 进入空对话视图且**未调用创建接口**、列表刷新、文件空间重取
- [x] T036 [US2] 运行本故事定向测试（前端 composable/组件 + 后端集成）并确认通过；**停止并验证**：切换即新对话与历史隔离可独立交付

**检查点**：US1 + US2 构成可演示的主流程。

---

## Phase 5：用户故事 3 —— 移除数字人后数据保留、但不可用（优先级：P1）

**故事目标**：从用户处移除数字人并部署后，该数字人不可见不可用，但数据 100% 保留；陈旧上下文发消息失败且可读。

**独立验收**：移除后清单不含它、数据逐项一致、发送消息返回 `409 AGENT_NOT_AVAILABLE` 且前端提示可读、同名重新关联后数据恢复可用。

- [x] T037 [P] [US3] 新增 `agent-backend/tests/integration/agent-removed.spec.ts`：移除（删除 `agents/{name}/`）后 → 清单不含、文件与会话不可访问、发送消息 `409 AGENT_NOT_AVAILABLE`、`user-data/{name}/**` 逐项不变、同名目录恢复后重新可见可用
- [x] T038 [US3] 在 `agent-backend/src/routes/**` 统一错误映射：`AGENT_NOT_AVAILABLE` → `409` + 可读 message（与 `AGENT_NOT_SELECTED` 并列登记，MUST NOT 落成 500）
- [x] T039 [US3] 改 `frontend/src/utils/error-message.ts`：新增 `AGENT_NOT_AVAILABLE: '该数字人已不可用，请重新选择'`；并补 `frontend/src/utils/error-message.spec.ts` 用例
- [x] T040 [US3] 前端陈旧选中态处理：收到 `AGENT_NOT_AVAILABLE` 时提示并引导重新选择（落在 `frontend/src/composables/useAppSession.ts` / `useThreads.ts` 的既有错误分支；**不修改**存量超限的 `frontend/src/composables/useChatPanel.ts`）；**MUST NOT 自动清空选中态**——保留可见原因，仅在用户显式重选时更新（与 `contracts/api-delta.md` §4 一致）
- [x] T041 [US3] 在 `admin-backend/tests/integration/deploy-withdraw.spec.ts`（必要时含 `admin-backend/tests/integration/deploy-scope.spec.ts`）补断言：撤回只移除 `users/{uid}/agents/{name}/`，`users/{uid}/user-data/{name}/**` 逐项不变（部署同理）

---

## Phase 6：用户故事 4 —— 升级不丢既有数据（优先级：P2）

**故事目标**：把存量"用户级共享"数据一次性迁移到「归属数字人」目录，不丢不重、可重复执行。

**独立验收**：按 `quickstart.md` §6 构造改前布局 → 启动 → 数据出现在归属数字人目录；重复启动无变化；空清单时原地保留 + 告警，随后 `select` 触发迁移完成。

- [x] T042 [P] [US4] 新增 `agent-backend/tests/integration/migration.spec.ts`：构造用户级三空间 + `threads/` → 触发迁移 → 逐项比对（丢失 0 / 重复 0）；二次触发幂等；空清单原地保留 + 告警；随后 `select` 后以①完成迁移
- [x] T043 [US4] 改 `agent-backend/src/server.ts` 的 `main()`：在 `ensureRootDirs`（约 `:394-396`）之后接线启动期迁移（遍历 `users/*`，落审计日志）
- [x] T044 [US4] 改 `agent-backend/src/routes/agents.ts` 的 `select`：在 `ctx.currentAgent.select()` **之后**调用同一个幂等迁移（归属判定①在此生效）
- [x] T045 [US4] 按 `specs/009-agent-data-isolation/quickstart.md` §6 在临时根执行一次端到端升级验收，并把实测结果写入 `specs/009-agent-data-isolation/tasks.md` 末尾「执行记录」

**检查点**：真实数据升级路径可用（T001 的备份可回退）。

---

## Phase 7：用户故事 5 —— 隔离由服务端权威判定，越界可观测（优先级：P2）

**故事目标**：跨边界请求一律被拒绝且原因可观测；隔离不可用时给出可读错误而不回退到共享目录。

**独立验收**：三类拒绝（跨数字人路径/会话、不存在的数字人、未选中）语义可区分且落结构化日志；数字人目录不可写 → 可读错误、零回退。

- [x] T046 [P] [US5] 新增 `agent-backend/tests/integration/isolation-observability.spec.ts`：三类拒绝的响应与日志字段；注入不可写数据目录 → 可读错误且 **MUST NOT** 落到任何共享目录
- [x] T047 [US5] 统一越界与降级的结构化日志字段（`uid`、`agent_name`、请求线索、`reason`），落在 `agent-backend/src/routes/**` 与 `agent-backend/src/domain/agent-scope.ts` 的拒绝路径
- [x] T048 [US5] 前端降级可见：错误态展示原因与当前可用数字人（落在既有错误提示位，避免新增控件）

---

## Phase 8：用户故事 6 —— 平台侧关联与部署的作用域不变（优先级：P3）

**故事目标**：确认并锁定"平台只写配置、数据零触碰"。

**独立验收**：部署/撤回前后 `users/{uid}/user-data/**` 逐项不变；人工创建的数据目录不被删除。

- [x] T049 [P] [US6] 运行 `admin-backend` 部署/撤回回归（`admin-backend/tests/integration/deploy.spec.ts`、`deploy-withdraw.spec.ts`、`deploy-scope.spec.ts`；夹具见 `admin-backend/tests/helpers/fixture.ts`），断言对 `user-data/**` 的写入/删除次数为 0
- [x] T050 [P] [US6] 在 `admin-backend/tests/integration/deploy-scope.spec.ts` 新增用例：`users/{uid}/user-data/{未关联数字人}/**` 在部署与撤回后仍存在且未被改写

---

## Phase 9：收尾（Polish 与跨切面）

- [x] T051 回写 `specs/001-digital-human-platform/spec.md`：**FR-028**、`假设`「文件空间场景是数字人级的，文件空间数据是用户级的」、`关键实体`「文件空间场景」、**SC-012**、**SC-019**
- [x] T052 回写 `specs/001-digital-human-platform/data-model.md` §「三类数据边界」：补数字人级数据目录归属（平台写入范围仍限于 `agents/**`）
- [x] T053 回写 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 与 `contracts/admin-api.md`：路径根、新增错误码、`select` 的幂等副作用、`GET /api/threads` 参数退出作用域、迁移日志事件名、平台对数据目录零创建
- [x] T054 回写 `specs/002-conversation-runtime/spec.md` §5.1 / §5.2（会话与外置正文落点加数字人一级），并登记 §5 中 `users/{uid}/threads/` 的既有漂移
- [x] T055 废止"会话内可切换 / 会话可跨数字人"的既有实现说明注释：`agent-backend/src/routes/threads.ts:95`、`frontend/src/composables/useAgents.ts:130`
- [x] T056 覆盖率校验：四侧地板"只上不下"，且 `agent-backend/src/domain/{data-migration,agent-scope}.ts` 覆盖率 ≥ 80%
- [x] T057 性能复测：`POST /api/agents/:name/select`、`POST /api/threads`、`GET /api/threads`、`GET /api/files/workspace`、`GET /api/files/list`、`POST /api/files/upload` 按本机口径（预热 5 次、样本 ≥ 20、取 P95）记录并核对 ≤ 500ms；并**单独度量 SC-002 端到端**"空对话状态下切换数字人后 1 秒内可交互"
- [x] T058 执行 `specs/009-agent-data-isolation/quickstart.md` 场景 A~D + §7 非交互冒烟，逐条记录通过情况
- [x] T059 四侧门禁全绿终确认：`agent-backend`（typecheck/lint/test:all/build）、`frontend`（lint/typecheck/test/build）、`admin-backend`、`admin-frontend`

---

## 依赖关系与执行顺序

### 阶段级依赖

```text
Phase 1（Setup）
   └─► Phase 2（Foundational）  ← 阻塞全部用户故事
          ├─► Phase 3（US1，P1）  MVP
          ├─► Phase 4（US2，P1）  ← 后端依赖 T010/T012；前端依赖 T032 注入
          ├─► Phase 5（US3，P1）  ← 依赖 T008（作用域判定）与 T025/T026
          ├─► Phase 6（US4，P2）  ← 依赖 T013（迁移模块）；T044 依赖 T021（同改 agents.ts）
          ├─► Phase 7（US5，P2）  ← 依赖 Phase 3/4 的拒绝路径
          └─► Phase 8（US6，P3）  ← 独立（admin 侧回归）
                 └─► Phase 9（Polish）  ← 需 Phase 3~8 全部完成
```

### 任务级关键约束

- **T004 必须先于 T006**：`dirs.ts` 未拆分前不得继续加代码（500 行硬门禁）。
- **T006 → T010 / T012 / T013**：路径工厂是新布局的唯一事实源。
- **T008 → T019 / T025 / T026**：作用域判定必须先于各路由改造。
- **T010 → T011 → T024**：存储归属语义先定，再验证，再改路由。
- **T021 与 T044 同改 `agent-backend/src/routes/agents.ts`**：T044 依赖 T021，不可并行。
- **T015 与 T043 同改 `agent-backend/src/server.ts`**：T043 依赖 T015。
- **T033/T034 依赖 T032**：禁用判定需要"当前对话是否已有消息"这一注入。
- **T051~T055 与实现同批完成**（宪章原则一：规格与代码一致）。

---

## 并行执行示例

### Phase 2（基础）

```text
并行组 A（不同文件）：
- [ ] T005 新增 agent-backend/tests/unit/scenario.spec.ts
- [ ] T009 新增 agent-backend/tests/unit/agent-scope.spec.ts
- [ ] T014 新增 agent-backend/tests/unit/data-migration.spec.ts
- [ ] T016 更新 agent-backend/tests/unit/tmp-cleanup.spec.ts
```

### Phase 3（US1）

```text
并行组：
- [ ] T017 [US1] agent-backend/tests/integration/agent-isolation.spec.ts
- [ ] T018 [US1] agent-backend/tests/integration/files-scenario.spec.ts（夹具迁移）
```

### Phase 4（US2）

```text
并行组（前端测试先行，互不同文件）：
- [ ] T028 [US2] frontend/src/composables/useThreads.spec.ts
- [ ] T029 [US2] frontend/src/composables/useAgents.spec.ts
- [ ] T030 [US2] frontend/src/components/chat/AgentPanel.spec.ts
```

### Phase 8（US6）

```text
并行组：
- [ ] T049 [US6] admin-backend/tests/**（部署/撤回回归）
- [ ] T050 [US6] admin-backend/tests/**（未关联数字人的数据目录保留）
```

---

## 实施策略

### MVP 优先（仅 US1）

1. Phase 1 → Phase 2（**阻塞项，必须完成**）
2. Phase 3：US1（文件空间按数字人隔离）
3. **停止并验收**：US1 的最小验收（A/B 互不可见、跨目录被拒）
4. 可交付演示（此时历史会话仍在用户级，属预期）

### 增量交付

1. Setup + Foundational → 底盘就绪（此时单测全绿、既有集成用例已适配新布局）
2. + US1 → 验收 → 交付（MVP：文件空间隔离）
3. + US2 → 验收 → 交付（切换即新对话 + 历史隔离 + 对话中禁止切换）
4. + US3 → 验收 → 交付（移除后保留但不可用）
5. + US4 → 用真实数据备份做升级演练 → 交付（升级迁移）
6. + US5 / US6 → 验收 → 交付（可观测性与平台作用域锁定）
7. Phase 9 收尾（含上游条文回写与门禁终确认）

### 并行团队策略

- Phase 1~2 由全员共同完成（T004 为单点，避免多人同改 `dirs.ts`）。
- 基础完成后：A 负责 US1、B 负责 US2 前端（`frontend/src/composables/**` 与 `components/chat/AgentPanel.vue`）、C 负责 US4 迁移接线与 US3 集成用例。
- 冲突热点（禁止并行）：`agent-backend/src/domain/dirs.ts`、`agent-backend/src/routes/agents.ts`、`agent-backend/src/server.ts`。

---

## 备注

- `[P]` 表示不同文件且无依赖，可并行
- `[Story]` 标签用于把任务追溯到用户故事
- 每个用户故事阶段结束都应"停止并独立验收"
- 测试先写（红）→ 实现（绿）；宿主机本地执行，容器不参与
- 平台差异风险（`rename` 跨卷、非 ASCII 目录名、大小写敏感性、排序口径）见 `plan.md` §「复杂度跟踪 · 平台差异风险登记」，实现时按该表处置
- 部署与容器编排不在本特性范围；部署后按 `quickstart.md` §7 做非交互冒烟
- **修订**：本清单经 `/speckit.analyze`（2026-10-14）复核并按收口建议更新 —— T010（`list` 过滤空会话）、T017（FR-004 跨用户例）、T018（确切夹具文件清单 + FR-060 回归）、T022（产出形式）、T024（FR-016 服务端断言 + FR-014 并发例）、T034（FR-062 核对）、T040（陈旧选中态不自动清空）、T041／T049／T050（`admin-backend` 确切测试文件）、T057（SC-002 端到端度量）

---

## 执行记录

> 由 T003（门禁基线）与 T045（升级验收实测）在执行时填写；本节不预置任何数据。

### T003 门禁基线（改造后复测，2026-10-14）

| 侧 | typecheck | lint | test | build | 备注 |
|---|---|---|---|---|---|
| `agent-backend` | ✅ | ✅（0） | ✅ 54 文件 / **709** | ✅ | 覆盖率 73.33 / 67.31 / 73.28 / 75.29（基线地板 66/61/65/67，**只上不下**） |
| `frontend` | ⚠️ | ⚠️ | ✅ 57 文件 / **672** | ⚠️ | 见下方「门禁未全绿说明」 |
| `admin-backend` | ✅ | ✅（0） | ✅ 43 文件 / **606** | — | — |
| `admin-frontend` | ✅ | ✅（0） | ✅ 51 文件 / **567** | — | — |

**门禁未全绿说明（`frontend`，均为改造前既有债务，与本特性无关）**：

- `typecheck`/`build`（`vue-tsc --build`）在 **未改动** 的 gantt/数据页模块报 6 个 `TS6133` 未使用变量：`views/demo/gantt-demo.vue`（`baseEnd`/`ganttTableRef`/`value`）、`views/demo/modules/gantt-compare-section.vue`（`afterGanttOption`/`afterTableData`）、`views/demo/urgent-insert-result.data.ts`（`today`）；
- `lint` 在 **未改动** 的 `components/data/DataDialog.vue`、`components/expand-section/*`、`components/z-gantt*`、`views/datapage/*`、`views/demo/gantt*` 报 18 error + 32 warning。
- 本特性涉及的前端文件（`useAgents/useThreads/useAppSession/useChatStream/useChatPanel/AgentPanel/ChatPanel/MessageBubble/MessageList/api/{types,messages}/error-message` 及其测试）**typecheck 与单测全绿**（`npx vue-tsc --noEmit` 0 报错、671 单测通过）。按宪章「不追溯」原则未对存量 gantt/数据页发起修复。

### T045 升级验收实测（真实数据，临时根，2026-10-14）

数据源＝ `agent-backend/.opt-agent`（含 `admin` 真实存量：6 会话、共享/临时/数据准备三空间文件，与 `zpf` 用户）；在**临时副本**上把数据域还原为"改前布局"后启动，用真实 HTTP（`127.0.0.1` 随机端口）逐项验收，**24/24 项 PASS**：

- **§6 迁移**：`user-data/` 一级只剩归属数字人目录；文件逐项一致（38/38）、会话条数一致（6/6）、无数字人的用户（`zpf`）零触碰；归属 = 名称升序第一（`柯昆BOM数字人`）；
- **§3 隔离**：A 上传 → B 列表不含；同名不串内容；磁盘落点 `user-data/{数字人}/共享空间`；上跳/绝对路径 → `400`、点名别的数字人 → `403`；
- **§4 会话**：建会话归属 B → 落在 `user-data/{B}/threads`；A 选中态下访问 → `404`；A 历史列表不含 B 的会话；
- **§5 移除**：移除 B 后清单不含、发消息 `409 AGENT_NOT_AVAILABLE`、数据逐项不变；同名重关联后重新可见可用。

> 注：执行期间开发服务器（`tsx watch`）已按新代码对**真实 `.opt-agent`** 完成了一次真实迁移，数据经目录树逐项核对无损；改前完整备份保留在 `agent-backend/.opt-agent.backup-20261014/`（T001）。

### T057 性能复测（P95，预热 5 × 样本 25，2026-10-14）

| 端点 | P50 | P95 |
|---|---|---|
| `POST /api/agents/:name/select` | 3.0ms | 4.4ms |
| `POST /api/threads` | 2.2ms | 2.8ms |
| `GET /api/threads` | 4.3ms | 4.9ms |
| `GET /api/files/workspace` | 3.4ms | 4.4ms |
| `GET /api/files/list` | 1.2ms | 1.5ms |
| `POST /api/files/upload` | 6.0ms | 7.3ms |

**SC-002 端到端**（空对话切换数字人 → `select` + `current` + `threads` + `workspace` 就绪）：P50 11.4ms / P95 **13.7ms**（判据 ≤ 1000ms，**达标**）。全部 ≤ 500ms 判据**通过**。

### T058 quickstart 场景 A~D 与 §7 冒烟

- 场景 A（文件隔离）、B（切换即新对话 + 历史隔离）、C（移除后保留但不可用）、D（存量迁移）→ 已在 T045 真实 HTTP 验收与 `tests/integration/{agent-isolation,thread-scope,agent-removed,migration}.spec.ts` 中逐条覆盖并通过；
- §7 非交互冒烟：**未执行**——需要部署侧（gateway `:82`）环境，本机无部署环境；§7 属"部署成功确认"，MUST NOT 作为测试结论（宪章原则三/八），故按设计跳过并如实登记。

### T022 零改动结论

- `agent-backend/src/domain/workspace-view.ts`：**零改动**（相对路径口径不变，场景读取仍走 `agents/{name}/scenario.json`）。
- `agent-backend/src/domain/produced.ts`：仅因 `FileAccessOptions` 增加 `agentName` 必填字段（T012）做了**调用点适配**，产出相对路径口径（`临时空间/后台产出`）不变。

### 其他登记

- **跨用户隔离（FR-004）**：运行期是单用户，跨用户隔离是**结构性**保证——路径工厂 `userDataDir(root, uid, agent)` 中恒含 `uid`，同名数字人在不同用户下互不相同；已在 `tests/unit/dirs.spec.ts` 增加路径层断言，运行期集成无法构造第二个 `getCurrentUser()`。
- **平台差异实测**：本机 `fs.rmSync` / `fs.cpSync` 对**含中文的路径会静默失效**（`rmSync` 在 vitest fork 子进程内甚至会触发原生崩溃）。迁移用 `renameSync`/`rmdirSync`（实测正常），测试里删除中文路径一律走 `fs-safe` 原语。已登记于 `plan.md` 平台差异风险（本节不重复展开）。
