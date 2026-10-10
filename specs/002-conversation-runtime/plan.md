---
description: "实施计划：对话运行时 · 产出正文的视图链接（2026-10-10 增量）"
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
