# Phase 1 数据模型：预览面板的「放大 / 缩小」

**Feature**: `011-preview-maximize` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

> **本特性不涉及持久化数据**：无落盘、无接口字段、无 `localStorage` / `sessionStorage` 键、不写地址栏（`FR-007`）。
> 本文件描述的是**界面状态模型**（放大态的取值、派生与迁移），它是 `FR-001`~`FR-034` 的判定基础。

## 1. 实体

### 1.1 放大态 `maximized`（新增）

| 属性 | 值 |
|---|---|
| 类型 | 二值（`boolean`） |
| 归属 | `composables/usePreview.ts`（会话态，`useAppSession` 注入全树） |
| 初值 | `false` |
| 生命周期 | **瞬态**：仅存活于内存；刷新、关闭面板、回到列表态即回 `false` |
| 唯一真源 | 是（MUST NOT 在组件内另立影子标志，`FR-006` / 原则二） |
| 语义 | "预览内容是否平铺整个视口"——**不改变** `target` / `content`，只改变呈现 |

### 1.2 可放大内容 `maximizable`（新增，派生）

由 `target`（既有）与 `content`（既有）派生，**判据唯一实现在 `usePreview.ts`**（`FR-010`）。

| 输入（`view` = `content` 时） | 取值 | 可放大 |
|---|---|---|
| `target = { kind:'url', renderMode:'iframe' }` | 同源 `viewUrl` 入口，面板内 iframe | **是**（口径 C ①） |
| `content.renderMode = 'pdf'`（`target.kind='file'`） | 本地 PDF 预览 | **是**（口径 C ②） |
| `content.renderMode = 'image'`（`target.kind='file'`） | 本地图片预览 | **是**（口径 C ②） |
| `content.renderMode = 'text'` | 文本 / CSV / JSON 正文 | 否 |
| `content.renderMode = 'download'` | 不支持内联的类型、或同源预检为需下载 | 否 |
| `content.renderMode = 'error'` | 预检失败 / 超限 / 不存在（给"下载完整文件"引导） | 否 |
| `target = { kind:'url', renderMode:'download' }` | 同源但需下载的入口 | 否 |
| `target = { kind:'none' }` 或 `view='list'` | 空内容态 / 文件空间列表 | 否 |

> 前 3 行 = `FR-010` 的"范围内"，后 5 行 = "范围外"。这张表即 `FR-010` 的 8 例判据矩阵（钉在 `usePreview.spec.ts`）。

### 1.3 入口可见性 `maximizeToggleVisible`（新增，派生）

```text
maximizeToggleVisible = maximized || maximizable
```

**为什么不直接等于 `maximizable`**：放大态下切换目标会经过"预检中 / 加载中"窗口（`target` 短暂为 `{kind:'none'}`、`content` 为 `null`），此时 `maximizable` 为假——若入口随它显隐，就会出现**全屏状态下缩小按钮消失**（违 `FR-005`）。`|| maximized` 保证"已在放大态 ⇒ 出口永远在"。

### 1.4 既有实体（本特性只读、不改口径）

| 实体 | 出处 | 本特性的关系 |
|---|---|---|
| `PreviewTarget`（`none` / `file` / `url`） | `usePreview.ts` | 只读：判据的输入之一 |
| `PreviewContent`（`text` / `pdf` / `image` / `download` / `error`） | `usePreview.ts` | 只读：判据的输入之二 |
| `PanelView`（`list` / `content`） | `usePreview.ts` | 只读：`list` 下入口零出现 |
| 面板手动宽度（`useResizablePanel.width`） | `useResizablePanel.ts` | **不动**：放大期间保持原值，缩回即原样生效（`FR-004`） |

## 2. 状态迁移

```text
                    ┌──────────────── toggleMaximize() ────────────────┐
                    │                                                  ▼
          [ maximized = false ]                              [ maximized = true ]
            （面板正常宽度）                                     （预览列铺满视口）
                    ▲                                                  │
                    └──────────── restoreMaximize() / Esc ─────────────┘
                    │                                                  │
    resetContent()（close / backToList / openList 三条路径的共同出口）    │
                    └─────────────── 一律回到 false（FR-007 / FR-032）──┘
```

| 触发 | 效果 | 对应要件 |
|---|---|---|
| 点「放大页面」 | `false → true` | `FR-003` |
| 点「缩小页面」 | `true → false` | `FR-004` |
| Esc（焦点在本页或同源 iframe 内） | `true → false` | `FR-021` |
| 点「收起」（X） | 面板收起 + `true → false` | `FR-005` / `FR-007` |
| 内容态 → 列表态（`backToList`） | `true → false` | `FR-007` |
| 打开文件空间列表（`openList`） | `true → false` | `FR-007` |
| 目标失效（删除当前预览的文件等 → `onFileRemoved` → `backToList`） | `true → false` | `FR-032` |
| 同源预检失败（`fallback` → `close()`） | 面板收起 + `true → false` | `FR-034` |
| 切换预览目标（`openFile` / `openView` 成功） | **保持** `true`，内容换新 | `FR-012` |
| 刷新页面 | 回到 `false`（无任何持久化写入） | `FR-007` |
| 切换会话 / 数字人 | 不影响（放大态挂在面板会话态上，不随会话重取；若面板被收起则随 `close()` 归零） | `FR-031` |

## 3. 不变式（MUST 成立，由测试钉住）

| # | 不变式 | 破坏时的表现 | 钉住它的用例 |
|---|---|---|---|
| I1 | `maximized === true` ⇒ `maximizeToggleVisible === true` | 全屏后没有缩小入口（"放进去出不来"） | `usePreview.spec.ts`：放大态下切到加载中目标后入口仍可见 |
| I2 | `resetContent()` 之后 `maximized === false` | 关掉面板再打开仍是全屏 | `usePreview.spec.ts`：`close` / `backToList` / `openList` 三例 |
| I3 | 放大 / 缩回往返一次，`useResizablePanel.width` 与 `target` / `content` **逐字段不变** | 缩回后宽度跳回默认 1/3、或内容被重新拉取 | `WorkspacePanel.spec.ts`：同一次挂载内 `iframe` 元素引用与 `src` 不变 |
| I4 | 放大态下左栏、中栏与分隔条**仍在 DOM 中**（未被卸载、未重建）且均带 `inert` | 输入草稿与消息滚动位置丢失；或焦点落到被覆盖的控件上（含 `tabindex="0"` 的分隔条） | `AppShell.spec.ts`（三者仍在 + 带 `inert`）；`WorkbenchView.spec.ts`（切换放大不重挂 `ChatPanel` 桩） |
| I5 | 非放大态**不挂**全局 Esc 监听 | 非放大态下 Esc 被吞掉 → "中断本轮回答"失效 | `useMaximizeEscape.spec.ts`：`active=false` 时派发 Esc，回调不被调用 |
| I6 | 有 `dialog[open]` 时放大态的 Esc 监听**放行** | 确认弹窗（删除文件）按 Esc 关不掉 | `useMaximizeEscape.spec.ts`：存在 `dialog[open]` 时回调不被调用 |
| I7 | 范围外内容（文本 / 需下载 / 错误态）下 `maximizeToggleVisible === false` | 面板上出现"点了没变化"的无用按钮 | `usePreview.spec.ts` 8 例矩阵中后 5 例 |

## 4. 校验规则（取自需求）

- `toggleMaximize()` 在 `maximizeToggleVisible === false` 时 MUST **无操作**（不进入放大态）；`restoreMaximize()` 幂等。
- 放大态**不产生**任何网络请求、不写任何存储、不改地址栏（`FR-006` / `FR-007`；由"实现只在内存 ref 上写值"结构性保证，另在 `usePreview.spec.ts` 断言 `probePreview` / `fetchPreviewText` 调用次数不因切换而增加）。
- 放大态的呈现（`position: fixed` / `inert` / 层级令牌）MUST **只依赖类与属性**，MUST NOT 依赖 JS 测量的尺寸（jsdom 无布局，且窗口缩放时无需重算 → `FR-033` 自然成立）。

## 5. 与既有规格的关系

- 本特性**不修改** `specs/002-conversation-runtime/spec.md` 的数据模型（`tool-events.jsonl` 的 `view_links` 等）与接口契约；
- 本特性**不新增**任何接口端点或字段（`FR-043`）；
- 本文件描述的三个新派生值均为**前端界面状态**，不出现在任何 HTTP 载荷中。
