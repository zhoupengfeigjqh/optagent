---
description: "实施计划：对话运行时 · 下一步动作建议（005，2026-10-12；模型单段直接产出 Top3）"
---

# Plan: 对话运行时 · 下一步动作建议（005）

**Input**: [spec.md](./spec.md) §4（`NT-01`~`NT-30`）、§5（数据模型）、§6（契约增量）、
§8（宪章符合性）、§10（决策记录）

**Prerequisites**: [spec.md](./spec.md) §10.1 的用户决策（D1 / D2）已记录，§10.2 的默认值已随需求落条
——**无待确认项**。

**范围**：`agent-backend` + `frontend` 两侧同改（宪章原则七）。平台侧、jev 配置与 MCP 链路**零改动**。

## 1. 技术方案

**单段**（一次 LLM 调用产出有序建议；本特性**不调用任何 MCP 工具**）：

```
finalizeDone（落盘前，与 history.append 并行）
 ├─ 候选工具清单：内置（TOOL.json ∩ catalog）+ MCP（已连接 server 的 listTools ∩ allowed_tools）
 │                − NEXT_TOOLS_EXCLUDE_SERVERS（默认 jev）        → 为空则跳过
 └─ 【LLM 一次调用】streamChat({tools: [], thinking: false, signal})，独立 AbortController
      prompt = 数字人角色摘要(≤500) + 用户消息(≤2000) + 本轮回答(≤2000)
             + 已用工具 + 候选工具清单(名/显示名/简介)
             + 输出要求：JSON [{tool, action}]，0–3 条，按可能性从高到低，宁少不多，
               允许返回 []，已执行过的动作不要重复建议
      → 校验：tool 白名单 / action 非空(≤120) / 按 tool 去重 / 保持顺序 / >3 截断
      → 日志分级：[] 或未命中条件 = next_tools.skip(info)／非 JSON·全被丢弃 = degraded(warn)
 → next_tools: [{ name, text(=action), toolLabel, guidance }]（后端一并生成 guidance）
 → assistant 行一次写入 → emit('next_tools') → emit('done') → routes/chat.ts 在 done 处 end()
```

**关键判据（唯一来源）**：

| 判据 | 实现位置 |
|---|---|
| "哪些工具可被建议" | 复用装配 LLM 工具表的三段式（`isAvailable` + `listTools` + `scopeToolsByAllowlist`，**抽为共享函数**）− 排除服务 |
| 排除哪些服务 | 配置 `NEXT_TOOLS_EXCLUDE_SERVERS`（默认 `jev`），按 **server 名**判定（MUST NOT 猜前缀） |
| prompt 的构造与截断 | `domain/next-actions.ts` → `buildNextActionsPrompt()` |
| 模型输出的形状与合法性（白名单 / 去重 / 顺序 / 条数） | `domain/next-actions.ts` → `parseNextActions()` |
| `guidance` 文案与长度守卫 | `domain/next-actions.ts` → `buildGuidance()` |
| 超时与跳过/降级收口（唯一日志出口） | `domain/next-actions.ts` → `generateNextActions()` |
| "是否最新一条 assistant 消息" | 前端 `MessageList.vue`（列表渲染处判定并下传），`MessageBubble.vue` 只在收到"是"时挂载卡片（`NT-25`）。**不涉及后端** |

**为什么与 `summary.ts` 同构**：本特性与滚动摘要一样，都是"回合结束后、后台、非流式、可失败"的 LLM 调用：
`streamChat({tools: [], thinking: false, signal})` 累积 `content_delta`、`AbortController` 到点中止、
失败只 warn、不计会话 usage（`domain/summary.ts:121-148`）。**后台 LLM 调用在本仓库因此仍只有一种写法**，
且 `domain/` 只依赖结构化最小接口（`SummaryLlm` 的先例），不依赖 `infra` 的类型。

**为什么必须在 `history.append` 之前**：`finalizeDone` 的既有次序是"先落盘后广播"
（`run-manager.ts:419-450`），`next_tools` 是历史行的一部分；`history.jsonl` 是 append-only，事后改写
等于给"部分提交"开门（违反宪章原则五）。**代价已由用户接受**（spec §10.1 D1）：`done` 最多被推迟一个超时
（默认 4s），期间 `canSend=false`（`useChatStream.ts:170-172`）、Composer `disabled`（`ChatPanel.vue:218`）。

**并行口径**：生成与 `history.append`（user + assistant）、`toolEvents.flush` 同时发起，
`done` 的额外等待 = 生成耗时本身，不是"落盘 + 生成"之和（`NT-16`）。

## 2. 文件清单

**agent-backend**（新增 3 个，改 9 个）：

| # | 文件 | 动作 | 备注 |
|---|---|---|---|
| 1 | `src/domain/next-actions.ts` | 新增（**唯一新模块**） | 常量与文案（**systemPrompt / user 模板逐字取自 [prompts.md](./prompts.md)**、各上限、guidance 模板）、`NextToolSuggestion` 类型、`buildNextActionsPrompt()`、`parseNextActions()`、`buildGuidance()`、`generateNextActions()`（LLM 调用 + `AbortController` + 跳过/降级与日志分级的唯一出口） |
| 2 | `src/domain/run-finalize.ts` | 新增（**硬门禁拆分产物**） | 从 `run-manager.ts` 抽出 `finalizeError` / `finalizeAborted`（见 §3.1） |
| 3 | `tests/unit/next-actions.spec.ts` | 新增 | prompt 构造 / 解析校验 9 例 / guidance / 超时 / 降级矩阵逐场景 |
| 4 | `src/types.ts` | 改动 | `HistoryMessage.next_tools?`（244 行） |
| 5 | `src/domain/run-events.ts` | 改动 | `SsePayload` 加 `next_tools` 分支 + 载荷类型（44 行） |
| 6 | `src/domain/run-impl.ts` | 改动 | `calledTools: Set<string>`（`tool_call_start` 加入、**不移除**）（65 行） |
| 7 | `src/domain/run-manager.ts` | 改动 **+ 拆分** | `tool_call_start` 累积；`finalizeDone` 落盘前并行发起生成并写入行；`RunAgentLike.suggestNextTools?`（477 行 → 拆分后 ≈430 + 增量） |
| 8 | `src/infra/agent-factory.ts` | 改动 | 抽出"可见工具收集"共享函数（装配与候选**同一处**）；`ChatAgent.suggestNextTools?` = 收集描述符 → 调 `generateNextActions()`（用既有 `deps.llm`）；`AgentFactoryDeps.nextTools` 配置 `{ enabled, timeoutMs, excludeServers }`（293 行） |
| 9 | `src/config.ts` | 改动 | 3 个 env + `AppConfig` 字段 + 逗号列表解析（156 行） |
| 10 | `src/server.ts` | 改动 | 把 3 项配置透传进 `AgentInstanceFactory`（`context.ts` **不改**：无新增字段） |
| 11 | `src/routes/threads.ts` | 改动 | `GET /api/threads/:id` 的 assistant 消息透出 `next_tools`（仅非空）（177 行） |
| 12 | `vitest.config.ts` | 改动 | `src/domain/next-actions.ts` 登记进模块阈值清单（80%） |
| 13 | `.env.example` / `README.md` | 改动 | 3 个 env 示例；README「运行端行为与默认参数」表补本功能三项 |
| 14 | `tests/unit/run-manager-*.spec.ts` | 改动 | 时序（`next_tools` 先于 `done`、落盘含字段）、缺省 / 失败 / 抛错 / 超时 / 中断不调用、`run.end` 日志 `next_tools_ms` |

**frontend**（新增 4 个，改 7 个）：

| # | 文件 | 动作 | 备注 |
|---|---|---|---|
| 1 | `src/components/chat/MessageNextActions.vue` | 新增 | 标题 + 1–3 张卡片（主文案 `text`、次行 `toolLabel`、原生 `<button>`、`disabled`、`title`） |
| 2 | `src/components/chat/MessageNextActions.spec.ts` | 新增 | 空态 / 3 行 / 1 张 / 主次文案 / `toolLabel` 缺省 / 点击 emit / `disabled` 不 emit / 暴露名与数值指标不可见 |
| 3 | `src/components/chat/MessageBubble.nextTools.spec.ts` | 新增 | 落点 DOM 顺序 + 两数据源一致 + 用户消息无卡片 |
| 4 | `src/utils/chat-stream-state.ts` | 新增（**拆分产物** + 纯函数） | `appendToolCall` / `settleToolCall` / `setNextTools` 的不可变映射（见 §3.1） |
| 5 | `src/utils/chat-stream-state.spec.ts` | 新增 | 三函数边界（空数组 / 未命中 id / 覆盖） |
| 6 | `src/api/types.ts` | 改动 | `NextToolSuggestion`、`Message.next_tools?`、`StreamEvent` 加 `next_tools`（431 行） |
| 7 | `src/composables/useChatStream.ts` | 改动 **+ 拆分** | `nextTools` ref；事件分支；`send()` / `reset()` 清空，**`finally` 不清空**（496 行 → 拆分后 ≈470） |
| 8 | `src/components/chat/MessageBubble.vue` | 改动 | 在 `MessageViewLinks` 之后、`TypingIndicator` 之前挂载；**仅在"最新一条 assistant 消息"时挂载**（`NT-25`）（307 行） |
| 9 | `src/components/chat/MessageList.vue` | 改动 | 判定并下传"是否最新一条 assistant 消息"；流式态 `nextTools` 下传（与 `toolCalls` 同路）（308 行） |
| 10 | `src/components/chat/ChatPanel.vue` | 改动 | 卡片点击 → `onSend({ content: s.text, attachments: [], guidance: s.guidance })`（355 行） |
| 11 | `src/composables/useChatPanel.ts` | 改动 | 仅在需要暴露点击处理时改（`onSend` 够用则零改动） |
| 12 | `vite.config.ts` | 改动 | `src/utils/chat-stream-state.ts` 登记进模块阈值清单（80%） |

**零变更**：`admin-backend` 全部、`.platform-data/mcp-services.json`（jev `allowed_tools:["noul"]` 保持）、
`src/routes/chat.ts`（请求体 schema 不动，`guidance` 复用）、`prompt-builder.ts`、`mcp-manager.ts`、
`mcp-tool-adapter.ts`、`mcp-tool-scope.ts`（只被复用，不改）、`tool-context.ts`、`tool-events.ts`、
`summary.ts`、`src/context.ts`、`jev-service`、`docker-compose.yml`。

## 3. Complexity Tracking

### 3.1 硬门禁：两个既有文件触限（≤500 行），本次必须拆

| 文件 | 当前 | 问题 | 拆分方案（行为保持） |
|---|---|---|---|
| `agent-backend/src/domain/run-manager.ts` | **477** | 本次增量（累积 1 行 + 钩子约 15 行 + 类型 5 行）必然过 500 | 把 `finalizeError` / `finalizeAborted`（失败与中断收尾，与成功轮互不依赖、无共享可变状态）抽到新增 `src/domain/run-finalize.ts`；`finalizeDone` 留在原处（本次改动核心，便于对照）。抽后 ≈430 |
| `frontend/src/composables/useChatStream.ts` | **496** | 加 `nextTools` ref、事件分支、3 处清理即过 500 | 把事件分发后的**纯映射**抽到新增 `src/utils/chat-stream-state.ts`（`tool_call` 入队、`tool_call_end` 标记、`next_tools` 赋值），与 002 §4.6 把计数/分组/文案抽进 `utils/tool-calls.ts` 的路线一致 |

**边界**：两处拆分只搬代码不改语义；既有 spec 全部保持绿即证明。MUST NOT 借机做无关重构
（宪章「不追溯」）。

### 3.2 取舍与替代方案

| 项 | 内容 |
|---|---|
| 采用（用户决策 D2）：**模型单段直接产出有序 1–3 条** | 一次调用即得最终卡片；无 MCP 依赖、无第二个失败面、预算不被瓜分 |
| 采用（用户决策 D1）：在 `history.append` 之前、与落盘并行 | 单通道交付（SSE），卡片与"本轮结束"同批到达，落盘一次成型 |
| 采用：与 `summary.ts` 同构的后台调用写法 | 后台 LLM 调用在本仓库保持"一种写法"；`domain/` 只依赖最小结构接口 |
| 采用：`guidance` 由后端产出 | 工具名与文案都在后端（唯一来源、可测）；前端零拼装 |
| 采用（用户决策 D5）：卡片**只渲染在最新一条** assistant 消息下方 | 从根上消掉连续追问的刷屏；落盘与接口下发不变，只收窄渲染规则（零成本代价） |
| 采用：排除服务走配置项 | 避免把 `jev` 硬编码进业务逻辑；将来有别的内部服务可直接加 |
| 被否决（v1）：jev `choice` 作为唯一来源 | 三个 primitive 均无数值以外出口（`jev_core.py:371-388`），卡片名只能是工具元数据 = 机械文案 |
| 被否决（v2）：模型写候选 → jev 排序 | 概率只用于排一次序；`choice` 的"互斥且覆盖全部可能"语义与本场景不匹配，校准解释性打折；代价是两次调用、预算瓜分、两处失败面 |
| 被否决：主模型在同一轮回答里顺带输出建议 | 结构化块会在流式过程中作为正文**闪现**（抑制需缓冲/截断整条流，复杂且易泄漏），且污染每次对话的输出约定 |
| 被否决：让 jev 排序"人写候选池"（如数字人 starters） | 零新增 LLM 调用，但候选与本轮内容无关、相关性打折，且要求每个数字人配 ≥2 个 starter |
| 被否决：`done` 先发、卡片事后拉取 / 改 SSE 收尾语义 | 体验更好（`done` 立即解锁输入框），但要改已发布契约（`routes/chat.ts:202`、`api/sse.ts` §4.1）或新增端点 + 二次请求；用户已选"与 done 同批" |
| 被否决：`next_tools` 落独立 sidecar 文件（照 002 工具记录先例） | 多一个 store、一套坏行恢复、一处会话删除清理；≤3 项元数据随消息写入更简单 |
| 被否决：前端拼 guidance / 前端推断显示名 | 两处规则会漂移；前端也没有工具目录可用 |
| 被否决：注入工具结果正文以提高建议精度 | 与 002 `TR-18`/`TR-21` 的"上下文有界"取向冲突（结果正文可达 2MB） |
| 已知限制（登记） | ① 顺序无独立校准（`NT-08`）；② 建议可能重复"已做过的事"（只看得到工具名）；③ 候选工具 >40 只取前 40；④ 动作文案 >120 截断；⑤ 用**默认模型**（不跟随请求级模型）；⑥ 不显示任何数值指标；⑦ 启用与 MCP 挂载无关 → 影响面扩大（§8.2） |

### 3.3 平台差异风险（宪章原则三）

**结论：无平台相关行为。** 改动是字符串拼接、JSON 解析、一次 LLM 调用与 Vue 渲染；不涉及文件系统、
路径大小写、非 ASCII 路径、行尾符或原生模块。本地（Windows）与交付目标（Linux 容器）行为一致。

## 4. 覆盖率缺口处置结论（宪章「同步影响报告」2.0.2 待办）

| 项 | 结论 |
|---|---|
| 上次结论（002 `plan.md` §4） | 已给出按"契约漂移风险 + 展示层依赖度"的四级顺序，**本次沿用、顺序不变** |
| 本次新增 | 本增量**新增**模块并**同名同目录**补测：`next-actions.ts`（后端）、`chat-stream-state.ts`（前端），均登记进模块阈值清单（80%） |
| 机制 | 仍为"**触达即补**"：本次改动的模块必须有测试；**不为** `api/**` / `composables/**` 的存量 0% 模块立项 |
| 全局地板 | 只可随补测**上调**，MUST NOT 下调 |

## 5. 门禁（宪章原则八；全部在本地执行）

```
# 后端
npm run lint && npx tsc --noEmit && npm run test:coverage && npm run build
# 前端
npm run lint && npm run typecheck && npm run test:coverage && npm run build
# 部署（仅确认部署成功，不作为测试结论）
docker compose up -d --build && <非交互冒烟：POST /api/threads/{id}/messages 读 event 流>
```

已知存量状况（**非本次引入**，沿 002 `tasks.md` T015 口径）：全仓 `lint` / `typecheck` 存在落在未改动
文件里的报错；本次按"改动文件单独检查为 0 问题"验证并在验收清单登记。`POST /api/threads/:id/messages`
**无端点级集成测试**（`tests/integration/` 现有 4 个文件均不覆盖它）——属存量缺口，**不追溯**；
本次以 `run-manager` 单测覆盖事件次序与落盘字段，并登记该缺口。

## 6. 验收

见 [spec.md](./spec.md) §9；任务与勾选状态见 [tasks.md](./tasks.md)。
