# 接口契约（UI）：预览面板的放大 / 缩小

**Feature**: `011-preview-maximize` | **Date**: 2026-10-16 | **Spec**: [spec.md](../spec.md)

> **本特性不产生 HTTP 契约变更**：无新增端点、无请求 / 响应字段、无 SSE 事件、不改 `frontend/src/api/types.ts`。
> 因此本目录只有**界面契约**（组件 props / emits、会话态增量、全局按键契约）。
> 契约与实际实现冲突时，MUST 立即修正本文件并在 `plan.md` 的修订记录登记口径差异（宪章原则七）。

## 1. 组件契约：`components/layout/WorkspacePanel.vue`

### 1.1 props 增量

| prop | 类型 | 默认 | 语义 | 对应要件 |
|---|---|---|---|---|
| `maximizeVisible` | `boolean` | `false` | 头部是否渲染「放大 / 缩小」入口。由 `usePreview.maximizeToggleVisible` 下发，**面板 MUST NOT 自行推导**（判据唯一实现在会话态） | `FR-001` / `FR-010` / `FR-011` / `FR-013` |
| `maximized` | `boolean` | `false` | 当前是否处于放大态（决定图标、可访问名称与面板根节点的类） | `FR-002` / `FR-022` |

> 既有 props（`view` / `spaces` / `expandedSpaces` / `expandedDirs` / `listLoading` / `target` / `content` / `contentLoading`）**形状不变**。

### 1.2 emits 增量

| 事件 | 载荷 | 触发 | 上层动作 |
|---|---|---|---|
| `toggle-maximize` | 无 | 点击头部入口（放大 ↔ 缩小） | `session.preview.toggleMaximize()` |
| `restore-maximize` | 无 | 放大态下按 Esc（本页或同源 iframe 文档内） | `session.preview.restoreMaximize()` |

> 既有 emits（`close` / `back` / `toggle-space` / `toggle-dir` / `preview` / `download` / `remove`）**不变**。

### 1.3 DOM 契约（可被测试断言的部分）

| 约定 | 值 | 对应要件 |
|---|---|---|
| 头部动作区顺序 | `[下载?] → [放大 / 缩小] → [收起]`（放大入口**紧邻**收起按钮左侧） | `FR-001` |
| 入口元素 | 原生 `<button type="button">`（`BaseButton`），**同一 DOM 节点**在两种状态下复用（不换元素） | `FR-002` / `FR-020` |
| 可访问名称 | `maximized=false` → `放大页面`；`maximized=true` → `缩小页面` | `FR-022` |
| 按压态 | `aria-pressed` 与 `maximized` 同步（`true` / `false` 都写，便于读屏区分"这是开关的哪一态"） | `FR-022` / `FR-023` |
| 放大态标记 | 面板根节点 `aside.workspace-panel` 带类 `workspace-panel--maximized` | `FR-003`（结构性断言点） |
| 无入口时 | **不渲染该按钮**（无 DOM、无占位） | `FR-011` / `FR-013` |

## 2. 布局契约：`components/layout/AppShell.vue`

| 项 | 契约 |
|---|---|
| props 增量 | `previewMaximized?: boolean`（默认 `false`） |
| 根节点 | 放大态时 `div.app-shell` 带类 `app-shell--preview-maximized` |
| 左栏 / 中栏 | 放大态时带 `inert` 属性（移出可达性与无障碍树）；**MUST 保持挂载**（`FR-030`） |
| 预览列 | 放大态时 `position: fixed; inset: 0; z-index: var(--z-index-panel-maximized)`（铺满视口、不透明白底覆盖下层） |
| 分隔条 | 仅在 `previewOpen` 时渲染（既有口径不变）；放大态时**同样带 `inert`**（它 `tabindex="0"` 且被覆盖，不纳入则焦点会停在看不见的控件上），且**宽度状态不被改写**（`FR-004`） |

## 3. 会话态契约：`composables/usePreview.ts`（`PreviewStore` 增量）

| 成员 | 类型 | 语义 |
|---|---|---|
| `maximized` | `Readonly<Ref<boolean>>` | 放大态唯一真源（初值 `false`） |
| `maximizable` | `Readonly<Ref<boolean>>` | 当前内容是否属于"有版面"的可放大范围（见 `data-model.md` §1.2 的 8 例矩阵） |
| `maximizeToggleVisible` | `Readonly<Ref<boolean>>` | `maximized \|\| maximizable`（入口可见性，含"放大态必须留出口"） |
| `toggleMaximize()` | `void` | `maximizeToggleVisible=false` 时**无操作**；否则翻转 `maximized` |
| `restoreMaximize()` | `void` | 置 `maximized = false`（幂等） |

**收敛规则**：`close()` / `backToList()` / `openList()` 经 `resetContent()` 一律把 `maximized` 置 `false`；
`openFile()` / `openView()` **不清** `maximized`（`FR-012`）。

**零副作用保证**：以上成员 MUST NOT 发请求、MUST NOT 写存储、MUST NOT 写地址栏（`FR-006` / `FR-007`）。

## 4. 按键契约：`composables/useMaximizeEscape.ts`（新增）

| 导出 | 签名 | 契约 |
|---|---|---|
| `useMaximizeEscape` | `(deps: { active: () => boolean; onRestore: () => void }) => void` | `active()` 为真时挂 `window` 的 `keydown`**捕获**监听；`Escape` 且无 `dialog[open]` ⇒ `preventDefault()` + `stopPropagation()` + `onRestore()`；`active()` 转假即摘除；组件卸载 MUST 摘除。**MUST NOT 在非放大态挂监听**（否则会吞掉既有的"Esc 中断本轮回答"） |
| `bindFrameEscape` | `(doc: Document \| null, onRestore: () => void) => void` | 把同源 iframe 文档内的 `Escape` 转成一次 `onRestore()`；同一 `Document` **只绑一次**（模块级 `WeakSet` 去重）；`doc === null`（跨域 / PDF 插件文档）时**安全返回**，不抛错 |

**与既有 `ChatPanel` Esc 的关系（必须逐条保持）**：

| 场景 | 行为 | 依据 |
|---|---|---|
| 非放大态按 Esc | 与改动前**完全一致**（有回答在输出时中断本轮） | `FR-021` |
| 放大态按 Esc（焦点在本页） | 只退出放大；**不**中断本轮 | `FR-021` |
| 放大态按 Esc（焦点在同源 iframe 内） | 同上（经 `bindFrameEscape` 转发） | `FR-021` |
| 放大态 + 存在 `<dialog>[open]` | **放行**（弹窗自己的 Esc 语义优先） | `FR-005`（破坏性操作用户可感知） |

## 5. 设计令牌契约：`styles/tokens.css`

| 令牌 | 值 | 语义 | 约束 |
|---|---|---|---|
| `--z-index-panel-maximized` | `150` | 放大后的预览列层级 | MUST 小于 `--z-index-dialog`（200）与 `--z-index-toast`（300）：确认弹窗与提示必须仍浮在放大层之上 |

## 6. 需求 → 实现点映射（评审用）

| 要件 | 实现点 | 契约落点 |
|---|---|---|
| `FR-001` / `FR-002` / `FR-020` / `FR-022` / `FR-023` | `WorkspacePanel.vue` 头部动作区 + `BaseIcon` 的 `maximize` / `minimize` | §1.1 / §1.2 / §1.3 |
| `FR-003` / `FR-004` | `AppShell.vue` 的类名 + `tokens.css` 的层级令牌 + 预览列 `position: fixed; inset: 0` | §2 / §5 |
| `FR-005` / `FR-007` / `FR-011` / `FR-012` / `FR-013` | `usePreview.ts` 的 `maximizeToggleVisible` 与 `resetContent()` 收敛 | §3 |
| `FR-006` | 放大 / 缩小只写 `maximized` 一个 ref（预览 DOM 与 `src` 不动） | §3「零副作用保证」 |
| `FR-010` | `usePreview.ts` 的 `maximizable`（8 例矩阵） | §3 |
| `FR-021` | `useMaximizeEscape.ts` 的捕获监听 + iframe 文档转发 | §4 |
| `FR-030` / `FR-031` | `AppShell.vue` 两侧栏与分隔条保持挂载 + `inert` | §2 |
| `FR-033` | 纯类 / 属性驱动，无 JS 尺寸测量 | §2 / §5 |
