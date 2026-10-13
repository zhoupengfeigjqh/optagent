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

---

# Tasks: 对话运行时 · 产出正文的视图链接（2026-10-10 增量）

**Input**: [spec.md](./spec.md) §4.7（`TR-40`~`TR-43`）、§7.2、§9.2；[plan.md](./plan.md)

**范围**: **仅异步产出（铃铛）**；同步对话内入口本次不做。

**Prerequisites**: [spec.md](./spec.md) 与 [plan.md](./plan.md)（本次**新增** `plan.md`：承载 Complexity Tracking、平台差异登记，以及宪章 2.0.2 待办要求的"存量模块补测顺序与范围"结论）。

**Tests**: 本增量必须包含测试任务（宪章原则三）。测试全部在**宿主机本地**执行，容器不参与。

## 设计取舍（对应宪章「治理 § 例外」的登记口径；**均非原则违反**）

| 取舍 | 必要性 | 被否决的更简方案 |
|---|---|---|
| 只按**字段名**判定（不看值像不像 URL） | 避免把正文里任何形如 `/api/…` 的普通字段误链接化 | 按值形态判定（误报率高，且用户无法预期） |
| 值非法时**按普通文本**渲染、不额外提示 | 界面展示的是正文原文，信息完整；属"形态不匹配"而非降级（见 `plan.md` §3 原则九判定） | 加"链接不可用"禁用态（多一套状态与文案，收益低） |
| 前缀补**当前页面入口**（`window.location.origin`） | 同一份代码适配开发/生产/换域名/HTTPS | 写死 `ip:端口`（换环境即失效） |
| 正文 >256K 字符不做定向提取 | 与既有"结构化展示"同一判据，避免两个解析口径 | 启发式定位字段（复杂且易误判） |

## Phase 1: 规格（宪章原则一：先规格后代码）

- [x] T016 回写 `specs/002-conversation-runtime/spec.md`：§3 术语（视图链接 / 归一化）、新增 §4.7（`TR-40`~`TR-43` + 明确不做 + 原则九判定）、§7.2 修订记录、§8 宪章落实、§9.2 验收清单
- [x] T017 新增 `specs/002-conversation-runtime/plan.md`：技术方案 / 文件清单 / Complexity Tracking（含被否决的替代与已知限制）/ 平台差异登记 / **宪章 2.0.2 待办的补测顺序与范围结论**
- [x] T018 回写本文件（`tasks.md`）本次增量任务
- [x] T019 回写 `异步MCP服务接入约定.md` §4.7：`viewUrl` 字段名与值形态（根相对路径或完整 `http(s)`，其余形态不链接化）

## Phase 2: 前端实现

- [x] T020 新增 `frontend/src/utils/view-link.ts`（68 行）：`VIEW_URL_FIELD` / `isViewUrlField()` / `resolveViewUrl(value, origin?)`（已带前缀原样；单个 `/` 开头拼当前入口；`//`、其它 scheme、无前导 `/`、控制字符或反斜杠 → `null`）。控制字符判定用显式码点（`hasControlOrBackslash`）而非正则：避免 `no-control-regex` 规则、也无需禁用规则
- [x] T021 `frontend/src/components/chat/ProducedJsonView.vue`（298 行）：新增 `fieldKey` 属性（对象行传键、表格单元格传列名）+ 链接分支（原生 `<a>`，`target="_blank"` + `rel="noopener noreferrer"`，文本 = 值本身，**分支排在纯标量之前**）+ `.produced-json__link` 样式（链接色 + 下划线，双通道）

## Phase 3: 测试（宪章原则三）

- [x] T022 [P] 新增 `frontend/src/utils/view-link.spec.ts`（94 行 / 20 例）：已带前缀（含协议大小写）**不被拼接** / 根相对路径拼出 `origin`（断言 `URL.origin` 相等）/ query 与 fragment / 中文路径编码 / 首尾空白 / 未注入 origin 时取当前入口 / 八类拒绝形态 / 非字符串 / 非法 origin / 字段名匹配与不匹配
- [x] T023 `frontend/src/components/chat/ProducedJsonView.spec.ts`（199 行，追加 11 例）：对象行 / 嵌套 / 表格单元格 / 已带前缀原样 / 大小写字段名 / 非法值（`//`、无前导 `/`、`javascript:`）不链接化 / 非字符串值不链接化 / 非 `viewUrl` 字段不误链接 / 无 `viewUrl` 时回归不变

## Phase 4: 门禁与验收（宪章原则八 + hard gate）

- [x] T024 [P] `frontend/vite.config.ts`：`src/utils/view-link.ts` 登记进模块覆盖率阈值清单（80%）
- [x] T025 [P] 测试与覆盖率：`npx vitest run --coverage --coverage.reportsDirectory=.coverage-gate` → **35 文件 / 478 用例全绿**；`view-link.ts` 96.29 / 89.65 / 100 / 100；全局地板实测 50.66 / 57.93 / 41.09 / 49.43 ≥ 48 / 55 / 38 / 47（地板未下调）
- [x] T026 硬门禁：改动/新增文件最大 **298 行**（≤500）；**无新增依赖**（`package.json` 未变）
- [x] T027 `lint` / `typecheck` / `build`：本次 5 个改动文件 `eslint` **0 问题**；`npx vite build` 退出码 0；`vue-tsc` 仅剩**存量**报错（`src/router/index.ts`、`src/views/datapage/*`、`src/views/demo/*`，非本次改动文件，沿用 T015 口径）

---

# Tasks: 对话运行时 · 同步侧视图入口（2026-10-10 增量 #2）

**Input**: [spec.md](./spec.md) §4.8（`TR-44`~`TR-48`）、§7.3、§9.3；[plan.md](./plan.md) §8~§12

**范围**：**同步工具结果**（聊天区的工具卡片）里的 `viewUrl` → 回答正文之后的入口行；另含**工具结果正文的结构化展示**（同属"让工具结果可读"，一并交付）。**异步产出（铃铛）链路不改**（§4.7 语义保持）。

**Prerequisites**: [spec.md](./spec.md) 与 [plan.md](./plan.md)（**续写在同一文件**的 §8~§12，理由见该节：与上一增量同源、共用"归一化唯一实现"）。

**Tests**: 必须包含测试任务（宪章原则三）。测试全部在**宿主机本地**执行，容器不参与。

## 设计取舍（对应宪章「治理 § 例外」的登记口径；**均非原则违反**）

| 取舍 | 必要性 | 被否决的更简方案 |
|---|---|---|
| sidecar 存 `tool-events.jsonl` 行（与正文分离） | 正文外置时入口仍可用；不挤占回灌预算 | 只在前端解析正文（正文 >64KB 外置后**拿不到值**——正是本次要解决的问题） |
| 后端只做"形态卫生"，scheme 合法性只在前端判 | 单一漂移点（`TR-42`） | 后端也判一遍（前端改规则后，记录里还留着按老规则挑出的值） |
| 名称缺省 = 显示地址，不推断、不编号 | 不假装有名字（原则九）；地址永远可核对 | 从 URL 末段取名 / 「视图 1/2」占位（顺序一漂就变假） |
| 入口行放正文之后、操作区之前 | 它是"正文的附件"，不是"对消息的操作" | 并入 `MessageActions`（语义错位） |
| 结构化展示复用 `ProducedJsonView` + `parseProducedContent` | 零新增解析实现与第二套上限 | 为工具结果另写一套 JSON 渲染 |
| `raw`（原文切换）与查看态同放 `useToolPanels` | 不随流式→历史交接丢失（与 `TR-36` 同口径） | 组件内 `ref`（交接时组件重建即丢） |

## Phase 1: 规格（宪章原则一：先规格后代码）

- [x] T028 回写 `spec.md`：§3 术语（视图入口 / 视图链接名称）、新增 §4.8（`TR-44`~`TR-48` + 明确不做）、§4.7 交叉标注、§5.1 示例（`view_links`）、§5.3 参数表（7 项新增上限）、§6 契约（`tool_calls[].view_links` + `ViewLink`）、§7.3 修订记录、§8 宪章落实、§9.3 验收清单
- [x] T029 回写 `异步MCP服务接入约定.md`（§4.7 新增 `viewUrlName` 与平台"搬运 / 抽 sidecar"行为、§4.3 例外标注、尾部说明与规格依据）+ `plan.md` 续写 §8~§12
- [x] T030 回写本文件本次增量任务

## Phase 2: 后端实现

- [x] T031 新增 `agent-backend/src/domain/view-links.ts`（175 行）：`extractViewLinks()`（判据与顺序见 §4.8 `TR-44`：解析字符上限 / 深度上限 / **同层**名称配对 / 形态卫生 / 按地址原值去重 / 条数上限）、`VIEW_LINK_*` 与 `VIEW_URL_*` 限额常量、`ViewLink` 类型
- [x] T032 `agent-backend/src/domain/tool-events.ts`：终态行写入 `view_links`（**与体积分流无关**：内联与外置两条路径都先抽取）；`parseViewLinks()` 白名单结构校验；`ToolCallRecord.viewLinks` 对外
- [x] T033 `agent-backend/src/routes/threads.ts`：`toolCallJson()` 下发 `view_links`（仅非空时下发；**仍不下发路径**）

## Phase 3: 前端实现

- [x] T034 `frontend/src/utils/view-link.ts`：`VIEW_LINK_DISPLAY_MAX` / `VIEW_LINK_ADDRESS_MAX_CHARS`、`toViewLinkEntries()`（归一化 + 按 `href` 去重 + 名称取首个非空值）、`viewLinkLabel()` / `viewLinkTitle()` / `truncateMiddle()`（中段省略）
- [x] T035 `frontend/src/utils/tool-calls.ts`：`ToolCallItem.viewLinks` 透传 + `collectToolViewLinks()`（本条回答**全部**调用的并集；**不去重、不归一化**——那是 `view-link.ts` 的唯一职责）
- [x] T036 新增 `frontend/src/components/chat/MessageViewLinks.vue`（146 行）：入口行（原生 `<a href>` + `target="_blank"` + `rel="noopener noreferrer"`；前 3 条 + 「另有 N 个」/「收起」；**空态整行不渲染**）
- [x] T037 `frontend/src/components/chat/MessageBubble.vue`：在 `MessageContent` 之后、状态提示与 `MessageActions` **之前**挂载入口行（`viewLinks` 走 `computed`）
- [x] T038 `frontend/src/api/types.ts`：新增 `ViewLink` 与 `ToolCallRecord.view_links?`（与后端 `toolCallJson` **同批**，宪章原则七）
- [x] T039 `frontend/src/components/chat/ToolCallList.vue` + `frontend/src/composables/useToolPanels.ts`：结果正文**结构化展示**（复用 `ProducedJsonView` + `parseProducedContent`，只解析**已展开**的卡片）+ 「按原始 JSON 查看 / 按结构化查看」切换（`raw` 与查看态同放，故不随交接丢失）

## Phase 4: 测试（宪章原则三）

- [x] T040 [P] 新增 `agent-backend/tests/unit/view-links.spec.ts`（21 例）：层级与结构、同层名称配对（跨层视同没给）、地址与名称两类脏值的**不同**处置（丢名字保地址）、去重与名称补齐、三条上限、全失败路径返回 `undefined`
- [x] T041 `agent-backend/tests/unit/tool-events.spec.ts`（+5 例）：`view_links` 成对落盘、**正文外置时 sidecar 仍在**（`content` 缺席而 `viewLinks` 有值）、无链接不写字段、混入非法项只留合法项、全非法整段丢弃
- [x] T042 [P] `frontend/src/utils/view-link.spec.ts`（+14 例：`toViewLinkEntries` 8 + 入口文案 3 + `truncateMiddle` 3）、`frontend/src/utils/tool-calls.spec.ts`（+5 例：透传 / 不写空数组 / 并集顺序 / 流式空数组 / 无调用空数组）、`frontend/src/composables/useToolPanels.spec.ts`（断言补 `raw`）、`frontend/src/components/chat/ToolCallList.spec.ts`（+5 例：结构化展示与原文切换）
- [x] T043 [P] 新增 `frontend/src/components/chat/MessageViewLinks.spec.ts`（12 例：空态 2 / 归一化与去重 3 / 文案 3 / 上限与溢出 3 / 交互 1）与 `frontend/src/components/chat/MessageBubble.viewLinks.spec.ts`（5 例：落点 DOM 顺序、无 `view_links` 时无入口且工具卡片照常、多调用并集去重、与工具卡片并存、用户消息无入口）

## Phase 5: 门禁与验收（宪章原则八 + hard gate）

- [x] T044 [P] `agent-backend/vitest.config.ts`：`src/domain/view-links.ts` 登记进模块覆盖率阈值清单（80%）
- [x] T045 测试与覆盖率：后端 **39 文件 / 497 用例全绿**（`view-links.ts` 100 / 97.91 / 100 / 100；`tool-events.ts` 91.46 / 90.65 / 84 / 90.37）；前端 **37 文件 / 519 用例全绿**（较上一版 +2 文件 / +41 例；`view-link.ts` 98.11 / 94.33 / 100 / 100、`tool-calls.ts` 100 / 94.44 / 100 / 100、`useToolPanels.ts` 全 100；全局地板实测 51.39 / 58.93 / 41.82 / 50.13 ≥ 48 / 55 / 38 / 47，**未下调**）
- [x] T046 硬门禁：源码与测试文件最大 **436 行**（`frontend/src/components/chat/ToolCallList.spec.ts` 与 `agent-backend/src/domain/tool-events.ts`，均 ≤500）；本次新增源文件 `view-links.ts` 175 行 / `MessageViewLinks.vue` 146 行；**无新增依赖**（两侧 `package.json` 未变）
- [x] T047 静态检查与构建：本次改动文件 `eslint` 两侧 **0 问题**；`tsc --noEmit` 退出码 0；`npx vite build` 退出码 0；`vue-tsc` 仅剩 **11 条存量报错**（`src/router/index.ts`、`src/views/datapage/task-result.vue`、`src/views/demo/**`，均非本次改动文件）
- [ ] T048（**存量问题，非本次引入**）`npm run lint` / `npm run typecheck` 全绿——沿用 T015 口径（本次改动文件单独检查为 0 问题）
- [x] T049 `docs/viewurl-chat-demo.html`（1093 行）：入口行**落点与观感**的独立静态演示页（双击即开、不接任何接口、**不参与构建与门禁**）。注意其中字段名是设计期的 `view_urls`，**以 `spec.md` §4.8 的 `view_links` 为准**（演示页不随代码变更同步修订）
- [x] T050 `README.md` §6（把 MCP 服务接入数字人）末尾补一段面向**服务作者**的说明：**需要链接跳转时，请在工具返回里加上 `viewUrl` / `viewUrlName` 字段**（含前提"正文须是合法 JSON 对象/数组"与指向 `异步MCP服务接入约定.md` §4.7 / `spec.md` §4.8 的依据链接）
- [x] T051 `README.md` 新增顶层章节 **`## MCP 服务配置详解`**（置于「功能模块说明」之后、「环境要求」之前）：权威源与流转（`mcp-services.json` → 设计态只存服务名 → 物化 `MCP.json`）／字段总表（12 字段的必填、取值域、判据）／各字段要点（`transport` 无状态、`headers` 掩码与全量替换、`allowed_tools` 创建后锁定、`file_args` 两种模式与路径语法、`confirmation` 写操作应 `always`、`rules_fields` 不改变 HITL、`async_tools`）／`MCP.json` 结构示例（非空才写）／运行端默认参数（前缀、白名单、状态机、退避 5-15-30-60-60s + 保活 120s、探针 60s、超时 60s）／平台接口与错误码表／常见故障对照；并在 §6 末尾加双向指引

---

# Tasks: 对话运行时 · MCP 工具结果文本口径（2026-10-12 增量）

**Input**: [spec.md](./spec.md) §4.9（`TR-49`~`TR-52`）、§5.1、§7.4、§9.4；[plan.md](./plan.md) §13~§16

**范围**：**MCP 工具成功结果的结果文本口径**（模型可见 + 落盘）——业务正文不再被整体序列化进信封；含 `viewUrl` 抽取失效的历史记录**一次性回填**与一个门禁脚本补齐。**前端、契约、端点、SSE 零改动。**

**Prerequisites**: [spec.md](./spec.md) 与 [plan.md](./plan.md)（**续写在同一文件**的 §13~§16，理由：与 §4.8 同源——同一份 `viewUrl` 抽取链路的上游）。

**Tests**: 必须包含测试任务（宪章原则三）。测试全部在**宿主机本地**执行，容器不参与。

## 设计取舍（对应宪章「治理 § 例外」的登记口径；**均非原则违反**）

| 取舍 | 必要性 | 被否决的更简方案 |
|---|---|---|
| 在**上游**（适配器结果文本口径）修，不在抽取器里"再解析一次字符串" | 三个症状（入口行缺失 / 结构化视图只见信封 / image 块 base64 落盘）同源，上游修一次全好；`view-links.ts` 保持"只递归对象/数组"的窄边界 | 抽取器加"解字符串"分支（第二套解析规则 + 第二个漂移点） |
| 文本规则复用 `serializeToolResult`，新模块只做形状分发与上报 | 原则二"同一职责只有一处实现"：模型看到的与落盘的**结构上同一份** | 新模块自己拼块文本（image 占位等规则出现两份实现） |
| 被跳过的块 → 显式占位文本 + 结构化 `warn` | 原则九"降级不掩盖问题" | 静默 `continue`（丢了块没人知道） |
| 历史回填走**一次性脚本**（默认干跑 + 原子改名 + 幂等） | 新记录不再有信封，回填只服务存量数据 | 运行时加"解信封"兼容分支（第二套口径，且对新记录无用） |
| 新逻辑独立成 `infra/mcp/mcp-result-text.ts` | `mcp-tool-adapter.ts` 532 行属**既有超限**（登记在案），不再加重 | 把逻辑塞进适配器（继续推高既有超限文件） |

## Phase 1: 规格（宪章原则一：先规格后代码）

- [x] T052 回写 `spec.md`：新增 §4.9（`TR-49`~`TR-52` + 明确不做）、§5.1 `inline_content` 口径、§7.4 修订记录、§8 宪章落实增量、§9.4 验收清单
- [x] T053 回写 `异步MCP服务接入约定.md` §4.7（追加"平台侧口径修正，服务写法不变"）+ `plan.md` 续写 §13~§16
- [x] T054 回写本文件本次增量任务

## Phase 2: 后端实现

- [x] T055 新增 `agent-backend/src/infra/mcp/mcp-result-text.ts`（137 行）：`mcpResultText()`（字符串原样；其余委托 `serializeToolResult()`；被跳过块上报）、`unwrapMcpEnvelopeText()`（历史信封解包，判据收窄为"`content` 数组 + 至少一块字符串 text"）、`UnsupportedBlockLog`
- [x] T056 `agent-backend/src/infra/mcp/mcp-tool-adapter.ts`：成功分支接线 `mcpResultText(result, { logger, service, tool })`，删除 `JSON.stringify(result)`（**净 +3 行**：1 行 import + 2 行接线）
- [x] T057 `agent-backend/src/domain/tool-result.ts`：注释明确它是"模型可见 + 落盘"的**唯一实现**（无行为变化）
- [x] T058 新增 `agent-backend/scripts/backfill-view-links.ts`（199 行）：干跑默认 / `--apply` 写盘 / 临时文件 + 原子改名 / 幂等 / 复用运行时判据 / 失败非零退出码

## Phase 3: 测试（宪章原则三）

- [x] T059 [P] 新增 `agent-backend/tests/unit/mcp-result-text.spec.ts`（250 行 / **17 例**）：形状分发与逐块挑选（5）、JSON 兜底（2）、被跳过块上报（4）、历史信封解包（3）、**适配器接线端到端**（3：对象结果 → `viewUrl` 可抽出 / image base64 不入文本 / 不支持块记 warn）

## Phase 4: 门禁与验收（宪章原则八 + hard gate）

- [x] T060 `agent-backend/vitest.config.ts`：`src/infra/mcp/mcp-result-text.ts` 登记进模块覆盖率阈值清单（80%）
- [x] T061 `agent-backend/package.json`：补 `"typecheck": "tsc --noEmit"`（宪章八：后端门禁脚本缺失 MUST 补齐并在规格中登记）
- [x] T062 测试与覆盖率：后端 **40 文件 / 514 用例全绿**（`npm run test:all`）；`mcp-result-text.ts` 95.34 / 86.11 / 100 / 100；`view-links.ts` 100 / 97.91 / 100 / 100（**未变**）；全局地板 67.62 / 63.2 / 67.41 / 69.37，**未下调**；前端**零改动**仍跑一遍回归：**43 文件 / 562 用例全绿**（`frontend/npm run test`，退出码 0）
- [x] T063 静态检查与构建：`npm run typecheck` / `npm run lint` / `npm run build` **退出码均 0**（`scripts/` 在 lint 覆盖内）
- [x] T064 硬门禁：本增量新增文件最大 **250 行**（测试）／199 行（脚本）／137 行（模块），均 ≤500；`mcp-tool-adapter.ts` 532 行属**既有超限**（原 529，本次 +3 行接线，未借机重构）；**零新增依赖**（后端 `package.json` 仅加脚本）
- [x] T065 历史回填执行（本机 `.opt-agent`）：干跑 → `--apply` 命中 **1 行**（`b5aa7eba…` / `call_00_9kG2Qz6BGaXxg8KJod4u1418`，即 `hd-algorithm__hd_algorithm_input_parser` 那条）；重跑待回填 **0** 行（幂等）；无 `.tmp` 残留；文件总行数不变、未命中行逐字节原样
- [x] T066 已知限制与存量缺口登记：① 结果文本 >256K 字符仍不抽取（与前端结构化展示同判据，既有）；② 非 text/image 块只留占位（不做真图 / 真音频投递）；③ 回填只覆盖指定 `--root` 的数据；④ `src/domain/tool-result.ts` 覆盖率 62.5 / 48.75 / 81.81 / 65.21（<80%）——本次仅**注释**改动，按「不追溯」不纳入模块清单，补齐属独立任务

**观察项（登记，不追溯）**：`frontend/src/api/types.ts` 489 行、`agent-backend/src/domain/tool-events.ts` 436 行、`frontend/src/components/chat/ToolCallList.vue` 428 行、`frontend/src/components/chat/ToolCallList.spec.ts` 436 行——均在 ≤500 内但已偏高，后续再有增量时**触发即拆**（不为存量发起专项）。
