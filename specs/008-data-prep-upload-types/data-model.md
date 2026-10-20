# 数据模型：数据准备目录的可上传文件类型配置

**特性**：`008-data-prep-upload-types` | **日期**：2026-10-13 | **上游**：[spec.md](./spec.md) · [plan.md](./plan.md)

> 本文只描述**本次新增/变更**的实体与规则；既有设计态与物化口径见 `specs/001-digital-human-platform/data-model.md` §5、§8。

## 1. 实体：目录级可上传类型白名单

### 1.1 设计态（`.platform-data/agents/{name}.json` 的 `scenario` 键内）

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `scenario.data_prep_uploads` | object | ➖ | 键 MUST 在 `data_prep_dirs` 内；值为**非空**字符串数组 | **本次新增**：目录名 → 允许上传的扩展名清单。**只出现被配置的目录**（未配置的目录不出现，缺失≡"用平台默认"） |
| `scenario.data_prep_uploads[dir][]` | string | ✅ | 小写、含前导点；∈ `.xlsx` `.xls` `.csv` `.txt` `.pdf` `.json` `.html` `.zip` `.jpg` `.png` `.jpeg`；同目录内**不重复**；服务端保存时按枚举顺序归一 | 单个允许的扩展名 |

**归一化规则（保存时，权威在 `admin-backend`）**：

1. 整体缺省 / `undefined` / `null` ⇒ 归一为空对象 `{}`（**不写键**）；
2. 非对象（数组、字符串、数字等）⇒ 拒绝保存（`VALIDATION_FAILED`）；
3. 键不在 `data_prep_dirs` 内 ⇒ **拒绝**（孤儿键与 `data_prep_fields` 同口径，不是可忽略的冗余）；
4. 值为空数组 ⇒ **拒绝**（FR-003"至少选一项"；"不配置"才是表达"用默认"的方式）；
5. 值为非数组 / 含非字符串项 / 含空串 ⇒ 拒绝；
6. 项不在候选枚举内（含大小写混写未归一的形态）⇒ 拒绝（判定时先转小写再比对）；
7. 同目录内重复项 ⇒ 归一为一份（去重）；
8. 顺序 ⇒ **按候选枚举的固定顺序重排**（防止"同一勾选集、不同顺序"造成 `scenario.json` 字节变化进而触发运行环境实例重建）。

### 1.2 物化产物（`users/{uid}/agents/{agent}/scenario.json`）

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["算法规则", "生产计划"],
  "data_prep_fields": { "生产计划": [{ "name": "产线编号", "type": "string", "required": true }] },
  "data_prep_uploads": { "生产计划": [".csv", ".xlsx", ".txt"] }
}
```

- **写入口径**：仅当归一后非空才写入该键（与 `data_prep_fields` 完全一致，见 `materialize.ts:80-88`）；
- **覆盖语义**：随数字人目录**整体覆盖**（平台为唯一权威）；平台侧未配置 ⇒ 产物无该键 ⇒ 运行环境回落默认（FR-033）；
- **不触碰文件系统内容**：本键只影响"允许上传的类型"，MUST NOT 删除或改写任何既有文件（承 `scenario.json` 既有语义）。

### 1.3 运行环境内存态（`agent-backend` 的 `Scenario`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `Scenario.dataPrepUploads` | `Record<string, string[]>` | 由 `parseScenarioUploads()` 产出；**缺失的目录不出现键** |

**消费方解析口径（丢弃 + 告警，MUST NOT 让整个场景不可用）**：

| 情形 | 处理 |
|---|---|
| 整体非对象 | 忽略整个键 + `logger.warn` |
| 键不在有效目录清单内（孤儿键） | 丢弃该键 + 告警 |
| 值为非数组 / 空数组 | 丢弃该键 + 告警 |
| 含非字符串项 / 空串 / 不在候选枚举内的项 | 丢弃**该项** + 告警（其余合法项保留） |
| 去重 | 保留首个 |
| 解析后该目录无剩余项 | **不写入键**（≡ 未配置） |

> 与 `parseScenarioFields` 同一口径：运行环境是**消费方**，非法内容一律丢弃并告警，零迁移（历史 `scenario.json` 无该键 ⇒ 全部目录按默认处理）。

## 2. 生效矩阵（缺省与回落）

| 上传目标 | 配置状态 | 实际生效的可上传类型 | 依据 |
|---|---|---|---|
| `数据准备/{目录}` | 已配置 | 该目录声明的数组 | `uploadExtensionsOf` |
| `数据准备/{目录}` | 未配置 / 配置被判定非法 | `.csv`、`.xlsx`（平台默认） | `SPACE_POLICIES[数据准备]` |
| `数据准备`（**空间根**） | 不适用 | **不支持上传**：沿用既有 `400 DIR_VALIDATION`（"数据准备需指定二级目录"） | `dirs.ts:358-362` |
| `共享空间` | 不适用（不可配置） | `.csv` `.xlsx` `.txt` `.json` `.pdf` + 图片集（逐字不变） | `SPACE_POLICIES[共享空间]` |
| `临时空间` | 不适用（不可配置） | 同共享空间（逐字不变） | `SPACE_POLICIES[临时空间]` |

> **FR-015 修订说明**：规格初稿假设"数据准备空间根沿用平台默认"，但 `parseSpaceDir` 对数据准备**强制要求二级目录**，根目录上传本就返回 `400`。故该条修正为"空间根不支持上传"（见 `spec.md` 修订记录 v1.2）。

## 3. 字段约束的适用范围（本次收敛）

| 上传文件类型 | 该目录声明了字段约束 | 该目录未声明字段约束 |
|---|---|---|
| `.csv` / `.xlsx` | **校验**：表头须含全部 `required` 字段；出现的字段逐数据行判定取值类型（既有规则，逐字不变） | 跳过表结构校验（既有行为） |
| 其他任何类型（`.txt`/`.pdf`/`.json`/`.zip`/图片） | **跳过**表结构校验（FR-020）；MUST NOT 出现"缺少必填表头"类理由 | 跳过（无从校验） |

**判定落点**：`agent-backend/src/domain/field-check.ts` 的 `supportsFieldCheck(ext)`（唯一判据）；`routes/files.ts` 的触发条件为
`数据准备空间 && 有二级目录 && supportsFieldCheck(ext) && 该目录有字段约束`。

## 4. 关系与生命周期

```text
数字人设计态 scenario
├── scenario            : 场景名（既有）
├── data_prep_dirs      : 二级目录清单（既有）──┐
├── data_prep_fields    : 目录 → 字段约束（既有，键 ⊆ data_prep_dirs）
└── data_prep_uploads   : 目录 → 可上传类型（本次，键 ⊆ data_prep_dirs）
                                                 │
        ┌────────────────────────────────────────┘
        ▼
   物化 scenario.json（非空才写键）→ 运行环境 Scenario（内存态，mtime 惰性重读）
        ├── 上传校验：uploadExtensionsOf(scenario, space, sub)   （权威）
        └── workspace 下发：spaces[].dirs[].upload_extensions    （供前台过滤，只读提示）
```

**目录增删的连带规则**：

| 事件 | 连带处理 |
|---|---|
| 新增二级目录 | **不写** `data_prep_uploads` 键 ⇒ 该目录默认 `.csv`、`.xlsx`（FR-004） |
| 移除二级目录 | **同时删除**其 `data_prep_uploads` 项（与 `data_prep_fields` 同口径，FR-006）；MUST NOT 留下孤儿键 |
| 重命名目录 | 视为"移除 + 新增"（既有 `ScenarioEditor` 无重命名入口，不做额外处理） |

## 5. 关键不变式（实现时必须保持）

1. **单一来源**：某个目录"允许上传什么"，只能由 `uploadExtensionsOf` 给出；上传校验与 `workspace` 下发 MUST 共用它。
2. **单一判据**：某个扩展名"是否需要表结构校验"，只能由 `supportsFieldCheck` 给出。
3. **不越界**：共享空间与临时空间的可用类型与"是否需要表结构校验"（本就跳过）MUST NOT 因本特性改变。
4. **零迁移**：`data_prep_uploads` 缺失 ⇒ 行为与改造前逐字一致。
5. **配置权威在平台**：运行环境不反向写回、不做字段级合并；部署即整体覆盖。
