# 研究记录（Phase 0）：上传记录的生命周期与重名编号

**特性**：`012-upload-record-naming` | **日期**：2026-10-18

> 本文件只记录"为什么这样选"，与 `plan.md` 的技术决策 `D1`~`D7` 一一对应。
> 每条结论都已落在具体代码位置；无 `NEEDS CLARIFICATION` 遗留（规格的两项澄清已于 2026-10-18 收敛）。

## R1 上传成功后由谁把 `@落盘名` 写进输入区

**Decision**：新建 `composables/useUploadPanel.ts`，在 `useChatPanel` 内**于 `mentionComposer` 之后**装配；
它 `watch(uploads.items)`，对"首次进入 `success` 的 `localId`"调用 `mentionComposer.onPickFile({ dir, filename })`。

**Rationale**：

- `useChatPanel.ts` 实测 **499 行**，任何内联都会越 500 行硬门禁（原则二）；
- 写 `@` 需要三样东西：输入框文本（`chat.draft`）、引用集合（`mention`）、落盘名（`uploads.items`）。
  这三者只在 `useChatPanel` 这一层同时可见——但"同时可见"不等于"必须内联"，抽出后仍由它装配；
- 复用 `onPickFile` 而不是自写拼接：拼写唯一实现在 `mentionToken`，上限 / 去重 / 提示唯一实现在 `pickFile`（原则二"同一职责只有一处实现"）。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| 在 `createUploadsStore` 注入 `mention` + `draft` | 装配顺序成环：`draft` 属 `chat`，而 `chat` 在 `uploads` **之后**创建（`useAppSession` 装配序）；强行注入会把"跨域依赖"埋进基础 store |
| 在 `ChatPanel.vue` 里 `watch` | 视图层持有业务状态，违反分层（`components → composables → api`） |
| 让 `useUploads.upload()` 直接返回成功列表，由 `onPickFiles` 的调用方逐个插入 | `upload()` 是 `Promise.all` 聚合，拿不到"逐项成功顺序"，且重试路径（`retry`）绕过 `onPickFiles`，会漏回写 |

**验证点**：`useUploadPanel.spec.ts` 断言"成功项恰好回写一次、失败项零回写、重试成功后也回写一次、面板关闭后才完成的也回写"。

## R2 让刚上传的文件"立即可发送"

**Decision**：`WorkspaceStore` 新增 `registerFile({ dir, filename, size })`，上传成功后就地登记；
**不**调用 `workspace.load()`。

**Rationale**：

- 发送前校验是 `workspace.exists(reference)`，它只读 `workspace.spaces` 里**已加载**的清单；
  上传成功后该清单不会自动刷新（只有打开 `@` 面板时才 `load()`），因此不登记就会出现
  "刚插入的 `@报告(1).csv` 一发送就被提示引用不存在"——这是规格 `FR-004` 点名要避免的失败路径；
- 就地登记 O(1)、零请求，且与既有 `remove()` 的"就地移除"**成对**：同一个 `spaces` 不可变替换手法，认知成本最低；
- 全量 `load()` 在批量上传时是 N 次请求，并且会重建目录列表（用户刚展开的二级目录状态虽在 store 里，但列表滚动位置会跳）。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| 每次成功 `void workspace.load()` | 批量 10 个文件 ⇒ 10 次全量请求；且与"上传完能立刻对话"的低延迟目标相反 |
| 把 `exists` 放宽为"清单 ∪ 本次已上传集合" | 同一职责两处实现；且文件被删除后该集合仍为真（假阳性） |
| 发送前不做存在性校验 | 违反既有 `FR-018` / `V-15`（002 规格），会向 agent 传不存在的引用 |

**验证点**：`useWorkspace.spec.ts` 三例（登记后 `exists` 真 / 重复登记不重复 / 未知目录 no-op）。

## R3 收起面板时到底清什么

**Decision**：`uploads.clear()` 口径改为"移除终态（`success` / `failed`），保留 `pending` / `uploading`"；
三条收起路径共用：`+` 收起、面板关闭入口（`onCloseUpload`）、切换数字人（`useAppSession.onSwitched`）。

**Rationale**：

- 规格 Q2 = B：关闭那一刻**还在传**的项不参与清空，继续完成并把记录留到下次展开；
- 现 `clear()` 是"只移除成功项、保留失败项"——与需求 2 的"失败也不要留"相反；改口径比新增第二个方法更不容易漏接；
- 三条路径共用同一函数 ⇒ `FR-014` 的"同口径"是结构性成立，而不是三处各写一遍判断。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| 关闭时取消进行中的上传 | 需要 AbortController 贯穿 multipart 与暂存清理；"已落盘一半"更难收场；规格已定"不取消" |
| 关闭时清全部记录 | 违背 Q2 = B：用户会"看不见那条还在传的文件" |
| 新增 `clearTerminal()` 保留 `clear()` | 两个近似方法并存，调用方迟早选错（原则二） |

**验证点**：`useUploads.spec.ts` 的 1 成功 + 1 失败 + 1 上传中用例；`useUploadPanel.spec.ts` 的三条收起路径接线。

## R4 并发同名文件如何保证零覆盖

**Decision**：`claimName()` 按候选名依次做**排他占名**：`fs.linkSync(staging, dest)`，成功即占用；
`EEXIST` 换下一个编号；`link` 不可用（`EPERM` / `EXDEV` / `ENOTSUP` / `EMLINK`）时回退
`fs.copyFileSync(staging, dest, fs.constants.COPYFILE_EXCL)`（同样"已存在即失败"）。

**Rationale**：

- 宪章原则五要求"并发写入 MUST 有锁机制或等价的并发控制（**原子改名、同步"检查+占位"**）"——
  `link` / `COPYFILE_EXCL` 正是"检查 + 占位"在**一次系统调用**内完成；
- 旧实现 `existsSync` 预检 + `renameSync` 是典型 TOCTOU：同批并发同名（`Promise.all` 逐文件各发一次请求）
  会互相覆盖，且 `renameSync` 覆盖时**不报错**（Windows 与 POSIX 都静默替换）；
- `link` 是 O(1)（暂存与目标同属 `user-data/{agent}` 同一卷），不额外搬运 13MB 级数据；
- 不在代码里判断 `process.platform` 的大小写敏感性——"是否冲突"由目标 FS 回答，天然满足 `FR-023`。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| `existsSync` 预检 + `renameSync`（现状） | TOCTOU；并发同名互相覆盖，正是本次要修的缺陷 |
| 进程内 Mutex / 锁表 | 仅单进程有效；多实例部署失效；还要维护锁生命周期 |
| 先写随机名再改名 | 多一次 IO，且**仍然**需要判重（没有解决原子性） |
| 目录级 `O_EXCL` 锁文件 | 多一个临时文件与清理责任；`link` 已足够 |

**验证点**：`upload-name.spec.ts` 断言"第二次占名失败且第一个文件内容未被改写"；
`files-scenario.spec.ts` 用 `Promise.all` 打 3 个同名上传，断言 3 个不同 `filename` 与 3 份不同内容。

## R5 候选名用尽与超长文件名

**Decision**：`MAX_NAME_ATTEMPTS = 999`；用尽后抛 `ApiError(409, 'FILE_NAME_CONFLICT', '同名文件过多，无法生成唯一文件名')`。
单段名超限时先截断主名（保留 `(n)` 与扩展名，目标 **200 字符**），仍 `ENAMETOOLONG` 则
`ApiError(400, 'VALIDATION_FAILED', '文件名过长，无法落盘，请重命名后重试')`。

**Rationale**：

- 原则九：重试 MUST 有界、失败 MUST 显式且可理解；无限 `while (existsSync)` 是"无限重试"；
- 409 语义正确（与资源的当前状态冲突），且全局错误码表里无同义码；
- 截断而不是直接失败：用户视角"名字被缩短"比"传不上去"伤害更小；但**不能静默**，故保留扩展名与编号，便于追溯。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| 无限编号递增 | 无界重试；目录被灌满时请求永不返回 |
| 复用 `INTERNAL_ERROR` | 把"名字冲突"说成"系统繁忙"，误导用户（原则九"降级必须用户可感知"） |
| 直接拒绝超长名（不截断） | 用户拿到"传不上去"，但名字本身可以缩短解决——截断是更低成本的降级 |

**契约影响**：新增错误码 `FILE_NAME_CONFLICT`，四处同步（`contracts/http-upload.md` / `error-message.ts` / 抛出点 / 测试）；
`spec.md` 的 `FR-040` 已回写该增量。

## R6 后端如何满足 500 行硬门禁

**Decision**：把 `agent-backend/src/routes/files.ts`（实测 **543 行**，已超限）中的上传端点整体搬入
`routes/files-upload.ts`，把 `currentAgentFor` / `checkDir` 提取到 `routes/files-scope.ts`（两处共用），
命名算法落到 `domain/upload-name.ts`。

**Rationale**：

- 原则二：MUST NOT 保留超过 500 行的文件；而本次**正好改动**上传端点，属"本次改动涉及的文件"，不是无关重构；
- 仓库已有先例：`routes/files-put.ts` 的头注释明确写着"因新增端点后越过 500 行硬门禁，按一个端点族一个文件拆开"；
- 分层校正：旧代码在路由里直接读写文件系统属存量（不追溯），但**新写**的占名逻辑必须落在 `domain/`（原则二"接口层 MUST NOT 直接读写文件系统"）。

**Alternatives considered**：

| 替代 | 否决理由 |
|---|---|
| 只抽出命名逻辑（543 → ≈520） | 门禁仍红，等于没解决 |
| 把 `checkDir` 复制一份到新文件 | 双实现（归属解析含日志与状态码映射），必然漂移 |
| 不动结构、在 Complexity Tracking 登记例外 | 无可登记的必要性——拆开是纯移动 + 一个 import 调整 |
| 一次性重构整个 `files.ts`（列表/下载/预览也拆） | 超出本次需求范围（治理 §"不得以合规为名放大改动范围"） |

**验证点**：拆分后 `files.ts` ≤ 350 行、`files-upload.ts` ≈ 165 行；既有集成测试**零改动**即全绿（证明只移动未改行为）。
