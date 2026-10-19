# 数据模型（Phase 1）：上传记录与落盘命名

**特性**：`012-upload-record-naming` | **日期**：2026-10-18

> 本特性**不新增持久化数据**：上传记录只活在内存（面板会话级，刷新即丢），落盘命名的产物是文件系统里的文件名。
> 因此这里描述的是"内存状态模型 + 命名规则模型"，不是数据库表。

## 1. 上传记录（`UploadedDocument`）

既有结构（`frontend/src/composables/useUploads.ts`），本次**字段不变**，只改其生命周期与 `clear()` 口径。

| 字段 | 类型 | 含义 | 本次变化 |
|---|---|---|---|
| `localId` | `string` | 前端唯一键（`upload-<n>`），列表渲染与回写去重的键 | 不变 |
| `dir` | `string` | 目标目录（三空间白名单之一，如 `数据准备/生产计划`） | 不变 |
| `name` | `string` | 用户选中的**原始**文件名 | 不变 |
| `size` | `number` | 字节数（展示用） | 不变 |
| `status` | `'pending' \| 'uploading' \| 'success' \| 'failed'` | 状态机（见 §1.1） | 不变 |
| `serverFilename` | `string \| null` | **落盘名**（后端响应 `filename`），`success` 时必有 | 语义收紧：**唯一**的展示名与 `@` 标记来源 |
| `error` | `ErrorInfo \| null` | 失败原因（按 `code` 映射中文文案） | 不变 |

### 1.1 状态机

| 起点 | 事件 | 终点 | 副作用（本次新增/明确） |
|---|---|---|---|
| `pending` | 客户端预校验通过，请求发出 | `uploading` | — |
| `pending` | 客户端预校验失败（扩展名 / 5MB） | `failed` | **不发请求**；**零回写**（`FR-003`） |
| `uploading` | 后端 201，`filename` = 落盘名 | `success` | ① `workspace.registerFile({dir, filename, size})`；② `mentionComposer.onPickFile({dir, filename})` → 草稿追加 `@落盘名 `（`FR-001`）；③ 记录 `localId` 已回写，**不再重复** |
| `uploading` | 请求失败（4xx/5xx/网络） | `failed` | 保留 `error`；**零回写**（`FR-003`）；可「重试」 |
| `failed` | 用户点「重试」 | `uploading` → `success` / `failed` | 与首次成功同一出口 ⇒ 成功后**照常回写**一次 |
| `success` / `failed` | 收起面板（`+` 收起 / 关闭入口 / 切换数字人） | **记录被移除** | 不删文件、不动草稿与引用（`FR-011`） |
| `pending` / `uploading` | 收起面板 | **保留** | 不取消请求；下次展开仍可见；终态后照常回写（`FR-013`） |
| 任意 | 重新展开面板 | 不变 | 空列表 = 上一轮终态已被清掉（`FR-010`） |

### 1.2 不变式

- **I1**：`status === 'success'` ⇔ `serverFilename !== null`；任何展示名、`@` 标记、引用登记都取 `serverFilename`（`FR-002` / `FR-024`）。
- **I2**：同一个 `localId` 的 `success` **只能触发一次回写**（重试导致的二次成功也按"该 `localId` 是否已回写过"判断，`FR-005`）。
- **I3**：回写**只追加文本**，不移动光标、不改写已有内容（`FR-005`）。
- **I4**：清空只作用于记录列表，MUST NOT 影响 `FileReference` 集合、草稿文本与文件系统（`FR-011`）。
- **I5**：`items` 的更新一律为**不可变替换**（`items.value = [...]`），与既有实现一致，避免就地改对象引起渲染抖动。

## 2. 记录窗口（面板级生命周期）

| 事件 | 窗口动作 | 依据 |
|---|---|---|
| 展开面板 | 显示当前 `items`（若上一轮为清空后 ⇒ 空） | `FR-010` / `FR-015` |
| 收起面板（`+`） | `clear()`：移除终态项 | `FR-010` |
| 面板关闭入口 | 同 `+` 收起 | `FR-014` |
| 切换数字人 | 同 `+` 收起（且 `workspace` 会重载为**新**数字人视角） | `FR-014` |
| 发送消息 / 刷新页面 | **不清空** / 刷新即丢（无持久化） | 假设 7 |

> "窗口"是**记录归属**的边界，不是文件的生命周期边界：文件一旦落盘就独立存在。

## 3. 落盘命名模型

### 3.1 主名与扩展名切分

```
sanitize(original):
  base = basename(original).replace(/[/\\]/g, '_')     // 沿用既有清洗口径（FR-027）
  ext  = path.extname(base)                            // 最后一个点之后；点开头无其它点 ⇒ ''
  stem = base.slice(0, base.length - ext.length) || 'file'   // 空主名兜底 'file'
  return { stem, ext }
```

**控制字符口径（2026-10-18 明确）**：既有清洗**只**处理 `basename` 与 `/`、`\`，
**不额外剥离换行 / 制表 / 控制字符**——与改动前一致，本特性不扩大清洗范围（`FR-027` / 边界情况）。
理由：扩大清洗等于改变已有落盘名的判定口径，且会让"同名"判据与历史文件不一致；确需处理应在单独特性立项。

### 3.2 候选名

| index | 候选名 | 例（原始 `报告.csv`） |
|---|---|---|
| 0 | `stem + ext` | `报告.csv` |
| 1 | `stem + "(1)" + ext` | `报告(1).csv` |
| n | `stem + "(n)" + ext` | `报告(2).csv` |

- 半角括号、紧贴主名、扩展名保持在末尾（Q1 = A，`FR-021`）；**不插空格、不用全角括号**。
- 例：`a.tar.gz` ⇒ `a.tar(1).gz`；`README` ⇒ `README(1)`；`.env` ⇒ `.env(1)`。
- `index` 从 0 起**递增到第一个"占名成功"的候选**，因此天然取"最小可用编号"（`FR-021` 场景 3）。

### 3.3 占名（冲突判定的唯一实现）

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | `linkSync(staging, dir/候选名)` | 成功 ⇒ 占用；`EEXIST` ⇒ 下一个 `index` |
| 2 | `link` 不可用（`EPERM` / `EXDEV` / `ENOTSUP` / `EMLINK`） | 回退 `copyFileSync(staging, dest, COPYFILE_EXCL)`；`EEXIST` ⇒ 下一个 `index` |
| 3 | 成功占名后 | `removeFileSafe(staging)`（暂存文件清理；**MUST NOT** 用 `rmSync`，见 `domain/fs-safe.ts`） |
| 4 | `index > MAX_NAME_ATTEMPTS(999)` | `ApiError(409, 'FILE_NAME_CONFLICT', …)`（`FR-022` / 原则九） |
| 5 | 候选名超长（`ENAMETOOLONG`） | 先截断 `stem` 到 200 字符再试；仍失败 ⇒ `ApiError(400, 'VALIDATION_FAILED', …)`（`FR-028`） |

- **冲突判定 = 目标文件系统是否拒绝排他创建**：Windows / macOS 的大小写不敏感因此自动满足 `FR-023`；
  Linux 上 `Report.csv` 与 `report.csv` 不冲突——与所在 FS 语义一致，不额外造第二套规则。
- **零覆盖**由排他创建保证（`FR-022`），不依赖"前端串行"或"先查后写"。

### 3.4 冲突域

- 冲突域 = **目标目录内**（`FR-025`）：其它目录、其它数字人的同名文件不参与编号。
- 历史文件（`name_YYYYMMDD_HHMMSS.ext`）**不改名、不迁移**，与新规则共存（`FR-026`）。

## 4. 文件引用与清单登记

| 模型 | 位置 | 本次关系 |
|---|---|---|
| `FileReference` | `api/types.ts` = `{ dir, filename }` | 上传成功即登记；`filename` 必为落盘名 |
| `WorkspaceFile` | `api/types.ts` = `{ filename, size, updated_at }` | `registerFile` 就地追加（`updated_at` 取前端当前时刻或响应缺省值） |
| `WorkspaceStore.registerFile({dir, filename, size})` | `composables/useWorkspace.ts`（**新增**） | 让 `exists(reference)` 立刻为真（`FR-004`）；未知目录 no-op；重复登记忽略 |

### 4.1 `registerFile` 校验规则

| 条件 | 行为 |
|---|---|
| `dir` 不在 `spaces` 中（清单未加载 / 目录未知） | **no-op**，不抛错（不制造假绿：`exists` 仍为假，发送时走既有"引用已不存在"提示） |
| 同 `{dir, filename}` 已存在 | 忽略（幂等），不重复插入 |
| 其余 | 该目录 `files` 追加一项，`spaces` 以不可变替换更新 |

## 5. 需求 → 模型映射（抽查）

| 需求 | 落到模型 |
|---|---|
| `FR-001` / `FR-002` | §1.1 的 `uploading → success` 副作用② + `I1` |
| `FR-004` | §4 `registerFile`（`exists` 立即可真） |
| `FR-005` | `I2` / `I3`（只追加、按完成顺序、按 `localId` 去重） |
| `FR-010` / `FR-013` | §2 记录窗口 + §1.1 收起两行 |
| `FR-011` | `I4` |
| `FR-020` / `FR-021` / `FR-023` | §3.2 候选名 + §3.3 步骤 1~2 |
| `FR-022` | §3.3（排他占名，零覆盖） |
| `FR-024` | `I1` |
| `FR-025` / `FR-026` | §3.4 冲突域与历史文件 |
| `FR-028` | §3.3 步骤 4~5（有界重试 + 显式失败） |
