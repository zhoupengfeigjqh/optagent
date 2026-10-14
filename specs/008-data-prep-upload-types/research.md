# 研究记录（Phase 0）：数据准备目录的可上传文件类型配置

**特性**：`008-data-prep-upload-types` | **日期**：2026-10-13 | **上游**：[spec.md](./spec.md)

> 本阶段**无 `NEEDS CLARIFICATION`**：规格的待澄清项已由用户确认（白名单粒度＝每个二级目录各自一份）。
> 下述条目均为"决策 + 理由 + 被否决的替代方案"，零新增依赖（宪章原则六），故无选型类研究任务。

## 1. 现状取证（决定改动量的关键事实）

| 事实 | 证据 |
|---|---|
| 运行环境**已按空间**下发可上传白名单，前端**已通用消费** | `agent-backend/src/routes/files.ts:499-502`（响应 `upload_extensions`）；`frontend/src/components/chat/UploadMenu.vue:44-49`（生成 `accept`）；`frontend/src/composables/useChatPanel.ts:319`（传给上传层） |
| 白名单来源是**硬编码常量**，数据准备固定 `.csv`/`.xlsx` | `agent-backend/src/domain/dirs.ts:53-57`（`SPACE_POLICIES`） |
| 字段约束**已实现**且只按"空间＋二级目录"触发 | `routes/files.ts:242-263`（条件与调用）；`domain/field-check.ts`（解析与判定，189 行） |
| 字段约束的解析分派：**除 `.xlsx` 外一律按 CSV 解析** | `domain/field-check.ts:207-213` |
| 设计态目录清单与字段约束是**同族对象** | `admin-backend/src/domain/config-center/scenario.ts`（`data_prep_fields`）；`admin-frontend/src/components/agents/ScenarioEditor.vue:20-25`（`ScenarioValue`） |
| 物化产物"非空才写键"，缺失≡空 | `admin-backend/src/domain/deploy/materialize.ts:80-88` |
| `upload_extensions` **从未进过契约文档** | `specs/` 下 grep 命中 0 处 |

## 2. 决策清单

### D-1 数据形态：`scenario.data_prep_uploads`（目录 → 扩展名数组）
- **选择**：对象形态，与 `data_prep_fields` 完全同族。
- **理由**：目录清单动态可增删（键必须在清单内、孤儿键即拒的校验可直接复用）；物化、解析、缺省回落三处代码结构可照搬既有实现，认知与维护成本最低。
- **备选**：
  - 空间级数组 `data_prep_upload_extensions: string[]` —— **否**（与用户确认的目录级粒度不符）；
  - 每目录一个顶层字段 —— **否**（目录名任意，无法映射为字段名）。

### D-2 候选枚举（10 项，2026-10-14 增 `.xls`）的权威定义与同步纪律
- **选择**：`admin-backend` 权威定义 `DATA_PREP_UPLOAD_EXTS`；`admin-frontend` 常量同值；`agent-backend` 解析时校验；契约 §5.3 文本登记。四处互相指名注释。
- **理由**：既有 `SCENARIO_FIELD_TYPES` 已确立"三处 MUST 同步"的先例，扩展名候选属同类，纳入同一纪律。
- **备选**：把候选集做成可配置 —— **否**（超出需求；会引入 `.sh`/`.exe` 之类安全与预览分派连锁问题）。

### D-3 运行环境白名单解析的唯一实现
- **选择**：`dirs.ts` 新增 `uploadExtensionsOf(scenario, space, sub)`；上传校验与 `workspace` 下发**都**调它。
- **理由**：现状是"`SPACE_POLICIES` 一处定义、两处消费"，若只在其中一处下放到目录级，会出现"界面允许、服务端拒绝"的错配（宪章原则七的典型漂移）。
- **备选**：在路由层各写一份目录查找 —— **否**（第二处口径）。

### D-4 字段约束适用范围（仅 `.csv`/`.xlsx`）的唯一实现
- **选择**：`field-check.ts` 新增 `supportsFieldCheck(ext)`；`routes/files.ts` 的触发条件加该判据；`checkUploadBuffer` 保持"只接受表格类型"的职责并在 JSDoc 写明前置条件。
- **理由**：`checkUploadBuffer` 现有分派是"非 `.xlsx` 一律按 CSV 解析"，若不前置判据，放宽白名单后普通 `.txt` 与二进制文件都会被当成表格校验，报出"缺少必填表头"这类与现实形态不符的误导理由。
- **备选**：
  - 让 `checkUploadBuffer` 内部对非表格扩展名返回 `[]` —— **否**（路由层仍会为白名单外的类型读取暂存文件，白做 IO；且"哪些扩展名算表格"会散落到函数内部）；
  - 管理端做联动限制（声明约束就只允许表格类型）—— **否**（用户已明确"其他类型跳过"，加限制削弱可用性）。

### D-5 前端查找的单一实现与前端的"零逻辑改动"边界
- **选择**：`useWorkspace.uploadExtensionsOf(dir)` 改读**目录自身**；`UploadMenu.activeAccept` 删除自有空间级查找改为复用；`useUploads`/`file-kind`/`useChatPanel` 不动。
- **理由**：当前"目录 → 所属空间 → 空间白名单"的查找在 `UploadMenu.vue:47-48` 与 `useWorkspace.ts:117-118` **各有一份**，本特性必须借机收敛，否则 `accept` 与预校验会各按不同粒度判定。
- **备选**：把 `accept` 与预校验都改成"传目录对象"（参数重构）—— **否**（会触及 525 行的 `useChatPanel.ts`）。

### D-6 管理端入口与弹窗形态
- **选择**：新增 `ScenarioUploadTypesDialog.vue`，复刻 `ScenarioFieldDialog.vue` 的 `props/emit` + 原生 `<dialog>` 套路；入口按钮插在目录行「字段(n)」与「移除」之间；`文件类型(n)` 文案显示已选数量。
- **理由**：与既有约定一致（原生 `<dialog>`、无新依赖、无障碍现成）、与字段约束**同粒度同位置**，用户在同一个位置理解两类配置。
- **备选**：内联展开的多选（不弹窗）—— **否**（会让目录行高度随勾选变化，且 10 项在小行内不可读）；引入多选第三方组件 —— **否**（原则六）。

### D-7 新建目录的默认值实现方式
- **选择**：**不写键即默认**；弹窗打开时若该目录无配置，预勾 `.csv` 与 `.xlsx`。
- **理由**：`addDir()` 现有流程是"先入列 → 弹字段约束窗口"，若再预写配置就要在新增时连弹两窗；"缺省＝默认"同时让**存量数字人零迁移**（FR-014/FR-031）。
- **备选**：新增目录时写入显式默认配置 —— **否**（产物变脏、且与"未配置"失去区分）。

### D-8 类型文件门禁：`admin-frontend/src/api/types.ts` 先拆后加
- **选择**：拆出 `api/agent-types.ts`（数字人设计相关类型），`types.ts` 用 re-export 保持既有导入路径。
- **理由**：实测 **499 行**，硬门禁 500；`admin-backend` 已有"门禁驱动拆分"的先例（`agent-design.ts` 拆 `naming.ts`，见 `data-model.md §5` 实现落点注释）。
- **备选**：把新字段放进别的文件 —— **否**（类型定义被割裂，`AgentScenario` 的字段分散两处）。

### D-9 `.zip` 的预览分派
- **选择**：加入 `file-kind.ts` 的 `DOWNLOAD_EXTENSIONS`（+1 行）。
- **理由**：`.zip` 是新引入类型，当前会落 `unsupported`（既不预览也无下载入口），对用户是"坏掉的文件"观感；归入下载类是最小、最诚实的处置。
- **备选**：新增压缩包预览（列内容）—— **否**（超出需求，原则六）。

### D-10 配置指纹影响
- **选择**：接受"首次配置触发一次运行环境实例重建"，并在契约 §8/§14 处登记。
- **理由**：`scenario.json` 本就是指纹输入；要避免重建就只能把配置放到指纹之外，那会牺牲"改配置即生效"的一致性。
- **备选**：把新键排除出指纹 —— **否**（会造成"配置变了但实例不重建"的隐蔽不一致）。

## 3. 依赖评估（原则六）

- **零新增依赖**：白名单是字符串数组；弹窗用原生 `<dialog>`；多选用原生 `checkbox` + `<label>`；JSON 解析用 `JSON.parse`；测试用既有 Vitest。
- **无新增基础设施**：不新增端点、不新增配置文件、不新增容器步骤。

## 4. 遗留风险与缓解

| 风险 | 缓解 |
|---|---|
| `agent-backend/src/routes/files.ts`（478 行）改动后越线 | 改动仅两处调用替换；若实测 > 500，按 D9 预案拆出 `workspace-view.ts` |
| `admin-backend/tests/unit/agent-design.spec.ts`（393 行）与 `materialize.spec.ts`（321 行）叠加用例后逼近上限 | 新增用例优先落在 `scenario.spec.ts` / `materialize.spec.ts` 的既有 describe 内；越线时按同性质拆测试文件 |
| 候选枚举四处同步发生漂移 | 三处代码注释互相指名 + 契约文本登记；后续若候选变更，按 `SCENARIO_FIELD_TYPES` 的既有纪律处理 |
