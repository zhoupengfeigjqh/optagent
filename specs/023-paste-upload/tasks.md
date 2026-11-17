# 任务清单：聊天区粘贴上传（2026-11-17）

状态：全部完成。仅 `frontend`，无后端与契约改动。

## 实现

- [x] T1 `utils/upload-batch.ts`：新增 `precheckBatch`（不早停、按 index 回指）与剪贴板文件名归一化（`pastedFileName` / `withPastedName`，只映射白名单 MIME）
- [x] T2 `composables/useUploads.ts`：新增 `uploadAllOrNothing`（先整批校验 → 全过才发起；白名单为空返回 `notReady`）
- [x] T3 `composables/useUploadPanel.ts`：新增 `onPasteFiles`（加载 workspace → 判引用上限 → 展开面板 → 整批校验上传），新增 `toast` / `referenceCount` 依赖
- [x] T4 `components/chat/Composer.vue`：`paste` 事件识别剪贴板文件并 `emit('paste-files')`，纯文本粘贴路径不变；抽出胶囊工厂 `utils/composer-chip.ts`（同时把组件拉回 500 行门禁内）
- [x] T5 `components/chat/ChatPanel.vue` + `composables/useChatPanel.ts`：接线 `onPasteFiles`
- [x] T6 `constants/spaces.ts`：`TMP_SPACE` 唯一常量（运行时以 workspace 响应校验存在性）

## 测试

- [x] T7 `utils/upload-batch.spec.ts`（11 例：全过 / 部分不合格 / 多个不合格 / 同名按 index / 空白名单 / 补名与未知 MIME）
- [x] T8 `composables/useUploads.spec.ts` 增补（整批拒绝零请求、全过逐文件、notReady、重试仍不发请求）
- [x] T9 `composables/useUploadPanel.spec.ts` 增补（整批上传到临时空间、拒绝仍展开面板、超引用上限、未加载先 load、临时空间缺失）
- [x] T10 `components/chat/Composer.spec.ts` 增补（有文件 → 上报且不插入文本、补名、图文混贴、纯文本不变、发送中忽略）

## 验证

- [x] `vue-tsc --build --force` 通过
- [x] 改动文件 eslint 0 错误
- [x] 行数门禁：`Composer.vue` 487 / `ChatPanel.vue` 488 / `useChatPanel.ts` 481（均 < 500）
- [ ] 真实剪贴板手工验收（截图 / 资源管理器多文件 / Word 图文混贴 / 超限 / 黑名单扩展名）

## 2026-11-17 追加：呈现口径收敛 + 暂存回收（v1.1 / v1.2）

- [x] T11 `composables/useUploads.ts`：`uploadAllOrNothing` 结果收敛为 `{ ok, rejections, failed }`（校验不过不建行）；新增 `forget(localId)` 供回收后摘记录
- [x] T12 `composables/useWorkspace.ts`：抽出 `dropFromCache`，新增 `removeQuietly`（成功静默、失败必提示；缓存同步与 `remove` 同源）
- [x] T13 `composables/useUploadPanel.ts`：粘贴暂存表 + `syncStaged` / `recycle` / `commitStaged`；注入 `references` / `scope` / `recycleDelayMs`；跨作用域只丢弃不删
- [x] T14 `composables/useChatPanel.ts`：发送成功（`mention.reset()` 之前）调 `commitStaged`；把 `references` / `scope` 传给上传面板
- [x] T15 `constants/limits.ts`：`STAGED_FILE_RECYCLE_MS = 30_000`
- [x] T16 单测：`useUploads.spec`（forget）、`useWorkspace.spec`（removeQuietly 3 例）、`useUploadPanel.spec`（暂存回收 7 例：仍引用不删 / 冷却后静默删 / 冷却内恢复 / 转正 / `+` 不参与 / 失败保留 / 换数字人不删）

验证（2026-11-17）：`vue-tsc --build --force` 通过；eslint 0 错误；前端全量单测 **120 files / 1390 tests 全绿**。

## 2026-11-17 追加：落盘时机后移到发送（v1.3）

用户口径（六条）：**粘贴未发送不落盘**；粘贴时不查磁盘重名、只查格式；发送时才存临时空间；发送时对「临时空间 + 当前聊天区文件」去重，重名加 `(n)` 并在气泡显示；不再弹重名窗；取消 30 秒冷却回收。

实现：

- [x] `utils/upload-name.ts`（新增）：`splitName` / `candidateName` / `allocateName`，与后端 `domain/upload-name.ts` 逐字对齐（半角 `(n)`、编号在扩展名前、`.env` / `README` / `a.tar.gz` 边界、大小写不敏感）
- [x] `utils/upload-batch.ts`：删除 `duplicatedFileNames`；新增 `partitionBatch`（逐文件取舍）
- [x] `composables/useUploads.ts`：删除 `uploadAllOrNothing` / `forget`；新增 `uploadNamed`（带名、**不建记录**、回传服务端真名）
- [x] `composables/useUploadPanel.ts`：粘贴改为「只校验 + 只入胶囊」；新增 `flushPending`（发送时落盘、预演命名、失败返回 `null`、重试复用已落盘真名）/ `isPending` / `commitPending`；**删除**暂存表、冷却回收、重名弹窗与 `references`/`scope` 的删除语义
- [x] `composables/useMentionComposer.ts`：`onPickFile` 返回 `boolean`（粘贴侧据此决定内存文件留不留）
- [x] `composables/useChatPanel.ts`：`onSend` 在 MCP 就绪之后、`chat.send` 之前调 `flushPending`，失败即返回 `false`；成功路径改调 `commitPending`；引用存在性校验豁免待发件
- [x] `composables/useWorkspace.ts`：删除 `removeQuietly`（`remove` 内联删除 + 提示）
- [x] `constants/limits.ts`：删除 `STAGED_FILE_RECYCLE_MS`
- [x] `components/chat/ChatPanel.vue`：删除「文件名重复」确认弹窗与 `duplicateMessage`
- [x] 三个 `ChatPanel.*.spec.ts`：移除已删的 3 个面板出口

测试：

- [x] `utils/upload-name.spec.ts`（16 例：切分 / 编号位置 / 码点截断 / 大小写 / 连号 / 上限兜底）
- [x] `utils/upload-batch.spec.ts` 增补 `partitionBatch`（3 例），删除 `duplicatedFileNames` 相关
- [x] `composables/useUploads.spec.ts`：删 5 例 `uploadAllOrNothing` + 1 例 `forget`，增 `uploadNamed` 3 例
- [x] `composables/useWorkspace.spec.ts`：`removeQuietly` 3 例改为 `remove` 2 例
- [x] `composables/useUploadPanel.spec.ts`：删暂存回收 7 例；粘贴段重写为「不落盘」9 例 + `flushPending` 11 例

验证（v1.3）：`npx vitest run` 全量通过；`vue-tsc --build --force` 通过；eslint 0 错误。

- [ ] 真实剪贴板手工验收（截图 / 多文件 / 同名件 / 超 5MB / 发送中断网）

## 2026-11-17 追加：会话隔离（v1.4，修 v1.3 的真机故障）

现场故障（用户报）：**新对话里粘贴文件 → 点发送 → 文件没上传**；若临时空间恰好有同名文件，消息会**静默引用那个旧文件**，全程零提示。

根因：v1.3 把"作用域（数字人 + 会话 id）变化即清空待发件"当成了"用户换了会话"。而新对话的会话 id 是 `null`，发送时 `threads.create()` 才变成真 id——**自动建会话被误判成切会话**，待发件在 `flushPending` 之前就被清空；消息照发，附件只剩名字。

同一个根因的另两个症状：引用集合是全局单例而草稿是按会话分桶，于是"会话 1 粘了文件没发 → 切到会话 2 再粘同名文件"会莫名多出 `(1)`，且那个看不见的引用会被当成附件发出去。

修复：

- [x] `composables/useThreadBuckets.ts`（新增）：按会话分桶的通用实现（切走存 / 切回取 / `null` 不建桶 / 桶上限 50 / `move` 用于接管）
- [x] `composables/useThreadDrafts.ts`：改为复用通用分桶（对外 API 与行为不变）
- [x] `composables/useFileMention.ts`：引用也按会话分桶（`thread` 依赖）；`null → 真 id` 视为**接管**（`move`），不清空
- [x] `composables/useUploadPanel.ts`：待发表改为「会话 → 表」；`draft` 依赖用于"只认草稿里看得见的引用"；删掉 `scope` 依赖与"作用域一变就清空"
- [x] `composables/useChatPanel.ts`：`flushPending` 提到 **`threads.create()` 之前**；依赖改为 `agent` / `thread` / `draft`
- [x] 发送时命名基名改用**原始文件名**（消掉 `a(1)(1).csv` 双后缀）
- [x] `useAppSession.ts`：给 mention 传入 `thread` 依赖

测试：

- [x] `useFileMention.spec.ts` +4 例（切走存切回取 / 自动建会话接管 / 新建对话清空 / 两会话同名互不影响）
- [x] `useUploadPanel.spec.ts` +2 例、改 1 例（换数字人丢弃 / 切会话再回来仍可发 / 自动建会话接管后仍落盘 / 幽灵引用不占名）
- [x] `useUploadPanel.spec.ts` 名额用例改为按"可见引用数"驱动（不再用 `referenceCount` 覆盖）

验证（v1.4）：全量单测通过（**121 files / 1420 tests**）；`vue-tsc --build --force` 通过；eslint 0 错误。

- [ ] 真机复验：新对话粘贴发送必须落盘；会话 1 粘 → 会话 2 粘同名 → 无 `(1)`；切回会话 1 仍可发

