# 实现计划：预览面板的「放大 / 缩小」（平铺整个视口）

**Branch**: `011-preview-maximize` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: 特性规格 `specs/011-preview-maximize/spec.md`（3 个用户故事 / **25 条功能需求** / **8 条成功标准**；无待澄清项——
唯一一项触发放大范围已收敛为 **Q1 = C**：同源 `viewUrl` 的 iframe 页面 + 本地 PDF / 图片）

## 摘要

聊天区点开 `viewUrl` 入口（或文件空间里的 PDF / 图片）后，内容落在右侧 1/3 宽的面板里——表格被挤成一列、图纸看不清。
本特性给面板头部「收起」（X）**左侧**加一枚可逆的「放大 / 缩小」入口：点一下把预览**平铺整个视口**，再点一下**精确恢复**。
全部改动落在聊天前台 `frontend` 单侧，三个支点：

1. **放大态放会话态、判据只有一处**：`composables/usePreview.ts` 新增 `maximized`（唯一真源）、派生 `maximizable`
   （8 例矩阵，`FR-010` 的"有版面才可放大"）与 `maximizeToggleVisible`（`maximized || maximizable`——放大态**必须始终留出口**）；
   退出放大收敛在既有的 `resetContent()` 里，`close` / `backToList` / `openList` 三条路径自动归零。
2. **平铺 = 覆盖视口，不卸载任何一栏**：`AppShell.vue` 在放大态给根节点加类、给左右两栏**与分隔条**加 `inert`；
   预览列用 `position: fixed; inset: 0` 铺满。DOM 与栅格宽度**从未被动过**，
   于是 `FR-030`（草稿 / 滚动位置零丢失）与 `FR-004`（缩回后宽度逐像素一致）是**结构性成立**，而不是靠细节调出来的。
3. **Esc 不误伤回答**：`composables/useMaximizeEscape.ts` 在**捕获阶段**且**仅放大态**挂 window 监听（`ChatPanel` 的既有
   Esc 监听在冒泡阶段，被拦下就收不到），并把**同源 iframe 文档内**的 Esc 也转发过来——iframe 正是本特性的主场景，
   焦点进去后按 Esc 在浏览器里不会冒泡到父文档，不转发则要件不成立。

顺带补齐一处"改动即约束"的测试缺口：`BaseIcon.vue` 本次被改动（新增 `maximize` / `minimize` 两条路径），
而它当前**没有同名测试**，按原则三补 `BaseIcon.spec.ts`（不是存量补测专项）。

## 技术上下文（Technical Context）

**Language/Version**：Vue 3.5 + TypeScript 6 + Vite 8 / Vitest 5（`vue-tsc --build` 类型检查）。

**Primary Dependencies**：**零新增**。栅格与定位、`inert`、`WeakSet`、捕获阶段监听、`contentDocument` 全是平台能力；
图标沿用内置路径表（`BaseIcon`），**MUST NOT** 引入图标库或全屏 API 封装库。

**Storage**：**无**。放大态只存在于内存（`FR-007`：不持久化、不写地址栏、不入 `sessionStorage`）。

**Testing**：Vitest 5 + `@vue/test-utils`（jsdom）。`*.spec.ts` 与源码同目录；组件测 props / events / 边界，
composable 直接调 `createXxxStore`（沿用 `usePreview.spec.ts` 既有手法）。**全部在本地（宿主机）执行，容器不参与测试**（原则三）。

**Target Platform**：Windows 宿主机（开发与门禁）/ Linux 容器（交付）。本特性**无平台相关行为**（见「平台差异登记」）；
`inert` 需要 Chrome 102+ / Safari 15.5+ / Firefox 112+（失效时渐进降级为"仍可 Tab 到被覆盖的控件"，见「复杂度跟踪」）。

**Project Type**：四侧一体的 Web 应用（`agent-backend` / `admin-backend` / `frontend` / `admin-frontend`）；本特性**仅 `frontend`**。

**Performance Goals**：

- 放大 / 缩回 MUST **无网络请求、无重新渲染整棵子树**：只写一个 `ref` + 切一个类 / 属性（原则五"非推理类交互反馈 ≤ 100ms"）；
- MUST NOT 在放大 / 缩回路径上做 JS 尺寸测量（`getBoundingClientRect` 等）——`FR-033`（窗口缩放不失效）因此是结构性成立；
- 预览列的 `position: fixed` 不触发栅格重排，中栏消息列表**不进任何重排 / 重绘路径**。

**Constraints**：

- **单文件 ≤ 500 行**（硬门禁）：本次改动后 `WorkspacePanel.vue` 实测 `387 →` 预计 ≈ `420`，仍需复核；
- 覆盖率：本次新增 / 改动的模块 MUST ≥ **80%** 并登记进 `frontend/vite.config.ts`；全局地板**只上不下**；
- 零新增依赖；MUST NOT 修改既有测试的断言口径（除"补断言"以外）；
- MUST NOT 触碰 `agent-backend` / `admin-backend` / `admin-frontend` 与任何接口契约（`FR-043`）。

**Scale/Scope**：单用户工作台；同时只存在一个放大中的面板；改动面 **14 个文件**（其中 **4 个为新增**：`useMaximizeEscape.ts` 与 `AppShell.spec.ts` / `BaseIcon.spec.ts` 两个同名测试补齐，另加 `useMaximizeEscape.spec.ts`）。

## 宪章检查（Constitution Check）

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 本目录 `spec.md` / `plan.md` / `research.md` / `data-model.md` / `contracts/` / `quickstart.md` 全中文；无待澄清项；规格「修订记录」已登记本轮落点细化；「需回写的上游条文」3 项结论齐备（1 登记缺口 / 2 无需回写） |
| 二 代码质量与模块化边界 | **通过** | 判据唯一实现（`usePreview` 的派生值，面板只消费布尔 prop）；图标唯一实现（`BaseIcon`）；新增 1 个 composable（`useMaximizeEscape`，职责：Esc 的两种载体）+ 均配同名测试；改动后所有文件 ≤ 500 行 |
| 三 测试完备性（NON-NEGOTIABLE） | **通过（含同名测试补齐）** | `usePreview` 8 例判据矩阵 + 收敛用例；`WorkspacePanel` 入口位置 / 两态名称 / prop 映射；`AppShell` 类名 + `inert`（两栏**与分隔条**）+ 元素仍在 DOM；`useMaximizeEscape` 的连接 / 放行 / 摘除 / iframe 转发；`WorkbenchView` 事件接线。**补齐**：`BaseIcon.spec.ts`（该文件本次被改动且此前无同名测试）。**全部本地执行** |
| 四 无障碍与可用性 | **通过** | 入口为原生 `<button>`（Tab / Enter / Space、可见焦点环）；可访问名称随状态切换（`放大页面` ↔ `缩小页面`，不只靠图标或颜色）；放大态下其余两栏**与分隔条** `inert`（焦点不会落到被覆盖的控件上）；Esc 可退出且不误伤"中断本轮"；未引入过渡动画（`prefers-reduced-motion` 不适用） |
| 五 性能与数据一致性 | **通过** | 状态切换 O(1)（一个 `ref`）；无请求、无测量、无重排；宽度状态未被改写（`FR-004` 的"数据一致性"侧面）；破坏性操作既有二次确认不受影响（层级令牌保证弹窗在放大层之上） |
| 六 技术治理与依赖控制 | **通过** | **零新增依赖**；用平台原生 `inert` / `position: fixed` / 捕获监听实现，MUST NOT 引库；图标沿用 `BaseIcon` 路径表 |
| 七 接口契约与前后端一致性 | **通过（不适用后端）** | 本特性**不新增端点、不改字段、不改 SSE 事件**，故无"两侧同改"项；界面契约（props / emits / 会话态）登记在 `contracts/ui-contract.md`，实现与文档同步 |
| 八 测试部署简单可控 | **通过** | 门禁四步 + 行数取证均在 `frontend/` 本地一键执行（见 §「门禁」）；无新增脚本、无新增环境变量、无部署编排改动 |
| 九 优雅降级与故障可观测 | **通过** | 不新增任何静默分支：`bindFrameEscape` 在拿不到 `contentDocument`（跨域 / PDF 插件文档）时安全返回且**不假装成功**；放大态下预览渲染失败仍走既有 `ErrorNotice` 呈现（`FR-034`）；`inert` 不受支持时是**可见的渐进降级**（覆盖与 Esc 照常，仅键盘可达性退化），已登记 |

**Phase 1 设计后复核结论**：九条结论**不变**（设计未引入新的越界项；无 Complexity Tracking 中的"违反项"）。

## 技术决策

| # | 决策 | 理由 | 被否决的替代 |
|---|---|---|---|
| **D1** | 放大态放 `composables/usePreview.ts`（会话态） | 单一真源；退出放大收敛在既有 `resetContent()`，`close` / `backToList` / `openList` 三条路径自动生效；该文件已有 80% 模块阈值与同名测试 | `AppShell` 局部状态（收不起，只能加双向约定）；`WorkbenchView` 局部状态（与面板的 `open` / `view` 分家，收敛规则写两遍） |
| **D2** | 平铺 = 预览列 `position: fixed; inset: 0`，其余两栏**保持挂载** | `FR-030` / `FR-004` 结构性成立（DOM、滚动盒、栅格宽度都没动过）；改动只有类名 + 一段 CSS | ① 栅格收单列 + `display:none` 其余栏（滚动盒销毁 → 消息列表回顶）；② 原生 Fullscreen API（藏掉 X，"缩小"入口不可达，jsdom 不可测）；③ 新增路由 / 整页（违 `FR-007` 且会重新加载 iframe）；④ `teleport` 到 `body`（承载节点被重建，违 `FR-006`） |
| **D3** | 判据唯一实现 = `usePreview` 的 `maximizable`；入口可见性 = `maximized \|\| maximizable` | `FR-010` 的单一职责要求；`\|\| maximized` 保证"放大态下切到加载中的目标时出口不消失"（`FR-005`） | 面板内按 `target` / `content` 自行判断（两处判据，必然漂移）；抽到 `utils/` 纯函数（要搬运 store 的类型，类型归属漂移） |
| **D4** | Esc 用 `window` **捕获**监听，**仅放大态挂载**，遇 `dialog[open]` 放行 | `ChatPanel` 的 Esc 在冒泡阶段（`ChatPanel.vue` L165~180）——捕获先执行 + `stopPropagation` 后它收不到；非放大态不挂监听 ⇒"改动前行为零变化"结构性成立；`dialog[open]` 放行保住原生弹窗的 Esc 语义 | 在 `ChatPanel` 内加"预览是否放大"判断（概念穿层）；监听 `document`（注册顺序仍不可控）；无条件常挂监听（会吞掉既有的"Esc 中断本轮"） |
| **D5** | 同源 iframe 文档内也转发 Esc（`bindFrameEscape`，每文档只绑一次） | iframe 是独立文档，键事件不冒泡到父文档；iframe 页面正是本特性主场景，不转发则 `FR-021` 不成立；同源是拿到 `contentDocument` 的前提，与既有 `ensureInnerScroll` 边界一致 | 不转发并登记为"需先点回面板"的已知限制（要件不满足）；跨域转发（读不到 `contentDocument`，且跨域本就不进面板） |
| **D6** | 放大态给左栏 / 中栏 / **分隔条**加 `inert` | 平台原生语义：一次解决"不可点 / 不可 Tab / 不进无障碍树"，**不动布局与滚动**（`FR-030` 不受影响），避免"焦点落在被盖住的控件上"（原则四）。分隔条必须一并纳入——它 `tabindex="0"` 且被覆盖层挡住，不纳入则键盘用户会把焦点停在一个**看不见**的控件上 | `aria-hidden`（只影响读屏，键盘仍能落到不可见控件）；自建焦点陷阱（重造平台能力，原则六） |
| **D7** | 图标加进既有 `BaseIcon` 路径表（`maximize` / `minimize`） | 图标渲染的唯一实现保持在 `BaseIcon`；零新增依赖（原则二 / 六） | 面板内内联 `<svg>`（第二处图标实现）；引图标库（新增依赖） |
| **D8** | 覆盖层用**新令牌** `--z-index-panel-maximized: 150` | MUST 小于 `--z-index-dialog`（200）与 `--z-index-toast`（300）——放大态下的二次确认与 toast 必须仍浮在上面，否则"确认框看不见 = 没有确认" | 硬编码 `150`（脱离令牌体系）；复用 `--z-index-dropdown`（语义错位） |

## 影响面清单（文件级）

> 行数为 2026-10-16 实测（`[System.IO.File]::ReadAllLines().Length`，与验收同口径）。

| # | 文件 | 动作 | 行数 |
|---|---|---|---|
| 1 | `frontend/src/composables/usePreview.ts` | 改动：`maximized` / `maximizable` / `maximizeToggleVisible` / `toggleMaximize` / `restoreMaximize`；`resetContent()` 收敛 | 316 → 预计 ≈ 360 |
| 2 | `frontend/src/composables/usePreview.spec.ts` | 改动：8 例判据矩阵 + 放大态收敛 / 保持 + 零副作用断言 | 295 → 预计 ≈ 380 |
| 3 | `frontend/src/composables/useMaximizeEscape.ts` | **新增**：Esc 的两种载体（window 捕获监听 / 同源 iframe 文档转发），各配注释说明"为什么" | 新增 ≈ 90 |
| 4 | `frontend/src/composables/useMaximizeEscape.spec.ts` | **新增**：同名测试 | 新增 ≈ 120 |
| 5 | `frontend/src/components/layout/WorkspacePanel.vue` | 改动：`maximizeVisible` / `maximized` 两个 prop、`toggle-maximize` / `restore-maximize` 两个事件、头部入口（X 左侧）、放大态类名、iframe 的 Esc 绑定 | 387 → 预计 ≈ 430 |
| 6 | `frontend/src/components/layout/WorkspacePanel.spec.ts` | 改动：入口位置 / 两态名称 / prop 映射 / 内容不重载 / iframe Esc 转发 | 73 → 预计 ≈ 160 |
| 7 | `frontend/src/components/layout/AppShell.vue` | 改动：`previewMaximized` prop、根节点类名、左栏 / 中栏 / 分隔条 `inert`、预览列覆盖样式 | 150 → 预计 ≈ 175 |
| 8 | `frontend/src/components/layout/AppShell.spec.ts` | **新增**：同名测试（该组件此前无测试；本次被改动 ⇒ 按原则三补） | 新增 ≈ 80 |
| 9 | `frontend/src/components/common/BaseIcon.vue` | 改动：路径表新增 `maximize` / `minimize` | 99 → 预计 ≈ 105 |
| 10 | `frontend/src/components/common/BaseIcon.spec.ts` | **新增**：同名测试（同上，改动即约束） | 新增 ≈ 60 |
| 11 | `frontend/src/views/WorkbenchView.vue` | 改动：透传 `maximizeVisible` / `maximized`，接线两个事件 | 271 → 预计 ≈ 285 |
| 12 | `frontend/src/views/WorkbenchView.spec.ts` | 改动：会话桩补字段；AppShell 桩补 `preview` 插槽与 prop；新增"点入口 → 调 `toggleMaximize`"接线用例 | 257 → 预计 ≈ 300 |
| 13 | `frontend/src/styles/tokens.css` | 改动：新增 `--z-index-panel-maximized: 150` | 103 → 104 |
| 14 | `frontend/vite.config.ts` | 改动：登记 `useMaximizeEscape.ts` 的 80% 阈值；按实测上调全局地板（只上不下） | 180 → 预计 ≈ 195 |

**零变更**：`agent-backend` / `admin-backend` / `admin-frontend`（全部）、`frontend/src/api/**`（契约形状未变）、
SSE 事件集合、两侧依赖清单（**零新增**）。

## 结构决策（Structure Decision）

本仓库是**四侧一体的 Web 应用**（`agent-backend` / `admin-backend` / `frontend` / `admin-frontend`）；
本特性**只落在 `frontend` 这一侧**，且只落在它的**界面装配层**——不新建目录、不新建分层：

```text
specs/011-preview-maximize/          # 本特性的文档（规范 → 计划 → 任务三件套 + Phase 0/1 产出）
├── spec.md                          # /speckit.specify
├── plan.md                          # 本文件
├── research.md                      # Phase 0（R1~R8）
├── data-model.md                    # Phase 1（放大态状态模型 + 8 例判据矩阵）
├── contracts/ui-contract.md         # Phase 1（组件 / 会话态 / 按键 / 令牌契约；无 HTTP 契约变更）
├── quickstart.md                    # Phase 1（26 条手工场景 + 一键门禁）
└── checklists/requirements.md       # 规格质量校验（13 / 13 通过）

frontend/src/                        # 改动面（沿用既有分层：components → composables → utils）
├── components/layout/AppShell.vue            # 三栏骨架：放大态的类名 + 两栏与分隔条 inert + 预览列覆盖样式
├── components/layout/WorkspacePanel.vue      # 面板：头部入口（X 左侧）+ 放大态类名 + iframe 的 Esc 绑定
├── components/common/BaseIcon.vue            # 图标唯一实现：新增 maximize / minimize 路径
├── composables/usePreview.ts                 # 会话态：放大态唯一真源 + 可放大判据（唯一实现）
├── composables/useMaximizeEscape.ts          # 新增：Esc 的两种载体（window 捕获 / 同源 iframe 文档）
├── views/WorkbenchView.vue                   # 装配层：props 下发 + 事件接线
└── styles/tokens.css                         # 层级令牌：--z-index-panel-maximized
```

**为什么不动 `utils/`**：本特性的"纯逻辑"只有一处——"什么内容可以放大"——而它的输入类型（`PreviewTarget` / `PreviewContent`）
属于 `usePreview` 的公开面（`contracts/ui-contract.md` §3）。把判据搬进 `utils/` 会把 store 的类型拆成两处归属，
只换来"看起来更纯"；留在 store 的派生值里，既满足 `FR-010` 的单一职责，也让 8 例矩阵能在既有 `usePreview.spec.ts` 里直接钉住。

## 测试落点

| 模块 | 测试文件 | 覆盖重点 |
|---|---|---|
| `composables/usePreview.ts` | `usePreview.spec.ts` | **8 例判据矩阵**（iframe / PDF / 图片 = 可放大；文本 / 需下载 / 错误态 / `kind:'none'` / `list` = 不可）；`toggleMaximize` 的越权无操作；`maximized \|\| maximizable` 的出口不消失；`close` / `backToList` / `openList` 三例归零；`openFile` / `openView` 切换目标时保持；切换不产生额外请求（`probePreview` / `fetchPreviewText` 调用次数不变） |
| `composables/useMaximizeEscape.ts` | `useMaximizeEscape.spec.ts` | `active=false` 不挂监听（Esc 不回调）；`active=true` 时 Esc 回调且 `defaultPrevented`；`active` 转假 / 卸载即摘除；`dialog[open]` 存在时放行；`bindFrameEscape` 的转发 / 去重（同文档只绑一次）/ `null` 安全返回 |
| `components/layout/WorkspacePanel.vue` | `WorkspacePanel.spec.ts` | 入口存在性与 DOM 顺序（`download? → 放大 → 收起`）；`maximizeVisible=false` 时不渲染；两态可访问名称；点击派发 `toggle-maximize`（同一 DOM 节点复用）；放大态下 `iframe` 元素引用与 `src` 不变；放大态下 iframe `load` 触发 Esc 转发；**既有 6 例全绿（断言口径不变）** |
| `components/layout/AppShell.vue` | `AppShell.spec.ts`（新增） | 默认无放大类 / 无 `inert`；`previewMaximized` ⇒ 根节点带类 + 左栏 / 中栏 / 分隔条带 `inert` 且**仍在 DOM**；插槽照常渲染；分隔条仅在 `previewOpen` 时存在；`previewMaximized` 为真时 `previewOpen` 的宽度样式变量**未被改写** |
| `components/common/BaseIcon.vue` | `BaseIcon.spec.ts`（新增） | `maximize` / `minimize` 路径渲染（`path` 数与 `d` 存在）；未知名称渲染空；`label` 决定 `role` / `aria-hidden` |
| `views/WorkbenchView.vue` | `WorkbenchView.spec.ts` | 会话桩补 `maximized` / `maximizable` / `maximizeToggleVisible` / `toggleMaximize` / `restoreMaximize`；面包板接线：`WorkspacePanel` 桩派发 `toggle-maximize` → `preview.toggleMaximize` 被调用；`restore-maximize` → `preview.restoreMaximize`；`AppShell` 收到 `preview-maximized` |

## 覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）共 20 个模块尚无测试，其**补测顺序与范围**
MUST 在下一个特性的 `plan.md` 给出结论；**MUST NOT** 发起存量补齐专项。先例：`specs/002-conversation-runtime/plan.md` §4；
`specs/008-*` / `009-*` / `010-*` 已重申常设口径。

**本次结论**（**沿用**既有序，不重新排序、不扩大范围）：

| 项 | 结论 |
|---|---|
| 顺序与范围 | **沿用** `specs/002-conversation-runtime/plan.md` §4 的四段顺序（① 网络与契约边界 → ② 产出与预览链路 → ③ 会话与流式 → ④ 其余）；本次**不重新排序、不新增范围** |
| 机制 | **随改动触达即补**，不立项专项。本次触达 `usePreview.ts`（已登记 80% 阈值）⇒ 只覆盖**本次改动行为**（判据矩阵与放大态收敛） |
| 与"不追溯"的关系（**关键**） | 本次新增的 `useMaximizeEscape.ts` 属"**本次创建的新文件**" ⇒ 按原则三 MUST 有同名测试；`AppShell.spec.ts` / `BaseIcon.spec.ts` 是**被改动文件**的同名测试补齐（治理 § "存量文件被改动时，改动部分及其直接受影响的测试 MUST 符合宪章"）——**不是**为存量模块的其余函数补测 |
| 逐文件 80% 清单 | 本次新增登记条目 **1** 个：`composables/useMaximizeEscape.ts`；`composables/usePreview.ts` **既有条目保持**（阈值不改，实测值在 `vite.config.ts` 行末回写） |
| 不登记阈值的模块 | `WorkbenchView.vue` / `WorkspacePanel.vue` / `AppShell.vue` / `BaseIcon.vue` 属既有组件（未登记模块阈值），本次只覆盖**新行为**；登记它们等于对其余函数发起存量补测专项，故**不登记**，与 010 对 `useChatStream.ts` / `useChatPanel.ts` 的取舍同口径 |
| 阈值取值 | 一律按宪章下限 **80%** 登记（MUST NOT 只按实测抬高以免掩盖下滑）；实测值写入 `vite.config.ts` 行末注释备查 |
| 地板 | 全局地板**只上不下**：按本次实测（预计小幅上行）回写数值与日期 |

## 复杂度跟踪（Complexity Tracking）

> **无宪章违反项**（无"为赶进度而破例"的条目）。以下为**已知限制与取舍登记**，评审可据此质询。

| 项 | 内容 |
|---|---|
| 已知限制①：`inert` 的浏览器下限 | Chrome 102+ / Safari 15.5+ / Firefox 112+；更旧浏览器上退化为"仍可 Tab 到被覆盖的控件"。判定可接受：本产品是三栏工作台内部工具，失效时覆盖层与 Esc 退出**照常工作**，无数据风险，且不产生"假绿" |
| 已知限制②：同源 iframe 内的 Esc | 仅在**同源**（能拿到 `contentDocument`）时生效；跨域地址本就不进面板（直跳新窗口），故无遗漏场景；PDF 由浏览器插件文档承载（`contentDocument` 为 `null`），该态下按 Esc 需焦点先在头部——**登记为已知限制** |
| 已知限制③：焦点在 iframe 内时 `Ctrl/⌘+F` 等浏览器行为 | 不属本特性范围（浏览器的查找作用于 iframe 文档自身） |
| 被否决：用 `v-if` 卸载左右两栏来做"平铺" | 草稿与消息滚动位置会丢（`FR-030`），且缩回后要重建子树（违背"精确恢复"的体感） |
| 被否决：自建焦点陷阱替代 `inert` | 重造平台能力（原则六）；Tab 环绕 / 初次聚焦 / 异常路径都要自己兜 |
| 被否决：给放大 / 缩小加过渡动画 | 全屏铺开做补间会让中栏在动画期间可见地"被压"，且需处理 `prefers-reduced-motion` 分支；当前为瞬时切换（`FR-024` 标"不适用"） |
| **既有技术债（不追溯，仅登记）** | `AppShell.vue` / `BaseIcon.vue` 此前无同名测试（本次因**被改动**而补齐，非回溯专项）；`shared` 其他未测模块按上一节结论处理 |

## 平台差异登记（宪章原则三）

**结论：本次改动无平台相关行为。** 全部改动是 Vue 响应式状态、类名 / 属性绑定、一段 CSS 与浏览器键盘事件；
不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块。本地（Windows 宿主机）与交付目标（Linux 容器）行为一致。
测试全部在本地执行，容器不参与测试。

## 门禁（宪章原则八；全部在本地执行）

```text
前端  : cd frontend
        npm run test           # 全量单测（含本次新增 / 改动的同名测试）
        npm run test:coverage  # 覆盖率：useMaximizeEscape ≥ 80% + 全局地板
        npm run lint           # eslint
        npm run typecheck      # vue-tsc --build --force
        npm run build          # 生产构建（内含 typecheck）
        # 行数门禁（frontend 无 check:lines 脚本，按 010 同一口径手工取证）
        [System.IO.File]::ReadAllLines(<file>).Length   # 每文件 ≤ 500
```

## 验收

见 [spec.md](./spec.md) §「成功标准」（`SC-001`~`SC-008`）与 [quickstart.md](./quickstart.md)（手工场景 1~26）；
任务与勾选状态见 `tasks.md`（`/speckit.tasks` 产出，**不由本命令创建**）。
`/speckit.analyze` 一致性核查时重点看：`FR-010` 判据是否只有一处实现、`FR-013`（范围外零变化）是否有回归证据。

## 需回写的上游条文（本轮复核）

| # | 落点 | 动作 | 理由 |
|---|---|---|---|
| 1 | `specs/002-conversation-runtime/spec.md` §4.8 | **无需回写** | 该节口径是"`viewUrl` 抽取 → sidecar 下发 → 正文之后入口行 → 点击进面板"；本特性不改抽取、不改下发、不改入口行，只是在**已渲染的预览**上增加一种呈现，`TR-44`~`TR-48` 逐条不变 |
| 2 | 右侧面板自身规格（`US7` / `US8`、`FR-045`~`FR-048`、`V-10` / `V-11`） | **维持 `spec.md` 的上游缺口登记** | 复核 `specs/**` 仍零命中（`V-10` / `V-11` 无匹配），缺口与本特性无关，不顺手补写（治理 § 不追溯） |

## 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-16 | 初稿 | `/speckit.plan`：技术上下文（零新增依赖、Vitest 5、无平台差异）、宪章九条逐条核对（Phase 0 前 + Phase 1 后复核一致）、D1~D8 技术决策（含被否决替代）、文件级影响面清单（14 个文件，实测行数）、测试落点、覆盖率缺口处置结论（沿用常设口径 + 明确"改动即补同名测试"的边界）、复杂度跟踪（3 项已知限制 + 3 项被否决方案）、平台差异登记（无）、门禁与验收路径 |
| 2026-10-16 | 落点细化回写 | 同步 `spec.md`：`FR-010` 的验证落点明确为"8 例判据矩阵钉在 `usePreview.spec.ts`、面板侧钉 prop → 渲染映射"（行为口径未变，见 `spec.md`「修订记录」第 3 行） |
| 2026-10-16 | 复核（第二次执行 `/speckit.plan`） | `setup-plan.ps1` 报告 `Plan already exists … skipping template copy`（模板未覆盖既有计划）；规格自上次以来无改动、宪章仍为 v2.2.0、Phase 0/1 产出齐备，故**不重写**计划。本轮修正三处：① `Scale/Scope` 的文件数 13 → **14**（与影响面清单对齐），并说明 4 个新增文件的构成；② **分隔条纳入 `inert`**（`D6` / 影响面清单 / 测试落点 / `contracts/ui-contract.md` §2 / `data-model.md` I4 / `research.md` R3 / `quickstart.md` 场景 16 同步）——分隔条 `tabindex="0"` 且被覆盖层挡住，不纳入则焦点会停在看不见的控件上（原则四）；③ `AppShell.spec.ts` 的覆盖重点补充"宽度样式变量未被改写" |
| 2026-10-16 | **实现（`/speckit.implement`）** | Phase 1~6 全部落地，30 / 34 条任务完成；`T016` / `T022` / `T026` / `T032` 的自动化部分已跑通，但其"浏览器人工确认"部分**仍待人工**（未记为完成）。实测行数 14 个文件全部 ≤ 500（最大 492），五项门禁全绿。实现期与计划的差异（均不改行为，逐条登记）：① 入口补 `aria-pressed`（随 `maximized` 同步），已回写 `contracts/ui-contract.md` §1.3；② `WorkspacePanel.spec.ts` 的 iframe 用例**就地注入同源文档**（jsdom 不为带 `src` 的 iframe 造 `contentDocument`）；③ `WorkbenchView.spec.ts` 的骨架桩改为渲染 `chat` / `preview` 插槽、会话桩补齐右栏与工作空间只读字段、中栏桩加挂载计数（钉住"不重建"）；④ 覆盖率全局地板按实测上调至 77/75/69/78（实测 79.01/76.89/70.72/79.77），并登记 `useMaximizeEscape.ts` 模块阈值（实测 96.55/95.45/100/96.29）。逐项证据见 `tasks.md` §「执行记录」 |
