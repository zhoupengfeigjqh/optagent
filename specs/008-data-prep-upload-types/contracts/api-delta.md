# 契约增量：数据准备目录的可上传文件类型配置

**特性**：`008-data-prep-upload-types` | **日期**：2026-10-13 | **上游**：[spec.md](../spec.md) · [data-model.md](../data-model.md)

> **本仓库惯例**：不另立契约体系，而是**修改上游契约**（先例：007 直接改 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`）。
> 本文只登记**本次要落到上游三份文档的精确增量**与行号定位，避免评审时在 900~1120 行的文件里找差异。
> **不新增端点、不改错误码、不改既有请求/响应字段含义**。

## 1. 总览

| # | 上游文件 | 章节（当前行号） | 变更性质 |
|---|---|---|---|
| C1 | `specs/001-digital-human-platform/contracts/admin-api.md` | §5.3 `scenario` 结构（`:558-577`） | 新增字段 + 约束说明 |
| C2 | `specs/001-digital-human-platform/data-model.md` | §5 字段表（`:215-221` 一带） | 新增一行字段定义 |
| C3 | `specs/001-digital-human-platform/data-model.md` | §8 物化产物（`:321-347`） | 补键说明与"非空才写"口径 |
| C4 | `specs/001-digital-human-platform/contracts/runtime-api-delta.md` | §3 表格（`:163`） | `upload_extensions` **补登**为目录级字段 |
| C5 | 同上 | §3.1（`:169-207`，正文 `:187`） | 改写白名单口径 + 新增字段约束适用范围 |
| C6 | 同上 | §8 R7（`:400-442`）与 §14 R15（`:997-1029`） | 指纹影响登记（新增键） |

## 2. C1 — `admin-api.md` §5.3 的 `scenario` 结构

**现状**（`:558-577`）：`scenario` 结构示例含 `scenario` / `data_prep_dirs` / `data_prep_fields` 三键，后附 4 条约束。

**增量**：在结构示例中补 `data_prep_uploads`，并在约束列表后追加条目：

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["算法规则", "生产计划"],
  "data_prep_fields": {
    "生产计划": [{ "name": "产线编号", "type": "string", "required": true }]
  },
  "data_prep_uploads": {
    "生产计划": [".csv", ".xlsx", ".txt"],
    "算法规则": [".json"]
  }
}
```

追加约束：

- `data_prep_uploads` 的键 MUST 在 `data_prep_dirs` 内；**只出现被配置的目录**（未配置的目录不出现，缺失 ≡ 使用平台默认 `.csv`、`.xlsx`）。
- 值为**非空**字符串数组，每项为小写含前导点的扩展名，∈ `.xlsx` `.xls` `.csv` `.txt` `.pdf` `.json` `.html` `.zip` `.jpg` `.png` `.jpeg`；同目录内 MUST NOT 重复；服务端归一化时按上述顺序重排。
- 为空数组、含非法项、或引用清单外目录 ⇒ **拒绝保存**（`VALIDATION_FAILED`）。
- **该键可省略**（请求体与响应体皆然）；历史文档缺该键时按"全部目录使用默认"处理，客户端无需迁移。
- 该配置仅约束**数据准备空间**的**用户上传**；共享空间与临时空间的可上传类型不由此字段影响。

## 3. C2/C3 — `data-model.md` §5 与 §8

**§5 字段表（`:215-221` 一带）新增一行**（置于 `scenario.data_prep_fields` 相关行之后）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `scenario.data_prep_uploads` | object | ➖ | 键 MUST 在 `data_prep_dirs` 内；值为**非空**扩展名数组，项 ∈ 10 项候选；顺序由服务端归一 | **目录级可上传类型白名单**（2026-10-13 新增；2026-10-14 增 `.xls`）：目录名 → 允许上传的扩展名。未配置的目录不出现（缺失≡平台默认 `.csv`+`.xlsx`） |

**§5 校验规则清单**追加一条：`data_prep_uploads` 的键须在 `data_prep_dirs` 内（孤儿键即拒）；值非空、逐项合法、去重、按枚举序归一。

**§8 物化产物**补说明：`scenario.json` 在归一后**非空时**写入 `data_prep_uploads`（与 `data_prep_fields` 同口径）；产物随数字人目录整体覆盖，平台侧未配置则无该键。

## 4. C4 — `runtime-api-delta.md` §3 表格：**补登既有缺口**

**现状**（`:163`）：

> `GET /api/files/workspace` | 目录项（dirs）新增 `fields`（字段约束，无约束为 `[]`）：供前端上传入口做**只读提示**；权威校验在上传路由，前端 MUST NOT 自行判定

**并行问题**：该端点**已经**在空间对象上下发 `upload_extensions`（实现见 `agent-backend/src/routes/files.ts:499-502`），但**契约从未登记**（`specs/` 下 grep 命中 0 处）——属既有契约缺口。

**增量**：改为

> `GET /api/files/workspace` | **空间对象**：`upload_extensions`（该空间允许上传的扩展名，**本次起正式登记**）；**目录对象**：`fields`（字段约束，无约束为 `[]`）与 **`upload_extensions`（本次新增，目录级）**。

**目录级 `upload_extensions` 语义**（新增说明）：

- 数据准备目录：等于该目录配置的白名单；**未配置**时为平台默认 `[".csv", ".xlsx"]`；
- 共享空间与临时空间的目录项：恒等于所属空间的 `upload_extensions`（与空间级一致，逐字不变）；
- 用途：供前台生成文件选择器的类型过滤与做**上传前提示/预校验**；**权威校验仍在上传路由**，前端 MUST NOT 自行判定后再请求（避免双实现漂移）。

## 5. C5 — `runtime-api-delta.md` §3.1：白名单口径改写 + 字段约束适用范围

**现状**（`:187`）：

> **类型判定规则（供未来的上传预检使用，本期只落配置）**：数据准备空间的上传白名单为 `.csv` / `.xlsx`（`SPACE_POLICIES`），故字段值取自**上传表的表头**……

**增量**：改写为

> **可上传类型**：数据准备的**每个二级目录**可有各自的允许类型（由数字人配置 `scenario.data_prep_uploads` 下发，缺省为 `.csv` / `.xlsx`）；共享空间与临时空间仍取 `SPACE_POLICIES`（与改造前一致）。
> **字段约束适用范围**：**仅对 `.csv` 与 `.xlsx` 生效**；其他类型（含经白名单允许的 `.txt`/`.pdf`/`.json`/`.zip`/图片）与**未声明字段约束的目录**一律**跳过表结构校验**——避免用"缺少必填表头"去描述一个本没有表头的文件。

并在 §3.1 末尾补：

> **既有校验不受削弱**：`.csv` / `.xlsx` 的表头与取值类型判定（本文 §3.1 表格）逐字不变。

## 6. C6 — 配置指纹影响登记

`scenario.json` 是运行环境实例的指纹输入（§8 R7 `:400-442`、§14 R15 `:997-1029`）。**增量**：在指纹说明处补一句

> 新增的 `data_prep_uploads` 键属指纹输入的一部分：首次为该目录配置白名单时会引起一次实例重建；未配置的目录不写键，因此不产生额外重建。

## 7. 前后端类型同步（原则七的"四处同步"）

| 落点 | 内容 |
|---|---|
| 契约文档 | 上述 C1~C6 |
| 前端类型（`admin-frontend/src/api/agent-types.ts`） | `AgentScenario.data_prep_uploads?: Record<string, string[]>` |
| 后端 schema（`admin-backend/src/domain/config-center/scenario.ts`） | `DATA_PREP_UPLOAD_EXTS` + `normalizeScenario` 归一 + 预检逐条 |
| 运行环境（`agent-backend/src/domain/dirs.ts`） | `Scenario.dataPrepUploads` + `parseScenarioUploads()` + `uploadExtensionsOf()` |
| 前端类型（`frontend/src/api/types.ts`） | `WorkspaceDir.upload_extensions: string[]` |
| 测试 | 四侧各自补（见 [plan.md](../plan.md) §3） |

## 8. 契约验收判据

1. 上述六处文档改动落盘后，`admin-api.md` 与 `runtime-api-delta.md` 中**不再存在**"数据准备白名单固定为 `.csv`/`.xlsx`"的表述；
2. `upload_extensions` 在 `specs/` 下**至少两处**命中（空间级登记 + 目录级新增说明）；
3. 实现与文档一致：以 `dirs.ts` 的 `uploadExtensionsOf` 与 `field-check.ts` 的 `supportsFieldCheck` 为唯一口径，文档描述与二者行为逐条对应；
4. 错误码无新增、无改义（上传拒绝仍为既有 `VALIDATION_FAILED`；表结构问题仍为 `FILE_SCHEMA_INVALID`）。
