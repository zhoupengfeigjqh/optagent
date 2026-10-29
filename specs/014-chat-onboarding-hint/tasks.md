# 任务清单：聊天页头部对齐与空数据新手引导

**Input**: 设计文档 `specs/014-chat-onboarding-hint/`

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`

**Tests**: 本项目宪章原则三要求测试完备，故**包含测试任务**；测试先行，实现后再跑门禁。

**Organization**: 按用户故事分组。US1（空数据引导，P1）与 US2（头部对齐，P2）互不依赖，但 US1 依赖 Phase 2 的契约字段。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（不同文件、无未完成依赖）
- **[Story]**：所属用户故事（US1 / US2）；Setup、Foundational、Polish 阶段不带
- 所有任务均给出仓库内精确路径

## 路径约定

- 运行端：`agent-backend/src/**`、`agent-backend/tests/**`
- 工作台：`frontend/src/**`
- 文档：`specs/014-chat-onboarding-hint/**`、`specs/001-digital-human-platform/contracts/**`

---

## Phase 1: Setup（基线确认）

**目的**：在改代码前确认本地基线与规格文档可用，避免把存量红灯误算到本次改动头上。

- [X] T001 确认设计文档齐全且 `.specify/feature.json` 指向 `specs/014-chat-onboarding-hint`，缺项先补齐（`specs/014-chat-onboarding-hint/`、`.specify/feature.json`）
- [X] T002 [P] 跑一遍两端现有门禁并记录基线：`cd frontend && npm run test`、`cd agent-backend && npm run test:all`（后者同时跑单测与端点集成；只记录通过数，不修存量问题）

---

## Phase 2: Foundational（阻塞前置：`predefined` 契约字段）

**目的**：让前端拿到"预定义目录"的权威标记，US1 的所有判定都依赖它。

**⚠️ 关键**：本阶段完成前不要开始 US1；US2 不依赖本阶段。

- [X] T003 [P] 在 `agent-backend/src/domain/dirs.ts` 新增 `PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const` 并写清"平台硬编码、与 admin-backend 常量同步"的注释
- [X] T004 让 `agent-backend/src/domain/rule-file.ts` 的 `RULES_SUBDIR` 由 `PREDEFINED_DATA_PREP_DIRS[0]` 派生（保留既有导出名，导入方零改动）
- [X] T005 在 `agent-backend/src/domain/workspace-view.ts` 的 `WorkspaceDirItem` 增加 `predefined: boolean`：数据准备二级目录按 `PREDEFINED_DATA_PREP_DIRS` 判定，共享/临时空间恒为 `false`
- [X] T006 [P] 新增 `agent-backend/tests/unit/workspace-view.spec.ts`，覆盖：`算法规则`→`true`、自定义目录→`false`、共享/临时空间目录→`false`、空目录 `files: []` 不影响标记
- [X] T007 在 `agent-backend/tests/integration/files-scenario.spec.ts` 增加断言：场景含 `算法规则` 时响应中仅该项 `predefined === true`，切换数字人后随新场景变化
- [X] T008 [P] 在 `frontend/src/api/types.ts` 的 `WorkspaceDir` 增加必填字段 `predefined: boolean`，并补注释（平台预定义目录标记，非本字段不参与判定）
- [X] T009 为 `predefined` 补齐前端测试夹具：`frontend/src/composables/useWorkspace.spec.ts`、`frontend/src/composables/useUploadPanel.spec.ts`、`frontend/src/composables/useFileMention.spec.ts`、`frontend/src/utils/space.spec.ts`、`frontend/src/components/chat/UploadMenu.spec.ts`、`frontend/src/components/chat/InteractionDialog.mention.spec.ts`、`frontend/src/components/chat/InteractionControl.spec.ts` 统一补 `predefined: false`（共 7 个 spec；`api/types.ts` 属 T008，不在此列）
- [X] T010 在 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的 workspace 响应章节补充 `predefined` 字段说明（与 `specs/014-chat-onboarding-hint/contracts/workspace-dir-predefined.md` 一致）

---

## Phase 3: 用户故事 1 - 空数据时主动提示上传（Priority: P1）🎯 MVP

**目标**：切换数字人后，若「数据准备」所有非预定义目录为空，在「+」上弹出可关闭的引导气泡；关闭后直到下次切换才重新判定；上传成功后自动消失。

**独立验证**：`quickstart.md` 的 S1~S7；不需要 US2 的任何改动。

### 测试（先行，预期先红）

- [X] T011 [P] [US1] 新增 `frontend/src/utils/empty-data-hint.spec.ts`：四类真值表（无非扁平空间 / 仅预定义目录 / 全空 / 任一有文件）+ 文案常量逐字断言
- [X] T012 [P] [US1] 新增 `frontend/src/composables/useEmptyDataHint.spec.ts`：切换后判定、关闭后不重现、再次切换重置、上传后自动隐藏、清单加载失败不弹、删除文件不误重现、`predefined` 字段缺失时按不满足处理（不误弹）
- [X] T013 [P] [US1] 新增 `frontend/src/components/chat/UploadHintBubble.spec.ts`：文案渲染、点「×」emit close、其它点击不关闭、`role="status"` 与关闭按钮 `aria-label`
- [X] T014 [P] [US1] 新增 `frontend/src/components/chat/ComposerToolbar.spec.ts`：`upload-hint` 插槽内容渲染在「+」同组、未提供插槽时无多余 DOM、上传按钮事件仍正常上抛
- [X] T015 [US1] 在 `frontend/src/composables/useAppSession.spec.ts` 增加断言：`switchTo` 成功后才调用空数据判定、失败不调用、`loadCurrent`（首次加载/刷新）不调用

### 实现

- [X] T016 [P] [US1] 新增 `frontend/src/utils/empty-data-hint.ts`：导出 `EMPTY_DATA_HINT_TEXT` 与 `needsDataUpload(spaces)`（复用 `isFlatSpace`，过滤 `predefined`）
- [X] T017 [US1] 新增 `frontend/src/composables/useEmptyDataHint.ts`：`visible` / `dismissed`、`onAgentSwitched()`、`dismiss()`、`watch(workspace.spaces)` 条件失效自动隐藏
- [X] T018 [US1] 在 `frontend/src/composables/useAppSession.ts` 装配该状态：`AppSession` 增加 `emptyHint`，`onSwitched` 末尾（`await workspace.load()` 之后）调用 `onAgentSwitched()`
- [X] T019 [P] [US1] 新增 `frontend/src/components/chat/UploadHintBubble.vue`：锚定样式、右上角「×」、`role="status"`、`prefers-reduced-motion` 降级
- [X] T020 [US1] 在 `frontend/src/components/chat/ComposerToolbar.vue` 左侧分组增加具名插槽 `upload-hint`，分组设 `position: relative`（组件仍不持有业务状态）
- [X] T021 [US1] 在 `frontend/src/composables/useChatPanel.ts` 仅透传 `emptyHint`（不加逻辑；该文件已 488 行）
- [X] T022 [US1] 在 `frontend/src/components/chat/ChatPanel.vue` 通过 `ComposerToolbar` 的 `upload-hint` 插槽条件渲染气泡并接 `dismiss`；若该文件超过 500 行，按计划抽 `frontend/src/components/chat/ChatComposerArea.vue`
- [X] T023 [US1] 在 `frontend/src/components/chat/ChatPanel.spec.ts` 增加装配断言：`emptyHint.visible` 为真时气泡出现、为假时无 DOM
- [X] T024 [US1] 跑 US1 相关门禁并修复：`cd frontend && npm run test -- empty-data-hint useEmptyDataHint UploadHintBubble ComposerToolbar useAppSession ChatPanel`，新模块覆盖率 ≥ 80%

**检查点**：S1~S7 全部通过后，MVP 可交付；此时 US2 尚未动工也不影响本故事。

---

## Phase 4: 用户故事 2 - 头部 MCP 状态与切换按钮左对齐（Priority: P2）

**目标**：MCP 状态行左边缘与「切换」按钮左边缘落在同一垂直基准线，信息顺序与右侧动作位不变。

**独立验证**：`quickstart.md` §4（DevTools 量像素，三种宽度）+ 结构断言测试。

- [X] T025 [P] [US2] 新增 `frontend/src/components/chat/McpStatusList.vue`：承接 `ul[aria-label="MCP 服务状态"]` 与 `McpStatusItem` 列表，无数据时不渲染容器
- [X] T026 [P] [US2] 新增 `frontend/src/components/chat/McpStatusList.spec.ts`：有服务时逐项渲染且 `key` 用服务名、空数组时不渲染、`aria-label` 正确
- [X] T027 [US2] 修改 `frontend/src/components/chat/AgentSummary.vue`：移除 `mcpServers` 职责，只保留名称 / "请选择数字人"提示（MUST 与 T025 + T029 同批提交，否则 MCP 状态会短暂从界面消失）
- [X] T028 [US2] 新增 `frontend/src/components/chat/AgentSummary.spec.ts`：有名称 / 未选中两态、不再出现 MCP 列表容器
- [X] T029 [US2] 修改 `frontend/src/components/chat/ChatHeader.vue`：左侧改纵向两段（第一行切换按钮 + 名称，第二行 `McpStatusList`），状态行左内边距为 0（与 T027 同批提交）
- [X] T030 [US2] 新增 `frontend/src/components/chat/ChatHeader.spec.ts`：结构断言（状态行与身份行同一容器、无额外左缩进）、**渲染顺序断言（切换 → 名称 → MCP 状态，对应 FR-002）**、未选中数字人时不渲染状态行、长名称与多服务不破坏结构、右侧动作位仍在
- [X] T031 [US2] 跑 US2 相关门禁并修复：`cd frontend && npm run test -- ChatHeader AgentSummary McpStatusList McpStatusItem`
- [ ] T032 [US2] 按 `quickstart.md` §4 在浏览器 DevTools 实测 1280 / 1440 / 1920 三档对齐偏差 ≤ 1px，并把结论回填到本任务备注

**检查点**：对齐改动与 US1 无耦合，可单独合并。

---

## Phase 5: 收尾与跨切面

- [X] T033 契约四处一致性复核：`specs/014-chat-onboarding-hint/contracts/workspace-dir-predefined.md`、`specs/001-digital-human-platform/contracts/runtime-api-delta.md`、`frontend/src/api/types.ts`、`agent-backend/src/domain/workspace-view.ts` 字段名与必填性完全一致
- [X] T034 行数与分层复核：`frontend/src/components/chat/ChatPanel.vue`、`frontend/src/composables/useChatPanel.ts`、`agent-backend/src/domain/workspace-view.ts` 均 ≤ 500 行；新增纯函数无重复实现
- [ ] T035 全量门禁：`cd frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build`；`cd agent-backend && npm run typecheck && npm run lint && npm run test:all && npm run build`（`npm run test` 仅单测，不覆盖端点集成，**不得**替代 `test:all`）
- [ ] T036 按 `quickstart.md` 手工执行 S1~S7、无障碍抽查与接口核验，将结果回填备注
- [X] T037 在 `specs/014-chat-onboarding-hint/tasks.md` 勾选完成任务，并回写任何与规格不一致的行为（含修订日期）

---

## 依赖关系

```text
Phase 1 (T001, T002)
        │
        ▼
Phase 2 (T003 → T004 → T005 → T006/T007；T008 → T009；T010)
        │                                   │
        ├──────────────► Phase 3 US1 (T011~T024)
        │                                   │
        └──────────────► Phase 4 US2 (T025~T032)   ← 仅依赖 Phase 1，与 Phase 2 无关
                                            │
                                            ▼
                                  Phase 5 (T033~T037)
```

- **US1**：依赖 Phase 2（`predefined` 字段与前端类型）。
- **US2**：只依赖 Phase 1，可与 Phase 2 并行开工。
- **Phase 5**：必须等 US1、US2 都完成。

### 每个用户故事内部的顺序

- 测试先行（T011~T015 / T026、T028、T030）→ 实现 → 该故事独立门禁 → 检查点。
- 同一文件不并行：`ChatPanel.vue`（T022/T023）、`useAppSession.ts`（T018/T015）各自串行。
- **US2 同批约束**：T025 + T027 + T029 必须同批落地——T027 单独提交会出现"旧渲染已移除、新组件尚未接入"的中间态，MCP 状态短暂消失。

---

## 并行示例

### US1 测试并行（T011~T014 同时开）

```text
任务 A：编写 frontend/src/utils/empty-data-hint.spec.ts
任务 B：编写 frontend/src/composables/useEmptyDataHint.spec.ts
任务 C：编写 frontend/src/components/chat/UploadHintBubble.spec.ts
任务 D：编写 frontend/src/components/chat/ComposerToolbar.spec.ts
```

### US2 组件并行（T025/T026 与 T027/T028 互不冲突）

```text
任务 A：新增 frontend/src/components/chat/McpStatusList.vue + McpStatusList.spec.ts
任务 B：精简 frontend/src/components/chat/AgentSummary.vue + 新增 AgentSummary.spec.ts
```

### Phase 2 后端并行（T003 之后）

```text
任务 A：agent-backend/tests/unit/workspace-view.spec.ts
任务 B：frontend/src/api/types.ts
```

---

## 实施策略

### MVP 优先（只做 US1）

1. Phase 1 → Phase 2（`predefined` 契约）→ Phase 3（US1）。
2. 用 `quickstart.md` S1~S7 独立验收，**先不碰头部**。
3. 交付后 US2 作为独立增量补齐。

### 增量交付

1. Phase 2 完成后，US1 与 US2 可并行开发。
2. 每个故事完成即跑该故事门禁（T024 / T031），不把问题攒到全量门禁。
3. Phase 5 做契约一致性、行数与全量门禁；任何未达标项不得标记完成。

### 并行人员分配

- 开发者 A：Phase 2 后端（T003~T007）+ US1 后端契约收尾（T010）。
- 开发者 B：US1 前端（T011~T024）。
- 开发者 C：US2（T025~T032），与 A/B 无文件冲突。

---

## 备注

- `[P]` 表示不同文件、无未完成依赖；`ChatPanel.vue` / `useAppSession.ts` / `useChatPanel.ts` 为串行热点。
- 行数红线：`frontend/src/composables/useChatPanel.ts` 现 488 行，只允许透传；`frontend/src/components/chat/ChatPanel.vue` 现 475 行，超 500 按 T022 的兜底拆分。
- 像素对齐无法自动化（jsdom 无布局），必须保留 T032 的人工测量结论。
- 测试与 lint 一律在宿主机本地执行，容器不参与。
- 本特性不新增依赖、不改部署语义；若实现中发现需要新增依赖，先回到 `research.md` 记录选型理由。

---

## 实施记录（2026-10-29）

**结论**：US1（空数据引导）与 US2（头部对齐）均已实现并通过自动化门禁；T032 / T035 / T036 因需要浏览器或受存量红灯影响，保持未勾选。

### 已落地改动

- 运行端：`dirs.ts` 新增 `PREDEFINED_DATA_PREP_DIRS` + `isPredefinedDataPrepDir`（唯一来源）；`rule-file.ts` 的 `RULES_SUBDIR` 改为派生；`workspace-view.ts` 目录项下发 `predefined`。
- 工作台：`api/types.ts` 增加 `predefined`；新增 `utils/empty-data-hint.ts`（文案常量 + 判定纯函数）、`composables/useEmptyDataHint.ts`（状态机）、`components/chat/UploadHintBubble.vue`、`components/chat/McpStatusList.vue`；`useAppSession` 在 `onSwitched` 内接入；`ComposerToolbar` 新增 `upload-hint` 插槽；`ChatPanel` 装配气泡；`AgentSummary` 移除 MCP 职责；`ChatHeader` 改为两行结构。
- 契约：`specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的 workspace 行已补充 `predefined`。

### 门禁结果

| 项 | 结果 |
|---|---|
| 前端测试 | 93 文件 / 1132 用例全绿 |
| 前端 lint / typecheck / build | 通过（构建 1.62s） |
| 前端覆盖率（全仓） | 语句 82.46% / 分支 79.67% |
| 新增模块覆盖率 | `empty-data-hint.ts` 100%；`useEmptyDataHint.ts` 语句 100% / 分支 88.88% |
| 后端 typecheck / lint / build | 通过 |
| 后端测试 | 排除 `tests/unit/next-actions.spec.ts` 后 71 文件 / 938 用例全绿 |

### 未完成项与原因

- **T032 / T036**：像素对齐与 S1~S7 的浏览器手工验收需要可视环境，本次未执行；接口侧已由集成测试覆盖 `predefined`，UI 结构由组件测试覆盖。请在本地浏览器按 `quickstart.md` 补测并回填。
- **T035**：后端全量门禁未全绿，唯一失败为 `tests/unit/next-actions.spec.ts > FR-009`，原因是工作区中 `agent-backend/src/domain/next-actions.ts` 的**既有未提交改动**（尾部指令删去"关联不到合适工具的建议不要输出"等条目）与测试断言不一致，属 007 特性的在途改动，**与 014 无关**；本特性未修改该文件，也未改动其测试。
