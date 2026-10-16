---
description: "实施计划：对话运行时 · 视图入口（2026-10-10 两个增量：异步产出正文链接 §1-7 / 同步侧 sidecar 入口 §8-12）"
---

# Plan: 对话运行时 · 产出正文的视图链接（2026-10-10 增量）

**Input**: [spec.md](./spec.md) §3（术语）、§4.7（`TR-40`~`TR-43`）、§7.2、§9.2

**范围**：**仅异步产出（R11 后台记录 / 铃铛）**。同步工具结果的对话内入口（模型侧标记）**本次不做**，另立增量——本次刻意只覆盖"值由数据给出、不经过模型"的那一半，因为它不需要任何提示词约定与后端改动。

**为何本次新增 `plan.md`**：上一个增量（2026-10-08）以"单点前端展示改动、取舍已写入 `spec.md` §4.6 与 `tasks.md` 设计取舍表"为由未新增本文件（见 [tasks.md](./tasks.md) 头部）。本次仍属纯前端增量，但必须新增，三条理由：

1. 宪章**原则一**要求"规范 → 计划 → 任务"三件套；
2. 宪章**原则三 / 九**与「治理 § 例外」要求把复杂度与平台差异风险登记在本文件的 Complexity Tracking；
3. 宪章「同步影响报告 § 仍生效的待办与口径」第 1 项（存量补测待办，原 2.0.2 登记）规定：`src/api/**` 与 `src/composables/**` 中尚无测试的模块，"其补测顺序与范围 MUST 在下一个特性的 `plan.md` 中给出结论"——本文件 §4 给出该结论。

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

---

# 计划：MCP 工具结果文本口径修正（2026-10-12 增量）

**Input**: [spec.md](./spec.md) §4.9（`TR-49`~`TR-52`）、§5.1、§7.4、§9.4

## 13. 技术方案

**一句话**：把 MCP 工具结果的**文本口径**从上（适配器）改对——文本取"服务返回的 `content` 文本"，而**不是**整个 `CallToolResult` 的序列化信封；文本生成规则保持**只有一处实现**（`serializeToolResult`），新增逻辑收敛到一个纯函数模块。

**为什么必须在上游改**（而不是在抽取器里"再解析一次字符串"）：本次的三个症状同源——
① 回答尾部没有入口行（`extractViewLinks` 抽不到 `viewUrl`）；
② 工具卡片"结构化查看"只显示一个信封；
③ `image` 块 base64 随信封进入结果文本（绕过 `serializeToolResult` 的占位保护）。
只改抽取器只能治①，且会在"只递归对象/数组"的窄边界上开一个口子（第二套解析规则）。

### 13.1 改动清单

| # | 文件 | 性质 | 行数 |
|---|---|---|---|
| 1 | `agent-backend/src/infra/mcp/mcp-result-text.ts` | 新增：`mcpResultText()`（形状分发 + 被跳过块上报）、`unwrapMcpEnvelopeText()`（历史信封解包） | 137 |
| 2 | `agent-backend/src/infra/mcp/mcp-tool-adapter.ts` | 改动：成功分支接线（`mcpResultText(result, { logger, service, tool })`），删除 `JSON.stringify(result)` | 532（**既有超限**，见 §13.2） |
| 3 | `agent-backend/src/domain/tool-result.ts` | 改动：**注释**明确它是"模型可见 + 落盘"的唯一实现（无行为变化） | 168 |
| 4 | `agent-backend/tests/unit/mcp-result-text.spec.ts` | 新增：17 例（形状分发 / JSON 兜底 / 上报 / 信封解包 / 适配器端到端） | 250 |
| 5 | `agent-backend/scripts/backfill-view-links.ts` | 新增：一次性回填（默认干跑 + 原子改名 + 幂等 + 非零退出码） | 199 |
| 6 | `agent-backend/vitest.config.ts` | 改动：`src/infra/mcp/mcp-result-text.ts` 登记进 80% 模块阈值清单 | — |
| 7 | `agent-backend/package.json` | 改动：补 `"typecheck": "tsc --noEmit"`（宪章八：脚本缺失 MUST 补齐并登记） | — |
| 8 | `specs/002-conversation-runtime/{spec,plan,tasks}.md`、`异步MCP服务接入约定.md` | 改动：规格、计划、任务与跨侧文档 | — |

**零变更**：`frontend`（全部）、`admin-backend` / `admin-frontend`、`api/types.ts`、`GET /api/threads/{id}`、`GET /api/threads/{id}/tool-calls/{call_id}`、SSE 事件、`contracts/`、两侧依赖（**零新增**）。

## 14. Complexity Tracking（本增量）

| 项 | 内容 |
|---|---|
| 取舍：在**上游**（结果文本口径）修，而不是在抽取器里再解析字符串 | 一次修好三个同源症状；`view-links.ts` 保持"只递归对象/数组"的窄边界与既有限制登记（§4.8 `TR-48`）不变 |
| 取舍：文本规则复用 `serializeToolResult`，新模块只做形状分发与上报 | 宪章原则二"同一职责只有一处实现"：模型看到的与落盘的**结构上同一份**，不是靠约定保持同步 |
| 取舍：被跳过的块 → 显式占位文本 + 结构化 warn | 原则九"降级不掩盖问题"：`audio` / `resource_link` / 内嵌 resource 会被跳过（与既有"不落 base64"同一取舍），但必须留下可查线索 |
| 取舍：历史回填走**一次性脚本**，不在运行时加兼容分支 | 运行时再加"解信封"＝第二套抽取口径（前端改规则后与记录里的老值漂移）；脚本幂等、原子、可干跑，且复用运行时同一实现 |
| **被否决**：透传 MCP 的 `content` 块数组（含 `ImageContent`）给引擎 | 会改变模型侧语义（真图片 vs 占位文本）、跨 provider 有风险、token 计量与既有 usage 统计口径都要重估——另立增量 |
| **被否决**：只在前端"解一层"（`ProducedJsonView` 里再 parse 字符串） | 只解决"看得见"，解决不了 sidecar 抽取（入口行仍缺）与 base64 落盘；且把解析责任放进展示层，与 §4.7"平台不解析"的边界冲突 |
| **被否决**：改 `tool-events.ts` 的抽取入口去解信封 | 该入口服务所有工具（含内置工具），为一个特定 provider 的形状加分支属越权耦合 |
| 已知限制（登记） | ① 结果文本 >256K 字符仍不抽取（与前端结构化展示同判据，既有）；② 非 text/image 块只留占位（本次不做真图/真音频投递）；③ 历史回填只覆盖指定 `--root` 的数据，其它环境各跑一次 |
| 既有技术债（**不追溯**，仅登记） | `mcp-tool-adapter.ts` 532 行 > 500 行门禁：属**既有超限**，拆件任务原已在 [tasks.md](./tasks.md) 登记；本次把新逻辑放进新模块，未借改动之机做拆件重构（宪章「不追溯」条款） |

## 15. 覆盖率与平台差异（本增量）

- **覆盖率**：`src/infra/mcp/mcp-result-text.ts` 登记进 `vitest.config.ts` 模块阈值清单（80%）；全局地板**未下调**。
- **平台差异：有（仅回填脚本）**——脚本要遍历 `users/{uid}/user-data/threads/*/tool-events.jsonl`，而仓库路径与用户数据路径可能含**非 ASCII 字符**（本机为 `d:/公司项目/智能体/optagent`），且 Windows 与交付目标（Linux 容器）的**路径大小写敏感性**不同。对策：① 全程 `node:path` 拼接、不做字符串比较；② 目录项按 `readdirSync` 取到的**实际名字**拼接，不猜测大小写；③ 根目录从 `--root` / `OPT_AGENT_ROOT` 解析（与 `src/config.ts` 同口径）；④ 写盘"临时文件 + 原子改名"，失败保持原文件不变。**该脚本不参与运行时**，交付目标不依赖它。
- **运行时改动无平台差异**：字符串/块遍历与 JSON 序列化在两端行为一致。

## 16. 验收

见 [spec.md](./spec.md) §9.4；任务与勾选状态见 [tasks.md](./tasks.md)。

---

# 计划：LLM 失败的有界重试与可诊断（2026-10-15 增量）

**Input**: [spec.md](./spec.md) §4.10（`TR-53`~`TR-58`）、§6、§7.5、§8、§9.5；契约落点 [`runtime-api-delta.md` §19 R20](../../001-digital-human-platform/contracts/runtime-api-delta.md)

## 17. 技术方案

**一句话**：**别自己写重试**——把 `maxRetries` / `maxRetryDelayMs` 传给 `pi-ai` 既有的 `retryProviderRequest`；把"上游报文 → 错误码 + 诊断字段"收敛成**一个纯函数**；把诊断线索沿**已有通道**（SSE `error` / 失败轮落盘 / 结构化日志）下发；前端补可行动文案与「重试本轮」。

### 17.1 重试接线（`TR-53`）：只传参，不实现

| 注入点 | 现状 | 改动 |
|---|---|---|
| `src/infra/llm/pi-ai-provider.ts` 的 `streamChat` | `streamSimple(model, context, { reasoning?, signal, apiKey })` | 追加 `{ maxRetries, maxRetryDelayMs }`（来自 `AppConfig`） |
| `src/infra/agent-loop.ts` 的 `createStreamFn` | `streamSimple(model, context, { ...options, apiKey })` | 同上；`createStreamFn(provider, apiKey, retry)` 增第三参（工具循环路径共用同一份上限） |

- 为什么这样够：`pi-ai` 的 `openai-completions` 适配器在 `client.chat.completions.create(...).withResponse()` 外层包了 `retryProviderRequest(..., { maxRetries, maxRetryDelayMs, signal })`——它已实现指数退避 + 抖动、`x-should-retry` 优先、尊重 `Retry-After`（超过 `maxRetryDelayMs` 直接失败，不静默长等）、睡眠可被 `AbortSignal` 打断（用户点「停止」立即生效）。**重试点在响应到达之前**，因此不会出现"重复正文"。
- 为什么不用 `utils/retry.d.ts` 的 `retryAssistantCall`：它以 `Promise<AssistantMessage>` 为产出（需要先把整段回答收完），与流式首字节优先的体验相悖；本项目两条路径都是**流式**。
- 配置（`src/config.ts` 的 `envSchema`，宪章原则八：单条命令即可用）：

| 环境变量 | 默认 | 校验 | 语义 |
|---|---|---|---|
| `LLM_MAX_RETRIES` | `2` | `int 0..5` | 重试次数（首次调用不计）；总尝试 ≤ `1 + 该值` |
| `LLM_RETRY_MAX_DELAY_MS` | `15000` | `int 0..60000` | 单次重试等待上限（`0` = 不设上限，与 pi 同义） |

- **超时**：沿用 `ProviderRequestOptions.timeoutMs` 的既有默认（OpenAI/Anthropic SDK 客户端默认 10 分钟）——本次**不设**该值：对流式长回答，SDK 的 `timeout` 会连同正文读取一起截断，风险高于收益（§4.10「明确不做」）。

### 17.2 失败分类（`TR-54`）：一个纯函数，两处共用

新增 `agent-backend/src/domain/llm-error.ts`（domain 层纯函数，`infra` 向下依赖，符合既有分层先例：`agent-loop.ts` 已 import `domain/tool-result.js`）：

```ts
export type LlmErrorCode =
  | 'ABORTED' | 'LLM_ERROR' | 'LLM_UNAVAILABLE' | 'LLM_RATE_LIMITED'
  | 'LLM_INSUFFICIENT_BALANCE' | 'LLM_UNAUTHORIZED' | 'LLM_CONTEXT_TOO_LONG';

export interface LlmFailure { code: LlmErrorCode; message: string;
  upstreamStatus?: number; upstreamType?: string; requestId?: string; }

/** 输入：pi-ai 给出的错误文案（`"<status>: <body>"` / `"<prefix> (<status>): <body>"`）+ 可选显式状态码 */
export function classifyLlmFailure(input: { message?: string; status?: number }): LlmFailure;
```

判定顺序（**唯一实现**，两侧调用点不再各写一套）：

1. 显式 `status`（从抛出的 `Error` 上取 `status` / `statusCode`）优先；否则从文案里解析前导的 3 位状态码；
2. 状态码 → 码：`401` / `403` → `LLM_UNAUTHORIZED`；`402` → `LLM_INSUFFICIENT_BALANCE`；`408` → `LLM_TIMEOUT`（见下注）；`429` → `LLM_RATE_LIMITED`；`≥500` → `LLM_UNAVAILABLE`；`400` 且文案/类型含上下文长度特征（`context length` / `maximum context` / `too long` / `token`）→ `LLM_CONTEXT_TOO_LONG`；其余 → `LLM_ERROR`；
3. 从错误体（JSON）尽力取 `type`（`upstreamType`）与 `request_id`（也兼容 `requestId` / `id`），失败则省略——**不抛错**；
4. `ABORTED` 由调用点按 pi 的 `reason === 'aborted'` 判定后传入（分类器不猜中断）。

> 注：`pi-ai` 把 `408` 归入可重试集合，但两者语义不同（`408` = 上游等待超时）。本增量**不新增** `LLM_TIMEOUT` 码，`408` 归入 `LLM_UNAVAILABLE` 并保留 `upstream_status=408` 供诊断——避免为一次实现里不会单独出现的分支新增对外码。

### 17.3 诊断通道（`TR-55` / `TR-56`）：沿既有通道下发，不新增事件

| 落点 | 改动 |
|---|---|
| `src/types.ts` | `LlmEvent` 的 `error` 变体与 `HistoryMessage.error` 各新增三个**可选**字段（`upstream_status` / `upstream_type` / `request_id`） |
| `src/infra/llm/pi-ai-provider.ts` / `infra/agent-loop.ts` | 两处 `error` 事件改用 `classifyLlmFailure()` 产出 `code` + 诊断字段（中断仍走 `ABORTED`） |
| `src/domain/run-finalize.ts` 的 `error()` | ① 失败行 `error` 对象写入诊断字段（有才写，不写 `null`）；② SSE `error` 事件同形；③ **新增一条结构化日志** `event: 'llm.call.failed'`（`warn`；`LLM_INSUFFICIENT_BALANCE` / `LLM_UNAUTHORIZED` 带 `alert: true`），字段：`code` / `upstream_status` / `upstream_type` / `request_id` / `provider` / `model` / `message`（截断 500 字符）+ 既有 `user_id` / `thread_id` / `agent_name` / `duration_ms`（原则九：原始错误落日志、含关联线索） |
| `src/domain/run-manager.ts` | 仅"流无终结事件"分支（`LLM 流异常结束`）沿用 `LLM_ERROR`：该分支没有上游报文可分类，**不编造**诊断字段 |

> `provider` / `model` 从哪来：`RunFinalizer` 的注入依赖里加一个**只读取值口**（`llmInfo?: () => { provider: string; model: string }`），由装配处（`server.ts` / `agent-factory`）注入——`domain` 层不反向依赖 `config`（既有约束，见 `types.ts` 的 `ModelSelection` 注释）。

### 17.4 前端（`TR-55` / `TR-57` / `TR-58`）

| 文件 | 改动 |
|---|---|
| `src/api/types.ts` | `ErrorInfo` 新增三个可选字段（与后端 JSON 同名）+ 注释指向契约 |
| `src/utils/error-message.ts` | 文案表新增 5 个码（`send-message` 场景口径）；新增**纯函数** `formatErrorDiagnostics(error): string \| null`（码 · 上游状态码 · `request_id`，缺失自动省略；全缺返回 `null`） |
| `src/components/common/ErrorNotice.vue` | 新增一行诊断信息（`v-if`），保留 `role="alert"` 与原生按钮 |
| `src/composables/useChatStream.ts` | `lastAbortedTurn` → **`lastRetryableTurn`**（语义从"中断轮"扩为"可重试轮"）：收尾时置位缓存，判据为 `aborted` 或"服务端**已终局**的 `failed`（收到 `error` 终结事件，`terminalFailure`）；断连/传输层失败不置位（后端可能仍在跑，重发撞 409） |
| `src/composables/useChatPanel.ts` | `canRegenerate = (phase === ABORTED \|\| phase === FAILED) && lastRetryableTurn !== null`；新增 `onRetryTurn(payload)`（**历史失败轮**的重发入口：复用 `onSend`，本轮进行中不响应）；新增 `onRetryFailedRun()`（**面板级**分流：可重发 → `onRegenerate`，否则 → `onRecover`） |
| `src/components/chat/ChatPanel.vue` | 失败块的按钮文案分流：可重试 → 「重试本轮」；不可重试 → 「重新获取」；点击一律走 `onRetryFailedRun`（**⚠ 分流不能在模板里写成三元表达式**：`@retry="a ? f : g"` 被编译为语句，点击不触发处理器）；消息列表新增 `@retry="onRetryTurn"` |
| `src/components/chat/MessageList.vue` | 从历史解析失败轮的**同轮用户消息**（按索引向前找，不依赖 id 反查）并新增 `retry` 上抛；解析不出（窗口切分）时不给入口（文案经 `retryLabels` 派生并纳入 `v-memo` 比较项） |
| `src/components/chat/MessageBubble.vue` | 新增 `retryLabel`（失败提示条的入口文案；`null` = 不渲染入口——该不该重试只有列表层知道） |

### 17.5 改动清单

| # | 文件 | 性质 |
|---|---|---|
| 1 | `agent-backend/src/domain/llm-error.ts` | 新增：分类纯函数 + 码类型（唯一实现） |
| 2 | `agent-backend/src/config.ts` | 改动：`LLM_MAX_RETRIES` / `LLM_RETRY_MAX_DELAY_MS`（zod 校验 + `AppConfig` 字段） |
| 3 | `agent-backend/.env.example`（若存在，否则 README 的运行参数表） | 改动：登记两个新参数 |
| 4 | `agent-backend/src/infra/llm/pi-ai-provider.ts` | 改动：传重试参数 + 分类接线 |
| 5 | `agent-backend/src/infra/agent-loop.ts` | 改动：`createStreamFn` 增第三参 + 分类接线 |
| 6 | `agent-backend/src/types.ts` | 改动：`LlmEvent.error` / `HistoryMessage.error` 可选诊断字段 |
| 7 | `agent-backend/src/domain/run-finalize.ts` | 改动：诊断字段落盘/下发 + `llm.call.failed` 日志 |
| 8 | `agent-backend/src/{server,domain/run-manager,infra/agent-factory}.ts` | 改动：装配 `llmInfo` 取值口（最小接线） |
| 9 | `agent-backend/tests/unit/llm-error.spec.ts` | 新增：分类逐类 + 边界 |
| 10 | `agent-backend/tests/unit/llm-retry.spec.ts` | 新增：重试接线（假 provider：503×2→200 / 0 重试 / 不可重试 / abort） |
| 11 | `agent-backend/tests/unit/run-finalize.spec.ts` | 改动：诊断字段与 `llm.call.failed` 断言 |
| 12 | `agent-backend/vitest.config.ts` | 改动：`src/domain/llm-error.ts` 登记进模块覆盖率阈值清单（80%） |
| 13 | `frontend/src/api/types.ts` | 改动：`ErrorInfo` 诊断字段 |
| 14 | `frontend/src/utils/error-message.ts` / `.spec.ts` | 改动：新码文案 + `formatErrorDiagnostics` 纯函数与用例 |
| 15 | `frontend/src/components/common/ErrorNotice.vue` / `.spec.ts` | 改动：诊断行 + 用例 |
| 16 | `frontend/src/composables/useChatStream.ts` / `.spec.ts` | 改动：`lastRetryableTurn` + 失败轮缓存 |
| 17 | `frontend/src/composables/useChatPanel.ts` / `ChatPanel.spec.ts` | 改动：`canRegenerate` 扩展 + 按钮分流 + 历史失败轮 `onRetryTurn` |
| 17a | `frontend/src/components/chat/{MessageList,MessageBubble}.vue` | 改动：失败轮 `retry` 的解析与上抛（**断链修复**：原先该事件无接收方） |
| 17b | `frontend/src/composables/useChatPanel.retry.spec.ts` | 新增：重发链路（一次点击 = 一次 `chat.send`）与"进行中不响应且不清草稿" |
| 18 | `specs/002-conversation-runtime/{spec,plan,tasks}.md`、`contracts/runtime-api-delta.md` | 改动：规格与契约登记 |

**零变更**：`admin-backend` / `admin-frontend`（全部）、SSE **事件类型集合**（仍只有既有 8 种，`error` 只是负载增字段）、`GET /api/threads/{id}` 的其余字段、`tool_call*` 事件、上下文回灌、两侧依赖（**零新增**）。

## 18. Complexity Tracking（本增量）

| 项 | 内容 |
|---|---|
| 取舍：重试交给 `pi-ai`（传参）而非自建循环 | 宪章原则二"同一职责只有一处实现"+ 原则六"用平台原生能力"：退避 / 抖动 / `x-should-retry` / `Retry-After` / 可打断睡眠都已实现，自建即第二套语义 |
| 取舍：分类下沉到 `domain/` 纯函数 | 两个调用点（直聊 / 工具循环）必须给出**同一个码**，否则前端文案与日志口径会漂移；纯函数可穷举单测、无网络依赖（原则三） |
| 取舍：诊断走"已有通道 + 可选字段" | 不新增 SSE 事件类型 → 旧前端天然兼容；`error` 对象加字段是**向后兼容**的最小面 |
| 取舍：不设 `timeoutMs` | SDK 的 `timeout` 对流式响应会连正文读取一起截断；本次的收益点（首字节前 503）由重试覆盖，挂死由用户「停止」+ SDK 默认 10 分钟兜底（登记，见 §19） |
| 取舍：诊断信息在 UI 上**不做"复制"按钮** | 一次点击的不是本次痛点；`request_id` 文本可选中即满足"可报障"，避免为小概率操作引入新控件与 a11y 面 |
| **被否决**：自己写 `withRetry(streamFactory)` 包一层流 | 会重复实现退避与 `Retry-After` 判定；且包装 `AssistantMessageEventStream`（`StreamFn` 要求同步返回流对象）需要额外的泵送与错误重放，复杂度换不来新能力 |
| **被否决**：用 `utils/retry.d.ts` 的 `retryAssistantCall` | 它吃 `Promise<AssistantMessage>`（整段收完才返回），会毁掉首字节流式体验 |
| **被否决**：把上游 `message` 原文展示给用户 | 与 D13/V-12 冲突，且可能含 provider 内部信息；原文进日志、用户看分类文案 + 状态码 + `request_id` |
| **被否决**：给"重试中"新增 SSE 事件 | 重试发生在首字节前（≤ 秒级），既有"生成中"已是可感知的等待态；新增事件要动事件集合、前端分支与 4 处契约，收益不足 |
| **被否决**：失败轮把"重发"做成后端能力（自动重跑上一轮） | 会绕过前端草稿/引用校验链路，且在"用户已改动输入"时语义含混；沿用既有"以缓存的上一条用户消息重发"的交互 |
| 已知限制（登记） | ① 流到一半失败仍不重试（避免重复正文），需用户点「重试本轮」；② `upstream_type` / `request_id` 依赖上游响应体形状（DeepSeek 会带；换成不带的 provider 时字段省略）；③ 重试次数对用户不可见（只有失败后的"已自动重试仍未成功"文案） |

## 19. 覆盖率与平台差异（本增量）

- **覆盖率**：`src/domain/llm-error.ts` 登记进 `agent-backend/vitest.config.ts` 模块阈值清单（80%）；两侧全局地板**不下调**。
- **平台差异**：无。改动是"HTTP 请求选项 + 字符串/JSON 解析 + Vue 渲染"，不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块；测试全部本地（宿主机）执行。
- **观察项（登记）**：`agent-backend/src/domain/run-finalize.ts` 与 `src/infra/llm/pi-ai-provider.ts` 改动后行数见 §17.5 实测；`frontend/src/api/types.ts`（上次 489 行）本次再增 3 个字段，触发即拆的门槛仍在 ≤500 内——若越线则先拆类型文件再合入。

## 20. 验收

见 [spec.md](./spec.md) §9.5；任务与勾选状态见 [tasks.md](./tasks.md)。
