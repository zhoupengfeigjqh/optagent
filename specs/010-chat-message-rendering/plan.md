# 实现计划：聊天消息渲染（最小 Markdown 子集 / 代码块 / 分段）与会话导出

**Branch**: `010-chat-message-rendering` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: 特性规格 `specs/010-chat-message-rendering/spec.md`（5 个用户故事 / **52 条功能需求** / **9 条成功标准**；无待澄清项）

## 摘要

把中栏的消息正文从"纯文本 + 搜索高亮"升级为**结构渲染**，并补齐"把会话带走"与"长回答不卡"两件事。
四个支点，全部落在 `frontend` 单侧：

1. **自研最小 Markdown 子集**（`utils/markdown.ts`，纯函数）：解析出带**原文偏移**的块级 / 行内片段。
   不引库的理由：渲染器 + XSS 净化器是**两个**新依赖（原则六），而本项目既有风格就是零第三方（图标 / 分段 /
   文件类型判定全自研）；agent 输出高度收敛（标题 / 列表 / 表格 / 代码块 / 引用 / 粗斜体 / 行内代码 / 链接）。
   子集之外的语法**原样当文本输出**——宁可少渲染，不可渲染错，更不可引入注入面。
2. **渲染层三件套**：`MessageSegments.vue`（唯一持有 `.mark` 与外链样式，代码块 / 表格 / 正文共用）、
   `MessageCodeBlock.vue`（等宽 + 横向滚动 + 一键复制）、`MessageContent.vue`（块级分发）。
   **高亮与外链样式的唯一来源**由此收敛到一处（原则二的"同一职责只有一处实现"）。
3. **序号连续性**：`utils/segments.ts` 新增 `findMatches`（与 `buildSegments` 的匹配语义**同源**），
   渲染层用"片段偏移之前已有多少命中"换算全局序号——这是 Markdown 改造中最容易被踩坏、
   又最难在肉眼上发现的地方（标题里的第 1 个命中，到列表项里必须还是第 2 个）。
4. **导出与节流**：`utils/export-thread.ts`（纯函数：会话 → Markdown 文本）+ `utils/download.ts`
   （唯一 DOM 落盘点）+ `composables/useThrottledText.ts`（流式渲染影子，50ms 尾帧合并）。

**同时纠正三类宪章偏差**（本次改动**触达**了它们，不适用"不追溯"）：

- **3 个文件超 500 行**（原则二）：`MessageList.vue` 677、`useChatStream.ts` 594、`useChatPanel.ts` 594；
- **3 个缺失同名测试**（原则三）：`MessageCodeBlock.vue` / `MessageSegments.vue` / `utils/download.ts`；
- **4 个未登记阈值的模块**（原则三 + `vite.config.ts` 的"新增或改动模块 MUST 加入清单"）。

## 技术上下文（Technical Context）

**Language/Version**：Vue 3.5 + TypeScript 6 + Vite 8 / Vitest 5（`vue-tsc` 类型检查）。

**Primary Dependencies**：**零新增**。渲染、分段、下载全部用平台能力（字符串 / 正则 / `Blob` /
临时 `<a download>` / `URL.createObjectURL`）。MUST NOT 引入 Markdown 渲染器或 HTML 净化器。

**Storage**：无服务端存储改动。前端仅 `sessionStorage` 存"思考开关"（既有行为，本次未变）。

**Testing**：Vitest 5 + `@vue/test-utils`（jsdom）。组件测试与源码同目录 `*.spec.ts`；纯函数直接断言。
**全部在本地（宿主机）执行，容器不参与测试**（原则三）。

**Target Platform**：Windows 宿主机（开发与门禁）/ Linux 容器（交付）。本特性**无平台相关行为**
（见「平台差异登记」）。

**Project Type**：四侧一体的 Web 应用；本特性**仅 `frontend`**。

**Performance Goals**：

- 长回答（≥2000 字）期间，渲染更新频率由"每 token 一次"降到"每 50ms 至多一次"（`STREAM_TEXT_INTERVAL_MS`）；
- 渲染路径 MUST 无昂贵计算：命中换算用**二分**（`matchesBefore`），分段用**单调游标**
  （`buildSegments` 既有实现），`v-memo` 继续抑制无关气泡重渲染；
- 滚动跟随 MUST 走 `nextTick` 后的**单次赋值**（`scrollTop = scrollHeight`），不做逐帧动画。

**Constraints**：

- **单文件 ≤ 500 行**（硬门禁）：本次三个超限文件 MUST 先拆后改（D6 / D7 / D8）；
- 覆盖率地板**只上不下**；新增 / 改动模块 MUST ≥ 80% 并登记进 `frontend/vite.config.ts`；
- 零新增依赖；MUST NOT 破坏既有测试的断言口径（拆分必须零行为变化）。

**Scale/Scope**：单用户工作台；单会话数百条消息、单条正文数千字符；导出按 200 条/页全量翻页。

## 宪章检查（Constitution Check）

*门禁：Phase 0 前必须通过；Phase 1 设计后复核。*

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过（含补登记说明）** | 本目录三件套全中文；无待澄清项；`spec.md` 文首「登记说明」如实记录"先落代码、后补规格"的事实与理由；「需回写的上游条文」列 3 项（**1 改写已完成 / 2 项复核结论为"无需改动"**——其中"搜索高亮按原文计数"的口径经复核从未进过规格，改由本特性 `FR-020` 首次登记） |
| 二 代码质量与模块化边界 | **通过（含门禁驱动的拆分）** | 新模块均为单一职责：`markdown.ts`（解析）、`segments.ts`（切分）、`export-thread.ts`（文本映射）、`download.ts`（DOM 落盘）、`useThrottledText.ts`（渲染节流）、`MessageSegments.vue`（分段 → DOM，高亮与外链样式的**唯一来源**）。**拆分**：3 个超限文件按"抽 `useXxx` / 抽纯函数"拆至 ≤500 行（D6~D8） |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 新增模块全部有同名测试（`markdown.spec.ts`、`export-thread.spec.ts`、`useThrottledText.spec.ts`、`MessageContent.spec.ts` + 本次补 `MessageCodeBlock.spec.ts`、`MessageSegments.spec.ts`、`download.spec.ts`）；拆分产生的模块同样有同名测试；**测试全部本地执行** |
| 四 无障碍与可用性 | **通过** | 复制按钮为原生 `<button>` 且带 `aria-label`（随状态切换「复制代码」/「已复制代码」）；外链带 `rel="noopener noreferrer"`；「回到底部」为原生按钮 + `aria-label`；播报用 1px 裁剪的 `role="status"`（MUST NOT `display:none`）；重命名编辑框带 `aria-label`，Esc 只收编辑框 |
| 五 性能与数据一致性 | **通过** | 渲染影子的合并窗口把长回答的重渲染从 O(token) 降到 O(时间窗)；命中换算走二分；关系统一为"状态源逐 token 精确、仅渲染影子被节流"；滚动状态单一真源（`atBottom`） |
| 六 依赖治理 | **通过** | **零新增依赖**（`frontend/package.json` 依赖段不改）；自研最小子集的选型理由与"引入渲染器 + 净化器"的成本对比见摘要第 1 点 |
| 七 接口契约两侧同改 | **通过（不适用）** | 本特性**不新增接口、不改 SSE 事件、不改 `api/types.ts` 契约形状**（`Conversation` / `Message` 字段既有）；故无"两侧同改"项 |
| 八 测试部署简单可控 | **通过** | 门禁四步全部在 `frontend/` 本地一键执行（见 §「门禁」）；无新增脚本、无新增环境变量 |
| 九 优雅降级与故障可观测 | **通过** | 剪贴板不可用 → **静默不谎报**（文案不变）；导出全量拉取失败 → 提示且**不产生空文件**；链接伪协议 → 退化为纯文本（不产生"点不开的链接"）；`sessionStorage` 不可用 → 静默降级；**无新增静默吞错**：上述均为"能力不存在"而非"出错" |

## 技术决策

| # | 决策 | 理由 | 被否决的替代 |
|---|---|---|---|
| **D1** | 自研最小 Markdown 子集，**零新增依赖**；未支持的语法按纯文本输出 | 原则六：渲染器 + XSS 净化器 = 两个新依赖；既有风格零第三方；agent 输出收敛 | 引 `marked` + `DOMPurify`（新增 2 依赖 + 注入面）、`v-html` 直渲（XSS） |
| **D2** | 解析结果**一律带原文偏移** `start`；分段沿用 `buildSegments` 的可拼回不变式 | 搜索高亮的序号必须与"按原文计数"同源；偏移是两者之间唯一的换算桥梁 | 渲染后再用 DOM 文本重新计数（两套口径必然漂移） |
| **D3** | 链接**放行白名单**：`http(s)://` 与站内绝对路径；其余退化为纯文本 | "渲染增强"不得变成注入面（原则四 / 九） | 原样输出任意 `href`（`javascript:` 可执行） |
| **D4** | 渲染层"字段一律存在"的视图块（`ViewBlock` / `ViewRun`），不适用的留空 | 模板里不必对联合类型收窄，少一层"收窄写错 → 静默渲染成空"的风险 | 模板内 `v-if` 逐种收窄（分支爆炸、易漏） |
| **D5** | 渲染节流放在**装配层**（`useChatPanel` → `useThrottledText`），不改 `useChatStream` | 节流纯属渲染优化，不得污染中断 / 重试 / 落盘那些**有语义**的状态与其既有测试 | 在 `useChatStream` 内合并 token（语义状态被污染） |
| **D6** | `MessageList.vue` 拆分：**抽 `useXxx`**，把"滚动跟随 / 位置记忆 / 读屏播报"整体抽为 `useMessageScroll.ts` | 该块（约 200 行）自成一体、与 props 的耦合只有 4 个入参，是文件里最大且最内聚的一块 | 抽 `retryTurnOf` 成纯函数（只减 45 行，仍超限）；拆模板子组件（滚动状态仍需回传，反而更绕） |
| **D7** | `useChatStream.ts` 拆分：`useInteractionGate.ts`（HITL 三函数）+ `useThreadDrafts.ts`（草稿分桶）+ `utils/thinking-storage.ts`（`sessionStorage` 读写）+ `useChatStream.types.ts`（**契约与实现分离**：类型与依赖注入面）| 前三块都是"纯搬运"：把闭包变量改为显式入参，**零行为变化**；契约是**对外公开面**（被 `useChatPanel` / `MessageList` / `useAppSession` 按类型消费），与实现的变更节奏不同，分离后实现侧不必在 600 行文件里翻找类型定义；类型文件**零运行期代码**，与 `src/api/types.ts` 同口径排除出覆盖率分母 | 迁移运行时逻辑（`send()` 的终端事件处理 / `stop()`）：`controller` 是 `send` 与 `stop` 共享的闭包状态，外抽必须传访问器，可读性与正确性都更差；重组 `send()` 动核心路径，回归风险最高 |
| **D8** | `useChatPanel.ts` 拆分：`useMentionComposer.ts`（`@` 引用的编辑器侧接线）+ `useNextStepPrompt.ts`（下一步动作卡片的确认弹窗状态机） | 两者都是该文件里**自带状态与生命周期**的独立单元（可与主装配分别测试） | 抽"工具栏/头部/预览"混合块（三种不相关关注点塞进一个模块，命名必然含混） |
| **D9** | 阈值登记**一次到位**：先补测试与拆分，再单次 `test:coverage` 实测，按实测登记模块阈值并上调全局地板 | 阈值必须建立在**最终**实测之上；分两步登记会出现"先登记后被拆分作废"的返工 | 先登记再拆分（阈值可能与实测不符，需要二次修正） |
| **D10** | 导出 MUST **全量翻页**重拉，不用中栏内存里的分页窗口 | 内存里只是已加载的一页，"加载更早的消息"未点时前几十轮根本不在内存——照着它导出会**静默少内容**，而用户拿到的是文件，事后极难发现 | 用 `threads.messages`（静默截断，且失败无感） |

## 影响面清单（文件级）

> 行数为 2026-10-16 实测（`[System.IO.File]::ReadAllLines().Length`）。

| # | 文件 | 动作 | 行数 |
|---|---|---|---|
| 1 | `frontend/src/utils/markdown.ts` | 新增（纯函数：块级 + 行内解析，带原文偏移） | 313 |
| 2 | `frontend/src/utils/segments.ts` | 改动：新增 `findMatches`（与 `buildSegments` 同源）+ 头部渲染口径注释改写 | 253 |
| 3 | `frontend/src/utils/export-thread.ts` | 新增（纯函数：会话 + 消息 → Markdown 文本、文件名净化） | 74 |
| 4 | `frontend/src/utils/download.ts` | 新增（唯一的 DOM 落盘点） | 22 |
| 5 | `frontend/src/composables/useThrottledText.ts` | 新增（渲染影子，50ms 尾帧合并） | 64 |
| 6 | `frontend/src/components/chat/MessageSegments.vue` | 新增（分段 → DOM；`.mark` 与外链样式唯一来源） | 77 |
| 7 | `frontend/src/components/chat/MessageCodeBlock.vue` | 新增（等宽 + 横向滚动 + 一键复制） | 136 |
| 8 | `frontend/src/components/chat/MessageContent.vue` | 改动：块级分发 + 行内渲染（自 `MessageContent` 旧实现重写） | 330 |
| 9 | `frontend/src/components/chat/MessageList.vue` | 改动：滚动跟随 / 位置记忆 / 读屏播报 / 失败轮重试解析；**拆分**至 ≤500（D6） | **677 → 493** |
| 10 | `frontend/src/composables/useChatStream.ts` | 改动：草稿按会话分桶；**拆分**（D7） | **594 → 402** |
| 11 | `frontend/src/composables/useChatPanel.ts` | 改动：接线流式影子与导出；**拆分**（D8） | **594 → 488** |
| 12 | `frontend/src/composables/useChatStream.types.ts` | 新增（契约：状态形状 + 依赖注入面；自 `useChatStream.ts` 抽出，D7） | 148 |
| 13 | `frontend/src/composables/useMessageScroll.ts` | 新增（自 `MessageList.vue` 抽出，D6） | 220 |
| 14 | `frontend/src/composables/useInteractionGate.ts` | 新增（自 `useChatStream.ts` 抽出，D7） | 112 |
| 15 | `frontend/src/composables/useThreadDrafts.ts` | 新增（自 `useChatStream.ts` 抽出，D7） | 54 |
| 16 | `frontend/src/utils/thinking-storage.ts` | 新增（自 `useChatStream.ts` 抽出，D7） | 36 |
| 17 | `frontend/src/composables/useMentionComposer.ts` | 新增（自 `useChatPanel.ts` 抽出，D8） | 114 |
| 18 | `frontend/src/composables/useNextStepPrompt.ts` | 新增（自 `useChatPanel.ts` 抽出，D8） | 86 |
| 19 | `frontend/src/composables/useThreads.ts` | 改动：`rename` / `exportMarkdown` / `fetchAllMessages` | 376 |
| 20 | `frontend/src/components/layout/HistoryItem.vue` | 改动：行内重命名 + 导出入口（操作区三项） | 298 |
| 21 | `frontend/src/components/layout/HistorySidebar.vue` | 改动：`rename` / `export` 事件透传 | — |
| 22 | `frontend/src/views/WorkbenchView.vue` | 改动：导出编排（全量拉取 → 落盘）+ 重命名转发 | — |
| 23 | `frontend/vite.config.ts` | 改动：登记本次新增 / 拆分模块的 80% 阈值；上调全局地板 | — |

**零变更**：`agent-backend` / `admin-backend` / `admin-frontend`（全部）、`frontend/src/api/**`（契约形状未变）、
SSE 事件集合、两侧依赖（**零新增**）。

## 测试落点

| 模块 | 测试文件 | 覆盖重点 |
|---|---|---|
| `utils/markdown.ts` | `markdown.spec.ts` | 块级 7 类 / 行内 4 类 / 不支持语法原样输出 / 偏移正确性 / 未闭合围栏 |
| `utils/segments.ts` | `segments.spec.ts` | 可拼回不变式、`findMatches` 与 `countMatches` 同源 |
| `utils/export-thread.ts` | `export-thread.spec.ts` | 结构 / 角色标签 / 非正文信息不许丢 / 文件名净化 |
| `utils/download.ts` | `download.spec.ts`（**本次补**） | Blob / `<a download>` / `click` / `remove` / 对象 URL 撤销 |
| `composables/useThrottledText.ts` | `useThrottledText.spec.ts` | 窗口合并 / 复位 / 卸载清理 |
| `components/chat/MessageSegments.vue` | `MessageSegments.spec.ts`（**本次补**） | 文本 / 高亮 / 外链 / 高亮+外链叠加 / `open-link` 派发 |
| `components/chat/MessageCodeBlock.vue` | `MessageCodeBlock.spec.ts`（**本次补**） | 角标兜底 / 复制原文 / 反馈与复原 / 失败静默 / 卸载清理 |
| `components/chat/MessageContent.vue` | `MessageContent.spec.ts` | 结构 / 行内 / 段落 / 序号连续性 / 外链 / 复制 |
| `components/chat/MessageList.vue` | `MessageList.spec.ts` | 渲染 / 重试 / 滚动跟随 / 位置记忆 / 播报 |
| `composables/useMessageScroll.ts` | `useMessageScroll.spec.ts`（拆分产出） | 跟随 / 暂停 / 恢复 / 按钮真源 |
| `composables/useInteractionGate.ts` | `useInteractionGate.spec.ts`（拆分产出） | 重建 / 提交成功 / 终验失败保持打开 / 拒绝 |
| `composables/useThreadDrafts.ts` | `useThreadDrafts.spec.ts`（拆分产出） | 存旧取新 / `null` 不建桶 / 上限淘汰 |
| `utils/thinking-storage.ts` | `thinking-storage.spec.ts`（拆分产出） | 读 / 写 / 存储不可用降级 |
| `composables/useMentionComposer.ts` | `useMentionComposer.spec.ts`（拆分产出） | 标记插入与移除同步 / 按键路由 |
| `composables/useNextStepPrompt.ts` | `useNextStepPrompt.spec.ts`（拆分产出） | 三处不可用态拒绝 / 真发出才关弹窗 |

## 覆盖率缺口处置结论（宪章「同步影响报告」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）共 20 个模块尚无测试，
其**补测顺序与范围** MUST 在下一个特性的 `plan.md` 给出结论；**MUST NOT** 发起存量补齐专项。
（先例：`specs/002-conversation-runtime/plan.md` §4 确立顺序；`specs/008-*` §4 与 `specs/009-*` §4 已重申常设口径。）

**本次结论**（**沿用**既有序，不重新排序、不扩大范围）：

| 项 | 结论 |
|---|---|
| 顺序与范围 | **沿用** `specs/002-conversation-runtime/plan.md` §4 已确立的四段顺序（① 网络与契约边界 → ② 产出与预览链路 → ③ 会话与流式 → ④ 其余）；本次**不重新排序**、**不新增范围** |
| 机制 | **随改动触达即补**，不立项专项。本次触达 `useChatStream.ts` / `useChatPanel.ts` / `useThreads.ts` ⇒ 只覆盖**本次改动行为**（草稿分桶、流式影子接线、导出与重命名） |
| 与"不追溯"的关系（**关键**） | 拆分 D7 / D8 产生的 6 个新模块属"**本次创建的新文件**"，按原则三 MUST 有同名测试；其测试**只锁"搬运后的行为"**（即既有通过组件 / 组合式测试间接覆盖的路径），**MUST NOT** 借此为存量模块的其余函数补测——否则等同发起回溯性补测专项 |
| 逐文件 80% 清单（**已落地**） | 本次**新增**登记条目共 **10** 个：`utils/markdown.ts`（95.09/91/100/98.62）、`utils/export-thread.ts`（100/96.55/100/100）、`utils/download.ts`（100/100/100/100）、`composables/useThrottledText.ts`（90.47/87.5/100/90），以及 D6~D8 拆出的 6 个模块：`useMessageScroll`（94.94/80.39/100/100）、`useInteractionGate`（100×4）、`useThreadDrafts`（93.33/90.9/100/100）、`utils/thinking-storage`（87.5/100/100/87.5）、`useMentionComposer`（100×4）、`useNextStepPrompt`（100×4） |
| **不登记**的两个模块（**需复核的取舍**） | `composables/useChatStream.ts`（76.97/55.22/63.15/78.37）与 `composables/useChatPanel.ts`（56.92/49.01/27.27/58.67）属那"20 个缺口模块"之列，本次只覆盖**改动到的行为**（HITL / 草稿 / `@` 引用 / 卡片弹窗已拆成独立模块并达 87%~100%），整体口径仍低于 80%。**登记即等于对该文件发起存量补齐专项**——与「治理 § 不追溯」冲突，故**不登记阈值**，改在 `frontend/vite.config.ts` 注释与本表留下这条判断的理由 |
| 阈值取值 | 模块阈值一律按宪章下限 **80%** 登记（MUST NOT 只按实测值取整抬高，以免掩盖后续下滑）；实测值写入 `vite.config.ts` 行末注释备查 |
| 地板（**已落地**） | 全局地板**只上不下**：`59 / 63 / 48 / 58` → **`76 / 74 / 66 / 77`** @ 2026-10-16 实测 `78.01 / 75.87 / 68.80 / 78.69`（日期与四项数值已回写 `vite.config.ts` 注释） |
| 纯类型文件 | `composables/useChatStream.types.ts` 零运行期语句 → 与 `src/api/types.ts` 同口径加进 `coverage.exclude`（`v8` 本就不计入总数，排除只为消掉报告里那一行易误导的 `0 / 0 / 0 / 0`），且**不适用**原则三的"同名测试"（无可测行为） |

## 复杂度跟踪（Complexity Tracking）

| 项 | 内容 |
|---|---|
| 已知限制（登记） | ① 子集外的语法不渲染（嵌套列表 / 图片 / HTML / `_斜体_` / 脚注）；② 搜索命中落在被丢弃的标记里时**有计数、无节点**（`useSessionSearch` 按原文计数）；③ 导出只支持 Markdown；④ 滚动位置记忆仅存活于内存（刷新即失）且上限 50 |
| 被否决：把渲染交给 `v-html` | XSS 面直接打开；且"渲染后重新计数高亮"会让序号与原文口径分家 |
| 被否决：为导出引入 PDF / docx 生成 | 新增依赖 + 中文字体嵌入问题，收益（"能打印"）远小于成本 |
| 被否决：给滚动跟随加平滑动画 | `scroll-behavior: smooth` 在流式高频置底时会互相打断，反而更抖；单次赋值最稳 |
| **既有技术债（不追溯，仅登记）** | `frontend/src/api/types.ts` 489 行（≤500 但接近上限）→ 由 `specs/002` 已登记为"触发即拆"观察项，本次**未触碰** |
| **本次不豁免的债** | 三个超限文件（677 / 594 / 594）**本次均被改动**，按治理"只约束增量与本次改动文件" MUST 拆至 ≤500（FR-070） |

## 平台差异登记（宪章原则三）

**结论：本次改动无平台相关行为。** 全部改动是浏览器内的字符串 / 正则处理、`Blob` 与对象 URL、
Vue 渲染与滚动 API；不涉及文件系统、路径大小写、非 ASCII 路径、行尾符或原生模块。
本地（Windows 宿主机）与交付目标（Linux 容器）行为一致。测试全部在本地执行，容器不参与测试。

## 门禁（宪章原则八；全部在本地执行）

```text
前端  : cd frontend
        npm run test           # 全量单测（含本次新增同名测试）
        npm run test:coverage  # 覆盖率：模块 80% + 全局地板
        npm run lint           # eslint
        npm run typecheck      # vue-tsc --build --force
        # 行数门禁（frontend 无 check:lines 脚本，用同一口径手工取证）
        [System.IO.File]::ReadAllLines(<file>).Length   # 每文件 ≤ 500
```

## 验收

见 [spec.md](./spec.md) §「成功标准」（SC-001~SC-009）；任务与勾选状态见 [tasks.md](./tasks.md)。

## 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-16 | 初稿 | 事后补登记：技术上下文（零新增依赖、Vitest 5、无平台差异）、宪章九条逐条核对、D1~D10 技术决策、文件级影响面清单（含三个超限文件实测行数）、测试落点、**覆盖率缺口处置结论**（闭合宪章待办 1）、复杂度跟踪与平台差异登记、门禁与验收 |
| 2026-10-16 | 定稿 | 执行后回填：三个超限文件拆至 `493 / 402 / 488`（含 D7 追加的"契约与实现分离"）、影响面清单补 `useChatStream.types.ts` 与各拆出模块实测行数、覆盖率结论换成实测（新地板 `76 / 74 / 66 / 77` @ `78.01 / 75.87 / 68.80 / 78.69`）、新增"不登记的 2 个模块"与"纯类型文件"两行、回写清单第 2 项按复核改判（该口径从未进过规格，改由 `FR-020` 首次登记）、`segments.ts` 头部注释已改写 |
