# 阶段 0 研究记录：按数字人隔离用户数据

**特性**：`009-agent-data-isolation` | **日期**：2026-10-14 | **规格**：[spec.md](./spec.md) | **计划**：[plan.md](./plan.md)

本文件记录 Phase 0 的 12 项决策（R1~R12，与 plan.md 的 D1~D12 一一对应）：**决策 / 理由 / 被否决的方案**。
所有结论均基于对现有代码的实测取证（证据为「文件:行号」）。

**技术上下文中的 NEEDS CLARIFICATION：0 项**——规格的三项待澄清已由用户答复（Q1=A / Q2=A / Q3=A）并并入正文。

---

## R1 隔离键与目录布局

**决策**：归属键＝**（用户标识，数字人名称）**；布局为

```text
users/{uid}/user-data/{数字人名称}/{数据准备|共享空间|临时空间|threads}
```

**理由**

- 需求第 5 条直接给出了这一布局，且平台侧已强制数字人名称合法（不含路径分隔符）且**创建后不可修改**（`001/spec.md` `FR-015`），名称因此可作为稳定的目录身份（Q3=A）。
- 现状的所有数据都在用户级：`src/domain/dirs.ts:70-72` `userDataDir` 的返回值是 `users/{uid}/user-data`，三个空间与 `threads` 都是它的子目录；`dirs.ts:12-13` 的注释与 `001/spec.md`「假设」明确写着"文件空间数据是用户级的"——这正是本特性要推翻的结论。
- 加一层目录是**最小结构改动**：无需新增索引、无需迁移数据库、无需引入 ID 映射。

**被否决的方案**

1. **用平台内部 ID 作目录名**：与需求不符；需要一份"名称 ↔ ID"映射，且平台侧未持久化该 ID。
2. **名称哈希/短码**：可读性差，排障与人工核对成本高；且现有数据与测试夹具都以可读名称为准。
3. **数字人名称 + 短标识后缀**：会破坏"同名重关联即复用数据"（Q3=A）的语义。

---

## R2 路径工厂签名扩展（唯一事实源）

**决策**：`dirs.ts` 的 `userDataDir(root, uid)` → `userDataDir(root, uid, agentName)`；`threadDir(root, uid, threadId)` → `threadDir(root, uid, agentName, threadId)`；新增 `ensureAgentDataDirs(root, uid, agentName)`（幂等）。

**理由**

- 路径拼接已高度集中：`userDataDir` 的全部调用点仅 5 处生产代码（`server.ts:151`、`thread-store.ts:78,212`、`routes/files.ts:191,275`、`routes/chat.ts:108`、`file-access.ts:64`），`threadDir` 的调用点即 5 个存储模块的 `filePath()`。改这一处即可让全链路换根。
- 少量"裸拼接"（不经 dirs 直接拼 `user-data`）都已确认位于 `dirs.ts` 自身（`dirs.ts:71`、`dirs.ts:394` 的 `ensurePrepDirs`）或调用工厂函数之后的相对路径（`thread-store.ts:78,212`），因此仍在收敛范围内。

**被否决的方案**

1. **引入 `DataScope { userId, agentName }` 对象贯穿各存储**：改动面更大，且与既有 `PoolKey`（同样是 `{userId, agentName}`）语义重叠，容易产生第二个"域"概念。
2. **在 `FileAccess`/`ThreadStore` 构造函数里注入根目录**（而不是在工厂函数里）：会把拼接责任散到装配层，形成多处拼装。

---

## R3 会话归属：结构性隔离 vs 元数据过滤

**决策**：会话存储**下沉到数字人目录**：`users/{uid}/user-data/{agent}/threads/{threadId}/`；`meta.agent_name` 变为**只读归属键**；`ThreadStore.list` 的作用域参数由"可选过滤"变为**必填**；`touch()` 不再覆写 `agent_name`。

**理由**

- 现状 `agent_name` 是"最近一轮使用"的标签：`thread-store.ts:142` 在 `touch()` 中覆写，`routes/chat.ts:190` 每轮结束调用；`routes/threads.ts:114-115` 的 `GET /api/threads?agent_name=` 只是可选过滤，**不是隔离**。
- 结构性隔离让"跨数字人访问"在**路径解析阶段**就不可能命中目标：`user-data/{A}/threads/{tid}` 与 `user-data/{B}/threads/{tid}` 是两个不同路径，业务层无需再加鉴权分支即可满足 FR-021（不泄露存在性，表现为 404）。
- 归属不可变（FR-022）由"目录位置"天然保证：改元数据无法把会话搬到另一个数字人下。

**被否决的方案**

1. **会话留在用户级，靠 `meta.agent_name` 过滤**：需要业务层双实现（列表、详情、删除、续聊各一处判定），且必须额外处理"存在但不可访问"的信息泄露问题，与 FR-020/021/022 三条需求同时冲突。
2. **会话留在用户级，但按 `agent_name` 分桶命名（如 `threads/{agent}/{tid}`）**：本质是同一件事，却把归属表达得比"数字人目录"更隐晦，且与文件空间的归属层不统一。

---

## R4 当前数字人上下文与可用性判定

**决策**：沿用既有**服务端"当前选中数字人"**（`CurrentAgentStore`，内存 Map，`current-agent.ts:11-30`）作为作用域来源；新增 `domain/agent-scope.ts#resolveAgentScope(ctx, userId)` 作为**唯一判定入口**：

- 未选中 → `409 AGENT_NOT_SELECTED`（沿用既有码与文案）
- 选中但该数字人**不可用**（配置目录缺失或配置损坏）→ **新增** `409 AGENT_NOT_AVAILABLE`
- 正常 → `{ userId, agentName }`

**理由**

- 现状已有多处等价但分散的判定：`routes/files.ts:99-105 currentAgentFor`、`routes/threads.ts:96-98`、`routes/chat.ts:130-131`。宪章原则二要求"同一职责只有一处实现"，本次顺势收敛。
- `AGENT_NOT_AVAILABLE` 是 FR-032 的直接落地：移除数字人后部署只清掉 `users/{uid}/agents/{name}`（`admin-backend` 的 `opt-agent-writer.ts` 整体覆盖语义），运行环境内"选中态仍在但目录已不存在"，此时发消息 MUST 失败且可读，而不是 500 或静默换人。
- 复用既有 `loadAgentConfig`/`listAgents`（`agent-catalog.ts:66-85`）做存在性与完好性判定，不新造校验。

**被否决的方案**

1. **改为请求级参数**（每个请求带 `agent_name`）：能解决多客户端并发（当前是"按用户一份内存状态"），但会改变全部接口契约与前端调用面，属独立增量；本特性在规格「假设」第 5 条与「明确不做」中已登记该限制不在范围内。
2. **把可用性判定分散在各路由**：双实现漂移（同类问题在本仓库已出现过，见 002 特性对"结果文本口径"的收敛）。

---

## R5 数据目录的创建责任与时机（Q2=A）

**决策**：数字人级数据目录由**运行环境按需惰性创建**：`ensureAgentDataDirs(root, uid, agentName)`（幂等）在 ① `POST /api/agents/:name/select` 成功后；② 会话创建（`ThreadStore.create`）；③ 文件写入/列举路径前兜底调用。`ensureUserDirs` 改为**只建 `users/{uid}/agents/`**（不再建用户级空间与 `threads`）。

**理由**

- Q2=A 的直接落地；平台侧保持"写入 100% 限于 `users/{uid}/agents/{agent}/`"的既有纪律（`001/data-model.md` §三类数据边界），因此 `admin-backend` / `admin-frontend` 零改动。
- 现状已存在同名机制：`dirs.ts:92-99 ensureUserDirs`（幂等）+ `dirs.ts:393-398 ensurePrepDirs`（惰性建数据准备子目录）。新增函数与既有风格一致。
- 若继续在用户级建三个空目录，会立刻违反 FR-002（MUST NOT 存在用户级共享落点），并让迁移判据产生歧义（新生成的空壳会被反复"迁移"）。

**被否决的方案**

1. **平台部署时创建数字人级空骨架**：违背 Q2 结论，且需要修改平台侧作用域纪律与上游条文，收益仅是"目录提前存在"。
2. **保留 `ensureUserDirs` 建三个空间，仅新增数字人层**：产生用户级空壳残留（FR-002 违规）。

---

## R6 存量迁移策略（Q1=A）

**决策**：迁移＝**逐项原子改名**：

```text
源：users/{uid}/user-data/{数据准备|共享空间|临时空间|threads}
目标：users/{uid}/user-data/{归属数字人}/{同名目录}
逐项：目标同名条目已存在 → 跳过 + warn；否则 fs.renameSync(源项 → 目标项)
迁移后源目录为空 → rmdir（清除用户级落点）
```

**理由**

- 同卷内单条 `rename` 是**文件系统级原子**操作：不复制、不占双倍空间、中断后重跑可续。
- 逐项（而非整目录改名）是必需的：目标目录可能已存在（部分迁移后重启、或用户此前已在某数字人下产生数据），整目录改名在目标已存在时无合法语义。
- 幂等判据天然成立：源目录不存在 ⇒ 迁移已完成的等价条件 ⇒ 直接返回；重复执行不产生重复条目（FR-041、SC-005）。
- 空壳源目录必须清除：否则用户级落点残留，违反 FR-002。

**被否决的方案**

1. **复制后删除**：非原子，中断会同时留下新旧两份（重复），且需要额外判据区分"已复制未删除"。
2. **保留用户级数据并加"读写兼容层"（读时回落旧位置）**：形成两套路径口径（违宪章原则二的唯一职责来源），且用户永远看不到一个明确的数据归属。
3. **把存量数据原样留下、不作为业务数据读**：Q1 的 B 方案，已被用户否决（会导致"用户找不到原文件"）。

---

## R7 归属判定与触发时机（FR-040 的①如何真正可达）

**决策**：归属判定顺序 ①当前选中 → ②唯一 → ③名称升序第一 → 兜底空清单原地保留；迁移函数在**两处**触发：

- **启动期**（`server.ts` 的 `main()`，`ensureRootDirs` 之后）：此时进程内无选中态，实际走 ②③；
- **`POST /api/agents/:name/select` 成功之后**（在 `ctx.currentAgent.select()` 之后调用）：此时 `currentAgent.current(userId)` 就是用户刚选中的数字人 ⇒ **①真正生效**。

**理由**

- `CurrentAgentStore` 是进程内存（`current-agent.ts:12` `selected: Map<string,string>`），启动期必为空 ⇒ 若只在启动期实现，FR-040 的①永远是死代码。
- 两处触发点恰好覆盖两条真实路径：
  - 升级后重启：清单已有多数字人 ⇒ ②/③ 立即完成迁移；
  - 升级后清单为空（管理员尚未部署数字人）⇒ 原地保留 + 告警 ⇒ 管理员随后部署 ⇒ 用户首次选择该数字人 ⇒ ①完成迁移。
- `select` 后的调用是**幂等且零成本**的（源不存在即返回），不会给热路径带来可观测开销。
- ③ 用 `listAgents`（`agent-catalog.ts:84` 已按名称升序排序）的第一项，判定结果落 `info` 日志与审计（原则九：不静默）。

**被否决的方案**

1. **只在启动期触发**：① 死代码，兜底分支不闭环（用户永远找不到数据）。
2. **惰性触发（首次访问该用户数据时）**：时序不确定（select 与首次访问的先后无法保证），且需要额外的 per-user 标志位。
3. **用"最近使用过的数字人"（存量 `meta.agent_name`）替代①**：语义上更像真实归属，但超出规格定义，且需要读取全部会话元数据（额外 IO）。

---

## R8 `domain/dirs.ts` 拆分（500 行硬门禁）

**决策**：把 scenario 相关部分从 `dirs.ts` 拆到新模块 `domain/scenario.ts`，`dirs.ts` 保留空间常量、路径工厂与 ensure 系列，并对拆出符号做 **re-export** 以保持既有导入不变。

拆分边界（按现有行号）：

| 留在 `dirs.ts` | 迁到 `scenario.ts` |
|---|---|
| `SPACE_*` / `SPACES` / `SpaceName`、`THREADS_DIR`、`PRODUCED_SUBDIR` / `PRODUCED_DIR`、`SPACE_POLICIES`、`DATA_PREP_UPLOAD_EXTS` | `ScenarioNotConfiguredError`、`SCENARIO_FIELD_TYPES` / `ScenarioFieldType`、`ScenarioField`、`Scenario`、`scenarioCache`、`loadScenario`、`uploadExtensionsOf`、`Scenario` 解析辅助 |
| `userDataDir` / `userAgentsDir` / `agentDir` / `scenarioPath` / `threadDir` | `parseSpaceDir` / `SpaceDirTarget` / `DirValidationError` / `listAvailableDirs`（均依赖场景清单） |
| `ensureUserDirs` / `ensureAgentDataDirs` / `ensureRootDirs` | — |

**理由**

- `dirs.ts` 实测 **504 行**，已越过"单文件 ≤ 500 行"的硬门禁；本次必须先改它（路径工厂），按治理规定"改动涉及的文件须合规"，故拆分为必需动作。
- 拆出后两侧都远离上限（预估 `dirs.ts` ≈ 200 行、`scenario.ts` ≈ 320 行）。
- re-export 是仓库既有先例（008 特性对 `admin-frontend/src/api/types.ts` 的处理），可保持调用点零改动。

**被否决的方案**

1. **继续在 504 行的文件里加代码**：直接违反硬门禁。
2. **顺手做更大的重构**（例如同时把 `ensure*` 抽成独立模块）：违反治理"不得借改动之机大范围重构"。

---

## R9 临时空间清理与后台产出

**决策**

- `tmp-cleanup` 定时任务（`server.ts:148-160`）由"清理当前用户的 `临时空间`"改为**遍历（用户 × 数字人）**：用 `listAgents` 取该用户的数字人清单，逐个清理 `userDataDir(root, uid, agent)/临时空间`；某数字人目录不存在则跳过（不报错）。
- 后台产出（`produced.ts`）与工具结果外置（`tool-events.ts:306`、`tool-context.ts:95`）走 `FileAccess` 的**相对路径**（`临时空间/后台产出`），归属随 `FileAccess.dataRoot` 自动跟随当前数字人 ⇒ 这些模块**预期零改动**（仅 `tool-events` 的 `artifacts` 工厂签名补 `agentName`，见 `server.ts:103-109`）。

**理由**

- 清理任务若仍按用户级路径，会**一个都清不到**（目录已不存在），造成临时空间无限增长且无告警。
- 相对路径复用是既有设计（`file-access.ts:43 READABLE_DIRS=SPACES` 与 `:64 dataRoot`），保持它可让本次改动面最小。

**被否决的方案**

1. **清理任务改为递归扫描 `user-data/**` 找所有 `临时空间`**：多一层模糊匹配，且在存在"未关联数字人的残留目录"时会连带清理（与 FR-031"数据保留"冲突）。
2. **在 `FileAccess` 内部自行探测数字人**：会把"当前数字人"这一请求级上下文泄漏到文件沙箱里，违背分层。

---

## R10 前端"切换即新建对话"的落点

**决策**：逻辑放在 `useAppSession.onSwitched`（`useAppSession.ts:223-227`）：改为

```ts
onSwitched: async () => {
  await threads.startNew()   // 清空 active + 立即创建（新方法，落在 useThreads）
  await workspace.load()     // 文件空间视角随数字人切换
}
```

`useThreads` 新增 `startNew()`＝`clearActive()` + `await create()`（`create()` 内部已 `loadList()`）；`useChatPanel.ts` **不改**。

**理由**

- 现状切换只做"刷新"：`useAgents.ts:119-140` 的 `switchTo` 仅 `select` + `loadCurrent` + `onSwitched()`；`useAppSession.ts:223-227` 只 `loadList()` + `workspace.load()`，**既不新建也不清空**。
- `useChatPanel.ts` 存量 **525 行**（超限）。把新逻辑放进 `useAppSession.ts`（276 行）与 `useThreads.ts`（277 行）即可满足"改动文件须合规"，避免顺便触发大拆分。
- 既有幂等守卫已存在：`useAgents.ts:124-126` 在 `currentAgent.agent_name === name` 时直接 return ⇒ FR-012（重复选择同一数字人不产生多余空会话）无需新代码，只需测试锁定。

**被否决的方案**

1. **在 `useChatPanel.onSwitchAgent`（`:370`）里新建对话**：会改动超限文件。
2. **在后端 `select` 接口里创建会话**：把"界面行为"下沉到服务端，且 `select` 变成写操作（幂等性、并发与计费口径都变复杂）。

---

## R11 接口契约的兼容口径

**决策**

- `POST /api/threads` 的请求体字段 `agent_name` **保留（schema 不变）**，但**不再决定归属**：归属一律取服务端当前选中；两者不一致时落 `warn` 日志并以服务端为准。
- `GET /api/threads` 的查询参数 `agent_name` 不再参与作用域（保留参数、忽略取值），返回**只含当前数字人**的会话。
- 跨数字人的会话（详情/续聊/改名/删除）→ 沿用 `404 THREAD_NOT_FOUND`；跨数字人的文件目录 → 沿用 `403 DIR_VALIDATION` / `400 VALIDATION_FAILED`。
- 新增错误码 `AGENT_NOT_AVAILABLE`（409）。

**理由**

- SC-008 要求"既有接口字段与错误码语义逐字不变（仅允许明确登记的新增错误码）"⇒ 不宜删除 `agent_name` 字段。
- 归属不可由客户端指定，才能与 FR-003（MUST NOT 接受客户端给出的路径）保持同一治理口径。落 `warn` 而非静默忽略满足原则九。
- 不新增"无权限"类错误码：那会泄露"该对象存在"（与 FR-021 冲突）。

**被否决的方案**

1. **删除 `agent_name` 字段**：破坏既有契约与前端类型，且与 SC-008 冲突。
2. **不一致时返回 409 新错误码**：为"客户端自我不一致"新增一个全局错误码，收益低而契约面变大。
3. **新增 `403 AGENT_SCOPE_FORBIDDEN`**：泄露存在性。

---

## R12 跨平台确定性与测试策略

**决策**

- 排序口径：③"名称升序第一"复用 `listAgents` 的既有排序（`agent-catalog.ts:84` `a.agent_name.localeCompare(b.agent_name)`）；测试锁定"同一输入 → 同一结果"，不依赖平台默认排序差异。
- 迁移的 `EXDEV`（跨卷）MUST 明确报错并保持原状，MUST NOT 静默降级为复制。
- 测试夹具：沿用各 spec 自建 `mkdtempSync` 的既有做法（`dirs.spec.ts:30`、`files-scenario.spec.ts:28`、`thread-store.spec.ts:22`），把夹具路径改到数字人一级；新增用例须含**中文数字人名**与**名称大小写混用**两组。

**理由**

- 宪章原则三要求显式管理平台差异（Windows 本地 vs Linux 容器）。本特性首次引入"目录改名"与"按名称排序决定数据归属"两类平台相关行为，必须登记并测试。
- 既有测试全部自建临时根、无共享 helper，新增用例沿用该约定可避免引入新的测试基础设施。

**被否决的方案**

1. **抽一个共享的测试 helper**：属于测试基础设施改造，超出本特性范围（治理不追溯）。
2. **改用 ASCII 化的目录名规避差异**：与 Q3=A（身份＝数字人名称）冲突，且不可读。
