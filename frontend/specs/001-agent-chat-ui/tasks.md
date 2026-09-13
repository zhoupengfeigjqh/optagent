---
description: "Task list for feature implementation"
---

# Tasks: Agent 前端交互页面

**Input**: Design documents from `/specs/001-agent-chat-ui/`
**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: **本功能要求测试**——宪章原则三（测试完备性，NON-NEGOTIABLE）与 `plan.md` 测试策略规定：组件与其测试文件**同目录一一对应**（`Xxx.vue` ↔ `Xxx.spec.ts`），`src/api`、`src/composables`、`src/utils` 覆盖率 **≥ 80%**。因此每个实现任务**自带其单元测试文件**；跨模块流程由 `tests/integration/` 承担。每个 `*.spec.ts` MUST 覆盖**三类场景**：props 传递、事件触发、边界条件（空值 / 禁用态 / 超限 / 失败态）；逐模块必测断言清单见 `quickstart.md` §五，`data-model.md` §四的 15 条验证规则为可测试断言的来源。

**Organization**: 任务按用户故事分组，每个故事可独立实现、独立测试、独立交付为增量。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其他 `[P]` 任务并行执行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事（US1–US8），仅用户故事阶段使用
- 每个任务均含**精确文件路径**

## Path Conventions

- 仓库根为 `frontend/`（本目录），源码在 `src/`，跨模块集成测试在 `tests/integration/`
- 组件与其测试**同目录**；composable / 纯函数与其测试**同目录**
- 后端接口路径统一 `/api` 前缀，开发期经 Vite 代理转发（`contracts/backend-api.md`）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 项目初始化与目录骨架

- [X] T001 初始化项目脚手架：创建 `package.json`（依赖 `vue@^3.5`、`vite@^8`、`@vitejs/plugin-vue`、`typescript@^6`、`vue-tsc`、`vitest`、`@vue/test-utils`、`jsdom`、`@vitest/coverage-v8`、`eslint` + `eslint-plugin-vue` + `typescript-eslint`、`prettier`；scripts：`dev` / `build` / `preview` / `test` / `test:coverage` / `lint` / `typecheck`）、`index.html`、`src/main.ts`，并建立目录骨架 `src/{api,composables,components/{layout,chat,common},utils,constants,styles}`、`tests/integration`
- [X] T002 [P] 配置 TypeScript：`tsconfig.json`（引用 `tsconfig.app.json` / `tsconfig.node.json`）、`tsconfig.app.json`（`strict`、`@/*` 路径别名）、`tsconfig.node.json`
- [X] T003 [P] 配置 Vite：`vite.config.ts`（`@vitejs/plugin-vue`、`server.proxy['/api'] → http://localhost:3000`、`@` 别名、Vitest `environment: 'jsdom'` 与 `coverage-v8` 阈值 80%）
- [X] T004 [P] 配置代码规范：`eslint.config.js`（扁平配置 + `eslint-plugin-vue` + `typescript-eslint` + `eslint-config-prettier`）、`.prettierrc.json`、`.gitignore`
- [X] T005 [P] 建立设计令牌与基线样式：`src/styles/tokens.css`（颜色/间距/字号/动效时长 CSS 自定义属性，含 `prefers-reduced-motion` 降级）、`src/styles/base.css`（重置与全局基线）
- [X] T006 [P] 创建环境变量样例：`.env.example`（`VITE_API_BASE_URL`）

**Checkpoint**: `npm run dev` 可启动空壳应用，`npm run test` 可运行（0 用例）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有用户故事共同依赖的常量、类型、网络层、纯函数、基础 composable、通用组件与三栏骨架

**⚠️ CRITICAL**: 本阶段完成前，任何用户故事都无法开始

### 常量与契约类型

- [X] T007 [P] 定义空间目录白名单唯一来源 `src/constants/directories.ts` 与其测试 `src/constants/directories.spec.ts`（恒为 9 个：7 业务 + `shared` + `tmp`；断言三处引用同一常量，V-01）
- [X] T008 [P] 定义全局限制与事件常量 `src/constants/limits.ts`（50MB、单条引用 10、历史 10/100、详情 50/200、预览上限）、`src/constants/events.ts`（SSE 事件名与状态机常量）
- [X] T009 [P] 定义后端契约类型 `src/api/types.ts`（与 `contracts/backend-api.md` 一一对应：请求/响应体、统一错误体、`Message`、`Usage`、`ErrorInfo`、`Feedback`、SSE 事件联合类型；**不得包含**思考内容与工具调用字段，V-04）

### 纯函数（`src/utils/`）

- [X] T010 [P] 实现 `src/utils/sse-parser.ts` + `src/utils/sse-parser.spec.ts`（跨 chunk 行缓冲、多事件同 chunk、`\n\n` 分隔、忽略注释行、不完整尾部保留在 `rest`）
- [X] T011 [P] 实现 `src/utils/segments.ts` + `src/utils/segments.spec.ts`（纯文本/链接/高亮分段，分段可拼接还原原文；链接识别边界：结尾标点、括号；高亮与链接叠加；空输入）
- [X] T012 [P] 实现 `src/utils/format.ts` + `src/utils/format.spec.ts`（token、耗时**统一 1 位小数**、时间、文件大小格式化）
- [X] T013 [P] 实现 `src/utils/file-kind.ts` + `src/utils/file-kind.spec.ts`（扩展名 → `inline-text` / `pdf` / `download` 分派；未知扩展名 → `unsupported`；大小写不敏感）
- [X] T014 [P] 实现 `src/utils/error-message.ts` + `src/utils/error-message.spec.ts`（每个已知错误码 → 中文文案；未知码兜底并保留原码，V-12）

### 网络层（`src/api/`，薄封装、无业务逻辑）

- [X] T015 实现 `src/api/http.ts` + `src/api/http.spec.ts`（BaseURL、JSON 编解码、统一错误对象 `{code, message, details}`、非 2xx 抛出结构化错误）
- [X] T016 [P] 实现 `src/api/sse.ts` + `src/api/sse.spec.ts`（POST 流式请求 + `fetch` + `ReadableStream` 读取，经 `src/utils/sse-parser.ts` 解析；断连仅退订、不自动重连）
- [X] T017 [P] 实现 `src/api/agents.ts`（列表、详情、`select`、`exit`、`current`、`current/mcp`）
- [X] T018 [P] 实现 `src/api/threads.ts`（创建、列表、详情、重命名、删除、反馈、中断）
- [X] T019 [P] 实现 `src/api/messages.ts`（发消息流式请求；请求体构造 `content` / `thinking` / `model` / `attachments`）
- [X] T020 [P] 实现 `src/api/files.ts`（上传、列表、下载、预览、工作空间）
- [X] T021 [P] 实现 `src/api/models.ts`（模型列表）

### 基础 composable

- [X] T022 [P] 实现 `src/composables/useToast.ts` + `src/composables/useToast.spec.ts`（轻量提示队列、`aria-live` 播报、自动消失）
- [X] T023 [P] 实现 `src/composables/useAppSession.ts` + `src/composables/useAppSession.spec.ts`（`provide/inject` 注入键与共享上下文：当前会话、当前数字人、预览目标）

### 通用组件（`src/components/common/`）

- [X] T024 [P] 实现 `src/components/common/BaseIcon.vue` + `BaseIcon.spec.ts`（内联 SVG，不引入图标库）
- [X] T025 [P] 实现 `src/components/common/BaseButton.vue` + `BaseButton.spec.ts`（禁用态、加载态、键盘可达）
- [X] T026 [P] 实现 `src/components/common/BaseDialog.vue` + `BaseDialog.spec.ts`（封装原生 `<dialog>`，自带焦点陷阱与 Esc 关闭）
- [X] T027 [P] 实现 `src/components/common/BaseDropdown.vue` + `BaseDropdown.spec.ts`（键盘可达下拉，roving tabindex、方向键与 Home/End）
- [X] T028 [P] 实现 `src/components/common/EmptyState.vue` + `EmptyState.spec.ts`
- [X] T029 [P] 实现 `src/components/common/LoadingDots.vue` + `LoadingDots.spec.ts`
- [X] T030 [P] 实现 `src/components/common/ErrorNotice.vue` + `ErrorNotice.spec.ts`（错误码 → 中文文案 + 重试入口）
- [X] T031 [P] 实现 `src/components/common/ToastHost.vue` + `ToastHost.spec.ts`（`aria-live` 宿主）

### 应用骨架

- [X] T032 实现 `src/components/layout/AppShell.vue` + `AppShell.spec.ts`（三栏骨架：左历史栏 / 中聊天区 / 右预览区约占 1/3 宽；无预览内容时右侧占位或收起；中栏预留 `#history` / `#chat` / `#preview` 插槽）
- [X] T033 实现 `src/App.vue` + `src/App.spec.ts`（装配 `AppShell` + `ToastHost`，调用 `useAppSession` 完成 `provide` 注入；断言三栏骨架与 Toast 宿主均已渲染、注入上下文可被后代组件取用）

**Checkpoint**: 三栏空壳可渲染，网络层与纯函数测试全绿——用户故事可开始

---

## Phase 3: User Story 1 - 发起并完成一轮对话 (P1) 🎯 MVP

**Goal**: 居中入口 → 发送后聊天区展开、入口下移 → 流式回复（思考可折叠、工具仅展示名称且结束即消失）→ 进行中发送按钮置灰、可中断本轮

**Independent Test**: 进入页面 → 在居中入口发送一条消息 → 聊天区展开且入口下移 → 出现"思考中" → 发送按钮置灰 → 回复完成后思考内容默认折叠且可展开；重新加载会话后无思考与工具信息

- [X] T034 [P] [US1] 实现 `src/composables/useChatStream.ts` + `useChatStream.spec.ts`（6 类事件状态机：`thinking` / `content` / `tool_call` / `tool_call_end` / `done` / `error`；`tool_call` 增、`tool_call_end` 删，V-05；`done.message_id === null` → `aborted`；断连 → `failed` 且提供 `recover()`；`phase === 'streaming'` 时导出禁用标志，V-06）
- [X] T035 [P] [US1] 实现 `src/components/chat/TypingIndicator.vue` + `TypingIndicator.spec.ts`（持续旋转的"思考中"提示，`prefers-reduced-motion` 降级）
- [X] T036 [P] [US1] 实现 `src/components/chat/ToolCallBadge.vue` + `ToolCallBadge.spec.ts`（仅展示工具名与进行/结束状态，**0 入参、0 结果**，FR-005 / SC-011）
- [X] T037 [P] [US1] 实现 `src/components/chat/ThinkingBlock.vue` + `ThinkingBlock.spec.ts`（基于原生 `<details>`，默认折叠、可展开收起；快速模式不渲染）
- [X] T038 [P] [US1] 实现 `src/components/chat/MessageContent.vue` + `MessageContent.spec.ts`（调用 `utils/segments.ts` 分段渲染；派生结果 `computed` 缓存，禁止模板内计算）
- [X] T039 [US1] 实现 `src/components/chat/MessageBubble.vue` + `MessageBubble.spec.ts`（装配 `MessageContent` / `ThinkingBlock` / `ToolCallBadge`；流式期间渲染 `TypingIndicator`；`role` 分支；失败/超时经 `ErrorNotice` 渲染错误码中文文案与重试入口，FR-049）
- [X] T040 [US1] 实现 `src/components/chat/MessageList.vue` + `MessageList.spec.ts`（空态 + **居中对话入口**（FR-003）→ 有消息后入口下移（FR-004）；滚动加载更早消息 `offset += limit` 并前插；`v-memo`/稳定 `key`）
- [X] T041 [US1] 实现 `src/components/chat/Composer.vue` + `Composer.spec.ts`（`<textarea>` + 发送/中断按钮；`phase === 'streaming'` 时发送置灰、展示"中断本轮"（FR-006/007）；预留 `toolbar` 与 `mention` 插槽供 US3/US4 接入）
- [X] T042 [US1] 实现 `src/components/chat/ChatPanel.vue` + `ChatPanel.spec.ts`（装配 `MessageList` + `Composer`，接入 `useChatStream`；流式断连（`failed`）时经 `ErrorNotice` 提示并提供"重新获取会话历史"操作，恢复后展示本轮最终结果，FR-050 / SC-020；头部位置预留给 US6 的 `ChatHeader`）
- [X] T043 [US1] 编写跨模块集成测试 `tests/integration/chat-flow.spec.ts`（发送 → 流式事件序列 → 完成 → 消息落定；以可控 `ReadableStream` 桩驱动 SSE）

**Checkpoint**: US1 可独立验证——核心对话闭环成立，即为 MVP

---

## Phase 4: User Story 2 - 消息级操作与用量反馈 (P1)

**Goal**: 每轮完成后消息下方提供复制/点赞/点踩与 token、耗时；重复点击同一反馈即取消

**Independent Test**: 完成一轮对话 → 消息下方出现复制/点赞/点踩与 token、耗时 → 分别点击验证行为与选中状态 → 再次点击同一反馈验证取消

- [X] T044 [P] [US2] 实现 `src/components/chat/MessageActions.vue` + `MessageActions.spec.ts`（复制（含成功反馈）、点赞、点踩、输入/输出 token、耗时；互斥选中态，V-08）
- [X] T045 [US2] 在 `src/components/chat/MessageBubble.vue` 接入 `MessageActions`（仅 `completed` 且存在 `id` 的消息展示；流式/中断/未落盘一律不展示，V-07 / FR-028）
- [X] T046 [US2] 在 `src/composables/useChatStream.ts` 实现反馈提交的乐观更新与失败回滚（同值重复提交 = 取消，提交 `null`；更新 `useChatStream.spec.ts` 断言，FR-027）

**Checkpoint**: US1 + US2 构成完整 P1 范围，可交付演示

---

## Phase 5: User Story 3 - 输入区工具选项 (P2)

**Goal**: 输入区最左侧加号（9 目录上传）、右二模型选择、最右侧思考/快速切换；上传失败提示原因并提醒重试

**Independent Test**: 打开输入区 → 加号展开全部 9 个上传入口 → 上传失败提示与重试 → 切换思考/快速 → 选择模型并验证当前模型展示

- [X] T047 [P] [US3] 实现 `src/composables/useModels.ts` + `useModels.spec.ts`（模型列表拉取、默认模型标识、当前选择存 `sessionStorage` 键 `optagent.model`、缓存值失效回退默认）
- [X] T048 [P] [US3] 实现 `src/composables/useUploads.ts` + `useUploads.spec.ts`（扩展名与 50MB 预校验、不合规**不发请求**；多选时**逐文件各发一次请求**并各自独立状态与重试，V-13；失败项保留原因）
- [X] T049 [P] [US3] 实现 `src/components/chat/ThinkingToggle.vue` + `ThinkingToggle.spec.ts`（"思考"/"快速"切换，当前模式清晰可见，FR-012）
- [X] T050 [P] [US3] 实现 `src/components/chat/ModelPicker.vue` + `ModelPicker.spec.ts`（模型列表 + 默认标识，选中后按钮显示新模型，FR-013）
- [X] T051 [P] [US3] 实现 `src/components/chat/UploadItem.vue` + `UploadItem.spec.ts`（单文件上传状态：进行中/成功/失败原因/重试，FR-011）
- [X] T052 [US3] 实现 `src/components/chat/UploadMenu.vue` + `UploadMenu.spec.ts`（加号触发，展示全部 **9 个**空间目录入口，目录集合取自 `constants/directories.ts`，FR-009 / SC-021）
- [X] T053 [US3] 实现 `src/components/chat/ComposerToolbar.vue` + `ComposerToolbar.spec.ts`（左侧加号、右二模型、右侧思考开关、发送/中断按钮的布局与事件聚合）
- [X] T054 [US3] 在 `src/components/chat/Composer.vue` 接入 `ComposerToolbar`（经 T041 预留的 `toolbar` 插槽；实际由装配层 `ChatPanel` 填充该插槽，`Composer` 保持纯受控组件）

**Checkpoint**: US3 可独立验证——上传、模型、思考三组选项可用

---

## Phase 6: User Story 4 - 输入 @ 引用空间文件 (P2)

**Goal**: 输入"@"展示 9 个空间目录 → 选择文件 → 输入框插入"@文件名"，实际以 `{dir, filename}` 结构化提交（≤10）

**Independent Test**: 上传文件 → 输入"@" → 展示 9 个文件夹 → 展开并选择文件 → 插入"@文件名" → 发送时携带真实目录 + 文件名

- [X] T055 [P] [US4] 实现 `src/composables/useFileMention.ts` + `useFileMention.spec.ts`（`@` 触发与删除触发符即关闭；目录/文件选择；10 个上限阻止并提示，V-02；引用移除；**发送前校验引用文件存在性，不存在则提示且不发送，V-15 / FR-018**；`buildAttachments()` 输出 `{dir, filename}[]`，FR-016）
- [X] T056 [US4] 实现 `src/components/chat/MentionPicker.vue` + `MentionPicker.spec.ts`（9 个目录列表（同 `constants/directories.ts`）、展开显示文件、空目录空态提示、键盘可达，FR-014/019 / SC-016）
- [X] T057 [US4] 在 `src/components/chat/Composer.vue` 接入 `@` 触发与 `MentionPicker`（经 T041 预留的 `mention` 插槽；插入"@文件名"文本，提交时替换为结构化引用）——插槽同样由装配层 `ChatPanel` 填充；`Composer` 仅新增 `input-text` / `mention-key` 事件出口与 `mentionOpen` 属性
- [X] T058 [US4] 编写跨模块集成测试 `tests/integration/upload-and-mention.spec.ts`（上传 → `@` 引用 → 发送载荷断言：`content` 去引用正文 + `attachments` 结构正确）

**Checkpoint**: US4 可独立验证——@ 引用闭环成立

---

## Phase 7: User Story 5 - 历史会话与新建会话 (P2)

**Goal**: 左栏默认最近 10 条（按更新时间倒序），"更多"查看最近 100 次；上方新建会话

**Independent Test**: 打开页面 → 默认 10 条 → 点击切换 → 点击"更多"查看 100 次 → 点击新建弹出空白会话

- [X] T059 [P] [US5] 实现 `src/composables/useThreads.ts` + `useThreads.spec.ts`（**一次性拉取全部并在前端切片** 10 → 100，请求 URL **不含** `limit`/`offset`，V-09；`updated_at` 倒序；`title === null` → "新会话"；新建会话 409/404 错误码文案映射，5xx/网络异常 → "系统繁忙"文案，FR-042；`running` 映射）
- [X] T060 [P] [US5] 实现 `src/components/layout/HistoryItem.vue` + `HistoryItem.spec.ts`（标题、时间、选中态、键盘可达）
- [X] T061 [US5] 实现 `src/components/layout/HistorySidebar.vue` + `HistorySidebar.spec.ts`（默认 10 条 + "更多"切 100 条（FR-039/040）、新建入口（FR-041/042）、空态且新建仍可用（FR-043））
- [X] T062 [US5] 在 `src/components/layout/AppShell.vue` 接入 `HistorySidebar`（经 T032 预留的 `#history` 插槽；插槽由 `App.vue` 填充，并在此完成首屏 `loadList()` 与 `select`/`create`/`more` 编排）

**Checkpoint**: US5 可独立验证——会话浏览与新建可用

---

## Phase 8: User Story 6 - 数字人信息与切换 (P2)

**Goal**: 聊天区正上方展示数字人名称与 MCP 服务状态（红=失败/绿=正常）；右上角按钮查看明细与切换；进行中禁止切换

**Independent Test**: 打开聊天区 → 名称与 MCP 状态展示 → 会话进行中切换按钮置灰 → 无进行中时切换并在下一轮生效

- [X] T063 [P] [US6] 实现 `src/composables/useAgents.ts` + `useAgents.spec.ts`（未选定 → 空状态与"请选择数字人"；`switchTo` 严格按 **先 `exit` 再 `select`** 顺序；`phase === 'streaming'` 时**不发**切换请求，V-14；MCP 状态轮询 ≤5s 与 `done`/`error` 后刷新）
- [X] T064 [P] [US6] 实现 `src/components/chat/McpStatusItem.vue` + `McpStatusItem.spec.ts`（红/绿 + 文本**双通道**标识，FR-033；失败不弹窗不阻断，FR-038）
- [X] T065 [P] [US6] 实现 `src/components/chat/AgentSummary.vue` + `AgentSummary.spec.ts`（数字人名称 + MCP 服务列表；未选定 → 提示且列表为空，FR-032）
- [X] T066 [US6] 实现 `src/components/chat/AgentPanel.vue` + `AgentPanel.spec.ts`（基于 `BaseDialog`；展示描述/技能/已启用工具/MCP 服务；切换入口在进行中置灰，FR-035/036/037；**增补**：候选名称可点击**只读预览**其他数字人明细——数据取自已加载的 `candidates`，不额外发请求、不触发切换，预览不受"会话进行中"限制）
- [X] T067 [US6] 实现 `src/components/chat/ChatHeader.vue` + `ChatHeader.spec.ts`（`AgentSummary` + 右上角按钮位（搜索/工作空间/数字人，后两者在 US8 接入））
- [X] T068 [US6] 在 `src/components/chat/ChatPanel.vue` 接入 `ChatHeader`（替换 T042 的头部占位；并在此完成 `loadCurrent` / `startMcpPolling` / 数字人面板开关编排）
- [X] T069 [US6] 编写跨模块集成测试 `tests/integration/agent-switch.spec.ts`（进行中禁用切换 → 结束后可切换 → `exit` 先于 `select`）

**Checkpoint**: US6 可独立验证——数字人与 MCP 可观测、可切换

---

## Phase 9: User Story 7 - 内容跳转与右侧预览 (P3)

**Goal**: 外部地址直接跳转；空间目录（含 `tmp`）文件在右侧约 1/3 宽预览区内联展示

**Independent Test**: 点击外部地址直接跳转 → 点击空间目录文件右侧内联渲染 → 无跳转内容时占位

- [X] T070 [P] [US7] 实现 `src/composables/usePreview.ts` + `usePreview.spec.ts`（外链**不改** `target` 直接跳转，V-10；`.xlsx` → `download` 回退，V-11；`413` → 文件过大并引导下载、`404` → 文件不存在；文本类按需 `fetch`）
- [X] T071 [US7] 实现 `src/components/layout/WorkspacePanel.vue` + `WorkspacePanel.spec.ts`（右栏唯一面板，列表态与内容态互换：内容态内联渲染 `<pre>` 文本/CSV/JSON、`<iframe>` PDF、`.xlsx` 回退下载；占位/收起态；错误态含下载按钮；删除二次确认；列表态内嵌 `WorkspaceFileTree`，FR-046/047/048）
- [X] T072 [US7] 在 `src/components/layout/AppShell.vue` 接入 `WorkspacePanel`（经 `#preview` 插槽），并在 `src/components/chat/MessageContent.vue` 接入可点击跳转（外部地址 → 新窗口；空间目录文件 → 内容态）——插槽由 `App.vue` 填充并联动 `previewOpen`；`open-link` 经 `MessageBubble` → `MessageList` → `ChatPanel` 透传至 `usePreview`，`@文件名` 引用新增 `open-file` 入口

**Checkpoint**: US7 可独立验证——跳转与预览闭环成立

---

## Phase 10: User Story 8 - 会话内容搜索与工作空间文件 (P3)

**Goal**: 会话内搜索（黄色高亮、逐次跳转、末尾循环）；工作空间文件按目录查看

**Independent Test**: 输入关键词验证黄色高亮与首次定位 → 再次点击跳转下一个 → 到末尾循环回首项 → 打开工作空间验证文件列表

- [X] T073 [P] [US8] 实现 `src/composables/useSessionSearch.ts` + `useSessionSearch.spec.ts`（匹配集合与 `total`；`next()` 循环定位；空关键词；命中大量结果时的定位策略）
- [X] T074 [P] [US8] 实现 `src/composables/useWorkspace.ts` + `useWorkspace.spec.ts`（拉取全部 **9 个**目录的文件清单，空目录为 `[]`，FR-031）
- [X] T075 [US8] 实现 `src/components/chat/SessionSearch.vue` + `SessionSearch.spec.ts`（黄色高亮（经 `utils/segments.ts`）+ 逐次跳转按钮 + 无结果提示，FR-029/030 / SC-009）
- [X] T076 [US8] 实现 `src/components/layout/WorkspaceFileTree.vue` + `WorkspaceFileTree.spec.ts`（按 `constants/directories.ts` 的 9 个目录分组展示文件、默认全部收起、展开空目录空态；`shared` 只读不渲染删除入口；纯展示，仅上报 `preview` / `download` / `remove` 意图）
- [X] T077 [US8] 在 `src/components/chat/ChatHeader.vue` 接入 `SessionSearch` 与文件空间入口（完成 T067 预留的按钮位）——`ChatHeader` 仅保留按钮与开关状态，`SessionSearch` 由装配层 `ChatPanel` 渲染并接入 `useSessionSearch`；文件空间面板 `WorkspacePanel`（内嵌 `WorkspaceFileTree`）由 `App.vue` 经 `#preview` 插槽装配，接入 `useWorkspace` / `usePreview`

**Checkpoint**: US8 可独立验证——搜索与工作空间可用

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事的横切质量约束与验收

- [X] T078 无障碍**收尾复核**（范围 `src/components/**/*.vue` 与 `src/styles/*.css`）：全部交互控件键盘可达、焦点可见、顺序合理；`<dialog>` / `<details>` 原生语义与 WAI-ARIA 角色状态齐备（FR-051、SC-007）。本任务仅为**跨故事复核**——组件级的键盘导航与 WAI-ARIA 验证 MUST 已在各故事任务内完成（见「Within Each User Story」）
- [X] T079 性能核查（重点 `src/components/chat/MessageList.vue`、`src/components/chat/MessageContent.vue`、`src/composables/useChatStream.ts`）：流式增量帧内合并刷新、长列表 `v-memo`/稳定 `key`、派生结果一律 `computed` 缓存、渲染路径无昂贵计算；单组件首渲 ≤100ms（宪章原则五、FR-052）
- [X] T080 覆盖率门禁核查：`src/api`、`src/composables`、`src/utils` ≥ 80%，补齐缺口用例（`npm run test:coverage`，阈值配置见 `vite.config.ts`）
- [X] T081 单文件 ≤500 行核查（范围 `src/**/*.{vue,ts}`）：对超限文件按子组件、`useXxx`、纯函数三种方式拆分（宪章原则二）
- [X] T082 执行 `specs/001-agent-chat-ui/quickstart.md` §四 的 S1–S14 端到端场景，逐项记录结果与偏差
- [X] T083 执行 `specs/001-agent-chat-ui/quickstart.md` §六 的 13 项后端契约一致性核对清单，逐项勾选；出现不一致时同步修订 `specs/001-agent-chat-ui/contracts/backend-api.md`（注意 §7 差异 1–6 的既定口径）
- [X] T084 全量门禁（`package.json` scripts）：`npm run lint`、`npm run typecheck`、`npm run test:coverage`、`npm run build` 全部通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成；**阻塞全部用户故事**
- **User Stories (Phase 3–10)**: 全部依赖 Foundational 完成
- **Polish (Phase 11)**: 依赖所选交付范围内的用户故事完成

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬─→ US2 ──→（US1+US2 = 完整 P1）
                            ├─→ US3 ──→ US4
                            ├─→ US5
                            ├─→ US6 ──→ US8（复用 ChatHeader）
                            └─→ US7（复用 MessageContent 跳转）
```

- **US1 (P1)**: Foundational 后即可开始，**无其他故事依赖** → MVP
- **US2 (P1)**: 依赖 US1（需有已落盘消息才能操作）
- **US3 (P2)**: 依赖 US1（输入区存在）；与 US2/US5/US6 无依赖
- **US4 (P2)**: 依赖 US3（`@` 面板需展示已上传文件）与 US1
- **US5 (P2)**: 依赖 US1（需能产生会话）
- **US6 (P2)**: 依赖 US1（需 `ChatPanel` 容器）
- **US7 (P3)**: 依赖 US1（需消息中的可跳转内容）
- **US8 (P3)**: 依赖 US6（复用 `ChatHeader` 按钮位）与 US1
- **同文件串行约束**: T062（US5）与 T072（US7）均修改 `src/components/layout/AppShell.vue`，MUST 串行执行、不得并行

### Within Each User Story

- composable 与纯函数先于消费它的组件
- 叶子组件（`TypingIndicator` / `ToolCallBadge` / `ThinkingBlock` / `MessageContent`）先于容器组件（`MessageBubble` → `MessageList` → `ChatPanel`）
- 单元测试与实现同文件任务内完成；跨模块集成测试在故事末尾
- **无障碍随组件同步验证**：本故事新增/变更的每个组件 MUST 在其任务内完成键盘导航与 WAI-ARIA 验证（宪章原则四），并在故事 Checkpoint 前复核；T078 仅作跨故事收尾复核

### Parallel Opportunities

- Phase 1 中 T002–T006 全部 `[P]`，可并行
- Phase 2 中 T007–T031 除 T015 外全部 `[P]`（T015 是 T016–T021 的前置），可大规模并行
- Phase 3 中 T034–T038 全部 `[P]`（5 个独立文件），T039–T042 串行（逐层装配）
- 各故事阶段内的 `[P]` 任务（如 T047–T051、T059–T060、T063–T065、T073–T074）可并行
- Foundational 完成后，US1 可立即开始；US3/US5/US6 在 US1 完成骨架后可并行推进

---

## Parallel Example: User Story 1

```bash
# US1 的 5 个独立叶子任务可并行：
Task: "实现 src/composables/useChatStream.ts + useChatStream.spec.ts"
Task: "实现 src/components/chat/TypingIndicator.vue + TypingIndicator.spec.ts"
Task: "实现 src/components/chat/ToolCallBadge.vue + ToolCallBadge.spec.ts"
Task: "实现 src/components/chat/ThinkingBlock.vue + ThinkingBlock.spec.ts"
Task: "实现 src/components/chat/MessageContent.vue + MessageContent.spec.ts"

# 随后按装配顺序串行：
MessageBubble (T039) → MessageList (T040) → Composer (T041) → ChatPanel (T042) → 集成测试 (T043)
```

## Parallel Example: Foundational

```bash
# 常量、类型、纯函数、通用组件可全部并行（不同文件、无相互依赖）：
Task: "实现 src/constants/directories.ts + spec"
Task: "实现 src/api/types.ts"
Task: "实现 src/utils/sse-parser.ts + spec"
Task: "实现 src/utils/segments.ts + spec"
Task: "实现 src/utils/error-message.ts + spec"
Task: "实现 src/components/common/BaseButton.vue + spec"
Task: "实现 src/components/common/BaseDialog.vue + spec"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（**关键**——阻塞全部故事）
3. 完成 Phase 3: US1
4. **停止并验证**：按 US1 的 Independent Test 独立验证
5. 可交付演示（核心对话闭环）

### 完整 P1 增量

1. Setup + Foundational → 基础就绪
2. US1 → 独立验证 → 交付（MVP）
3. US2 → 独立验证 → 交付（P1 范围完整：对话 + 消息操作与用量）

### 增量交付（按优先级）

1. US1 + US2（P1）→ 核心可用产品
2. US3 + US4 + US5 + US6（P2）→ 工具选项、@ 引用、历史会话、数字人
3. US7 + US8（P3）→ 预览与搜索增强
4. 每个故事独立验证后再进入下一个，不破坏既有故事

### Parallel Team Strategy

1. 团队共同完成 Setup + Foundational
2. Foundational 完成后：A 负责 US1 → US2；B 负责 US3 → US4；C 负责 US5 / US6；D 负责 US7 / US8
3. 注意 US2/US4/US8 对前置故事的依赖，按依赖图推进

---

## Notes

- `[P]` 任务 = 不同文件、无未完成依赖
- `[Story]` 标签用于把任务追溯到具体用户故事，便于独立验收
- 每个用户故事都应能独立完成与独立测试
- **测试与实现同一任务内交付**（组件与测试文件同目录一一对应），跨模块流程由 `tests/integration/` 承担
- 提交建议：每个任务或逻辑任务组完成后提交一次
- 任意 Checkpoint 都可停下来独立验证故事
- 避免：模糊任务、同文件冲突、破坏故事独立性的跨故事依赖
- **实现时以后端源码为准**：接口口径以 `contracts/backend-api.md` 为唯一依据，其 §7 已列明 6 处后端文档与源码不一致及应对方式（含文档行号 / 源码行号）
