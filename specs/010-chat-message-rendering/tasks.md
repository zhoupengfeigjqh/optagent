# 任务清单：聊天消息渲染（最小 Markdown 子集 / 代码块 / 分段）与会话导出

**输入**：设计文档位于 `specs/010-chat-message-rendering/`

**前置**：`plan.md`（必需）、`spec.md`（必需，含 5 个用户故事与 52 条功能需求）

**测试**：本项目宪章**原则三（测试完备性）为 NON-NEGOTIABLE**，且 `spec.md` 每条功能需求均附「验证方式」、
`plan.md` §「测试落点」已列出文件级落点 ⇒ **测试任务必须包含**（非可选项）。
测试**只在宿主机本地执行**，容器不参与测试。

**组织方式**：先按用户故事分组（可独立实现与独立验收），最后是**收口阶段**——
收口阶段的任务（T040~T050）是本次同时暴露的宪章偏差纠正，属"必须做"，不是可选项。

## 格式：`[ID] [P?] [Story] 描述 + 文件路径`

- **[P]**：可并行（不同文件、且不依赖未完成的任务）
- **[Story]**：所属用户故事（`US1`~`US5`）；**Setup / Foundational / Polish 阶段不带故事标签**
- 每条任务 MUST 含**精确文件路径**
- 勾选状态说明：`[x]` = 代码已落地（2026-10-16 实现，本次补登记）；`[ ]` = 待办

## 路径约定

- 前端源码：`frontend/src/**`（测试与源码同目录 `*.spec.ts`）
- 门禁配置：`frontend/vite.config.ts`（覆盖率两层阈值）
- 设计文档：`specs/010-chat-message-rendering/**`
- **本特性零后端改动**：`agent-backend/**`、`admin-backend/**`、`admin-frontend/**` 不在任务范围内

---

## Phase 1：准备（Setup）

**目的**：为"改动已落地、规格后补"的现状建立可核对的起点。

- [x] T001 记录基线实测：三个待拆文件的行数（`MessageList.vue` 677 / `useChatStream.ts` 594 / `useChatPanel.ts` 594，口径 `ReadAllLines().Length`）、当前全局覆盖率地板（`59 / 63 / 48 / 58`）与各模块实测值
- [x] T002 [P] 核对"零新增依赖"：`frontend/package.json` 的 `dependencies` / `devDependencies` 与改动前一致（未新增 Markdown 渲染器或 HTML 净化器）
- [x] T003 [P] 登记"先落代码、后补规格"的事实与理由（写入 `spec.md` 文首「登记说明」），并列出需回写的上游条文 3 项

---

## Phase 2：基础（Foundational）

**目的**：纯函数与渲染节流底盘——US1~US5 全部依赖它们。

**⚠️ 关键**：本阶段完成前不要开始任何用户故事。

- [x] T004 新增 `frontend/src/utils/markdown.ts`：`parseMarkdown` / `parseInline` + `Piece` / `InlineRun` / `MarkdownBlock`（块级 7 类、行内 4 类，每个片段带原文偏移 `start`）
- [x] T005 [P] 新增 `frontend/src/utils/markdown.spec.ts`：块级 / 行内 / 不支持语法原样输出 / 偏移正确性 / 未闭合围栏（FR-001~FR-006、FR-009）
- [x] T006 改 `frontend/src/utils/segments.ts`：新增 `findMatches`（与 `buildSegments` 的匹配语义同源，供渲染层换算全局序号）；改写头部注释（"按纯文本渲染"口径作废，"零依赖"结论保留）
- [x] T007 [P] 扩展 `frontend/src/utils/segments.spec.ts`：`findMatches` 与 `countMatches` 同源断言、可拼回不变式（FR-008、FR-020）
- [x] T008 新增 `frontend/src/utils/export-thread.ts`：`threadToMarkdown` / `exportFilename`（纯函数，不碰 DOM）
- [x] T009 [P] 新增 `frontend/src/utils/export-thread.spec.ts`：结构 / 角色标签 / 非正文信息不许丢 / 文件名净化（FR-030、FR-032~FR-035）
- [x] T010 新增 `frontend/src/utils/download.ts`：`downloadTextFile`（`Blob` + 临时 `<a download>` + 下一轮任务撤销对象 URL）
- [x] T011 [P] 新增 `frontend/src/composables/useThrottledText.ts`：`STREAM_TEXT_INTERVAL_MS = 50` + `useThrottledText`（尾帧合并 / 变短即复位 / 卸载清理）
- [x] T012 [P] 新增 `frontend/src/composables/useThrottledText.spec.ts`：窗口合并 / 复位 / 卸载清理（假定时器）（FR-040~FR-043）

**检查点**：`markdown.ts` 与既有 `segments.ts` 的解析口径一致（偏移可换算）；`useThrottledText` 不影响 `useChatStream` 的既有断言。

---

## Phase 3：用户故事 1 —— 正文按最小 Markdown 子集结构渲染（优先级：P1）

**故事目标**：标记本身不出现在页面上，结构正确，且原文一个字符都不丢。

**独立验收**：`MessageContent` 组件测试断言 `h4` / `li` / `th` / `td` / `pre code` / `strong` / `em` / `code` / `a` 存在，
`wrapper.text()` 不含 `##` 与 `| ---`；段落与手动换行保留；伪协议链接退化为纯文本。

- [x] T013 [US1] 新增 `frontend/src/components/chat/MessageSegments.vue`：分段 → DOM（文本 / `<mark>` / 外链），`.mark` 与外链样式**唯一来源**，外链 `target="_blank"` + `rel="noopener noreferrer"` 并派发 `open-link`
- [x] T014 [US1] 改 `frontend/src/components/chat/MessageContent.vue`：块级分发（代码块 / 表格 / 列表 / 段落 / 标题 / 引用 / 分隔线）+ 行内渲染 + `matchesBefore` 二分换算序号（`ViewBlock` / `ViewRun` 字段一律存在）
- [x] T015 [P] [US1] 改 `frontend/src/components/chat/MessageContent.spec.ts`：结构 / 行内 / 段落 / **跨结构序号连续性** / 已知取舍（命中落在被丢弃的标记里）/ 外链派发（FR-001~FR-011、FR-020、FR-021、FR-027）
- [x] T016 [US1] 运行本故事定向测试并确认通过；**停止并验证**：结构渲染可独立交付（仅正文渲染即可演示）

**检查点**：`MessageContent.vue` 行数 330（≤500）。

---

## Phase 4：用户故事 2 —— 代码块等宽、横向滚动、一键复制（优先级：P1）

**故事目标**：点「复制」拿到的是代码原文；剪贴板不可用时静默降级。

**独立验收**：点击 `.message-code__copy` 后 `navigator.clipboard.writeText` 收到逐字等于代码原文的字符串；
「已复制」约 2 秒后复原。

- [x] T017 [US2] 新增 `frontend/src/components/chat/MessageCodeBlock.vue`：角标（缺省 `code`）、`<pre>` 横向滚动、复制按钮（`aria-label` 随状态切换）、2 秒反馈、失败静默、卸载清定时器
- [x] T018 [US2] 复制正文取**分段无损拼接**（`segments.map(s => s.text).join('')`），MUST NOT 读 DOM
- [x] T019 [P] [US2] 新增 `frontend/src/components/chat/MessageCodeBlock.spec.ts`（**本次补**，宪章偏差纠正）：角标兜底 / 复制原文 / 反馈翻转与复原（假定时器）/ 剪贴板缺失与抛错两态 / 空代码不写入 / 卸载清理（FR-023~FR-026）——9 例
- [x] T020 [P] [US2] 新增 `frontend/src/components/chat/MessageSegments.spec.ts`（**本次补**）：纯文本 / 高亮（带 `data-match-index`）/ 外链（`href` / `target` / `rel`）/ 高亮+链接叠加 / 点击派发 `open-link` / 无 `href` 不派发（FR-021、FR-027）——9 例
- [x] T021 [US2] 运行本故事定向测试并确认通过；**停止并验证**：代码块复制可独立交付

**检查点**：`MessageCodeBlock.vue` 136 行、`MessageSegments.vue` 77 行（均 ≤500）。

---

## Phase 5：用户故事 3 —— 会话导出为 Markdown 文件（优先级：P2）

**故事目标**：导出稿含全部消息（不受中栏分页限制），且非正文信息一条不丢；失败不产生空文件。

**独立验收**：多页夹具下导出稿条数与顺序正确；标题 / 元信息 / 分隔线 / 角色标签 / 引用 / 工具 / 失败行齐全；
文件名净化与空标题兜底正确；拉取失败时 `downloadTextFile` 未被调用。

- [x] T022 [US3] 改 `frontend/src/composables/useThreads.ts`：`exportMarkdown`（失败返回 `null` 且已提示）+ `fetchAllMessages`（按 `MESSAGE_PAGE_MAX` 全量翻页、页序反转后拼接）+ `rename`（乐观更新 + 失败回滚）
- [x] T023 [P] [US3] 改 `frontend/src/composables/useThreads.spec.ts`：多页夹具的全量拉取（顺序 / 条数 / 空页终止）/ 失败分支返回 `null` / `rename` 的三态（未改动不发请求、成功、失败回滚）
- [x] T024 [US3] 改 `frontend/src/components/layout/HistoryItem.vue`：操作区三项（重命名 / 导出 Markdown / 删除），`opacity` 悬停与 `focus-within` 显形，`disabled` 三入口一律不发事件
- [x] T025 [P] [US3] 改 `frontend/src/components/layout/HistorySidebar.vue`：`rename` / `export` 事件透传
- [x] T026 [US3] 改 `frontend/src/views/WorkbenchView.vue`：`onExportThread`（查列表 → 全量拉取 → `null` 即返回 → `downloadTextFile`）+ `onRenameThread` 转发
- [x] T027 [P] [US3] 新增 `frontend/src/components/layout/HistoryItem.spec.ts`：行内编辑进入 / Enter / 失焦 / Esc（含 `stopPropagation`）/ 空标题与未改动不发请求 / `disabled` 三入口 / 导出与删除事件载荷
- [x] T028 [US3] 运行本故事定向测试并确认通过；**停止并验证**：导出可独立交付

---

## Phase 6：用户故事 4 —— 流式渲染节流与滚动跟随（优先级：P2）

**故事目标**：长回答不发卡；用户上翻不被打扰，回到近底部即恢复；本端发送强制置底；读屏只播结论。

**独立验收**：上翻后流式增量不改变视口；回到底部按钮显隐与 `atBottom` 同步；切会话恢复 / 不恢复符合 FR-047；
「加载更早的消息」只补偿高度；播报只在新的 assistant 消息落定时更新。

- [x] T029 [US4] 改 `frontend/src/composables/useChatPanel.ts`：接线 `streamingTextView` / `streamingThinkingView`（`useThrottledText`），`streaming` 计算属性改取渲染影子；`canRegenerate` 判据保持不变
- [x] T030 [US4] 改 `frontend/src/components/chat/MessageList.vue`：`atBottom` 单一真源 + 自动置底 + 上翻暂停 + 「回到底部」按钮 + 会话位置记忆（上限 50）+ 前插补偿高度 + 本端发送强制置底 + `ResizeObserver` 守卫 + 读屏只播结论
- [x] T031 [P] [US4] 改 `frontend/src/components/chat/MessageList.spec.ts`：跟随 / 暂停 / 恢复 / 按钮显隐与点击 / 强制置底 / 「加载更早消息」补偿 / 播报三态（完成播、失败与中断不播）/ 流式正文 `aria-live="off"`
- [x] T032 [US4] 运行本故事定向测试并确认通过；**停止并验证**：节流与滚动可独立交付

---

## Phase 7：用户故事 5 —— 会话重命名与按会话分桶的草稿（优先级：P3）

**故事目标**：行内改名不误伤正在输出的回答；草稿与会话一一对应，不串台、不丢、不冒幽灵。

**独立验收**：Esc 只收编辑框（不触发"Esc 中断本轮"）；切换会话草稿存旧取新；`null` 会话不建桶。

- [x] T033 [US5] 改 `frontend/src/composables/useChatStream.ts`：草稿按会话 id 分桶（`drafts` Map + `stashDraft` + 上限 50），切会话时"存旧、清流式状态、取新"三件事同一时刻完成
- [x] T034 [P] [US5] 改 `frontend/src/composables/useChatStream.spec.ts`：分桶存旧取新 / 空串不留桶 / `null` 不建桶 / 上限淘汰（FR-064）
- [x] T035 [US5] `HistoryItem.vue` 行内重命名的确认与取消（FR-060~FR-063，落点见 T024 / T027）
- [x] T036 [US5] 运行本故事定向测试并确认通过；**停止并验证**：重命名与草稿可独立交付

---

## Phase 8：收口（Polish）—— 宪章偏差纠正与门禁

**目的**：把本次改动**触达**的三类宪章偏差一次性纠正并留下证据。

### 8.1 补齐缺失的同名测试（原则三 / FR-071）

- [x] T040 [P] 新增 `frontend/src/utils/download.spec.ts`：`downloadTextFile` 的 `Blob` 类型与内容、`<a download>` 属性、**点击时锚点确实挂在文档里**、点击后移除、对象 URL **在下一轮任务**中被 `revokeObjectURL`（假定时器）、自定义 `mime` 覆盖（FR-037）——5 例
- [x] T041 [P] 新增 `frontend/src/components/chat/MessageCodeBlock.spec.ts`（= T019）
- [x] T042 [P] 新增 `frontend/src/components/chat/MessageSegments.spec.ts`（= T020）

### 8.2 拆分超限文件（原则二 / FR-070）

- [x] T043 拆分 `frontend/src/components/chat/MessageList.vue`（677 → **493**）：把"滚动跟随 / 位置记忆 / 读屏播报"整体抽为 `frontend/src/composables/useMessageScroll.ts`，`MessageList` 只保留 props / emits / 派生数据与模板；**零行为变化**（既有 17 例组件测试全绿，断言口径未改）
- [x] T044 [P] 新增 `frontend/src/composables/useMessageScroll.spec.ts`：跟随 / 暂停 / 恢复 / 存档键与上限 / 贴底离开不存档 / 强制置底，并覆盖组件层到不了的两条路径（存档上限 50 的淘汰、`ResizeObserver` 分支）——11 例
- [x] T045 拆分 `frontend/src/composables/useChatStream.ts`（594 → **402**）：抽出 `frontend/src/composables/useInteractionGate.ts`（HITL 三函数）、`frontend/src/composables/useThreadDrafts.ts`（草稿分桶）、`frontend/src/utils/thinking-storage.ts`（`sessionStorage` 读写），并把**契约**（状态形状 + 依赖注入面）移入 `frontend/src/composables/useChatStream.types.ts`（纯类型，无运行期语句 → 与 `src/api/types.ts` 同口径排除出覆盖率分母；类型经 `useChatStream.ts` 再导出，既有导入路径不变）；**零行为变化**
- [x] T046 [P] 新增 `frontend/src/composables/useInteractionGate.spec.ts`（重建 / 提交成功 / 终验失败保持打开并回显 / 拒绝失败提示——10 例）、`frontend/src/composables/useThreadDrafts.spec.ts`（存旧取新 / `null` 不建桶 / 上限淘汰——6 例）、`frontend/src/utils/thinking-storage.spec.ts`（读 / 写 / 存储不可用降级——6 例）
- [x] T047 拆分 `frontend/src/composables/useChatPanel.ts`（594 → **488**）：抽出 `frontend/src/composables/useMentionComposer.ts`（`@` 引用的编辑器侧接线：标记插入 / 移除同步 / 按键路由——114 行）与 `frontend/src/composables/useNextStepPrompt.ts`（下一步动作卡片确认弹窗状态机：三处不可用态拒绝、真发出才关弹窗——86 行）；**零行为变化**（返回对象用展开而非逐条重列，避免清单两处各维护一份）
- [x] T048 [P] 新增 `frontend/src/composables/useMentionComposer.spec.ts`（10 例）、`frontend/src/composables/useNextStepPrompt.spec.ts`（9 例）（拆分行为锁）
- [x] T049 拆分后取证：三个原文件与其拆出模块的行数（全部 ≤500），见本文件「执行记录」

### 8.3 覆盖率阈值登记与地板上调（原则三 / FR-072、FR-073）

- [x] T050 单次 `cd frontend && npm run test:coverage`，取得**最终**实测值：全局 `78.01 / 75.87 / 68.80 / 78.69`；各新模块见 `plan.md §覆盖率缺口处置结论`
- [x] T051 改 `frontend/vite.config.ts`：把 `src/utils/markdown.ts`、`src/utils/export-thread.ts`、`src/utils/download.ts`、`src/composables/useThrottledText.ts` 与 T043~T047 拆出的 6 个模块（`useMessageScroll` / `useInteractionGate` / `useThreadDrafts` / `utils/thinking-storage` / `useMentionComposer` / `useNextStepPrompt`）登记进 80% 阈值清单（阈值取宪章下限 80%，实测值写入行末注释）；同时把纯类型文件加进 `coverage.exclude`
- [x] T052 上调全局地板至"略低于实测值"（`59 / 63 / 48 / 58` → `76 / 74 / 66 / 77`，MUST NOT 下调），并更新 `vite.config.ts` 的日期与实测四项数值注释
- [x] T053 复核「搜索高亮按原文计数」口径的落点：`specs/002-conversation-runtime/spec.md` **从未**规定过该口径（只存在于代码注释），故**无需回写**；改判为由本特性 `spec.md` `FR-020` / `FR-021` **首次写入规格**（结论已回写两处清单）

### 8.4 全量门禁（原则八）

- [x] T054 `cd frontend && npm run test`：**76 文件 / 900 例全绿**
- [x] T055 [P] `cd frontend && npm run lint`（**0 problem**）
- [x] T056 [P] `cd frontend && npm run typecheck`（`vue-tsc --build --force` **退出码 0**）
- [x] T057 实测证据已写入本文件「执行记录」，含"未做/未覆盖"的诚实结论

**检查点**：SC-005~SC-009 全部可复核（行数、同名测试、阈值、门禁、零新增依赖）。

---

## 执行记录

> 由收口阶段（T049~T057）填写；未完成的项 MUST 如实标注为"未做"，MUST NOT 留空冒充完成。

**取证日期**：2026-10-16；**行数口径**：`[System.IO.File]::ReadAllLines(<file>).Length`（宿主机 PowerShell）。

### 1. 行数（宪章原则二 / FR-070）

| 文件 | 拆分前 | 拆分后 | 结论 |
|---|---|---|---|
| `components/chat/MessageList.vue` | 677 | **493** | ≤500 ✅（余量 7 行 → 观察项见下） |
| `composables/useChatStream.ts` | 594 | **402** | ≤500 ✅ |
| `composables/useChatPanel.ts` | 594 | **488** | ≤500 ✅ |

拆出模块（全部 ≤500）：`useChatStream.types.ts` 148、`useMessageScroll.ts` 220、`useInteractionGate.ts` 112、`useThreadDrafts.ts` 54、`utils/thinking-storage.ts` 36、`useMentionComposer.ts` 114、`useNextStepPrompt.ts` 86。
本特性新增模块：`utils/markdown.ts` 313、`utils/segments.ts` 255、`utils/export-thread.ts` 74、`utils/download.ts` 22、`composables/useThrottledText.ts` 64、`MessageSegments.vue` 77、`MessageCodeBlock.vue` 136、`MessageContent.vue` 330。

### 2. 门禁（宪章原则八 / SC-005~SC-009）

| 项 | 实测 | 证据 |
|---|---|---|
| 全量单测 | **76 文件 / 900 例全绿**（修复后 1 例"假通过"用例：定时器回调只改 ref，断言前补 `nextTick`） | `npm run test` |
| 覆盖率门禁 | **退出码 0**；全局 `stmts 78.01 / branch 75.87 / funcs 68.80 / lines 78.69`（新地板 `76 / 74 / 66 / 77`） | `npm run test:coverage` |
| 模块阈值 | 新登记 10 个模块全部 ≥80%（最低 `useMessageScroll` 分支 80.39、`utils/thinking-storage` 87.5） | `frontend/vite.config.ts` |
| lint | **0 problem**（修掉 1 处 `no-unused-vars`：契约文件多余的 `StreamEvent` 导入） | `npm run lint` |
| typecheck | **退出码 0**（修掉 4 类错误：`ToolCallState` 未导入、`FileReference` 夹具用错形状、测试 harness 的 `never` 收窄） | `npm run typecheck` |
| 零新增依赖 | `frontend/package.json` 依赖段未改（自研最小子集，无 Markdown 渲染器 / 净化器） | 依赖清单比对 |

### 3. 未做 / 未覆盖（如实登记）

1. **`useChatPanel.ts` / `useChatStream.ts` / `useThreads.ts` 未登记模块阈值**：三者属"20 个缺口模块"，其**整体**口径（如 `useChatPanel` 分支 49.01 / 函数 27.27）低于 80%。登记即等于对该文件发起存量补齐专项，与「治理 § 不追溯」冲突；本次只覆盖**改动到的行为**（HITL / 草稿 / `@` 引用 / 卡片弹窗已拆成独立模块并达 87%~100%）。取舍理由已回写 `plan.md §覆盖率缺口处置结论` 与 `vite.config.ts` 注释。
2. **`MessageList.vue` 493 行（余量 7 行）为观察项**：已满足 ≤500，但下次再动该文件应先抽"失败轮重试解析"（`retryTurnOf` / `retryLabels`，约 45 行）到 `utils/retry-turn.ts`，避免一改就破线。
3. **`useMessageScroll.ts` 分支覆盖 80.39%**：贴着门槛。未覆盖分支主要是 `listRef` 为空时的提前返回（真实运行中挂载后不会为空）。
4. **无浏览器端手工验收记录**：`markdown.ts` 第 182-183 行、`export-thread.ts` 第 40 行等未覆盖分支，以及"长回答期间不卡顿""滚动跟随手感"这类**体感项**，本次只做到用例级验证（jsdom 不参与布局），**未做真实浏览器实测**。这条是本次交付最大的验证缺口。
5. **`specs/010-*` 为事后补登记**：规格先于代码落地这条流程约束本次已被违反（已在 `spec.md` 文首如实登记），MUST NOT 以"补登记"当成流程合规的常态。
