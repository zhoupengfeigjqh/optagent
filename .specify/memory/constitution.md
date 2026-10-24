<!--
当前版本: 2.2.0（语义化 MAJOR.MINOR.PATCH；Ratified 2026-09-14，Last Amended 2026-10-12）
最近一次修订: 2.2.0（2026-10-12，MINOR）—— 明确受约束子项目为四侧：
  `agent-backend` / `admin-backend` / `frontend` / `admin-frontend`。
完整变更历史（1.0.0 起 7 次修订的明细、被取代的结论、风险记录）:
  见同目录 ./constitution-changelog.md（2026-10-12 由本报告**逐字拆分**，内容未改写；
  本报告此后只保留下面的规范性摘要）。

仍生效的待办与口径（规范，MUST）:
  1. 存量补测待办（原 2.0.2，未闭合）：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）
     共 20 个模块仍为 0%，仅由防倒退地板托底；MUST NOT 发起存量补齐专项，其**补测顺序与范围
     MUST 在下一个特性的 `plan.md` 给出结论**（先例：`specs/002-conversation-runtime/plan.md` §4）。
  2. 覆盖率地板只上不下：当前 53 / 59 / 42 / 52（实测 54.28 / 60.47 / 43.03 / 53.17）。
  3. lint 范围界定（原 2.1.1 登记）：`eslint.config.mjs` 对移植 / 第三方来源的树按路径放开 4 条
     与搬运方式绑定的规则；MUST NOT 被引用为"存量代码已达标"（`no-unused-vars` 未放开）。
  4. 存量红灯（原 2.1.2 登记）：`views/demo/**`、`views/datapage/**` 现有 16 lint errors +
     10 typecheck errors（含 4 条真实缺陷），由该区域负责人处置；
     MUST NOT 被读成"存量已达标"或"红灯可以不处理"。
  5. 待确认（原 2.2.0 登记）：`gateway` / `ocr-service` / `jev-service` 是否纳入约束范围；
     `admin-backend` / `admin-frontend` 的端口与部署位置未登记进「§ 组成与端口」。
-->

# optagent 项目宪章 (Project Constitution)

本宪章约束四个子项目的后续开发：数字人运行侧 `agent-backend`（Agent 对话后端）与
`frontend`（Agent 前端交互页面，三栏工作台），数字人管理平台侧 `admin-backend`（管理服务）
与 `admin-frontend`（管理界面）。
四者属**同一产品的多个可独立交付的侧**，任何开发活动 MUST 同时以本宪章为准则；
涉及跨侧契约、共享数据结构或部署编排的改动，MUST 同步评估并同步修改受影响的所有侧。

## 核心原则 (Core Principles)

### 一、中文文档与规格驱动

- 本仓库全部项目文档 MUST 使用中文（简体）：`spec.md`、`plan.md`、`tasks.md`、`research.md`、
  `data-model.md`、`contracts/*`、`quickstart.md`、`README`、`docs/` 以及代码内的说明性注释。
  代码标识符、命令、协议名、第三方库名、错误码保持原文。
- 每个特性 MUST 先在 Spec Kit 目录（仓库根 `specs/NNN-*/`）完成 **规范 → 计划 → 任务**
  三件套后再动代码；规格与代码 MUST 在同一分支内保持一致。
- 需求或行为发生变化时 MUST 回写规格（含修订记录与日期），MUST NOT 只改代码不改文档。
- 规格中出现的"待确认"项 MUST 在进入实现前收敛，MUST NOT 以含糊表述长期挂起。

**理由**：中文文档保证团队与 AI 协作时的语义一致；规格先行让"改哪一侧、改到什么程度"
在编码前即被确定，避免前后端各自漂移。

### 二、代码质量与模块化边界

- 风格：在既有风格基础上继续演进，并保持与官方风格一致。
  - 前端：Vue 3 + TypeScript，`<script setup>` + Composition API + Scoped CSS。
    组件文件与组件名 MUST 使用 **PascalCase**（如 `MessageBubble.vue`、`WorkspacePanel.vue`）；
    composable MUST 命名为 `useXxx`（如 `useWorkspace.ts`）；纯函数与常量各自独立成文件。
  - 后端：Node 20+ / TypeScript（ESM）；Fastify 路由 + `domain/` 业务 + `infra/` 基础设施。
- 分层架构（后端）：**接口层（`src/routes/`）→ 业务层（`src/domain/`）→ 数据访问层（`src/infra/`）**。
  每一层职责单一；接口层 MUST NOT 直接读写文件系统/数据库，业务层 MUST NOT 直接构造 HTTP 响应，
  跨层 MUST NOT 越级调用。
- 分层架构（前端）：`components`（视图）→ `composables`（状态与业务）→ `api`（网络），
  `utils` / `constants` 为无状态纯函数与常量。
- **单文件上限**：MUST NOT 新增或保留超过 **500 行**的 `.ts` / `.vue` / `.js` 文件；
  超限 MUST 按"拆子组件 / 抽 `useXxx` / 抽纯函数"三种方式之一拆分。
- 同一职责 MUST 只有一处实现：同一规则（如"扁平空间判定"、"文本分段渲染"）MUST 有唯一来源，
  MUST NOT 在多处各写一套。
- 命名与注释 MUST 说明"为什么"，MUST NOT 用注释复述代码。

**理由**：500 行上限与分层边界是可控复杂度的底线；唯一职责来源是可测试、可 AI 导航的前提。

### 三、测试完备性 (NON-NEGOTIABLE)

- 前端：每个组件 MUST 有同名同目录的测试文件（`Xxx.vue` ↔ `Xxx.spec.ts`）；
  每个 composable 与每个纯函数模块同样 MUST 一一对应。测试 MUST 覆盖**三类场景**：
  属性传递（props）、事件触发（emit）、边界条件（空值 / 禁用态 / 超限 / 失败态）。
- 后端：**每个接口端点 MUST 有集成测试**，覆盖状态码、响应体结构与错误码；
  核心业务逻辑（`domain/`）MUST 有单元测试，覆盖**正常流程、异常流程、边界条件**。
- 覆盖率门禁：前端 `src/api`、`src/composables`、`src/utils` 语句覆盖率 MUST ≥ **80%**；
  后端核心业务逻辑语句覆盖率 MUST ≥ **80%**。低于阈值即视为任务未完成。
- **测试环境＝仅本地（宿主机）**：
  - **所有测试 MUST 在开发者本地（宿主机）执行**：单元测试、端点集成测试、覆盖率、
    类型检查、`lint` 与前端构建。
  - **容器 MUST NOT 承担任何测试职责**。容器的职责仅有"部署与运行"（见「技术栈与工程约束」）。
  - 测试证据（测试输出、覆盖率报告、构建结论）MUST 来自**本地**运行结果。
  - 本地测试 MUST 是可一键复现的（见原则八），MUST NOT 依赖只有作者知道的隐含前置步骤。
  - 改动完成后 MUST **就地运行测试**，MUST NOT 把"跑测试"推迟到打包/部署阶段。
- **平台差异风险 MUST 显式管理**：本地（Windows）与交付目标（Linux 容器）存在**已知**运行环境差异
  （原生模块 `better-sqlite3` 的二进制、文件系统大小写敏感性、非 ASCII 路径行为——
  `domain/fs-safe.ts` 正是为该差异而生、以及行尾符）。因此：
  - 涉及上述平台相关行为的改动 MUST 在 `plan.md` 的 Complexity Tracking 中登记该风险
    与被否决的替代方案；
  - 部署后 MUST 执行一次**非交互冒烟确认**（见原则八），仅用于确认服务可达与关键接口
    状态码符合预期，**MUST NOT 替代测试结论**。
- 测试 MUST NOT 依赖真实外部 LLM 调用；外部依赖 MUST 以桩/假实现替代，或用显式标注的
  "live" 配置分离。

**理由**：本项目为前后端一体交付，接口契约易漂移——端点集成测试与组件测试是最低成本的一致性保险。
测试统一在本地执行，是为了让"改完就能立刻验"成为默认动作，避免测试被环境准备成本劝退。
代价是本机与交付目标的平台差异不再被自动化覆盖，故以两条最小保险兜住：
平台相关改动在计划中登记风险 + 部署后做一次非交互冒烟确认。

### 四、无障碍与可用性 (WAI-ARIA)

- 所有交互控件（按钮、输入框、开关、列表项、树节点、分隔条）MUST 支持键盘导航：
  Tab 顺序合理、Enter/Space 触发、Esc 关闭、复合控件内使用方向键移动，焦点 MUST 可见。
- MUST 遵循 WAI-ARIA：优先使用平台原生语义元素（`<dialog>`、`<details>`、`<button>`、
  `<textarea>`）；自建控件 MUST 补齐 `role` 与 `aria-*` 状态
  （`aria-expanded`、`aria-pressed`、`aria-live`、`aria-label` 等）。
- 状态与结果 MUST NOT 仅以颜色传达，MUST 同时提供文本或图标（色觉障碍可用性）。
- 动效 MUST 在 `prefers-reduced-motion` 下降级为静态表现。
- 新增或变更的组件 MUST 在其自身任务内完成键盘与读屏验证，跨故事复核不能替代组件级验证。

**理由**：无障碍是产品可用性底线，事后补齐的代价远高于随组件同步实现。

### 五、性能与数据一致性

- 后端：接口 **P95 响应时间 MUST ≤ 500ms**（LLM/Agent 推理类流式接口除外）。
  新增或变更的端点 MUST 做计时验证，并在规格中记录测量口径与结果。
- 数据访问 MUST NOT 出现 **N+1 查询**：批量数据 MUST 一次查询取回，禁止在循环内发起查询。
- 前端：渲染路径 MUST NOT 执行昂贵计算——分段、过滤、匹配、链接识别等派生结果 MUST 以
  `computed` 缓存，MUST NOT 在模板中重复计算；长列表 MUST 使用稳定 `key` 与 `v-memo`。
  非推理类交互反馈 MUST ≤ 100ms；单组件首次渲染 MUST ≤ 100ms。
- 数据一致性：**所有涉及状态变更的操作 MUST 使用事务或等价的原子替换**
  （多文件/多记录的写入、迁移、删除），**MUST NOT 出现部分提交**；
  并发写入 MUST 有锁机制或等价的并发控制（原子改名、同步"检查+占位"等），
  且并发场景 MUST 被测试覆盖。
- 破坏性操作（删除、覆盖、中断）MUST 先经二次确认，并在失败时保持原状态不变。

**理由**：单用户工作台对"快"与"不出错"的容忍度都很低；一致性问题一旦落盘即不可恢复。

### 六、技术治理与依赖控制

- **MUST NOT 引入非必要第三方依赖**。能用平台或框架原生能力实现的 MUST NOT 引库
  （典型：`<dialog>` 替代自建 Modal、`fetch` + `ReadableStream` 替代 EventSource 封装、
  手写 SSE 行解析替代解析库）。
- 引入任何新依赖 MUST 在 `research.md` 记录：**选型理由 + 被否决的替代方案 + 版本锁定**；
  未记录即视为违规。
- 依赖版本 MUST 可复现：提交并维护 `package-lock.json`，镜像构建 MUST 使用 `npm ci`。
- 新增基础设施（容器、网关路由、外部服务、数据库引擎）MUST 说明其必要性；
  原生模块（如 `better-sqlite3`）MUST 在 glibc 基础镜像内使用，并记录原因。

**理由**：本项目规模有限，每多一个依赖就多一份升级、安全与体积成本；治理成本最终由维护者承担。

### 七、接口契约与前后端一致性

- 本项目由四个子项目共同构成同一产品：数字人运行侧 `agent-backend` ↔ `frontend`，
  管理平台侧 `admin-backend` ↔ `admin-frontend`。**任何功能或缺陷修改 MUST 同时评估
  相关各侧影响**；若变更跨越契约边界，MUST 在同一次改动中同步修改涉及的每一侧，
  **MUST NOT 只改一侧**。
- 接口设计 MUST 遵循 REST 规范：资源化路径、正确的 HTTP 方法与状态码、幂等语义（含中断类操作）。
- 错误响应 MUST 使用统一格式 `{ error: { code, message, details? } }`；
  错误码 MUST 全局唯一且语义稳定，MUST NOT 出现"同码不同义"。
- **每个端点 MUST 有接口文档**（`specs/**/contracts/*.md`），文档 MUST 与实际实现一致；
  实现与文档冲突时 MUST 立即修正文档并在规格中登记该差异及其口径。
- 接口契约 MUST 与前端共享且为单一事实源：前端类型定义（`src/api/types.ts`）与契约文档
  一一映射，字段命名、可选性、错误码 MUST 对齐。
- 前端 MUST NOT 硬编码后端下发的业务常量（如目录集合、扩展名白名单），
  MUST 一律消费接口下发值。

**理由**：契约漂移是本项目最高频的缺陷来源（同码不同义、字段口径不一致、
一侧改动另一侧未跟上），必须把"各侧同改"提升为不可协商的治理要求。

### 八、测试与部署的简单可控

- **一条命令跑门禁（本地）**：每个子项目的门禁 MUST 能用**单条命令**在本地跑完
  （`npm run <script>` 入口或等价的单一入口脚本），MUST NOT 要求使用者手工拼装多步。
  该命令 MUST 写在仓库内**可被发现**的位置（`package.json` 的 `scripts` + `quickstart.md`），
  使人不必读配置文件才能把测试跑起来。
- **门禁 MUST 从当前源码重新构建**：MUST NOT 依赖仓库内已有的陈旧产物（`dist/`、
  上一次构建的缓存）得出结论——"忘了重新构建"跑出的假绿是最危险的失败模式。
- **前后端对称**：四个子项目（`agent-backend` / `admin-backend` / `frontend` / `admin-frontend`）
  MUST 各自具备可一键运行的本地门禁命令；
  MUST NOT 出现"一侧能一键跑、另一侧只能手工拼"的不对称。
- **容器只做部署（唯一容器步骤）**：全套栈 MUST 能由单条 `docker compose up -d --build` 拉起；
  这是容器在开发流程中承担的全部职责。
- **部署后 MUST 有非交互冒烟确认**：一条可复现的命令序列（HTTP 打点或脚本）确认服务真的可用，
  MUST NOT 只依赖"手动点界面看一眼"作为交付确认。
- **可控性**：测试与部署步骤 MUST 幂等、失败 MUST 以非零退出码结束，
  MUST NOT 需要登录容器内部手工操作才能完成。
- **反例（视为违规）**：把门禁逻辑藏在只有作者知道的长命令里；依赖"必须先跑 A 再跑 B，
  顺序错了结果无意义"；测试需要手工改配置或准备环境才能通过。

**理由**：测试与部署的成本直接决定它们会不会被真正执行——命令越难拼、越容易被跳过，
就越会出现"没重新构建就下结论""没确认部署成功就当成功"这类**假绿**，而假绿比不测更危险。
简单可控也是本仓库人机协作的前提：一条命令就能让人（或 AI）在无人值守时复现全部结论。

### 九、优雅降级与故障可观测

- 影响用户体验的调用与功能模块（外部服务、LLM/Agent 流式连接、文件读写、网络请求）
  在设计时 MUST 做降级/容错分析：识别失败模式（超时、断连、部分失败、依赖不可用），
  并给出该模式下的用户可见行为。
- 降级 MUST 让用户可感知当前状态：界面 MUST 明确提示"发生了什么、现在处于什么模式
  （如重连中/已按缺省处理/功能暂不可用）"，MUST NOT 假装一切正常。
- 降级 MUST NOT 掩盖问题：原始错误 MUST 落入结构化日志或审计记录（含 req_id 等
  关联线索）；静默捕获并返回缺省值视为违规。
- 重试与超时 MUST 有界（次数、间隔、总时长均有上限），且 MUST 向用户暴露等待状态；
  无限重试、无限等待视为违规。
- 降级路径 MUST 有测试覆盖（与原则三的"异常流程"同口径）。

**理由**：本项目大量功能依赖外部不可控环节（LLM 流式输出、MCP 服务、沙箱文件链），
"失败时用户看到什么"是反复出现的设计决策；而"优雅"与"掩盖"仅一线之隔——
降级后的"看起来正常"是运行期的另一种假绿。把"用户可感知 + 错误可观测 + 重试有界"
立为条文，评审时才有据可依。

## 技术栈与工程约束

- **组成与端口**：`gateway`（nginx，唯一对外入口，默认 `82 → 80`）、`frontend`
  （Vue 3 + Vite，构建为静态资源由 nginx 托管）、`agent-backend`
  （Node 20+ / TypeScript ESM / Fastify 5，容器内 `3000`，接口前缀 `/api`，SSE 流式）、
  `ocr-service`（RapidOCR，MCP streamable-http，仅内网）。
- **容器职责＝交付与运行**：根目录 `docker-compose.yml` 编排的容器 MUST 只承担
  **镜像构建、部署与运行**三项职责。**测试、`lint`、类型检查与覆盖率 MUST NOT 在容器内执行**
  （见原则三）；这些活动统一在宿主机本地完成。运行期的人工联调与试用 MAY 使用容器环境，
  但其结果同样 MUST NOT 作为测试结论。
- 前端 API 基址 MUST 走同源相对路径（`/api/*`），由 `gateway` 按路径分发；
  新增平台只改 `gateway/nginx.conf`，MUST NOT 让前端直连后端容器端口。
- 数据与密钥不进镜像：`.env`、`config.yaml`、`.opt-agent/`、`tests/`、`specs/`、
  `node_modules/`、`dist/` MUST 排除在构建上下文之外（`.dockerignore`），
  运行期数据经 bind mount / volume 提供。
- **工具链大版本 MUST 在四个子项目间一致**：TypeScript 6、ESLint 10、Vitest 5、Node ≥ 20
  （后端镜像使用 Node 22）。四者 `package.json` 实测已对齐（TS `^6.0.3`、ESLint `^10.10.0`、
  Vitest `^5.0.0`、`engines.node: >=20`）。跨版本差异 MUST 在 `research.md` 说明理由。

## 开发工作流与质量门禁

- **流程**：`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → 实现 →
  `/speckit.analyze` 一致性核查。规格三件套、任务勾选状态与代码 MUST 同步更新。
- **门禁（全部 MUST 通过，且 MUST 在本地执行；容器不参与门禁）**：
  - 前端：`npm run lint`、`npm run typecheck`、`npm run test:coverage`、`npm run build`
  - 后端：类型检查、`npm run test`（含端点集成测试与覆盖率）、`npm run build`、`npm run lint`
    （脚本缺失时 MUST 先在 `package.json` 补齐，MUST NOT 以"没有脚本"为由跳过该项，
     并在规格中登记补齐情况）
  - 部署：`docker compose up -d --build` 拉起后，按对应 `quickstart.md` 执行
    **非交互冒烟确认**（HTTP 打点或脚本）；MUST NOT 只依赖手动点界面。
    该步骤只确认"部署本身成功"，MUST NOT 作为测试结论
- **硬门禁三项**：覆盖率、单文件行数（≤500）、依赖清单（无未记录依赖）。
  任一项未达标，任务 MUST NOT 标记完成。
- **适用边界（不回溯）**：上述门禁只对**新增**文件与**本次改动涉及**的文件/模块生效。
  MUST NOT 为满足门禁而发起针对存量代码的回溯测试、覆盖率补齐或结构检查专项
  （详见「治理 § 适用范围与不追溯」）。
- **契约变更的四处同步**：接口契约文档、前端类型定义、后端请求/响应 schema、测试用例
  MUST 在同一次改动中一起更新。
- **评审**：任何代码评审或合并 MUST 逐条核对本宪章；复杂性 MUST 在 `plan.md` 的
  Complexity Tracking 中说明，未说明即驳回。
- **提交信息** MUST 使用中文，并说明影响的侧（前端 / 后端 / 两者）。

## 治理 (Governance)

- **效力**：本宪章优先于其他实践与习惯。与规格、计划、任务冲突时以本宪章为准。
  宪章冲突 MUST 通过修订宪章解决，MUST NOT 通过稀释、重新解释或静默忽略来绕过。
- **适用范围与不追溯（Grandfathering）**：本宪章自生效起约束**增量开发**，**不回溯**存量代码。
  - **受约束的子项目（2026-10-12 明确）**：`agent-backend`、`admin-backend`、`frontend`、
    `admin-frontend` 四个子项目一致适用本宪章全部原则与本节；仓库内其余子项目（`gateway`、
    `ocr-service`、`jev-service`）是否纳入，MUST 经本文件修订后生效（见文首 2.2.0 的待确认项）。
  - 存量代码（既有组件、端点、模块及其既有测试）MUST NOT 因宪章升级而被要求重新测试、
    重新核查、补齐覆盖率或重构；MUST NOT 组织此类回溯性专项。
  - 宪章约束 MUST 作用于：新编写的代码，以及本次需求实际改动到的文件与模块。
  - 存量文件被改动时，MUST 保证"改动部分及其直接受影响的测试"符合宪章；
    MUST NOT 借改动之机对无关部分做大范围重构（不得以"合规"为名放大改动范围）。
  - 存量缺陷与技术债按特性需求逐个处理，MUST NOT 以"宪章升级"为触发条件批量立项。
- **修订程序**：修订 MUST 以本文件（宪章正文）为唯一**规范**落点，写明变更理由；并把
  **完整变更明细**（版本变更、原则增删改、被取代的结论、风险记录）登记到
  `.specify/memory/constitution-changelog.md`。文首"同步影响报告"从此只保留
  **当前版本、最近一次修订摘要与仍生效的待办/口径**（规范性摘要，MUST 与 changelog 一致）。
  修订后 MUST 复查受影响的模板与规格文档。
- **版本策略（语义化）**：
  - MAJOR：原则的删除或向后不兼容的重定义；
  - MINOR：新增原则/章节，或对既有原则的实质性扩展；
  - PATCH：措辞澄清、错别字、非语义调整。
- **合规审查**：每个特性的规格、计划、任务与实现 MUST 声明合规；
  `/speckit.analyze` 报出的宪章冲突 MUST 按 CRITICAL 处理，并修正规格 / 计划 / 任务，
  MUST NOT 以"不适用"为由跳过。
- **例外**：确需违反某原则时，MUST 在特性 `plan.md` 的 Complexity Tracking 表中登记
  （违反项 / 必要性 / 被否决的更简方案），并取得明确确认；未登记即视为违规。
- **运行期指导**：Spec Kit 的命令与模板（`.specify/`）在运行时读取本宪章；
  MUST NOT 就地改写模板或脚本以规避治理要求。

**Version**: 2.2.0 | **Ratified**: 2026-09-14 | **Last Amended**: 2026-10-12
