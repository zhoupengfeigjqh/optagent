# 实现计划：数据准备目录的可上传文件类型配置

**Branch**: `008-data-prep-upload-types` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: 特性规格 `specs/008-data-prep-upload-types/spec.md`（5 个用户故事 / 26 条功能需求 / 8 条成功标准；白名单粒度已由用户确认＝**每个「数据准备」二级目录各自一份**）

## 摘要

在数字人**设计态**的 `scenario` 下新增一个**按目录**的可上传类型白名单 `data_prep_uploads`（对象：目录名 → 小写含点扩展名数组，候选 10 项，每目录至少 1 项，缺省＝`.csv` + `.xlsx`）；
经既有「平台保存 → 部署物化 → 运行环境读取」链路落进 `scenario.json`；
运行环境把它作为**该目录唯一的可上传类型来源**（上传校验与 `workspace` 下发共用同一个解析函数，杜绝双口径）；
聊天前台据此**按目录**限定文件选择器并一致拒绝白名单外文件；
同时把字段约束的适用范围收敛为"仅 `.csv`/`.xlsx`"。
共享空间、临时空间的判定路径**逐行不变**（只覆盖 `数据准备` 分支）；**零新增依赖、零新增第三方包**。

## 技术上下文（Technical Context）

**Language/Version**：后端 Node ≥ 20 + TypeScript 6（ESM，`tsc` 直出）；前端 Vue 3.5 + TypeScript 6 + Vite 8（`vue-tsc`）

**Primary Dependencies**：后端 Fastify 5 / `zod` / `pino`；前端 Vue 3 + 既有 `ant-design-vue` / `tailwindcss` / `axios` 等。**本次零新增依赖**——白名单解析是纯字符串数组处理，弹窗复用**原生 `<dialog>`** 与既有 `ScenarioFieldDialog` 套路（宪章原则六）

**Storage**：文件系统。设计态 `.platform-data/agents/{name}.json`（`scenario` 键）；部署产物 `users/{uid}/agents/{agent}/scenario.json`（新增 `data_prep_uploads` 键，**仅非空时写入**，与 `data_prep_fields` 同口径）

**Testing**：Vitest 5。后端 `tests/unit`（纯逻辑）+ `tests/integration`（端点）；前端与源码同目录 `*.spec.ts`；**不得依赖真实外部 LLM**（本特性不涉及模型调用）

**Target Platform**：Linux 容器（交付）／Windows 宿主机（本地测试）。本特性只做 JSON 字段解析与前端渲染，**无新增平台相关行为**（见「平台差异风险登记」）

**Project Type**：四侧一体的 Web 应用（`agent-backend` / `frontend` / `admin-backend` / `admin-frontend`）

**Performance Goals**：
- 不新增端点，改动落在既有 `GET /api/files/workspace` 与 `POST /api/files/upload` 上 ⇒ **P95 ≤ 500ms 仍需复测并记录口径**（宪章原则五）；
- 白名单解析为**内存内查表**（`scenario` 已按 mtime 缓存），MUST NOT 引入逐目录额外 IO 或 N+1；
- 前端：`accept` 与过滤结果 MUST 由 `computed` 派生，MUST NOT 在模板里重复查找

**Constraints**：单文件 ≤ **500 行**（硬门禁，见「复杂度跟踪」）；新增模块覆盖率 ≥ 80%，全局地板**只上不下**；**零新增依赖**；平台 → 运行环境**单向**且以数字人为单位整体覆盖；前端 MUST NOT 硬编码后端下发的业务常量（候选集除外——它是平台侧配置项的**候选定义**，运行环境与前台消费的始终是下发值）

**Scale/Scope**：单用户工作台；每个数字人 ≤ 数个数据准备目录，每目录 1~10 个允许类型；候选类型固定 10 项

## 宪章检查（Constitution Check）

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

### 逐条核对（v2.2.0，九条原则）

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 本目录四件套 + 契约增量全中文；规格已收敛（无待澄清项）；行为变更回写规格与契约 |
| 二 代码质量与模块化边界 | **通过（含必要拆分）** | 白名单解析**唯一实现**落在运行环境 `dirs.ts`、字段约束适用性**唯一实现**落在 `field-check.ts`、前端查找**收敛到** `useWorkspace.uploadExtensionsOf`；`admin-frontend/src/api/types.ts` 实测 **499 行**、距硬门禁 1 行 ⇒ **必须先拆分再新增类型**（D8）；`frontend/src/composables/useChatPanel.ts` 存量 **525 行**（已超限）⇒ 本特性**刻意不触及**（D6） |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 四侧均补测试（见 §3 与「测试落点」）：后端域逻辑单测 + 端点集成测试；前端新增组件 `ScenarioUploadTypesDialog.spec.ts` 与改动触达的 `useWorkspace.spec.ts`；覆盖率地板只上不下；测试全部**本地**执行 |
| 四 无障碍与可用性 | **通过** | 新入口复用 `ScenarioFieldDialog` 的原生 `<dialog>`（焦点陷阱、`Esc`）；勾选项为原生 `checkbox` + `<label>`，`Tab`/`Space` 可达；选中数量以文本呈现（不只靠颜色）；动效随 `prefers-reduced-motion` 降级 |
| 五 性能与数据一致性 | **通过** | 复用 mtime 缓存的 `scenario`，零额外 IO；改动端点做 P95 计时；部署物化为**临时文件 + 原子改名**（既有机制，MUST NOT 部分提交）；无 N+1 |
| 六 技术治理与依赖控制 | **通过** | **零新增依赖**；弹窗用原生 `<dialog>`、选择用原生 `checkbox`、解析用平台能力 |
| 七 接口契约与前后端一致性 | **通过（四处同步）** | 契约文档（`admin-api.md §5.3` / `data-model.md §5·§8` / `runtime-api-delta.md §3·§3.1·§8`）＋ 前端类型 ＋ 后端 schema ＋ 测试用例**同一次改动**更新；并**补登既有缺口**：`upload_extensions` 从未进过契约 |
| 八 测试与部署的简单可控 | **通过** | 四侧各有单条门禁命令（§6）；门禁从当前源码重建；部署后按 `quickstart.md` 做非交互冒烟（HTTP 打点）；容器只做部署 |
| 九 优雅降级与故障可观测 | **通过** | 运行环境对非法配置**丢弃 + 告警 + 回落平台默认**（两处并入 `logger.warn`，不静默）；上传被拒给出"允许的类型"可读提示；无重试/无超时引入 |

**门禁判定：PASS，无宪章例外**（复杂度跟踪中登记的是**存量状态**与**门禁驱动的拆分**，不是对原则的豁免）。

### Phase 1 设计之后复核

复核结论与上表一致，无新增冲突：

- 设计**没有扩大契约面**：不新增端点、不改错误码；只在既有 `scenario` 结构与既有 `workspace` 响应上增字段；
- 设计**没有引入第二套判定**：白名单解析（`dirs.ts`）与字段约束适用性（`field-check.ts`）各自只有一处实现，前端 `accept` 与预校验收敛到同一函数；
- 设计**没有触及存量超限文件**：`useChatPanel.ts`（525）与 `api/types.ts`（frontend，496 → +1 行 = 497）均满足；`admin-frontend/src/api/types.ts`（499）按 D8 **先拆后加**。

## 项目结构（Project Structure）

### 文档（本特性）

```text
specs/008-data-prep-upload-types/
├── spec.md              # 已完成（含粒度确认）
├── plan.md              # 本文件
├── research.md          # Phase 0 输出（决策与备选）
├── data-model.md        # Phase 1：设计态字段 + 物化产物 + 缺省回落
├── contracts/
│   └── api-delta.md     # Phase 1：本次对 001 契约的**精确增量**（落点行号 + 前后对照）
├── quickstart.md        # Phase 1：端到端验收与非交互冒烟
├── checklists/
│   └── requirements.md  # 规格质量检查清单
└── tasks.md             # Phase 2（/speckit.tasks 生成，非本命令产物）
```

**契约落点说明**：本仓库惯例是**修改上游契约**而非在新特性下另立一套（先例：007 改 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`）。本特性同样修改上游三份文档，`contracts/api-delta.md` 只记录**精确增量与行号定位**，便于评审时免于在 1120 行的 `runtime-api-delta.md` 里找差异。

### 源码（仓库根）

```text
admin-backend/                                        # 设计态 schema + 校验 + 物化
├── src/domain/config-center/scenario.ts              # 改：候选枚举 + normalizeScenario + issues
├── src/domain/config-center/agent-design.ts          # 改：默认值与读取归一
├── src/domain/deploy/materialize.ts                  # 改：物化产物新增键
├── src/domain/deploy/precheck.ts                     # 改：部署前逐条预检
└── tests/unit/{scenario,materialize,deploy-precheck,agent-design}.spec.ts

admin-frontend/                                       # 设计界面
├── src/api/agent-types.ts                            # 新：数字人设计相关类型（从 types.ts 拆出，D8）
├── src/api/types.ts                                  # 改：re-export，保持既有导入不变
├── src/constants/agent-design.ts                     # 改：候选枚举 + 默认值 + emptyScenario
├── src/composables/useAgentDesign.ts                 # 改：草稿深拷贝 / 脏检查 / 保存
├── src/components/agents/ScenarioEditor.vue          # 改：行内新增「文件类型」入口
├── src/components/agents/ScenarioUploadTypesDialog.vue  # 新：多选弹窗
└── src/components/agents/{ScenarioEditor,ScenarioUploadTypesDialog}.spec.ts

agent-backend/                                        # 运行环境：解析 + 校验 + 下发
├── src/domain/dirs.ts                                # 改：Scenario 新字段 + 解析 + uploadExtensionsOf
├── src/domain/field-check.ts                         # 改：supportsFieldCheck
├── src/routes/files.ts                               # 改：上传校验与 workspace 下发改走新入口
└── tests/{unit,integration}/*.spec.ts

frontend/                                             # 聊天前台：按目录过滤
├── src/api/types.ts                                  # 改：WorkspaceDir.upload_extensions（+1 行）
├── src/composables/useWorkspace.ts                   # 改：uploadExtensionsOf 改读目录
├── src/components/chat/UploadMenu.vue                # 改：activeAccept 复用同一函数
├── src/utils/file-kind.ts                            # 改：.zip 归入下载类
└── src/{composables,components,utils}/*.spec.ts
```

**结构决策（Structure Decision）**：

- **保持四侧既有分层**，不引入新目录：后端 `routes → domain → infra`；前端 `components → composables → api`。
- **配置随设计态走**：新字段挂在 `scenario` 下（与 `data_prep_dirs` / `data_prep_fields` 同族），因此**不需要**新的持久化文件、不需要新的部署步骤、天然享受"部署＝整体覆盖"语义。
- **粒度下放是本次的实质改动**：白名单从"空间级"变为"目录级"，落到三处（设计态对象、`scenario.json` 对象、`workspace` 响应的 `dirs[].upload_extensions`）；空间级 `upload_extensions` **保留**并成为共享/临时空间的唯一来源与数据准备的兜底。

## 1. 技术决策（D1~D12）

### D1 数据形态：`scenario.data_prep_uploads`（对象：目录 → 扩展名数组）

```jsonc
{
  "scenario": "生产计划",
  "data_prep_dirs": ["算法规则", "生产计划"],
  "data_prep_fields": { "生产计划": [{ "name": "产线编号", "type": "string", "required": true }] },
  "data_prep_uploads": { "生产计划": [".csv", ".xlsx", ".txt"], "算法规则": [".json"] }
}
```

- **为什么是对象而不是"每目录一个数组字段"**：目录清单是动态的（管理员可增删），对象形态与 `data_prep_fields` **完全同族**，读写、物化、解析、缺省回落四处的代码结构可以直接照搬。
- **为什么键是目录名**：`data_prep_fields` 已验证这一形态（键必须在 `data_prep_dirs` 内，孤儿键即拒），复用同一套校验思路与错误文案风格。
- **值语义**：小写、含点、去重、**按固定枚举顺序**排列（顺序归一防止"同样的勾选集、不同的顺序"造成 `scenario.json` 字节变化 → 触发运行环境实例重建）。
- **缺省 = 不写键**：未配置的目录不出现（与"空清单的目录不写入 `data_prep_fields`"同口径），运行环境据此回落平台默认 `.csv` + `.xlsx`。

### D2 候选枚举的唯一来源与"四处同步"

候选 10 项：`.xlsx`、`.xls`、`.csv`、`.txt`、`.pdf`、`.json`、`.zip`、`.jpg`、`.png`、`.jpeg`（`.xls` 为 2026-10-14 新增，插在 `.xlsx` 之后以保持"同族相邻"）。

| 落点 | 角色 |
|---|---|
| `admin-backend/src/domain/config-center/scenario.ts` | **权威定义**：`DATA_PREP_UPLOAD_EXTS`，用于保存校验与归一 |
| `admin-frontend/src/constants/agent-design.ts` | 界面勾选项（与权威定义同值；沿用既有"同一枚举、MUST 同步"注释口径） |
| `agent-backend/src/domain/dirs.ts` | 解析时合法性判定（非法项丢弃 + 告警） |
| 契约 `admin-api.md §5.3` | 文本登记（评审口径） |

> 既有 `SCENARIO_FIELD_TYPES` 的注释已写"三处 MUST 同步"；本特性把"候选扩展名"也纳入同一同步纪律，并在三处注释里互相指名。

### D3 运行环境：白名单解析的**唯一实现** `uploadExtensionsOf`

```ts
// agent-backend/src/domain/dirs.ts（新增；上传校验与 workspace 下发的共同来源）
export function uploadExtensionsOf(
  scenario: Scenario,
  space: SpaceName,
  sub?: string,
): readonly string[] {
  if (space === SPACE_PREP && sub) {
    return scenario.dataPrepUploads[sub] ?? SPACE_POLICIES[SPACE_PREP].uploadExtensions;
  }
  return SPACE_POLICIES[space].uploadExtensions;
}
```

消费方**只有两处**，都改为调用它：`routes/files.ts` 的上传校验（现 `:232-241`）与 `workspace` 下发（现 `:499-502`）。
收益：**"界面 `accept` 允许的"与"服务端放行的"永远同源**，不可能出现一端允许另一端拒绝。

### D4 字段约束只对表格类型生效的**唯一实现** `supportsFieldCheck`

```ts
// agent-backend/src/domain/field-check.ts（新增）
export function supportsFieldCheck(ext: string): boolean {
  return ext === '.csv' || ext === '.xlsx';
}
```

- `routes/files.ts` 的校验条件（现 `:244`）由 `target.space === SPACE_PREP && target.sub` 改为**再加** `&& supportsFieldCheck(ext)`——顺带省掉非表格类型的暂存文件读取；
- `checkUploadBuffer` 保持"只接受 `.csv`/`.xlsx`"的职责，JSDoc 写明**前置条件**（避免出现第二处"哪些扩展名算表格"的口径）；
- **不削弱既有校验**：`.csv`/`.xlsx` 的表头与取值判定一行不改（FR-022）。

### D5 前端：按目录查找的**单一实现**

`useWorkspace.uploadExtensionsOf(dir)`（现 `:117-119`，当前按空间反查）改为**读该目录自身**：

```ts
function uploadExtensionsOf(dir: string): readonly string[] {
  return dirs.value.find((item) => item.dir === dir)?.upload_extensions ?? [];
}
```

`UploadMenu.vue` 的 `activeAccept`（现 `:44-49`）**删除自己那份空间级查找**，改为复用 `useWorkspace` 暴露的同一函数（当前它独立实现，本特性必须消除这处双口径）。
`useChatPanel.ts:319` 的调用形态与参数不变 ⇒ **不触及该 525 行存量超限文件**。
`useUploads.ts`、`file-kind.ts` 的 `isUploadAllowed` 只吃"白名单数组"参数，**粒度无关，零改动**（`.zip` 分类除外，见 D7）。

### D6 管理端 UI：新增 `ScenarioUploadTypesDialog.vue`

- **形态**：复刻 `ScenarioFieldDialog.vue`（现 323 行）的成熟套路——`props { open, dir, extensions }` + `emit { update:open, save(extensions) }` + 原生 `<dialog>` + `showModal()`（含焦点陷阱与 `Esc`）。
- **入口位置**：`ScenarioEditor.vue` 的目录行操作区，插在「字段(n)」按钮（现 `:167-175`）与「移除」按钮（现 `:176-184`）**之间**（FR-001）。
- **入口文案**：`文件类型({{ n }})`，`n` = 该目录允许的类型数（缺省时为默认 2）。
- **至少选一项**：勾选集合为空时禁用保存并给出可读提示（FR-003）；后端同样拒绝空数组（双保险）。
- **新建目录的默认值**：**不写键即默认** —— 弹窗打开时若该目录无配置，则预勾 `.csv` 与 `.xlsx`（FR-004），无需在 `addDir` 里预写配置（保持"新增目录 → 弹字段约束窗口"的既有流程不被第二次弹窗打断）。

### D7 `.zip` 的连带处置

`.zip` 是**新引入**的可上传类型（改造前任何空间都不允许），而 `frontend/src/utils/file-kind.ts` 的预览分类里没有它 ⇒ 会落到 `unsupported`（既不预览也不给下载入口）。
决策：把 `.zip` 加入 `DOWNLOAD_EXTENSIONS`（`file-kind.ts:24`，**+1 行**），使它在预览区呈现为"可下载"。不新增预览能力（原则六）。

### D8 `admin-frontend/src/api/types.ts` 的拆分（**门禁驱动，非可选**）

- **现状**：实测 **499 行**，而 `admin-frontend/scripts/check-lines.mjs` 的 `MAX_LINES = 500` 扫描 `src/**` 与 `tests/**` ⇒ **在此文件新增任何字段都会立即触发硬门禁**。
- **决策**：把数字人设计相关类型抽到新文件 `admin-frontend/src/api/agent-types.ts`（`SCENARIO_FIELD_TYPES`、`ScenarioField`、`AgentScenario`、`AgentDesign`、`AgentDesignPayload`，约 60~70 行），`types.ts` 保留 `export type { … } from './agent-types'` 形式的 **re-export**，保证既有 import 路径**零破坏**。
- **口径先例**：`admin-backend/src/domain/config-center/agent-design.ts` 曾因同一门禁拆出 `naming.ts`，`data-model.md §5` 的"实现落点"注释已登记该先例。
- **约束**：拆分 MUST 是**纯搬运**（逐字移动 + re-export），MUST NOT 顺手改名或改语义；`admin-frontend` 既有测试与 `typecheck` 保持全绿。

### D9 `agent-backend/src/routes/files.ts` 的行数预案

实测 **478 行**。本次改动仅两处调用替换（净增约 2~6 行）＋ 一处条件补充（约 1 行）⇒ 预计 **≤ 486 行**，安全。
**预案（若实测超 500）**：把 `workspace` 响应的**组装**（现 `:456-507` 一带）抽到 `src/domain/workspace-view.ts`（纯组装、无 IO），路由只做收発——与 D8 同性质，登记在复杂度跟踪。

> **2026-10-13 实测回写：预案已触发并落地。** 首次落盘后 `routes/files.ts` 实测 **520 行**（超 500 硬门禁——原估 +2~6 行偏低，实际为"上传校验改走 `uploadExtensionsOf` 需先载入场景"带来的分支改写）。已按本预案抽出 `src/domain/workspace-view.ts`（**92 行**，`buildWorkspaceView(scenario, access)`，纯组装、无 IO），路由只保留"载入场景 → 调用装配"；抽出后 `routes/files.ts` = **488 行**，回落安全区。同时 `dirs.ts` 首次落盘 502 行（JSDoc 过长），精简注释后 **498 行**。全部行数见 [`tasks.md`](./tasks.md) 文末"实测记录"。

### D10 部署语义（承既有口径，不改）

平台是配置的**唯一权威源**，`scenario.json` 随数字人目录**整体覆盖**；平台侧未配置的目录不写键 ⇒ 运行环境**不会残留**旧白名单（FR-033）。
注意到 `runtime-api-delta.md §8 R7 / §14 R15` 的配置指纹：`scenario.json` 属于指纹输入 ⇒ 本次新增的键在**首次配置时会触发一次运行环境实例重建**，属预期行为，需在契约中登记（避免验收时被当成异常）。

### D11 降级与可观测（原则九）

- 运行环境解析 `data_prep_uploads` 时：非对象、值非数组、项非法（不在候选枚举内 / 非字符串 / 空串）、键不在有效目录清单内（孤儿键）⇒ **逐项丢弃 + `logger.warn`**，该目录回落平台默认；**MUST NOT** 让整个 `scenario` 不可用（与 `parseScenarioFields` 同口径）。
- 上传被拒（不在白名单）沿用既有 `VALIDATION_FAILED` 语义，但**提示 MUST 含该目录允许的类型**（FR-042 / SC-002）。

### D12 契约同步（四处 + 补登既有缺口）

| 文件 | 修改点 |
|---|---|
| `specs/001-.../contracts/admin-api.md` | §5.3 的 `scenario` 结构块（现 `:558-577`）新增 `data_prep_uploads` 示例与约束 |
| `specs/001-.../data-model.md` | §5 字段表（现 `:215-221` 一带）新增一行；§8 物化产物（现 `:321-347`）补键说明 |
| `specs/001-.../contracts/runtime-api-delta.md` | §3 表格（现 `:163`）把 `upload_extensions` 补登为**目录级**字段；§3.1（现 `:169-207`）改正文 `:187` 的"数据准备白名单固定 `.csv`/`.xlsx`"表述，并新增"字段约束仅适用 `.csv`/`.xlsx`"；§8/§14 指纹处登记新键影响 |
| admin-frontend `api/agent-types.ts`、agent-backend `scenario.ts`、测试 | 同一次改动同步 |

> **补登既有缺口**：`upload_extensions` 目前**只存在于代码**（`dirs.ts:53-57`、`routes/files.ts:499-502`、`UploadMenu.vue:46-49`），`specs/` 下 grep 命中 0 处。本特性把它的**目录级形态**正式写入契约。

### D13 规格回写：数据准备空间根不支持上传（FR-015 修订）

- **取证**：`agent-backend/src/domain/dirs.ts:358-362` 的 `parseSpaceDir` 对数据准备**强制要求二级目录**（根目录上传返回 `400 DIR_VALIDATION`）。
- **结论**：规格初稿 FR-015 假设的"空间根沿用平台默认白名单"是一个**不可达场景**，已按宪章原则一**回写规格**——`spec.md` 修订记录 v1.2，FR-015 / 「边界情况」/ 「假设 5」三处同步。
- **对本计划的影响**：`uploadExtensionsOf` 仅在 `space === SPACE_PREP && sub` 时读目录级配置，根目录分支天然不进入（无需为"根的白名单"写代码）；集成测试只需断言"数据准备根上传仍返回 `400`"。

## 2. 被否决的方案

| 方案 | 否决理由 |
|---|---|
| **空间级白名单**（`scenario.data_prep_upload_extensions: string[]`） | 与用户确认的入口位置（目录行内、每行一份）不符；会导致"同一空间不同目录无法区分"，与字段约束的目录级粒度也不对称 |
| **白名单随详情接口/新端点下发** | 需扩大契约面（新端点或改重载荷响应形状），而既有 `workspace` 已按空间下发同类字段——只需把粒度下放到 `dirs[]`，无需新通道 |
| **每目录一个独立字段**（如 `data_prep_upload_ext_types_A`） | 目录名是用户定义的任意字符串，无法映射为字段名；且与 `data_prep_fields` 的对象形态割裂 |
| **前端为每个目录维护一份候选常量** | 违反原则七"前端 MUST NOT 硬编码后端下发的业务常量"，且会产生第二套口径 |
| **把候选集做成可配置**（管理员自定义扩展名） | 超出需求（需求给定固定 9 项），且会引入路径安全（如 `.sh`/`.exe`）与预览分派的连锁问题 |
| **在 `addDir` 里预写默认配置** | 会在"新增目录"流程里连弹两个窗口；用"缺省即默认"更简且与既有 `data_prep_fields` 口径一致 |
| **字段约束与白名单做联动限制**（声明约束就只能选表格类） | 用户已明确"其他类型跳过字段约束"，无需联动；加限制反而削弱可用性 |
| **引入多选组件库** | 违反原则六；9 个原生 `checkbox` + `<label>` 已满足需求与无障碍 |

## 3. 文件级改动

> 行数为**实测基线**（2026-10-13，`Get-Content | .Count`）。⚠️ 为存量超限/贴近上限的文件。**净增行数为估算**，实现后 MUST 复测。
>
> **2026-10-13 复测已完成**：下表的"净增（估）"多处偏低（尤以 `dirs.ts`、`scenario.ts`、`ScenarioEditor.vue` 为甚，因 JSDoc 与测试辅助代码被低估），**实测值一律以 [`tasks.md`](./tasks.md) 文末"实测记录 · 2. 行数复测"为准**；所有落盘文件均 ≤ 500 行（`routes/files.ts` 由 520 → 488 见 D9）。

### 3.1 `agent-backend`

| 文件 | 基线 | 改动 | 净增（估） |
|---|---|---|---|
| `src/domain/dirs.ts` | 415 | `Scenario` 新增 `dataPrepUploads`；`loadScenario` 解析该键；新增 `parseScenarioUploads()`（消费方口径：丢弃 + 告警）；新增 `uploadExtensionsOf()` | +45 |
| `src/domain/field-check.ts` | 189 | 新增 `supportsFieldCheck()`（唯一判据） | +8 |
| `src/routes/files.ts` | 478 | 上传校验改调 `supportsFieldCheck` + `uploadExtensionsOf`；`workspace` 下发改调 `uploadExtensionsOf`（`dirs[]` 新增 `upload_extensions`） | +6 |
| `tests/unit/dirs.spec.ts` | — | 解析：合法/非法项/孤儿键/缺省；`uploadExtensionsOf`：数据准备按目录、空间根与另两空间走 `SPACE_POLICIES` | +60 |
| `tests/unit/field-check.spec.ts` | — | `supportsFieldCheck`：`.csv`/`.xlsx` 真，`.txt`/`.pdf`/`.json`/`.zip`/图片 假 | +20 |
| `tests/integration/files-scenario.spec.ts` | 366 | ①白名单放宽后 `.txt` 上传成功 ②收紧后 `.xlsx` 被拒 ③**声明约束的目录上传 `.txt` 跳过字段校验**（FR-020）④同目录缺表头 `.csv` 仍 `FILE_SCHEMA_INVALID` ⑤共享/临时空间不受配置影响 ⑥`workspace` 下发的 `dirs[].upload_extensions` 等于配置 | +90 |

### 3.2 `frontend`

| 文件 | 基线 | 改动 | 净增（估） |
|---|---|---|---|
| `src/api/types.ts` | 496 | `WorkspaceDir` 新增 `upload_extensions: string[]` | +1 |
| `src/composables/useWorkspace.ts` | 185 | `uploadExtensionsOf` 改读目录自身（**唯一实现点**） | +2 |
| `src/components/chat/UploadMenu.vue` | 217 | `activeAccept` 删除自有空间级查找，委托 `useWorkspace`（`props` 增 `uploadExtensionsOf` 注入或复用既有注入） | ±0 |
| `src/utils/file-kind.ts` | 89 | `.zip` 加入 `DOWNLOAD_EXTENSIONS`（D7） | +1 |
| `src/composables/useWorkspace.spec.ts` | **不存在** | 新建：`uploadExtensionsOf` 目录级命中/未命中回落；`spaces` 刷新 | +70 |
| `src/components/chat/UploadMenu.spec.ts` | 107 | 新增：`accept` 按**目录**生成（同空间两目录不同白名单）；目录级 `upload_extensions` fixtures | +40 |
| `src/utils/file-kind.spec.ts` | 106 | `.zip` → `download` | +8 |

**不加**：`src/composables/useChatPanel.ts`（⚠️ **525 行，存量超限**；本特性调用形态不变，MUST NOT 在其中新增代码）、`src/composables/useUploads.ts`（白名单已是参数，粒度无关）。

### 3.3 `admin-backend`

| 文件 | 基线 | 改动 | 净增（估） |
|---|---|---|---|
| `src/domain/config-center/scenario.ts` | 237 | 新增 `DATA_PREP_UPLOAD_EXTS`；`AgentScenario` 增 `data_prep_uploads?`；`normalizeScenario` 归一（键必须在清单内、值非空数组、逐项合法、小写、去重、按枚举序）；`scenarioSystemIssues`（或等价）逐条预检 | +80 |
| `src/domain/config-center/agent-design.ts` | 380 | `withScenarioDefaults` 读取归一（缺省不写键）；`validateAgentInput` 接入新校验 | +15 |
| `src/domain/deploy/materialize.ts` | 131 | `buildScenarioDocument` 非空时写 `data_prep_uploads`（与 `data_prep_fields` 同口径） | +6 |
| `src/domain/deploy/precheck.ts` | 205 | 部署前把新校验的逐条问题并入 `config_integrity` | +12 |
| `tests/unit/scenario.spec.ts` | 199 | 归一化与校验用例（合法/非法项/空数组/重复/大小写/顺序归一/孤儿键/缺省） | +90 |
| `tests/unit/materialize.spec.ts` | 321 | 产物含/不含新键 | +35 |
| `tests/unit/deploy-precheck.spec.ts` | 222 | 预检逐条上抛 + 缺省不报错 | +30 |
| `tests/unit/agent-design.spec.ts` | 393 ⚠️ | 读取归一化断言 | +15 |

### 3.4 `admin-frontend`

| 文件 | 基线 | 改动 | 净增（估） |
|---|---|---|---|
| `src/api/agent-types.ts` | **新增** | 从 `api/types.ts` 拆出的数字人设计类型（D8） | +70 |
| `src/api/types.ts` | 499 ⚠️ | 改为 re-export；`AgentScenario` 增 `data_prep_uploads?`（在拆出的文件里加） | −60 / +2 |
| `src/constants/agent-design.ts` | 94 | `DATA_PREP_UPLOAD_EXTS`（10 项，2026-10-14 增 `.xls`）＋ `DEFAULT_DATA_PREP_UPLOADS`（`.csv`/`.xlsx`）；`emptyScenario()` 增空对象 | +18 |
| `src/composables/useAgentDesign.ts` | 225 | `toDraft` 深拷贝新字段；`dirty` 加判据；`save` 带出；`emptyDraft` | +14 |
| `src/components/agents/ScenarioEditor.vue` | 271 | 行内新增「文件类型(n)」入口（在「字段」与「移除」之间）＋ 子弹窗挂载 ＋ `saveUploads()` | +45 |
| `src/components/agents/ScenarioUploadTypesDialog.vue` | **新增** | 10 项多选弹窗（复刻 `ScenarioFieldDialog` 套路，含"至少一项"约束与无障碍） | +200 |
| `src/components/agents/ScenarioUploadTypesDialog.spec.ts` | **新增** | 6 类场景：候选恰 10 项 / 默认勾选 / 取消全部禁用保存 / 保存 emit / 取消与 `Esc` 不改 props / 键盘可达 | +110 |
| `src/components/agents/ScenarioEditor.spec.ts` | 219 | 入口位置断言、摘要计数、按目录写入、移除目录连带清理 | +60 |
| `src/composables/useAgentDesign.spec.ts` | 296 | 新字段深拷贝与 dirty 判据 | +30 |

## 4. 覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）共 20 个模块尚无测试，其**补测顺序与范围** MUST 在下一个特性的 `plan.md` 给出结论；**MUST NOT** 发起存量补齐专项。

**本次结论**：

| 项 | 结论 |
|---|---|
| 顺序与范围 | **沿用 `specs/002-conversation-runtime/plan.md` §4 已确立的顺序**（① 网络与契约边界 → ② 产出与预览链路 → ③ 会话与流式 → ④ 其余），本次**不重新排序、不扩大范围** |
| 机制 | **随改动触达即补**，不立项专项。本次触达 `frontend/src/composables/useWorkspace.ts`（改动点 `uploadExtensionsOf`）⇒ **新建 `useWorkspace.spec.ts`**，只覆盖本次改动行为（目录级查找与回落），**不为该模块的其余函数补测** |
| 逐文件 80% 清单 | `frontend/vite.config.ts` 的清单（现 `:77-102`，20 个模块）**本次不新增条目**：`useWorkspace.ts` 属存量模块、其余函数未被改动，强行纳入会与"不追溯"冲突并制造大面积补测 |
| 地板 | 全局地板（现 `statements 59 / branches 63 / functions 48 / lines 58`）**只上不下**；本地跑 `test:coverage` 后按实测结果登记，若因新增测试上调则回写 `vite.config.ts` |

## 5. 平台差异风险登记（宪章原则三）

**登记结论：本次改动无新增平台相关行为。** 不涉及路径大小写、非 ASCII 路径、行尾符或原生模块——新增逻辑是 **JSON 字段解析**（字符串数组处理）与 **前端渲染**；
`scenario.json` 的写入仍走既有"临时文件 + 原子改名"机制（既有平台差异已由 `domain/fs-safe.ts` 兜住），本特性不新增文件系统原语。
**测试与交付目标的差异风险**：`data_prep_uploads` 的解析容错（丢弃 + 告警）与前端 `accept` 生成均在 Windows 本地与 Linux 容器表现一致。

## 6. 门禁（宪章原则八；全部在本地执行，容器不参与）

```powershell
# agent-backend
cd agent-backend; npm run typecheck; npm run lint; npm run test:coverage; npm run build
# frontend
cd frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build
# admin-backend
cd admin-backend; npm run typecheck; npm run lint; npm run test:coverage; npm run build
# admin-frontend
cd admin-frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build
```

**行数硬门禁**：`node admin-backend/scripts/check-lines.mjs` 与 `node admin-frontend/scripts/check-lines.mjs`（两处对称，各扫 `src/**`+`tests/**`，阈值 500）。
**已知存量状况（非本次引入）**：`frontend` 与 `agent-backend` **没有** `check-lines` 脚本（存量缺口，本特性**不补**，按人工核对 + 本节行数基线控制）；`frontend/src/composables/useChatPanel.ts` = 525 行（存量超限，本特性刻意不触及）；`views/demo/**`、`views/datapage/**` 的既有 lint/typecheck 红灯（宪章同步影响报告第 4 项，由该区域负责人处置，本次不动）。
**部署冒烟**：`docker compose up -d --build` 后按 [`quickstart.md`](./quickstart.md) 的非交互打点确认——只确认部署成功，**不作为测试结论**。

## 7. 验收

见 [`quickstart.md`](./quickstart.md)（端到端 6 步）与 [`spec.md`](./spec.md) 的 SC-001~SC-008；任务与勾选状态见 `tasks.md`（`/speckit.tasks` 生成）。

---

## 复杂度跟踪（Complexity Tracking）

> 本表登记**门禁驱动的拆分**与**存量状态**，不构成对任何原则的豁免（原则二、三均为"通过"）。

| 项 | 为何必要 | 被否决的更简方案 |
|---|---|---|
| `admin-frontend/src/api/types.ts` 拆出 `api/agent-types.ts`（D8） | 该文件实测 **499 行**，距硬门禁（500）仅 1 行；新增字段必然越线，而"新增类型"是本特性不可回避的一步 | ① 把新字段塞进别的既有文件（只是把越线风险转移，且语义错位）②放宽带 re-export 的 re-export（无收益）③在 `types.ts` 内"删注释腾行"（脆且掩盖问题） |
| `frontend/src/composables/useWorkspace.ts` 新建同名 spec 但不进 80% 逐文件清单 | 宪章原则三要求"改动部分及其直接受影响的测试"合规；而该模块属存量零覆盖模块，全量补测会触发"不追溯"红线 | ① 把它加入逐文件 80% 清单（会连带要求覆盖未改动的其余函数，与治理冲突）②不建 spec（改动点无测试覆盖，违反原则三） |
| `frontend/src/composables/useChatPanel.ts` 刻意不触及 | 存量 **525 行已超限**；本特性通过"白名单仍作为参数传递"的设计使其调用形态不变，从而避免"触及即拆" | ① 顺手拆 `useChatPanel`（放大改动范围，违反治理"不得以合规为名放大范围"）②把参数改成对象以"更优雅"（无收益且必然触及） |
| `agent-backend/src/routes/files.ts` 保留在单文件（478 → 预计 ≤486） | 改动仅两处调用替换 + 一处条件补充，天然不越线；过度拆分反而增加跨文件跳转成本 | 预先拆出 `workspace-view.ts`（留作**预案**，仅在实测超 500 时执行） |
