# 界面契约：上传面板接线、记录生命周期与 `@` 回写

**特性**：`012-upload-record-naming` | **日期**：2026-10-18

> 本特性**不新增控件**、不改变 `UploadMenu.vue` 的 props / emits 形状；变化全部在 composable 层的行为口径上。
> 契约的消费者是：`views/WorkbenchView.vue` → `components/chat/ChatPanel.vue` → `useChatPanel` → `useUploadPanel`。

## 1. `UploadMenu.vue`（**形状不变**，仅行为由上层驱动）

| Prop | 类型 | 说明 |
|---|---|---|
| `open` | `boolean` | 是否展开 |
| `spaces` | `WorkspaceSpace[]` | 三空间树（workspace 接口下发，前端不保留目录常量） |
| `uploads` | `UploadedDocument[]` | 记录列表；**空数组 ⇒ 不渲染记录区**（`FR-015`） |

| Emit | 载荷 | 说明 |
|---|---|---|
| `pick` | `{ dir, files: FileList }` | 用户选了目录并挑完文件 |
| `retry` | `localId: string` | 重试某条失败项 |
| `close` | — | 面板自带关闭入口 |

**不变承诺**：目录树渲染、`accept` 的目录级白名单、字段约束提示与既有测试断言**逐条不变**。

## 2. `useUploadPanel.ts`（**新增**，`useChatPanel` 装配）

```ts
interface UploadPanelDeps {
  uploads: UploadsStore
  workspace: WorkspaceStore
  /** 复用 `mentionComposer.onPickFile`：登记引用 + 写 `@标记` + 上限/去重/提示 */
  acceptUpload: (reference: FileReference) => void
}

interface UploadPanel {
  uploadOpen: Readonly<Ref<boolean>>
  onToggleUpload(): void     // 展开；或收起并 clear()
  onCloseUpload(): void      // 收起并 clear()
  onPickFiles(payload: { dir: string; files: FileList }): void
  onRetryUpload(localId: string): void
}
```

### 2.1 行为表

| 动作 | 必须发生 | 必须不发生 |
|---|---|---|
| 展开 | 若 `workspace.spaces` 为空且未在加载 ⇒ 触发一次 `workspace.load()` | 不清空记录（清空只发生在收起） |
| 收起（`onToggleUpload` 由开转关 / `onCloseUpload`） | `uploads.clear()`（清终态、留上传中） | 不删文件、不动草稿与引用、不取消进行中的上传 |
| `onPickFiles` | `uploads.upload(dir, files, workspace.uploadExtensionsOf(dir))` | 不自行校验扩展名（服务端 + `isUploadAllowed` 已各有一处） |
| `onRetryUpload` | `uploads.retry(localId)` | 不新建记录（复用同一 `localId`） |
| 记录首次转 `success` | `workspace.registerFile({dir, filename, size})` **然后** `acceptUpload({dir, filename})` | 失败项**零调用**；同一 `localId` 不重复调用 |

### 2.2 回写次序与幂等

1. **先登记清单、后写标记**：`exists` 必须在标记出现前就可为真（否则用户"看到 `@` 却发不出去"）。
2. 幂等键 = `localId`。用 `Set<string>` 记录已回写过的 `localId`；`retry` 后的二次成功**不重复**回写（`I2`）。
3. 面板关闭后才到终态的上传：**照常回写**（`FR-013`，Q2 = B），但**不**重新打开面板、不产生新记录。

## 3. `UploadsStore`（`useUploads.ts`）契约

| 成员 | 语义 | 本次变化 |
|---|---|---|
| `items` | 记录列表（只读 ref） | 不变 |
| `upload(dir, files, exts?)` | 逐文件各发一次请求；单文件失败不影响其余 | 不变 |
| `retry(localId)` | 复用同一记录重发 | 不变 |
| `clear()` | **移除终态（`success` / `failed`）记录，保留 `pending` / `uploading`**；同时释放被移除项的原始 `File` 引用 | **口径变更**（原为"只移除成功项"） |

**不变式**：`clear()` 之后 `items` 中只剩"进行中"的项；这些项到达终态后**不会**被自动清掉（要等下一次收起）。

## 4. `WorkspaceStore.registerFile`（**新增**）

```ts
registerFile(file: { dir: string; filename: string; size: number }): void
```

| 条件 | 行为 |
|---|---|
| `dir` 存在且 `{dir,filename}` 未登记 | 追加 `{ filename, size, updated_at }`，`spaces` 不可变替换 |
| 已登记 | 幂等 no-op |
| `dir` 未知（清单未加载 / 非本数字人目录） | no-op，**不抛错** |

**理由**：发送前 `exists()` 只读已加载清单；不登记则刚上传的文件会被判"引用已不存在"（`FR-004`）。

## 5. `@` 写入契约（复用既有，不新增实现）

| 项 | 口径 |
|---|---|
| 标记拼写 | 只有 `useFileMention.mentionToken()` 一处：`@${filename}`（落盘名，含 `(n)` 后缀） |
| 写入动作 | 只有 `useMentionComposer.onPickFile()`：`mention.pickFile` → `insertToken` → `mention.close` |
| 插入位置 | 草稿**末尾**，后缀一个空格；`insertToken` 会先吃掉光标前未完成的 `@xxx` 片段 |
| 光标 | **不移动**（`FR-005`） |
| 上限 | `MAX_REFERENCES_PER_MESSAGE = 10`：超限时 `pickFile` 返回 `false` 并 toast；上传记录仍为"已完成"（`FR-006`） |
| 去重 | 同 `{dir, filename}` 不重复登记（落盘名唯一 ⇒ 实践中不触发） |
| 删除同步 | 用户从正文删掉标记 ⇒ 引用随之移除（既有 `handleInput` 不变式）；清空记录 MUST NOT 使其复活（`FR-007`） |

## 6. 收起路径矩阵（`FR-014`）

| 路径 | 触发点 | 结果 |
|---|---|---|
| 再点 `+` | `useUploadPanel.onToggleUpload` | 收起 + `clear()` |
| 面板关闭入口 | `UploadMenu` `close` → `useUploadPanel.onCloseUpload` | 收起 + `clear()` |
| 切换数字人 | `useAppSession.agents.onSwitched` | `uploads.clear()` + `workspace.load()`（视角切到新数字人） |
| 发送消息 / 刷新页面 | — | 不清空 / 刷新即丢 |

> 切换数字人时"上传中"项按 `FR-013` 保留，其 `dir` 仍指**原**数字人数据域；界面按原值展示，不静默改挂。

## 7. 无障碍与用户可感知（原则四 / 九）

- **不新增交互控件**：`+`、目录按钮、文件选择、重试按钮全部沿用既有原生控件与键盘路径。
- **状态不只靠颜色**：记录项仍以文本状态（待上传 / 上传中 / 已完成 / 上传失败）+ 原因文本表达。
- **降级必须可感知**：候选名用尽（409）、超长名（400）、引用上限（10）三条路径都有中文提示，**无静默分支**。
- **焦点**：自动回写只改文本，不夺焦点、不改光标位置；`@` 面板若因写入而关闭（`onPickFile` 既有行为），焦点仍在输入框。
- **读屏通知（2026-10-18 明确：不做）**：自动回写**不**新增 `aria-live` 播报。理由：该文本变化由用户刚刚发起的上传动作直接导致
  （因果紧邻），且记录列表本身已用文本状态（"已完成 / 上传失败 + 原因"）表达结果；再加一条全局播报会在批量上传时造成重复朗读。
  读屏用户获取结果的路径是**记录列表的文本状态**，不是输入框的静默追加——这一点必须在实现里保持不变（`FR-015` 的空态断言即其一）。
