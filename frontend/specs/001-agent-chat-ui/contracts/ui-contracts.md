# 契约：组件接口与 composable 接口

**Feature**: 001-agent-chat-ui | **日期**: 2026-09-10

本文件定义前端内部的**稳定接口**：组件的 props / emits / slots，以及 composable 的返回契约。
它是"任务拆分"与"单元测试用例"的共同依据：每个组件与每个 composable 的测试 MUST 覆盖此处列出的
全部 props、emits 与边界条件（空值、禁用态、失败态、超限）。

约定：

- 组件名 PascalCase，文件同名；事件名 kebab-case（模板中），`defineEmits` 用 camelCase 键。
- 组件对外**不暴露内部 ref**；状态与业务逻辑一律来自注入的 composable。
- 所有"状态色"通过 CSS 变量表达（`--color-status-*`），组件不硬编码颜色值。
- `v-model` 仅在确有双向绑定语义处使用（如输入文本、搜索关键词）。

---

## 一、布局组件

### `AppShell.vue`

三栏骨架容器，负责栅格与右侧工作空间面板宽度（约 1/3，可收起）。

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `previewOpen` | `boolean` | `false` | 右侧工作空间面板是否展开（列表态与内容态都算展开） |

| slots | 说明 |
|---|---|
| `sidebar` | 左栏内容；**别名** `history` 作为其默认内容 |
| `main` | 中栏内容；**别名** `chat` 作为其默认内容 |
| `preview` | 右栏内容（仅在 `previewOpen=true` 时渲染；当前填充 `WorkspacePanel`） |

**实现超集**: 为兼容 `tasks.md` 中按 `#history` / `#chat` / `#preview` 的接线口径，
`sidebar` / `main` 各提供一个别名插槽作为默认内容，两套命名皆可用（`App.vue` 实际使用
`history` / `chat` / `preview`）。详见 §六。

**测试要点**: `previewOpen=false` 时右栏不占位（中栏铺满）；`true` 时中栏宽度收窄且不产生横向滚动。

**可拖动宽度（2026-09-11 补）**: 右栏展开时，其左缘渲染分隔条（`.app-shell__resizer`，
`role="separator"` + `aria-orientation="vertical"` + `aria-valuenow/min/max` + `tabindex="0"`），
可**手动拖动**调整右栏宽度：指针左移变宽、右移变窄；键盘 `←` / `→` 步进 16px（按住 `Shift` 为 64px）。
宽度收敛在 `[280px, min(960px, 容器宽 - 520px)]`，避免面板拖没或挤掉中栏。
未拖动时沿用 `--layout-preview-ratio`（≈1/3）；一旦拖动即经 `--layout-preview-width` 固定为像素值
（窗口后续缩放不再改变）。实现见 `src/composables/useResizablePanel.ts`。

### `HistorySidebar.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `threads` | `Conversation[]` | `[]` | 当前展示的会话列表（实现默认空数组，便于加载态复用本组件） |
| `activeId` | `string \| null` | `null` | 当前选中会话 |
| `limit` | `10 \| 100` | `10` | 当前分页条数 |
| `loading` | `boolean` | `false` | 加载中 |
| `busy` | `boolean` | `false` | 有进行中会话时禁止切换（禁用列表项） |

| emits | 载荷 | 说明 |
|---|---|---|
| `select` | `thread_id: string` | 点击历史项 |
| `more` | — | 点击"更多"（切到 100 条） |
| `create` | — | 点击"新建会话" |
| `remove` | `thread_id: string` | **实现超集**：透传行内删除意图（二次确认由 `App.vue` 编排，§3.5） |

**边界**: 空列表 → 空态且"新建"仍可用（FR-043）；`busy=true` → 列表项禁用并说明原因。

### `HistoryItem.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `thread` | `Conversation` | 必填 | |
| `active` | `boolean` | `false` | |
| `disabled` | `boolean` | `false` | |
| `running` | `boolean` | `false` | 该会话本轮是否仍在进行；列表接口不返回 `running`（仅详情返回），故由 `HistorySidebar` 派生传入（**实现超集**，见 §六） |

| emits | 载荷 |
|---|---|
| `select` | `thread_id: string` |
| `remove` | `thread_id: string`（**实现超集**：行内删除入口；二次确认与相邻会话切换由装配层编排） |

**边界**: `title === null` → 展示"新会话"；超长标题单行省略；`disabled` 时不可聚焦触发 select（但可读屏）。

**实现超集（删除入口，2026-09-10 补）**: 每项右侧提供 `trash` 图标按钮，
`aria-label` 为「删除会话：{标题}」；默认 `opacity: 0`、悬停或 `:focus-visible` 时显形
（`opacity` 不影响可聚焦与可点击，键盘用户仍可 Tab 到达）；`disabled` 时禁用且不派发。
点击**不触发** `select`（两者是兄弟节点）。依据 `backend-api.md` §3.5。

### `WorkspacePanel.vue`

右侧 1/3 的**唯一**面板：内部在「文件空间列表」与「文件内容」之间互换，两者不并存（FR-001、FR-046）。

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `view` | `'list' \| 'content'` | `'list'` | 当前视图 |
| `dirs` | `WorkspaceDir[]` | `[]` | 列表态：9 个目录及文件 |
| `expandedDirs` | `readonly string[]` | `[]` | 列表态：已展开的目录名 |
| `listLoading` | `boolean` | `false` | 列表态加载中 |
| `target` | `PreviewTarget` | `{kind:'none'}` | 内容态目标 |
| `content` | `PreviewContent \| null` | `null` | 内容态加载结果 |
| `contentLoading` | `boolean` | `false` | 内容态加载中 |

| emits | 载荷 | 说明 |
|---|---|---|
| `close` | — | 收起面板 |
| `back` | — | 内容态 → 列表态（面板保持展开） |
| `toggle-dir` | `string` | 折叠 / 展开分组 |
| `preview` | `FileReference` | 点击文件名 → 切到内容态 |
| `download` | `FileReference` | 下载 |
| `remove` | `FileReference` | **二次确认后**的删除（FR-054） |

**边界**: `renderMode='error'` → `ErrorNotice` + 下载引导；`renderMode='download'` → 展示
"该类型不支持内联预览" + 下载按钮。

---

## 二、聊天区组件

### `ChatPanel.vue`

中栏容器：头部 + 消息列表 + 输入区；负责"初始居中入口 → 展开"的布局切换。

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `expanded` | `boolean` | `false` | 是否已展开（有会话且已发消息） |

**测试要点**: `expanded=false` 时输入区垂直居中且消息列表不渲染；`true` 时输入区贴底。

**实现超集**: 消息列表的渲染条件为 `expanded || 已有历史消息 || 本轮已开始（streaming !== null）`
——首轮尚未落盘时也需下移入口（FR-004）。所有接线（事件编排、浮层开关、生命周期）集中在
`composables/useChatPanel.ts`（T081 为满足单文件 ≤500 行而拆分），本组件只保留 props 与模板；
`SessionSearch` / `UploadMenu` / `MentionPicker` / `AgentPanel` 均由本组件渲染；右栏工作空间面板
（`WorkspacePanel`）不在此列，它由装配层 `App.vue` 填充 `#preview` 插槽。
详见 §六。

### `ChatHeader.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `agent` | `DigitalHuman \| null` | `null` | 当前数字人 |
| `mcpServers` | `McpServiceStatus[]` | `[]` | MCP 状态 |
| `searchOpen` | `boolean` | `false` | |
| `workspaceOpen` | `boolean` | `false` | |
| `agentPanelOpen` | `boolean` | `false` | |

| emits | 说明 |
|---|---|
| `toggle-search` | 切换搜索栏 |
| `toggle-workspace` | 打开工作空间 |
| `toggle-agent` | 打开数字人面板 |

**边界**: `agent === null` → 展示"请选择数字人"，MCP 区域为空（不渲染空列表容器）。

### `AgentSummary.vue`

| props | 类型 | 默认 |
|---|---|---|
| `agentName` | `string \| null` | `null` |
| `mcpServers` | `McpServiceStatus[]` | `[]` |

**边界**: `agentName=null` → 提示文案；`mcpServers=[]` → 不渲染列表；状态变化时仅更新对应项。

### `McpStatusItem.vue`

| props | 类型 | 默认 |
|---|---|---|
| `name` | `string` | 必填 |
| `transport` | `string` | 必填 |
| `status` | `'connected' \| 'failed' \| 'unknown'` | 必填 |

**测试要点**: 颜色与文本双通道（"连接正常"/"连接失败"/"未连接"）；`unknown` 为中性灰、MUST NOT 呈现为故障；状态切换只改样式与文本，不重挂载。

### `AgentPanel.vue`（基于 `BaseDialog`）

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `open` | `boolean` | `false` | |
| `current` | `DigitalHuman \| null` | `null` | 当前数字人详情 |
| `candidates` | `DigitalHuman[]` | `[]` | 可切换列表 |
| `switchingDisabled` | `boolean` | `false` | 进行中会话 → 置灰（FR-036） |
| `busy` | `boolean` | `false` | 切换请求进行中 |

| emits | 载荷 |
|---|---|
| `close` | — |
| `switch` | `agent_name: string` |

**边界**: `switchingDisabled=true` → 切换按钮置灰且 `aria-disabled` + 原因文案；
`current=null` → 详情区提示未选择；切换中禁用重复点击。

### `MessageList.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `messages` | `Message[]` | `[]` | 按时间正序 |
| `streaming` | `StreamingView \| null` | `null` | 本轮瞬态（`{ phase, text, thinking, toolCalls, error }`），无进行中轮次时为 `null` |
| `searchKeyword` | `string` | `''` | 搜索关键词（高亮） |
| `activeMatchIndex` | `number` | `-1` | 当前活跃匹配序号 |
| `hasMore` | `boolean` | `false` | 是否还有更早消息 |

| emits | 载荷 | 说明 |
|---|---|---|
| `load-more` | — | 加载更早消息 |
| `feedback` | `{ message_id: string; value: 'up' \| 'down' \| null }` | **实现超集**：向上透传（FR-027 由装配层提交） |
| `open-link` | `href: string` | **实现超集**：向上透传（V-10 直跳由装配层执行） |
| `open-file` | `reference: FileReference` | **实现超集**：向上透传（FR-046 预览由装配层执行） |

| slots | 说明 |
|---|---|
| `empty` | 替换空态占位（默认渲染 `EmptyState`） |

**边界**: 空消息 + 无流式 → 展示初始入口占位；`hasMore=true` → 顶部"加载更早"按钮；
仅当前气泡随流式更新，其余以 `v-memo` 冻结（D6）。

**实现说明**: 本轮已开始但尚未落盘时，列表追加一个**合成气泡**承载思考/工具/正文
（`streamingMessage`）；仅对当前活跃命中做 DOM 标记与滚动定位（命中量大时不做全量渲染优化）。

**实现超集（自动置底，2026-09-10 补）**: 容器监听 `scroll` 维护"是否跟随最新"（距底 80px 内视为跟随）：

| 触发 | 行为 |
|---|---|
| **切换会话**（首条消息 id 变化且条数未增长） | 直接置底并恢复跟随 |
| **新消息落定**（首条不变、末条变化） | 原本跟随则置底；用户已向上翻阅则不打扰 |
| **流式增量**（阶段 / 思考 / 正文 / 工具数量变化） | 跟随中则置底，向上翻阅时不打扰 |
| **加载更早消息**（前插：首条变化且条数增长） | **不置底**，改为补偿新增高度，让视口停在原内容上 |
| 首次挂载 | 置底 |

### `MessageBubble.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `message` | `Message` | 必填 | |
| `searchKeyword` | `string` | `''` | |
| `activeMatchIndex` | `number` | `-1` | |
| `matchIndexBase` | `number` | `0` | 该消息内匹配的全局起始序号 |
| `streaming` | `StreamingView \| null` | `null` | 本轮瞬态（思考/工具/阶段/错误）；`null` 表示非流式气泡。**实现超集**：`Message` 从契约层面不含思考与工具字段（V-04），故瞬态只能经此 prop 下传 |

| emits | 载荷 |
|---|---|
| `feedback` | `{ message_id, value: 'up' \| 'down' \| null }` |
| `copy` | `message_id: string` |
| `retry` | —（**实现超集**：失败轮的重试入口） |
| `open-link` | `href: string`（**实现超集**：向上透传，V-10） |
| `open-file` | `reference: FileReference`（**实现超集**：向上透传，FR-046） |

**边界**: `status='failed'` → 展示错误文案、不渲染 `MessageActions` 的操作区（仅展示时间）；
`role='user'` 且有 `attachments` → 渲染 `@文件名` 引用列表；
`status` 缺省（进行中/中断）→ 不渲染用量与操作。

### `MessageContent.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `content` | `string` | 必填 | 原文 |
| `keyword` | `string` | `''` | 搜索关键词 |
| `matchIndexBase` | `number` | `0` | |

| emits | 载荷 |
|---|---|
| `open-link` | `href: string` |

**测试要点**: 分段函数结果正确渲染（text/link/mark）；`link` 点击 emit `open-link`（父层 `window.open`）；
无 `v-html`（0 XSS 面）；空字符串 → 渲染空容器不报错。

### `ThinkingBlock.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `text` | `string` | 必填 | 思考内容（流式累积） |
| `streaming` | `boolean` | `false` | 流式中 |

**测试要点**: 使用原生 `<details>`，默认**不展开**（`open=false`）；点击可展开与收起（FR-021）；
空文本 → 不渲染；流式中追加内容不改变展开状态。

### `ToolCallBadge.vue`

| props | 类型 | 默认 |
|---|---|---|
| `name` | `string` | 必填 |
| `status` | `'running' \| 'success' \| 'error'` | `'running'` |

**测试要点**: **只渲染 `name` 与状态文本**，DOM 中不存在入参/结果节点（SC-011）；
`status='running'` 展示进行动效（`prefers-reduced-motion` 下为静态）。

### `MessageActions.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `usage` | `Usage \| null` | `null` | 无则不展示 token |
| `durationSeconds` | `number \| null` | `null` | |
| `feedback` | `'up' \| 'down' \| null` | `null` | |
| `disabled` | `boolean` | `false` | 提交中禁用重复点击 |
| `copyText` | `string` | `''` | 待复制正文（**实现超集**）；为空表示由上层自行处理复制 |

| emits | 载荷 |
|---|---|
| `copy` | — |
| `feedback` | `'up' \| 'down'` |

**测试要点**: `usage=null` 或 `durationSeconds=null` → 不渲染对应区域；
`feedback='up'` → 点赞为选中态、点踩为非选中（FR-027）；`disabled=true` → 按钮禁用。

**实现超集（复制语义）**: 复制在**本组件内**完成——`copyText` 非空且 `navigator.clipboard` 可用时
写入剪贴板，并给出 2s 的"已复制"反馈；同时派发 `copy` 供上层观察。
`MessageBubble` 以 `:copy-text="message.content"` 传入待复制正文。
"同值重复提交 = 取消"（V-08）的换算仍在 `MessageBubble` 依当前值判定后提交 `null`，组件保持**受控**。
详见 §六。

### `TypingIndicator.vue`

| props | 类型 | 默认 |
|---|---|---|
| `label` | `string` | `'思考中'` |

**测试要点**: `role="status"` + `aria-live="polite"`；`prefers-reduced-motion` 下降级为静态文本。

### `Composer.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | `string` | `''` | 文本（`v-model`） |
| `disabled` | `boolean` | `false` | 流式中禁用输入与发送 |
| `sending` | `boolean` | `false` | 请求进行中 |
| `references` | `FileReference[]` | `[]` | 已选引用 |
| `directories` | `SpaceDirectory[]` | `SPACE_DIRECTORIES` | 9 目录（默认取唯一来源常量，V-01） |
| `workspaceFiles` | `WorkspaceDir[]` | `[]` | 供 `@` 面板取文件 |
| `placeholder` | `string` | 见实现 | 占位文案（**实现超集**） |
| `mentionOpen` | `boolean` | `false` | `@` 面板是否展开（**实现超集**）；为 `true` 时 `↑`/`↓`/`Enter`/`Esc` 交给上层处理 |

| emits | 载荷 | 说明 |
|---|---|---|
| `update:modelValue` | `string` | |
| `send` | `{ content: string; attachments: FileReference[] }` | |
| `stop` | — | 中断本轮 |
| `remove-reference` | `FileReference` | |
| `mention-limit` | — | 引用超限（父层提示） |
| `input-text` | `{ value: string; caret: number }` | **实现超集**：文本与光标位置，供上层做 `@` 触发检测 |
| `mention-key` | `key: string` | **实现超集**：`@` 面板展开时被拦截的按键 |

| slots | 说明 |
|---|---|
| `toolbar` | 工具栏插槽（由 `ComposerToolbar` 填充）；slot props：`canSend` / `sending` |
| `mention` | `@` 引用面板插槽（由 `MentionPicker` 填充）；slot props：`directories` / `workspaceFiles` / `references` |

**边界**: `disabled=true` → 发送按钮置灰、Enter 不发送（FR-006）；空白内容 → 发送按钮禁用；
`@` 触发面板 → `Esc` 关闭且不丢文本；引用达 10 个 → emit `mention-limit` 且不插入。

### `ComposerToolbar.vue`

| props | 类型 | 默认 |
|---|---|---|
| `thinking` | `boolean` | `false` |
| `model` | `string \| null` | `null` |
| `models` | `Model[]` | `[]` |
| `canSend` | `boolean` | `false` |
| `streaming` | `boolean` | `false` |
| `uploadDisabled` | `boolean` | `false` |

| emits | 说明 |
|---|---|
| `toggle-thinking` | |
| `select-model` | `model: string` |
| `send` | |
| `stop` | |
| `toggle-upload` | |

**测试要点**: 最左为加号、右二为模型、最右为思考开关（FR-008 的布局契约）；
`streaming=true` → 展示"中断本轮"且发送按钮置灰。

### `UploadMenu.vue`

| props | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | `false` |
| `directories` | `SpaceDirectory[]` | 必填 |
| `uploads` | `UploadedDocument[]` | `[]` |

| emits | 载荷 |
|---|---|
| `close` | — |
| `pick` | `{ dir: string; files: FileList }` |
| `retry` | `localId: string` |

**测试要点**: 固定渲染 9 个目录项（SC-021）；每个目录可触发文件选择；
上传失败项展示原因 + "重试"（FR-011）。

### `UploadItem.vue`

| props | 类型 | 默认 |
|---|---|---|
| `doc` | `UploadedDocument` | 必填 |

| emits | 说明 |
|---|---|
| `retry` | |

**测试要点**: 四态渲染（pending/uploading/success/failed）；`failed` 展示 `error` 映射文案与重试按钮。

### `MentionPicker.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `open` | `boolean` | `false` | |
| `stage` | `'dir' \| 'file'` | `'dir'` | |
| `directories` | `SpaceDirectory[]` | 必填 | |
| `activeDir` | `string \| null` | `null` | |
| `files` | `{ filename: string }[]` | `[]` | 当前目录文件 |
| `activeIndex` | `number` | `0` | 键盘高亮项 |
| `loading` | `boolean` | `false` | |

| emits | 载荷 |
|---|---|
| `pick-dir` | `dir: string` |
| `pick-file` | `FileReference` |
| `close` | — |
| `move` | `delta: number` |

**测试要点**: 目录阶段渲染 9 项；文件阶段空目录 → 空态提示（FR-019）；
`↑`/`↓` 触发 `move`、`Enter` 触发 `pick-*`、`Esc` 触发 `close`。

### `ThinkingToggle.vue`

| props | 类型 | 默认 |
|---|---|---|
| `thinking` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |

| emits | 说明 |
|---|---|
| `toggle` | |

**测试要点**: 文本在"思考"/"快速"间切换且当前模式可读（FR-012）；`role="switch"` + `aria-checked`。

### `ModelPicker.vue`

| props | 类型 | 默认 |
|---|---|---|
| `model` | `string \| null` | `null` |
| `models` | `Model[]` | `[]` |
| `disabled` | `boolean` | `false` |

| emits | 载荷 |
|---|---|
| `select` | `model: string` |

**测试要点**: `is_default` 项展示"默认"标识；当前项展示选中态；`models=[]` → 展示加载/空态。

### `SessionSearch.vue`

| props | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | `false` |
| `keyword` | `string` | `''` |
| `total` | `number` | `0` |
| `activeIndex` | `number` | `-1` |

| emits | 载荷 |
|---|---|
| `update:keyword` | `string` |
| `next` | — |
| `close` | — |

**测试要点**: 展示"第 n / 共 m 项"；`total=0` 且关键词非空 → 无结果提示（US8 场景 3）；
`Enter` 等价于 `next`。

### `WorkspaceFileTree.vue`

文件空间列表（纯展示，不发起请求）：9 个固定目录分组，**默认全部收起**（FR-031）。

| props | 类型 | 默认 |
|---|---|---|
| `dirs` | `WorkspaceDir[]` | `[]` |
| `expandedDirs` | `readonly string[]` | `[]` |
| `loading` | `boolean` | `false` |

| emits | 载荷 |
|---|---|
| `toggle-dir` | `string` |
| `preview` | `FileReference` |
| `download` | `FileReference` |
| `remove` | `FileReference` |

**边界**: `shared` 为共享只读目录，**不渲染删除入口**（FR-053）。
**测试要点**: 固定渲染 9 个目录分组；默认全部收起（既不渲染文件行也不渲染空态）；展开空目录显示空态；
点击文件名只 emit `preview`（**不**自行收起面板，收起由 `WorkspacePanel` 承担）。

---

## 三、通用组件

### `BaseButton.vue`

| props | 类型 | 默认 |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'secondary'` |
| `size` | `'sm' \| 'md'` | `'md'` |
| `disabled` | `boolean` | `false` |
| `loading` | `boolean` | `false` |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` |
| `disabledReason` | `string \| null` | `null` | 禁用原因，经 `title` 暴露（实现超集，见 §六） |

| emits | 说明 |
|---|---|
| `click` | 原生 `MouseEvent` |

**测试要点**: `disabled=true` → 原生 `disabled` 且不 emit `click`；`loading=true` → 展示加载态且不可点击；
`aria-disabled` 与 `title` 提供禁用原因（可选 `disabledReason` prop）。

### `BaseDialog.vue`

原生 `<dialog>` 封装。

| props | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | `false` |
| `title` | `string` | `''` |
| `labelledBy` | `string \| null` | `null` |

| emits | 说明 |
|---|---|
| `close` | Esc 或点击遮罩 |

| slots | 说明 |
|---|---|
| `default` | 内容 |
| `footer` | 操作区 |

**测试要点**: `open=true` → 调用 `showModal()`；`open=false` → `close()`；Esc 触发 `close`；
`aria-labelledby` 指向标题。

### `ConfirmDialog.vue`（基于 `BaseDialog`，**契约外新增**）

破坏性操作的二次确认（`backend-api.md` §3.5 要求"删除前二次确认"）。

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `open` | `boolean` | `false` | |
| `title` | `string` | 必填 | |
| `message` | `string` | `''` | 说明文案（`pre-wrap`，支持换行） |
| `confirmLabel` | `string` | `'确认'` | |
| `cancelLabel` | `string` | `'取消'` | |
| `danger` | `boolean` | `false` | 确认按钮用危险样式（删除类） |
| `busy` | `boolean` | `false` | 确认动作进行中：两按钮均禁用，防重复提交 |

| emits | 说明 |
|---|---|
| `confirm` | 用户已确认（**本组件不发请求**，由调用方决定后续动作） |
| `cancel` | 取消 / Esc / 遮罩（`BaseDialog` 的 `close` 统一收敛到此） |

**测试要点**: `danger` 切换确认按钮变体；`busy=true` → 两按钮禁用且不派发；
`BaseDialog` 的关闭意图收敛为 `cancel`。

### `BaseDropdown.vue`

| props | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | `false` |
| `items` | `{ key: string; label: string; disabled?: boolean }[]` | `[]` |
| `activeIndex` | `number` | `0` |

| emits | 载荷 |
|---|---|
| `toggle` | — |
| `select` | `key: string` |
| `close` | — |

| slots | 说明 |
|---|---|
| `trigger` | 触发器内容（**实现超集**）；未提供时仅渲染 chevron。`ModelPicker` 用它展示当前模型名 |

**测试要点**: `aria-haspopup="menu"` / `aria-expanded`；`↑`/`↓` 移动、`Enter` 选择、`Esc` 关闭；
外部点击关闭；焦点在关闭后回到触发器。

**实现说明**: `activeIndex` 语义为**初始/受控高亮项**——组件内部维护高亮状态（`highlight`），
`activeIndex` 变化时同步；移动会跳过 `disabled` 项，并支持 `Home` / `End` 首尾跳转
（roving `tabindex`：仅高亮项为 `0`，其余为 `-1`）。

### `BaseIcon.vue`

| props | 类型 | 默认 |
|---|---|---|
| `name` | `string` | 必填 |
| `size` | `number` | `16` |
| `label` | `string \| null` | `null` |

**测试要点**: `label` 为空 → `aria-hidden="true"`；非空 → `role="img"` + `aria-label`。

### `EmptyState.vue`

| props | 类型 | 默认 |
|---|---|---|
| `title` | `string` | 必填 |
| `description` | `string` | `''` |

| slots | 说明 |
|---|---|
| `action` | 操作按钮 |

### `ErrorNotice.vue`

| props | 类型 | 默认 | 说明 |
|---|---|---|---|
| `error` | `ErrorInfo` | 必填 | 后端错误体 |
| `retryLabel` | `string \| null` | `'重试'` | 为 `null` 时不展示重试 |
| `context` | `ErrorMessageContext` | `'default'` | 文案场景（同码不同义时决定措辞），如 `'preview'` / `'upload'` / `'send-message'`（**实现超集**，见 §六） |

| emits | 说明 |
|---|---|
| `retry` | |

**测试要点**: 展示 `error-message.ts` 映射后的中文文案；未知 code 有兜底文案且保留原码；
`retryLabel=null` → 不渲染重试按钮。

### `LoadingDots.vue`

| props | 类型 | 默认 |
|---|---|---|
| `label` | `string` | `'加载中'` |

**测试要点**: `role="status"`；减少动效偏好下静态展示。

### `ToastHost.vue`

| props | 类型 | 默认 |
|---|---|---|
| `items` | `ToastItem[]` | `[]` |

| emits | 载荷 |
|---|---|
| `dismiss` | `id: string` |
| `action` | `id: string` |

**测试要点**: `aria-live="polite"`；最多展示 3 条；含 `action` 的条目渲染操作按钮。

---

## 四、composable 契约

所有 composable 以 `useXxx()` 形式导出，返回 `readonly` 状态与显式 action。
`useAppSession()` 在 `App.vue` 调用一次并 `provide`；其余 composable 在内部 `inject` 该上下文
（测试中通过工厂参数注入 `fetch` 桩与假时钟，见 `research.md` D4、D15）。

### `useAppSession(options?)`

```ts
interface AppSessionOptions {
  baseUrl?: string                                  // 默认取 VITE_API_BASE_URL
  fetchImpl?: typeof fetch                          // 测试注入
  now?: () => number                                // 测试注入（假时钟）
  storage?: Storage | null                          // 本地偏好存储；null 关闭持久化（实现超集）
}
```

返回：`{ agents, threads, chat, models, uploads, mention, workspace, search, preview, toast, now }`
（各领域 store 实例，字段均为 `readonly`，供 `provide` 后子组件 `inject` 使用）。

**实现超集**: 比原契约多两项——`mention`（`FileMentionStore`，`@` 引用 store）与 `now`（注入的时钟）。
模块另导出 `APP_SESSION_KEY: InjectionKey<AppSession>`、`useSession(): AppSession`（未注入时抛出明确
错误，不静默回落）、`createAppSession(options): AppSession`（纯装配、无副作用，供测试直接构造）
与类型 `AppSession`。装配顺序即依赖方向：`client/toast → preview/workspace/models/uploads/mention
→ threads → chat → agents`。详见 §六。

### `useAgents()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `currentAgent` | `Readonly<Ref<DigitalHuman \| null>>` | 当前数字人 |
| `mcpServers` | `Readonly<Ref<McpServiceStatus[]>>` | MCP 状态 |
| `candidates` | `Readonly<Ref<DigitalHuman[]>>` | 可切换列表 |
| `switchingDisabled` | `ComputedRef<boolean>` | `chat.phase === 'streaming'` 时为 `true`（FR-036） |
| `loadCurrent()` | `() => Promise<void>` | 拉当前数字人与 MCP 状态 |
| `loadDetail(name)` | `(name: string) => Promise<void>` | 拉详情 |
| `switchTo(name)` | `(name: string) => Promise<void>` | select（**覆盖式，无需 exit**）→ 重新 loadCurrent（FR-037 修订） |
| `startMcpSubscription()` / `stopMcpSubscription()` | `() => void` | 订阅后端 MCP 状态 SSE 推送（2026-09-12 修订：替代 ≤5s 轮询，SC-010） |
| `loading` | `Readonly<Ref<boolean>>` | 加载态（**实现超集**） |
| `switching` | `Readonly<Ref<boolean>>` | 切换请求进行中，供 `AgentPanel.busy`（**实现超集**） |
| `error` | `Readonly<Ref<ErrorInfo \| null>>` | 最近一次错误（**实现超集**） |
| `loadCandidates()` | `() => Promise<void>` | 拉取可切换数字人列表（逐个拉详情）（**实现超集**） |
| `refreshMcp()` | `() => Promise<void>` | 单独刷新 MCP 状态（**实现超集**） |

**测试要点**: 未选定 → `currentAgent=null` 且 `mcpServers=[]`；
`switchTo` 只发一次 `select`（MUST NOT 调 `exit`）；`switchTo` 在 `switchingDisabled=true` 时不发请求。

### `useThreads()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `list` | `Readonly<Ref<Conversation[]>>` | 历史列表 |
| `activeId` | `Readonly<Ref<string \| null>>` | 当前会话 |
| `messages` | `Readonly<Ref<Message[]>>` | 当前会话消息（正序） |
| `running` | `Readonly<Ref<boolean>>` | 服务端 `running` 标记 |
| `limit` | `Readonly<Ref<10 \| 100>>` | **前端切片**条数（不发请求参数） |
| `hasMore` | `ComputedRef<boolean>` | `messages.length < total` |
| `loadList()` | `() => Promise<void>` | 拉取**全部**会话（`GET /api/threads` 不支持分页），前端切片展示前 10 条 |
| `showMore()` | `() => void` | **纯前端**切到 100 条，不发请求（FR-040）；**实现为同步方法**（契约原写作 `Promise<void>`） |
| `create()` | `() => Promise<void>` | 新建（含 409 映射，FR-042） |
| `select(id)` | `(id: string) => Promise<void>` | 切换会话 |
| `loadMore()` | `() => Promise<void>` | 前插更早消息 |
| `refresh()` | `() => Promise<void>` | 重新拉详情（断连恢复，FR-050） |
| `remove(id)` | `(id: string) => Promise<void>` | 删除 |
| `visible` | `ComputedRef<Conversation[]>` | 前端切片后用于展示的会话（`list.slice(0, limit)`）（**实现超集**） |
| `total` | `Readonly<Ref<number>>` | 服务端消息总数（`hasMore` 的依据）（**实现超集**） |
| `loading` | `Readonly<Ref<boolean>>` | 列表/详情加载中（**实现超集**） |
| `error` | `Readonly<Ref<ErrorInfo \| null>>` | 最近一次错误（**实现超集**） |
| `patchFeedback(messageId, value)` | `(messageId: string, value: FeedbackValue) => void` | 本地乐观改写某条消息的反馈（供 `useChatStream` 回滚用）（**实现超集**） |

**测试要点**: 新建时未选数字人 → 提示且不改变当前会话；
`showMore` 为**纯前端切片**（不产生网络请求，切片条数 10 → 100）；
`loadList` 请求 URL **不含** `limit`/`offset` 参数；`refresh` 后 `running` 字段映射正确。

### `useChatStream()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `phase` | `Readonly<Ref<RunPhase>>` | `idle \| streaming \| completed \| failed \| aborted` |
| `streamingText` / `streamingThinking` | `Readonly<Ref<string>>` | 流式缓冲 |
| `toolCalls` | `Readonly<Ref<ToolCallState[]>>` | 仅进行中的工具调用 |
| `thinkingEnabled` | `Ref<boolean>` | 本轮模式（**偏差**：实现为**可写** ref，持久化于 `sessionStorage`） |
| `draft` | `Ref<string>` | 输入区文本（发送前保留、失败时保留）（**实现超集**） |
| `canSend` | `ComputedRef<boolean>` | `phase !== 'streaming' && draft 非空`（FR-006） |
| `error` | `Readonly<Ref<ErrorInfo \| null>>` | 本轮错误（**实现超集**） |
| `usage` | `Readonly<Ref<Usage \| null>>` | 本轮用量（**实现超集**） |
| `durationSeconds` | `Readonly<Ref<number \| null>>` | 本轮耗时（**实现超集**） |
| `startedAt` | `Readonly<Ref<number \| null>>` | 本地计时起点（毫秒，兜底展示）（**实现超集**） |
| `hasThinking` | `ComputedRef<boolean>` | 思考模式且已产生思考内容（决定是否渲染思考块）（**实现超集**） |
| `send(payload)` | `(p: { content: string; attachments: FileReference[] }) => Promise<void>` | 发起本轮 |
| `submitFeedback(messageId, value)` | `(messageId: string, value: FeedbackValue) => Promise<void>` | 反馈的乐观更新 + 失败回滚；同值重复提交 = 取消（V-08 / FR-027）（**实现超集**，见 §六） |
| `stop()` | `() => Promise<void>` | 中断本轮（FR-007） |
| `recover()` | `() => Promise<void>` | 断连后重新获取本轮结果（FR-050） |
| `reset()` | `() => void` | 切换会话时清空流式状态 |
| `setThinking(value)` | `(v: boolean) => void` | 切换本轮模式（**实现超集**） |

**测试要点**（对应 `research.md` D15 的 `ReadableStream` 桩）:
`tool_call` 后 `toolCalls` 含该项、`tool_call_end` 后移除；
`done` 且 `message_id=null` → `phase='aborted'`；`error` → `phase='failed'`；
读取中断 → `phase='failed'` 且 `recover()` 可拉取最终结果；
`send` 在 `phase='streaming'` 时直接返回不发请求。

### `useModels()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `models` | `Readonly<Ref<Model[]>>` | 列表 |
| `current` | `Readonly<Ref<string \| null>>` | 当前模型（`sessionStorage` 持久化） |
| `loading` | `Readonly<Ref<boolean>>` | 加载中（**实现超集**） |
| `error` | `Readonly<Ref<ErrorInfo \| null>>` | 拉取失败（失败时列表置空、不阻断聊天）（**实现超集**） |
| `isDefaultSelected` | `ComputedRef<boolean>` | 当前模型是否为后端默认项（**实现超集**） |
| `load()` | `() => Promise<void>` | 拉列表并校正缓存值 |
| `select(model)` | `(m: string) => void` | 切换（仅本地，发送时提交） |

**测试要点**: 缓存值不在列表中 → 回退默认项；`is_default` 恰一项。

### `useUploads()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `items` | `Readonly<Ref<UploadedDocument[]>>` | 上传项（含状态） |
| `upload(dir, files)` | `(dir: string, files: File[]) => Promise<void>` | 逐文件上传（FR-010） |
| `retry(localId)` | `(id: string) => Promise<void>` | 重试失败项（FR-011） |
| `clear()` | `() => void` | 清空已完成项 |

**测试要点**: 扩展名/大小预校验失败 → 不发请求且 `status='failed'` 带原因；
多个文件 → 各自独立状态；单文件失败不影响其他项。

### `useFileMention()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `open` / `stage` / `activeDir` / `activeIndex` | `Ref` | 面板状态 |
| `references` | `Readonly<Ref<FileReference[]>>` | 已选引用 |
| `directories` | `readonly SpaceDirectory[]` | 目录白名单（与三处 UI 同源，SC-021）（**实现超集**） |
| `files` | `ComputedRef<{filename:string}[]>` | **当前阶段可选项**：目录阶段为空数组，文件阶段为 `activeDir` 下文件（来自 `workspace`）（**实现超集**：语义比"当前目录文件"更广） |
| `optionCount` | `ComputedRef<number>` | 当前阶段可选项数量（目录阶段恒为 9）（**实现超集**） |
| `maxReached` | `ComputedRef<boolean>` | 引用数是否已达 10（**实现超集**） |
| `handleInput(text, caret)` | `(text: string, caret: number) => void` | 检测 `@` 触发（US4 场景 1、8） |
| `pickDir(dir)` | `(dir: string) => void` | 进入文件阶段（FR-015） |
| `pickFile(ref)` | `(ref: FileReference) => boolean` | 加入引用；超限或重复返回 `false` 并提示（**实现超集**：带返回值） |
| `move(delta)` / `close()` | `(delta: number) => void` / `() => void` | 键盘导航（环形）/ 收起面板（不清空引用） |
| `remove(ref)` | `(ref: FileReference) => void` | 移除引用（正文标记的同步由装配层执行） |
| `reset()` | `() => void` | 发送后清空 |
| `buildAttachments()` | `() => FileReference[]` | 结构化提交载荷（FR-016） |
| `missingReferences()` | `() => FileReference[]` | 已失效的引用（发送前校验用，V-15 / FR-018）（**实现超集**） |

**实现超集（模块级导出）**: 同文件另导出纯函数 `mentionToken(ref): string`（生成 `@文件名` 展示标记）
与 `stripMentionTokens(text, references): string`（提交前移除正文中的展示标记，FR-016）。详见 §六。

**测试要点**: 引用达 10 个 → `pickFile` 被拒绝并触发上限提示（FR-017）；
删除文本中的 `@` → `open=false` 且引用同步移除；`buildAttachments()` 输出结构化数组（FR-016）。

### `useWorkspace()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `dirs` | `Readonly<Ref<WorkspaceDir[]>>` | 9 个目录（含空目录） |
| `loading` | `Readonly<Ref<boolean>>` | |
| `error` | `Readonly<Ref<ErrorInfo \| null>>` | 拉取失败（失败时保持 9 个空目录，避免界面塌陷）（**实现超集**） |
| `load()` | `() => Promise<void>` | 拉取（FR-031） |
| `filesOf(dir)` | `(dir: string) => WorkspaceFile[]` | 取某目录文件（未知目录返回 `[]`） |
| `exists(ref)` | `(r: FileReference) => boolean` | 引用存在性校验（FR-018） |

**实现超集**: 同文件另导出 `emptyWorkspace(): WorkspaceDir[]`（生成 9 个空目录的占位）。
`load()` 会按 `constants/directories.ts` 的**顺序与集合归一化**后端返回：缺失目录补空、未知目录丢弃，
以保证三处 UI 口径一致（SC-021）。

**测试要点**: 返回 9 个目录且顺序与常量一致；空目录 `files=[]`；
`exists` 对不存在文件返回 `false`。

### `useSessionSearch()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `isOpen` / `keyword` | `Ref` | |
| `matches` | `ComputedRef<{messageId:string; index:number}[]>` | 跨消息匹配 |
| `baseOf` | `ComputedRef<Map<string, number>>` | 每条消息内首个命中的全局序号（供 `MessageBubble.matchIndexBase`）（**实现超集**） |
| `activeIndex` | `Readonly<Ref<number>>` | |
| `total` | `ComputedRef<number>` | |
| `activeMessageId` | `ComputedRef<string \| null>` | 当前定位的消息 id（**实现超集**） |
| `open()` | `() => void` | 展开搜索栏（**实现超集**，与 `close()` 配对；`isOpen` 在实现中为可写 ref） |
| `next()` | `() => void` | 循环跳转（FR-030） |
| `close()` | `() => void` | 清空并收起 |

**测试要点**: 无匹配 → `total=0`；`next()` 到末尾回到 0；关键词为空 → `matches=[]`。

### `usePreview()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `target` | `Readonly<Ref<PreviewTarget>>` | |
| `content` | `Readonly<Ref<PreviewContent \| null>>` | |
| `loading` | `Readonly<Ref<boolean>>` | |
| `openFile(ref)` | `(r: FileReference) => Promise<void>` | 打开内联预览（FR-046） |
| `openLink(href)` | `(href: string) => void` | 外部地址直接跳转（FR-045） |
| `download(ref)` | `(r: FileReference) => void` | 触发下载（直链，无大小上限，FR-047）；**实现超集**，见 §六 |
| `close()` | `() => void` | 收起预览区 |

**测试要点**: `openLink` 不改变 `target`（FR-045）；`.xlsx` → `renderMode='download'`；
`413` → `error` 且提供下载引导（FR-048）；`404` → `error`。

**实现超集（PDF 预检，2026-09-10 联调补）**: `.pdf` 不再直接把直链交给 `<iframe>`——
先经 `files.probePreview()` 探一次（只取状态码，成功后立即放弃响应体），
`413` / `404` 等非 2xx 落到 `renderMode='error'` + 下载引导，2xx 才渲染 `<iframe>`。
原因：`.pdf` 走 iframe 时前端读不到响应体，浏览器对 413 通常也不触发 `error` 事件，
否则 FR-048 的"文件过大 + 下载引导"在 PDF 路径上无法达成。见 `backend-api.md` §5.4。

### `useToast()`

| 成员 | 类型 | 说明 |
|---|---|---|
| `items` | `Readonly<Ref<ToastItem[]>>` | 最多 3 条 |
| `push(level, text, action?)` | `(level: ToastLevel, text: string, action?: ToastAction \| null) => string` | 4s 自动消失；返回该条 `id`（**实现超集**：签名带返回值） |
| `dismiss(id)` | `(id: string) => void` | |
| `runAction(id)` | `(id: string) => void` | 执行该条的操作并关闭它（**实现超集**，`ToastHost` 的 `action` 事件接线） |
| `clear()` | `() => void` | 清空全部提示（**实现超集**） |

**测试要点**: 超过 3 条时移除最早的；`action` 可执行并关闭该条。

### `useChatPanel()`（装配 view-model，**契约外新增**）

`ChatPanel.vue` 的接线层（T081：为满足单文件 ≤500 行而拆分）。

| 成员 | 类型 | 说明 |
|---|---|---|
| `chat` / `threads` / `search` / `models` / `uploads` / `mention` / `workspace` / `agents` | store | 直接转发注入上下文中的实例，不新建状态 |
| `uploadOpen` / `agentPanelOpen` / `workspaceOpen` | `Ref<boolean>` | 纯 UI 浮层开关（本层唯一自有状态） |
| `streaming` | `ComputedRef<StreamingView \| null>` | 本轮瞬态；`completed` 由刷新后的历史消息承载，故仅 `streaming` / `failed` / `aborted` 下传 |
| `isFailed` / `errorInfo` / `sending` / `hasMessages` | `ComputedRef<...>` | 派生态 |
| `onSend` / `onStop` / `onLoadMore` / `onRecover` / `onFeedback` / `onToggleThinking` / `onSelectModel` / `onToggleUpload` / `onCloseUpload` / `onPickFiles` / `onRetryUpload` / `onToggleSearch` / `onToggleWorkspace` / `onSearchKeyword` / `onToggleAgent` / `onCloseAgentPanel` / `onSwitchAgent` / `onOpenLink` / `onOpenFile` / `onUpdateDraft` / `onSendFromToolbar` / `onInputText` / `onPickDir` / `onPickFile` / `onMentionKey` / `onRemoveReference` | 事件处理器 | 覆盖发送、中断、加载更早、断连恢复、反馈、思考、模型、上传、搜索、工作空间、数字人、跳转/预览与 `@` 引用等全部意图 |

**为什么不算组件契约**: 见 §六 6.4。

---

## 五、纯函数契约（`src/utils/`）

| 函数 | 签名 | 说明 |
|---|---|---|
| `parseSseChunk` | `(buffer: string, chunk: string) => { events: SseEvent[]; rest: string }` | 跨 chunk 行缓冲；空行分隔事件；忽略注释行（`:` 开头）（D5） |
| `buildSegments` | `(content: string, keyword?: string, matchIndexBase?: number) => ContentSegment[]` | 输出可拼接还原原文的分段数组（D7）；类型 `ContentSegment` / `SegmentType` 一并导出 |
| `countMatches` | `(content: string, keyword: string) => number` | 命中计数；**与 `buildSegments` 高亮同口径**（`useSessionSearch` 与 `MessageList` 共用）（**实现超集**） |
| `formatTokens` | `(usage: Usage \| null \| undefined) => string` | 如 `输入 10 · 输出 5 tokens`；空值返回 `''`（**偏差**：签名放宽） |
| `formatDuration` | `(seconds: number \| null \| undefined) => string` | 保留 1 位小数 + `s`（**偏差**：签名放宽） |
| `formatFileSize` | `(bytes: number \| null \| undefined) => string` | `KB`/`MB`（**偏差**：签名放宽） |
| `formatTimestamp` | `(iso: string \| null \| undefined) => string` | 本地化时间（**偏差**：签名放宽） |
| `resolvePreviewKind` | `(filename: string) => PreviewKind`（`'text' \| 'pdf' \| 'download' \| 'unsupported'`） | 按扩展名分派（D12）；类型 `PreviewKind` 一并导出 |
| `fileExtension` | `(filename: string) => string` | 取小写扩展名，大小写不敏感（**实现超集**） |
| `toUserMessage` | `(error: ErrorInfo, context?: ErrorMessageContext) => string` | 错误码 → 中文文案，未知码兜底并保留原码（D13 / V-12）；`context` 默认 `'default'`（**偏差**：新增第二参数） |
| `toErrorInfo` | `(error: unknown) => ErrorInfo` | 把任意抛出物归一化为 `ErrorInfo`（**实现超集**；网络层与各 composable 统一入口） |
| `isUploadAllowed` | `(file: {name: string; size: number}) => UploadPrecheckResult` | 上传预校验（FR-010）；返回类型 `UploadPrecheckResult`（`{ ok, code? }`）一并导出 |
| `SPACE_DIRECTORIES` | `readonly SpaceDirectory[]` | 9 目录唯一来源（SC-021）。**归属修正**：定义在 `src/constants/directories.ts`（非 `src/utils/`）；同文件另导出 `directoryLabel(dir: string): string`（目录展示名） |

**说明**: 上表除 `SPACE_DIRECTORIES` 外均位于 `src/utils/`；`ErrorMessageContext` 为
`'default' \| 'create-thread' \| 'send-message' \| 'upload' \| 'preview'`（见 `src/utils/error-message.ts`）。

---

## 六、实现对照与超集登记（T084 回写）

**依据**: 实现完成后逐文件比对（`src/components/**/*.vue`、`src/composables/*.ts`、`src/utils/*.ts`）。

本文件在实现期间作为"组件与 composable 的稳定接口"使用。实现过程中为满足可用性、可访问性、
依赖注入装配与**单文件 ≤500 行**（宪章原则二）做了少量**纯增量超集**与**签名偏差**。本节的职责是：

1. 把它们登记为契约的一部分，避免后续被误判为"实现漂移"；
2. 区分**稳定接口**（上文对应表格已就地更新）与**内部实现细节**（不改契约，仅备查）。

分类口径：

- **实现超集**: 纯增量（新增 props / emits / slots / 成员），不改变任何既有语义，既有调用方不受影响。
- **签名偏差**: 契约原值 → 实现值；需要以实现为准，上文对应表格已就地修正。

### 6.1 签名偏差（以上文表格为准）

| 位置 | 契约原值 | 实现值 | 原因 |
|---|---|---|---|
| `MessageList.streaming`、`MessageBubble.streaming` | `RunState \| null` | `StreamingView \| null`（`{ phase, text, thinking, toolCalls, error }`） | 表格列的是 `RunState`（`data-model.md` §13）的**渲染投影**，而非 store 内部结构：只保留渲染所需字段（`streamingText` → `text`、`streamingThinking` → `thinking`，省略 `startedAt` / `thinkingEnabled`），并补上 `RunState` 不含的 `error`。该类型在 `MessageList.vue` 与 `MessageBubble.vue` 内**各自本地声明**（结构性类型，非导出契约） |
| `MessageList.messages`、`HistorySidebar.threads` | 必填 | 可选，默认 `[]` | 加载态与空态复用同一组件，避免父级传 `undefined` |
| `Composer.directories` | 必填 | 可选，默认 `SPACE_DIRECTORIES` | 与 `UploadMenu` / `MentionPicker` 口径一致，默认取唯一来源常量（V-01） |
| `BaseButton.type` | `'button' \| 'submit'` | 追加 `'reset'` | 原生按钮类型完整覆盖 |
| `useThreads.showMore()` | `() => Promise<void>` | `() => void`（同步） | 纯前端切片，无异步工作 |
| `useChatStream.thinkingEnabled` | `Readonly<Ref<boolean>>` | `Ref<boolean>`（可写） | 需持久化到 `sessionStorage`，并由 `setThinking()` 驱动 |
| `useChatStream.canSend` | `… && content 非空` | `… && draft 非空` | 输入文本由 `draft` 承载（见 6.3），发送后置空、失败时回填 |
| `useSessionSearch.isOpen` | `Ref` | 可写 `Ref`（配 `open()`） | 展开/收起需由装配层双向驱动 |
| `useFileMention.pickFile` | `—` | `(ref) => boolean` | 超限/重复时需区分"已加入"与"被拒绝"，供装配层决定是否插入正文标记 |
| `formatTokens` / `formatDuration` / `formatFileSize` / `formatTimestamp` | 非空入参 | 接受 `null \| undefined`，返回 `''` | 消息字段可缺省（进行中/中断轮无用量与耗时），避免调用方层层判空 |
| `toUserMessage` | `(error) => string` | `(error, context?) => string` | 同一错误码在不同场景语义不同（`backend-api.md` §7 差异 6）；`context` 默认 `'default'` |
| `SPACE_DIRECTORIES` 归属 | `src/utils/` | `src/constants/directories.ts` | 与 `limits` / `events` 同归常量层；`src/utils/` 只放纯函数 |

### 6.2 组件层超集一览

| 组件 | 新增项 | 类型 | 用途 |
|---|---|---|---|
| `AppShell` | slots `history` / `chat` | slot | `sidebar` / `main` 的别名插槽（兼容 `tasks.md` 的 `#history` / `#chat` 接线口径） |
| `HistoryItem` | prop `running` | `boolean` | 列表接口不返回 `running`（仅详情返回），由 `HistorySidebar` 派生传入 |
| `HistoryItem` / `HistorySidebar` | emits `remove` | `thread_id: string` | 行内删除入口（§3.5）；二次确认与相邻会话切换由 `App.vue` 编排 |
| `ConfirmDialog`（新组件） | props `title` / `message` / `confirmLabel` / `cancelLabel` / `danger` / `busy`；emits `confirm` / `cancel` | — | 破坏性操作的二次确认，基于 `BaseDialog` |
| `MessageList` | emits `feedback` / `open-link` / `open-file`；slot `empty` | — | 事件向上透传至 `useChatPanel` 编排；空态占位可替换 |
| `MessageList` | 自动置底（切换会话 / 新消息 / 流式跟随；前插不打扰） | — | 聊天应用的基本预期，规范未要求 |
| `MessageBubble` | prop `streaming`；emits `retry` / `open-link` / `open-file` | — | 瞬态（思考/工具）不入 `Message`（V-04）；失败重试与跳转透传 |
| `MessageActions` | prop `copyText` | `string` | 剪贴板写入 + "已复制"反馈在组件内完成；选中态仍受控（V-08 的换算在 `MessageBubble`） |
| `Composer` | props `placeholder` / `mentionOpen`；emits `input-text` / `mention-key`；slot `mention` | — | 支持 US4 的 `@` 触发与键盘让位（`data-model.md` §14 的 `mentionOpen` 状态字段经此 prop 下传）；`mention` 插槽由装配层填 `MentionPicker` |
| `BaseButton` | prop `disabledReason` | `string \| null` | 禁用原因经 `title` 暴露（FR-036 的"说明原因"） |
| `BaseDropdown` | slot `trigger` | slot | 触发器内容自定义（`ModelPicker` 用于展示当前模型名） |
| `ErrorNotice` | prop `context` | `ErrorMessageContext` | 场景化文案（如预览区 `413` → "文件过大"并引导下载，FR-048） |

### 6.3 composable 层超集一览

均在 §四 对应表格中就地登记，此处只做归组，便于评审：

| composable | 新增成员 |
|---|---|
| `useAppSession` | 选项 `storage`；返回 `mention` / `now`；导出 `APP_SESSION_KEY` / `useSession` / `createAppSession` |
| `useAgents` | `loading` / `switching` / `error` / `loadCandidates()` / `refreshMcp()` |
| `useThreads` | `visible` / `total` / `loading` / `error` / `patchFeedback()` |
| `useChatStream` | `draft` / `error` / `usage` / `durationSeconds` / `startedAt` / `hasThinking` / `submitFeedback()` / `setThinking()` |
| `useModels` | `loading` / `error` / `isDefaultSelected` |
| `useFileMention` | `directories` / `optionCount` / `maxReached` / `missingReferences()`；模块级 `mentionToken()` / `stripMentionTokens()` |
| `useWorkspace` | `error`；模块级 `emptyWorkspace()` |
| `useSessionSearch` | `baseOf` / `activeMessageId` / `open()` |
| `usePreview` | `download()` |
| `useToast` | `runAction()` / `clear()`；`push()` 返回 `id` |

已导出但契约未列的类型：`UploadStatus` / `UploadedDocument`（`useUploads`）、
`ToolCallState` / `ChatStreamStore`（`useChatStream`）、`PreviewTarget` / `PreviewContent`（`usePreview`）、
`ToastLevel` / `ToastItem` / `ToastAction`（`useToast`）、`MentionStage`（`useFileMention`）、
`SearchMatch`（`useSessionSearch`）、`AppSession`（`useAppSession`）、
`SegmentType` / `ContentSegment`（`segments`）、`PreviewKind` / `UploadPrecheckResult`（`file-kind`）、
`ErrorMessageContext`（`error-message`）。

### 6.4 契约未收录的模块

| 模块 | 定位 | 为什么不算契约变更 |
|---|---|---|
| `composables/useChatPanel.ts` | `ChatPanel.vue` 的装配 view-model：跨 composable 的事件编排、纯 UI 开关（`uploadOpen` / `agentPanelOpen` / `workspaceOpen`）与生命周期（首轮 `models.load()`、`agents.loadCurrent()` + `startMcpPolling()`） | **不是组件对外契约**，而是 T081（单文件 ≤500 行）的拆分产物。状态来源不变——一律取自 `provide/inject` 的会话上下文，不新增字段来源、不持有业务数据。`ChatPanel` 的 props / 模板与各子组件的 props / emits 契约不受影响；其成员清单见 §四 末节 |
| `constants/directories.ts` | `SPACE_DIRECTORIES` + `directoryLabel()` | 见 6.1 最后一行（归属修正）；三处 UI 同源（V-01 / SC-021） |

### 6.5 复核结论

- §一 / §二 / §三 的组件 props / emits / slots、§四 的 composable 成员、§五 的纯函数签名，
  已与实现**逐项对齐**；6.1 所列偏差均已就地修正。
- 超集均为**纯增量**，未改变任何已声明语义；`quickstart.md` §四 S1–S14 与 §六 契约核对清单的
  结论不受影响（T082 / T083 已通过）。
- 后续新增超集时，请同步更新本节与其对应表格，保持"实现 = 契约"。
