# 实现计划：上传记录的生命周期与重名编号

**Branch**: `012-upload-record-naming` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: 特性规格 `specs/012-upload-record-naming/spec.md`（3 个用户故事 / **44 条功能需求** / **8 条成功标准**；无待澄清项——
Q1 = A 半角括号 `报告(1).csv`、Q2 = B 关闭面板时进行中的上传保留记录）

## 摘要

三个诉求各自只落一个支点，且都以"既有唯一入口"承接，避免新增第二套规则：

1. **成功即回写**：`useUploads` 的**唯一成功出口**（`startUpload` 的 201 分支）之后，由**新 composable `useUploadPanel`**
   订阅 `items` 的终态变化，对"首次转为成功"的项调用 `mentionComposer.onPickFile({dir, filename: 落盘名})`——
   这正是手动 `@` 选文件的同一条链路（登记引用 + 拼写 `@标记` + 上限/去重/toast 全部继承，`FR-006` / `FR-041`）；
   同时 `workspace.registerFile()` **就地登记**该文件，使发送前的 `exists` 校验立刻为真（`FR-004`，不重拉全量以免丢折叠态）。
2. **收起即清终态**：`uploads.clear()` 的口径由"只清成功"改为"清终态（成功 / 失败）、保留待上传 / 上传中"（`FR-010` / `FR-013`），
   并接到**三条收起路径**：`+` 收起、面板自带关闭入口、切换数字人（后者在 `useAppSession` 的 `onSwitched` 里补一行）。
3. **重名编号**：后端把 `name_YYYYMMDD_HHMMSS.ext`（再撞 `-1/-2`）换成 `原名` / `原名(n).ext`；并发唯一性用
   **排他占名**（`linkSync` 独占创建，`EEXIST` 即下一个编号；不支持硬链接时回退 `copyFileSync(EXCL)`），
   把"是否重名"的判定交给目标文件系统本身（Windows 大小写不敏感因此天然满足 `FR-023`）。

同时必须动**目录结构**才能过宪章原则二的 500 行硬门禁：`agent-backend/src/routes/files.ts` 当前实测 **543 行**（已超限的存量文件），
本次恰好改的是其中的上传端点，故按既有先例（`files-put.ts` 的拆法）拆为
`routes/files-upload.ts`（上传端点）+ `routes/files-scope.ts`（归属与目录解析，两处共用）+ `domain/upload-name.ts`（命名算法）。

## 技术上下文（Technical Context）

**Language/Version**：后端 Node 20+ / TypeScript 6（ESM）/ Fastify 5；前端 Vue 3.5 + TypeScript 6 + Vite（Vitest 5）。

**Primary Dependencies**：**零新增**。原子占名用 `node:fs` 的 `linkSync` / `copyFileSync`（`COPYFILE_EXCL`），
前端回写复用 `watch` 与既有的 `useMentionComposer.onPickFile` / `mentionToken`；不引入任何并发控制库或文件名处理库（原则六）。

**Storage**：文件系统（`{optAgentRoot}/users/{uid}/user-data/{agent}/{空间}/{目录}`）。**无数据库变更**：
上传记录只是前端面板内的会话级状态（不持久化，`假设 7`）；命名规则只影响落盘文件名。

**Testing**：后端 Vitest（`tests/unit/**` 纯逻辑 + `tests/integration/**` 端点）；前端 Vitest 5 + `@vue/test-utils`。
**全部在本地宿主机执行，容器不参与**（原则三）。

**Target Platform**：Windows 宿主机（开发 / 门禁）、Linux 容器（交付）——**本特性有平台相关行为**：
文件名大小写敏感性、硬链接可用性、单段名长上限（见「平台差异登记」）。策略是**不做平台判断**，把判定交给目标文件系统。

**Project Type**：四侧一体的 Web 应用；本特性落在 `agent-backend`（落盘命名）+ `frontend`（回写与清空）两侧，
`admin-*` **零改动**（平台侧配置覆盖语义不变，文件空间内容不参与部署，见记忆「单向数据流」口径）。

**Performance Goals**：

- 上传落盘保持 O(1) 次占名（无重名时一次成功），冲突时最多 `MAX_NAME_ATTEMPTS` 次有界重试（`FR-028` / 原则九）；
- **回写与清空零网络请求**：`@` 标注走本地状态，`workspace.registerFile` 就地改内存（不触发 `workspace.load()`）；
- 端点 P95 ≤ 500ms 沿用既有口径（命名逻辑是同步文件系统调用，与既有 `renameSync` 同量级）。

**Constraints**：

- **单文件 ≤ 500 行**（硬门禁）：`files.ts` 现 **543 行**，本次拆分后目标 ≤ 350；`useChatPanel.ts` 现 **499 行**，
  新增逻辑**不得内联**（否则必超），故提取 `useUploadPanel.ts`，`useChatPanel` 净变化为负；
- **覆盖率**：新增 `useUploadPanel.ts` / `useUploads.ts`（本次创建同名测试）**登记 80%**；全局地板只上不下；
- **零新增依赖**；**不改既有测试的断言口径**（只补用例）；
- **契约**：请求 / 响应结构不变，`filename` 语义仍为落盘名；**新增一个错误码** `FILE_NAME_CONFLICT`（409，候选名用尽），
  须同步四处（契约文档 / 前端错误码文案 / 后端抛出点 / 测试），见 `contracts/http-upload.md`。

**Scale/Scope**：单用户工作台；单次批量上传典型 1~5 个文件（引用上限 10）；改动面 **21 个文件**
（后端 6：3 新增源文件 + 1 改动源文件 + 2 个测试文件；前端 15：4 新增（`useUploadPanel.ts` 与 3 个 spec）+ 8 个源文件改动 + 3 个既有测试扩展）。

## 宪章检查（Constitution Check）

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 本目录 `spec.md` / `plan.md` / `research.md` / `data-model.md` / `contracts/` / `quickstart.md` 全中文；规格无待澄清项；本次新增的错误码已回写 `spec.md`（`FR-040` 的口径补充 + 修订记录） |
| 二 代码质量与模块化边界 | **通过（含超限文件拆分）** | 命名规则唯一实现（`domain/upload-name.ts`）、`@` 拼写唯一实现（既有 `mentionToken` / `onPickFile`）、清空口径唯一实现（`uploads.clear`）；`files.ts` 543 → 目标 ≤ 350（先例 `files-put.ts`）；`useChatPanel.ts` 499 → 净减（提取 `useUploadPanel.ts`）；新增模块均配同名测试 |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 新增 `domain/upload-name.ts` ⇒ `tests/unit/upload-name.spec.ts`；上传端点既有集成测试全部保留并**补**命名/并发/错误码用例；前端新增 `useUploads.spec.ts`（当前**缺失**，本次创建）与 `useUploadPanel.spec.ts`；`useWorkspace.spec.ts` / `UploadMenu.spec.ts` 补用例。**全部本地执行** |
| 四 无障碍与可用性 | **通过** | 面板结构不变，不新增控件；记录清空 / `@` 写入均为**既有可访问路径**的复用（`@` 由输入框文本承载，读屏可读；失败原因仍为文本而非仅颜色）。**键盘焦点不因自动回写而移动**（`FR-005`：只追加文本，不改光标） |
| 五 性能与数据一致性 | **通过（重点）** | 并发唯一性由**排他占名**保证（`linkSync` 独占 / `COPYFILE_EXCL`），**不覆盖、不部分提交**；候选名有界（`MAX_NAME_ATTEMPTS`）；回写零请求；`registerFile` 就地原子替换 `spaces`（与既有 `remove` 同款不可变更新） |
| 六 技术治理与依赖控制 | **通过** | **零新增依赖**；原子性用 `node:fs` 原生能力；不引并发库、不引文件名库 |
| 七 接口契约与前后端一致性 | **通过（两侧同改）** | 后端新增/迁移：`files-upload.ts` + `domain/upload-name.ts`；前端同步：`api/files.ts` 注释、`error-message.ts` 新码文案、`useUploads` 契约注释；契约文档 `contracts/http-upload.md` 与本实现同批更新（四处同步齐备）；响应结构不变，前端**不推算**后缀 |
| 八 测试部署简单可控 | **通过** | 门禁命令沿用两侧既有脚本（`npm run lint/typecheck/test[:coverage]/build`），无新增脚本、无新增环境变量、无部署编排改动 |
| 九 优雅降级与故障可观测 | **通过** | 候选名用尽 → 409 `FILE_NAME_CONFLICT`（有界重试后**显式失败**，不静默覆盖）；超长名 → 先截断、仍失败则 400 并给出原因；上传失败后**不回写**（`FR-003`）；关闭面板时进行中的上传**不取消、结果与后端一致**（`FR-013`）；前端未知错误码回退通用文案并保留原码（既有 `error-message.ts` 口径） |

**Phase 1 设计后复核结论**：九条结论**不变**。设计未引入新的越界项；无 Complexity Tracking 中的"违反项",
仅有「已知限制 / 平台差异 / 被否决方案」登记。

## 技术决策

| # | 决策 | 理由 | 被否决的替代 |
|---|---|---|---|
| **D1** | 回写接线 = **新 composable `useUploadPanel.ts`**：持有 `uploadOpen` + 5 个动作（toggle/close/pick/retry/**订阅成功项**），`useChatPanel` 只做装配（净减行数） | `useChatPanel.ts` 已 499 行，内联必超 500（原则二）；面板接线本身是独立职责（开关 + 清空 + 回写），单独成文件可被 `useUploadPanel.spec.ts` 直接钉住 | ① 内联进 `useChatPanel`（越 500 行）；② 在 `createUploadsStore` 里注入 `mention`/`draft`（跨域依赖 + 装配顺序成环：`draft` 属 `chat`，在 `uploads` 之后创建）；③ 在组件 `ChatPanel.vue` 里 watch（视图层持有业务状态，违反分层） |
| **D2** | `@` 写入**完全复用** `mentionComposer.onPickFile`（pick 引用 + `insertToken` + 关闭浮层） | `FR-041` / 宪章"同一职责只有一处实现"：拼写只在 `mentionToken`、上限与去重只在 `pickFile`；顺带继承"已存在 10 个引用时提示而不插入"（`FR-006`） | 新写 `appendMentionToken()`（第二套拼写与上限判断，必然漂移） |
| **D3** | 新文件"立即可引用" = **`workspace.registerFile()` 就地登记**，不调 `workspace.load()` | `exists` 只读已加载清单（`useWorkspace.ts` L141）；就地登记 O(1)、零请求、不重置折叠态与滚动；与既有 `remove()` 的就地更新**成对**（同一处 `spaces` 不可变替换） | ① 每次成功都 `load()`（批量 10 个文件 ⇒ 10 次全量请求，慢且抖）；② 放宽 `exists` 为"登记 ∪ 清单"（同一职责两处实现，且删除后仍为真） |
| **D4** | 清空口径 = `clear()` **只移除终态**（成功 / 失败），保留 `pending` / `uploading`；三条收起路径共用它 | `FR-010` / `FR-013`（Q2 = B）；`clear()` 已是唯一实现点，改口径比新增 `clearTerminal()` 更不容易漏；进行中的上传记录随其 Promise 继续流转，成功仍回写 | ① 关闭时取消进行中的上传（需要 AbortController 贯穿 multipart，且"已落盘一半"更难收场）；② 关闭时清全部记录（违背 Q2 = B） |
| **D5** | 后端拆文件：`routes/files-upload.ts`（端点）+ `routes/files-scope.ts`（`currentAgentFor` / `checkDir`）+ `domain/upload-name.ts`（命名） | `files.ts` 实测 **543 行**已超硬门禁；本次改的正是上传端点，属于"本次改动涉及的文件"而非无关重构；`files-put.ts` 已有"端点族一个文件"先例。分层上：命名算法属 `domain/`，路由只调用 | ① 只抽命名、仍留 520 行（门禁仍红）；② 把 `checkDir` 复制进新文件（双实现，原则二）；③ 不动结构、登记例外（无必要性——拆开是纯移动） |
| **D6** | 并发唯一性 = **排他占名**：按候选名依次 `linkSync(staging, dest)`，`EEXIST` 试下一个；不支持硬链接（`EPERM`/`EXDEV`/`ENOTSUP`）时回退 `copyFileSync(COPYFILE_EXCL)` | 一次系统调用即"检查 + 占位"原子完成（原则五原文即"原子改名、同步检查+占位"）；**不覆盖**任何已有文件；大小写敏感性由目标 FS 决定，天然满足 `FR-023`；`link` 为 O(1)（同卷，暂存与目标同属 `user-data/{agent}`） | ① `existsSync` 预检 + `renameSync`（TOCTOU：并发同名会覆盖，正是要修的缺陷）；② 进程内互斥锁（仅单进程有效，且要维护锁表）；③ 先随机名写入再改名（多一次 IO，且仍需判重） |
| **D7** | 候选名用尽 / 超长名：`MAX_NAME_ATTEMPTS = 999` 后抛 **409 `FILE_NAME_CONFLICT`**；超长名先截断主名（保留 `(n)` 与扩展名），仍 `ENAMETOOLONG` 则 **400 `VALIDATION_FAILED`** 并给中文原因 | 原则九：有界重试 + 显式失败，不静默覆盖；`FILE_NAME_CONFLICT` 语义唯一（全局无同名错误码），前端补一条中文文案即可 | ① 无限循环（无界重试，违原则九）；② 复用 `INTERNAL_ERROR`（把"名字冲突"说成"系统繁忙"，误导用户）；③ 直接截断到系统上限而不报错（用户拿到不可预期的名字） |

## 影响面清单（文件级）

> 行数为 2026-10-18 实测（`[System.IO.File]::ReadAllLines().Length`，与验收同口径）；"预计"列为设计目标。

### 后端 `agent-backend`

| # | 文件 | 动作 | 行数 |
|---|---|---|---|
| 1 | `src/domain/upload-name.ts` | **新增**：`sanitizeBase` / `candidateName(original, index)` / `claimName(dirAbs, original, staging, maxAttempts?)`（排他占名 + 截断 + 有界重试 + 两类错误） | 新增 ≈ 110 |
| 2 | `src/routes/files-upload.ts` | **新增**：从 `files.ts` **整体搬入** `POST /api/files/upload` 处理器（暂存、早验、白名单、字段校验均不变），落盘改为 `claimName(...)` | 新增 ≈ 165 |
| 3 | `src/routes/files-scope.ts` | **新增**：`currentAgentFor` / `checkDir`（上传与其余文件端点共用，避免复制） | 新增 ≈ 55 |
| 4 | `src/routes/files.ts` | 改动：删除上传处理器与 `timestamp`/`stampedName`；改从 `files-scope.ts` 取两个函数；`registerFileRoutes` 内调用 `registerFileUploadRoute` | 543 → 预计 ≈ 350 |
| 5 | `src/domain/dirs.ts`（**不改**） | 只读引用 `SPACE_TMP` / `userDataDir` / `parseSpaceDir`：确认无新导出需要 | 不变 |
| 6 | `tests/unit/upload-name.spec.ts` | **新增**：候选名表驱动（原名 / `(1)` / `(2)` / 稀疏取最小 / `a.tar.gz` / `README` / `.env` / 清洗 `/`·`\`）+ `claimName` 的真实占名（临时目录）+ 用尽与超长两条错误路径 | 新增 ≈ 150 |
| 7 | `tests/integration/files-scenario.spec.ts` | 改动：补"不重名用原名 / 重名 `(1)`·`(2)` / 并发同名零覆盖 / 跨目录互不影响 / 历史时间戳文件并存"用例；既有用例断言口径不变 | 现 ≈ 890 → +≈ 120 |

### 前端 `frontend`

| # | 文件 | 动作 | 行数 |
|---|---|---|---|
| 8 | `src/composables/useUploadPanel.ts` | **新增**：`uploadOpen` + `onToggleUpload` / `onCloseUpload` / `onPickFiles` / `onRetryUpload` + 成功项订阅（去重集，`localId` 只回写一次） | 新增 ≈ 120 |
| 9 | `src/composables/useUploadPanel.spec.ts` | **新增**：同名测试 | 新增 ≈ 150 |
| 10 | `src/composables/useUploads.ts` | 改动：`clear()` 口径（终态清理）+ 头注释/字段注释与 `FR-011` 对齐；`upload()` 末尾不再依赖"失败数"统计口径变化 | 170 → ≈ 175 |
| 11 | `src/composables/useUploads.spec.ts` | **新增**（当前**无**同名测试）：成功 / 失败 / 预校验 / 重试 / 清空（终态 vs 上传中）/ 失败 toast 计数 | 新增 ≈ 170 |
| 12 | `src/composables/useWorkspace.ts` | 改动：新增 `registerFile(reference & {size})`（就地登记，含去重与未知目录 no-op） | 201 → ≈ 220 |
| 13 | `src/composables/useWorkspace.spec.ts` | 改动：补 `registerFile` 三例（登记后 `exists` 为真 / 重复登记不重复 / 未知目录 no-op） | 3.5KB → +≈ 50 |
| 14 | `src/composables/useChatPanel.ts` | 改动：删掉本地 `uploadOpen` 与 4 个处理器，改为装配 `useUploadPanel`（`mentionComposer` 之后创建）并原样导出 | 499 → 预计 ≈ 478 |
| 15 | `src/composables/useAppSession.ts` | 改动：`agents.onSwitched` 里补 `uploads.clear()`（`FR-014`） | 283 → 284 |
| 16 | `src/api/files.ts` | 改动：头注释（去掉"追加时间戳…-1/-2"，改为"原名 / `(n)`；前端 MUST NOT 自行拼接"） | 104 → 105 |
| 17 | `src/utils/error-message.ts` | 改动：`BASE_MESSAGES` 增 `FILE_NAME_CONFLICT: '同名文件过多，请先整理目录后重试'` | 约 200 → +1 |
| 18 | `src/utils/error-message.spec.ts` | 改动：补新码的中文文案映射断言（契约四处同步的第 ② 处证据） | 11.7KB → +≈ 15 |
| 19 | `src/components/chat/UploadItem.vue` | 改动：头注释（展示名口径：落盘名，不再说"追加时间戳"） | 103 → 103 |
| 20 | `src/components/chat/UploadItem.spec.ts` | **新增**：同名测试（该组件本次被改动且此前无测试，按 011 `BaseIcon` 先例补）；钉住 `displayName === serverFilename`（含 `(1)` 后缀，`FR-024`） | 新增 ≈ 55 |
| 21 | `src/components/chat/UploadMenu.spec.ts` | 改动：补"空列表 ⇒ 不渲染记录区"（`FR-015`） | 7.5KB → +≈ 25 |
| 22 | `vite.config.ts` | 改动：登记 `useUploads.ts` / `useUploadPanel.ts` 的 80% 模块阈值；按实测上调全局地板（只上不下） | 约 200 → +≈ 10 |

**零变更**：`admin-backend` / `admin-frontend`（全部）、SSE 事件集合、`frontend/src/api/types.ts`（结构未变）、
两侧依赖清单（零新增）、`UploadMenu.vue` 的 props/emits（`open` / `spaces` / `uploads` / `pick` / `retry` / `close` 不变）。

## 结构决策（Structure Decision）

四侧一体 Web 应用；本特性**落在两侧**：`agent-backend`（落盘命名与端点拆分）+ `frontend`（面板接线、清空、回写）。
不新建目录、不新增分层——后端沿用 `routes → domain → infra`，前端沿用 `components → composables → api`：

```text
specs/012-upload-record-naming/          # 本特性文档（规范 → 计划 → 任务 + Phase 0/1 产出）
├── spec.md
├── plan.md                              # 本文件
├── research.md                          # Phase 0（R1~R6）
├── data-model.md                        # Phase 1（上传记录状态机 + 命名候选模型）
├── contracts/http-upload.md             # Phase 1（上传端点契约：命名 / 状态码 / 新错误码）
├── contracts/ui-contract.md             # Phase 1（面板接线 / 记录生命周期 / @ 回写契约）
├── quickstart.md                        # Phase 1（一键门禁 + 手工验收场景）
└── checklists/requirements.md

agent-backend/src/
├── routes/files-upload.ts               # 新增：上传端点（从 files.ts 搬入）
├── routes/files-scope.ts                # 新增：归属与目录解析（两处共用）
├── routes/files.ts                      # 改动：只保留列表/下载/预览/工作空间/删除/回源
└── domain/upload-name.ts                # 新增：命名唯一实现（候选名 + 排他占名）

frontend/src/
├── composables/useUploadPanel.ts        # 新增：上传面板接线（开关 / 清空 / 回写）
├── composables/useUploads.ts            # 改动：清空口径
├── composables/useWorkspace.ts          # 改动：registerFile（立即可引用）
├── composables/useChatPanel.ts          # 改动：改为装配 useUploadPanel（净减行数）
├── composables/useAppSession.ts         # 改动：切换数字人清空记录
├── utils/error-message.ts               # 改动：FILE_NAME_CONFLICT 文案
├── components/chat/UploadItem.vue       # 改动：仅头注释（展示名口径）
├── components/chat/UploadItem.spec.ts   # 新增：displayName = serverFilename（改动即补测）
└── api/files.ts                         # 改动：注释与契约对齐
```

**为什么命名算法进 `domain/` 而不是 `routes/`**：宪章原则二明确"接口层 MUST NOT 直接读写文件系统"。
旧代码把 `stampedName` 写在路由里属存量（不追溯），但**新写**的占名逻辑必须落在业务层；
`domain/upload-name.ts` 同时是"候选名规则"的唯一实现，可被 `tests/unit/upload-name.spec.ts` 纯逻辑钉住。

## 测试落点

| 模块 | 测试文件 | 覆盖重点 |
|---|---|---|
| `domain/upload-name.ts`（新） | `tests/unit/upload-name.spec.ts`（新） | 候选名表驱动（`报告.csv` / `报告(1).csv` / `报告(2).csv` / 稀疏取最小 / `a.tar(1).gz` / `README(1)` / `.env(1)` / 含 `/`·`\` 清洗 / 空主名兜底）；`claimName` 真实占名（临时目录）：不重名原名、连续三次 `(1)`·`(2)`、**已存在文件内容未被改写**、`maxAttempts=2` 触发 409、超长名截断或 400 |
| `routes/files-upload.ts`（新） | `tests/integration/files-scenario.spec.ts`（既有，补用例） | 201 响应 `filename` = 原名 / `(1)` / `(2)`；并发 3 个同名 `Promise.all` ⇒ 3 个不同文件名 + 目录内容互不相同；跨目录 / 跨数字人同名互不影响；历史时间戳文件并存；既有状态码与错误码用例**全部保持** |
| `composables/useUploads.ts` | `useUploads.spec.ts`（**新建**） | 预校验失败不发请求；逐文件独立状态；成功写入 `serverFilename`；失败保留 `error` + 可重试；批量失败 toast 计数；**`clear()` 只清终态**（1 成功 + 1 失败 + 1 上传中 ⇒ 只剩上传中）；`retry` 复用同一 `localId` |
| `composables/useUploadPanel.ts`（新） | `useUploadPanel.spec.ts`（新） | `toggle` 展开/收起；**收起调 `uploads.clear()`**；`close` 同口径；`pick` 把目录级白名单透传给 `upload`；成功项 ⇒ `acceptUpload({dir, filename})` **恰好一次**（重复渲染不重复回写）；失败项 ⇒ **零调用**；重试成功后同样回写一次；面板关闭后再成功的上传仍回写（`FR-013`）；**已达 10 个引用**时上传仍成功但不插入第 11 个并提示（`FR-006`）；批量 3 个 ⇒ 回写顺序 = 完成顺序、原文本逐字不变（`FR-005`）；清空后 `files.remove` 零调用、草稿与引用快照不变（`FR-011`）；删掉标记后清空不复活（`FR-007`） |
| `components/chat/UploadItem.vue` | `UploadItem.spec.ts`（**新增**） | 该组件本次被改动且此前无同名测试（011 `BaseIcon` 先例：改动即补）；`displayName` 取 `serverFilename`（含 `(1)` 后缀），回落原始名；四态文案与失败原因渲染不变（`FR-024`） |
| `composables/useWorkspace.ts` | `useWorkspace.spec.ts`（既有，补用例） | `registerFile` 后 `exists` 为真、`filesOf` 含该项；同 `{dir,filename}` 重复登记不重复；未知目录 no-op 且不抛错；既有 `uploadExtensionsOf` 用例不变 |
| `components/chat/UploadMenu.vue` | `UploadMenu.spec.ts`（既有，补用例） | 空列表 ⇒ 不渲染 `upload-menu__uploads`（`FR-015`）；有记录时按 `localId` 渲染 `UploadItem`；目录树与 `accept` 断言不变 |
| `composables/useChatPanel.ts` | `useChatPanel.nextSteps.spec.ts` / `.retry.spec.ts` / `ChatPanel.spec.ts` | 既有用例全绿即证明"导出面未变"（`uploadOpen` / 5 个动作名与签名保持）；不新增行为断言（行为已由 `useUploadPanel.spec.ts` 钉住） |
| `utils/error-message.ts` | 既有 `error-message.spec.ts` | 新码 → 中文文案；未知码回退口径不变 |

## 覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）共 20 个模块尚无测试，
其**补测顺序与范围** MUST 在下一个特性的 `plan.md` 给出结论；**MUST NOT** 发起存量补齐专项。
先例：`specs/002-conversation-runtime/plan.md` §4；`008` / `009` / `010` / `011` 已重申。

**本次结论**（**沿用**既有序，不重新排序、不扩大范围）：

| 项 | 结论 |
|---|---|
| 顺序与范围 | **沿用** `specs/002-conversation-runtime/plan.md` §4 的四段顺序（① 网络与契约边界 → ② 产出与预览链路 → ③ 会话与流式 → ④ 其余）；本次**不重新排序、不新增范围** |
| 机制 | **随改动触达即补**。本次触达 `useUploads.ts`（原 0%）⇒ 新建同名测试覆盖其**全部公开行为**（文件仅 170 行，成本可接受）；`useWorkspace.ts` 已有测试，只补 `registerFile` |
| 与"不追溯"的关系 | `useUploadPanel.ts` 属**本次创建的新文件** ⇒ 按原则三 MUST 有同名测试；`useUploads.spec.ts` 是**被改动文件**的同名测试补齐（治理 §"存量文件被改动时…"），**不是**为其余 20 个存量模块补测 |
| 逐文件 80% 清单 | 新增登记 **2** 个：`composables/useUploads.ts`、`composables/useUploadPanel.ts`（阈值均按宪章下限 80%，实测值写行末注释） |
| 不登记阈值的模块 | `useChatPanel.ts` / `useWorkspace.ts` / `UploadMenu.vue` / `useAppSession.ts` 属既有模块，本次只覆盖**新行为**；登记它们等于对其余函数发起存量补测专项（与 010 / 011 取舍同口径） |
| 地板 | 全局地板**只上不下**：按本次实测回写数值与日期 |

**缺口计数**：本次不改变"20 个未测模块"的总数（`useUploads.ts` 原本在列，本次补了测试，
但同时新增 `useUploadPanel.ts` 并**立即**配测试 ⇒ 净变化 0）。宪章待办条款的"缺口收敛"不在本特性目标内。

## 复杂度跟踪（Complexity Tracking）

> **无宪章违反项**。以下为已知限制 / 平台差异 / 被否决方案登记，供评审质询。

| 项 | 内容 |
|---|---|
| 已知限制①：数字人切换时"上传中"项的归属 | 按 `FR-013` 保留（不清空），但它的 `dir` 指向**原数字人**的数据域；界面按原值展示，不静默改挂（`FR-014`）。成功时该文件落在原数字人目录，`@` 标记仍写入当前输入区——若用户此时发送，后端会按**当前**数字人解析引用并不存在（`FILE_REF_NOT_FOUND`），前端既有"引用已不存在"提示会兜住。判定可接受：切换数字人本身即开始新对话（009），且场景罕见 |
| 已知限制②：`FR-027` 超长名的具体行为依赖文件系统 | 先按"保留 `(n)` 与扩展名"截断主名（单段名限 **200 字符**的保守值）；若目标 FS 仍拒绝，返回 400 并给中文原因。不同 FS 的实际上限（NTFS 255 字符 / ext4 255 字节）不在代码内区分——区分即等于维护第二套平台规则 |
| 被否决：`existsSync` 预检 + `renameSync` | TOCTOU 竞态：同批并发同名会互相覆盖（`FR-022` 的核心），也是本次要修的问题本身 |
| 被否决：进程内 Mutex / 锁表 | 仅单进程有效；多实例部署即失效，且需维护锁生命周期（原则五要的是**等价并发控制**，排他创建已足够） |
| 被否决：关闭面板时取消进行中的上传 | 需要 AbortController 贯穿 multipart 与暂存清理，且"已落盘一半"更难收场；`FR-013` 已定"不取消" |
| 被否决：每次上传成功都 `workspace.load()` | 批量 10 个文件 ⇒ 10 次全量请求，且会重置列表滚动位置；`registerFile` 就地登记更轻 |
| 既有技术债（仅登记，不扩散） | `routes/files.ts` 本次从 543 行拆分降到 ≈350（属"本次改动文件"的合规化，不是为存量债立项）；其余存量未测模块按上一节结论处理 |

## 平台差异登记（宪章原则三 · 涉及文件系统）

**结论：本特性涉及平台相关行为，处理方式是"不做平台判断、把判定交给目标文件系统"。**

| 差异点 | Windows（本地门禁） | Linux（交付容器） | 本特性的处理 |
|---|---|---|---|
| 文件名大小写 | 不敏感（`Report.csv` 与 `report.csv` 冲突） | 敏感（不冲突） | 以**排他创建是否 `EEXIST`** 为准，天然与所在 FS 语义一致（`FR-023`）；单测按 `process.platform` 分支断言，避免在大小写敏感平台误红 |
| 硬链接 | NTFS 支持 | ext4 / overlayfs 支持 | `linkSync` 失败（`EPERM` / `EXDEV` / `ENOTSUP` / `EMLINK`）回退 `copyFileSync(COPYFILE_EXCL)`，两条路径都必须"已存在即失败" |
| 单段名长 | 255 字符 | 255 字节 | 统一按 **200 字符** 保守截断，不区分平台（见「已知限制②」） |
| 非 ASCII 路径 | 既有 `fs-safe.ts` 的教训：`fs.rmSync` 在中文路径静默失效 | 正常 | 本特性**只用** `linkSync` / `copyFileSync` / `existsSync` / `readdirSync` / `statSync`，**MUST NOT** 使用 `rmSync`；暂存清理继续走 `removeFileSafe` |

**冒烟**：部署后按 `quickstart.md` 打一次上传（含同名二次上传），确认两次 201 且文件名分别为 `原名` / `原名(1).ext`。

## 门禁（宪章原则八；全部在本地执行）

```text
后端  : cd agent-backend
        npm run typecheck
        npm run lint
        npm run test              # tests/unit（含新增 upload-name.spec.ts）
        npm run test:integration  # 端点集成（含命名 / 并发 / 错误码）
        npm run build

前端  : cd frontend
        npm run lint
        npm run typecheck
        npm run test              # 全量单测（含新增 2 个 spec）
        npm run test:coverage     # useUploads / useUploadPanel ≥ 80% + 全局地板
        npm run build

行数  : [System.IO.File]::ReadAllLines(<file>).Length   # 每个改动/新增文件 ≤ 500
```

## 验收

见 [spec.md](./spec.md) §「成功标准」（`SC-001`~`SC-008`）与 [quickstart.md](./quickstart.md)（手工场景 1~14）；
任务与勾选状态见 `tasks.md`（`/speckit.tasks` 产出，**不由本命令创建**）。

`/speckit.analyze` 重点核对：① 命名规则是否只有 `domain/upload-name.ts` 一处；② 清空是否只有 `uploads.clear()` 一处口径；
③ `@` 拼写是否仍只在 `mentionToken`；④ 新错误码的"四处同步"是否齐备。

## 需回写的上游条文（本轮复核）

| # | 落点 | 动作 | 理由 |
|---|---|---|---|
| 1 | `specs/002-conversation-runtime/plan.md` §4（覆盖率补测顺序） | **无需回写** | 本特性沿用该顺序，未重新排序也未扩大范围 |
| 2 | 代码注释反复引用的 `contracts/backend-api.md`（上传契约 §5.1） | **登记为上游缺口（本次不补写全局文件）** | 复核 `specs/**`：该文件**不存在**（仅 `011` 有 `contracts/ui-contract.md`）。本特性在自己的 `contracts/http-upload.md` 里给出**上传端点**的权威记录（命名 / 状态码 / 新错误码），不冒充"补齐全局契约文档"（治理 § 不追溯） |
| 3 | `spec.md` `FR-040`（"契约文档无需改动"） | **回写一处** | 实现引入一个新错误码 `FILE_NAME_CONFLICT`，属契约增量（响应结构不变）。已在 `spec.md` 的 `FR-040` 补口径并在「修订记录」登记 |
| 4 | `.specify/memory/constitution.md` | **无需修订** | 未新增或重定义原则；本次拆分与原子占名是对原则二 / 五 / 九的遵从 |

## 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-18 | 初稿 | `/speckit.plan`：技术上下文（零新增依赖、两侧同改、平台差异已登记）、宪章九条逐条核对（Phase 0 前 + Phase 1 后一致）、`D1`~`D7` 技术决策（含被否决替代）、文件级影响面清单（20 项，实测行数）、结构决策（`files.ts` 543 行拆分）、测试落点、覆盖率缺口处置结论（沿用常设口径 + 新增 2 个模块阈值）、复杂度跟踪（2 项已知限制 + 4 项被否决）、门禁与验收路径 |
| 2026-10-18 | 分析回写（`/speckit.analyze`） | 三处修正，行为口径未变：① 影响面清单补两项——`src/utils/error-message.spec.ts`（新码文案证据，四处同步第 ② 处）与 `src/components/chat/UploadItem.spec.ts`（**新增**同名测试：该组件本次被改动但此前无测试，按 011 `BaseIcon` 先例"改动即补"）；② `Scale/Scope` 文件数 16 → **21**（原数与清单实际行数不符，本次据清单重算）；③ 测试落点补 `UploadItem` 行，并把 `useUploadPanel` 行的覆盖重点补齐 `FR-005` / `FR-006` / `FR-007` / `FR-011`（分析报告 F5/F8/F9/F11/F13 的落点） |
