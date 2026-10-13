# 007 修订规格：问题卡片并入主回答流（Tail Protocol）

- **状态**：已评审待实施（本文件先于任何代码改动落地）
- **日期**：2026-10-12
- **修订性质**：MAJOR——"下一步动作提示"的生成机制由"独立 LLM 调用"重定义为"主回答流内嵌尾部结构化块"，生成超时、拉取窗口、读取判据等原则随之重定义
- **动机**：
  1. 现行实现（`NextActionsStore.produce`）在 `done` 之后发起**独立 LLM 调用**，其 token 消耗不落入本轮 `usage`，用量统计失真——不可接受；
  2. "done 之后才生成"迫使前端维护 `[0,1500,3500,6000]` 拉取窗口与代次作废机制，存在时序竞态（已实际发生"卡片延迟一轮"缺陷）；
  3. 读取侧 `currentAgent === snapshot.agent_name` 判据导致切换数字人后卡片消失，与产品预期不符。

---

## 1. 目标与非目标

**目标**

- G1 卡片与回答在**同一次 LLM 调用**中产出，token 全额计入本轮 `usage`；
- G2 开关与条数仍由 SOUL 配置驱动（`next_action_hints` / `next_action_hints_count`），仅影响提示词装配；
- G3 每会话仅持久化**最新一轮**卡片（既有单快照语义不变），历史轮次不保留、不落盘；刷新后最新卡片可恢复；
- G4 卡片持久化与恢复**与当前选中数字人无关**（删除读取侧数字人判据）；
- G5 删除前端拉取窗口与轮询竞态机制，卡片在 `done` 时刻确定性到达。

**非目标**

- 不改变卡片的"开放式问题 + 可选工具绑定"口径（`tools` 允许为空，不强制绑定）；
- 不改变卡片点选 → 二次确认 → `guidance` 隐藏通道的 US2 链路；
- 不引入结构化输出 / Function Calling 协议（解析层已隔离，将来可平滑替换）。

---

## 2. 方案对比与决策

| 方案 | token 归账 | 额外延迟 | 时序复杂度 | 结论 |
|---|---|---|---|---|
| A. 独立二次调用（现状） | ✗ 独立调用不入账 | +5s 尾延迟 | 高（拉取窗口/竞态） | 废除 |
| B. 回答流内嵌尾部块（本方案） | ✓ 主流式内 | 0（并入同流） | 低（done 即就绪） | **采纳** |
| C. 伪工具调用 submit_next_actions | ✓ | 0 | 中（工具循环需拦截伪工具） | 备选，解析层隔离后可替换 |

---

## 3. 协议定义

### 3.1 哨兵块格式

回答正文结束后，模型必须以且仅以如下块收尾：

```
<next_actions>{"actions":[{"prompt":"…","tools":[…]}]}</next_actions>
```

- `actions` 元素形状与现行 `NextAction` 一致（`prompt` ≤50 字全中文、`tools` 0~2 个且取自可用清单、不写空壳）；
- 条数上限取 SOUL `next_action_hints_count`（缺省 3，1~6 可配），写入提示词指令；
- 模型判定"无需下一步"时输出 `{"actions":[]}` 或不输出块，两者同为"本轮无卡片"。

### 3.2 提示词装配

- SOUL 开关**开启**时：装配工具在 System Prompt 末尾追加"尾部块指令"段（含格式、条数上限、合规要求——逐字复用现行 `buildSystemPrompt` 的硬性要求文案）；
- SOUL 开关**关闭**时：不追加任何指令段（模型不感知该协议）；
- `next_action_hints` / `next_action_hints_count` 的 frontmatter 契约（007 §4）**零变更**。

---

## 4. 后端设计

### 4.1 哨兵缓冲状态机（新增，落点 `run-impl.ts`）

content 增量在 `run.emit` 之前先经过状态机：

| 状态 | 输入行为 | 转移 |
|---|---|---|
| `forwarding` | 维护长度 = 哨兵前缀最大长度的滑窗缓冲 | 命中 `<next_actions>` 完整开标签 → `capturing`（缓冲内已进入尾部模式的字符不转发）；命中潜在前缀 → 暂扣；确认误命中 → 冲刷暂扣字符为正文增量，回到正常转发 |
| `capturing` | 全部增量进尾部缓冲，**不再下发 SSE** | 命中 `</next_actions>` → `forwarding`（容错块后继续说话的模型），尾部缓冲封存 |
| 任一状态 | 收到 `done` | 用封存的尾部缓冲进入 finalize（§4.2）；未出现过开标签则尾部为空 |

**边界用例（必须单测覆盖）**：开标签跨增量拆分；正文中出现部分前缀后回退；块后仍有正文；块出现两次（取第一次捕获）；空 `actions`。

### 4.2 finalize（`run-finalize.ts` 改造）

`done` 收尾顺序调整为：

1. 剥离：持久化的 assistant 正文 = `run.buffer` 去除尾部块（**历史 jsonl 永不含卡片内容**）；
2. 解析与合规：复用现行纯函数 `parseActions` / `sanitizeActions` / `isCompliantPrompt` / `filterTools` / `interpret`（告警口径不变：非法输出告警、明确空结果不告警、全不合规告警）；
3. 写快照：同步调用 `NextActionsStore.write(input, actions)`（原子写、单快照覆盖写语义不变）；0 条不写；
4. 广播 `done`：负载新增 `next_actions` 字段（§7.1）；
5. `usage` / `duration_seconds` 零改动——尾部块 token 已在主流式用量内（G1）。

### 4.3 删除清单

- `next-actions.ts`：`produce()`、`GENERATE_TIMEOUT_MS`、`enqueue`/`chains` 串行链、`trigger()` 的 LLM 依赖与 `NextActionsLlm` 接口；`trigger` 改为纯写入口；
- `run-manager.ts` / `run-finalize.ts`：轮末 fire-and-forget `trigger`、轮开始 `clear` 保留（语义不变：新一轮开始清空上一轮卡片）；
- 读取侧（`NextActionsStore.read`）：**删除** `currentAgent(userId) !== snapshot.agent_name` 判据（G4）与 `isEnabled` 读判据（生成侧已被开关门控，读取侧判据冗余）——卡片归属判定仅保留 `message_id === 消息 id`。

### 4.4 数据模型

- `users/{uid}/user-data/threads/{tid}/next-actions.json`：形状零变更（`message_id` / `agent_name` / `created_at` / `actions`），仍为会话级单快照、每轮覆盖、轮开始删除（G3 的"仅最新一轮持久化"由此保证）；
- `history.jsonl`：assistant 行 `content` 不含尾部块（§4.2 第 1 步保证）。

---

## 5. 前端设计

### 5.1 done 直推（G5 主路径）

- `api/messages.ts` `decodeStreamEvent` 的 `done` 分支解码新增 `next_actions`（形状校验复用 `normalize` 口径：非法 → 空形态）；
- `useChatStream` 收到 done 后直接写入 `nextSteps.steps`——拉取窗口、代次（generation）、`NEXT_STEPS_PULL_DELAYS_MS`、定时器调度**全部删除**（`useNextSteps.ts` 退化为"持有 steps + reset + 一次性拉取"）。

### 5.2 刷新 / 切会话恢复（G3、G4 补全路径）

- 新增：**选中会话 / URL 恢复会话成功后**一次性 `GET /api/threads/{id}/next-actions` 写入 `steps`（现行只在轮末拉取，这是刷新后卡片消失的另一半原因）；
- `onSend` 发起即 `reset()` 清空上一轮卡片（语义不变）；轮开始后端 `clear` 语义与之对齐，不变。

### 5.3 渲染层零变更

`MessageList` 的 `nextStepsId` / `v-memo` 归属判定、`MessageNextSteps`、确认弹窗链路全部不动。

---

## 6. 契约增量

| 项 | 变更 |
|---|---|
| SSE `done` 事件 | **新增可选字段** `next_actions`（形状 = 现行 `NextActionsView`；无卡片时缺省或 `null`，二者前端等价处理）；其余事件零变更 |
| `GET /api/threads/{id}/next-actions` | 路径与响应形状零变更；**语义修订**：删除"归属数字人 = 当前选中数字人"下发判据（007 §1 双判据降为单判据 → 无判据，见 §4.3） |
| SOUL frontmatter | 零变更 |
| 宪章同步 | 按"契约变更四处同步"登记：本文件 + `specs/001/.../contracts/runtime-api-delta.md` + 前端类型 + 两侧测试；`007/tasks.md` 同步记录表登记本次 MAJOR 修订 |

---

## 7. 降级与可观测（宪章原则九）

- 模型未输出块 / JSON 非法 / 全不合规 → 本轮无卡片，静默，结构化告警（沿用 `interpret` 三态口径）；
- 哨兵状态机兜底：`capturing` 态下缓冲超过 64KB 视为模型输出损坏，**丢弃本轮卡片**、后续内容恢复正常转发并告警（降级不打扰用户——不把半截 JSON 冲给用户）；
- 定稿写盘失败 → 本轮无卡片（`done` 不带 `next_actions`），保留旧快照，告警；
- 降级路径测试：无块、坏 JSON、`{"actions":[]}`、状态机各边界（含跨增量拆分 / 误前缀 / 双块取首 / 超限）均须有用例。

---

## 8. 测试清单

**后端单测**

- [ ] 状态机：开标签跨增量拆分；前缀误命中冲刷；块后正文恢复转发；双块取首；64KB 兜底
- [ ] finalize：尾部剥离后落盘正文逐字正确；解析复用既有合规用例全量迁移；0 条不写快照
- [ ] `write` 原子写 / 覆盖写 / `clear` 语义回归
- [ ] `done` 负载含 `next_actions`；无卡片时字段缺省
- [ ] `read` 判据删除后的行为：跨数字人仍下发；删除判据的相关用例同步改写

**后端集成**

- [ ] 全链路：回答 + 卡片同轮产出；`usage` 包含尾部块 token（与关闭开关时的同题轮次对比，输出 token 差值可观测）
- [ ] 开关关闭：提示词无指令段、无块、无快照、done 无 `next_actions`

**前端单测**

- [ ] `decodeStreamEvent` 解析 `done.next_actions`（含非法形状回退空形态）
- [ ] done 直写 steps；发起即 reset；选中会话恢复拉取一次
- [ ] 删除拉取窗口后 `useNextSteps` 用例重写；`NEXT_STEPS_PULL_DELAYS_MS` 及其不变量断言删除

**端到端**

- [ ] 首轮/次轮卡片均即时出现（原"延迟一轮"缺陷回归）
- [ ] 刷新后最新卡片恢复；切换数字人后卡片不消失（G4）
- [ ] 历史轮次无卡片；发起新一轮旧卡即消

---

## 9. 实施顺序

1. 后端：状态机 + finalize（旧生成链暂留但断开触发）→ 单测绿；
2. 契约与两侧同改：done 字段 + 判据删除 → 集成测试；
3. 前端：done 直推 + 会话恢复拉取 → 删除拉取窗口 → 单测绿；
4. 清理：删除死代码与失效规格语句（007 spec.md / data-model.md / tasks.md 相应条款标注修订）、登记同步记录；
5. 端到端场景（§8）全量回归。

---

## 10. 同步影响报告

| 版本 | 日期 | 说明 |
|---|---|---|
| 已实施 | 2026-10-12 | 007 修订（MAJOR）：Tail Protocol 重定义卡片生成机制；删除拉取窗口与读取侧判据。两侧代码落地并全量回归通过（agent-backend 499 单测 + 79 集成；frontend 611 单测）；偏差与口径登记见 `tasks.md`「同步记录」表（3）末行 |
