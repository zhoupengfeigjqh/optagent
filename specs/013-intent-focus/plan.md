# 013 实施计划：意图聚焦（Intent Focus）

> **口径提示（2026-10-26）**：本计划写于 2026-10-25（`choice` 形态）。实现随后经历
> `noul → choice → noul` 的往返，最终落地为**每个候选工具一条 `noul`**（"本轮用户发起的任务是否需要使用 X ？"
> + 极简判据 `需要/不需要`）、**阈值 0.6**、**入选不设条数上限**，聚焦提示改为**软措辞**
> （「本轮可优先考虑以下工具（仅供参考，不必局限）：…」）。以
> [`spec.md`](./spec.md) 的 2026-10-26 修订记录与 [`contracts/intent-focus-api.md`](./contracts/intent-focus-api.md) §3 为准；
> 下文保留为当时的计划快照。

- **特性标识**：`013-intent-focus`
- **计划日期**：2026-10-25
- **规格**：[spec.md](./spec.md)（Q1~Q3 已收敛；Q1 已细化为"Laya 多语言版 + 容器 + 直连"）
- **影响范围**：`agent-backend`、`frontend`、`admin-backend`、`admin-frontend`（四侧，宪章原则七）+ 根编排新增一个模型服务
- **技术栈**：沿用四侧既有栈（Node ≥20 / TS 6 / Fastify 5 / Vue 3.5 + Vite），**零新增第三方依赖**（宪章原则六）
- **用户补充口径**（2026-10-25，进入 `/speckit.tasks` 前）：模型镜像固定 **`chaitin/decis:laya-multilingual-v0.4.0`**；
  判定阈值 MUST 支持环境变量 **`INTENT_FOCUS_THRESHOLD`**（优先于配置文件）
- **门禁**：本地执行（宪章原则三/八），容器不参与
- **设计产物**：[research.md](./research.md)（F1~F11 取证 + D1~D13 决策 + 12 项被否决方案）、
  [data-model.md](./data-model.md)、[contracts/intent-focus-api.md](./contracts/intent-focus-api.md)、[quickstart.md](./quickstart.md)

---

## 概要（Summary）

开启「意图聚焦」的数字人，用户每提交一条消息（`POST /api/threads/{id}/messages`），运行环境在**主对话模型调用之前**，
用**独立容器部署的 Laya 多语言决策模型（`laya-multilingual`）**做一次结构化判定：发**一条 `choice` 命题**
（选项 = 各候选工具 + `__none__`"无需工具"），拿回**互斥概率**；按 `threshold`（默认 0.5）+ `maxActions`（默认 3）筛出**工具组合**，铸成固定文案
「请将当前规划重点聚焦于：<工具英文名>，<工具英文名>」追加到**本轮** `systemExtra`（`guidance` 之前）。

判定**只作用于本轮的规划范围**：不进历史、不进摘要、不进后续轮次素材、不在界面出现。每轮判定（含空结果、跳过、降级、未配置）
单独追加到**当前线程目录**的 `intent-focus.jsonl`，供事后统一分析。

点击**下一步动作卡片**或**首屏问题实例卡片**发起的轮次，前端在请求体带 `skip_intent_focus: true`，服务端据此跳过判定
（服务端可校验，不依赖前端自律）。开关落在数字人 SOUL 配置的复选框「意图聚焦」（默认关闭），经部署物化后由运行环境逐次读盘。

---

## 技术上下文（Technical Context）

**Language/Version**：后端 Node ≥ 20 + TypeScript 6（ESM，`tsc` 直出）；前端 Vue 3.5 + TypeScript 6 + Vite

**Primary Dependencies**：后端既有 Fastify 5 / `zod` / `yaml` / `pino` / `pi-ai`（**主对话**模型用）；前端既有 Vue 3 / `ant-design-vue` / Tailwind / `pinia` / `axios`。**本次零新增依赖**：判定调用用平台原生 `fetch`，记录落盘用 `node:fs`，弹窗/卡片/开关全部复用既有实现。

**Storage**：文件系统
- 线程记录：`users/{uid}/user-data/{agentName}/threads/{threadId}/intent-focus.jsonl`（新增，独立于 `history.jsonl` / `next-actions.json`）
- 配置：既有 `SOUL.md` frontmatter（新增键 `intent_focus`）；`config.yaml` 新增可选块 `intent_focus`；
  **判定阈值另可由环境变量 `INTENT_FOCUS_THRESHOLD` 覆盖（优先于配置文件）**

**Testing**：Vitest 5。后端 `tests/unit`（纯逻辑：筛选/铸造/记录）+ `tests/integration`（发送端点、判定链路、降级）；前端与源码同目录 `*.spec.ts`。**不依赖真实 Laya 与真实 LLM**（一律桩：注入 `fetch` 或注入判定端口实现）。

**Target Platform**：交付 Linux 容器（gateway → nginx + Node 服务 + 新增 Laya 模型容器）；开发/本地测试在 Windows 宿主机。差异见「复杂度跟踪」。

**Project Type**：四侧一体的 Web 产品（运行侧 `agent-backend` + `frontend`，管理侧 `admin-backend` + `admin-frontend`）+ 根编排新增一个推理容器。

**Performance Goals**：
- 判定在**主链路之前**，故额外等待有硬上限：`timeout_ms` 默认 **3000ms**、配置上限 **5000ms**；判定成功时 P90 **≤ 2s**（规格 SC-002）
- 判定**不改变**流式首字节之后的任何时序；不新增公开端点 ⇒ 无新增 P95 端点指标
- 前端零新增渲染路径（只多一个请求字段），点击/发送反馈仍 ≤ 100ms

**Constraints**：单文件 ≤500 行（**硬门禁**，本次涉及 2 个贴线/超限文件，见 D12/D13）；新增模块覆盖率 ≥80%；零新增依赖；平台 → 运行环境单向整体覆盖；镜像固定版本化 tag；判定不经 MCP。

**Scale/Scope**：单用户工作台；每条消息一次判定请求；每次 ≤ 24 个命题；每轮 0~3 个动作；单线程记录 ≤ 200 行 / 256KB。

---

## 宪章检查（Constitution Check）

*门禁：Phase 0 研究之前 MUST 通过；Phase 1 设计之后复核。*

### 逐条核对（v2.2.0，九条原则）

| 原则 | 结论 | 依据 |
|---|---|---|
| 一 中文文档与规格驱动 | **通过** | 四件套 + 契约全中文；Q1~Q3 已收敛，Q1 细化已回写 spec 并登记修订记录 |
| 二 代码质量与模块化边界 | **通过（含必要拆分）** | 判定逻辑（纯函数）/ 记录存储 / 协议适配器三者分层；`run-manager.ts` **539 行存量超限且本次必然触及 ⇒ 拆分**（D12）；`server.ts` 498 行贴线 ⇒ 装配外移（D13）；主链路与判定各自唯一实现 |
| 三 测试完备性（NON-NEGOTIABLE） | **通过** | 新模块同名 spec；纯函数逐字断言（确定性）；降级路径全部有用例；端点集成测试覆盖 `skip_intent_focus`；**测试全部本地执行**；新增模块 ≥80% |
| 四 无障碍与可用性 | **通过** | 管理台开关为原生 `<input type="checkbox">` + `<label>`（键盘可达、焦点可见、不靠颜色传达）；聊天前台**零新增交互控件** |
| 五 性能与数据一致性 | **通过** | 判定有界（超时上限、不重试、候选上限 24）；记录重写为**原子替换**；记录追加 per-thread **串行**（D5）；无 N+1、无前端昂贵计算 |
| 六 技术治理与依赖控制 | **通过（含新增基础设施说明）** | 零新增**代码**依赖；新增的是**推理容器**（Laya 官方镜像，CPU 运行），必要性见 research F1/F3 + 规格"影响面评估"，固定版本化 tag（D11）；会话/判定不使用任何第三方 SDK |
| 七 接口契约与前后端一致性 | **通过** | 请求体新字段四处同步（前端类型 / 前端构造 / 后端 schema / 后端类型声明 + 集成测试）；`admin-api.md` 与 `runtime-api-delta.md` 同次回写；SSE 与详情接口**显式零变更** |
| 八 测试与部署的简单可控 | **通过** | 四侧各一条命令跑门禁；新增容器用 `docker compose up -d laya` 一条命令；`quickstart.md` 给部署核对清单 + 非交互冒烟 |
| 九 优雅降级与故障可观测 | **通过** | 七类失败（超时 / 非 200 / 形状非法 / 未配置 / 记录失败 / 无工具 / 跳过）逐一定义处置；用户无感但原始错误落结构化日志（含 `alert: true`、`reason`、`status`）；超时不重试；降级路径全部有用例 |

**门禁判定：PASS，无宪章例外**。`Complexity Tracking` 登记的是风险、成本与存量状态，不是对原则的豁免。

### Phase 1 设计之后复核

- 契约面未扩大：**不新增公开端点**，只为既有发送端点加一个可选布尔字段；SSE / 详情 / `next-actions` / 数字人详情显式零变更；
- 未触碰两个存量超限文件（`next-actions.ts` 543、`frontend/src/api/types.ts` 525），符合"不追溯"；
- 开关沿用 SOUL frontmatter，**不新增配置文件形态**（唯一新增是 `config.yaml` 的一个可选块，属运行环境既有配置面，见复杂度跟踪）；
- 判定能力**不进入工具清单**，工具权限模型零变更（FR-054 / I-6）。

---

## 项目结构（Project Structure）

### 文档（本特性）

```text
specs/013-intent-focus/
├── spec.md                          # 已产出（/speckit.specify + Q1 细化回填）
├── plan.md                          # 本文件（/speckit.plan）
├── research.md                      # Phase 0：取证 F1~F11 + 决策 D1~D13 + 被否决方案
├── data-model.md                    # Phase 1：设计态→物化→运行态→接口→记录
├── contracts/
│   └── intent-focus-api.md          # Phase 1：四段契约增量（须回写 specs/001 两份）
├── quickstart.md                    # Phase 1：容器起法 + 门禁 + S1~S8 + 冒烟 + 阈值标定
├── checklists/requirements.md       # 规格质量检查表
└── tasks.md                         # Phase 2 产出（/speckit.tasks，不在本命令范围）
```

### 源码（仓库实际布局）

```text
agent-backend/
├── src/domain/
│   ├── intent-focus.ts              # 新增：候选截断 / 命题构造 / 概率→动作 / 提示铸造 / 处置判定（纯函数）
│   ├── intent-focus-store.ts        # 新增：intent-focus.jsonl 追加 + 有界重写（原子）+ per-thread 串行
│   ├── run-consume.ts               # 新增：consume 纯搬运（D12，把 run-manager 压到 ≤500）
│   ├── soul.ts                      # 修改：SoulMeta.intentFocus + parseSoulMeta + isIntentFocusEnabled
│   ├── prompt-builder.ts            # 修改：PromptSources.focusPrompt，插在 guidance 之前
│   └── run-manager.ts               # 修改：StartRunOptions.skipIntentFocus、判定前置、consume 外移
├── src/infra/laya-client.ts         # 新增：System One 线协议适配器（原生 fetch + 超时 + 错误分类）
├── src/server-attachments.ts        # 新增：summary / nextActions / intentFocus 装配（D13）
├── src/routes/chat.ts               # 修改：schema + body 类型 + 传参
├── src/context.ts                   # 修改：暴露 intentFocus 端口（供路由注入 RunManager）
├── src/server.ts                    # 修改：改为调用 server-attachments（净减行数）
├── src/config.ts                    # 修改：解析可选 intent_focus 块
├── config.example.yaml              # 修改：加注释示例
├── vitest.config.ts                 # 修改：四个新模块进 80% 清单（intent-focus / runner / store / laya-client）
└── tests/{unit,integration}/        # 新增 intent-focus / intent-focus-store / laya-client / chat-skip 用例

frontend/
├── src/api/messages.ts              # 修改：SendMessageInput.skipIntentFocus + 请求体构造
├── src/composables/useChatStream.ts # 修改：透传 skipIntentFocus
├── src/composables/useChatPanel.ts  # 修改：onSend 载荷 + 透传
├── src/utils/next-steps.ts          # 修改：nextStepSendPayload 置 true
└── src/components/chat/ChatPanel.vue# 修改：onStarterClick 置 true

admin-backend/
├── src/domain/config-center/soul-design.ts    # 修改：字段 + readBool + 仅 true 时渲染
└── src/domain/config-center/agent-design.ts   # 修改：withSoulDefaults 补 false

admin-frontend/
├── src/api/soul.ts                  # 修改：类型
├── src/constants/agent-design.ts    # 修改：emptySoulDesign
├── src/composables/useAgentDesign.ts# 修改：cloneSoul 显式列字段
└── src/components/agents/SoulEditor.vue # 修改：复选框「意图聚焦」+ 说明

根编排
└── docker-compose.yml               # 修改：新增 laya 服务（固定 tag / 8103 / DECIS_API_KEY）

specs/001-digital-human-platform/contracts/
├── admin-api.md                     # 修改：SOUL 字段表新增 intent_focus
└── runtime-api-delta.md             # 修改：消息请求体新增 skip_intent_focus；frontmatter 新键；线程目录新文件
```

### 结构决策（Structure Decision）

- **后端保持 `routes → domain → infra`**：判定协议适配器在 `infra/`（唯一网络出口），筛选与铸造在 `domain/`（纯函数，无 IO），记录在 `domain/`（唯一文件出口）；`routes` 只做请求校验与传参。
- **判定能力不是工具**：不进 `src/infra/mcp/**`、不进 `TOOL.json`/`MCP.json`、不进 `agent-factory` 的工具装配（FR-054）。
- **两个拆分（D12/D13）是硬门禁要求**，不是顺手重构；抽取 MUST 为纯搬运。
- **前端零新增组件**：只加一个请求字段与两个置位点（`useNextStepPrompt` 与 `ChatPanel.onStarterClick` 归口到 `utils/next-steps.ts` 与一处 `onSend` 载荷）。

---

## 1. 技术决策（D1~D13 摘要）

完整论证见 [research.md](./research.md)：

| 决策 | 结论 |
|---|---|
| D1 | 走 **System One 线协议** `/v1/systemone`（Laya 是决策模型，官方未列出对话补全端点） |
| D2 | **一条 `choice` 命题，`criteria` 的键 = 工具名 + `__none__`**（2026-10-25 真实模型标定后**反转**了原决策「每工具一条 `noul`」：`noul` 逐题独立校准、互不竞争，"天气" 也能让 `erp__query_bom` 拿到 0.91，阈值切不开；`choice` 的 softmax 互斥 + `__none__` 出口后 top1 对 7/10、入选精确率 7/8。详见 `tasks.md` T051） |
| D3 | 判定能力**不注册为工具、不经 MCP**（用户口径 + 避免主模型自行决定是否聚焦） |
| D4 | **阻塞式前置**，超时 3000ms（上限 5000）、**不重试** |
| D5 | 记录落 `intent-focus.jsonl`：独立文件 + per-thread 串行 + 有界重写（原子） |
| D6 | 开关走 `SOUL.md` frontmatter `intent_focus`（仅 true 时写，运行侧 fail-closed 逐次读盘） |
| D7 | 跳过标记 `skip_intent_focus` 走请求体（服务端可校验），两个预置动作入口置位 |
| D8 | 聚焦提示插在 `systemExtra` 的 `guidance` **之前**（保住"本轮指令最末段"的既有口径） |
| D9 | `threshold=0.5`（**可由 `INTENT_FOCUS_THRESHOLD` 环境变量覆盖，优先于配置文件**）/ `max_actions=3` / 候选上限 24；概率降序 + 同概率按清单原序（确定性） |
| D10 | `config.yaml` 新增可选块 `intent_focus`；令牌**独立解析**，不走 `DEEPSEEK_API_KEY` 兜底；阈值两源（env 优先），其余参数单源（仅配置块） |
| D11 | 镜像 `chaitin/decis:laya-multilingual-v0.4.0`（**固定版本**），env 按模型要求注入 |
| D12 | `run-manager.ts` 539 → 拆出 `run-consume.ts` |
| D13 | `server.ts` 498 → 附加能力装配外移到 `server-attachments.ts` |

---

## 2. 文件级改动（含实测基线）

> 行数为 **2026-10-25 实测**（`node` 逐文件计数）。带 ⚠️ 为存量超限或贴线文件。

### 2.1 `agent-backend`

**新增**

| 文件 | 职责 | 预估 |
|---|---|---|
| `src/domain/intent-focus.ts` | `buildQuestions`（候选截断 24 + 命题铸造）、`selectActions`（阈值 + 上限 + 稳定排序）、`composeFocusPrompt`（固定格式、去重）、`decideDisposition`（五态） | ~200 |
| `src/domain/intent-focus-store.ts` | `append`（串行 + 追加）、`compact`（>256KB 或 >200 行 → 保留 100 条，临时文件 + `renameSync`）、`seq` 维护 | ~130 |
| `src/infra/laya-client.ts` | `SystemOneClient.decide()`：`fetch` + `AbortSignal.timeout` + 状态码分类 + 响应形状容错；**不重试** | ~140 |
| `src/domain/run-consume.ts` | `consumeTurn(...)`：`consume` 的**纯搬运** + 判定前置调用（D12） | ~215 |
| `src/server-attachments.ts` | `buildAttachments(...)`：`summary` / `nextActions` / `intentFocus` 装配与告警节流（D13） | ~80 |
| `tests/unit/intent-focus.spec.ts` | 0/1/3/4 个动作、阈值边界、同概率稳定序、提示格式与去重、候选截断、五态判定 | — |
| `tests/unit/intent-focus-store.spec.ts` | 追加串行、混合处置各一行、超限滚动、重写原子性（失败保留原文件）、坏行容错 | — |
| `tests/unit/laya-client.spec.ts` | 200 正常 / 401 / 503 / 422（带响应体摘要）/ 响应体读取失败 / 非 JSON / 缺 `answers` / 缺概率 / 概率非数字 / 超时（Abort） | — |
| `tests/integration/chat-intent-focus.spec.ts` | 端点：手输触发判定、`skip_intent_focus: true` 跳过、开关关闭零调用、未配置降级、回答与 SSE 形状不变 | — |

**修改**

| 文件 | 基线 | 改动 | 位置 |
|---|---|---|---|
| `src/domain/run-manager.ts` ⚠️ | **539** | `StartRunOptions` 加 `skipIntentFocus?`；`consume` 整体移到 `run-consume.ts`（净减 ~190）；`buildPrompt` 增 `focusPrompt` 入参；`RunManagerDeps` 加 `intentFocus?` | 类型区 / L326-348 / L350-537 |
| `src/server.ts` ⚠️ | **498** | 三处附加能力装配改为调用 `server-attachments.ts`（净减 ~28）；注入 `intentFocus` | L132-138 / L248-… |
| `src/domain/soul.ts` | 338 | `SoulMeta.intentFocus`；`parseSoulMeta` 读 `intent_focus`（非布尔 → false）；新增 `isIntentFocusEnabled()`（fail-closed） | 类型区 + L105-129 + 文件末尾 |
| `src/domain/prompt-builder.ts` | 101 | `PromptSources.focusPrompt?`；在 `guidance` 之前插入（有内容才占位） | L88-99 |
| `src/routes/chat.ts` | 295 | schema 加 `skip_intent_focus: {type:'boolean'}`；body 类型同步；传给 `startRun` | L40-65 / L126-132 / 调用处 |
| `src/context.ts` | 41 | **不改动**：判定端口只经 `RunManagerDeps.intentFocus` 注入，`routes/chat.ts` 不直接判定 | — |
| `src/config.ts` | 224 | `intentFocusSchema`（optional）+ 冻结字段；`base_url` http(s) 校验；`envSchema` 新增 `INTENT_FOCUS_THRESHOLD`（0~1，可选）并**覆盖**配置块里的 `threshold`；越界即启动失败 | `envSchema` / `yamlSchema` / `AppConfig` / `loadConfig` |
| `config.example.yaml` | 16 | 新增带注释的 `intent_focus` 示例（含"缺失即功能不可用"说明） | 文件末尾 |
| `vitest.config.ts` | 205 | 逐模块 80% 清单追加三个新模块 | 清单末尾 |

**不加**：`next-actions.ts`（543 行存量超限，本特性零改动）、`agent-factory.ts`（判定不进工具装配）、`run-events.ts`（SSE 零变更）、`agent-catalog.ts`（开关不下发前端）。

### 2.2 `frontend`

| 文件 | 基线 | 改动 |
|---|---|---|
| `src/api/messages.ts` | 229 | `SendMessageInput.skipIntentFocus?: boolean`；`buildSendMessageBody` 仅在 `true` 时写 `skip_intent_focus` |
| `src/composables/useChatStream.ts` | 405 | `send()` 载荷加该字段并透传（保持"空值省略"风格） |
| `src/composables/useChatPanel.ts` ⚠️ | **486** | `onSend` 的 `payload` 加 `skipIntentFocus?`，`chat.send` 透传；**新增行数 ≤6**，改后复测 ≤500 |
| `src/utils/next-steps.ts` | 47 | `nextStepSendPayload()` 返回 `skipIntentFocus: true`（下一步动作卡片） |
| `src/components/chat/ChatPanel.vue` ⚠️ | **474** | `onStarterClick` 的 `onSend` 载荷加 `skipIntentFocus: true`（首屏问题实例卡片） |
| 同名 `*.spec.ts` | — | `buildSendMessageBody` 含/不含字段；`nextStepSendPayload` 置位；`onStarterClick` 置位 |

**不加**：`src/api/types.ts`（525 行存量超限）、`MessageBubble.vue` / `MessageNextSteps.vue`（展示零变更）、任何新组件。

### 2.3 `admin-backend`

| 文件 | 基线 | 改动 |
|---|---|---|
| `src/domain/config-center/soul-design.ts` ⚠️ | **490** | `SoulDesign.intent_focus?: boolean`；`emptySoulDesign` / `fromLegacySoul` 落 `false`；`readBool` 复用；`renderSoulMd` **仅 true 时**写 `intent_focus: true`；改后复测 **≤500**（预计 +6） |
| `src/domain/config-center/agent-design.ts` | 423 | `withSoulDefaults` 补 `intent_focus: false`（对外契约恒有该键） |
| `tests/unit/soul-design.spec.ts` | — | 缺省 false / true 渲染出键 / false 不写键 / 非布尔拒绝 / 旧设计态升级为 false |

### 2.4 `admin-frontend`

| 文件 | 基线 | 改动 |
|---|---|---|
| `src/api/soul.ts` | 59 | `SoulDesign.intent_focus: boolean` |
| `src/constants/agent-design.ts` | 128 | `emptySoulDesign()` 补 `intent_focus: false` |
| `src/composables/useAgentDesign.ts` | 243 | `cloneSoul` 显式补该字段（字段清单契约，漏则"复制数字人"丢配置） |
| `src/components/agents/SoulEditor.vue` | 329 | 在「是否开启下一步动作提示」之后新增复选框「意图聚焦」（原生 checkbox + label + 一句说明：勾选则每轮先做意图判定；未勾选则跳过） |
| `src/components/agents/SoulEditor.spec.ts` | — | 渲染存在 / 默认未勾选 / 勾选后 emit 含 `intent_focus: true` |

### 2.5 根编排

| 文件 | 改动 |
|---|---|
| `docker-compose.yml` | 新增 `laya` 服务：`image: chaitin/decis:laya-multilingual-v0.4.0`、`container_name: optagent-laya`、`ports: ["8103:8000"]`、`mem_limit: 6g`、`environment: DECIS_API_KEY / DECIS_SHUTDOWN_GRACE_MS=25000`、`restart: unless-stopped`、`logging: *default-logging`；`backend` 加 `depends_on: laya`（软依赖，不因此阻塞启动——判定失败可降级） |

### 2.6 契约文档

| 文件 | 改动 |
|---|---|
| `specs/001-.../contracts/admin-api.md` | §5 SOUL 字段表新增 `intent_focus`（布尔，可选，缺省 false）+ 拒绝式校验口径 |
| `specs/001-.../contracts/runtime-api-delta.md` | `SOUL.md` frontmatter 新键；消息请求体新增 `skip_intent_focus`；线程目录新增 `intent-focus.jsonl`；显式声明 SSE / 详情 / `next-actions` 零变更 |
| `specs/001-.../data-model.md` | 若维护 SOUL 字段表，同步一行 |
| `specs/013-.../contracts/intent-focus-api.md` | 已产出；上述落地后 MUST 与其一致 |

---

## 3. 分期（每期独立可验收）

| 期 | 内容 | 验收（本地） |
|---|---|---|
| **P1 模型服务与协议适配** | `docker-compose.yml` 的 `laya` 服务 + `infra/laya-client.ts` + 单测（含超时/坏形状） | `docker compose up -d laya` 后 `/healthz`、`/readyz`、`/v1/models` 通；client 单测全绿；`intent-focus` 相关零新增依赖 |
| **P2 判定与记录（运行侧核心）** | `domain/intent-focus.ts` + `intent-focus-store.ts` + `config.ts` 解析 + `soul.ts` 开关读取 + `prompt-builder` 注入 + `run-manager` 判定前置与拆分（`run-consume.ts`）+ `server-attachments.ts` | 纯函数单测逐字断言（含确定性排序）；记录串行/滚动/原子；`run-manager*.spec.ts` 全绿且 `run-manager.ts ≤500`；`server.ts ≤500`；降级七态各 1 例 |
| **P3 发送链路与跳过标记** | `routes/chat.ts` schema/类型 + `StartRunOptions` + 前端四处（api / stream / panel / 两个置位点）+ 集成测试 + 两份上游契约回写 | 集成：手输触发、卡片跳过、开关关闭零调用、未配置降级；回答与 SSE 形状逐字不变；前后端 schema 一致（含 400 用例） |
| **P4 管理台开关与验收** | `admin-backend`（字段/校验/渲染）+ `admin-frontend`（复选框/初值/深拷贝）+ 测试 + 阈值标定（`quickstart §7`）+ 冒烟 | 开 → 产物有键、关 → 无键；System Prompt 开/关逐字一致；两侧 `test:coverage` 绿；四侧门禁全绿；S1~S8 通过 |

**依赖顺序**：P1 → P2 → P3 → P4（P4 的端到端验收依赖前三期）。

---

## 4. 存量补测顺序与范围结论（宪章文首待办第 1 项，MUST 在下一个特性的 plan 给出）

宪章 2.2.0 文首规定：`frontend` 的 `src/api/**`（7 个）与 `src/composables/**`（13 个）共 20 个模块仍为 0%，
**MUST NOT 发起存量补齐专项**，但补测顺序与范围 MUST 在下一个特性的 `plan.md` 给出结论。本特性即为"下一个特性"，结论如下：

| 项 | 结论 |
|---|---|
| 是否发起存量补齐专项 | **否**（宪章明令禁止；本特性不例外） |
| 本特性会触及的 0% 模块 | `frontend/src/api/messages.ts`、`frontend/src/composables/useChatStream.ts`、`frontend/src/composables/useChatPanel.ts`、`admin-frontend/src/api/soul.ts` —— **改动部分及其直接受影响的用例**必须合规（新增分支有断言），但**不补齐整模块历史分支** |
| 补测顺序（后续沿用） | ① 被新特性触及的模块 → ② 与容错/降级相关且频繁出问题的模块（`useChatStream` → `useChatPanel` → `api/messages`）→ ③ 纯函数型 `utils/**` → ④ 其余 `api/**` 与 `composables/**` |
| 补测范围边界 | 只补"与本次改动同文件、且被改动直接影响的行为"；不新增针对旧行为的回溯断言；覆盖率地板只上不下 |
| 登记方式 | 本条即结论；后续特性若改变顺序，MUST 在其 `plan.md` 显式说明变更理由 |

---

## 5. 复杂度跟踪（Complexity Tracking）

| 项 | 登记 |
|---|---|
| **宪章例外** | **无**。九条原则逐条通过（见「宪章检查」）。 |
| **存量超限文件（本次处置）** | `agent-backend/src/domain/run-manager.ts` **539 行**（存量超限且本次必然触及 ⇒ 拆出 `run-consume.ts`，D12）；`agent-backend/src/server.ts` **498 行**（贴线且本次要加装配 ⇒ 装配外移，D13）。两者抽取 MUST 为纯搬运。 |
| **存量超限文件（本次不处置）** | `agent-backend/src/domain/next-actions.ts` **543 行**、`frontend/src/api/types.ts` **525 行**：本特性零改动，按治理"不回溯"不处置；**本特性 MUST NOT 在其中新增代码**。 |
| **贴近上限的文件（需盯）** | 实现后实测：`useChatPanel.ts` **434**、`ChatPanel.vue` **435**、`routes/chat.ts` **316**（新增严格校验后仍在门禁内）；`run-manager.ts` **343**、`server.ts` **466**、`config.ts` **419**。全部 ≤500。 |
| **`soul-design.ts` 第三次贴线（本次处置）** | 新增 `intent_focus` 字段说明后该文件涨到 **510 行**（超门禁）⇒ 按职责外移：`soul-limits.ts`（字段上限，渲染/读取器/前端计数共用）+ `soul-fields.ts`（拒绝式字段读取器）。`soul-design.ts` 383 行，原 `SOUL_LIMITS` 导出保留（`export { SOUL_LIMITS } from './soul-limits.js'`），调用方零改动。 |
| **首字节延迟（阻塞式前置的代价）** | 已登记：判定在主模型调用**之前**（FR-001 的硬要求），故用户会多等一次判定。**被否决的更简方案**：异步生成、下一轮生效 —— 与"每次对话必须先判断"冲突，且用户看到的是"这轮没聚焦"。**处置**：超时 3000ms（上限 5000）、不重试、候选上限 24、`round_ms` 落记录以便持续观察；成功时 P90 ≤ 2s（SC-002）。 |
| **阈值与题量的标定不确定性** | 已登记：Laya 的真值概率在"多题同批"下是否可比，需一次实测标定（`quickstart §7`）。**被否决的更简方案**：写死 0.5 不标定 —— 会导致"总是空结果"或"总是全选"，功能事实上失效。**处置**：阈值可配置 + 记录保留全量概率（`probabilities` 字段）便于事后重算。 |
| **新增基础设施（推理容器）** | 已登记：新增一个**推理容器**（非代码依赖）。必要性：需求明确"独立轻量决策模型 + 容器部署"，且主对话模型不能承担该判定（成本与语义都不对）。镜像 **2.91GB**（本地磁盘占用；压缩口径 0.88GiB。本地自建，默认 CPU 版 torch；官方同 tag 的压缩量为 4.1GB）、内存上限 6GB、冷启动约 1~2 分钟 —— 部署成本已写入 `quickstart §1/§2`。**镜像由源码构建**（`laya-service/`），CUDA/CPU 通过 build-arg 切换。 |
| **新增配置面（唯一）** | `config.yaml` 新增可选块 `intent_focus`。**理由**：不能塞进 `models` 数组（会改变"默认模型 = 第一项"的既有语义）。**不新增配置文件**；块缺失即功能不可用（fail-closed），对存量部署零影响。 |
| **平台差异（Windows 本地 / Linux 容器）** | 已登记：① 记录重写走"临时文件 + `fs.renameSync` 原子替换"，Windows 上目标被占用时可能 `EPERM` ⇒ 失败保留原文件 + 告警（MUST NOT 抛错）；② `fetch` 超时统一用 `AbortSignal.timeout`，两平台一致；③ 配置地址在容器内必须是服务名 `http://laya:8000`，本地直跑是 `http://127.0.0.1:8103`（与既有 `PUBLIC_BASE_URL` 同一类坑，`quickstart` 显式标注）。 |
| **契约面控制（本次决定）** | **不新增公开端点**：只给既有发送端点加一个可选布尔字段。SSE、会话详情、`next-actions`、数字人详情、工具清单**显式零变更**（写进契约 §7，避免后人误加）。 |
| **请求体严格校验（本次决定）** | `skip_intent_focus` 是**服务端可校验标记**，错配只会表现为"该跳过的没跳过"，无报错可循。Fastify 默认 ajv 是 `coerceTypes: true` + `removeAdditional: true`（`"true"` → `true`、`skipIntentFocus` 被静默丢弃）⇒ 在 `routes/chat.ts` 的 `preValidation` 加严格校验（未知字段 400、非布尔 400）。**作用域仅本路由**，不全局改 ajv 选项（避免波及其余端点）。 |
| **判定模型参数的配置严谨化（本次决定）** | 区间与缺省值单处定义（`INTENT_FOCUS_LIMITS` / `INTENT_FOCUS_DEFAULTS`）；`intent_focus` 块 `strict()`（拼错键即启动失败）；`INTENT_FOCUS_THRESHOLD` **空串视为未设置**（`z.coerce.number('')` → `0` 会让全部工具入选且零报错）；`base_url` 带路径即拒绝（否则拼出 `/v1/v1/systemone`）；报错一律"指名 YAML 路径 + 区间 + 当前值"。 |
| **判定能力与工具清单的隔离（必须守住）** | 判定**不注册为工具、不经 MCP**（FR-054）。否则主模型会在工具循环里自行决定"要不要聚焦"，破坏"每次必先判定"的确定性，且会让 007 的 Tail Protocol 指令多一项无关工具。 |
| **记录文件的存储决策** | 独立 `intent-focus.jsonl`（不复用 `history.jsonl` / `next-actions.json` / `meta.json`）。**理由**：FR-011（不进历史）必须在存储层成立，任何"读历史即组装上下文"的实现路径都不该有机会带上它。 |
| **已知存量观察（不在本次范围）** | `admin-backend` 等子项目 `package.json` 的 `description` 含非法 UTF-8 字节问题（007 已登记）——本特性不触碰、不修。 |

---

## 6. 门禁（本地单命令，宪章原则八）

```powershell
cd agent-backend;   npm run lint; npm run typecheck; npm run test; npm run test:integration; npm run test:coverage; npm run build
cd frontend;        npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-backend;   npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-frontend;  npm run lint; npm run typecheck; npm run test:coverage; npm run build
```

**硬门禁三项**：新增模块覆盖率 ≥80%（全局地板只上不下）；单文件 ≤500 行；依赖清单无未记录新增。

- `agent-backend` / `frontend` 既有**无** `check:lines` / `check:deps` 脚本 ⇒ 这两项按**人工复核 + 本计划登记的实测基线**核对，并在 `tasks.md` 记录复核结果；`admin-backend` / `admin-frontend` 用既有脚本。
- 复测项：`run-manager.ts` 539 → ≤500；`server.ts` 498 → ≤500；`soul-design.ts` 490 → ≤500；`useChatPanel.ts` 486 → ≤500。

**部署后**：按 `quickstart.md §6` 执行**非交互冒烟**（`/api/models`、Laya `/v1/models`、带 `skip_intent_focus` 的发送打点、历史文件不含聚焦提示）。
该步骤只确认部署成功，**MUST NOT** 作为测试结论。

---

## 7. 交付物与后续

- **本命令产出**：`research.md`、`data-model.md`、`contracts/intent-focus-api.md`、`quickstart.md`、本 `plan.md`（并已回填 `spec.md` 的 Q1 细化与修订记录）。
- **下一步**：`/speckit.tasks` 按 P1~P4 生成 `tasks.md`；实现后跑 `/speckit.analyze` 做规格—计划—任务一致性核查。
- **实现期必须盯住的三处口径**：
  1. 判定在**主模型调用之前**完成且**从不重试**（否则 SC-001/SC-002 失效）；
  2. 记录文件**没有任何读取方**（否则 FR-011 在实现层被破坏，测试要断言"上下文组装不读该文件"）；
  3. `run-manager.ts` 与 `server.ts` 的抽取 MUST 为纯搬运，改后复测行数并跑既有全量单测。
