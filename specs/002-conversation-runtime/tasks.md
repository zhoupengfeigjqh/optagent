---
description: "任务清单：对话运行时 · 工具调用的折叠展示（2026-10-08 增量）"
---

# Tasks: 对话运行时 · 工具调用的折叠展示（2026-10-08 增量）

**Input**: [spec.md](./spec.md) §4.6（`TR-32`~`TR-36`）、§7.1（修订记录）、§9.1（验收清单）

**Prerequisites**: [spec.md](./spec.md)（必需）。本增量**不新增 `plan.md`**：改动面是前端展示层单点（3 个源文件 + 3 个测试文件 + 1 处覆盖率配置），
设计取舍已直接写入 `spec.md` §4.6 与下方「设计取舍」节，不存在跨层、跨契约的复杂度需要单独计划。

**Tests**: **本增量必须包含测试任务**。宪章**原则三（测试完备性，NON-NEGOTIABLE）**要求：前端每个组件 / composable / 纯函数模块
MUST 同名同目录测试，覆盖属性传递、事件触发、边界条件（空值 / 禁用态 / 超限 / 失败态）。测试任务**不可省略**。

**测试执行环境**: 全部在**宿主机本地**执行（宪章原则三）；容器**不参与**测试。

## Format: `[ID] [P?] Description`

- **[P]**：可并行（不同文件，且不依赖未完成的任务）
- 每条任务 MUST 含**确切文件路径**

## 设计取舍（对应宪章「治理 § 例外」的登记口径；**均非原则违反**）

| 取舍 | 必要性 | 被否决的更简方案 |
|---|---|---|
| 折叠态只汇总"报错数"，**不**汇总"截断 / 内容已清理" | 摘要行的职责是"一眼看出有没有出事"；把降级也堆上去会变成信息墙 | 全部汇总（信息过载，摘要行失去作用） |
| **只有 1 次**调用时不设折叠层 | 否则单工具从"1 次点击看结果"退化为 2 次（体验倒退） | 统一两层结构（更一致但更差） |
| 明细区含**全部 N 条**（最新那条在摘要行与明细里各呈现一次） | 摘要行 = 当下快照，明细 = 权威列表；若明细排除最新那条，它的结果将**永远打不开** | 明细只放 `n−1` 条（功能缺陷） |
| 查看态放**模块级单例**（`useToolPanels`）而非 session / props 下传 | 状态必须跨组件实例存续（交接时组件重建）；props 下传要动 4 个组件及其测试，而 `AppSession` 会让叶子组件的独立挂载测试全部需要会话注入 | 经 `ChatPanel` 逐层传 props（改动面 ×4）；放进 `AppSession`（叶子组件测试全部要注入会话） |

## Phase 1: 规格（宪章原则一：先规格后代码）

- [x] T001 回写 `specs/002-conversation-runtime/spec.md` §4.6：新增 `TR-32`~`TR-36`（计数与报错数常显 / 仅终态可展开 + `进行中·未完成` 分流 / ≥2 次折叠为一行摘要 / 明细全部且时间正序 / 查看态跨交接保持）
- [x] T002 回写 `specs/002-conversation-runtime/spec.md` §7.1 修订记录（`TR-15` 扩展、`TR-17` 分流口径）+ §8 宪章落实 + §9.1 验收清单
- [x] T003 新增本文件 `specs/002-conversation-runtime/tasks.md`

## Phase 2: 前端实现

- [x] T004 [P] `frontend/src/utils/tool-calls.ts`：新增纯函数 `summarizeToolCalls`（总数 + 报错数）、`toolGroupKey`（本轮分组的稳定键 = 首个 `call_id`）、`toolStatusLabel(status, live)`、`isToolCallFinished(status)`；以函数取代 `TOOL_STATUS_LABEL` 常量（文案唯一来源）
- [x] T005 [P] 新增 `frontend/src/composables/useToolPanels.ts`：页面级查看态（`panelOf` / `isDetailsOpen` / `setDetailsOpen` / `reset`），按 `call_id` 与分组键记忆（`TR-36`）
- [x] T006 `frontend/src/components/chat/ToolCallList.vue`：计数行（`本轮 N 次调用 · 报错 M 次`）+ 摘要行（整行一个按钮，≥2 次时）+ 明细区（全部 N 条、时间正序、每条可展开结果）+ 运行中不可展开（`disabled` 且无"展开"字样）
- [x] T007 `frontend/src/components/chat/MessageBubble.vue`：向 `ToolCallList` 传 `live`（= `streaming.phase === STREAMING`）
- [x] T008 `frontend/vite.config.ts`：把 `src/utils/tool-calls.ts`、`src/composables/useToolPanels.ts` 登记进模块覆盖率阈值清单（按实测值填注释），全局地板按实测上调（45/52/34/44 → 48/55/38/47）

## Phase 3: 测试（宪章原则三）

- [x] T009 [P] 新增 `frontend/src/utils/tool-calls.spec.ts`（14 例）：`summarizeToolCalls`（0 条 / 全成功 / 含失败 / `running` 不计失败）、`toolGroupKey`（空数组 / 取首个）、`toolStatusLabel`（终态 / `live` 与 `非 live` 的 `running`）、`isToolCallFinished`、契约映射与格式化
- [x] T010 [P] 新增 `frontend/src/composables/useToolPanels.spec.ts`（5 例）：`panelOf` 返回同一 reactive 对象（改 `loading` 能触发依赖更新）、明细态读写、`reset` 清空、单例
- [x] T011 `frontend/src/components/chat/ToolCallList.spec.ts`：改写 `running` 用例为"不可展开 / 历史显示未完成"，并新增折叠、明细、计数与报错数、`aria` 关联、id 唯一、单条不折叠、**卸载重挂载保持且不重复请求**等用例（共 22 例）；另在 `frontend/src/components/chat/MessageList.spec.ts` 补 2 例集成断言，覆盖 `MessageBubble` 那处 `:live` 绑定（该组件**无同名测试文件**，属存量缺口，故把保护网织在会挂载它的列表测试里）

## Phase 4: 门禁与验收（宪章原则八 + hard gate）

- [x] T012 [P] 测试与覆盖率门禁：`vitest run --coverage` → **33 文件 / 425 用例全绿**，模块阈值（`tool-calls.ts` 100/93.75/100/100、`useToolPanels.ts` 全 100）与上调后的全局地板（实测 49.70/56.76/39.95/48.53 ≥ 48/55/38/47）均通过
- [x] T013 [P] 硬门禁：改动/新增文件最大 **354 行**（≤500）；**无新增依赖**（`package.json` 未变）
- [x] T014 构建与冒烟：`vite build` 成功（3422 模块）；dev server 编译三个改动模块均 HTTP 200
- [ ] T015（**存量问题，非本次改动引入**）`npm run lint` 99 errors / 34 warnings、`npm run typecheck` 7 条 `TS6133`——全部落在本次**未改动**的文件里（`src/views/demo/*`、`src/views/datapage/*`、`src/router/index.ts`、`src/components/{data,expand-section,z-gantt,z-gantt-table,z-table}/**`）。本次改动的 7 个源文件单独 lint 与类型检查均为 **0 问题**。另：`npm run test:coverage` 在本机被 safe-delete 钩子阻断（无法清理既有 `coverage/` 目录），已用等价命令 `npx vitest run --coverage --coverage.reportsDirectory=.coverage-gate`（新目录，不触发清理）取得同一结论；`frontend/eslint.config.mjs` 已补 `coverage-*/**`、`.coverage-*/**` 忽略，使这些产物不再污染 lint 结论
