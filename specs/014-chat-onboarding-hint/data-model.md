# 数据模型：聊天页头部对齐与空数据新手引导

**Feature**: `014-chat-onboarding-hint` | **Date**: 2026-10-29

本特性不新增持久化数据结构。唯一的契约变更是在既有工作空间响应中增加一个只读布尔字段；其余为前端内存态。

## 1. 工作空间目录项（`WorkspaceDir`）

### 变更前后

| 字段 | 变更前 | 变更后 | 说明 |
|---|---|---|---|
| `dir` | ✅ | ✅ | 相对空间路径，如 `数据准备/生产计划`、`共享空间` |
| `label` | ✅ | ✅ | 展示名 |
| `deletable` | ✅ | ✅ | 是否允许删除其中文件 |
| `files` | ✅ | ✅ | 该目录的文件清单（含 `filename` / `size` / `updated_at`） |
| `fields` | ✅ | ✅ | 字段约束（仅数据准备目录可能非空） |
| `upload_extensions` | ✅ | ✅ | 该目录允许的上传扩展名 |
| `predefined` | ❌ | **✅ 新增（必填，布尔）** | 是否为平台预定义二级目录 |

### `predefined` 的取值规则

| 目录 | 取值 |
|---|---|
| 数据准备下的平台预定义目录（当前仅 `算法规则`） | `true` |
| 数据准备下管理员配置的其它二级目录 | `false` |
| 共享空间（空间自身即目录） | `false` |
| 临时空间（空间自身即目录） | `false` |

### 校验与约束

- **唯一来源**：`agent-backend/src/domain/dirs.ts` 的 `PREDEFINED_DATA_PREP_DIRS`；`rule-file.ts` 的 `RULES_SUBDIR` 由它派生，装配层只消费，不另写清单。
- **恒定性**：同一数字人的同一目录，在场景未变更时该值恒定；场景变更需重新部署并重新加载清单。
- **不可由用户配置**：平台侧与场景文档都不写该字段，避免"预定义目录"变成可配置项。

## 2. 前端判定模型

### 纯函数 `needsDataUpload(spaces: WorkspaceSpace[]): boolean`

输入：工作空间接口返回的空间数组。输出：是否需要提示上传。

| # | 输入情形 | 输出 |
|---|---|---|
| 1 | 没有任何非扁平空间（数据准备缺失） | `false` |
| 2 | 非扁平空间的二级目录全部为 `predefined: true` | `false` |
| 3 | 存在非预定义目录，且每个目录 `files` 均为空 | `true` |
| 4 | 存在非预定义目录，其中任意一个 `files` 非空（含 0 字节文件） | `false` |

说明：

- "非扁平空间"沿用 `utils/space.ts` 的结构判定，不硬编码空间名。
- 不递归统计更深层目录；只看该二级目录的 `files` 列表。

### 状态：空数据引导（`EmptyDataHint`）

| 状态字段 | 类型 | 语义 |
|---|---|---|
| `visible` | `boolean` | 气泡当前是否展示 |
| `dismissed` | `boolean`（内部） | 当前数字人选择下用户是否已关闭过 |

### 状态转移

| 起始态 | 事件 | 结果 |
|---|---|---|
| 初始（`visible=false`, `dismissed=false`） | 页面加载 / 刷新恢复数字人 | 不变（不判定、不弹） |
| 任意 | 切换数字人**成功** → 清单加载完成 | `dismissed=false`，随后判定：满足则 `visible=true`，否则 `false` |
| 任意 | 切换数字人**失败** | 不变（不改数字人、不判定） |
| `visible=true` | 点击气泡「×」 | `visible=false`，`dismissed=true` |
| `visible=false` 且 `dismissed=true` | 清单变化（上传/删除文件） | 保持 `false`（关闭态在本次数字人选择下不解除） |
| `visible=true` | 清单变化导致判定转为 `false`（例如上传成功） | `visible=false`，`dismissed` 不变 |
| `visible=true` | 再次切换数字人 | 先按新数字人判定：`dismissed=false`，满足则保持 `true` 并绑定新数字人 |
| 清单加载失败 / 场景未配置 | 切换数字人成功但清单不可用 | `visible=false`（不弹），既有错误提示照旧 |

### 不变量

- **INV-1**：`visible=true` ⇒ 最近一次判定时三条件同时成立。
- **INV-2**：`dismissed=true` 期间，任何非"切换成功"的事件都不会让 `visible` 变为 `true`。
- **INV-3**：气泡的展示与关闭都不产生网络请求，也不改变文件空间数据。
- **INV-4**：气泡文案是界面常量，与数字人配置、模型输出无关。
