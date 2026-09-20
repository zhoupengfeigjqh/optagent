---
description: "任务清单：数字人管理平台"
---

# Tasks: 数字人管理平台

**Input**: Design documents from `/specs/001-digital-human-platform/`

**Prerequisites**: [plan.md](./plan.md)（必需）、[spec.md](./spec.md)（必需，用户故事）、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/)、[quickstart.md](./quickstart.md)

**Tests**: **本特性必须包含测试任务**。任务模板将测试列为可选项，但本项目宪章**原则三（测试完备性，NON-NEGOTIABLE）**明确要求：后端**每个接口端点 MUST 有集成测试**、`domain/` MUST 有单元测试；前端**每个组件/composable/纯函数模块 MUST 同名同目录测试**；覆盖率 MUST ≥ 80%。按「宪章优先于其他实践与习惯」（治理 § 效力），测试任务**不可省略**。

**Organization**: 任务按**用户故事**分组，使每个故事可独立实现、独立测试、独立交付为 MVP 增量。

**测试执行环境**: 全部在**宿主机本地**执行（宪章原则三）；容器**不参与**测试。**MUST NOT** 为新子项目创建 `Dockerfile.test` 或 `test` profile。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可并行（不同文件、且不依赖未完成的任务）
- **[Story]**：所属用户故事（`US1`~`US4`），映射到 `spec.md` 的故事
- 每条任务 MUST 含**确切文件路径**

## Path Conventions

本特性为「Web 应用 + 两个新增同级子项目」，路径取自 `plan.md` § Source Code：

- 管理服务：`admin-backend/src/`、`admin-backend/tests/`
- 管理界面：`admin-frontend/src/`
- 既有运行环境改动：`agent-backend/src/`、`agent-backend/tests/`
- 基础设施：`gateway/nginx.conf`、`docker-compose.yml`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 项目初始化与基础设施配置

- [x] T001 在 `specs/001-digital-human-platform/checklists/requirements.md` 的"已收敛的澄清项"表追加一条：**「配置权威源单向 vs 只读消费」**——`FR-005`／`SC-017` 的"严格单向"约束的是**配置数据流**；平台对运行环境的**只读投影与运行观测**（工具目录 `FR-011`／`FR-003`、容器状态 `FR-043`、日志 `FR-048`、调用统计 `FR-049`／`FR-050`）**不属反向通道**。`spec.md` 侧的 `FR-005`／`SC-017`／`FR-034`／`FR-043`／`FR-022`／`SC-005` 与「用户」实体已按 `/speckit.analyze` 的 CRITICAL 项 F1 同步回写，本条只需登记结论与来源
- [x] T002 创建 `admin-backend/` 目录骨架与 `admin-backend/package.json`（依赖清单严格按 `research.md` D2/D7，含 `yauzl`；scripts 含 `dev`/`build`/`lint`/`typecheck`/`test`/`test:coverage`/`check:lines`/`check:deps`）
- [x] T003 [P] 创建 `admin-frontend/` 目录骨架与 `admin-frontend/package.json`（**零第三方运行时依赖**——唯一 `dependencies` 为 `vue`；dev 依赖版本与 `frontend/package.json` 一致；**scripts MUST 与 `admin-backend` 对称**，原则八：`dev`／`build`／`lint`／`typecheck`／`test`／`test:coverage`／`check:lines`／`check:deps`）
- [x] T004 [P] 配置 `admin-backend/tsconfig.json` 与 `admin-backend/eslint.config.mjs`（与 `agent-backend` 同构；ESLint 用 `.mjs` 扁平配置，避开 `jiti`）
- [x] T005 [P] 配置 `admin-backend/vitest.config.ts`（覆盖率**两层阈值结构**同 `agent-backend/vitest.config.ts`：全局防倒退地板 + 受约束模块 80%）
- [x] T006 [P] 配置 `admin-frontend/tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` / `eslint.config.mjs` / `vite.config.ts`（与 `frontend` 同构，含 vitest 段与覆盖率两层阈值）
- [x] T007 [P] 实现行数硬门禁脚本（**两个新子项目各一份，MUST 对称**，原则八）：`admin-backend/scripts/check-lines.mjs` 与 `admin-frontend/scripts/check-lines.mjs`（遍历 `src/**`、`tests/**` 的 `.ts`／`.vue`，超 500 行非零退出；`research.md` D9）
- [x] T008 [P] 实现依赖硬门禁脚本（**两个新子项目各一份，MUST 对称**）：`admin-backend/scripts/check-deps.mjs` 与 `admin-frontend/scripts/check-deps.mjs`（`package.json` 的 `dependencies`／`devDependencies` 与 `research.md` D2 清单比对，未登记即非零退出；`research.md` D9）
- [x] T009 [P] 编写 `admin-backend/Dockerfile` 与 `admin-backend/.dockerignore`（2 段构建，与 `agent-backend/Dockerfile` 同构）
- [x] T010 [P] 编写 `admin-frontend/Dockerfile`、`admin-frontend/nginx.conf`、`admin-frontend/.dockerignore`（与 `frontend/Dockerfile` 同构，含 SPA 回退）
- [x] T011 [P] 修改 `gateway/nginx.conf`：新增 `/api/admin/`（→ `admin-backend:3000`，最长前缀）与 `/admin/`（→ `admin-frontend:80`）两条 location；**删除** `/mcp/`、`/skill/`、`/designer/` 三段过时注释（`contracts/runtime-api-delta.md` R5）
- [x] T012 [P] 修改 `docker-compose.yml`：**仅剩**新增 `admin-backend`（含 `platform-data`、`.opt-agent`、`docker-compose.yml:ro`、`docker.sock` 四个挂载）与 `admin-frontend` 两个服务（R6）。**注**：原属本条"清理 `backend-test` / `ocr-test` 两个 `test` profile"的那半，已随 T013 提前完成——`docker-compose.yml` 现不含任何 test profile
- [x] T013 [P] ~~删除 `agent-backend/Dockerfile.test` 与 `ocr-service/Dockerfile.test`~~ —— **已于 2026-09-15 完成**：①两个 `Dockerfile.test` 已删除；②`docker-compose.yml` 的两个 `test` profile 已移除并留注释防止重新引入；③`ocr-service` 的 4 处注释引用已修正，其中 `tests/test_ocr_core.py` 原写「容器内，**MUST NOT 在宿主机直接跑**」——与宪章 2.0.0 恰好相反，已改为本地命令；④`checklists/requirements.md` 的验证记录已改由本地复核口径（`npm run build` / `npm run test:all` / `npm run typecheck`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有用户故事共用的核心基础设施

**⚠️ CRITICAL**: 本阶段完成前，任何用户故事都不可开始

### 后端骨架

- [x] T014 [P] 实现 `admin-backend/src/config.ts`（唯一读 `process.env` 之处；zod 校验 `PORT`/`PLATFORM_DATA_DIR`/`OPT_AGENT_ROOT`/`COMPOSE_FILE_PATH`/`DOCKER_SOCKET_PATH`；缺必填项即拒启动并给出可读报错）
- [x] T015 实现 `admin-backend/src/context.ts`（`AppContext`：`config`/`loggers`/`store`/`compose`/`docker`/`mcp`；独立成文件以避免 `routes ↔ server` 循环 import，与 `agent-backend` 同构）
- [x] T016 [P] 实现 `admin-backend/src/logging.ts`（pino；日志落 `platform-data/logs/`，按日切分）
- [x] T017 实现 `admin-backend/src/server.ts`（Fastify 装配 + 统一错误 envelope `{ error: { code, message, details? } }` + 路由注册 + `listen`）
- [x] T018 [P] 实现 `admin-backend/src/domain/error-codes.ts`（`contracts/admin-api.md` §0.4 的 23 个错误码常量）与 `admin-backend/src/domain/api-error.ts`（`ApiError`，与 `agent-backend` 同构）

### 数据访问层

- [x] T019 [P] 实现 `admin-backend/src/infra/platform-store.ts`（JSON 文档读写 + **写临时文件 → fsync → 原子 rename** + `revision` 乐观锁；`research.md` D4）
- [x] T020 [P] 实现 `admin-backend/src/infra/compose-reader.ts`（只读解析 `docker-compose.yml`，暴露 MCP 服务声明清单；用既有 `yaml` 依赖）
- [x] T021 [P] 单元测试 `admin-backend/tests/unit/platform-store.spec.ts`（原子替换、`revision` 冲突、并发写拒绝）
- [x] T022 [P] 单元测试 `admin-backend/tests/unit/compose-reader.spec.ts`（正常/畸形/缺失文件）

### 平台级端点

- [x] T023 实现 `admin-backend/src/domain/platform-settings.ts`（目标运行形态的读写与枚举）与 `admin-backend/src/routes/platform.ts`（`contracts/admin-api.md` §1.1~§1.4）
- [x] T024 [P] 集成测试 `admin-backend/tests/integration/platform.spec.ts`（health 四类依赖字段、settings 读写、runtime-forms、`ADM_CONFIG_REVISION_CONFLICT`）

### 前端骨架与通用组件

- [x] T025 [P] 实现 `admin-frontend/src/api/http.ts`（薄封装：BaseURL 拼接、JSON 编解码、统一 `ApiError`；与既有 `frontend/src/api/http.ts` **同构**）
- [x] T026 [P] 定义 `admin-frontend/src/api/types.ts` 的通用类型（`Paged<T>`、错误体）与 `admin-frontend/src/constants/error-messages.ts`（`ADM_*` 中文文案映射，未知码回退并保留原码）
- [x] T027 [P] 实现 `admin-frontend/src/router.ts`（原生 History API + `popstate`；**不引入 `vue-router`**；`research.md` D5）与其单测 `admin-frontend/src/router.spec.ts`
- [x] T028 [P] 实现 `admin-frontend/src/composables/useAsync.ts`（loading/error/data 状态机，供全部列表与详情复用）
- [x] T029 实现 `admin-frontend/src/components/layout/AppShell.vue` 与 `PrimaryNav.vue`（**常驻一级导航 4 项**、标明当前功能区、`aria-current="page"`、完整键盘可达；`FR-053`）
- [x] T030 实现 `admin-frontend/src/components/common/EntityCardList.vue`（卡片列表：**每页固定 8 项（4 列 × 2 行）**、展示总条数与页码、翻页；`FR-006`、`SC-022`、`SC-023`）
- [x] T031 [P] 实现 `admin-frontend/src/components/common/ConfirmDialog.vue`（**原生 `<dialog>` + `showModal()`**，Esc 关闭、焦点捕获、关闭后焦点归还；`FR-007`）
- [x] T032 [P] 实现 `admin-frontend/src/components/common/StatusBadge.vue`（状态/异常态：**图标 + 文本双通道**，不只靠颜色；原则四）
- [x] T033 [P] 实现 `admin-frontend/src/components/common/EmptyState.vue` 与 `ErrorNotice.vue`（可读原因 + `aria-live`）
- [x] T034 [P] 实现 `admin-frontend/src/components/common/TabsNav.vue`（ARIA tabs：`role="tablist"/"tab"/"tabpanel"` + 方向键；承载功能区内分区，**不新增导航层级**；`FR-053`）
- [x] T035 [P] 组件测试：`admin-frontend/src/components/layout/PrimaryNav.spec.ts`、`admin-frontend/src/components/common/EntityCardList.spec.ts`、`ConfirmDialog.spec.ts`、`StatusBadge.spec.ts`、`TabsNav.spec.ts`（覆盖 props / emit / 边界：空值、禁用、超限、失败态——原则三）
- [x] T036 实现 `admin-frontend/src/App.vue`、`admin-frontend/src/main.ts`、`admin-frontend/src/styles/`（全局样式与设计令牌）与 `admin-frontend/index.html`

---

## Phase 3: User Story 1 - 数字人设计与配置产出 (Priority: P1) 🎯 MVP

**Goal**: 管理员可在平台内新建与编辑数字人，完整覆盖五类配置，保存为结构化 JSON 并原样回显。

**Independent Test**: 不部署、不依赖 US2~US4——"打开数字人设计区 → 新建数字人 → 填满五类配置 → 保存 → 重新打开内容一致"即可独立验证（`spec.md` US1 独立测试）。

### 运行环境前置改动（R1/R2，US1 的工具选择器依赖它）

- [x] T037 [US1] 新建 `agent-backend/src/domain/builtin-tool-catalog.ts`：`BuiltinToolCatalogEntry` 类型 + `BUILTIN_TOOL_CATALOG`（5 项）+ `listBuiltinTools` / `findBuiltinTool` / `renderTemplate`（`contracts/runtime-api-delta.md` §1.2）
- [x] T038 [US1] 改造 `agent-backend/src/infra/builtin-tools.ts` 为**消费目录**（元数据迁出，`AgentTool` 装配与异常翻译行为不变；R1）
- [x] T039 [US1] 改造 `agent-backend/src/domain/agent-instance.ts`：`BUILTIN_TOOL_NAMES` 改为从目录派生，**消除重复来源**（R1）
- [x] T040 [P] [US1] 单元测试 `agent-backend/tests/unit/builtin-tool-catalog.spec.ts`：**核心不变式——用现状运行期取值渲染模板后，结果 MUST 与改造前 `buildBuiltinTools` 产出的 `description` 逐字相等**；并断言 5 项的 `writable` 标记（仅 `write_file` 为 `true`）
- [x] T041 [US1] 新增 `agent-backend/src/routes/builtin-tools.ts`（`GET /api/builtin-tools`，只读；R2）并在 `agent-backend/src/server.ts` 注册
- [x] T042 [P] [US1] 集成测试 `agent-backend/tests/integration/builtin-tools.spec.ts`（结构合法、`description_template` **保持占位符形态不被替换**、`total=5`）

### 后端（平台）

- [x] T043 [US1] 实现 `admin-backend/src/domain/config-center/agent-design.ts`（数字人设计态 CRUD + 五类配置校验：SOUL 非空、名称合法性、三类引用必须存在于统一清单、场景目录清单拒空/重/非法；`data-model.md` §5）
- [x] T044 [US1] 实现 `admin-backend/src/domain/config-center/references.ts`（引用推导 + 异常判定：引用失效工具/服务/SKILL 时标记并指明名称）
- [x] T045 [US1] 实现 `admin-backend/src/routes/builtin-tools.ts`（`contracts/admin-api.md` §2.1，只读投影，保持模板形态）
- [x] T046 [US1] 实现 `admin-backend/src/routes/agents.ts`（`contracts/admin-api.md` §5.1~§5.5）
- [x] T047 [P] [US1] 集成测试 `admin-backend/tests/integration/agents.spec.ts`（新建/名称冲突/非法名/SOUL 空拒绝/清单外引用拒绝/原样回显含换行标点/删除阻止）
- [x] T048 [P] [US1] 集成测试 `admin-backend/tests/integration/builtin-tools.spec.ts`（正常投影 + 运行环境不可达 → `ADM_RUNTIME_UNREACHABLE`）
- [x] T049 [P] [US1] 单元测试 `admin-backend/tests/unit/agent-design.spec.ts`（五类校验的正/异/边界三类场景——原则三）

### 前端（平台）

- [x] T050 [P] [US1] 实现 `admin-frontend/src/api/agents.ts` 与 `admin-frontend/src/api/builtin-tools.ts`（**类型与契约 §2.1/§5 一一映射**，原则七）
- [x] T051 [P] [US1] 实现 `admin-frontend/src/composables/useAgentDesign.ts`（设计态加载/编辑草稿/保存）
- [x] T052 [US1] 实现 `admin-frontend/src/components/agents/AgentCardList.vue`（卡片展示名称与用途描述；异常卡片可辨识且不影响其余；`FR-006`、`FR-014`）
- [x] T053 [US1] 实现 `admin-frontend/src/components/agents/AgentDesigner.vue`（五类配置以**分区/页签**承载，导航深度不超过两级；`FR-016`、`FR-053`）
- [x] T054 [P] [US1] 实现 `admin-frontend/src/components/agents/SoulEditor.vue`（必填非空校验 + 原样回显）
- [x] T055 [P] [US1] 实现 `admin-frontend/src/components/agents/McpSelector.vue`（从平台统一清单取值）
- [x] T056 [P] [US1] 实现 `admin-frontend/src/components/agents/ToolSelector.vue` 与 `BuiltinToolCatalog.vue`（**只读目录视图**，说明以占位符模板呈现、**不出现具体用户目录名或会话标识**；`FR-012`、`FR-054`）
- [x] T057 [P] [US1] 实现 `admin-frontend/src/components/agents/SkillSelector.vue`
- [x] T058 [P] [US1] 实现 `admin-frontend/src/components/agents/ScenarioEditor.vue`（场景名 + "数据准备"二级目录清单，拒绝空值/重复/含分隔符/`..`；`FR-020`）
- [x] T059 [P] [US1] 组件测试：`AgentDesigner.spec.ts`、`ToolSelector.spec.ts`、`BuiltinToolCatalog.spec.ts`、`ScenarioEditor.spec.ts`、`AgentCardList.spec.ts`（三类场景：props / emit / 边界）
- [x] T060 [US1] 无障碍验证：数字人设计区**仅用键盘**走完"进区 → 新建 → 填五类 → 保存 → 返回"；保存失败提示在 `aria-live` 播报（原则四）

**Checkpoint**: 此时 US1 可独立演示——数字人设计闭环可用，无需部署。

---

## Phase 4: User Story 2 - 数字人分发与部署生效 (Priority: P2)

**Goal**: 点击"部署生效"后，经**部署前校验**把数字人五类配置**整体覆盖**式分发到 `.opt-agent/users/{uid}/agents/{agent}/`。

**Independent Test**: 给某用户关联一个数字人 → 点击部署 → 运行环境该目录出现完整配置，且文件空间数据 100% 不变（`spec.md` US2 独立测试）。

### 后端（平台）

- [x] T061 [US2] 实现 `admin-backend/src/domain/mcp/service-config.ts`（MCP **服务级配置**的读写：按运行形态分别声明的 `endpoints`、`writable`、`permission_scope`、`file_args`；`data-model.md` §3.2）
- [x] T062 [US2] 实现 `admin-backend/src/infra/opt-agent-writer.ts`（**临时目录构建在同挂载点内 → 目录级原子 `rename`**；`EXDEV` 时降级为逐文件替换 + 回滚；`research.md` D8）
- [x] T063 [P] [US2] 单元测试 `admin-backend/tests/unit/opt-agent-writer.spec.ts`（原子替换、失败零残留、`EXDEV` 降级路径——**该降级路径 MUST 被测试覆盖**）
- [x] T064 [US2] 实现 `admin-backend/src/domain/deploy/precheck.ts`（**只读**部署前校验：①配置完整性 ②引用有效性 ③命名与路径安全 ④目标可写 ⑤**运行形态地址齐备**；**一次性列出全部错误项**；信息读取不到即按失败处理；`FR-027`、`FR-057`）
- [x] T065 [US2] 实现 `admin-backend/src/domain/deploy/materialize.ts`（**整体覆盖**物化：五类配置 + SKILL 从库物化 + `MCP.json` 的 `url` **按目标运行形态取值**；`FR-026`、`FR-056`。**写入 MUST 以目录级原子替换完成**，MUST NOT 原地逐文件改写正在被读取的文件——这是 `FR-034`「不中断进行中的回答」在平台侧的落地，落地方式见 T062）
- [x] T066 [US2] 实现 `admin-backend/src/domain/deploy/manifest.ts` 与 `history.ts`（部署清单、部署历史、与清单的差异报告；`FR-031`、`FR-032`、`FR-033`）
- [x] T067 [US2] 实现 `admin-backend/src/domain/config-center/user-links.ts`（用户与其关联数字人的读写；`FR-024`、`FR-025`）
- [x] T129 [US2] **运行环境**：为数字人实例加入**配置指纹**，并在取用池中实例前比对，不一致即丢弃重建（`FR-034`、`plan.md` R7、`contracts/runtime-api-delta.md` §8；落点 `agent-backend/src/infra/agent-factory.ts` 记录指纹 ＋ `agent-backend/src/server.ts` 的 `getOrCreateAgent` 命中后先比对）
- [x] T130 [P] [US2] **运行环境**单元测试 `agent-backend/tests/unit/agent-config-fingerprint.spec.ts`：守住 `runtime-api-delta.md` §8.4 的三条不变式——①配置目录被改动后，**下一次取用 MUST 返回新实例**（内容与磁盘一致）；②配置**未**变化时 MUST 命中同一实例（池化收益不被破坏）；③`activeThreads > 0` 的实例 MUST NOT 因指纹变化被立即销毁（不中断进行中的轮次）

> **编号说明**：T129／T130 为 `/speckit.analyze` 修复阶段新增（`FR-034` 的实例池缺口），为避免重排既有 128 条 ID 而接续末号，**逻辑上属本阶段（US2）**，执行顺序按其在阶段内的位置。
- [x] T068 [US2] 实现 `admin-backend/src/domain/references.ts` 的路由层 `admin-backend/src/routes/references.ts`（`contracts/admin-api.md` §7.1，**仅供确认环节调用**）
- [x] T069 [US2] 实现 `admin-backend/src/routes/users.ts`（§6.1~§6.4）与 `admin-backend/src/routes/deploy.ts`（§6.5~§6.8）
- [x] T070 [P] [US2] 集成测试 `admin-backend/tests/integration/deploy.spec.ts`——**MUST 覆盖 `contracts/admin-api.md §6.5`~`§6.8` 与 `§7.1` 的每一个端点**（原则三：每个接口端点 MUST 有集成测试）。用例 MUST 至少包含：①**核心负向**——校验不过 → 运行环境**零写入**且**一次性列出全部错误项**（`SC-020`）；②运行形态缺地址 → `ADM_RUNTIME_FORM_NOT_CONFIGURED`；③单用户失败零写入、其余用户不受影响（`FR-029`）；④幂等（`FR-030`）；⑤`ADM_DEPLOY_VALIDATION_FAILED` 的 `details.errors` 完整性；⑥**双形态对比（`SC-024`）**——同一数字人在"容器编排内网"与"宿主机本地"两种目标形态下各部署一次，断言 `MCP.json` 的 `url` 分别取对应取值，且**全程未修改宿主机 hosts 文件、未手工编辑数字人配置文件**；⑦**既有数据零破坏（`SC-007`）**——部署前后清点既有数字人／SKILL／用户数量，断言不减少；⑧`§7.1` 的 `references` 各 `target_type` 返回的受影响清单与数字人配置中的引用**一致**
- [x] T071 [P] [US2] 集成测试 `admin-backend/tests/integration/deploy-scope.spec.ts`——**作用域守卫**：部署前后三个文件空间（数据准备／共享空间／临时空间）下既有文件与二级目录**数量与内容 100% 不变**，含"场景目录清单收缩"场景（`FR-028`、`SC-012`）。**并补两项**：①**`SC-009`**——在库中修改一个被 N 个数字人引用的 SKILL 后部署一次，断言这 N 个数字人技能目录中的内容 100% 与库中版本一致；②**`SC-019`**——同一用户关联 N 个数字人且场景各不相同时，部署后各数字人按**各自**场景加载，且改其中一个的场景不影响其余数字人的可见范围
- [x] T072 [P] [US2] 集成测试 `admin-backend/tests/integration/users.spec.ts`（新建/重复/非法标识/关联与解除/删除）
- [x] T073 [P] [US2] 单元测试 `admin-backend/tests/unit/deploy-precheck.spec.ts`（五类校验项各自的正/异/边界 + "信息读取不到按失败处理"）

### 前端（平台）

- [x] T074 [P] [US2] 实现 `admin-frontend/src/api/users.ts` 与 `admin-frontend/src/api/deploy.ts`
- [x] T075 [P] [US2] 实现 `admin-frontend/src/composables/useDeploy.ts`（校验预检、部署、结果与历史）
- [x] T076 [US2] 实现 `admin-frontend/src/components/deploy/UserCardList.vue`（用户名 + 已关联数字人角色名清单；可展开搭配摘要与异常标记，作为**部署前核对总账**；`FR-023`）
- [x] T077 [US2] 实现 `admin-frontend/src/components/deploy/UserEditor.vue`（新建/编辑用户、增加或移除关联数字人；`FR-024`、`FR-025`）
- [x] T078 [US2] 实现 `admin-frontend/src/components/deploy/DeployPanel.vue`（目标运行形态可见 + 校验预检结果 + 部署触发 + 结果明细 + 与清单的差异；`FR-032`、`FR-057`）
- [x] T079 [US2] 实现 `admin-frontend/src/components/deploy/RuntimeFormSwitch.vue`（切换目标运行形态，**提示"既有部署产物将按新形态重新物化"并二次确认**；`FR-057`、`FR-007`）
- [x] T080 [P] [US2] 实现 `admin-frontend/src/components/deploy/DeployHistoryList.vue`（有界返回 + 分页/条数上限）
- [x] T081 [P] [US2] 实现 `admin-frontend/src/components/deploy/AnomalySummary.vue`（**全局异常项汇总**，一次列出全部受影响数字人及所属用户，可跳转编辑位置；`FR-055`、`SC-016`）
- [x] T082 [P] [US2] 组件测试：`UserCardList.spec.ts`、`DeployPanel.spec.ts`、`RuntimeFormSwitch.spec.ts`、`AnomalySummary.spec.ts`
- [x] T083 [US2] 无障碍验证：部署区的破坏性操作确认框（原生 `<dialog>`）Esc 关闭、焦点归还；部署结果 `aria-live` 播报；切换运行形态需二次确认

**Checkpoint**: US1 + US2 合起来即完整的"设计 → 部署"闭环（平台的核心价值）。

---

## Phase 5: User Story 3 - SKILL 管理与安装 (Priority: P3)

**Goal**: 维护全平台共享 SKILL 库：浏览、查看与编辑正文、上传 ZIP 安装（含标准格式与安全校验）。

**Independent Test**: "上传一个合规 ZIP → 卡片列表出现该 SKILL → 编辑正文并保存 → 内容原样回显"（`spec.md` US3 独立测试）。

- [x] T084 [US3] 实现 `admin-backend/src/domain/skill-library/metadata.ts`（解析 `SKILL.md` 元数据块：`name` / `description` 非空、`name` 可作目录名）
- [x] T085 [US3] 实现 `admin-backend/src/domain/skill-library/archive.ts`（用 `yauzl` 以 `lazyEntries: true` **先校验后解压**：拒绝绝对路径、`..` 穿越、符号链接；限制总大小/文件数/嵌套层级；`contracts/runtime-api-delta.md` §4 与 `research.md` D7）
- [x] T086 [US3] 实现 `admin-backend/src/domain/skill-library/install.ts`（**原子入驻**：校验全部通过后才写入；失败回滚，**MUST NOT 留下半解压残留**；`FR-041`；名称冲突 → 显式覆盖或取消；`FR-040`）
- [x] T087 [P] [US3] 构造恶意夹具：`admin-backend/tests/fixtures/skills/`（合规包、缺 `SKILL.md`、元数据缺字段、`../` 越界、绝对路径、含符号链接、超大、深层嵌套、重复条目名）
- [x] T088 [US3] 实现 `admin-backend/src/routes/skills.ts`（`contracts/admin-api.md` §4.1~§4.5，含 `multipart/form-data` 上传）
- [x] T089 [P] [US3] 集成测试 `admin-backend/tests/integration/skills.spec.ts`（**全部恶意夹具逐条被拒且错误码正确**、失败零残留、名称冲突流程、原子覆盖、编辑回显）
- [x] T090 [P] [US3] 单元测试 `admin-backend/tests/unit/skill-archive.spec.ts`（7 项校验的正/异/边界——原则三）
- [x] T091 [P] [US3] 实现 `admin-frontend/src/api/skills.ts`
- [x] T092 [P] [US3] 实现 `admin-frontend/src/composables/useSkills.ts`
- [x] T093 [US3] 实现 `admin-frontend/src/components/skills/SkillCardList.vue`（展示技能名与描述；`FR-035`）
- [x] T094 [US3] 实现 `admin-frontend/src/components/skills/SkillViewer.vue` 与 `SkillContentEditor.vue`（查看元数据与**正文全文**、编辑后原样回显；`FR-036`）
- [x] T095 [US3] 实现 `admin-frontend/src/components/skills/SkillUploadDialog.vue`（原生 `<dialog>` + 原生文件选择；冲突时要求显式选择「覆盖」或「取消」；被引用时列出受影响数字人清单；`FR-040`、`FR-042`）
- [x] T096 [P] [US3] 组件测试：`SkillCardList.spec.ts`、`SkillContentEditor.spec.ts`、`SkillUploadDialog.spec.ts`（含失败态与冲突分支）
- [x] T097 [US3] 无障碍验证：上传对话框与正文编辑器键盘可达；上传失败原因可读且在 `aria-live` 播报

**Checkpoint**: SKILL 库可独立交付价值（US1 的技能选择器由此获得选材来源）。

---

## Phase 6: User Story 4 - MCP 服务管理 (Priority: P4)

**Goal**: 以卡片浏览容器编排声明的 MCP 服务，配置服务级信息，启停、测试、查看日志与调用统计。

**Independent Test**: "列出 MCP 服务 → 配置其调用信息 → 查看工具清单 → 启停该服务 → 查看日志与调用次数统计"（`spec.md` US4 独立测试）。

### 运行环境改动（R4）

- [x] T098 [US4] 在 `agent-backend` 的 MCP 工具适配层加入**按服务名的调用计数**（成功/失败分列 + `last_called_at`），持久化到既有 `UsageDb`（`CREATE TABLE IF NOT EXISTS`，不新增数据库引擎；`contracts/runtime-api-delta.md` §4.2）
- [x] T099 [US4] 新增 `agent-backend/src/routes/mcp-call-stats.ts`（`GET /api/mcp-call-stats`，只读）并在 `agent-backend/src/server.ts` 注册（R4）
- [x] T100 [P] [US4] 集成测试 `agent-backend/tests/integration/mcp-call-stats.spec.ts`（未出现过服务不出现于 `items`；`stats_available` 语义；计数随调用递增）

### 后端（平台）

- [x] T101 [US4] 实现 `admin-backend/src/infra/docker-host.ts`（**Node 内置 `node:http` + `socketPath`** 直连 Docker Engine API；**操作白名单收口于此**：容器列表与状态、日志、白名单内 start/stop；不暴露任意 API 透传；`research.md` D3）
- [x] T102 [P] [US4] 单元测试 `admin-backend/tests/unit/docker-host.spec.ts`（socket 不可达、非白名单服务拒绝、日志有界截断）
- [x] T103 [US4] 实现 `admin-backend/src/infra/mcp-client.ts`（基于既有 `@modelcontextprotocol/sdk`：列工具、连通性检查与一次实际能力验证）
- [x] T104 [US4] 实现 `admin-backend/src/domain/mcp/service-list.ts`（**清单以容器编排声明为唯一来源**；与 Docker 实际状态合成；与平台服务级配置比对产出 `in_compose` 与异常原因；`FR-043`、`FR-052`）
- [x] T105 [US4] 实现 `admin-backend/src/domain/mcp/operations.ts`（启停 + 测试 + 日志 + 调用统计的领域逻辑，含 `FR-047` 的"不得把失败误报为成功"）
- [x] T106 [US4] 实现 `admin-backend/src/routes/mcp.ts`（`contracts/admin-api.md` §3.1~§3.8）
- [x] T107 [P] [US4] 集成测试 `admin-backend/tests/integration/mcp.spec.ts`（列表自动识别新增服务、详情工具清单、服务级配置保存后影响所有引用数字人、启停状态反映真实结果、测试失败给出明确原因、日志有界、统计不可达时**不以 0 冒充**）
- [x] T108 [P] [US4] 单元测试 `admin-backend/tests/unit/mcp-service-list.spec.ts`（编排改名/移除时的差异检测；`FR-052`）

### 前端（平台）

- [x] T109 [P] [US4] 实现 `admin-frontend/src/api/mcp.ts`
- [x] T110 [P] [US4] 实现 `admin-frontend/src/composables/useMcpServices.ts`
- [x] T111 [US4] 实现 `admin-frontend/src/components/mcp/McpCardList.vue`（**名称、用途描述**、传输方式、状态四态；`FR-043`、`FR-006`）
- [x] T112 [US4] 实现 `admin-frontend/src/components/mcp/McpServiceDetail.vue`（工具清单 + 服务级配置编辑，**含按运行形态分别声明的地址输入**；`FR-045`、`FR-056`）
- [x] T113 [US4] 实现 `admin-frontend/src/components/mcp/McpServiceConfigForm.vue`（**`description`（用途描述，供卡片展示）**、`endpoints` 按形态分组、`writable`、`permission_scope`、`file_args`）
- [x] T114 [P] [US4] 实现 `admin-frontend/src/components/mcp/McpToolList.vue`（用途与入参说明，有界返回）
- [x] T115 [P] [US4] 实现 `admin-frontend/src/components/mcp/McpLogViewer.vue`（时间倒序、有界、量大仍快速返回；`FR-048`）
- [x] T116 [P] [US4] 实现 `admin-frontend/src/components/mcp/McpStatsTable.vue`（累计/成功/失败/最近调用时间；不可用时显示"未知"而非 0；`FR-049`）
- [x] T117 [US4] 实现 `admin-frontend/src/components/mcp/McpTestPanel.vue`（连通性 + 能力验证结果与**明确失败原因**；`FR-047`）
- [x] T118 [P] [US4] 组件测试：`McpCardList.spec.ts`、`McpServiceConfigForm.spec.ts`、`McpLogViewer.spec.ts`、`McpStatsTable.spec.ts`
- [x] T119 [US4] 无障碍验证：关闭被引用服务的二次确认（原生 `<dialog>`）、日志与统计表格的读屏可读性、状态下拉键盘操作

**Checkpoint**: 四个功能区全部可用。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事的收尾、门禁全量复核与交付确认

- [x] T120 [P] 契约四处同步核查：`contracts/admin-api.md` ↔ `admin-frontend/src/api/types.ts` ↔ `admin-backend` 的 JSON Schema ↔ 测试用例（原则七）。**MUST 含一条机械核对**：脚本逐一提取契约内出现的**全部错误码**（`ADM_*` 与复用码）与 `§0.4` 错误码表比对，出现"端点使用但表内未登记"或"表内登记但无端点使用"即视为不一致（来源：`/speckit.analyze` 发现 `ADM_AGENT_NOT_FOUND` 被端点使用却未登记）。发现不一致即修正文档并登记
- [x] T121 [P] 覆盖率复核：两个新子项目的 `test:coverage` MUST 通过（受约束模块 ≥ 80%）；**受约束模块清单 MUST 覆盖全部新增 `domain/` 与 `infra/` 模块**；地板只可上调
- [x] T122 [P] 性能与可用性验证：`SC-002`（列表 ≤1s）、`SC-021`（预校验 ≤3s）、`SC-022`（翻页 ≤100ms）、`SC-023`（单页恒 8 项）、原则五（接口 P95 ≤500ms）、**`SC-001`**（从零新建一个完整数字人并完成部署生效 ≤5 分钟，按 `quickstart.md` §7 的步骤计时）、**`SC-015`**（从一级导航到任一配置实体的编辑位置 ≤3 次点击，逐页手动计数）；在 `spec.md` 或 `quickstart.md` 记录测量口径与结果
- [x] T123 [P] 无障碍全量复核：`prefers-reduced-motion` 降级、状态不只靠颜色、全部交互控件键盘可达（原则四）
- [x] T124 执行 `quickstart.md` §7 的四个用户故事端到端验证，逐条核对期望结果
- [x] T125 本地门禁全量跑通：`agent-backend` 与 `frontend` 既有门禁**保持全绿**（防止误伤），两个新子项目门禁全绿，含 `check:lines` 与 `check:deps`
- [x] T126 部署验证：`docker compose up -d --build` 拉起后执行 `quickstart.md` §6 的**非交互冒烟确认**；MUST NOT 只依赖手动点界面（原则八）
- [x] T127 [P] 更新 `specs/001-digital-human-platform/checklists/requirements.md`：追加本特性实现期新增的澄清项与验证证据
- [x] T128 [P] 登记 `plan.md` § 待办 1（既有特性规格产物缺失）与待办 2（前端覆盖率缺口）的处置状态；待办 3（行数/依赖清单自动检查）标记为**已由 T007/T008 落地于两个新子项目**，并**明确注明**既有 `frontend`／`agent-backend` 的对应检查仍属待办（按「不追溯」不在本特性范围内）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**：无依赖，可立即开始。**T001 MUST 最先完成**（规格口径回写，否则后续任务建立在旧口径上）
- **Phase 2（Foundational）**：依赖 Phase 1 的骨架与工具链；**阻塞所有用户故事**
- **Phase 3（US1，P1）**：依赖 Phase 2。其中的 **T037~T042（R1/R2）MUST 先于 T045/T056 完成**——工具目录是设计区的选材来源
- **Phase 4（US2，P2）**：依赖 Phase 2；**T061（服务级配置）先于 T065（物化）**
- **Phase 5（US3，P3）**：依赖 Phase 2。与 US1/US2 **互不阻塞**（SKILL 库可独立交付）
- **Phase 6（US4，P4）**：依赖 Phase 2；**T061 是 T104/T106 的前置**（服务级配置复用）
- **Phase 7（Polish）**：依赖全部用户故事完成

### Within Each User Story

- 测试与实现同任务内完成（本项目不采用"先写失败测试再实现"的严格 TDD 流程，但**测试 MUST 在任务标记完成前跑通**）
- 领域层（`domain/`）先于路由层（`routes/`）
- 后端端点先于前端消费（但前端任务可按契约先行开发，**契约是唯一事实源**）
- 每完成一个任务 MUST 就地运行受影响的测试（原则三：MUST NOT 推迟到打包/部署阶段）

### Story Completion Order

```text
Setup → Foundational ─┬─ US1 (P1, MVP) ─┬─ US2 (P2) ─── Polish
                      ├─ US3 (P3) ──────┤
                      └─ US4 (P4) ──────┘
```

US1 是 MVP。US2 依赖 US1（要有数字人才能部署）。US3、US4 可与 US1/US2 并行（不同文件、不同端点）。

---

## Parallel Execution Examples

### Phase 1 并行示例

```text
# 骨架与配置（互不依赖）
T003 admin-frontend 骨架 | T004 admin-backend tsconfig/eslint | T005 vitest 配置
T007 check-lines 脚本    | T008 check-deps 脚本              | T009/T010 两个 Dockerfile
# 基础设施（不同文件）
T011 gateway/nginx.conf  | T012 docker-compose.yml          | T013 删两个 Dockerfile.test
```

### US1 并行示例

```text
# 后端（不同文件）
T037 builtin-tool-catalog.ts | T038 builtin-tools.ts 改造 | T039 BUILTIN_TOOL_NAMES 派生
# 前端组件（不同文件）
T054 SoulEditor.vue | T055 McpSelector.vue | T056 ToolSelector.vue | T057 SkillSelector.vue | T058 ScenarioEditor.vue
```

### US3 与 US4 并行示例

```text
# 两个故事由不同人负责，无文件冲突
负责人 A：T084~T090（SKILL 领域与端点，admin-backend/src/domain/skill-library/**）
负责人 B：T098~T108（MCP 领域与端点，admin-backend/src/domain/mcp/**）
```

---

## Implementation Strategy

### MVP First（仅 US1）

1. 完成 Phase 1（含 T001 规格回写）
2. 完成 Phase 2（Foundational，**CRITICAL**——阻塞全部故事）
3. 完成 Phase 3（US1，含 R1/R2 运行环境前置改动）
4. **停下并独立验证**：`spec.md` US1 的独立测试——新建数字人、填五类配置、保存、重新打开一致
5. 可演示：数字人设计闭环已可用

### Incremental Delivery

1. Setup + Foundational → 地基就绪
2. + US1 → 独立验证 → **可演示（MVP）**
3. + US2 → 独立验证 → **"设计 → 部署"闭环打通**（平台核心价值达成）
4. + US3 → 独立验证 → SKILL 库可用
5. + US4 → 独立验证 → 四个功能区齐备
6. + Polish → 门禁全绿、部署冒烟通过

### 建议实现顺序的理由

- **R1/R2 先于 US1**：工具目录是设计区三大选择器之一的选材来源，且 `FR-012` 要求说明为**占位符模板**——现状是运行期拼接，不先做目录，设计区就得先硬编码一份清单（违反 `FR-011` 与原则六）。
- **US2 紧跟 US1**：规格假设明确"实现顺序按 P1 数字人设计 → P2 数字人部署"，因为只有分发下去才产生业务价值；且 US2 的部署前校验需要 US1 的设计态与引用推导。
- **US4 最后**：它是运维支撑能力，不阻塞"设计 → 部署"的价值闭环（`spec.md` US4 的优先级理由）。

---

## Notes

- `[P]` 任务＝不同文件且无依赖；同一文件的多处改动 MUST 串行
- `[Story]` 标签用于追溯：每个故事 MUST 可独立完成与独立测试
- **测试 MUST 在宿主机本地跑**（宪章原则三）；容器只做部署与运行
- **MUST NOT** 为新子项目创建 `Dockerfile.test` 或 `test` profile（宪章 2.0.0）
- 每完成一个任务或逻辑分组即提交；提交信息用中文并说明影响侧（原则八）
- 遇到与规格/契约不一致处：**先回写文档再改代码**（原则一），MUST NOT 只改代码
- 单文件超过 500 行时按"拆子组件 / 抽 `useXxx` / 抽纯函数"拆分（原则二，硬门禁）
- 引入任何 `research.md` D2 之外的依赖即视为违规（原则六）

---

## 实现完成记录（2026-09-15）

**全部 130 条任务（T001~T130）已完成并就地验证。** 证据汇总在 `quickstart.md` §10，此处只记要点与偏差。

### 交付物

```text
admin-backend/     # 独立管理服务（Fastify 5 + TS），26 个测试文件 / 367 用例，源码 62 个文件
admin-frontend/    # 独立管理界面（Vue 3 + Vite，零第三方运行时库），29 个测试文件 / 252 用例
platform-data/     # 平台设计态（bind mount，不进镜像）
均并入 gateway/nginx.conf（2 条 location）与 docker-compose.yml（6 服务）
```

### 门禁四项（原则八 / 硬门禁）

| 子项目 | lint | typecheck | test | test:coverage | build | check:lines | check:deps | check:contract |
|---|---|---|---|---|---|---|---|---|
| `admin-backend` | ✅ | ✅ | ✅ 367 | ✅ 92.5/81.2/94.3/94.1 | ✅ | ✅ | ✅ | ✅ |
| `admin-frontend` | ✅ | ✅ | ✅ 266 | ✅ 96.0/89.6/98.9/96.5 | ✅ | ✅ | ✅ | — |
| `agent-backend`（防误伤） | ✅ | ✅ | ✅ 74（含集成；unit 55） | ✅（新增 4 模块入 80% 清单） | ✅ | — | — | — |
| `frontend`（防误伤） | ✅ | ✅ | ✅ 117 | ✅ | ✅ | — | — | — |

### 与任务的偏差（三处，均已在文档中登记）

1. **T120 的机械核对落了脚本而非只靠人工**：新增 `admin-backend/scripts/check-error-codes.mjs`（`npm run check:contract`），逐一提取契约全文错误码与 §0.4 总表、后端码表、前端文案表比对。核对结果：§0.4 登记 **24** 个错误码（任务描述里的"23 个"是笔误——`ADM_AGENT_NOT_FOUND` 也在表内），三处一致。
2. **T101 提前到 Phase 2 落地**：`GET /api/admin/platform/health` 需要 socket 可达性判定，故 `infra/docker-host.ts` 与 Phase 2 的平台端点一同实现；Phase 6 只补其运维操作（启停/日志）。
3. **T129／T130 的实现方式**：为同时满足"新对话立即生效"与"进行中的回答不中断"，`AgentPool` 增加了**退休表**（`retire` / `sweepRetired`）——被换代且仍有在途轮次的实例不立即销毁，等轮次结束后由既有的每分钟调度回收。三条不变式均有单测（`agent-config-fingerprint.spec.ts`，10 用例）。
4. **（2026-09-15 验收后调整）MCP 服务级配置移除 `writable` / `permission_scope`**：产品决定——平台不再声明 MCP 服务的写能力与权限边界，物化产物（`MCP.json`）随之不再产生 `write` / `permission_boundary`（运行环境"声明写能力必须给边界"的校验自然永不触发）。旧客户端提交这两个字段不再报错（忽略），读取历史存档时收敛移除。影响：**平台当前没有任何途径把某个 MCP 服务声明为可写**——将来若接入需要写用户文件的外部 MCP 服务，需恢复这对字段。契约（`admin-api.md` §3.3）与数据模型（`data-model.md` §3.2）已同步登记。
5. **（2026-09-15 二次调整）** ①"服务级配置"更名为"**调用配置**"（界面文案、组件文件 `McpCallConfigForm.vue`、注释与操作性文档同步；`spec.md` 等历史快照保留原名）；②修复**详情页保存调用配置永远静默失败**的接线缺陷——`useMcpServices.saveConfig` 原实现 `if (!detail.value) return null`，而详情页实例从未 `loadDetail`，改为支持显式传入 `revision` 并补回归测试；③详情页签重排为"服务启停（首位）/ 调用配置（内嵌连通性测试）/ 工具清单 / 运行日志 / 调用统计 / 编排声明（独立页签，仅查看）"；④宿主目录 `platform-data/` 更名 `.platform-data/`（隐藏目录、仍为 bind mount 与本地双向同步，容器内路径 `/app/platform-data` 不变，`.gitignore` 同步）；⑤传输方式展示名改为 `streamable-http`（内部值 `http` 不变——运行环境即以 Streamable HTTP 传输连接）；⑥"发起测试"支持以**表单当前（未保存）值**探测（`POST /test` 可选 body），并在报告中回显 `target`（实际被测地址），修复"改了地址测试永远通过（测的是旧地址）"的误导；⑦编排原始声明并入"服务启停"页签（声明在上、启停按钮在下），不再单设页签；⑧**日志治理**（2026-09-15 二次调整）：两个后端的应用日志**只保留最近 3 天**（启动/跨天自动清理过期文件）、**关闭逐请求访问日志**只留关键行为（部署起止、越权告警、MCP 调用、实例池管理等）、**每行日志必须携带 user_id**（agent 侧按 run 绑定 user_id/agent_name/thread_id，admin 侧绑定固定操作者 `zyw_admin`）；compose 为全部容器日志加 json-file 轮转（10MB×3，Docker 轮转按大小不按天，属已知限制）；容器 stdout 无法携带用户身份（MCP 协议层无用户概念），MCP 调用的用户归属由 agent-backend 新增的 `mcp.tool.call` 日志（带 user_id/service/tool/ok）承担；`.platform-data/` 最终位置为 `admin-backend/.platform-data/`。

6. **（2026-09-16 三次调整）SKILL 全只读 + 逐个文件可查看**：①产品决定——**技能库全部只读**（含 `SKILL.md`），平台上不再提供任何编辑入口，修改唯一途径是重新打包 ZIP 并选择「覆盖」（本条**取代 `FR-036` 中"可编辑正文"的部分**，`spec.md` 作为需求快照保留原文；**第 7 条已撤销本条的只读决定**）；②移除 `PUT /api/admin/skills/{name}/content` 与 `SkillLibraryService.updateContent`（含组件 `SkillContentEditor.vue` 及其测试一并删除）；③新增只读端点 `GET /api/admin/skills/{name}/file?path=…` 与 `SkillLibraryService.readFile`——**路径安全口径与安装侧完全一致**（复用 `unsafeEntryReason` / `normalizeEntryName`，拒绝绝对路径、盘符、`..`、控制字符，并做技能目录前缀校验），只返回目录内普通文件，二进制（含 NUL 或非 UTF-8）只返回大小不返回正文，超出 256KB 截断并标注；④前端详情页改为"**左侧文件树 + 右侧内容预览**"（新增 `SkillFileTree.vue` / `SkillFilePreview.vue`），`SKILL.md` 与 `references/`、`scripts/` 等附件均可点击查看，二进制/截断/读取失败均有可读提示；⑤修复**Windows 打包 ZIP 装不上**的真实缺陷：yauzl 默认 `validateFileName` 拒绝反斜杠（Windows 路径分隔符）导致遍历即抛错 → 关闭其内置校验、由本项目安全检查统一承担，反斜杠按分隔符归一后再判定，配套 3 组回归用例。

7. **（2026-09-16 四次调整）开放 SKILL 在线编辑（含附件）**：①产品决定——**全部文件可编辑**（`SKILL.md` 与 `references/`、`scripts/` 等附件），撤销第 6 条的"全只读"，但**保留**其三条正确部分（路径安全与安装侧同一口径、库是唯一权威来源、不直接改物化目录）；②新增 `PUT /api/admin/skills/{name}/file` 与 `SkillLibraryService.writeFile`（文件级校验/乐观锁/原子写/快照拆到新模块 `skill-library/file-access.ts`——`install.ts` 加逻辑后越过 500 行门禁，按"一个文件"与"一个技能"两个职责分家）；③**可编辑 ⇔ 文本且 ≤ 256KB**（与预览上限同一数值）：只显示了一部分就不许改写，否则"保存即静默丢掉未显示的部分"——界面不给入口、服务端同样拒写，两侧同一判据；④并发保护用**文件内容哈希** `base_hash` 而非全局 `revision`（编辑只影响一个文件，用全局版本号会把"别处改了调用配置"误报为"这个文件被人改过"），不符即 409 且**不执行保存**；⑤退路：改写前把原文归档到 `.platform-data/skill-edits/{name}/{时间戳}/…`（**刻意放在技能目录之外**——放进去会被物化进数字人目录、还会出现在文件树里），每技能保留最近 20 组（**第 13 条已撤销本条的"编辑快照"**：保存即覆盖、不留副本，改为保存前二次确认）；⑥改 `SKILL.md` 时同步索引 `description`，`name` 不一致则**拒绝**（技能名是数字人的引用键，改名 MUST 走重新安装，否则静默打断引用）；⑦原子写入为"临时文件（建在 `skills/` 根，**不在技能目录内**）→ fsync → rename"——中间态永不落在技能目录里，避免并发部署把临时文件当技能内容拷走；⑧详情接口补 `content_hash`（界面在详情页直接改正文时不必多请求一次）；前端把 `SkillFilePreview.vue` 升级为 `SkillFileEditor.vue`（编辑区 + 保存/放弃 + 冲突时「重新加载最新内容」+ **离开守卫**：切换文件或返回列表前若有未保存修改必须确认），保存后就地更新大小与哈希（不换对象，避免把刚保存的内容重置回旧值），并由 `SkillArea` 刷新详情、播报"需重新部署后生效"。

8. **（2026-09-16 五次调整）日志治理补强**：①**写操作统一留痕**——关闭逐请求访问日志后，"谁删了数字人/谁关了服务/谁改了调用地址"在日志里查不到，现在由 `server.ts` 的 `onResponse` 钩子 + 错误处理器**一处覆盖全部写方法**：成功一条 `admin.write`、被拒一条 `admin.write.rejected`（含错误码，界面报错可直接对到日志），字段为 `action`（路由模式）/`target`/`fields`（**只有键名，不含值**，`SC-014` 口径）/`status`/`duration_ms`/`revision`/`req_id`；multipart 请求（技能安装）由路由经 `domain/audit.ts` 标注补齐对象名；②`deploy.begin/done` 补 `duration_ms`；③agent 侧补 **`run.end`**（每轮一条：`ok`/`duration_ms`/`error_code`）——此前正常/失败的一轮在日志里毫无痕迹；④**user_id 口径修正**：进程级事件（关停、实例回收、配置无效）天然不属于任何用户，统一用 `scope: 'system'` 标记，run 相关事件用 `scope: 'run'`，不再"硬塞一个 user_id"（实测 agent 侧 674 行里只有 9 行带 user_id）；⑤**实例标识**：每行加 `instance_id`（`hostname-pid-启动时刻`），并给两个后端容器固定 `hostname`——原先容器里 `pid` 恒为 1、`hostname` 是容器 ID（每次重建都变），两者都无法回答"这是哪一次运行"；⑥**告警去重**：`catalog.tools.unavailable` 改为"状态变化才报"并补 `catalog.tools.recovered`（实测同一原因 5 小时刷了 68 条），`agent.config.invalid` 改用窗口合并 `createThrottledWarn`（实测 5 次请求→1 行）；⑦删除从未接线的 `usageLogger` 通道（`usage-*.log` 永不生成，误导）；⑧**修掉三个真实缺陷**（都由这次的日志排查暴露）：**(a) 优雅关闭链断裂**——`app.close()` 抛错会吞掉整条关闭流程，`shutdown.closed`/`grace.expired` 在**整个历史日志里计数为 0**，进程 0.3 秒即退，"等在途回答写完再退"从未兑现 → 现在 catch 住 close 异常、按"先记 `shutdown.closed` 再关日志流"的顺序、末尾补 `shutdown.exit`；**(b) 日志写入器改同步追加**——异步流在退出/关闭路径上有三个实测坑（`process.exit` 截断最后一行、关闭后再写被静默丢弃、目录被清理时 ENOENT 变 unhandled error），改 `fs.appendFileSync` 一次消掉（低量低频，写阻塞可忽略）；**(c) compose `stop_grace_period: 25s`**——原 Docker 默认只等 10s < 应用 15s 宽限，每次重启都在途回答被 SIGKILL。

9. **（2026-09-16 六次调整）`transport` 兼容 `streamable-http` 别名**：真实报错——管理员按 MCP 生态的通用写法把 `MCP.json` 里的 `transport` 由 `http` 改成 `streamable-http`，运行环境抛 `transport 须为 stdio|http`，**整个数字人被排除在列表外**（`agent.config.invalid`）。二者本指同一件事（`http` 就是 SDK 的 **Streamable HTTP** 传输），界面文案也一直显示 `streamable-http`。处置：①新增 `mcp-transport.ts`（两侧同构）做**入口归一**——接受 `http` / `streamable-http` / `streamable_http` / 大小写变体，**统一归一到规范值 `http`**，避免"同一语义两种取值"扩散到比较、物化、日志与界面；②运行环境 `loadMCP.json` 校验改用归一（`agent-backend`）——`types.ts` 的 `McpServerConfig.transport` 仍是 `'stdio' | 'http'`，**不改动运行期类型**；③平台侧保存与**读取历史文档**同样归一（`admin-backend`，`service-config.ts`），保证"手工改过别名"的文档读出来仍是规范值、物化到 `MCP.json` 也只写 `http`；④错误文案改为**给出可接受取值**（`http（streamable-http）或 stdio`）并回显实际值，便于自查；⑤前端卡片展示对别名同样容错。回归测试：`agent-instance.spec.ts`（6 例，含真实报错场景）与 `service-config.spec.ts`（+3 例）。

10. **（2026-09-16 七次调整）工具调用的 `uid`/`sid` 强制穿透**：要求——调用任何工具时 `uid`（用户 id，如 `admin`）与 `sid`（当前会话 id = `thread_id`）MUST 由**运行环境**传入，**MUST NOT 交给 LLM 填**（模型不知道真实值，填错还可能越权访问他人数据）；同时**不能让不需要这两个参数的工具受影响**。落地方式：①判据取"**工具自己的入参 schema 里声明了才注入**"——声明了 `uid`/`sid` 的工具（如需要按用户隔离数据的服务）一定收到运行环境的值，**覆盖 LLM 填的任何内容**；没声明的工具（如 OCR 的 `ocr_image`）参数与 schema **原样透传**，一个多余字段都不加（第三方服务常严格校验入参）；②这些参数对 LLM **隐藏**（从暴露的 schema 里删除 `properties` 与 `required` 中的同名项）——模型无从填写，也就不可能幻觉或覆盖，且注入发生在**发出调用之前**，服务端看到的入参始终完整；③落点在 `infra/mcp/mcp-tool-adapter.ts`（新增 `RuntimeContext`/`RUNTIME_CONTEXT_PARAMS` 与 `declaredContextParams`/`exposeSchema`/`injectRuntimeContext` 三个纯函数），上下文由 `agent-factory.ts` 在**每次 run 装配工具时**注入（工具列表本就按 run 重建，`threadId` 是 per-run 的，天然没有并发串号问题）；④**内置工具无需改动**：它们经闭包拿到 `userId`/`threadId`（`FileAccess` 与 `write_file` 的会话前缀），从来就不经过 LLM；⑤若某个服务用别的参数名（`user_id`/`session_id`），只需在 `RUNTIME_CONTEXT_PARAMS` 扩一行。回归测试 `mcp-tool-adapter.spec.ts`（7 例：覆盖注入/覆盖伪造值/对 LLM 隐藏/未声明不受影响/与 file_args 共存/无上下文兜底/无 properties 兜底）。

11. **（2026-09-16 八次调整）`file_args` 支持取值路径：对象数组里的字段也能铸造**：真实对接——对方 MCP 服务（`parse_excel_files`）的入参是**对象数组** `items: [{ businessType, excelFileUrl }]`，要铸造的是数组元素里的字段，而旧口径把 `file_args` 的键当**顶层参数名**、值必须是字符串，于是这类声明**配了也不生效**（数组值不满足 `typeof value === 'string'` 被静默跳过；换成 `items.excelFileUrl` 也取不到值）。处置：①新增 `file-arg-path.ts`（**两侧同构**：`agent-backend/src/domain/` 含解析 + 改写引擎，`admin-backend/src/domain/mcp/` 只含语法校验）——键从"参数名"泛化为**取值路径**：`image`（顶层，与旧写法完全等价）、`files[]`（字符串数组逐元素）、`items[].excelFileUrl`（对象数组的元素字段）、`groups[].files[].url`（多级嵌套）；语法刻意最小：分段用 `.`、数组写 `[]`（"每个元素"）、**不支持下标**（"第 0 项要铸造"没有业务含义，下标写法还会随数据形状漂移）；②**消灭静默**——旧实现在"参数缺失/非字符串"时一律 `continue`，是本次问题的根源，现改为三条判据：**取不到值**（键未提供/为 `null`/空串）→ 原样透传 **并记 `mcp.fileargs.unmatched` 告警日志**（可选参数是合法场景，声明写错也长这样，日志让后者可查）；**形状不符**（该是数组不是数组、该是对象不是对象、叶子不是字符串）→ **抛错、调用不发出**（工具结果给出"声明了哪条路径、期望什么、实际是什么"，数组元素还补 `（元素 items[i]）` 下标）；**叶子已是 `http(s)://` 直链** → 原样透传；③**修掉一个会误伤整次调用的隐患**：该字段在对方 schema 里明写"可下载的 http/https 地址"，而旧实现把**任何字符串**都送进沙箱，`https://…` 会被 `resolveSafe` 判为"目录不在白名单"（顶级段变成 `https:`）而抛 `PermissionError`，导致**同一批里的合法文件也一起失败**——现按"已是直链就不再铸造、也不进沙箱"处理；④两侧统一入口校验（平台保存 `service-config.ts`、运行环境加载 `agent-instance.ts`）——非法路径当场给可读错误（回显正确写法），杜绝"保存成功、物化成功、运行期静默不生效"；⑤前端配置表单的提示与错误文案补上 `[]` 写法与示例。回归测试：`file-arg-path.spec.ts`（7 例，语法边界）、`mcp-tool-adapter.spec.ts`（+13 例，对象数组逐元素铸造/外部直链透传且不进沙箱/字符串数组/多级嵌套/顶层回归/取不到值留痕/元素缺字段/空数组/三类形状不符/非法声明兜底/沙箱拒绝带下标/入参非对象）、`agent-instance.spec.ts`（+3 例）与 `service-config.spec.ts`（+2 例）、`materialize.spec.ts`（+1 例，路径原样物化到 `MCP.json`）。
   **真实链路验证**（真 MCP 服务 + 真铸造 + 真回源，一次性脚本，未进仓库）：起一个 Streamable HTTP MCP 替身并原样使用对方给的 `inputSchema`；写真实 `MCP.json`（`transport: streamable-http` + `items[].excelFileUrl`）交 `loadAgentConfig` 解析；真实 `McpManager` 建连并 `listTools`；真实 `FileAccess` + 用**容器里那把密钥与对外基址**铸造；服务端**实际收到** `http://backend:3000/api/files/raw?u=admin&p=临时空间%2Fverify-mint.xlsx&exp=…&sig=…（64 位）`（外部直链一项原样透传）；再用该 URL（主机换成宿主机网关）回源下载，**200 / 字节数与 sha256 一致**。

12. **（2026-09-16 九次调整）部署范围支持"只选一部分用户"**：要求——能只选某个用户（如 `zpf`）做**预检与部署**，而不是每次都动全平台。此前 `user_ids` 在接口层已支持（且契约 §6.5/§6.6 早已写明"缺省表示全部用户"），但**界面无处可传**，实际上只能全量部署。处置：①新增只读端点 `GET /api/admin/deploy/targets`（契约 §6.9，有界返回 `{items:[{user_id, agents, agent_count}], total, truncated}`），枚举来源与 `validate`/`deploy` 的 `user_ids` **完全相同**（用户关联表），保证"界面上能勾的"与"真能部署的"是同一批对象；②部署面板新增「**部署范围**」区——用户复选框多选 + 全选/清空，并**显式写明"不勾选 = 全部用户"**（与服务端缺省语义一致，避免误动全平台），播报与结果文案带上范围（如 `部署前校验通过（范围：已选用户 zpf）`）；③**范围或目标运行形态一变，上一次预检结论即作废**（`useDeploy.invalidateValidation`）——否则会出现"用 A 范围的结论去部署 B 范围"；服务端部署时本来就会重新校验（不会真写错），但界面若继续显示"已预检"就成了假承诺；④已勾选用户被删除后，重载目标清单时就地收敛，避免预检整单报 `ADM_USER_NOT_FOUND`；⑤清单拉取失败只提示、不阻断（仍可部署全部用户）。回归测试：`deploy.spec.ts`（+3 例：目标清单形状含未关联用户、**只选一个用户时其余用户零写入且清单只记本次用户**、`limit` 有界与 `truncated`）、`useDeploy.spec.ts`（+8 例）、`DeployPanel.spec.ts`（+5 例）、`api/modules.spec.ts`（+1 例路径断言）。（**第 14 条已撤销本条的"部署范围"选择区与 `§6.9` 端点**：改为在用户卡片上勾选部署对象。）

13. **（2026-09-16 十次调整）撤销 SKILL 编辑快照，改为保存前二次确认"不可恢复"**：产品决定——`.platform-data/skill-edits/**` 这套"改写前归档原文、每技能留 20 组"的退路**无用**，删除；保存**直接写回原处**，但保存前**弹窗告知"保存后无法恢复"**。处置：①`file-access.ts` 移除 `EDIT_BACKUPS_DIR`/`MAX_EDIT_BACKUPS`/`backupBeforeEdit`/`pruneEditBackups`（共 −59 行）与 `skill.file.backup_failed` 事件，`SkillFileDeps` 收敛为 `{ store }`（原先只为快照落盘与失败告警而注入 logger——顺手去掉这处**死接线**，与之前删 `usageLogger` 同一口径）；②原子写入与并发判据**原样保留**（"临时文件 → fsync → rename"、`base_hash` 不符即 409），删掉的只是**副本**，不是安全性；③前端 `SkillFileEditor.vue` 的「保存」改为先弹 `ConfirmDialog`（原生 `<dialog>`，标题**"保存后无法恢复"**，正文讲明"直接覆盖、不留副本、无法撤销"），确认后才写库；**取消即不写入且草稿保留**；④文档同步：`data-model.md` §0 目录树去掉 `skill-edits/`、§4 在线编辑第③条改写为"保存即覆盖、不留副本 + 界面二次确认"，`contracts/admin-api.md` §4.3.1 的"原子性与退路"改写为"原子性与可恢复性"；⑤线上遗留的 `.platform-data/skill-edits/` 目录一并清除（否则成为无人管理的孤儿数据）。回归测试：`skill-library.spec.ts` 把两条快照用例替换为**"保存即覆盖且不再产生任何 `skill-edits` 目录"**（守住"不留副本"与"技能目录内只有原文件"），`SkillFileEditor.spec.ts` 新增**"取消即不写入、草稿保留"**并把原保存链路改为走确认弹窗。

14. **（2026-09-16 十一次调整）部署对象改为在用户卡片上勾选**：产品决定——「部署范围」选择区不友好，改为"勾谁部署谁"。处置：①**删除**部署面板里的范围选择区、`GET /api/admin/deploy/targets` 端点（§6.9）与 `Deployer.listTargets`；②**部署对象在「用户与关联数字人」每张卡片右上角勾选**——勾上即"要部署给这个用户"，**一个都没勾则既不能校验、也不能部署**；为此 `useDeploy.validate/deploy` 改为接收明确的 `user_ids`，且**空数组一律拒绝**（若放行就会落回服务端"缺省 = 全部用户"的语义，变成误部署全平台——这条是本条最关键的防线）；③卡片显示**部署状态**：`GET /api/admin/users` 每项增加 `deployed_at`（取自部署清单，`null` = 从未部署，即新建用户），已部署显示"已部署 + 最近一次时间"、未部署显示"未部署"，**部署成功后自动刷新列表**；④**删除部署面板里的「部署清单」区块**（清单仍参与部署语义——界定允许删除的范围，故后端保留；部署结果里的差异报告改称「本次部署的差异」）；⑤界面名称「全局异常项汇总」改为「**异常项汇总**」（规格条款名与接口不变）；⑥勾选**跨分页累加**（故不做"按当前页收敛"，改为提供一键「清空勾选」），勾选变化仍**作废上一次预检**。回归测试：`DeployArea.spec.ts`（新增 5 例：未勾选禁用/勾选后放行/多勾多带/取消勾选回退/清空勾选/部署后刷新列表）、`UserCardList.spec.ts`（+6 例：部署状态文案与 `data-status`、勾选上报、已勾选回显、一键清空、读屏名称带用户标识）、`DeployPanel.spec.ts`（重写：范围来自勾选、未勾选时两个按钮禁用、勾选变化作废预检）、`useDeploy.spec.ts`（重写：显式 `user_ids`、**空选择拒绝**）、`deploy.spec.ts`（后端：只选一个用户部署时其余用户零写入 + `deployed_at` 语义）。

15. **（2026-09-16 十二次调整）数字人删除入口 + 部署改为 `agents/` 整体覆盖 + 新增「撤回」**：①**数字人设计器标题栏**在「保存」左侧增加**红色「删除」**（仅编辑态有入口），点击先二次确认并明确"**删除后无法恢复**"；确认后调 `DELETE /api/admin/agents/{name}`，成功后**退回列表**（列表重新拉取，卡片随之消失）。被用户关联时服务端拒绝（`FR-021`、`AGENT_IN_USE`），界面**原样播报可读原因**——不在前端自行判定，避免两套口径。②**部署改为 `agents/` 整体覆盖**：`OptAgentWriter.commitUser` 不再接收 `removable`（原先只移除"部署清单内且本次不再需要"的），改为**清掉 `agents/` 下一切不在本次产物里的条目**——根治"把数字人从关联里去掉再部署，运行环境却删不掉它"（清单缺失或被手工改过时会永远残留，此即该现象的根因）。**副作用需知**：手工放进 `agents/` 的目录也会被清掉（该目录由平台独占管理）；用户文件空间（`user-data/**`）一律不触碰。部署清单仍用于卡片部署状态与差异报告（`opt-agent-writer.ts` / `manifest.ts` 的注释同步改写）。③**新增「撤回」**：用户在「用户与关联数字人」卡片上（**仅"已部署"的用户有入口**）→ 二次确认（讲明"数字人随即失去能力，文件空间与平台侧关联保留"）→ `POST /api/admin/deploy/withdraw`（契约 §6.9）：整目录下架该用户运行环境里的全部数字人，清单条目同时移除（`deployed_at` 变 `null`，卡片回到"未部署"），重新部署即可恢复。乐观锁、只动 `users/{uid}/agents/`、失败不改动运行环境，纪律与部署一致。
   回归测试：`opt-agent-writer.spec.ts`（重写 2 例为整体覆盖语义 + 新增 3 例撤回：清空且文件空间保留、幂等空操作、撤回后可恢复且不带回旧内容）、`deploy.spec.ts`（改写 SC-007 两例 + 新增撤回 4 例：全流程与卡片状态回到未部署、只影响该用户、未知用户 404、乐观锁 409 与缺参 400）、`AgentDesigner.spec.ts`（+4 例：入口位置与红色样式、二次确认含"无法恢复"、确认后删除并发出 `deleted`、被引用时拒绝且不发 `deleted`）、`UserCardList.spec.ts`（+4 例：仅已部署有入口、二次确认文案、按当前 revision 调接口并刷新、失败不改状态）、`api/modules.spec.ts`（+1 例路径与请求体）。

16. **（2026-09-16 十三次调整）部署历史分页（每页 5 条）+ 展开行看部署明细**：要求——①历史要分页，每页 5 条；②展开一行能看到部署明细（部署了哪些用户、哪些数字人、失败原因）。处置：①**每页固定 5 条**（`DeployHistoryList` 内切片翻页，翻页**不重新请求**——服务端是有界返回，与 `domain/paging.ts` 里"非卡片类长列表不用本模块"的既定口径一致）；②拉取条数由 20 提到**上限 100**（`api/deploy.ts` 新增 `DEPLOY_HISTORY_FETCH_LIMIT`，`DeployArea` 改走 `fetchDeployHistory` 而非直接拼 URL）——原来的 20 条翻两页就到底，会被误读成"历史只有 20 条"；有界返回语义不变，`truncated` 为真时明说"更早的记录未拉取"；③**页码边界三条防线**：首页/末页按钮禁用 + `go()` 内二次校验（点不动）、记录变少导致页码越界时收敛到最后一页（不出现空白页）、拉到新记录（倒序插在最前）时回到第 1 页（否则刚部署完看不见它）；④**展开行**消费记录里**本来就带**的 `users[]` / `validation` / `manifest_diff`（`data-model.md` §7.3 早已定义、接口也一直在返回，**此前只是没有呈现**）——逐用户显示成功/失败、**失败原因**、写入与下架的数字人名单，另附校验结论（未通过时带错误项数）与差异项；**MUST NOT 为此新增详情端点**。展开**单开**（同时只展开一行）、翻页后自动收起；⑤未知 `result` 值回退显示原始值（不给空白），缺 `users` 的老记录明说"没有逐用户明细"（不静默留白）。契约 §6.7 的响应形状同步补全（此前只写了摘要字段）。回归测试：`DeployHistoryList.spec.ts`（新增 13 例：每页 5 条且翻页切换内容、翻不出边界、不足一页不显示分页控件、拉到新记录回第 1 页、越界收敛、截断提示、展开显示失败用户与原因与数字人、单开、翻页收起、校验未通过 + 差异项、无明细回退、未知结果值回退、空态）、`DeployArea.spec.ts`（+1 例：历史按上限 100 一次拉取）。

17. **（2026-09-16 十四次调整）MCP 调用统计加「按用户明细」展开列 + 部署历史「明细」列移到最右**：要求——①调用统计表每一行（每个服务）可展开，看到**该服务下每个用户的调用次数**；②部署历史里的「明细」列不要放在第一列，放到**最右**（失败数之后）。处置：①**计数点补记 `user_id`**——`mcp-tool-adapter.ts` 的 `onCall` 回调第三参透传运行上下文 `uid`（七次调整已保证必可得，天然与强制穿透同一来源），经 `agent-factory` → `server.ts` 落进 `UsageDb.recordMcpCall`；②**事件明细表 `mcp_call_events` 加 `user_id` 列**（新库建表即含；旧库**打开即自愈**：`PRAGMA table_info` 判定后 `ALTER TABLE ADD COLUMN`，与 `CREATE TABLE IF NOT EXISTS` 同一"无需人工迁移"口径），并补 `(service_name, user_id)` 索引；③**响应每项新增 `users[]`**（`{ user_id, calls_total, calls_ok, calls_failed, last_called_at }`）——在事件明细上 `GROUP BY service_name, user_id`，**只覆盖最近一年**（与 `windows` 同口径，文档明示）；`user_id` 为 `null` 的老行界面显示"未归属·升级前记录"（不静默留白）；累计/时间窗口径**不变**；④**前端 `McpStatsTable` 最右加「明细」列**——展开/收起按钮 + 展开行（与部署历史同模式：**单开**、数据本就在响应里、**不另设详情端点**、空明细明说"已超保留期或升级前"）；服务详情页的统计（`only` 模式）同表同能力；⑤**部署历史「明细」列移到最右**（时间/操作者/目标运行形态/结果/用户数/失败数/**明细**），`colspan` 不变。契约同步：`runtime-api-delta.md` §4.2（计数点补记 user_id）/§4.3（响应形状 + `users[]` 字段表）、`admin-api.md` §3.8（透传形状补全）。回归测试：`usage-db.spec.ts`（+3 例：按用户聚合分列成功/失败、**旧库迁移**——手工建无 `user_id` 列的老-schema 库再打开补列并正常归属新调用、未传 userId 归"未归属"）、`McpStatsTable.spec.ts`（+4 例：展开显示各用户次数、单开、空明细回退文案、未归属用户回退文案）、`DeployHistoryList.spec.ts`（+1 例：明细列在**最后一列**）。

18. **（2026-09-16 十五次调整）MCP 连接级失败即降级（方案 A）**：真实部署暴露的两个连环症状——①关停 streamable-http 的 MCP 服务后状态**恒为绿灯**（该传输无常驻连接，`onClose` 不触发，而调用失败路径只记日志不清理）；②服务**重启后依旧无法调用**，日志实锤 `StreamableHTTPError 404 "Session not found"`（`mcp.listTools.failed`）——旧客户端拿着被新进程遗忘的 session id，每次装配工具都被拒、工具被剔除，而 `listTools`/`callTool` 失败都不调 `markUnavailable`，旧客户端**永久占住 `clients` 表**，直到实例换代。处置：①`McpManager.callTool`（两次尝试均失败后）与 `listTools` 新增 `degradeOnTransportFailure`——**连接级错误（`McpError` 以外的一切：连接被拒/超时/`StreamableHTTPError` 等）即 `markUnavailable`**：状态变红并推送、排既有退避重连（5s/15s/30s/60s/60s），重连做全新 initialize 拿到合法 session 后**自动恢复，无需重启 backend**；②**`McpError` 不降级**（服务端活着、应答了协议错误，降级重连只对活服务造成状态抖动）；③`requireClient` 抛 `McpUnavailableError` 的路径不变（本就走惰性补试）。回归测试：新增 `mcp-manager.spec.ts`（6 例：双失败后降级+推送、**服务重启场景**——旧 session 404 → 降级 → 退避重连恢复且调用成功、`McpError` 不降级、listTools 失败降级、降级后下次使用惰性恢复且当次调用成功、重复失败不叠加推送）。

19. **（2026-09-16 十七次调整）对话工作台乐观用户气泡**：真实体验 bug——发送消息后，**要等到 AI 答完，自己的消息才显示**。原因：用户消息只在历史刷新（`onTurnFinished`，流**完成后**才触发）时出现，发送路径没有任何本地插入；流式瞬态气泡只承载 AI 回答。处置：①`useChatStream` 新增 `pendingUserMessage` 瞬态（`{content, attachments}`，`PendingUserMessage` 类型导出）——`send()` 提交即置位（与 `streaming*` 瞬态同生命周期），`finally` / `reset()` 收口清除，**MUST NOT 在终结后残留**（否则与历史真身重复渲染）；失败轮维持既有"还原草稿"语义、中断轮维持"不落盘不显示"语义，均不残留气泡；②`MessageList` 新增 `pendingUser` prop——合成 `Message`（空 id 占位，与流式气泡同口径）交给 `MessageBubble` 复用用户气泡样式（`attachments` 还原引用区），渲染在**历史之后、流式气泡之前**；`isEmpty` 口径同步纳入（首轮发送不再闪空态占位）；搜索基准序号沿用 `matchStats.total`；③装配层 `useChatPanel` 仅做 `Ref → prop` 解包（语义留在 `useChatStream`）。回归测试：新增 `useChatStream.spec.ts`（5 例：发送即置位且内容与引用原样、完成清除且 `onTurnFinished` 接管、网络失败清除、手动中断清除、切换会话清除不泄漏）、`MessageList.spec.ts`（3 例：渲染为用户气泡且顺序在历史后/流式前、null 不渲染乐观气泡、首轮无历史不落入空态）。

20. **（2026-09-17 十八次调整）数据准备目录的「上传表字段约束」**：需求——在文件空间场景里每新增一个二级目录，确认后弹窗填写**字段名 + 取值类型**（JSON Schema 那套 6 种）+ **是否必填**，保存下来，为将来"上传文件时按上传表表头预检"做准备（**校验链路本期不实现**，只落配置）。处置：
    ①**数据结构取"并列映射"而非目录对象化**：`scenario.data_prep_fields` 为 `{ 目录名: [{name, type, required}] }`，`data_prep_dirs` 保持 `string[]` 不变——旧设计态文档与已部署的 `scenario.json` **零迁移**（字段缺失 = 该目录无约束），运行环境侧"缺失即无约束"因此天然成立；目录名做键安全的前提是**界面无目录重命名**（只有增删），已作为约束登记。
    ②**只存有字段的目录**：空清单的目录不写入键（"缺失"即无约束），物化时 `data_prep_fields` 为空则**整体不写**——运行环境对"缺失"与"空对象"同义，不留空壳（`FR-026`、`SC-018`）。
    ③**保存严格 / 部署前校验收集全部**：字段名复用 `isSafeDirName`（非空、≤64、无分隔符 / `..`、同目录内唯一）、类型限 6 种枚举、`required` MUST 显式布尔（不给隐式默认）、每目录 ≤ 50 个字段、**孤儿键**（引用了目录清单外的目录）即拒。
    ④**界面交互**：新增目录**先入列、再弹窗**（取消不丢目录名）；弹窗**空列表 = 不设约束**，点「保存」即等价于"暂不设置"，因此不额外加"跳过"按钮（避免用户为凑数填垃圾字段）；目录行新增「字段(n)」入口可随时回改；移除目录时**一并移除其字段约束**（键是目录名，不清理会留孤儿配置），但**只动配置、不动文件系统**（"收缩清单不删除已有文件"的既有语义不变）。
    ⑤**读取归一化**：`AgentDesignService.readOrNull` 对历史文档补 `data_prep_fields: {}`，故**对外契约恒有该键**，界面与物化都不必判空。
    ⑥**拆模块**（宪章原则二 500 行门禁）：`agent-design.ts` 加逻辑后达 535 行，按"一个文件一个职责"拆出 `config-center/naming.ts`（名称与路径安全判据）与 `config-center/scenario.ts`（场景名 / 目录清单 / 字段约束，含两个出口：保存抛错、部署前收集），单测同步拆为 `naming.spec.ts` / `scenario.spec.ts`。
    ⑦**类型判定规则写入契约**（`runtime-api-delta.md` §3.1）：数据准备空间上传白名单本就是 `.csv` / `.xlsx`，故字段值取自**上传表表头、单元格按文本判定**——`integer` 为整数字面量、`number` 允许小数与指数、`boolean` 只认 `true` / `false`、`object` / `array` 仅做"可 `JSON.parse` 且顶层类型匹配"的**粗校验（不做嵌套）**；`required: false` = 表头可缺、出现则类型仍须匹配。CSV 中文表头的编码（GBK）与 xlsx 解析依赖属**后续任务**的成本点，已登记。
    ⑧**测试**：admin-backend 450 用例（新增 `naming.spec.ts`、`scenario.spec.ts`、物化空壳不写、precheck 逐条列出、读取归一化）、agent-backend 113 用例（新增 5 例解析：归置 / 历史兼容 / 非法项丢弃且场景仍可用 / 空清单不建键 / 整体非对象忽略）、admin-frontend 334 用例（新增 `ScenarioFieldDialog.spec.ts` 与 `ScenarioEditor` 的 8 例：弹窗即开、保存写入、空列表不建键、非法即禁用保存、取消不改动、字段数回显、移除目录连带清约束）。

21. **（2026-09-17 十九次调整）上传表字段校验落地（服务端权威）+ 全项目单文件上限 50MB→5MB**：
    ①**校验架构取"运行环境唯一权威"**：分析过三案——前端同款预检（双实现必然漂移）、前端只验 CSV（主力 xlsx 体验断层）、全交服务端（规则只有一份实现）——按 LAN 部署"失败 round-trip 秒级 + 详细错误一次列全"的实际情况，**全交服务端**最优；前端只做**只读提示**（`workspace` 接口 dirs 新增 `fields`，`UploadMenu` 在目录按钮下展示"表头须含：A、B；可选：C(integer)"），MUST NOT 自行判定。
    ②**新模块** `agent-backend/src/domain/field-check.ts`：6 类型文本判定（§3.1 判据）+ CSV 解析（逗号分隔、`"` 引用转义、UTF-8 去 BOM 优先 / 出现替换字符回退 GBK）+ xlsx 解析（**仅第一个 sheet**、单元格取**显示文本** `raw: false`、前置 **ZIP 魔数校验**——SheetJS 对非 zip 输入异常宽容不抛错，需确定性拦截）+ 统一 `checkUploadTable`（缺必填表头一次性列全、逐行类型判定、**空单元格跳过**——`required` 语义是表头必含不做行级必填、全空行丢弃且**行号按"表头为第 1 行"的非空数据行计**、重复表头取首个、超长取值截断、问题超 `MAX_ISSUES=30` 截断为"…等 N 处"）。
    ③**上传路由钩子**（`routes/files.ts`）：仅"数据准备空间且该目录有约束"时，暂存后、落盘前校验；失败 `400 FILE_SCHEMA_INVALID` + `error.details: string[]` 逐条问题，**不落盘**（暂存清理）；共享/临时空间与无约束目录零开销。`ApiError` 增加可选 `details` 第四参，错误处理器随响应下发。
    ④**前端错误链路**：`ErrorInfo.details` 透传（`parseErrorResponse` 本已解析 details 进 `ApiError`，只需 `toErrorInfo` 保留 + `toUserMessage` 消费）；`FILE_SCHEMA_INVALID` 是 D13（不直接展示后端 message）的**唯一例外**——问题清单按文件动态生成、按码分派无法承载，直接换行拼接 `details` 展示（`UploadItem` 错误行加 `pre-line`）。
    ⑤**单文件上限 50MB→5MB，全项目统一**：`UPLOAD_MAX_MB` 默认值两侧后端 50→5（agent-backend 文件上传 / admin-backend SKILL ZIP 导入同一约束）；`gateway/nginx.conf` `client_max_body_size 60m→6m` **两处**（server 块 + `/api/admin/` location 块——后者 location 级覆盖 server 级，重建后以 `nginx -T` 实测确认，单改 server 块会让 SKILL ZIP 导入仍走 60m）；前端 `MAX_UPLOAD_BYTES/MAX_UPLOAD_MB` 与全部"50MB"文案/注释/测试期望同步。
    ⑥**契约同步**：`runtime-api-delta.md` §3.1 由"判据表（本期不实现）"改写为"已实现"（解析/判定/错误响应/前端展示四段执行口径），§3 接口影响表新增上传校验与 workspace `fields` 两行。
    ⑦**测试**：agent-backend 160 用例全绿（新增 `field-check.spec.ts` 22 例：类型边界 / CSV 引号与 GBK 回退（硬编码「中国」GBK 字节 D6D0 B9FA）/ xlsx 往返 / 问题清单与截断 / 分派与魔数拦截；集成 `files-scenario.spec.ts` +6 例：缺表头不落盘、行号口径、xlsx 校验、合规落盘、无约束不触发、workspace `fields` 下发）、frontend 132 用例全绿（新增 `UploadMenu.spec.ts` 4 例提示渲染、`error-message.spec.ts` +3 例 details 透传与 D13 例外）、admin-backend 450 用例全绿（默认值变更零回归）；两侧 `tsc --noEmit` 通过。

22. **（2026-09-19 二十次调整）「数据准备」预定义二级目录 `算法规则`**：需求——文件空间场景的二级目录中增加一个**平台硬编码**的预定义目录 `算法规则`，**必须存在、不可移除**，用户（管理员）可为其设计字段约束（字段数可为 0，0 条 = 无约束），不增加其他预定义目录，范围仅"数据准备"空间。处置：
    ①**数据结构不变**：`data_prep_dirs` 保持 `string[]`，预定义目录与普通目录同列——已部署 `scenario.json` **零迁移**；新约束只是"清单 MUST 含 `算法规则`"。
    ②**后端权威判据**（`config-center/scenario.ts`）：新增 `PREDEFINED_DATA_PREP_DIRS = ['算法规则']` 与 `missingPredefinedDirs()`，两个出口共用——`normalizeScenario` 保存路径缺失即抛（严格）；`scenarioFieldIssues` 部署前校验**先于 `data_prep_fields` 缺省早退**报告缺失（手工改过的文档兜底）；前端 `constants/agent-design.ts` 同名常量 MUST 同步。
    ③**界面**：预定义行渲染「预定义」徽标、**无「移除」按钮**（`removeDir` 防御式拦截），字段(n) 入口照旧；新建场景初值由 `emptyScenario()` 带入预定义目录；`useAgentDesign` 的 dirty 判定排除预定义目录（初值自带不算"有输入"）。
    ④**不强制字段**：预定义目录的存在性必填 ≠ 字段必填——`data_prep_fields` 对 `算法规则` 与其他目录同一口径（缺失即无约束）。
    ⑤**测试**：admin-backend 32 文件全绿（`scenario.spec.ts` +2 例：缺失即拒 / 部署前兜底列出，夹具统一补入）、admin-frontend 33 文件全绿（`ScenarioEditor.spec.ts` +3 例：徽标且无移除按钮 / 仅预定义时无移除 / 0 字段不建键，`useAgentDesign.spec.ts` 初值同步）；两侧 `tsc --noEmit` 通过。

23. **（2026-09-19 二十一次调整）MCP「文件参数映射」JSON 文本框 → 表格化编辑视图**：需求——`file_args` 直接填 JSON（`{工具: {路径: "url"|"url:from=…"}}`）对管理员不友好，改为"选工具、选字段"的行式表格（原型 `admin-frontend/prototype/file-args-mapping-prototype.html` 变体 A 定稿）。处置：
    ①**存储契约零变化**：`file_args` 结构与 `MCP.json` 物化格式不动，新组件 `FileArgsMappingTable.vue` 只是编辑视图（行模型 ↔ 对象双向纯转换，提交/加载都经同一转换函数）。
    ②**交互**：行 = 工具 / 目标字段 / 方式 / 来源字段 四列。**2026-09-19 产品决定：三列全部只能下拉选择，不允许手填**——目标字段下拉枚举自工具参数 JSON Schema 递归叶子路径（数组自动展开 `[]`，`$ref` 沿路径剪枝）；来源字段下拉**只列与目标形状相容的选项**（能选到的必然合法：段数相同、末段前逐段一致）；清单外工具与 schema 漂移的存量值作为**保留项**出现在下拉里（标「清单外」/行内报错），不回写丢失；无效行（空选项、形状不符的存量值、重复映射）行内报错且**不写入序列化结果**。
    ③**路径判据同构**：`SEGMENT` 正则与派生相容判据镜像 `agent-backend/src/domain/file-arg-path.ts`（服务端仍是权威，前端只做编辑辅助）。
    ④**顺路拆件**：`McpCallConfigForm.vue` 537 行超限——测试结果弹窗拆为 `McpTestResultDialog.vue`（探测逻辑留父件，弹窗自持开关与焦点归还），表单回落至 400 行内，97 文件全过 500 行门禁。
    ⑤**测试**：admin-frontend 34 文件全绿（新增 `FileArgsMappingTable.spec.ts` 10 例：双模式回显 / Schema 枚举含数组嵌套 / 编辑与删除序列化 / 派生形状不符不写入 / 下标语法报错 / orphan 保留 / 重复告警 / 空态；`McpCallConfigForm.spec.ts` JSON 非法用例改为"表格视图提交结构不变"）；`vue-tsc` 通过。

### 真实部署发现并修复的三个缺陷

冒烟确认抓出了三个只有真部署才能暴露的问题（**已修复并补回归测试**，详情见 `quickstart.md` §10.3）：

1. `DockerHost` 写死 Engine API `v1.43` → Docker Engine 29 要求最低 `1.44`，表现为 `docker.available=false`（与"未挂载 socket"无法区分）→ 改为**不写版本前缀**，由守护进程协商。
2. 编排内无对外端口的服务被推断为 `stdio` → 内网 streamable-http 服务被**错误标注** → 改为**编排内服务一律按 `http`**，`stdio` 只能由服务级配置显式声明。
3. `UsageDb` 在 `SQLITE_IOERR_SHMOPEN` 时让**整个服务崩溃循环**（日志只有一句 `disk I/O error`，无法定位）→ 实测根因是**容器与宿主机原生 dev 服务争抢同一 `.opt-agent/usage.db` 的 WAL 共享内存**（非数据损坏：同库复制到容器内打开正常）。修复为：WAL 不可用时**回退 DELETE**（Linux 交付形态行为不变），并把错误翻译成带处置步骤的可读文案；新增 `tests/unit/usage-db.spec.ts`（12 用例，agent-backend 达 **55/55**）。运行约束（容器 `backend` 与原生 `npm run dev` 不可同时运行）已写入 `quickstart.md`。

### 仍需人工复核（已在 `quickstart.md` 显式标注为未执行）

- `SC-001`（≤ 5 分钟完成一个数字人并部署）的**界面计时**；
- `SC-015`（≤ 3 次点击到编辑位置）的**逐页手工计数**；
- 读屏实机抽查（原则四 §8 第 4 条）。

以上三项属**人工验收动作**，其对应功能行为均有自动化断言覆盖（`quickstart.md` §10.5），但"计时/计数/读屏"本身未由本次实现代跑。
