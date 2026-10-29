# 实施计划：聊天页头部对齐与空数据新手引导

**Branch**: `014-chat-onboarding-hint` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: 需求规格 `specs/014-chat-onboarding-hint/spec.md`

## 摘要

两个可独立交付的增量：

1. **头部左对齐**：把「MCP 服务连接状态」从数字人名称的附属列中拆出，改为头部左侧第二行，使其左边缘与「切换」按钮的左边缘落在同一条垂直基准线上。
2. **空数据新手引导**：用户成功切换数字人、且新数字人的「数据准备」下所有非预定义二级目录均为空时，在上传入口「+」上弹出引导气泡，可关闭，关闭后直到下一次切换数字人才重新判定。

技术取向：**以 `frontend` 为主**；`agent-backend` 只做一处**只读字段扩展**——工作空间视图的目录项增加 `predefined` 布尔标记。理由是「预定义目录」属于平台业务常量，前端 MUST NOT 硬编码（宪章原则七），必须由接口下发。除此之外不新增接口、不新增存储、不新增依赖。

## 技术上下文

**Language/Version**：TypeScript 6 / Vue 3（`<script setup>`）/ Node ≥ 20（后端运行）

**Primary Dependencies**：`frontend` = Vue 3 + Vite + Vitest（jsdom）；`agent-backend` = Fastify 5 + Vitest。**不新增任何依赖**

**Storage**：不新增持久化。气泡关闭状态仅存活于当前页面会话的内存中；文件空间仍读取 `agent-backend/.opt-agent/users/{uid}/user-data/{agent}/`

**Testing**：两端均为 Vitest 5；前端组件测试用 jsdom，后端端点断言用 Fastify `inject`

**Target Platform**：桌面浏览器（内网工作台），不需要移动端适配

**Project Type**：Web 前后端一体（`frontend` ↔ `agent-backend`）

**Performance Goals**：判定是 O(二级目录数) 的同步纯计算，单次远小于 1ms；切换后 1 秒内可见（SC-001）；**不新增任何网络请求**

**Constraints**：单文件 ≤ 500 行；前端不硬编码业务常量；气泡不阻断「+」；键盘与读屏可用；动效遵循 `prefers-reduced-motion`

**Scale/Scope**：三空间；每数字人二级目录量级为 10；本次改动约前端 11 个、后端 3 个源文件 + 对应测试

## 宪章检查

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

| 原则 | 结论 | 依据 |
|---|---|---|
| 一、中文文档与规格驱动 | 通过 | spec/plan/research/data-model/contracts/quickstart 全部中文；本特性按「规格 → 计划 → 任务」推进 |
| 二、代码质量与模块化（≤500 行） | 通过（有预算风险，见「风险」） | 纯函数独立为 `utils/empty-data-hint.ts`；状态抽 `useEmptyDataHint`；`AgentSummary` 拆分出 `McpStatusList` 单一职责 |
| 三、测试完备性 | 通过 | 新增组件/composable/纯函数均配同名测试；后端新增 `workspace-view` 单测并在集成测试中断言新字段；新增模块覆盖率 ≥ 80% |
| 四、无障碍与可用性 | 通过 | 气泡用 `role="status"`，关闭按钮为原生 `<button>` + `aria-label`，键盘可达；动效按系统偏好降级；状态不只靠颜色 |
| 五、性能与数据一致性 | 通过 | 判定为纯计算、无请求、无 N+1；不写盘，不存在部分提交 |
| 六、技术治理与依赖控制 | 通过 | 零新增依赖 |
| 七、接口契约与前后端一致性 | 通过 | `predefined` 字段在契约文档、前端类型、后端装配、两侧测试四处同步；前端消费下发值，不硬编码目录名 |
| 八、测试与部署简单可控 | 通过 | 沿用既有 `npm run lint / typecheck / test(:coverage) / build`，不新增脚本 |
| 九、优雅降级与故障可观测 | 通过 | 清单加载失败 / 场景未配置 / 切换失败 → 不弹气泡且不改写既有错误提示；不新增重试，不遮盖原始错误 |

**Gate 结论**：无违反项，无需在「复杂度跟踪」登记例外。

## 方案要点

### 1. 预定义标记由后端下发（跨侧唯一契约改动）

- `agent-backend/src/domain/workspace-view.ts` 的目录项增加 `predefined: boolean`：
  - 数据准备二级目录：属于平台预定义目录（当前仅 `算法规则`）→ `true`，其余管理员配置目录 → `false`；
  - 共享空间 / 临时空间（空间自身即目录）→ `false`。
- 预定义目录清单在运行端只保留**一处定义**：`domain/dirs.ts` 导出 `PREDEFINED_DATA_PREP_DIRS`，`rule-file.ts` 的 `RULES_SUBDIR` 由它派生（既有导入路径不变），`workspace-view.ts` 只消费该常量。
- 前端 `api/types.ts` 的 `WorkspaceDir` 增加同名必填字段；所有测试夹具同步补齐。

### 2. 「数据准备」空间的识别

前端不硬编码 `数据准备` 字符串：沿用 `utils/space.ts` 的唯一结构判定 `isFlatSpace(space)`——数据准备是唯一「二级目录清单」空间（`dirs` 含多个子目录），共享/临时空间是扁平空间（`dirs` 仅含空间自身）。判定输入取 `workspace.spaces` 中所有非扁平空间的二级目录。

### 3. 判定纯函数

新增 `frontend/src/utils/empty-data-hint.ts`：

- `EMPTY_DATA_HINT_TEXT`：固定文案常量（FR-019）；
- `needsDataUpload(spaces)`：
  1. 取所有非扁平空间的二级目录，过滤掉 `predefined === true`；
  2. 过滤后为空 → `false`（只有预定义目录，FR-009）；
  3. 否则「每个目录的 `files` 均为空」→ `true`，任一目录有文件 → `false`。

### 4. 触发点与状态模型

新增 `frontend/src/composables/useEmptyDataHint.ts`：

- 状态：`visible`（显式 `ref`）、`dismissed`（内部标记）；
- `onAgentSwitched()`：`dismissed = false` → 重新判定（由 `useAppSession` 的 `onSwitched` 在 `await workspace.load()` 之后调用）；
- `dismiss()`：`dismissed = true`、`visible = false`；
- `watch(workspace.spaces)`：`visible` 为真且判定变为不成立（例如上传成功后 `registerFile` 就地登记）→ 自动隐藏（FR-015）。

**为什么用显式 `visible` 而不是 `computed = triggered && !dismissed && needsDataUpload()`**：后者在"用户上传后又把文件删空"时会自动重现气泡，违反 FR-005/FR-014「只有切换数字人才重新判定」。显式状态让"出现"只发生在切换后的那一次判定。

**为什么挂在 `onSwitched` 而不是 `watch(currentAgent)`**：`onSwitched` 只在 `switchTo` 成功后触发（失败路径不调用）；`loadCurrent`（首次加载 / 刷新恢复）不走它，天然满足 FR-005。

### 5. 头部布局

- `ChatHeader.vue` 左侧改为纵向两段：
  1. 第一行：`切换` 按钮 + 数字人名称 / "请选择数字人"提示（`AgentSummary` 只保留身份信息）；
  2. 第二行：MCP 状态列表（新组件 `McpStatusList.vue`），占满左侧容器宽度，`padding`/`margin` 归零，左边缘即容器起点＝切换按钮左边缘。
- `AgentSummary.vue` 移除 `mcpServers` 职责（当前仅 `ChatHeader` 使用）；`McpStatusList.vue` 承接 `ul[aria-label="MCP 服务状态"]` 与 `McpStatusItem` 列表。
- 未选中数字人时 `McpStatusList` 不渲染（FR-004）。

**为什么不把 `切换` 按钮整体上移、名称与状态都放到按钮下方**：那会改变"切换 + 名称"这一既有阅读顺序与按钮位置（用户已形成的手感），且头部高度增长更多。当前方案只移动状态行，信息顺序（切换 → 名称 → 状态）不变。

### 6. 气泡承载与交互

- `ComposerToolbar.vue` 在「+」所在的左侧分组内新增具名插槽 `upload-hint`，左侧分组设 `position: relative` 作为锚点；组件仍**不持有业务状态**（是否显示由上层决定，关闭只上抛事件）。
- 新增 `UploadHintBubble.vue`：绝对定位在「+」上方（`bottom: calc(100% + 8px)`，`left: 0`），`max-width` 收敛且允许换行；右上角关闭按钮 `aria-label="关闭提示"`；根节点 `role="status"`；`prefers-reduced-motion` 下不加动效。
- `ChatPanel.vue` 在 `ComposerToolbar` 的 `upload-hint` 插槽内条件渲染气泡，并把 `close` 接到 `emptyHint.dismiss()`。

## 项目结构

### 文档（本特性）

```text
specs/014-chat-onboarding-hint/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── workspace-dir-predefined.md
│   └── onboarding-hint-ui.md
└── checklists/requirements.md
```

### 源码（改动的真实路径）

```text
agent-backend/
├── src/domain/
│   ├── dirs.ts                    # 新增 PREDEFINED_DATA_PREP_DIRS（唯一来源）
│   ├── rule-file.ts               # RULES_SUBDIR 改为由上述常量派生
│   └── workspace-view.ts          # 目录项新增 predefined
└── tests/
    ├── unit/workspace-view.spec.ts        # 新增
    └── integration/files-scenario.spec.ts # 断言 predefined

frontend/
├── src/
│   ├── api/types.ts                     # WorkspaceDir.predefined
│   ├── utils/
│   │   ├── empty-data-hint.ts           # 新增：文案常量 + needsDataUpload
│   │   └── empty-data-hint.spec.ts      # 新增
│   ├── composables/
│   │   ├── useEmptyDataHint.ts          # 新增：状态机
│   │   ├── useEmptyDataHint.spec.ts     # 新增
│   │   ├── useAppSession.ts             # onSwitched 内接入；AppSession 增加 emptyHint
│   │   └── useChatPanel.ts              # 仅透传 emptyHint（不再加业务逻辑）
│   └── components/chat/
│       ├── ChatHeader.vue               # 左侧两行结构
│       ├── ChatHeader.spec.ts           # 新增（现存无测试，改动文件须合规）
│       ├── AgentSummary.vue             # 移除 MCP 职责
│       ├── AgentSummary.spec.ts         # 新增
│       ├── McpStatusList.vue            # 新增
│       ├── McpStatusList.spec.ts        # 新增
│       ├── ComposerToolbar.vue          # upload-hint 插槽
│       ├── ComposerToolbar.spec.ts      # 新增
│       ├── UploadHintBubble.vue         # 新增
│       ├── UploadHintBubble.spec.ts     # 新增
│       ├── ChatPanel.vue                # 插槽装配
│       └── ChatComposerArea.vue         # 条件产物：仅 ChatPanel 超 500 行时创建（拆分不改行为）
└── （其余受 WorkspaceDir 类型影响测试夹具：useWorkspace / useUploadPanel / space / UploadMenu /
     useFileMention / InteractionDialog.mention / InteractionControl 的 spec 补 predefined 字段）
```

**结构决策**：沿用既有四侧分层（`components` → `composables` → `api`，`utils` 为纯函数）。不新建目录、不新增依赖、不动管理端。

## 契约同步清单（宪章原则七的「四处同步」）

| 位置 | 改动 |
|---|---|
| 契约文档 | 新增 `contracts/workspace-dir-predefined.md`；实现时同步更新 `specs/001-digital-human-platform/contracts/runtime-api-delta.md` 的 workspace 响应说明 |
| 前端类型 | `frontend/src/api/types.ts` 的 `WorkspaceDir.predefined` |
| 后端装配 | `agent-backend/src/domain/workspace-view.ts` |
| 测试 | 后端单测 + 集成断言；前端夹具与判定测试 |

## 质量门禁

- `frontend`：`npm run lint`、`npm run typecheck`、`npm run test:coverage`（新模块 ≥ 80%）、`npm run build`
- `agent-backend`：`npm run typecheck`、`npm run lint`、`npm run test:all`（单测 + 端点集成；`npm run test` 只跑单测，**不得**作为门禁）、`npm run build`
- 手工验收：按 `quickstart.md` 的 S1~S7 逐项执行；像素对齐用浏览器 DevTools 测量（自动化只能断言 DOM 结构，无法测像素）
- 全部门禁在宿主机本地执行（容器不参与测试）

## 风险与行数预算

| 风险 | 现状 | 处置 |
|---|---|---|
| `ChatPanel.vue` 接近 500 行 | 475 行 | 本次预计 +8~12 行；若超 500，把输入区装配抽成 `ChatComposerArea.vue`（条件产物，见项目结构树；拆分不改行为） |
| `useChatPanel.ts` 接近 500 行 | 488 行 | **不在其中新增逻辑**，只透传 `emptyHint`（1 行） |
| 新增必填字段波及测试夹具 | 7 个前端 spec 含 `upload_extensions` 夹具（另 1 处为 `api/types.ts` 类型定义） | 一次性补齐 `predefined`，统一取 `false`（夹具不模拟预定义目录），新增判定测试单独构造 |
| 存量组件无测试 | `ChatHeader` / `AgentSummary` / `ComposerToolbar` 现存无 spec | 属"改动文件须满足宪章"的范围，补同名测试；不发起存量补齐专项 |
| 对齐只能人工量像素 | jsdom 无布局 | 自动化断言 DOM 结构（状态行与身份行同容器、左内边距为 0）；像素核验写入手工验收 |

## 复杂度跟踪

无宪章违反项，无需登记例外。上述行数预算与契约同步风险已在本节与「质量门禁」中说明。
