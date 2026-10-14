---

description: "Task list for 008-data-prep-upload-types"
---

# 任务清单：数据准备目录的可上传文件类型配置

**Input**: 设计文档位于 `/specs/008-data-prep-upload-types/`

**Prerequisites**: [plan.md](./plan.md)（必需）· [spec.md](./spec.md)（必需）· [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/api-delta.md](./contracts/api-delta.md) · [quickstart.md](./quickstart.md)

**Tests**: **必需**（非可选）——宪章原则三 `NON-NEGOTIABLE` 要求每个组件/composable/纯函数模块有同名测试、每个端点有集成测试、新增模块覆盖率 ≥ 80%。本清单已按此生成测试任务。

**Organization**: 按用户故事分组，每个故事可独立实现与验证。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（不同文件、且不依赖未完成任务）
- **[Story]**：所属用户故事（`US1`~`US5`，对应 `spec.md`）；Setup / Foundational / Polish 阶段**不带**故事标签
- 每个任务都给出**精确文件路径**

## 路径约定（本项目为四侧仓库）

```text
admin-backend/src/**            管理平台后端（设计态 schema、校验、部署物化）
admin-backend/tests/unit/**     单测（vitest）
admin-frontend/src/**           管理平台前端（数字人设计界面）
agent-backend/src/**            数字人运行环境（场景解析、上传校验、文件空间下发）
agent-backend/tests/{unit,integration}/**   单测与端点集成测试
frontend/src/**                 聊天前台（上传入口、过滤）
specs/001-digital-human-platform/**         上游契约与数据模型（**修改**，不新建）
```

## 关键约束（执行前必读）

| 约束 | 内容 |
|---|---|
| **行数硬门禁** | 单文件 ≤ **500 行**（宪章原则二）。实测基线：`admin-frontend/src/api/types.ts` **499**（⚠️ 必须先拆，见 T007）· `frontend/src/composables/useChatPanel.ts` **525**（⚠️ 存量超限，**本特性 MUST NOT 触及**）· `agent-backend/src/routes/files.ts` **478** · `frontend/src/api/types.ts` **496** · `agent-backend/src/domain/dirs.ts` **415** |
| **同文件串行** | `agent-backend/tests/integration/files-scenario.spec.ts` 被 T035 / T037 / T040 / T041 / T043 / T044 依次追加 → **MUST 串行**（不标 `[P]`） |
| **零新增依赖** | MUST NOT 引入任何第三方包（原则六） |
| **契约四处同步** | 契约文档 · 前端类型 · 后端 schema · 测试用例，同一次改动内一起更新（原则七） |
| **测试在本地跑** | 容器不参与测试、lint、类型检查与覆盖率（原则三、八） |
| **不改动区域** | `frontend/src/views/**`（含 `demo/gantt*`、`datapage/**`）与文件解析结果展示相关代码：**本特性不涉及** |

---

## Phase 1: Setup（契约与候选枚举基座）

**目的**：先把"契约"与"候选枚举的权威定义"落定——后续四侧实现都以它们为准（契约驱动）。

- [x] T001 修改 `specs/001-digital-human-platform/contracts/admin-api.md` §5.3（`scenario` 结构块，现 `:558-577`）：补 `data_prep_uploads` 示例与 5 条约束（见 `contracts/api-delta.md` C1）
- [x] T002 [P] 修改 `specs/001-digital-human-platform/data-model.md`：§5 字段表（现 `:215-221` 一带）新增 `scenario.data_prep_uploads` 行与校验规则；§8 物化产物（现 `:321-347`）补"非空才写"说明（见 C2/C3）
- [x] T003 [P] 修改 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`：§3 表格（现 `:163`）**补登目录级 `upload_extensions`**；§3.1（现 `:169-207`，正文 `:187`）改写白名单口径并新增"字段约束仅适用 `.csv`/`.xlsx`"；§8 R7 与 §14 R15 登记指纹影响（见 C4/C5/C6）
- [x] T004 在 `admin-backend/src/domain/config-center/scenario.ts` 定义权威候选枚举 `DATA_PREP_UPLOAD_EXTS`（9 项，带点小写，含注释指明另两处同步落点）
- [x] T005 [P] 在 `admin-frontend/src/constants/agent-design.ts` 定义同值 `DATA_PREP_UPLOAD_EXTS` 与 `DEFAULT_DATA_PREP_UPLOADS = ['.csv', '.xlsx']`（含同步注释）
- [x] T006 [P] 在 `agent-backend/src/domain/dirs.ts` 增加解析用候选枚举常量与注释（与另两处互相指名）

**检查点**：三处候选枚举字面一致；契约文档 grep `data_prep_uploads` 有命中，且 `upload_extensions` 在 `specs/` 下不再为 0 命中。

---

## Phase 2: Foundational（阻塞所有故事的基座）

**目的**：类型与"唯一实现"就位。**⚠️ 本阶段完成前，任何用户故事都不得开始。**

- [x] T007 拆分 `admin-frontend/src/api/types.ts`（**499 行，距门禁 1 行**）：新建 `admin-frontend/src/api/agent-types.ts`，把 `SCENARIO_FIELD_TYPES` / `ScenarioField` / `AgentScenario` / `AgentDesign` / `AgentDesignPayload` **逐字搬运**过去，并在 `types.ts` 用 re-export 保持既有导入路径不变；跑 `npm run typecheck` 确认零破坏（plan D8）
- [x] T008 在 `admin-frontend/src/api/agent-types.ts` 的 `AgentScenario` 增 `data_prep_uploads?: Record<string, string[]>`
- [x] T009 [P] 在 `frontend/src/api/types.ts` 的 `WorkspaceDir` 增 `upload_extensions: string[]`（**+1 行**，496 → 497）
- [x] T010 在 `agent-backend/src/domain/dirs.ts` 的 `Scenario` 增 `dataPrepUploads: Record<string, string[]>`，并实现 `parseScenarioUploads(raw, dirs, logger)`（消费方口径：丢弃 + 告警 + 空则不写键）
- [x] T011 在 `agent-backend/src/domain/dirs.ts` 实现 `uploadExtensionsOf(scenario, space, sub)`（**白名单唯一实现**；数据准备读目录级、缺省回落 `SPACE_POLICIES`，其余空间恒取 `SPACE_POLICIES`）
- [x] T012 [P] 在 `agent-backend/src/domain/field-check.ts` 实现 `supportsFieldCheck(ext)`（**唯一判据**：`.csv`/`.xlsx`），并在 `checkUploadBuffer` 的 JSDoc 写明前置条件
- [x] T013 运行 `node admin-frontend/scripts/check-lines.mjs` 与 `node admin-backend/scripts/check-lines.mjs`，确认拆分后两处均通过

**检查点**：`admin-frontend/src/api/types.ts` 显著低于 500 行；`uploadExtensionsOf` 与 `supportsFieldCheck` 各只有一处实现（grep 确认无第二处）。

---

## Phase 3: User Story 1 - 为每个数据准备目录配置可上传文件类型（P1）🎯 MVP

**目标**：管理员能在目录行的「字段」与「移除」之间配置该目录的可上传类型，至少选 1 项，新建目录默认 `.csv` + `.xlsx`，保存后可一致回显。

**独立测试**：新增目录 → 入口出现且位置正确 → 打开见 9 项候选、默认勾 `.csv`/`.xlsx` → 取消全部勾选被拒 → 勾 3 项保存 → 重开该数字人回显一致 → 移除目录后配置一并消失。

- [x] T014 [P] [US1] 新建 `admin-frontend/src/components/agents/ScenarioUploadTypesDialog.spec.ts`：候选恰 9 项且顺序固定 / 未配置时默认勾 `.csv`+`.xlsx` / 取消全部则禁用保存并提示 / 保存 emit `save` 并关窗 / 取消与 `Esc` 不发 `save` 且不改 props / 键盘可达
- [x] T015 [P] [US1] 新建 `admin-frontend/src/components/agents/ScenarioUploadTypesDialog.vue`（复刻 `ScenarioFieldDialog.vue` 的 `props{open,dir,extensions}` + `emit{update:open,save}` + 原生 `<dialog>` 套路；9 项原生 `checkbox`+`<label>`；"至少一项"约束；显示已选数量）
- [x] T016 [US1] 修改 `admin-frontend/src/components/agents/ScenarioEditor.vue`：`ScenarioValue` 增 `data_prep_uploads`；在「字段(n)」按钮与「移除」按钮**之间**插入「文件类型(m)」入口（`:167-184` 之间）；挂载子弹窗并实现 `saveUploads()`（空列表 ⇒ 删除该键，与 `saveFields` 同口径）
- [x] T017 [P] [US1] 修改 `admin-frontend/src/composables/useAgentDesign.ts`：`toDraft` 深拷贝新字段、`dirty` 增判据、`save` 带出、`emptyDraft` 增初值
- [x] T018 [P] [US1] 补 `admin-frontend/src/components/agents/ScenarioEditor.spec.ts`：入口存在且位于两按钮之间、摘要计数随勾选变化、按目录写入、移除目录连带清理、入口数量等于目录数
- [x] T019 [P] [US1] 补 `admin-frontend/src/composables/useAgentDesign.spec.ts`：新字段深拷贝（改草稿不影响源）与 dirty 判据
- [x] T020 [US1] 修改 `admin-backend/src/domain/config-center/scenario.ts`：`AgentScenario` 增可选字段；`normalizeScenario` 按 `data-model.md` §1.1 的 8 条规则归一（缺省空对象 / 非对象拒绝 / 孤儿键拒绝 / 空数组拒绝 / 非字符串拒绝 / 非法项拒绝 / 去重 / **按枚举序重排**）
- [x] T021 [US1] 修改 `admin-backend/src/domain/config-center/agent-design.ts`：读取路径归一（历史缺键 ⇒ 不写键，对外恒有该键的口径与 `data_prep_fields` 保持一致的取舍需在注释写明）
- [x] T022 [P] [US1] 补 `admin-backend/tests/unit/scenario.spec.ts`：8 条归一规则各 1 例（含大小写混写与顺序归一）
- [x] T023 [P] [US1] 补 `admin-backend/tests/unit/agent-design.spec.ts`：读取归一化（缺键不报错、不产生空壳键）
- [x] T024 [US1] 跑 `admin-frontend` 与 `admin-backend` 门禁（`npm run lint && npm run typecheck && npm run test:coverage`）

**检查点**：管理端可独立演示"配置 → 保存 → 回显"，不依赖任何运行环境改动。

---

## Phase 4: User Story 2 - 配置生效：前台按目录限定可上传类型（P1）

**目标**：部署后，前台在某数据准备目录上传时只呈现/只接受该目录配置的类型；两端判定一致；被拒时提示允许的类型。

**独立测试**：目录 A 配 `.csv`/`.xlsx`/`.txt` → 部署 → 前台 A 目录选择器只显示三类 → 提交 `.pdf` 被拒且提示含允许类型 → 提交 `.txt` 成功 → 同空间的目录 B（不同白名单）过滤范围不同。

- [x] T025 [P] [US2] 修改 `admin-backend/src/domain/deploy/materialize.ts`：`buildScenarioDocument` 在归一后**非空时**写入 `data_prep_uploads`（与 `data_prep_fields` 同口径）
- [x] T026 [P] [US2] 修改 `admin-backend/src/domain/deploy/precheck.ts`：把 `data_prep_uploads` 的逐条问题并入既有 `config_integrity` 预检
- [x] T027 [P] [US2] 补 `admin-backend/tests/unit/materialize.spec.ts`：产物含该键（有配置）/ 不含该键（无配置）
- [x] T028 [P] [US2] 补 `admin-backend/tests/unit/deploy-precheck.spec.ts`：非法配置逐条上抛、缺省不报错
- [x] T029 [US2] 修改 `agent-backend/src/routes/files.ts`：上传校验（现 `:232-241`）改走 `uploadExtensionsOf(scenario, space, sub)`；字段约束触发条件（现 `:244`）追加 `supportsFieldCheck(ext)`
- [x] T030 [US2] 修改 `agent-backend/src/routes/files.ts`：`workspace` 下发（现 `:499-502`）在 `dirs[]` 上增 `upload_extensions`，值取自 `uploadExtensionsOf`
- [x] T031 [P] [US2] 修改 `frontend/src/composables/useWorkspace.ts`：`uploadExtensionsOf(dir)` 改读**该目录自身**（现 `:117-119` 的空间反查删除）
- [x] T032 [P] [US2] 修改 `frontend/src/components/chat/UploadMenu.vue`：`activeAccept`（现 `:44-49`）删除自有空间级查找，改为复用 `useWorkspace` 的同一函数（消除双口径）；**不改** `useChatPanel.ts`
- [x] T033 [P] [US2] 新建 `frontend/src/composables/useWorkspace.spec.ts`：`uploadExtensionsOf` 目录级命中 / 未命中回落 / 另两空间取空间级（只覆盖本次改动行为）
- [x] T034 [P] [US2] 补 `frontend/src/components/chat/UploadMenu.spec.ts`：`accept` 按目录生成（同空间两目录不同白名单各 1 例）；补目录级 fixtures
- [x] T035 [US2] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：①白名单放宽后 `.txt` 上传成功 ②白名单收紧后 `.xlsx` 被拒 ③`workspace` 的 `dirs[].upload_extensions` 等于配置
- [x] T036 [US2] 跑 `agent-backend` 与 `frontend` 门禁（`npm run lint && npm run typecheck && npm run test:coverage`）

**检查点**：`quickstart.md` 步骤 4、5 全部通过。

---

## Phase 5: User Story 3 - 共享空间与临时空间行为不变（P1）

**目标**：无论数据准备目录如何配置，共享空间与临时空间的可上传类型与今天完全一致；管理端也不提供对应入口。

**独立测试**：把数据准备配为最窄集合并部署 → 共享空间与临时空间上传改造前允许的类型全部照常成功。

- [x] T037 [US3] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：`scenario.json` 配了 `data_prep_uploads` 时，共享空间与临时空间的判定**逐项不变**（含空间根与目录项）
- [x] T038 [P] [US3] 补 `frontend/src/components/chat/UploadMenu.spec.ts`：共享空间与临时空间的目录项 `upload_extensions` 恒等于所属空间值（与改造前一致）

**检查点**：`quickstart.md` 步骤 6 的"共享/临时"两行 + 失败判据 4 不被触发。

---

## Phase 6: User Story 4 - 字段约束只对表格类型生效（P2）

**目标**：声明了字段约束的目录上传 `.txt`/`.pdf`/`.json`/`.zip`/图片时跳过表结构校验；`.csv`/`.xlsx` 的既有校验一行不削弱；无约束目录照旧跳过。

**独立测试**：目录 A 声明必填字段且允许 `.txt` → 上传 `.txt` 成功且无表头类理由 → 上传缺必填表头的 `.csv` 仍被拒。

- [x] T039 [P] [US4] 补 `agent-backend/tests/unit/field-check.spec.ts`：`supportsFieldCheck` 对 `.csv`/`.xlsx` 为真，对 `.txt`/`.pdf`/`.json`/`.zip`/`.jpg`/`.png` 为假（含大写形态）
- [x] T040 [US4] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：声明了约束的目录上传 `.txt`（及 `.pdf`/`.json`/`.zip` 各 1 例）**跳过字段校验并成功**
- [x] T041 [US4] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：同目录上传缺必填表头的 `.csv`、类型不符的数据行、损坏文件，仍返回 `400 FILE_SCHEMA_INVALID` 且理由逐条
- [x] T042 [P] [US4] 修正 `agent-backend/src/domain/dirs.ts:126-131` 的过时注释（"本期不实现" → 校验已实现，指向 `field-check.ts`）

**检查点**：`quickstart.md` 步骤 6 的"字段约束"两行通过；失败判据 5、6 不被触发。

---

## Phase 7: User Story 5 - 未配置的存量数字人行为不变（P2）

**目标**：从未配置该字段的存量数字人，其数据准备目录仍只接受 `.csv` 与 `.xlsx`；零迁移、零人工干预。

**独立测试**：取未配置的存量数字人 → 部署 → 数据准备只接受 `.csv`/`.xlsx`；管理端入口显示默认勾选。

- [x] T043 [US5] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：`scenario.json` **不含** `data_prep_uploads` 时，数据准备目录的可用类型等于 `['.csv','.xlsx']`
- [x] T044 [US5] 补 `agent-backend/tests/integration/files-scenario.spec.ts`：数据准备**空间根**上传仍返回 `400 DIR_VALIDATION`（FR-015 修订后的口径）
- [x] T045 [P] [US5] 修改 `frontend/src/utils/file-kind.ts`：`.zip` 加入 `DOWNLOAD_EXTENSIONS`（现 `:24`，**+1 行**）
- [x] T046 [P] [US5] 补 `frontend/src/utils/file-kind.spec.ts`：`.zip` → `download`（并保持既有四类分派断言全绿）

**检查点**：`quickstart.md` 步骤 6 的"存量数字人"行通过；失败判据 7 不被触发。

---

## Phase 8: Polish & 横切关注点

- [x] T047 四侧门禁全跑：`cd agent-backend|frontend|admin-backend|admin-frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build`（记录各自结论）
- [x] T048 行数复测：`agent-backend/src/routes/files.ts`（基线 478，>500 则按 plan D9 拆出 `domain/workspace-view.ts`）、四侧 `api/types.ts`、`ScenarioUploadTypesDialog.vue`、`dirs.ts`、`scenario.ts`
- [x] T049 行数硬门禁：`node admin-backend/scripts/check-lines.mjs` 与 `node admin-frontend/scripts/check-lines.mjs` 均通过
- [ ] T050 按 [`quickstart.md`](./quickstart.md) 执行端到端 6 步验收，并逐条核对 8 条**失败判据**　⚠️ **未执行**：本环境无 Docker / 未起服务，需在具备部署环境的机器上执行（见文末"实测记录"）
- [ ] T051 部署后非交互冒烟：`docker compose up -d --build` 后执行 `quickstart.md` §4 的两条 HTTP 打点（管理端设计态含新键；`workspace` 的目录级白名单等于配置）　⚠️ **未执行**：同上，需 Docker 环境
- [x] T052 按 [`contracts/api-delta.md`](./contracts/api-delta.md) §8 的 4 条判据核对契约与实现一致（含"不再存在白名单固定 `.csv`/`.xlsx` 的表述"）
- [x] T053 回写实测值：`spec.md` 的 SC 实测结论、`plan.md` 的文件净增行数实测、勾选本文件所有已完成任务

---

## 依赖与执行顺序

```text
Phase 1 (T001-T006)  ──►  Phase 2 (T007-T013)  ──►  Phase 3 (US1, T014-T024)  🎯 MVP
                                  │
                                  ├──►  Phase 4 (US2, T025-T036)
                                  │            │
                                  │            ├──►  Phase 5 (US3, T037-T038)
                                  │            ├──►  Phase 6 (US4, T039-T042)
                                  │            └──►  Phase 7 (US5, T043-T046)
                                  └─────────────────────────►  Phase 8 (T047-T053)
```

**跨故事硬依赖**：

- US2 **依赖** Foundational 的 T009/T010/T011/T012，以及 US1 的 T020/T021（归一与校验先于物化与运行环境消费）；
- US3/US4/US5 的**集成用例全部追加在同一个文件** `agent-backend/tests/integration/files-scenario.spec.ts` ⇒ 与 US2 的 T035 **MUST 串行**，不得并行编辑；
- US5 的 T045/T046 与其余故事**无依赖**，可随时插入；
- 所有故事都**不得触及** `frontend/src/composables/useChatPanel.ts`（525 行存量超限）与 `frontend/src/views/**`。

## 并行执行示例

```bash
# Phase 1：三份契约文档 + 两处候选枚举可并行
Task: "T002 修改 data-model.md"
Task: "T003 修改 runtime-api-delta.md"
Task: "T005 在 admin-frontend/src/constants/agent-design.ts 定义候选枚举"
Task: "T006 在 agent-backend/src/domain/dirs.ts 定义候选枚举常量"

# Phase 2：不同类型文件可并行（注意 T010/T011 同文件，必须串行）
Task: "T009 在 frontend/src/api/types.ts 的 WorkspaceDir 增字段"
Task: "T012 在 agent-backend/src/domain/field-check.ts 实现 supportsFieldCheck"

# US1：新组件与其测试、草稿层可并行
Task: "T014 新建 ScenarioUploadTypesDialog.spec.ts"
Task: "T015 新建 ScenarioUploadTypesDialog.vue"
Task: "T017 修改 useAgentDesign.ts"
Task: "T022 补 admin-backend/tests/unit/scenario.spec.ts"

# US2：三侧互不重叠的文件可并行
Task: "T027 补 materialize.spec.ts"
Task: "T028 补 deploy-precheck.spec.ts"
Task: "T031 修改 useWorkspace.ts"
Task: "T032 修改 UploadMenu.vue"
```

## 实施策略

### MVP 优先（仅 US1）

1. 完成 Phase 1（契约与枚举）→ Phase 2（类型与唯一实现）
2. 完成 Phase 3（US1：管理端可配置、可保存、可回显）
3. **停下来独立验证**：管理端单侧即可演示，不依赖运行环境
4. 此时功能"可配置但未生效"——**不对用户可见**，仅作为可回退的安全增量

### 增量交付

1. Setup + Foundational → 基座就绪（运行环境行为**零变化**，因缺省回落）
2. US1 → 管理端可用（配置能存下来）
3. US2 → **配置真正生效**（用户可见价值点）→ 建议此时做一次部署验收
4. US3 / US4 / US5 → 边界与回归保护（可并行推进）
5. Phase 8 → 门禁、行数、契约核对、实测值回写

### 建议提交切分（承宪章"提交信息用中文并说明影响的侧"）

| 提交 | 内容 | 影响侧 |
|---|---|---|
| 1 | 候选枚举 + 类型基座 + 契约登记（T001-T013） | 四侧（契约与类型） |
| 2 | 管理端配置（T014-T024） | `admin-frontend` + `admin-backend` |
| 3 | 物化与运行环境消费（T025-T030） | `admin-backend` + `agent-backend` |
| 4 | 前台按目录过滤（T031-T036） | `frontend` + `agent-backend` |
| 5 | 边界与回归（T037-T046） | 四侧 |
| 6 | 门禁与验收（T047-T053） | 四侧 |

## 备注

- `[P]` = 不同文件且无未完成依赖；**同文件任务一律串行**（尤以 `files-scenario.spec.ts`、`dirs.ts`、`routes/files.ts` 为要）
- `[Story]` 标签用于追溯：每个故事应能独立完成并独立验证
- 实现前**先让测试失败**（新增测试先跑一次观察红），再实现；这是本项目既有 TDD 口径
- 每个任务或逻辑分组后提交一次，提交信息用中文并注明影响的侧
- 切勿：把配置硬编码到前端、在 `useChatPanel.ts` 里新增代码、顺手修 `views/**` 的存量红灯

---

## 实测记录（2026-10-13，一次性推进完成）

### 1. 门禁结论（T047）

| 侧 | lint | typecheck | test | build |
|---|---|---|---|---|
| `agent-backend` | ✅ 0 | ✅ 0 | ✅ **45 文件 / 597 用例**（含集成 `files-scenario.spec.ts` **32 例**：原有 16 + 本次新增 16） | ✅ `tsc` 0 |
| `frontend` | ⚠️ 16 error / 32 warning（**全部在 `views/demo/**`、`views/datapage/**`：存量红灯，非本次引入**；本次触及的文件单独跑 eslint 为 0） | ⚠️ 4 文件报错（同上存量区域，非本次引入） | ✅ **54 文件 / 638 用例**（含验收后修补新增的 3 + 14 例） | ⚠️ `npm run build` 被上述存量 typecheck 阻断；`npx vite build` 独立执行 ✅ 0（证明本次改动可打包） |
| `admin-backend` | ✅ 0 | ✅ 0 | ✅ **43 文件 / 604 用例** | ✅ `tsc` 0 |
| `admin-frontend` | ✅ 0 | ✅ 0 | ✅ **51 文件 / 564 用例** | ✅ `vue-tsc + vite build` 0 |

**合计新增/变更用例**：四侧全量 **2403 用例**全绿（`agent-backend` 597、`frontend` 638、`admin-backend` 604、`admin-frontend` 564）。

### 2. 行数复测（T048/T049）——全部 ≤ 500

| 文件 | 基线 | 实测 | 说明 |
|---|---|---|---|
| `agent-backend/src/routes/files.ts` | 478 | **488** | 超预案触发线（520）过一次，已按 D9 拆出 `domain/workspace-view.ts`（92 行）后回落 |
| `agent-backend/src/domain/workspace-view.ts` | 新增 | **92** | D9 预案落地：`workspace` 响应装配（纯组装、无 IO） |
| `agent-backend/src/domain/dirs.ts` | 415 | **498** | 首次落盘 502 行（注释过长），已精简 JSDoc 回落 |
| `agent-backend/src/domain/field-check.ts` | 189 | **227** | — |
| `frontend/src/api/types.ts` | 496 | **498** | 仅 +2（注释压到一行） |
| `frontend/src/composables/useWorkspace.ts` | 185 | **201** | 含模块级 `uploadExtensionsOfDir`（唯一实现） |
| `frontend/src/components/chat/UploadMenu.vue` | 189 | **227** | — |
| `admin-backend/src/domain/config-center/scenario.ts` | 237 | **415** | — |
| `admin-backend/src/domain/config-center/agent-design.ts` | 380 | **392** | — |
| `admin-frontend/src/api/types.ts` | 499 ⚠️ | **446** | 拆件后大幅回落（D8 拆分生效） |
| `admin-frontend/src/api/agent-types.ts` | 新增 | **87** | 纯搬运 + `data_prep_uploads?` |
| `admin-frontend/src/components/agents/ScenarioUploadTypesDialog.vue` | 新增 | **231** | — |
| `admin-frontend/src/components/agents/ScenarioEditor.vue` | 236 | **333** | — |

**行数硬门禁（T049）**：`admin-backend/scripts/check-lines.mjs` → `通过：99 个文件均未超过 500 行`；`admin-frontend/scripts/check-lines.mjs` → `通过：138 个文件均未超过 500 行`。

### 3. 契约核对（T052，`api-delta.md` §8 四判据）

1. ✅ `admin-api.md` §5.3 与 `runtime-api-delta.md` §3/§3.1 已改，"数据准备白名单固定 `.csv`/`.xlsx`"的表述不再存在（`runtime-api-delta.md` §3.1 明确"每个二级目录各自一份，缺省 `.csv`/`.xlsx`"）。
2. ✅ `upload_extensions` 在 `specs/` 下命中 **≥2 处**（`runtime-api-delta.md` §3 空间级登记 + 目录级新增说明）。
3. ✅ 实现与文档一致：`dirs.ts:375 uploadExtensionsOf` 与 `field-check.ts:30 supportsFieldCheck` 为唯一口径；`SPACE_POLICIES` 的导入点收敛为 `dirs.ts` + `workspace-view.ts` 两处（`routes/files.ts` 不再自行查表）。
4. ✅ 错误码无新增、无改义：白名单拒绝仍为 `VALIDATION_FAILED`；表结构问题仍为 `FILE_SCHEMA_INVALID`。

### 4. 未执行项（环境限制）

- **T050 / T051 未执行**：本环境无 Docker、未起服务，`docker compose up -d --build` 与 `quickstart.md` §4 的 HTTP 打点无法进行。**需在具备部署环境的机器上补执行**；`quickstart.md` 的 6 步与 8 条失败判据**尚未经端到端实测**。
  - 可用的替代证据：`agent-backend/tests/integration/files-scenario.spec.ts` 已用 `app.inject()` 覆盖等价端点行为（放宽/收紧/下发/共享与临时不变/非表格跳过/空间根拒绝），共 **32 例**全绿。

### 5. 与 plan/tasks 的偏差登记

| 偏差 | 原因与处置 |
|---|---|
| **T032 未触碰 `useChatPanel.ts`** | 遵从任务硬约束。该文件 `:318` 的注释仍写"数据准备仅 csv/xlsx"，属**源码注释级存量表述**（`api-delta.md` §8 判据 1 只约束 `admin-api.md` 与 `runtime-api-delta.md`，故不构成契约不一致）。**登记为后续一行注释修正**，本次刻意不动（525 行存量超限文件）。 |
| **`frontend/src/constants/limits.ts` 注释修正（+1 行）** | 该文件不在任务清单内，但其 `:18` 注释"扩展名白名单按空间定义（数据准备仅 csv/xlsx）"因本次改动而失准；按原则一（中文文档规格驱动）就地修正，无行为变化。 |
| **`supportsFieldCheck` 大小写不敏感** | T039 要求断言"含大写形态"，故实现内部先 `toLowerCase()`（上游 `files.ts` 已归一小写，此处仅兜一层）。 |
| **T044 断言的实际错误码** | HTTP 层按既有映射落 `VALIDATION_FAILED`（内部异常为 `DirValidationError`，`code = 'DIR_VALIDATION'`）。用例断言 `400` + 文案含"二级目录"，与 FR-015 修订口径一致。 |
| **T028 的 `scenarioSystemIssues` 定名** | 实际实现为 `scenarioUploadIssues()`（`scenario.ts` 导出），与既有 `scenarioFieldIssues()` 命名成对；plan §3.3 的表述为"（或等价）"，允许。 |
| **T027 在任务清单中带 `[P]`，实际同一文件串行** | `materialize.spec.ts` 与 T028 的 `deploy-precheck.spec.ts` 虽不同文件，但**同批改动同一模块**；为避免相互返工按串行推进，未并行。 |
| **验收后修补：`UploadMenu.vue` 的扩展名展示位置** | **任务清单遗漏点**：T032 只改了 `accept` 的**取值**（空间级 → 目录级），没有改**展示**——原模板把 `space.upload_extensions` 渲染在空间标题旁（`数据准备 .csv .xlsx`），二级目录的 `directory.upload_extensions` 从未展示。用户验收时发现（"只在整体的数据准备这几个大字下有显示"）。已修正：扩展名改挂在**每个二级目录行**下，空间标题不再展示（数据准备的空间值只是平台默认，展示它会误导）。补 2 例组件测试锁定（各目录各按本目录取值 + 空间标题无扩展名），`frontend` 全量 623 用例绿、lint 0。**同批外观修补**：目录按钮由 `width: 100%` 改为内容宽度（`width: auto`），使「表头要求」的「?」紧随目录名；扩展名由「另起一行」改为**同一条 flex 行内紧跟其后**（`min-width: 0` 令长清单在自身盒内折行，不整段落行）；「名字→?→类型」三级间距统一为 4px——无「?」的目录（共享/临时空间）加修饰类切换，类型 `padding-left: 0` 直接贴住文件名右侧。渲染形态：`📁 生产计划? .csv .xlsx .txt`、`📁 共享空间 .csv .xlsx …`——CSS 层改动，jsdom 只能断言修饰类，**实际间距需浏览器目视确认**。 |
| **`frontend` 全量用例数 621 → 624** | 即上述修补新增的 3 例（`UploadMenu.spec.ts`），其余侧用例数不变。 |
| **验收后修补（范围外）：模型选择改视口安全浮窗** | 用户反馈「对话界面下方的大模型选择，点击后弹层不好，且会溢出屏幕外看不到」。根因：`BaseDropdown` 的菜单是 `position: absolute` + `left: 0`、向**下**弹，而它落在**底部**工具栏（`ComposerToolbar` 的 `.composer-toolbar__right`）里 ⇒ 菜单被祖先 `overflow` 裁掉且垂直越出视口。修法：菜单改 `position: fixed`，坐标由新增的纯几何函数 `placeMenu()` 按视口实时计算（下方放不下翻上方、左右越界夹取、菜单自身 `max-height: min(320px, 100vh - 16px)` + 滚动），滚动/改尺寸时合帧重算。**该改动不属于本特性（008）的交付范围**，是用户当次提出的独立体验修复；`BaseDropdown` 当前唯一消费方是 `ModelPicker`，影响面收敛。补 `utils/popup-position.spec.ts` 的 `placeMenu` 6 例 + 新建 `components/common/BaseDropdown.spec.ts` 8 例（该组件此前无测试），`frontend` 全量 **638** 用例绿、lint 0、`vite build` 0。 |

---

## 增量记录（2026-10-14）：候选枚举增 `.xls`

**需求**：用户提出「文件空间场景加一个文件类型 `.xls`，共享 / 临时 / 数据准备都要有这个选项」——客户既有资料（如总BOM）多为旧版 Excel 格式。

**改动落点**

| 落点 | 内容 |
|---|---|
| `admin-backend/src/domain/config-center/scenario.ts` | 权威候选枚举 `DATA_PREP_UPLOAD_EXTS` 在 `.xlsx` 之后插入 `.xls`（9 → 10 项） |
| `admin-frontend/src/constants/agent-design.ts` | 同值同步（弹窗勾选项即来自它） |
| `agent-backend/src/domain/dirs.ts` | `DATA_PREP_UPLOAD_EXTS` 同步；`DOCUMENT_EXTS` 增 `.xls` ⇒ **共享空间 / 临时空间**（空间级）同时放开 |
| `agent-backend/src/domain/field-check.ts` | `supportsFieldCheck` 与 `checkUploadBuffer` 把 `.xls` 归入**表格类型**（SheetJS 按文件头自判 BIFF/zip）；新增 OLE2 魔数前置校验，防"改后缀名的文本文件"蒙混 |
| `agent-backend/src/domain/tools/read-file.ts` | 模型 `read_file` 支持 `.xls`（与 `.xlsx` 同一条转 CSV 路径） |
| `agent-backend/src/domain/rule-file.ts` | 「算法规则」源文件支持 `.xls`（否则管理员勾了 `.xls` 会出现"能上传、选不中"的断点） |
| `frontend/src/utils/file-kind.ts` | `.xls` 归 `download`（与 `.xlsx` 同口径，不落 `unsupported`） |
| `specs/001` 契约 | `data-model.md` §5、`contracts/admin-api.md` §5.3、`contracts/runtime-api-delta.md` §3 的枚举与项数同步 |

**刻意未改**：平台默认（未配置目录）仍为 `.csv` + `.xlsx`（`SPACE_POLICIES[数据准备]` 未动）⇒ 存量数字人行为不变，FR-004 / FR-005 与既有 T043 断言继续成立。

**测试**（四侧全绿）

- `agent-backend` 单测 **507** / 集成 **100**：新增 `.xls` 三空间上传、字段约束对 `.xls` 同样生效、未配置白名单目录仍拒 `.xls`、目录配置的 `.xls` 原样下发、规则文件 `.xls`、非 OLE2（含改后缀名）被拒
- `admin-backend` **604**：归一用例增 `.xls`（大小写归一 + 去重 + 按枚举序重排）
- `admin-frontend` **567**：弹窗候选 10 项、`.xls` 可勾选、计数 `n / 10`
- `frontend` **639**：`.xls` → `download`

**已知取舍**：`.xls` 要求 OLE2 容器魔数（`D0 CF 11 E0 A1 B1 1A E1`）。BIFF2~4 的无容器裸流（1990 年代产物）会被判为"损坏"——与既有"`.xlsx` 必为 zip"的严格口径一致，本次不额外放开。
