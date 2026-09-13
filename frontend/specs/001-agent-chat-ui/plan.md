# 实施计划：Agent 前端交互页面

**功能分支**: `001-agent-chat-ui` | **日期**: 2026-09-10 | **规范**: [spec.md](spec.md)

**输入**: 功能规范 `specs/001-agent-chat-ui/spec.md`

**后端核对**: 本计划已对照后端源码逐文件核对（`agent-backend/src/routes/{agents,chat,threads,files,feedback,models}.ts`、
`src/domain/{dirs,thread-store,run-manager,current-agent,file-access,agent-pool}.ts`、`src/{server,types,config}.ts`、
`src/infra/agent-loop.ts`），接口契约见 [contracts/backend-api.md](contracts/backend-api.md)，
其中 §7 记录 6 处**后端文档与源码不一致**及应对口径（含文档行号 / 源码行号）。

**技术栈约束（用户指定）**: Vue 3 + Vite + TypeScript；组件采用 Composition API；样式采用 Scoped CSS；
优先使用 Vue 3 原生能力；单元测试用 Vitest + Vue Test Utils；构建用 Vite；包管理用 npm；全部文档中文。

## 摘要

构建一个三栏式 Agent 对话工作台（左：历史会话；中：聊天区；右：内容预览区），
以 Vue 3 + TypeScript 单页应用实现，作为 `agent-backend`（Fastify + SSE）的纯前端消费方。
核心能力：初始居中入口 → 发送后展开聊天区；流式回复（思考内容可折叠、工具调用仅展示名称且结束即消失）；
消息级复制/点赞/点踩与 token、耗时展示；输入区文档上传（9 个空间目录）、思考/快速切换、LLM 模型选择；
`@` 引用空间文件（结构化 `{dir, filename}` 提交）；数字人信息与 MCP 连接状态、进行中禁止切换；
会话搜索（黄色高亮、逐次跳转）与工作空间文件查看；外部地址直接跳转、空间目录文件右侧内联预览。

技术路线：**零框架外依赖的"原生优先"方案** —— 不引入 vue-router、Pinia、UI 组件库、
markdown 渲染库与 SSE 客户端库；状态用 Composition API composable 单例 + `provide/inject`，
交互控件优先使用平台原生元素（`<dialog>`、`<details>`、`<textarea>`），
样式用 Scoped CSS + CSS 自定义属性设计令牌，SSE 用 `fetch` + `ReadableStream` 手写解析。
这样同时满足"优先使用 Vue 3 原生能力"与宪章原则六（依赖治理）的要求。

## 技术上下文

**语言/版本**: TypeScript 6.0（`strict`）、Vue 3.5（`<script setup>` + Composition API）、Node.js ≥ 20

**主要依赖**:

| 类别 | 依赖 | 版本 | 用途 |
|---|---|---|---|
| 运行时 | `vue` | ^3.5.42 | 视图框架（Composition API） |
| 构建 | `vite` | ^8.2.2 | 开发服务器与生产构建 |
| 构建 | `@vitejs/plugin-vue` | ^6.0.8 | SFC 编译 |
| 类型 | `typescript` | ^6.0.3 | 与 `agent-backend` 保持同一大版本 |
| 类型 | `vue-tsc` | ^3.3.11 | SFC 类型检查 |
| 测试 | `vitest` | ^5.0.0 | 单元测试运行器 |
| 测试 | `@vue/test-utils` | ^2.5.0 | 组件挂载与交互断言 |
| 测试 | `jsdom` | ^30.0.1 | DOM 测试环境 |
| 测试 | `@vitest/coverage-v8` | ^5.0.0 | 覆盖率门禁（≥80%） |
| 规范 | `eslint` + `eslint-plugin-vue` + `typescript-eslint` | ^10.10.0 / ^10.11.0 / ^8.70.0 | 扁平配置 lint |
| 规范 | `prettier` + `eslint-config-prettier` | ^3.9.6 | 格式化 |

**明确不引入**（理由见 [research.md](research.md)）：`vue-router`（单页三栏，无路由需求）、
`pinia`（用 composable + `provide/inject` 满足）、UI 组件库（自建 Scoped CSS 组件）、
`marked`/`DOMPurify`（不做 Markdown 渲染，仅纯文本 + URL 识别）、
`eventsource` 类库（发消息为 POST，需手写 `fetch` 流式解析）、`playwright`（端到端验证走手工清单）。

**存储**: 前端**无本地持久化数据库**；会话、消息、反馈、文件均以后端为唯一数据源。
仅使用浏览器原生 `sessionStorage` 保存输入区偏好（当前模型、思考开关），键名前缀 `optagent.`。

**测试**: Vitest 5 + Vue Test Utils 2.5（`jsdom` 环境）；组件与其测试文件**同目录一一对应**
（`Xxx.vue` ↔ `Xxx.spec.ts`）；纯函数与 composable 同样一一对应。
覆盖率门禁：`src/composables`、`src/utils`、`src/api` 核心逻辑 ≥ 80%；
网络层以 `fetch` 桩替代真实请求，SSE 以可控 `ReadableStream` 桩驱动。

**目标平台**: 现代桌面浏览器（Chrome/Edge ≥ 120、Firefox ≥ 120、Safari ≥ 17）；
移动端适配不在本期范围；使用原生 `<dialog>`、`<details>`、CSS 自定义属性等基线能力。

**项目类型**: web-app（纯前端单页应用，无服务端渲染，无 BFF）

**性能目标**:

- 非推理类交互控件（切换、展开、面板开关、搜索跳转）可见反馈 ≤ 100ms（FR-052、SC-004）。
- 流式增量渲染：单次 SSE 事件合并到同一帧，连续 `content` 事件不产生逐字重排（目标 60fps）。
- 单组件首次渲染 ≤ 100ms（宪章原则五）；渲染路径内禁止昂贵计算（分段渲染、链接识别等派生结果必须缓存）。
- 右侧预览区 1s 内开始呈现内容（SC-008）。

**约束**:

- 单个 `.vue` / `.ts` 文件 MUST NOT 超过 500 行（宪章原则二）。
- 工具调用的入参、过程输出、结果内容 0 透出（SC-011）；思考内容与工具调用信息 0 落历史（SC-018）。
- 目录白名单固定为 9 个（7 业务 + `shared` + `tmp`），上传入口、`@` 引用、工作空间三处口径一致（SC-021）。
- 全部交互控件 MUST 支持键盘导航并遵循 WAI-ARIA（FR-051、SC-007）。
- 新增任何依赖 MUST 记录选型理由（宪章原则六）；本计划已预先排除全部非必要依赖。

**规模/范围**: 单用户工作台（后端内置用户 `admin`）；9 个空间目录；历史列表默认 10 条 / "更多"100 条；
单会话按 50 条分页、上限 200 条；预计 11 个 composable、8 个 API 模块 + 1 个契约类型文件（`api/types.ts`）、33 个组件。

## 宪章检查

*门禁：Phase 0 前必须通过；Phase 1 设计后复检。*

| 原则 | 判定 | 说明 |
|---|---|---|
| 一、中文文档优先（NON-NEGOTIABLE） | ✅ | 本计划、research、data-model、contracts、quickstart 及后续 tasks 全部中文；代码注释与提交信息中文 |
| 二、代码质量与风格一致性 | ✅ | Composition API + `<script setup>`；组件 PascalCase（`MessageBubble.vue`）、composable 用 `useXxx`；ESLint + Prettier 门禁；单文件 ≤ 500 行，超限拆子组件/`useXxx`/纯函数 |
| 三、测试完备性（NON-NEGOTIABLE） | ✅ | 每个组件与测试文件同目录一一对应；覆盖 props 传递、事件触发、边界条件（空列表、禁用态、超限、失败态）；`src/api`、`src/composables`、`src/utils` 覆盖率 ≥ 80% |
| 四、用户体验与无障碍 | ✅ | 全控件键盘可达、焦点可见、顺序合理；弹层用原生 `<dialog>`（自带焦点陷阱与 Esc）、折叠用原生 `<details>`（自带展开语义）；WAI-ARIA 角色与状态标注；非推理交互 ≤ 100ms，流式交互提供明确状态反馈；对话设计参考 RICH 范式（Read/Interact/Confirm/Handoff） |
| 五、渲染性能 | ✅ | 增量文本用单一 ref 累积 + 帧内合并刷新；分段渲染（链接/搜索高亮）以 `computed` 缓存，不在模板内做遍历计算；长列表用 `v-memo`/`key` 稳定化；单组件首渲 ≤ 100ms |
| 六、依赖治理 | ✅ | 不引入 vue-router / Pinia / UI 库 / markdown 库 / SSE 库 / E2E 库；新增依赖仅 Vue 官方构建与测试链，逐项在 research.md 记录选型理由与替代方案 |

**初始判定：全部通过，无违规需豁免。**

**Phase 1 设计后复检（2026-09-10）：仍全部通过，无违规需豁免。**

| 原则 | 复检结论 | 设计证据 |
|---|---|---|
| 一、中文文档优先 | ✅ | `plan.md` / `research.md` / `data-model.md` / `contracts/*.md` / `quickstart.md` 全部中文 |
| 二、代码质量与风格一致性 | ✅ | `ui-contracts.md` 明确组件 PascalCase、事件命名、单文件 ≤500 行与拆分方式（子组件 / `useXxx` / 纯函数） |
| 三、测试完备性 | ✅ | `quickstart.md` §五给出逐模块必测断言清单；`ui-contracts.md` 为每个 props/emit 标注测试要点；`data-model.md` §四给出 15 条可测试验证规则 |
| 四、用户体验与无障碍 | ✅ | 原生 `<dialog>`/`<details>`/`<textarea>` 承载焦点陷阱、展开语义与输入法（`research.md` D9/D10）；`data-model.md` §13 定义流式状态与禁用不变式；颜色 + 文本双通道 |
| 五、渲染性能 | ✅ | `research.md` D6（帧内合并刷新 + `v-memo`）、D7（分段结果 `computed` 缓存，禁止模板内计算）；`data-model.md` §4 明确派生结果必须缓存 |
| 六、依赖治理 | ✅ | `research.md` D1 逐项列出依赖与版本，D2/D4/D5/D7/D9/D10/D12/D15 分别记录被否决的替代依赖（vue-router、Pinia、markdown 库、SSE 库、UI 库、Playwright） |

设计未引入新的架构复杂度，`复杂度追踪` 仍为空。

## 项目结构

### 文档（本功能）

```text
specs/001-agent-chat-ui/
├── plan.md              # 本文件
├── spec.md              # 功能规范（已与后端契约对齐）
├── research.md          # Phase 0：技术决策
├── data-model.md        # Phase 1：实体与前端状态模型
├── quickstart.md        # Phase 1：端到端验证指南
├── checklists/
│   └── requirements.md  # 规范质量检查清单
├── contracts/
│   ├── backend-api.md   # 前端↔后端接口契约（含错误码映射、SSE 处理约定）
│   └── ui-contracts.md  # 组件公开接口（props/emits/slots）与 composable 契约
└── tasks.md             # 任务清单（/speckit.tasks 生成，已产出）
```

### 源码（仓库根目录）

```text
frontend/                              # 仓库根（本目录）
├── index.html
├── package.json
├── tsconfig.json                      # 引用 tsconfig.app.json / tsconfig.node.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts                     # 构建 + dev server.proxy(/api → 后端) + Vitest 配置
├── eslint.config.js
├── .prettierrc.json
├── .env.example                       # VITE_API_BASE_URL 等
└── src/
    ├── main.ts                        # 应用入口
    ├── App.vue                        # 三栏骨架 + 全局 Toast 宿主
    ├── api/                           # 网络层（薄封装，无业务逻辑）
    │   ├── http.ts                    # fetch 封装：BaseURL、JSON、统一错误对象
    │   ├── sse.ts                     # POST 流式请求 + SSE 事件解析器
    │   ├── types.ts                   # 后端契约类型（与 contracts/backend-api.md 对应）
    │   ├── agents.ts                  # 数字人 / MCP 状态
    │   ├── threads.ts                 # 会话 CRUD、历史、反馈、中断
    │   ├── messages.ts                # 发消息（流式）与事件类型
    │   ├── files.ts                   # 上传、列表、下载、预览、工作空间
    │   └── models.ts                  # 模型列表
    ├── composables/                   # 状态与业务逻辑（useXxx，单例式共享）
    │   ├── useAppSession.ts           # 全局会话上下文（provide/inject 的注入键）
    │   ├── useAgents.ts               # 当前数字人、MCP 状态、切换（进行中禁用）
    │   ├── useThreads.ts              # 历史列表、分页、新建、切换、删除
    │   ├── useChatStream.ts           # 发送/中断/流式状态机（thinking/content/tool/done/error）
    │   ├── useModels.ts               # 模型列表与当前选择
    │   ├── useUploads.ts              # 上传入口与上传状态
    │   ├── useFileMention.ts          # "@" 触发、目录/文件选择、引用增删与上限
    │   ├── useWorkspace.ts            # 工作空间文件（9 目录）
    │   ├── useSessionSearch.ts        # 关键词高亮与逐次跳转
    │   ├── usePreview.ts              # 工作空间面板状态（开关 / 双视图 / 内容加载）
    │   ├── useResizablePanel.ts       # 右栏宽度拖动（分隔条 / 上下限收敛 / 键盘可达）
    │   └── useToast.ts                # 轻量提示（aria-live）
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.vue           # 三栏布局容器（右栏宽度可拖动）
    │   │   ├── HistorySidebar.vue     # 左栏：历史会话 + 更多 + 新建
    │   │   ├── HistoryItem.vue
    │   │   ├── WorkspacePanel.vue     # 右栏：文件空间列表 / 内容预览（双视图）
    │   │   └── WorkspaceFileTree.vue  # 文件空间列表（9 目录，默认收起可折叠）
    │   ├── chat/
    │   │   ├── ChatPanel.vue          # 中栏：头部 + 消息列表 + 输入区
    │   │   ├── ChatHeader.vue         # 数字人名称 + MCP 状态 + 搜索/工作空间/数字人按钮
    │   │   ├── AgentSummary.vue       # 数字人名称与 MCP 状态列表
    │   │   ├── McpStatusItem.vue      # 单个 MCP 状态（红/绿）
    │   │   ├── AgentPanel.vue         # 数字人明细与切换（原生 dialog）
    │   │   ├── MessageList.vue        # 消息列表 + 空态 + 初始居中入口
    │   │   ├── MessageBubble.vue      # 单条消息（含分段渲染）
    │   │   ├── MessageContent.vue     # 纯文本 + 链接 + 搜索高亮分段渲染
    │   │   ├── ThinkingBlock.vue      # 思考内容折叠（原生 details）
    │   │   ├── ToolCallBadge.vue      # 工具名 + 进行状态，结束后消失
    │   │   ├── MessageActions.vue     # 复制 / 点赞 / 点踩 / token / 耗时
    │   │   ├── TypingIndicator.vue    # "思考中" 旋转动效
    │   │   ├── Composer.vue           # 输入区（textarea + 工具栏 + @ 面板）
    │   │   ├── ComposerToolbar.vue    # 加号 / 思考开关 / 模型选择 / 发送 / 中断
    │   │   ├── UploadMenu.vue         # 9 目录上传入口
    │   │   ├── UploadItem.vue         # 单文件上传状态（成功/失败原因/重试）
    │   │   ├── MentionPicker.vue      # "@" 目录与文件选择面板
    │   │   ├── ThinkingToggle.vue     # 思考 / 快速切换
    │   │   ├── ModelPicker.vue        # 模型列表（含默认标识）
    │   │   └── SessionSearch.vue      # 会话内搜索（高亮 + 逐次跳转）
    │   └── common/
    │       ├── BaseButton.vue
    │       ├── BaseDialog.vue         # 原生 <dialog> 封装
    │       ├── BaseDropdown.vue       # 键盘可达的下拉（roving tabindex）
    │       ├── BaseIcon.vue           # 内联 SVG（不引入图标库）
    │       ├── EmptyState.vue
    │       ├── ErrorNotice.vue        # 错误码 → 中文文案 + 重试
    │       ├── LoadingDots.vue
    │       └── ToastHost.vue
    ├── utils/
    │   ├── sse-parser.ts              # SSE 文本块 → 事件对象（纯函数，可测）
    │   ├── segments.ts                # 内容 → 分段（纯文本/链接/高亮），纯函数
    │   ├── format.ts                  # token、耗时、时间、文件大小格式化
    │   ├── file-kind.ts               # 扩展名 → 预览方式（inline-text / pdf / download）
    │   └── error-message.ts           # 后端错误码 → 中文文案映射
    ├── constants/
    │   ├── directories.ts             # 9 个空间目录白名单（唯一来源）
    │   ├── limits.ts                  # 50MB、10 个引用、10/100 条、预览上限
    │   └── events.ts                  # SSE 事件名与状态机常量
    └── styles/
        ├── tokens.css                 # CSS 自定义属性（颜色/间距/字号/动效时长）
        └── base.css                   # 重置与全局基线（含 prefers-reduced-motion）

tests/                                 # 仅放跨模块的集成式单元测试
└── integration/
    ├── chat-flow.spec.ts              # 发送 → 流式 → 完成 → 操作按钮
    ├── upload-and-mention.spec.ts     # 上传 → @ 引用 → 提交载荷
    └── agent-switch.spec.ts           # 进行中禁用切换 → 无进行中可切换
```

**结构决策**: 采用**单体前端 SPA**（单仓库单应用），分层为
`components（视图）→ composables（状态与业务）→ api（网络）`，`utils`/`constants` 为无状态纯函数与常量。
理由：本功能为单页三栏工作台，无路由与多页面需求，引入 vue-router/Pinia 属于非必要依赖（宪章原则六）；
组件与测试文件同目录一一对应，便于 AI 导航与覆盖度核对；`api/types.ts` 与
`contracts/backend-api.md` 保持一一映射，作为前后端契约的唯一前端落点。

## 复杂度追踪

无（宪章检查全部通过，无需豁免）。
