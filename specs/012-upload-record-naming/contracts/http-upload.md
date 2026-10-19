# 接口契约：文件上传（`POST /api/files/upload`）

**特性**：`012-upload-record-naming` | **日期**：2026-10-18 | **实现**：`agent-backend/src/routes/files-upload.ts`（本次从 `files.ts` 迁出）

> **上游缺口登记**：代码注释长期引用的 `contracts/backend-api.md` 在 `specs/**` 内**不存在**（仅 `011` 有 `contracts/ui-contract.md`）。
> 本文件只对**上传端点**给出与本特性相关的权威记录（方法 / 请求 / 状态码 / 命名规则），
> 不冒充"补齐全局后端契约文档"（宪章治理 § 不追溯）。

## 1. 请求

```http
POST /api/files/upload
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `dir` | text | 是 | 目标目录（相对空间路径，如 `数据准备/生产计划`、`共享空间`、`临时空间`）。**建议先于 `file` 发送**：后端解析到 `dir` 即做目录校验，非法目录在文件开始上传前被拒绝（省带宽） |
| `file` | file | 是 | 单文件。**一次只接受一个文件**（多个 `file` part 时仅最后一个生效）⇒ 前端多选 MUST 逐文件各发一次请求 |

**未变**：请求结构、字段名、顺序约定与限制均与改动前一致（`frontend/src/api/files.ts` 不变）。

## 2. 响应

### 2.1 成功 `201`

```json
{ "dir": "数据准备/生产计划", "filename": "报告(1).csv", "size": 20480 }
```

| 字段 | 类型 | 语义 |
|---|---|---|
| `dir` | string | 目标目录（与请求一致，规范化后的相对路径） |
| `filename` | string | **落盘名**。前端 MUST 直接采用：展示名、`@` 标记、引用登记**全部**用它，MUST NOT 自行拼接时间戳或后缀（`FR-002`） |
| `size` | number | 落盘字节数 |

### 2.2 命名规则（本特性变更点）

| 目标目录内同名情况 | 落盘名 | 例（原始 `报告.csv`） |
|---|---|---|
| 无同名 | **原名** | `报告.csv` |
| 已有原名 | 原名 + `(1)` | `报告(1).csv` |
| 已有原名与 `(1)` | 原名 + `(2)` | `报告(2).csv` |
| 已有 `(2)` 但 `(1)` 空缺 | 取**最小可用**编号 | `报告(1).csv` |

- 括号为**半角、紧贴主名**，扩展名保持在末尾；不插空格、不用全角括号（Q1 = A）。
- 多点名 / 无扩展名 / 隐藏文件：`a.tar.gz` → `a.tar(1).gz`；`README` → `README(1)`；`.env` → `.env(1)`。
- **不再追加时间戳**；历史 `name_YYYYMMDD_HHMMSS.ext` 文件保持原样、不迁移。
- 冲突域 = **目标目录内**；其它目录 / 其它数字人同名不影响。
- 唯一性由**排他占名**保证（并发同名零覆盖）；大小写是否冲突由目标文件系统决定（Windows 不敏感 ⇒ `Report.csv` 与 `report.csv` 冲突）。

### 2.3 错误

统一错误体 `{ "error": { "code": string, "message": string, "details"?: string[] } }`（既有格式，未变）。

| 状态码 | `code` | 触发条件 | 本次变化 |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | 非 multipart；缺 `file` / `dir`；扩展名不在目录白名单；**文件名过长无法落盘** | 最后一项**新增**于本码下（不新增码） |
| 400 | `FILE_SCHEMA_INVALID` | 数据准备目录的表格类文件未通过表头 / 字段类型校验（不落盘，`details` 为逐条问题） | 未变 |
| 403 | `UPLOAD_DIR_FORBIDDEN` | `dir` 越界 / 不在该数字人清单内 | 未变 |
| 409 | `AGENT_NOT_SELECTED` / `AGENT_NOT_AVAILABLE` | 未选数字人 / 数字人不可用（归属解析失败） | 未变 |
| 409 | **`FILE_NAME_CONFLICT`** | **同名候选名用尽**（`MAX_NAME_ATTEMPTS = 999` 次仍被占用），无法生成唯一文件名 | **新增错误码** |
| 413 | `FILE_TOO_LARGE` | 超过上传大小上限（`uploadMaxMb`） | 未变 |
| 503 | `SCENARIO_NOT_CONFIGURED` | 该数字人未配置场景（目录清单不可得） | 未变 |

**新错误码的四处同步（宪章原则七 / 工作流「契约变更四处同步」）**：

| 处 | 落点 | 内容 |
|---|---|---|
| ① 契约文档 | 本文件 §2.3 | 409 `FILE_NAME_CONFLICT` |
| ② 前端类型 / 文案 | `frontend/src/utils/error-message.ts` | `FILE_NAME_CONFLICT: '同名文件过多，请先整理目录后重试'`（`ErrorInfo.code` 为 `string`，**类型文件无需改**） |
| ③ 后端抛出点 | `agent-backend/src/domain/upload-name.ts` | `throw new ApiError(409, 'FILE_NAME_CONFLICT', …)` |
| ④ 测试 | `tests/unit/upload-name.spec.ts` + 既有 `error-message.spec.ts` | 用尽触发 409；文案映射 |

## 3. 性能与一致性

- **P95 ≤ 500ms** 沿用既有口径；命名只增加"至多 `n` 次排他创建尝试"（无重名时 1 次），不改变数量级。
- **不覆盖**：任何情况下 MUST NOT 覆盖已存在文件；占名失败只换下一个编号。
- **原子性**：单次上传的结果只有"落盘成功"或"失败且暂存已清理"两态（既有 `try/catch` + `removeFileSafe`），不产生半成品。

## 4. 验收用例（与 `tests/integration/files-scenario.spec.ts` 对应）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 空目录上传 `报告.csv` | 201，`filename === '报告.csv'` |
| 2 | 再传同名 | 201，`filename === '报告(1).csv'`；再来一次 `报告(2).csv` |
| 3 | 删除 `(1)` 后传同名 | 201，`filename === '报告(1).csv'`（最小可用） |
| 4 | 并发 3 个同名（`Promise.all`） | 3 个 201、3 个不同 `filename`、目录内 3 个文件且内容互不相同 |
| 5 | 跨目录 / 跨数字人同名 | 各自用原名 |
| 6 | 目录内有历史时间戳文件 | 新文件用原名；历史文件未改名 |
| 7 | `a.tar.gz` / `README` / `.env` 重名 | `a.tar(1).gz` / `README(1)` / `.env(1)` |
| 8 | 大小写不一致（`Report.csv` 已存在时传 `report.csv`） | 按目标 FS 语义：不敏感平台 ⇒ `report(1).csv`；敏感平台 ⇒ `report.csv` |
