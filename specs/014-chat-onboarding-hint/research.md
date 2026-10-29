# 技术研究：聊天页头部对齐与空数据新手引导

**Feature**: `014-chat-onboarding-hint` | **Date**: 2026-10-29

本文件收敛实现前必须定调的 7 个决策。结论全部来自仓库现有实现与宪章约束，不引入新技术选型。

## D1. 「预定义目录」的判定放在哪一侧

**Decision**：由 `agent-backend` 在工作空间视图的目录项上下发只读字段 `predefined: boolean`，前端只消费该值。

**Rationale**：
- 宪章原则七明确「前端 MUST NOT 硬编码后端下发的业务常量（如目录集合）」。若前端写死 `算法规则`，就会造出第三处同步点（`admin-backend` 常量、运行端 `rule-file.ts`、前端常量），一次改名即出现静默错判。
- 运行端已有预定义目录的唯一事实源（`RULES_SUBDIR`），把它提升为 `PREDEFINED_DATA_PREP_DIRS` 并被装配层消费，成本仅一行字段。

**Alternatives considered**：
- 前端硬编码 `算法规则`：改动最小，但违反原则七，且与「同一职责只有一处实现」冲突，否决。
- 后端直接下发聚合布尔（如 `data_prep_empty`）：会把"引导文案与时机"的 UI 语义塞进运行端，且切换时机仍由前端掌握，反而增加跨侧耦合，否决。
- 新增独立端点返回引导状态：为一个布尔新增端点，违反"能用既有能力就不扩张"的取向，否决。

## D2. 前端如何认定「数据准备」空间

**Decision**：复用 `frontend/src/utils/space.ts` 的 `isFlatSpace`：非扁平空间即数据准备的形态；判定取其二级目录（`space.dirs`）。

**Rationale**：
- 前端现有代码从不硬编码空间名：`spaceSubDirs` / `spaceFileCount` 都按"扁平 / 非扁平"结构区分，`WorkspaceSpaceTree` 与 `@` 引用面板共用同一口径。
- 三空间里只有数据准备拥有多个二级目录，其余两空间的 `dirs` 恰为空间自身一项，结构判据在可预见范围内稳定。

**Alternatives considered**：
- 硬编码 `space.name === '数据准备'`：违反原则七（目录集合由后端下发），否决。
- 后端新增 `kind: 'data-prep' | 'flat'` 字段：能彻底消除推断，但本次收益不足，且与既有结构判定形成第二套口径，否决（若将来空间形态变化再升级）。

## D3. 引导的触发点

**Decision**：只在 `useAppSession` 的 `onSwitched` 回调里、`await workspace.load()` 之后调用一次判定。

**Rationale**：
- `onSwitched` 仅由 `useAgents.switchTo` 成功路径调用（失败已 `catch` 并 toast，不回调），天然满足"切换成功才判定"（FR-005）与"切换失败不判定"。
- 首次加载与刷新恢复走 `loadCurrent`，不经过 `onSwitched`，因此不会在页面打开时误弹。
- 此时机晚于 `workspace.load()`，清单已就绪，避免用上一个数字人的目录清空态误判（FR-006）。

**Alternatives considered**：
- `watch(currentAgent)`：初始化赋值同样会触发，需要额外"是否用户操作"标记，易回归，否决。
- 在 `AgentPanel` 的点击处判定：把编排分散到视图层，且绕过唯一装配层，否决。

## D4. 气泡的可见状态模型

**Decision**：`visible` 用显式 `ref`；`dismissed` 为内部标记；`onAgentSwitched` 先重置 `dismissed` 再判定；另用 `watch(workspace.spaces)` 在条件失效时自动隐藏。

**Rationale**：
- 若用 `computed(triggered && !dismissed && needsDataUpload(spaces))`：用户上传后又把文件删空，气泡会自动重现——这与"只有切换数字人才重新判定"（FR-005/FR-014）矛盾。
- 显式 `visible` 让"出现"只发生在切换后的那一次判定；"消失"有两个合法来源：用户关闭、条件失效。

**Alternatives considered**：
- 纯 `computed` 派生：实现更短但语义错误（见上），否决。
- 关闭状态落 `sessionStorage` / 后端：规格已明确只在当前页面会话内（假设章节），且跨刷新保留反而会让"切了数字人也不提示"更难排查，否决。

## D5. 气泡放在哪个组件里

**Decision**：`ComposerToolbar.vue` 提供具名插槽 `upload-hint`（左侧分组内），由 `ChatPanel.vue` 注入 `UploadHintBubble.vue`；关闭只上抛事件。

**Rationale**：
- 该组件头注释已声明"组件本身不持有业务状态：所有意图一律上抛"，插槽方式保持这条边界。
- 锚点就是「+」按钮所在的左侧分组，`position: relative` 即可让气泡贴住按钮；不需要在 `ChatPanel` 里做跨组件绝对定位计算。
- 气泡自身承担展示与关闭事件，可独立测试。

**Alternatives considered**：
- 在 `ChatPanel` 里用 `position: fixed` + 按钮 `getBoundingClientRect`：需要监听滚动/尺寸变化，复杂度与漂移风险都高，否决。
- 复用 `HintTip`（「?」按钮浮层）：其交互是"点击问号展开"，与本次"自动出现 + × 关闭"语义不同，强行改造会污染既有复用点，否决。

## D6. 头部对齐的实现方式

**Decision**：左侧容器改为纵向两段——第一行（切换按钮 + 名称），第二行（MCP 状态列表，占满容器宽度）。`AgentSummary` 拆出 `McpStatusList`。

**Rationale**：
- 现状把状态列表嵌在名称下方，起点被按钮宽度推右，因此无论怎么调 `gap` 都无法与按钮左对齐。
- 拆成独立行后，左边缘＝容器起点＝按钮左边缘，且 `flex-start` 语义不变，长名称换行也不影响。
- 信息顺序仍是"切换 → 名称 → 状态"，符合 FR-002。

**Alternatives considered**：
- 把按钮上移、名称与状态都放到按钮下方（整列堆叠）：同样能对齐，但改变了"切换 + 名称"并排的既有手感，头部高度增长更多，否决。
- 保持 DOM 不动、仅给状态列表负 `margin` 拉回：等于用魔法数字抵消按钮宽度，名称变长或字号变化即失效，否决。

## D7. 后端是否需要新增接口 / 是否影响部署

**Decision**：不新增接口、不改 `scenario.json` 结构、不改部署语义；只扩展 `GET /api/files/workspace` 的响应字段。

**Rationale**：
- 该端点已返回三空间树与目录级 `upload_extensions`，条件一、条件二所需信息（目录清单 + 文件清单 + 预定义标记）齐备。
- `predefined` 由运行端根据既有常量派生，不依赖部署产物变化；平台侧无需改动，符合"平台是配置唯一权威源，部署为整体覆盖"的既有语义。

**Alternatives considered**：
- 把预定义标记写进 `scenario.json`：会改变部署产物与平台侧 schema，且预定义是平台硬编码、不该由场景文档承载，否决。
- 前端自行按 `admin` 配置推断：前端拿不到设计态数据，否决。
