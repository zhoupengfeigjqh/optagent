# Implementation Plan: 数字人管理平台

**Branch**: `001-digital-human-platform` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-digital-human-platform/spec.md`

## Summary

在既有 optagent 运行环境（`gateway` + `frontend` + `agent-backend` + `ocr-service`）之上，新增一个**独立的数字人管理平台**：一个独立管理界面（`admin-frontend`）+ 一个独立管理服务（`admin-backend`），并入既有 nginx 网关与 docker compose 编排。

平台是**全平台唯一的配置中心**：集中持有内置工具、MCP 服务、SKILL、数字人四类**配置信息**，数字人只按名称引用。四个功能区（MCP 服务 / SKILL 管理 / 数字人设计 / 数字人部署）覆盖"配置 → 设计 → 分发"闭环：管理员在平台内设计数字人，点击"部署生效"后经**部署前校验**，把数字人的五类配置**整体覆盖**式写入 `.opt-agent/users/{uid}/agents/{agent}/`，使运行环境无需依赖平台即可独立加载。

技术栈与既有项目**同构**：管理服务用 TypeScript / Node 20+ / Fastify 5 / ESM / zod / pino / Vitest 5（与 `agent-backend` 一致）；管理界面用 Vue 3 + Vite + TypeScript + Composition API + Scoped CSS，**零第三方运行时库**（与 `frontend` 一致）。

**选型的核心论证**（详见 [research.md](./research.md) D1）：平台的主要工作是**读写 `agent-backend` 已经在读写的那批文件**（`SOUL.md` / `TOOL.json` / `MCP.json` / `scenario.json` / `skills/**`）、**说它已经在说的那个协议**（MCP）。换技术栈等于把格式解析与协议客户端重写一遍，从而产生**第二份格式实现**——这正是宪章 FR-002/003「配置零副本」在代码层的翻版，且更难发现。TypeScript 还让原则七的"契约四处同步"可由编译器机械保证（前端类型与后端 schema 同源）。

## Technical Context

**Language/Version**: 后端 TypeScript 6 / Node 20+（镜像 `node:22-bookworm-slim`，与 `agent-backend` 一致）；前端 TypeScript 6 + Vue 3.5。

**Primary Dependencies**:
- 后端（均为**既有子项目已在用**的依赖，见 research.md D2）：`fastify@5`、`@fastify/cors`、`@fastify/multipart`、`zod@4`、`pino@10`、`pino-pretty@13`、`yaml@2`（解析 `docker-compose.yml`）、`@modelcontextprotocol/sdk@1.30`（MCP 客户端：列工具 + 连通性/能力测试）。
- 前端：`vue@3.5`、`vite@8`、`vue-tsc@3`；**零第三方运行时库**——导航/分页/卡片/确认框/页签/异常态全部用 Vue 原生能力（`provide/inject`、`reactive`、`<Teleport>`、原生 `<dialog>`、`<details>`）。
- 测试：后端 `vitest@5` + `@vitest/coverage-v8`；前端 `vitest@5` + `@vue/test-utils@2.5` + `jsdom@30`。
- **新增依赖**：无。唯一需要 D1 级论证的是 Docker 访问方式，结论为**零依赖实现**（见 research.md D3）。

**Storage**:
- 平台**设计态**：文件存储于 `platform-data/`（仓库根，bind mount 进 `admin-backend`），JSON 文档 + **原子替换**（写临时文件 → `rename`）保证原则五的一致性要求。理由见 research.md D4（被否决：SQLite 新增引擎但收益不足；复用 `.opt-agent` 违反 FR-005）。
- 平台**运行态产物**：写入 `.opt-agent/`，即运行环境的用户数据目录，**与运行环境共享同一份**（FR-001）。
- 平台**运行观测**：MCP 服务容器日志与调用次数由 `admin-backend` 只读采集（见 research.md D6 与「已知口径差异」）。

**Testing**: 本地（宿主机）执行，容器不参与（宪章原则三）。后端 `npm run test`（端点集成测试用 `app.inject`）+ `npm run test:coverage`（阈值配置与 `agent-backend/vitest.config.ts` 同构：全局防倒退地板 + 受约束模块 80%）；前端 `npm run test` + `npm run test:coverage`（`@vue/test-utils` + jsdom），组件与 composable 各自同名同目录测试（原则三）。

**Target Platform**: Linux 容器（交付），开发与测试在 Windows 宿主机 → **存在已知平台差异**，按原则三在 Complexity Tracking 登记。

**Project Type**: Web 应用（**新增两个子项目**）：独立管理界面 + 独立管理服务，外加对既有运行环境与网关的改动。

**Performance Goals**: 四个卡片列表页在实体数 ≤ 100 时首次可交互 ≤ 1s（SC-002）；翻页 ≤ 100ms（SC-022）；单页渲染卡片数恒为 8（SC-023）；部署前校验在单用户 10 个数字人规模下 ≤ 3s（SC-021）；后端接口 P95 ≤ 500ms（原则五）。

**Constraints**:
- 单文件 ≤ 500 行（原则二 / 硬门禁）；分层 `routes → domain → infra` 且 MUST NOT 越级（原则二）。
- 错误响应统一 `{ error: { code, message, details? } }`，错误码全局唯一（原则七）。
- 数据与密钥不进镜像；`.opt-agent/`、`platform-data/` 经 bind mount 提供（技术栈约束）。
- **平台需要读取宿主机的容器状态与编排声明**（FR-043/046/048），属本特性最高风险的边界，见 research.md D3 与 Complexity Tracking。

**Scale/Scope**: 单机内部平台，数据量百级以内，单一管理员（`zyw_admin`）。范围＝规格 `FR-001`~`FR-057`、`SC-001`~`SC-024`，共 4 个功能区、8 张卡片/列表视图、约 40 个管理端点。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | 原则 / 约束 | 本计划的落实方式 | 判定 |
|---|---|---|---|
| 一 | 中文文档与规格驱动 | 本特性全部文档（`plan`/`research`/`data-model`/`contracts`/`quickstart`）与代码注释用简体中文；规格三件套齐备后才动代码 | ✅ |
| 二 | 分层与模块化边界 | `admin-backend` 复用 `agent-backend` 的目录分层（`routes/` → `domain/` → `infra/`）与 `context.ts` 模式；前端复用 `components` → `composables` → `api` 分层；单文件 ≤ 500 行作为硬门禁 | ✅ |
| 二 | 同一职责唯一来源 | 内置工具目录由运行环境提供**单一来源**（消除 `builtin-tools.ts` 与 `agent-instance.ts` 的两处重复）；文件格式解析复用既有模块思路而非重写第二份 | ✅ |
| 三 | 测试完备性 (NON-NEGOTIABLE) | 每个管理端点 MUST 有集成测试；`domain/` MUST 有单元测试；前端每个组件/composable MUST 同名同目录测试；覆盖率 ≥ 80%（受约束模块硬校验） | ✅ |
| 三 | 测试仅本地、容器不参与 | 新子项目**不提供** `Dockerfile.test`，`docker-compose.yml` **不新增** test profile | ✅ |
| 三 | 平台差异风险显式管理 | Windows 开发 / Linux 交付的差异（路径大小写、非 ASCII 路径、行尾、bind mount 权限）在 Complexity Tracking 登记 | ✅ |
| 四 | 无障碍 WAI-ARIA | 一级导航、卡片、分页、确认框、页签全部要求键盘可达 + `aria-*`；状态不只靠颜色（异常态同时给文本）；确认框用原生 `<dialog>`；尊重 `prefers-reduced-motion` | ✅ |
| 五 | 性能与数据一致性 | 接口 P95 ≤ 500ms；列表分页避免全量渲染；写入用原子替换 + 检查-占位；破坏性操作二次确认；并发编辑有冲突检测（SC 已定义口径） | ✅ |
| 五 | 无 N+1 查询 | 设计态为 JSON 文档，一次读取；列表派生信息一次算完，未在循环内发起 IO | ✅ |
| 六 | 依赖控制 | **零新增依赖**；复用既有后端依赖与 Vue 原生能力；Docker 访问用 Node 内置 `http` + `socketPath` 实现，不引入 docker SDK | ✅ |
| 六 | 新增基础设施说明必要性 | 新增 2 个容器（`admin-frontend` / `admin-backend`）+ 网关路由 + 1 个 bind mount 目录 + 1 个新增挂载（Docker socket）；必要性逐条在 research.md D3/D8 说明 | ✅ |
| 七 | 接口契约与前后端一致性 | 新增 `contracts/admin-api.md`（含端点、请求/响应、错误码表），`admin-frontend/src/api/types.ts` 与之**一一映射**；契约变更四处同步列入门禁 | ✅ |
| 七 | REST 与错误格式 | 资源化路径 + 正确方法与状态码；错误体统一 envelope，错误码全局唯一（与既有码表合并后不得重复） | ✅ |
| 八 | 一条命令跑门禁 | 两个新子项目各自 `package.json` 提供 `lint`/`typecheck`/`test`/`test:coverage`/`build`；并在 `quickstart.md` 记录 | ✅ |
| 八 | 部署后非交互冒烟确认 | `quickstart.md` 提供一条 HTTP 打点脚本，确认网关 → 管理界面 → 管理服务链路可用 | ✅ |
| 八 | 容器只做部署 | 新子项目容器仅构建与运行；测试/lint/类型检查/覆盖率一律本地 | ✅ |
| 硬门禁 | 覆盖率 / 单文件行数 / 依赖清单 | 覆盖率阈值随新代码设立；500 行上限纳入新子项目 lint 之外的检查；依赖清单在 research.md 全量登记（本特性零新增） | ✅ |
| 不追溯 | 不组织存量补齐专项 | 不重测、不补测既有 `frontend`/`agent-backend` 存量模块；不动既有端点行为 | ✅ |

**结论：无违规项，无需 Complexity Tracking 豁免。** 但有两项**已知口径差异**必须在实现前回写规格（见下节），以及一项平台差异风险需登记。

### 已知口径差异（MUST 在实现前回写 `spec.md`，原则一）

1. **FR-005 / SC-017「严格单向」与 FR-048/049/050 的边界**：`SC-017` 表述为"运行环境 → 平台的反向数据通道数量为 **0**"，但 `FR-048`（查看 MCP 服务日志）与 `FR-049/050`（调用次数统计，MUST 自动更新）**必然要求平台只读采集运行环境的运行观测**。本计划的口径为：**「严格单向」约束的是配置数据流**（平台不得从运行环境反向导入配置、运行环境不得回写平台配置），**运行观测（容器状态、日志、调用次数）的只读采集不在其列**。处理方式：在 `spec.md` 的 `FR-005` 与 `SC-017` 补一句限定，并在 `checklists/requirements.md` 追加一条澄清项。
2. **技术栈约束「前端 API 基址 MUST 走同源相对路径（`/api/*`）」** 对新平台仍然成立——本计划采用 `/api/admin/*` 由网关分发到 `admin-backend`，而非另立 `/admin-api/*`，以保持与既有约定的字面一致。其中 `/api/admin/` 与既有 `/api/` 在 nginx 下按**最长前缀**匹配，不冲突。

### 设计后复核（Phase 1 完成后，重跑宪章门禁）

在 `research.md`、`data-model.md`、`contracts/`、`quickstart.md` 全部产出后重跑上表，结论**仍然全部通过**，且设计过程带来三处**加强**、两处**新增登记**：

**加强（设计使然）**

| 项 | 加强内容 | 落点 |
|---|---|---|
| 原则六（依赖控制） | 初版把 SKILL ZIP 解压视为"零新增依赖"；设计阶段确认 **Node 标准库不提供 ZIP 归档读取**，故按原则六正式登记唯一新增依赖 `yauzl`（含选型理由、4 个被否决方案、版本锁定要求），而非悄悄引库或手写安全敏感解析器 | `research.md` D7 |
| 原则八（简单可控） | 给两个新子项目补上 `check:lines` / `check:deps`，使**硬门禁三项**全部具备自动证据（此前仅覆盖率有）；命令一并写入 `quickstart.md` | `research.md` D9、`quickstart.md` §3 |
| 原则五（数据一致性） | 部署原子性由"整体覆盖"细化为"**临时目录构建在同挂载点内** → 目录级 `rename`"，并识别出 `EXDEV` 降级路径必须纳入集成测试 | `research.md` D8、Complexity Tracking |

**新增登记**

| 项 | 说明 |
|---|---|
| **证据缺口：MCP 调用统计** | `FR-050`"自动更新"要求精确的工具调用计数，而唯一可靠的计数点在运行环境。已定为 `plan.md` R4（新增只读端点 + 一处计数点），并明确口径为**工具调用次数**而非 HTTP 请求数 |
| **口径冲突已解决但需回写规格** | `FR-005`/`SC-017` 的"严格单向"与 `FR-048/049/050` 的运行观测只读采集（见上表第 1 项口径差异） |

**设计阶段未发现新的宪章违规项**，因此 Complexity Tracking 保持"无豁免项"状态，仅登记平台差异风险与高风险边界。

### 实现期回顾（2026-09-15，重跑宪章门禁）

实现完成后重跑上表，结论**仍然全部通过**。三处需要登记的实测结果：

| 项 | 实测结果 | 落点 |
|---|---|---|
| 原则八（部署后非交互冒烟） | `docker compose up -d --build` 拉起 6 个容器，§6 七个检查点全部 `200` | `quickstart.md` §10.2 |
| 平台差异风险（Windows 开发 → Linux 交付） | 本地门禁在 **Windows + Node 24** 全绿；交付形态（Linux 容器）经一次真实部署验证通过。`EXDEV` 降级路径由注入式单测覆盖（`opt-agent-writer.spec.ts`），未能在真实跨设备场景复现 | `quickstart.md` §10.1／§10.3 |
| 需求理解修正（两处，**均为真实部署发现**） | ①Engine API 不写死版本；②编排内服务默认 `http`。二者均已回写 `checklists/requirements.md`（补充 19／20）并补回归测试 | `quickstart.md` §10.3 |

### 既有资产的缺口（诊断结论，非本特性范围的扩张）

- **全仓库不存在任何既有的规格产物**：`specs/` 下只有本特性目录；代码中被大量引用的 `specs/001-agent-chat-ui/contracts/backend-api.md`、`research.md`、`data-model.md`、`quickstart.md` **均不存在**（全仓库搜索命中 0）。这同时违反原则一（规格三件套）与原则七（每端点必须有契约文档）。按「治理 § 不追溯」本特性**不补齐**，但**必须登记**（同「ESLint 配置缺失」的处理方式）。→ 待办，见文末。
- **`docker-compose.yml` 中仍保留 `backend-test` / `ocr-test` 两个 `test` profile**，与宪章 2.0.0「容器 MUST NOT 承担任何测试职责」直接冲突。本特性**必须修改** `docker-compose.yml`，故一并处理（清理两个 profile 与对应 `Dockerfile.test`），而不是留给"下次再说"。
- **`gateway/nginx.conf` 中的三段「待接入」注释**（`/mcp/`、`/skill/`、`/designer/`）描述的是"三个独立平台"的旧设想，与 `FR-001`（四个功能区合成**一个**平台）不一致，MUST 清理。

## Project Structure

### Documentation (this feature)

```text
specs/001-digital-human-platform/
├── plan.md              # 本文件（/speckit.plan 输出）
├── spec.md              # 功能规格（已存在）
├── research.md          # Phase 0 输出：技术决策与备选方案
├── data-model.md        # Phase 1 输出：实体、字段、校验规则、状态流转
├── quickstart.md        # Phase 1 输出：本地门禁与部署冒烟确认
├── contracts/           # Phase 1 输出：接口契约
│   ├── admin-api.md         # 新增的管理服务接口契约（平台 ↔ 管理界面）
│   └── runtime-api-delta.md # 对既有运行环境接口/资产的改动（FR-011、FR-056/057 落地）
├── checklists/
│   └── requirements.md  # 规格质量检查清单（已存在）
└── tasks.md             # Phase 2 输出（/speckit.tasks 生成，非 /speckit.plan）
```

### Source Code (repository root)

既有结构（**不改动其组织方式**）：

```text
gateway/          # nginx 统一入口（本特性需加 2 条 location）
frontend/         # 既有对话工作台（Vue 3 + Vite）
agent-backend/    # 既有对话后端（Fastify 5 + TS）
ocr-service/      # 既有 OCR MCP 服务（Python）
docker-compose.yml
```

本特性新增（**与既有子项目同构的同级目录**，命名风格对齐 `frontend` / `agent-backend`）：

```text
admin-frontend/                    # 独立管理界面（Vue 3 + Vite + TS，零第三方运行时库）
├── src/
│   ├── api/                       # 网络层：http.ts（薄封装）/ types.ts（契约类型）/ 各资源模块
│   ├── composables/               # 状态与业务：useXxx.ts
│   ├── components/                # 视图：PascalCase.vue，按功能区分子目录
│   │   ├── layout/                # 一级导航/应用外壳
│   │   ├── common/                # 卡片列表、分页、确认框、页签、异常态、空态
│   │   ├── mcp/ skills/ agents/ deploy/
│   ├── constants/                 # 常量
│   ├── utils/                     # 无状态纯函数（含错误码→中文文案映射）
│   ├── styles/                    # 全局样式与设计令牌
│   ├── App.vue
│   └── main.ts
├── tests/                         # 跨组件/端到端性质的测试（组件测试与组件同目录）
├── index.html
├── package.json / tsconfig*.json / vite.config.ts / eslint.config.mjs
├── Dockerfile                     # 2 段：vite build → nginx 托管静态
└── nginx.conf                     # SPA 回退（与既有 frontend 同构）

admin-backend/                     # 独立管理服务（Fastify 5 + TS，与 agent-backend 同构）
├── src/
│   ├── routes/                    # 接口层：mcp.ts / skills.ts / agents.ts / users.ts / deploy.ts / platform.ts
│   ├── domain/                    # 业务层（纯逻辑，可单测）
│   │   ├── config-center/         # 四类配置的读写与一致性（含「名称引用」解析）
│   │   ├── skill-library/         # SKILL 库：元数据解析、ZIP 安全解压与校验
│   │   ├── deploy/                # 部署编排：预校验、整体覆盖物化、部署清单、结果与历史
│   │   └── mcp/                   # MCP 服务清单投影、服务级配置、启停/测试/日志/统计
│   ├── infra/                     # 数据访问层
│   │   ├── platform-store.ts      # 平台设计态存储（JSON + 原子替换）
│   │   ├── opt-agent-writer.ts    # .opt-agent 物化（整体覆盖，含 tmp → rename）
│   │   ├── compose-reader.ts      # 只读解析 docker-compose.yml
│   │   ├── docker-host.ts         # 经 unix socket 访问 Docker Engine API（零依赖）
│   │   └── mcp-client.ts          # MCP 客户端（列工具、连通性/能力测试）
│   ├── config.ts / context.ts / logging.ts / server.ts
├── tests/
│   ├── unit/                      # domain 单测
│   ├── integration/               # 每个端点一个集成测试（app.inject）
│   └── fixtures/                  # 样例 .opt-agent、样例 SKILL zip
├── package.json / tsconfig.json / eslint.config.mjs / vitest.config.ts
└── Dockerfile                     # 2 段：npm ci + tsc → node 运行（与 agent-backend 同构）

platform-data/                     # 平台设计态（bind mount；不进镜像）
```

**Structure Decision**: 采用「Web 应用 + 新增两个同级子项目」结构。`admin-frontend` / `admin-backend` 与既有 `frontend` / `agent-backend` **平级且命名风格一致**，使四个子项目在目录层面就能看出"同一产品、不同界面"。运行环境侧只做三处最小改动：`gateway/nginx.conf`（2 条 location）、`docker-compose.yml`（新增 2 服务 + 清理 test profile）、`agent-backend`（FR-011 工具目录单一来源 + 新增只读接口）。

## 对既有运行环境的改动（MUST 在实现中显式登记，规格假设已要求）

| # | 改动 | 落点 | 必要性 |
|---|---|---|---|
| R1 | **内置工具目录收拢为单一来源**：把 `builtin-tools.ts` 中散落在 `if (on(...))` 分支内的 `name`/`label`/`description`/`parameters`/是否可写抽为**纯数据目录**，`buildBuiltinTools` 改为消费该目录；消除与 `agent-instance.ts` 的 `BUILTIN_TOOL_NAMES` 重复 | `agent-backend/src/domain/builtin-tool-catalog.ts`（新增）+ `infra/builtin-tools.ts`（改造） | FR-011 要求"可枚举目录"且 MUST NOT 由平台硬编码；FR-012 要求说明为**占位符模板**（现状是运行期字符串拼接，模板不可读） |
| R2 | **新增只读端点**：`GET /api/builtin-tools` 返回可枚举工具目录（名称、显示名、说明模板、入参、是否可写） | `agent-backend/src/routes/`（新增） | FR-011 的唯一来源必须可被平台读取；平台是独立服务 |
| R3 | **场景读写位置**（已实现，本特性仅消费） | `agent-backend/src/domain/dirs.ts` | 见规格假设；本特性按数字人级路径物化 |
| R4 | **新增只读端点**：`GET /api/mcp-call-stats` + MCP 工具调用计数点（落 `UsageDb`） | `agent-backend/src/routes/`、MCP 工具适配层、`src/infra/usage-db.ts` | `FR-049`／`FR-050` 要求统计"自动更新"，而运行环境是**唯一确切知道工具调用发生的地方**（`research.md` D6） |
| R7 | **数字人配置"变化即失效"**：取用池中实例前比对**配置指纹**，不一致即重建 | `agent-backend/src/infra/agent-factory.ts`、`src/domain/agent-pool.ts`、`src/server.ts` 的 `getOrCreateAgent` | `FR-034` 要求"其后的新对话立即使用新配置"，但**实例池**（按 `(用户, 数字人)` 缓存、仅空闲超时回收）会使池中实例继续用**旧配置**。详见 `contracts/runtime-api-delta.md` §8 |

> R1/R2/R4/R7 的完整契约见 [contracts/runtime-api-delta.md](./contracts/runtime-api-delta.md)。这四项**MUST NOT 改变任何既有端点的请求/响应结构与错误码**：R1 为内部重构（元数据组织方式变化，对模型可见的文本逐字不变）、R2/R4 为纯新增只读端点、R7 仅改变**实例复用时机**（对端点契约透明）。R5/R6 为基础设施配置（网关路由与容器编排），见同一契约的 §5/§6。整体符合「不追溯」与"不得借改动之机放大范围"。

## Complexity Tracking

> 本特性**无宪章违规项**，故不填豁免表。下表登记原则三要求显式管理的**平台差异风险**与已识别的高风险边界。

| 项 | 说明 | 被否决的更简方案 / 处置 |
|---|---|---|
| **平台差异：Windows 开发 → Linux 交付** | 本地（Windows）测试无法覆盖 Linux 侧行为：①路径大小写敏感性；②非 ASCII 路径（`生产计划` 等中文目录名是本产品的**常态**，非边缘）；③行尾符；④bind mount 的文件权限与属主；⑤`rename` 原子替换在跨设备时行为不同（`platform-data` 与目标目录若不在同一挂载点，`rename` 会失败） | ①/②：沿用既有 `domain/fs-safe.ts` 的思路，路径规范化与大小写校验集中在单一模块；③：读写统一按 `utf8` 且解析时容忍 `\r\n`；④/⑤：原子替换前**先校验是否同一挂载点**，否则降级为"写临时文件 + 校验 + 逐文件替换"，并把该降级路径纳入集成测试。**部署后 MUST 执行一次非交互冒烟确认**（原则八）。被否决：恢复容器内测试（违反原则三 2.0.0） |
| **Docker 访问（最高权限边界）** | FR-043/046/048 要求读取容器编排声明、启停容器、读取容器日志。需把宿主机 Docker socket 挂载进 `admin-backend` | 被否决①：容器内安装 `docker`/`docker compose` CLI（镜像显著变大、需处理 socket 路径与 compose 文件路径映射、且属"引入非必要新基础设施"）；被否决②：改由 `agent-backend` 代理这些操作（脏化数据面职责、且它自身也无 Docker 权限）。**采用**：Node 内置 `http.request` + `socketPath` 直连 Docker Engine API（零新增依赖），并把可访问的操作**限定为只读查询 + 对白名单内服务的 start/stop**。该 socket 等价于宿主机 root 权限，**MUST 在实现说明与部署说明中显式标注该风险** |
| **部署的原子性 vs 整体覆盖** | FR-008/026/029 要求"要么完整生效要么完全不生效"，且以用户为最小单位 | 采用"**先在临时目录构建完整产物 → 校验 → 目录级原子改名**"，失败即丢弃临时目录；被否决：逐文件原地覆盖（中途失败即产生半成品，违反 FR-029） |
| **`docker-compose.yml` 既有 test profile 冲突** | 与宪章 2.0.0「容器 MUST NOT 承担任何测试职责」冲突 | 本特性必须改该文件，故一并清理 `backend-test` / `ocr-test` 两个 profile 及对应 `Dockerfile.test`。**不回溯**既有 `frontend`/`agent-backend` 的其他存量问题 |

## 待办（登记与处置状态）

| # | 待办 | 来源 | 处置状态（2026-09-15 实现期登记） |
|---|---|---|---|
| 1 | **既有特性 `001-agent-chat-ui` 的规格产物全部缺失**（`spec`/`plan`/`tasks`/`research`/`data-model`/`contracts`/`quickstart` 一个都没有），而代码中被大量引用 | 本计划 § Constitution Check 的诊断；违反原则一与原则七 | **仍未处置（保持待办）**。本特性按「治理 § 不追溯」不补齐既有规格；本特性的两个新契约（`contracts/admin-api.md`、`contracts/runtime-api-delta.md`）已齐备，且 `runtime-api-delta.md` 明确登记了"既有 `contracts/backend-api.md` 并不存在"这一事实 |
| 2 | **`frontend` 覆盖率缺口未闭合**：`src/api/**`（7）+ `src/composables/**`（13）共 20 个模块仍为 0%，仅由防倒退地板托底；地板只可上调 | 宪章 2.0.2 同步影响报告 | **仍未处置（保持待办）**——按「不追溯」不在本特性范围内。**但本特性在新增的 `admin-frontend` 里没有重复这个缺口**：`src/api/**`（8 个）与 `src/composables/**`（5 个）已全部补测并纳入 80% 受约束模块清单（实测 stmts 96.0 / branch 89.6 / funcs 98.9 / lines 96.5） |
| 3 | **硬门禁中「单文件行数 ≤ 500」与「依赖清单」尚无自动检查**，目前靠人工 | 宪章「开发工作流与质量门禁」；本特性为新增两个子项目，正好是落成该检查的时机 | **已由 T007／T008 落地于两个新子项目**：`admin-backend` 与 `admin-frontend` 各有对称的 `scripts/check-lines.mjs` 与 `scripts/check-deps.mjs`，并纳入 `package.json` scripts（`npm run check:lines` / `npm run check:deps`）。**明确注明**：既有 `frontend`／`agent-backend` 的对应检查**仍属待办**（按「不追溯」不在本特性范围内）。此外实现期为契约一致性新增了 `admin-backend/scripts/check-error-codes.mjs`（`npm run check:contract`），把原则七的"四处同步"也变成了机械核对 |
