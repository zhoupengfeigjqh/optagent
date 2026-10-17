# Phase 0 研究：预览面板的「放大 / 缩小」

**Feature**: `011-preview-maximize` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

> 本特性**没有 NEEDS CLARIFICATION**（唯一一项触发范围已在 `/speckit.specify` 阶段收敛为 Q1 = C）。
> 下面的研究项来自"实现前必须验证的既有事实"与"必然要做的技术选择"两类，
> 每条都给出**决策 / 理由 / 被否决的替代**，并在仓库里查到过对应代码证据。

## R1 放大态的状态归属（单一真源放哪里）

**决策**：放在既有的面板会话态 `composables/usePreview.ts` —— 新增 `maximized`（`Ref<boolean>`）、派生 `maximizable`、`toggleMaximize()` / `restoreMaximize()`；退出放大收敛在既有的 `resetContent()` 里（`close()` / `backToList()` / `openList()` 三条路径都经它）。

**证据**：`usePreview.ts` 的 `PreviewStore` 已经持有 `open` / `view` / `target` / `content` / `loading`，并通过 `useAppSession` 注入全树（`useAppSession.ts` L171）；`resetContent()` 正是该文件里"内容态收敛"的唯一出口（L105）。

**理由**：① `FR-007`（关闭面板 / 回列表 / 刷新即回非放大态）与 `FR-032`（目标失效退回列表）能**一处实现**，不必在多个组件里各写一遍收敛；② 该文件已有 80% 模块阈值与 `usePreview.spec.ts`，新增行为的测试成本最低（`FR-042`）。

**被否决**：`AppShell` 局部状态（收不起：面板按钮要驱动它，只能上抬或加双向约定）；`WorkbenchView` 局部状态（与面板的 `open` / `view` 分家，收敛规则要写第二遍）。

## R2 "平铺整个视口"的实现方式

**决策**：给放大态下的**预览列**（`.app-shell__preview`）加 `position: fixed; inset: 0`，由 `.app-shell` 根节点上的放大态类名驱动；其余两栏与分隔条**保持挂载**只被覆盖，并标 `inert`（见 R3）。

**证据**：`AppShell.vue` 用 grid 排三栏（L91~95），`.app-shell` 自身 `overflow: hidden`（L85）；右侧面板列 `.app-shell__preview` 已是 `display:flex; flex-direction:column; min-width:0; overflow:hidden` 且**不透明白底**（L111~113）——把它变成视口覆盖层即可挡住下层，无需额外遮罩元素。`base.css` 对 `html, body, #app` 只设 `height: 100%`，**无 `transform` / `filter`**（`transform` 会是 `position: fixed` 的包含块，这里不存在，覆盖层仍是相对视口定位）。

**理由**：① `FR-030`（不卸载左右栏）**结构性成立**——DOM 与滚动盒从未被动过；② `FR-004`（精确恢复）也结构性成立——栅格列宽与 `--layout-preview-width` 像素值**从未被改写**，`useResizablePanel` 的手动宽度原样保留；③ 只改一个类名 + 一段 CSS，交互反馈远小于一帧（原则五"非推理类交互 ≤ 100ms"）。

**被否决**：

| 替代 | 为什么否决 |
|---|---|
| 栅格收成单列 + 其余栏 `display: none` | `display:none` 会销毁滚动盒 → 消息列表 `scrollTop` 归零、`MessageList` 的"位置记忆"被污染（`FR-030` 破坏）；恢复还要重算列宽 |
| 浏览器原生全屏（`requestFullscreen`） | 连应用头部一起藏掉，"缩小"入口与 X 都不可达（违 `FR-005`）；jsdom 无实现、不可测；且需处理权限/退出事件，收益与成本不匹配 |
| 新建路由 / 整页渲染 | 必须写 URL 或 history，直接违 `FR-007`（不持久化、不写地址栏）；且会把 iframe 重新加载（违 `FR-006`） |
| 自建全屏遮罩容器 + `teleport` 到 `body` | 需要把面板内容搬出原位置（或复制一份），会重建承载节点（违 `FR-006`）并让两栏脱离原树（违 `FR-030`）；纯属重造平台已有的定位能力（原则六） |

## R3 焦点与无障碍：其余两栏怎么"被压在下面"

**决策**：放大态下给左栏 `.app-shell__sidebar`、中栏 `.app-shell__main` **以及分隔条 `.app-shell__resizer`** 加 **`inert`** 属性（属性值为空/为 `undefined` 时移除），**不用** `aria-hidden`，也**不自建焦点陷阱**。

**证据**：三栏都是普通 `aside` / `main`（`AppShell.vue` L46~56），没有模态语义；**分隔条自带 `tabindex="0"` 且被覆盖层挡住**（`AppShell.vue` L60~71），不纳入 `inert` 就会成为"看不见但 Tab 得到"的控件（正是本决策要消除的那类问题）；聊天区里已有全局键盘入口（`ChatPanel.vue` 的 window Esc 监听）与可聚焦控件。

**理由**：宪章原则四要求"焦点 MUST 可见、Tab 顺序合理"。覆盖层若只是视觉遮挡，Tab 会把焦点送到**被盖住**的控件上（用户看不见焦点在哪）；`inert` 是平台原生语义，一次性解决"不可点、不可 Tab、不进无障碍树"，且**不动布局、不动滚动位置**（与 R2 的不卸载口径一致）。

**被否决**：`aria-hidden="true"`（只影响读屏，键盘仍能落到不可见控件）；自建焦点陷阱（重造平台能力，且要处理 Tab 环绕、初次聚焦、异常路径，原则六）。

**已接受的后果（登记）**：放大态下用户无法用鼠标点中栏的"停止"（界面本就不可见）。`FR-031` 约束的是**行为不被改动**，不是"界面必须可见可点"——退出路径是「缩小」按钮与 Esc（`FR-005` / `FR-021`），故该后果不构成要件冲突。

## R4 Esc 与既有"Esc 中断本轮"的冲突如何解

**决策**：新增 `composables/useMaximizeEscape.ts`：

- `useMaximizeEscape({ active, onRestore })`：**仅当放大态为真**时在 `window` 上挂 `keydown` 监听，且用 **`{ capture: true }`**；命中 `Escape` 且**当前无 `<dialog>[open]`** 时，`preventDefault()` + `stopPropagation()` 后回调；退出放大态即摘除，组件卸载时同样摘除。
- `bindFrameEscape(doc, onRestore)`：把**同源 iframe 文档内**的 Esc 转成同一次"退出放大"（每个文档只绑一次，用模块级 `WeakSet` 去重）。

**证据**：`ChatPanel.vue` L165~180 —— `window.addEventListener('keydown', onEscapeKey)`（**冒泡阶段**），处理体第一句就是 `if (event.key !== 'Escape' || event.defaultPrevented) return`，并在有无 `dialog[open]` 时直接放行；`MentionPopup.vue` 的 Esc 用 `stopPropagation` 先例（L92~96）。

**理由**：① 捕获阶段在同为 `window` 的监听器里**先于** `ChatPanel` 的冒泡监听执行；`stopPropagation()` 之后事件不再传播，`ChatPanel` 根本收不到 → `FR-021`（Esc 只退出放大、不中断回答）成立；② 非放大态**根本不挂监听** → "改动前行为零变化"是结构性保证，不需要在别的组件里加判断；③ `dialog[open]` 放行保住原生 `<dialog>` 的 Esc 关闭语义（确认删除之类的弹窗优先）。

**为什么还要 `bindFrameEscape`**：同源 iframe 是一份**独立文档**，其中按下的 Esc **不会**冒泡到父文档的 `window`；而 iframe 页面正是本特性的主场景（`FR-010` 口径 C 的第一类）。不做转发的话，用户"点进页面再按 Esc"会毫无反应——要件 `FR-021` 那句话就不成立。同源正是能拿到 `contentDocument` 的前提，与既有 `ensureInnerScroll` 的边界完全一致（`WorkspacePanel.vue` L151~159）。

**被否决**：把判断塞进 `ChatPanel`（让聊天组件知道"预览在放大"——概念穿层）；监听 `document` 而不带捕获标记（注册顺序仍由挂载顺序决定，行为不可预期）；不转发 iframe 内 Esc 并登记为已知限制（要件不满足）。

## R5 "可放大范围"判据的唯一实现（Q1 = C）

**决策**：判据只在 `usePreview.ts` 的派生值里写一次：

```text
可放大内容 = （target.kind === 'url' && target.renderMode === 'iframe'）
          || （target.kind === 'file' && content?.renderMode ∈ { 'pdf', 'image' }）

入口可见   = maximized || 可放大内容        // FR-005：放大态必须始终留出口
```

**证据**：`PreviewTarget` / `PreviewContent` 的类型与取值就在 `usePreview.ts`（L33~52）；`PreviewContent.renderMode` 的取值集合为 `text | pdf | image | download | error`（L46）。

**理由**：① `FR-010` 明确要求"判据只有一处实现"；面板组件只消费布尔 prop，模板里不再出现对 `content.renderMode` 的判断；② `maximized || 可放大内容` 这一项是**必须的**：放大态下切到新目标要经历"加载中"（`content` 为 `null`、`target` 在预检期是 `{kind:'none'}`），若入口只随"可放大内容"显隐，就会出现"全屏状态下缩小按钮消失"——直接违 `FR-005`；`FR-012` 的用例会踩到这个窗口。

**被否决**：判据放在 `WorkspacePanel.vue`（面板要看 `content` 细节 → 与 store 形成两份判据，且面板不再是纯展示）；判据抽成 `utils/preview-maximize.ts` 纯函数（要把 `PreviewTarget` / `PreviewContent` 类型搬进 `utils`，而这两个类型属于 store 的公开面，会造成类型归属漂移；收益仅是"看起来更纯"）。

## R6 图标怎么来（零新增依赖）

**决策**：在既有 `components/common/BaseIcon.vue` 的 `ICON_PATHS` 里新增 `maximize` / `minimize` 两条（feather 风格 24×24 描边路径），不引图标库、不在面板里内联 `<svg>`。

**证据**：`BaseIcon.vue` 内置路径表（L23~67），组件注释明确写着"不引入任何图标库，路径表内置在组件内，保持零框架外依赖"；`ICON_PATHS` 目前无放大 / 缩小语义的条目（`chevron-*`、`more`、`download` 等均不可替代）。

**理由**：符合原则六（能用既有能力实现就不引库）；图标渲染的唯一实现保持在 `BaseIcon`（原则二）。

**代价（登记）**：`BaseIcon.vue` 被改动 → 按原则三需补一份同名的 `BaseIcon.spec.ts`（当前仓库**没有**这个文件）。这是"改动即约束"的直接后果，不是存量补测专项（治理 § 不追溯只禁止回溯性专项）。

## R7 覆盖层的层级（z-index）

**决策**：新增设计令牌 `--z-index-panel-maximized: 150`（放在 `--z-index-dropdown: 100` 与 `--z-index-dialog: 200` 之间），覆盖层用它。

**证据**：`styles/tokens.css` L80~83 是唯一的层级令牌来源；`ToastHost` 用 `--z-index-toast: 300`（L67），`BaseDropdown` 用 `--z-index-dropdown: 100`（L311）。

**理由**：确认弹窗（原生 `<dialog>` 的 top layer，且令牌 200）与 toast（300）**必须仍然浮在放大层之上**——否则"放大态下删除文件"的二次确认会被盖住（原则五"破坏性操作 MUST 二次确认"，确认框看不见等于没有）。

**被否决**：硬编码 `150`（脱离令牌体系，下次调层级要全仓搜）；复用 `--z-index-dropdown`（语义错位：一个下拉菜单的层级不该决定面板能否平铺）。

## R8 是否需要新增依赖 / 是否有平台相关行为

**决策**：**零新增依赖**；**无平台相关行为**。

**证据与理由**：全部改动是 `computed` / `watch` / 类名绑定 / 一段 CSS / `inert` 属性 / iframe `contentDocument` 的键盘监听；不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块。`position: fixed`、`inset`、`inert` 均为现代浏览器平台能力（Chrome 102+ / Safari 15.5+ / Firefox 112+ 起支持 `inert`）。

**登记的风险（唯一）**：`inert` 在**极旧浏览器**上无效（退化为"仍可 Tab 到被覆盖的控件"）。判定为**可接受**：本项目是三栏工作台单用户内部工具（宪章「组成与端口」未声明兼容更旧的浏览器），且失效时是**渐进降级**——覆盖层与 Esc 退出照常，只是键盘焦点可能落到被盖住的控件上；不引入任何"假绿"或数据风险。该取舍写入 `plan.md` 的「复杂度跟踪」。

## 未决项

无。`/speckit.plan` 的 Phase 1 可基于以上决策产出 `data-model.md` / `contracts/` / `quickstart.md`。
