# 任务清单：预览面板的「放大 / 缩小」（平铺整个视口）

**输入**：设计文档位于 `specs/011-preview-maximize/`

**前置**：`plan.md`（必需）、`spec.md`（必需，含 3 个用户故事与 25 条功能需求）、`research.md`（R1~R8）、
`data-model.md`（状态模型 + 8 例判据矩阵）、`contracts/ui-contract.md`、`quickstart.md`

**测试**：本项目宪章**原则三（测试完备性）为 NON-NEGOTIABLE**，且 `spec.md` 每条功能需求均附「验证方式」、
`plan.md` §「测试落点」已列出文件级落点 ⇒ **测试任务必须包含**（非可选项）。测试**只在宿主机本地执行**，容器不参与测试。

**组织方式**：先按用户故事分组（可独立实现与独立验收），最后是**收口阶段**（门禁取证、契约核查、手工验收、回写规格）。

## 格式：`[ID] [P?] [Story] 描述 + 文件路径`

- **[P]**：可并行（不同文件，且不依赖未完成的任务）
- **[Story]**：所属用户故事（`US1`~`US3`）；**Setup / Foundational / Polish 阶段不带故事标签**
- 每条任务 MUST 含**精确文件路径**
- 勾选状态说明：本次为**首次生成、尚未实现**，故全部为 `[ ]`（实现完成并跑通对应测试后再勾）

## 路径约定

- 前端源码：`frontend/src/**`（测试与源码同目录 `*.spec.ts`）
- 门禁配置：`frontend/vite.config.ts`（覆盖率两层阈值）
- 设计文档：`specs/011-preview-maximize/**`
- **本特性零后端改动**：`agent-backend/**`、`admin-backend/**`、`admin-frontend/**` 不在任务范围内（`FR-043`）

---

## Phase 1：准备（Setup）

**目的**：建立可核对的起点（基线数值 / 依赖红线 / 契约现状），避免"改完不知道动了什么"。

- [X] T001 记录基线实测并写入 `specs/011-preview-maximize/tasks.md` 的执行记录：`WorkspacePanel.vue` 387 / `AppShell.vue` 150 / `BaseIcon.vue` 99 / `usePreview.ts` 316 / `WorkbenchView.vue` 271 / `tokens.css` 103 / `vite.config.ts` 180（口径 `[System.IO.File]::ReadAllLines().Length`）；当前全局覆盖率地板与 `src/composables/usePreview.ts` 的实测值
- [X] T002 [P] 核对"零新增依赖"红线：`frontend/package.json` 的 `dependencies` / `devDependencies` 与改动前一致（不得新增图标库或全屏 API 封装库）（`FR-040`）
- [X] T003 [P] 核对契约现状与 `contracts/ui-contract.md` 的差异：`frontend/src/components/layout/WorkspacePanel.vue` 的既有 emits、`AppShell.vue` 的既有 props、`composables/usePreview.ts` 的 `PreviewStore` 成员；有漂移即先改契约文档并在 `plan.md` 修订记录登记（宪章原则七）

---

## Phase 2：基础（Foundational）

**目的**：放大态的唯一真源与"可放大范围"判据、图标、层级令牌——US1~US3 全部依赖它们。

**⚠️ 关键**：本阶段完成前不要开始任何用户故事。

- [X] T004 改 `frontend/src/composables/usePreview.ts`：新增 `maximized`（唯一真源，初值 `false`）、派生 `maximizable`（`target.kind:'url' && renderMode:'iframe'` 或 `target.kind:'file' && content.renderMode ∈ {pdf,image}`）、派生 `maximizeToggleVisible`（`maximized || maximizable`）、`toggleMaximize()`（不可放大且未放大时**无操作**）、`restoreMaximize()`；在 `resetContent()` 内收敛 `maximized = false`（`FR-005` / `FR-007` / `FR-010` / `FR-011` / `FR-012` / `FR-013` / `FR-032`）
- [X] T005 [P] 扩展 `frontend/src/composables/usePreview.spec.ts`：**8 例判据矩阵**（iframe / PDF / 图片 = 可放大；`download` / `text` / `error` / `kind:'none'` / `list` = 不可）+ 越权 `toggleMaximize` 无操作 + 放大态下切到加载中目标时 `maximizeToggleVisible` 仍为真（I1）+ `close` / `backToList` / `openList` 三例归零（I2）+ `openFile` / `openView` 切换目标保持（`FR-012`）+ 切换不产生额外请求（`probePreview` / `fetchPreviewText` 调用次数不变）（`FR-006`）
- [X] T006 [P] 改 `frontend/src/components/common/BaseIcon.vue`：`ICON_PATHS` 新增 `maximize` / `minimize`（feather 风格 24×24 描边路径，沿用零图标库口径）
- [X] T007 [P] 新增 `frontend/src/components/common/BaseIcon.spec.ts`（**本次补齐**，宪章原则三 + 治理"改动即约束"）：`maximize` / `minimize` 渲染出 `path` 且 `d` 非空、未知名称渲染空 `path`、`label` 决定 `role` / `aria-hidden`
- [X] T008 [P] 改 `frontend/src/styles/tokens.css`：`/* ---------- 层级 ---------- */` 段新增 `--z-index-panel-maximized: 150`（MUST 低于 `--z-index-dialog: 200` 与 `--z-index-toast: 300`）

**检查点**：`usePreview.spec.ts` 全绿且未改动任何组件行为；图标与层级令牌就绪；`npm run typecheck` 通过。

---

## Phase 3：用户故事 1 —— 一键平铺、一键还原（优先级：P1）🎯 MVP

**故事目标**：在「收起」左侧给出唯一可逆入口，点一下铺满整个视口，再点一下**精确恢复**（宽度 / 内容 / 滚动位置俱在，内容不重新加载）。

**独立验收**：挂载 `WorkspacePanel`（`kind:'url'` + `renderMode:'iframe'`）与工作台视图：入口存在且 DOM 顺序为 `[下载?] → 放大 → 收起`；
`previewMaximized` 为真时 `AppShell` 根节点带 `app-shell--preview-maximized`、预览列铺满；缩回后 `iframe` 元素引用与 `src` 不变、面板宽度值不变。

- [X] T009 [US1] 改 `frontend/src/components/layout/WorkspacePanel.vue`：新增 props `maximizeVisible` / `maximized`（默认 `false`）与 emit `toggle-maximize`；头部动作区在「收起」按钮**左侧**加一枚入口（`v-if="maximizeVisible"`，`BaseIcon` 的 `maximize` / `minimize`，可访问名称 `放大页面` ↔ `缩小页面`，`aria-pressed` 同步），**同一 DOM 节点**两态复用（`FR-001` / `FR-002` / `FR-020` / `FR-022`）
- [X] T010 [US1] 改 `frontend/src/components/layout/WorkspacePanel.vue`：放大态给面板根节点 `aside.workspace-panel` 加类 `workspace-panel--maximized`（结构性断言点）（`FR-003`）
- [X] T011 [US1] 改 `frontend/src/components/layout/AppShell.vue`：新增 prop `previewMaximized`（默认 `false`）；根节点 `div.app-shell` 在放大态带类 `app-shell--preview-maximized`；样式里让 `.app-shell--preview-maximized .app-shell__preview { position: fixed; inset: 0; z-index: var(--z-index-panel-maximized); }`（铺满视口，不改任何栅格 / 宽度变量）（`FR-003` / `FR-004` / `FR-033`）
- [X] T012 [US1] 改 `frontend/src/views/WorkbenchView.vue`：向 `AppShell` 透传 `:preview-maximized`、向 `WorkspacePanel` 透传 `:maximize-visible` / `:maximized`，并接线 `@toggle-maximize="session.preview.toggleMaximize()"`（`FR-001` / `FR-002`）
- [X] T013 [P] [US1] 扩展 `frontend/src/components/layout/WorkspacePanel.spec.ts`：入口存在性与 DOM 顺序（`download? → 放大 → 收起`）、`maximizeVisible=false` 时不渲染（`FR-011`）、两态可访问名称、点击派发 `toggle-maximize`、同一节点复用、放大态根节点类、放大态下 `iframe` 元素引用与 `src` 不变（`FR-006` / I3）、**既有 6 例断言口径不变**
- [X] T014 [P] [US1] 新增 `frontend/src/components/layout/AppShell.spec.ts`（**本次补齐**）：默认无放大类、`previewMaximized` ⇒ 根节点带类且预览列仍在、`previewOpen` 的宽度样式变量**未被改写**（`FR-004`）、分隔条仅在 `previewOpen` 时存在、具名插槽照常渲染
- [X] T015 [US1] 扩展 `frontend/src/views/WorkbenchView.spec.ts`：会话桩补 `maximized` / `maximizable` / `maximizeToggleVisible` / `toggleMaximize` / `restoreMaximize`；`AppShell` 桩补 `preview` 插槽与 `previewMaximized` prop；新增接线用例（`WorkspacePanel` 桩派发 `toggle-maximize` ⇒ `preview.toggleMaximize` 被调用；`AppShell` 收到 `preview-maximized`）
- [ ] T016 [US1] 跑本故事定向测试并在 `quickstart.md` §3.1（场景 1~7）做一次人工确认；**停止并验证**：平铺 / 还原可独立交付（不含键盘与 Esc，仍可用鼠标 + X 走完闭环）

**检查点**：`WorkspacePanel.vue` ≤ 500 行（`plan.md` 预估 ≈ 430）；`AppShell.vue` ≈ 175 行；本故事不引入任何请求。

---

## Phase 4：用户故事 2 —— 键盘可用、可退出、不误伤回答（优先级：P2）

**故事目标**：Tab + Enter / Space 可切换；放大态按 Esc 只退出放大，**不中断正在输出的回答**；非放大态 Esc 行为零变化；弹窗打开时 Esc 优先给弹窗。

**独立验收**：`useMaximizeEscape.spec.ts` 断言"`active=false` 不挂监听 / Esc 回调且 `defaultPrevented` / 转假与卸载即摘除 / `dialog[open]` 放行 / iframe 文档转发去重 / `null` 安全返回"；
`WorkspacePanel.spec.ts` 断言 iframe `load` 后派发 `restore-maximize`；`WorkbenchView.spec.ts` 断言该事件调到 `preview.restoreMaximize`。

- [X] T017 [US2] 新增 `frontend/src/composables/useMaximizeEscape.ts`：`useMaximizeEscape({ active, onRestore })`——`active()` 为真时在 `window` 挂 `keydown` **捕获**监听，命中 `Escape` 且 `document.querySelector('dialog[open]')` 为空时 `preventDefault()` + `stopPropagation()` 后回调；`active()` 转假或组件卸载即摘除（**非放大态 MUST NOT 挂监听**）；`bindFrameEscape(doc, onRestore)`——同源 iframe 文档内的 `Escape` 转成一次回调，模块级 `WeakSet` 保证同一 `Document` 只绑一次，`doc === null` 安全返回（`FR-021`；`research.md` D4 / D5）
- [X] T018 [P] [US2] 新增 `frontend/src/composables/useMaximizeEscape.spec.ts`：`active=false` 时 Esc 不回调（I5）/ `active=true` 时 Esc 回调且 `defaultPrevented` 为真 / `active` 转假后摘除 / 组件卸载后摘除 / 存在 `dialog[open]` 时放行（I6）/ `bindFrameEscape` 转发与同文档去重 / `doc === null` 不抛错（`FR-021`）
- [X] T019 [US2] 改 `frontend/src/components/layout/WorkspacePanel.vue`：`setup` 内接线 `useMaximizeEscape({ active: () => props.maximized, onRestore: () => emit('restore-maximize') })`；在既有 `@load` 处理里对同源 `iframe` 调用 `bindFrameEscape(contentDocument, onRestore)`（与既有 `ensureInnerScroll` 同一入口）；新增 emit `restore-maximize`（`FR-021`）
- [X] T020 [US2] 改 `frontend/src/views/WorkbenchView.vue`：接线 `@restore-maximize="session.preview.restoreMaximize()"`（`FR-021`）
- [X] T021 [US2] 扩展 `frontend/src/components/layout/WorkspacePanel.spec.ts`：iframe `load` 后在其 `contentDocument` 派发 `Escape` ⇒ 派发 `restore-maximize`；`maximized=false` 时按 Esc **不**派发（I5）
- [ ] T022 [US2] 跑本故事定向测试，并在 `quickstart.md` §3.2（场景 8~13）人工确认**"长回答输出中按 Esc 不中断"**这条回归；**停止并验证**：键盘闭环可独立交付

**检查点**：非放大态的键盘行为逐条与改动前一致（`ChatPanel.spec.ts` / 全量测试绿）；`useMaximizeEscape.ts` ≤ 500 行。

---

## Phase 5：用户故事 3 —— 不打扰正在进行的会话（优先级：P2）

**故事目标**：放大 / 缩回往返一次，中栏的草稿、消息滚动位置、左栏选择状态**零丢失**；放大期间流式输出继续；焦点不会停在看不见的控件上。

**独立验收**：`AppShell.spec.ts` 断言放大态下左栏 / 中栏 / 分隔条**仍在 DOM** 且带 `inert`；
`WorkbenchView.spec.ts` 断言切换放大态不重挂中栏（中栏桩的挂载 / 卸载计数不变）且草稿文本保持。

- [X] T023 [US3] 改 `frontend/src/components/layout/AppShell.vue`：放大态给 `.app-shell__sidebar`、`.app-shell__main`、`.app-shell__resizer` 绑定 `inert`（`:inert="previewMaximized ? true : undefined"`，为 `undefined` 时移除属性）；**三者 MUST 保持挂载**（不得改用 `v-if` / `display:none`）（`FR-030` / `FR-031` / I4）
- [X] T024 [P] [US3] 扩展 `frontend/src/components/layout/AppShell.spec.ts`：放大态下三者 `attributes('inert')` 存在、非放大态不存在、且元素 `exists()` 为真（I4）
- [X] T025 [US3] 扩展 `frontend/src/views/WorkbenchView.spec.ts`：放大态切换前后中栏桩未被卸载（挂载计数不变）、草稿 / 中栏 props 不因放大而变化（`FR-030` / `FR-031`）
- [ ] T026 [US3] 跑本故事定向测试，并在 `quickstart.md` §3.3（场景 14~16）人工确认草稿与滚动位置保持、Tab 不落到被覆盖的控件；**停止并验证**：三个故事均可独立演示

**检查点**：`AppShell.vue` ≤ 500 行（`plan.md` 预估 ≈ 175）；全量单测绿。

---

## Phase 6：收口（Polish & Cross-Cutting Concerns）

**目的**：门禁取证、契约核查、手工验收与规格回写——**属"必须做"**，不是可选项（宪章原则八 / 一）。

- [X] T027 改 `frontend/vite.config.ts`：在模块阈值清单登记 `src/composables/useMaximizeEscape.ts`（80% × 4）；按本次实测回写 `src/composables/usePreview.ts` 行末实测值注释；全局地板**只上不下**（按实测上调并写明日期与四项数值）
- [X] T028 [P] 行数门禁取证：对本次改动 / 新增的全部文件执行 `[System.IO.File]::ReadAllLines(<file>).Length`，逐个确认 ≤ **500**，结果写入执行记录（`FR-041`）
- [X] T029 [P] 依赖取证：`git diff -- frontend/package.json` 的依赖段为空；`git diff --stat` 中不含 `agent-backend/**` / `admin-backend/**` / `admin-frontend/**`（`FR-040` / `FR-043`）
- [X] T030 本地全量门禁（宿主机执行，容器不参与）：在 `frontend/`（脚本入口 `frontend/package.json`，配置 `frontend/vite.config.ts` / `frontend/eslint.config.mjs` / `frontend/tsconfig.json`）执行 `npm run test && npm run test:coverage && npm run lint && npm run typecheck && npm run build`，五项全绿且退出码为 0
- [X] T031 契约一致性核查：逐条对照 `specs/011-preview-maximize/contracts/ui-contract.md`（§1 props / emits、§2 布局、§3 会话态、§4 按键、§5 令牌）与实际实现；有漂移即改文档并在 `plan.md` 修订记录登记（宪章原则七）
- [ ] T032 [P] 手工验收（自动化测不到的部分）：`quickstart.md` §3.4 范围边界（场景 17~23，重点：文本 / 需下载 / 错误态**零新按钮**，`FR-013` / `SC-008`）与 §3.5 层级与展示（场景 24~26，重点：放大态下确认弹窗与 toast 仍在放大层**之上**）
- [X] T033 回写规格：核对 `spec.md` §「需回写的上游条文」三项结论是否仍成立；若实现过程中口径有变（判据 / 交互 / 层级），按原则一**先改 `spec.md` 再改代码**或同步回写并登记日期
- [X] T034 汇总执行记录：在本文末「执行记录」填入实测行数、覆盖率实测值与地板、五项门禁结论、`quickstart.md` 场景勾选结果；与 `plan.md` 的预估行数对不上的，回填实测值

---

## 依赖关系与执行顺序

### 阶段依赖

- **Phase 1 准备**：无依赖，可立即开始
- **Phase 2 基础**：依赖 Phase 1 完成——**阻塞全部用户故事**（`usePreview` 的判据与放大态、图标、层级令牌）
- **Phase 3 / 4 / 5（US1 / US2 / US3）**：均依赖 Phase 2 完成；三者可按优先级顺序串行，也可并行（见下）
- **Phase 6 收口**：依赖所需用户故事全部完成

### 用户故事之间的依赖

- **US1（P1）**：Phase 2 之后即可开始，**不依赖**其他故事 → **MVP 范围**
- **US2（P2）**：Phase 2 之后即可开始；`useMaximizeEscape.ts` 是**新文件**，与 US1 无文件冲突；接线点（`WorkspacePanel.vue` / `WorkbenchView.vue`）与 US1 相同 ⇒ 与 US1 并行时需**按行错开**或串行在同一分支上小步提交
- **US3（P2）**：Phase 2 之后即可开始；只动 `AppShell.vue` 的 `inert` 与测试（US1 的 T011 也动 `AppShell.vue`）⇒ 与 US1 存在同文件依赖，**建议在 US1 的 T011 之后进行**

### 同一故事内

- 先实现（组件 / composable）→ 再补 / 扩同名测试 → 再跑定向测试 → 最后人工确认
- 同一文件的多个任务（如 `WorkspacePanel.vue` 的 T009 / T010 / T019）MUST 串行，且每次改动后跑一次定向测试

### 并行机会

- Phase 1：T002 / T003 可并行
- Phase 2：T005 / T006 / T007 / T008 可并行（T007 依赖 T006 的路径表内容，但文件不同，可先写测试再补实现）；T004 是其余任务的前提
- Phase 4：T018 可与 T017 同时开工（测试先行）
- Phase 6：T028 / T029 / T032 可并行

---

## 并行示例

```bash
# Phase 2：判据与图标 / 令牌并行（不同文件）
Task: "扩展 frontend/src/composables/usePreview.spec.ts：8 例判据矩阵"      # T005
Task: "改 frontend/src/components/common/BaseIcon.vue：新增 maximize/minimize 路径"  # T006
Task: "新增 frontend/src/components/common/BaseIcon.spec.ts"                # T007
Task: "改 frontend/src/styles/tokens.css：新增 --z-index-panel-maximized"  # T008

# Phase 4：Esc 组合式与它的测试并行（测试先行）
Task: "新增 frontend/src/composables/useMaximizeEscape.ts"        # T017
Task: "新增 frontend/src/composables/useMaximizeEscape.spec.ts"   # T018
```

---

## 实施策略

### 先做 MVP（只做 US1）

1. 完成 Phase 1 准备
2. 完成 Phase 2 基础（**关键**：阻塞全部故事）
3. 完成 Phase 3（US1）→ **停下验证**：鼠标走完"点开 → 放大 → 缩小 → 恢复原样"闭环，`quickstart.md` §3.1 场景 1~7 通过
4. 此时即可演示并交付：绝大多数的"看不清"诉求已被解决

### 增量交付

1. 准备 + 基础 → 底盘就绪（判据、图标、层级）
2. US1 → 独立验收 → 可演示（MVP）
3. US2 → 独立验收 → 键盘闭环（**含"Esc 不中断回答"这条回归**）
4. US3 → 独立验收 → 不打扰保证（草稿 / 滚动 / 焦点）
5. 收口阶段：门禁取证 + 契约核查 + 手工验收 + 规格回写

### 并行团队策略

1. 准备 + 基础两阶段由全员共同完成
2. 基础完成后：开发者 A 做 US1（组件与装配）、开发者 B 做 US2（`useMaximizeEscape.ts` + 其测试，**先避开 `WorkspacePanel.vue` 的接线**）、开发者 C 做 US3（`AppShell.vue` 的 `inert` 与其测试）
3. 三者最终在 `WorkspacePanel.vue` / `WorkbenchView.vue` 的接线点上汇合，按"小步提交 + 每次跑定向测试"避免互相覆盖

---

## 需求 → 任务追溯

| 需求组 | 任务 |
|---|---|
| `FR-001` / `FR-002` / `FR-005` / `FR-010` / `FR-011` / `FR-013`（入口、判据、范围外零变化） | T004、T005、T009、T012、T013、T032 |
| `FR-003` / `FR-004` / `FR-006` / `FR-007` / `FR-012`（平铺、恢复、不重载、瞬态、随目标保持） | T004、T010、T011、T013、T014、T015 |
| `FR-020` / `FR-021` / `FR-022` / `FR-023` / `FR-024`（键盘、Esc、状态表达、焦点、减动效） | T009、T017、T018、T019、T020、T021、T022 |
| `FR-030` / `FR-031` / `FR-032` / `FR-033` / `FR-034`（不打扰、不越界、降级不变） | T004、T011、T023、T024、T025、T026 |
| `FR-040`~`FR-043`（零依赖、≤500 行、同名测试与 80%、仅前端） | T002、T027、T028、T029、T030 |

---

## 执行记录

> 由 T001 建立基线、由 T034 汇总回填。**实现日：2026-10-16**（宿主机 Windows，容器未参与测试）。

### 行数实测（口径 `[System.IO.File]::ReadAllLines().Length`，上限 500）

| 文件 | 基线 | 实现后实测 | 计划预估 | 判定 |
|---|---|---|---|---|
| `frontend/src/components/layout/WorkspacePanel.vue` | 387 | **454** | ≈ 430 | ✅ ≤ 500 |
| `frontend/src/components/layout/WorkspacePanel.spec.ts` | 73 | **283** | ≈ 160 | ✅ |
| `frontend/src/components/layout/AppShell.vue` | 150 | **185** | ≈ 175 | ✅ |
| `frontend/src/components/layout/AppShell.spec.ts` | — | **116** | ≈ 80 | ✅（新增） |
| `frontend/src/components/common/BaseIcon.vue` | 99 | **103** | ≈ 105 | ✅ |
| `frontend/src/components/common/BaseIcon.spec.ts` | — | **72** | ≈ 60 | ✅（新增） |
| `frontend/src/composables/usePreview.ts` | 316 | **390** | ≈ 360 | ✅ |
| `frontend/src/composables/usePreview.spec.ts` | 295 | **492** | ≈ 380 | ✅（最接近上限者，仍 < 500） |
| `frontend/src/composables/useMaximizeEscape.ts` | — | **100** | ≈ 90 | ✅（新增） |
| `frontend/src/composables/useMaximizeEscape.spec.ts` | — | **168** | ≈ 120 | ✅（新增） |
| `frontend/src/views/WorkbenchView.vue` | 271 | **292** | ≈ 285 | ✅ |
| `frontend/src/views/WorkbenchView.spec.ts` | 257 | **404** | ≈ 300 | ✅ |
| `frontend/src/styles/tokens.css` | 103 | **106** | 104 | ✅ |
| `frontend/vite.config.ts` | 180 | **190** | ≈ 195 | ✅ |

### 门禁结论（全部本地执行）

| 门禁 | 命令 | 结论 |
|---|---|---|
| 单测 | `cd frontend && npm run test` | ✅ **79 个文件 / 961 个用例全绿**。本特性实测用例数：`usePreview.spec.ts` 32、`WorkspacePanel.spec.ts` 17、`AppShell.spec.ts` 9（新）、`BaseIcon.spec.ts` 8（新）、`useMaximizeEscape.spec.ts` 10（新）、`WorkbenchView.spec.ts` 14 —— 三个新建测试文件共 **27** 条为本次新增，其余为在既有文件内扩充 |
| 覆盖率 | `npm run test:coverage` | ✅ 阈值全部通过。全局 **79.01 / 76.89 / 70.72 / 79.77**（地板已抬至 77/75/69/78，只上不下）；`useMaximizeEscape.ts` **96.55 / 95.45 / 100 / 96.29**；`usePreview.ts` **94.69 / 84.90 / 100 / 94.59**（上一版 92.63 / 80.48 / 90.90 / 92.55） |
| lint | `npm run lint` | ✅ **0 problems**（过程中出现 1 条 `vue/order-in-components` 警告，已按提示调整桩组件选项顺序后清零） |
| 类型 | `npm run typecheck` | ✅ `vue-tsc --build --force` 无输出（通过） |
| 构建 | `npm run build` | ✅ built in 1.66s（仅既有的 chunk > 500 kB 提示，与本特性无关） |
| 依赖 | `git diff -- frontend/package.json` | ✅ 依赖段**为空**（零新增依赖） |
| 范围 | `git --no-pager diff --stat` | ✅ 改动集中在 `frontend/**`，**未触碰** `agent-backend` / `admin-backend` / `admin-frontend` 与任何契约文件（`FR-043`） |
| 行数 | T028 取证 | ✅ 14 个文件全部 ≤ 500（最大 492） |

### `quickstart.md` 场景勾选

| 段落 | 场景 | 结论 |
|---|---|---|
| §3.1 平铺与恢复 | 1~7 | ⏳ **待人工确认**（需浏览器；自动化侧已由 `WorkspacePanel.spec.ts` / `AppShell.spec.ts` 覆盖结构断言） |
| §3.2 键盘与退出 | 8~13 | ⏳ **待人工确认**（"长回答输出中按 Esc 不中断"这条**只能**在真实流式输出上确认） |
| §3.3 不打扰 | 14~16 | ⏳ **待人工确认**（草稿 / 滚动位置 / Tab 顺序的观感） |
| §3.4 范围边界 | 17~23 | ⏳ **待人工确认**（范围外三类面板的"逐像素不变"需要肉眼比对） |
| §3.5 层级与展示 | 24~26 | ⏳ **待人工确认**（弹窗 / toast 是否真的浮在放大层之上——`z-index` 令牌只能证到"值对"，浮层关系要眼看） |

### 未完成的 4 条任务（人工步骤，MUST NOT 记为已完成）

T016 / T022 / T026 / T032 的**自动化部分已跑通**（定向测试与全量门禁见上表），但每条都还含"在浏览器里走一遍"的人工确认：
分别对应 `quickstart.md` §3.1 / §3.2 / §3.3 与 §3.4+§3.5。**这四条保持 `[ ]`**，待人工确认后勾选。

### 与计划的差异（已登记，均不改行为）

1. 入口补了 `aria-pressed`（随 `maximized` 同步）——`contracts/ui-contract.md` §1.3 已补该行；
2. `WorkspacePanel.spec.ts` 的 iframe 用例**就地注入一份同源文档**：jsdom 不为带 `src` 的 iframe 造 `contentDocument`，不注入就无法覆盖"拿到文档之后我们做了什么"；
3. `WorkbenchView.spec.ts` 的骨架桩改为渲染 `chat` / `preview` 两个插槽（否则接线用例无从触发），会话桩补齐右栏与工作空间的只读字段，中栏桩加挂载计数以钉住"不重建"；
4. 覆盖率全局地板按实测上调（76/74/66/77 → 77/75/69/78）。
