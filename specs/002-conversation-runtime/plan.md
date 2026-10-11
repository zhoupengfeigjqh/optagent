---
description: "实施计划：对话运行时 · 视图入口（2026-10-10 两个增量：异步产出正文链接 §1-7 / 同步侧 sidecar 入口 §8-12）"
---

# Plan: 对话运行时 · 产出正文的视图链接（2026-10-10 增量）

**Input**: [spec.md](./spec.md) §3（术语）、§4.7（`TR-40`~`TR-43`）、§7.2、§9.2

**范围**：**仅异步产出（R11 后台记录 / 铃铛）**。同步工具结果的对话内入口（模型侧标记）**本次不做**，另立增量——本次刻意只覆盖"值由数据给出、不经过模型"的那一半，因为它不需要任何提示词约定与后端改动。

**为何本次新增 `plan.md`**：上一个增量（2026-10-08）以"单点前端展示改动、取舍已写入 `spec.md` §4.6 与 `tasks.md` 设计取舍表"为由未新增本文件（见 [tasks.md](./tasks.md) 头部）。本次仍属纯前端增量，但必须新增，三条理由：

1. 宪章**原则一**要求"规范 → 计划 → 任务"三件套；
2. 宪章**原则三 / 九**与「治理 § 例外」要求把复杂度与平台差异风险登记在本文件的 Complexity Tracking；
3. 宪章「同步影响报告 § 新增待办（2.0.2）」规定：`src/api/**` 与 `src/composables/**` 中尚无测试的模块，"其补测顺序与范围 MUST 在下一个特性的 `plan.md` 中给出结论"——本文件 §4 给出该结论。

## 1. 技术方案

**数据流**（全在既有链路上，只加最后一步）：

```
服务回写 POST /api/files/put?…&summary=…      （平台：验签 → 落盘 → sidecar，形状不变）
   → produced 信号 → 铃铛列表（标题 = summary，副标题 = 工具名 · job_id）
   → 用户点开某条 → GET /api/produced/raw?job_id=…   （正文原样返回）
   → parseProducedContent(正文) → structured 且 value 是对象
   → 【新增】ProducedJsonView 渲染到字段名为 viewUrl 的标量时：
        resolveViewUrl(值) → 渲染为 <a>（文本 = 值本身，新窗口打开）
```

**关键判据（三条，唯一来源）**：

| 判据 | 实现位置 |
|---|---|
| 是否视图链接字段：只看**字段名**（`viewUrl`，大小写不敏感），不看值像不像 URL | `utils/view-link.ts` → `isViewUrlField()` |
| 值 → 可点地址：已带前缀原样 / 单个 `/` 开头拼当前入口 / 其余 `null` | `utils/view-link.ts` → `resolveViewUrl()` |
| 加载态、截断、降级 | 既有 `parseProducedContent` 与 `ProducedJsonView`（**不改**） |

**为什么把前缀判定放前端**：前缀 = "用户当前访问的入口"，只有浏览器知道（`window.location.origin`）；写死 `ip:端口` 会在开发（5173）/生产（网关）/换域名时全部失效。`origin` 支持注入，故单测不依赖真实 `location`。

## 2. 文件清单

| # | 文件 | 动作 | 实际行数 |
|---|---|---|---|
| 1 | `frontend/src/utils/view-link.ts` | 新增（纯函数，单一职责） | 68 |
| 2 | `frontend/src/utils/view-link.spec.ts` | 新增（同名测试，20 例） | 94 |
| 3 | `frontend/src/components/chat/ProducedJsonView.vue` | 改动：`fieldKey` 属性 + 链接分支 + 样式 | 298（<500） |
| 4 | `frontend/src/components/chat/ProducedJsonView.spec.ts` | 追加 11 例 | 199 |
| 5 | `frontend/vite.config.ts` | 模块覆盖率阈值清单加入 `src/utils/view-link.ts` | 94 |
| 6 | `异步MCP服务接入约定.md` | 新增 §4.7（`viewUrl` 值形态约定；跨侧文档） | 全文 +29 行 |

**零变更**：`agent-backend` 全部、`api/types.ts`、`api/produced.ts`、`ProducedBell.vue`、`ChatPanel.vue`、SSE、端点。

## 3. Complexity Tracking（含被否决的替代方案）

| 项 | 内容 |
|---|---|
| 采用的方案 | **展示层渲染**：值就在正文里，前端在结构化视图内把它链接化 |
| 被否决：后端把 `viewUrl` 提为 sidecar 字段 + 列表下发 | 更"规范"（列表行即可见、不受正文体积限制），但需后端 + 契约两侧同改；本次目标是最小改动 |
| 被否决：由模型在回答里输出入口（`@view:` 标记） | 属同步侧；值经模型转写可能抄错，且需提示词约定与前端标记解析 |
| 被否决：正文 >256K 字符时做**定向提取**（只解出该字段） | 与既有"结构化展示"同一判据（`parseProducedContent` 不解析）会有一致性收益；此类产出罕见，先登记为**已知限制**，不做启发式解析 |
| 已知限制（登记） | ① 正文 >256K 字符 → 走原始文本，**不产生链接**；② `viewUrl` 落在被既有上限截断的部分（行 10 / 列 50 / 深度 8）→ 不产生链接；③ 深链指向的路径是否在当前入口可达，取决于网关路由（**部署配置**，不属于本次代码改动） |
| 原则九判定（登记） | 值形态不匹配时**按普通文本渲染、不额外提示**：界面展示的是正文原文（信息完整、未被隐藏或替换），平台从未承诺该字段一定可跳转——属"形态不匹配"而非"降级"，故不引入用户可见提示。本改动也**不新增静默吞错**：`resolveViewUrl()` 返回 `null` 表达"不是可识别链接形态"，不是异常；无错误需要入日志（前端亦无集中日志通道，为既有缺口，见宪章同步影响报告） |

## 4. 覆盖率缺口处置结论（宪章「同步影响报告」2.0.2 待办）

**待办原文要求**：`src/api/**` 与 `src/composables/**` 中尚无测试的模块，其**补测顺序与范围** MUST 在下一个特性的 `plan.md` 中给出结论（且 MUST NOT 为存量代码发起回溯性补测专项）。

**本次结论**：

| 项 | 结论 |
|---|---|
| 范围 | 仅**尚无可执行同名测试**的模块。按当前仓库：`src/api/**` 中 `agents.ts` / `files.ts` / `http.ts` / `models.ts` / `produced.ts` / `sse.ts` / `threads.ts`（`messages.ts` 已有测试；`datapage.js` 为 `.js`、不在覆盖率分母内；`types.ts` 为纯类型、已排除），以及 `src/composables/**` 中 13 个（`useAgents` / `useAppSession` / `useChatPanel` / `useFileMention` / `useModels` / `usePathInsert` / `usePreview` / `useResizablePanel` / `useSessionSearch` / `useThreads` / `useToast` / `useUploads` / `useWorkspace`） |
| 顺序（按"契约漂移风险 + 被展示层依赖度"排） | ① **网络与契约边界**：`api/http.ts`（错误码与统一错误格式）、`api/threads.ts`、`api/files.ts`、`api/produced.ts`（本次改动的直接依赖）；② **产出与预览链路**：`composables/useProduced.ts`（既有测试，保持）、`usePreview.ts`、`useWorkspace.ts`；③ **会话与流式**：`useChatPanel.ts`、`useThreads.ts`、`useSessionSearch.ts`；④ 其余（`useAgents` / `useModels` / `useUploads` / `useFileMention` / `usePathInsert` / `useResizablePanel` / `useToast` / `useAppSession`） |
| 机制（**不立项专项**，符合不追溯） | 随特性改动"触达即补"：**本次只新增 `src/utils/view-link.ts` 的测试**（本次改动文件），不为上述存量模块补测 |
| 全局地板 | 只可随补测**上调**，MUST NOT 下调（承宪章原文） |

## 5. 平台差异风险登记（宪章原则三）

**登记结论：本次改动无平台相关行为。** 不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块——改动是浏览器内的字符串判定与 Vue 渲染，且在本地（Windows）与交付目标（Linux 容器）行为一致（同源相对路径拼接不依赖宿主）。

## 6. 门禁（宪章原则八；全部在本地执行）

```
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

已知存量状况（**非本次引入**，见 [tasks.md](./tasks.md) T015）：全仓 `lint` / `typecheck` 存在落在未改动存量文件里的报错；本次按"改动文件单独检查为 0 问题"的既有口径验证，并在验收清单中如实登记。

## 7. 验收

见 [spec.md](./spec.md) §9.2；任务与勾选状态见 [tasks.md](./tasks.md)。

---

# Plan: 对话运行时 · 同步侧视图入口（2026-10-10 增量 #2，§4.8）

**为何在本文件续写、不新开 plan**：同一特性（002）的第二增量，且与上一增量**同源**——`frontend/src/utils/view-link.ts` 就是那条"值归一化唯一实现"；跨侧契约变更与覆盖率登记口径也一致。新开文件会让"归一化只有一处"这件事分散在两条计划里。

**Input**：[spec.md](./spec.md) §4.8（`TR-44`~`TR-48`）、§7.3（修订记录）、§9.3（验收清单）。

## 8. 技术方案

```
工具结果文本（JSON）
  → [后端] extractViewLinks()     形态卫生（不拼前缀、不判 scheme、不改写值）
  → tool-events.jsonl 行的 view_links          与正文**分离**存放
  → GET /api/threads/{id} → tool_calls[].view_links
  → [前端] collectToolViewLinks()  本条回答全部工具调用的并集
  → toViewLinkEntries()            归一化 + 按 href 去重 + 名称取首个非空值
  → MessageViewLinks               回答正文之后；前 3 条 + 「另有 N 个」
```

**关键判据（唯一来源，与前增量同一份）**：

| 判据 | 实现位置 |
|---|---|
| 是不是视图链接字段：只看**字段名**（`viewUrl` / `viewUrlName`，大小写不敏感） | 后端 `domain/view-links.ts`；前端 `utils/view-link.ts`（`TR-40`） |
| 值 → 可点地址：已带前缀原样 / 单个 `/` 开头拼当前入口 / 其余丢弃 | 前端 `utils/view-link.ts` → `resolveViewUrl()`（`TR-41`），**后端不重复判定** |
| 名称 → 显示文本：有名称用名称 / 无名称显示地址（中段省略） | 前端 `utils/view-link.ts` → `viewLinkLabel()`（`TR-46`） |

**为什么"搬运"放后端、"能不能点"留前端**：值本身是服务给的（后端拿得到，正文外置时更是**只有后端**拿得到）；而前缀 = 用户**当前访问入口**，只有浏览器知道。若把 scheme 合法性判定也搬到后端，就会出现**第二个漂移点**：前端改了拒绝规则，记录里还留着按老规则挑出来的值。

**为什么 sidecar 与正文分离**：① 正文外置（>64KB）时入口仍可用；② 不挤占模型上下文回灌预算（`tool-context.ts` 根本不读 `viewLinks`）。

## 9. 文件清单（本增量）

| # | 文件 | 动作 | 行数 |
|---|---|---|---|
| 1 | `agent-backend/src/domain/view-links.ts` | 新增（纯函数：抽取 + 形态卫生） | 175 |
| 2 | `agent-backend/src/domain/tool-events.ts` | 改动：终态行写 `view_links`、读取白名单校验、对外 `viewLinks` | 436 |
| 3 | `agent-backend/src/routes/threads.ts` | 改动：`tool_call` 序列化下发 `view_links` | 215 |
| 4 | `agent-backend/tests/unit/view-links.spec.ts` | 新增（21 例） | 208 |
| 5 | `agent-backend/tests/unit/tool-events.spec.ts` | 改动（+5 例：sidecar 落盘 / 外置仍在 / 白名单） | 286 |
| 6 | `agent-backend/vitest.config.ts` | 改动：登记 `src/domain/view-links.ts`（80%） | 151 |
| 7 | `frontend/src/api/types.ts` | 改动：`ViewLink` + `ToolCallRecord.view_links?` | 489 |
| 8 | `frontend/src/utils/view-link.ts` | 改动：入口行派生（归一化 / 去重 / 文案 / 中段省略） | 173 |
| 9 | `frontend/src/utils/tool-calls.ts` | 改动：`viewLinks` 透传 + `collectToolViewLinks()` | 158 |
| 10 | `frontend/src/components/chat/MessageViewLinks.vue` | 新增（入口行） | 146 |
| 11 | `frontend/src/components/chat/MessageBubble.vue` | 改动：正文之后挂载入口行 | 345 |
| 12 | `frontend/src/components/chat/ToolCallList.vue` | 改动：结果正文结构化展示 + 「按原始 JSON 查看」 | 428 |
| 13 | `frontend/src/composables/useToolPanels.ts` | 改动：查看态新增 `raw` 开关 | 85 |
| 14 | `frontend/src/utils/view-link.spec.ts` / `tool-calls.spec.ts` / `ToolCallList.spec.ts` / `useToolPanels.spec.ts` | 改动（+24 例 / 断言补 `raw`） | — |
| 15 | `frontend/src/components/chat/MessageViewLinks.spec.ts` | 新增（12 例） | 120 |
| 16 | `frontend/src/components/chat/MessageBubble.viewLinks.spec.ts` | 新增（5 例：位置与装配） | 99 |
| 17 | `异步MCP服务接入约定.md` | 改动：§4.7（`viewUrlName` + 平台搬运行为）+ §4.3 例外标注 | 跨侧文档 |
| 18 | `docs/viewurl-chat-demo.html` | 新增：**独立静态演示页**（不接接口、不参与构建与门禁） | 1093 |

**零变更**：`tool-context.ts`（回灌链路）、`tool-calls` 端点、SSE 事件、`contracts/`、两侧依赖。

## 10. Complexity Tracking（本增量）

| 项 | 内容 |
|---|---|
| 取舍：sidecar 存 `tool-events.jsonl` 行（与正文分离） | 正文外置时入口仍可用、不占回灌预算 |
| 被否决：只在前端解析正文（上一增量做法） | 结果 >64KB 外置后前端**拿不到值**——这是本次要解决的核心问题 |
| 被否决：由模型在回答里转写地址 | 可能抄错、与记录**无绑定**（模型可漏写、改写）；需提示词约定与标记解析 |
| 被否决：后端也判 scheme 合法性 | 制造第二个漂移点（前端改规则后，记录里留着按老规则挑出的值） |
| 被否决：名称缺失时从 URL 末段取名 / "视图 1/2" 占位 | 等于**假装有名字**（原则九）；编号会随顺序漂移；地址永远可核对，比假名字可信 |
| 被否决：入口行并入 `MessageActions` | 语义错位：它是"正文的附件"，不是"对消息的操作" |
| 已知限制（登记） | ① 正文 >256K 字符不抽取（与前端结构化展示**同判据**）；② `viewUrl` 在深度 >8 处不抽取；③ 单次结果 >50 条只取前 50（先出现者胜）；④ `viewUrlName` 与 `viewUrl` **跨层**配不上 → 视同没给名字（显示地址）；⑤ 正文被手改成非法 JSON → 无入口（不猜） |
| 原则九判定（登记） | 入口**不出现**不等于"降级未提示"：无入口 = 本就没有可识别的跳转目标，信息仍完整保留在正文里（未被隐藏/替换）。抽取失败一律 `undefined`：**不抛错、不打日志**，表达"没有可识别项"而非"出错"。名称缺失或脏 → **显示地址**（少一个更友好的称呼，信息不缺失） |

## 11. 覆盖率与平台差异（本增量）

- **覆盖率**：后端把 `src/domain/view-links.ts` 登记进模块阈值清单（80%），实测 **100 / 97.91 / 100 / 100**；前端 `view-link.ts`（既有登记）实测 **98.11 / 94.33 / 100 / 100**；两侧全局地板**未下调**（前端实测 51.39 / 58.93 / 41.82 / 50.13 ≥ 48 / 55 / 38 / 47）。
- **平台差异**：无。改动是字符串判定 + JSON 遍历 + Vue 渲染，本地（Windows）与交付目标（Linux 容器）行为一致；不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块。
- **观察项（登记）**：`frontend/src/api/types.ts` 已到 **489 行**（≤500 但接近上限），后续再有字段增量时宜按域拆分（不追溯，触发即拆）。

## 12. 验收

见 [spec.md](./spec.md) §9.3；任务与勾选状态见 [tasks.md](./tasks.md)。
