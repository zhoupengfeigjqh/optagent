---
description: "提示词全文：下一步动作建议（005）——实现时逐字照抄，常量唯一来源 domain/next-actions.ts"
---

# 提示词全文：下一步动作建议（005）

对应需求 [`NT-05`~`NT-07`](./spec.md)。**本文件是提示词的唯一权威文本**；实现时逐字落进
`agent-backend/src/domain/next-actions.ts` 的常量，并被 `tests/unit/next-actions.spec.ts` 断言。

## 1. 调用形状（与 `domain/summary.ts:130-148` 完全同构）

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);   // NEXT_TOOLS_TIMEOUT_MS，默认 4000
try {
  let text = '';
  for await (const ev of llm().streamChat({
    systemPrompt: NEXT_ACTIONS_SYSTEM_PROMPT,                    // §2：稳定指令
    messages: [{ role: 'user', content: buildNextActionsPrompt(input) }],  // §3：变化素材
    tools: [],                                                   // 不给工具：只要文本，不要它真去调
    thinking: false,                                             // 短任务不需要思考链
    signal: controller.signal,
  })) {
    if (ev.type === 'content_delta') text += ev.delta;
    else if (ev.type === 'error') throw new Error(`${ev.code}: ${ev.message}`);
  }
  return parseNextActions(text, allowed);                        // §6：白名单 + 形状校验
} finally {
  clearTimeout(timer);
}
```

**为什么这样切分**：`LlmChatRequest` 的 `messages` 只接受 `user` / `assistant`
（`infra/llm/llm-provider.ts:7-15`），system 是独立字段。把**不变的指令**放 systemPrompt、**每轮变化的素材**
放单条 user 消息，好处有三：① 单测可以直接断言"素材五段齐备"而不被指令文字干扰；
② 若 provider 侧将来支持 prompt 缓存，稳定前缀天然可缓存；③ 指令与素材的职责边界清晰，改素材不动指令。

## 2. systemPrompt（逐字，常量 `NEXT_ACTIONS_SYSTEM_PROMPT`）

```
你是数字人对话的"下一步建议"生成器。
一轮对话结束后，你要判断用户接下来最可能需要数字人做什么，并从给定的可用工具里挑出 0–3 个动作，
按可能性从高到低排列。

规则：
1. tool 只能逐字取自【可用工具】清单里的工具名，不得臆造、不得改写、不得使用清单外的名字。
2. action 是"用户会怎么说"的下一步动作，中文短句（≤40 字），要能直接作为一条用户消息发给数字人；
   写成用户口吻（例：把缺计划量的那两行找出来看看），不要写成"调用 X 工具"这类系统口吻。
3. 【本轮已执行的工具】里已经做过的动作，不要重复建议。
4. 宁少不多：只给确实值得作为下一步的动作；若没有明确且不重复的下一步，返回空数组 []。
5. 只输出 JSON 数组（可用代码块包裹），不要输出理由、解释、置信度或任何其它字段，格式：
   [{"tool":"<清单中的工具名>","action":"<中文动作，≤40 字>"}]
```

**逐条理由**

| 规则 | 为什么必须写 |
|---|---|
| 1（tool 白名单，逐字） | `guidance` 要用工具名去引导模型真的调用；越界的工具名后端会**丢弃该条**（`NT-07`），不写清楚就是白花 token |
| 2（用户口吻 + 可直接发送） | 点击卡片就是把 `action` **原样当作下一轮用户消息发出去**（`NT-26`）。写成"调用 X 工具"会在用户气泡里露馅 |
| 3（不重复已做过的） | prompt 只带工具**名**、不带工具结果正文（上下文有界），模型看不到"已经看到的内容"，必须显式要求它别重复 |
| 4（允许 `[]`） | 这是**收敛机制**：没话可说就别说。`[]` 是正常结果（`skip` 级日志），不是失败（`NT-07`/`NT-13`） |
| 5（只要 JSON） | 不给"理由/置信度"字段：界面不展示（`NT-08` 禁止暗示概率含义），多给字段只会诱导模型编数值 |

## 3. user 消息模板（逐字，`buildNextActionsPrompt()`）

```
## 数字人角色（摘要）
{roleSummary | （未配置）}

## 用户的诉求
{userText}

## 数字人本轮的回答
{answer}

## 本轮已执行的工具
{calledTools 逗号分隔 | 无}

## 可用工具（tool 只能逐字取自这里）
- {name} ：{label}
  {description}

只输出 JSON 数组：[{"tool":"…","action":"…"}]
```

**末尾那一行是"输出要求"的复述**（systemPrompt 里已说过一次）：模型对**末尾**更敏感，复述一句约 10 token，
换来格式遵循率明显提升；解析侧本来就有容错（§6），这是双保险。

## 4. 五段素材的来源、上限与缺省

| 段 | 来源 | 上限 | 截断标记 | 空值占位 |
|---|---|---|---|---|
| 数字人角色（摘要） | 该数字人 System Prompt 的**前 500 字** | `NEXT_TOOLS_ROLE_MAX_CHARS = 500` | `…（已截断）` | `（未配置）` |
| 用户的诉求 | 本轮用户消息 `run` 的 input 文本 | `NEXT_TOOLS_STATE_MAX_CHARS = 2000` | `…（已截断）` | `（空输入）` |
| 数字人本轮的回答 | `run.buffer`（**纯文本**，天然不含工具结果） | `NEXT_TOOLS_STATE_MAX_CHARS = 2000` | `…（已截断）` | `（无文本回答）` |
| 本轮已执行的工具 | `RunImpl.calledTools`（去重、按首次调用顺序，`NT-13`） | — | — | `无` |
| 可用工具清单 | 候选清单（见下） | `NEXT_TOOLS_TOOLS_MAX = 40` 条 | 超出取前 40（装配顺序） | 清单为空 → 整个功能跳过（`NT-03`） |

**每条工具的渲染**：`- {暴露名} ：{显示名}` 换行后缩进两格放简介；
简介 = 内置工具渲染后的 `description_template`（占位符已替换）/ MCP 的 `listTools.description`，
**截断 `NEXT_TOOLS_TOOL_DESC_MAX_CHARS = 80` 字**（MCP 的 description 可能很长，不设上限会把 prompt 撑爆）；
简介缺失则该行省略。

**截断方向**：一律**尾部截断**并加 `…（已截断）`——头部信息量最大（用户诉求的开头、回答的开头）。

## 5. 长度预算（最坏情况）

| 部分 | 估算 |
|---|---|
| systemPrompt | ≈ 400 字 |
| 角色摘要 | ≤ 500 字 |
| 用户诉求 + 本轮回答 | ≤ 4000 字 |
| 已执行工具 | ≈ 100 字 |
| 工具清单（40 条 × 名称/显示名/80 字简介） | ≤ 4000 字 |
| **输入合计** | **≈ 9k 字符（约 4–6k tokens，中文按 ~1 token/字粗估）** |
| 输出 | ≤ 3 × 40 字 ≈ 150 tokens |

典型数字人只有 6–15 个工具（≈ 1.5–2.5k 字清单），输入约 4–7k 字符。默认超时 4000ms 覆盖
"prefill + 短输出"；`next_tools_ms` 落日志，实测不够就调 `NEXT_TOOLS_TIMEOUT_MS`（不调 prompt）。

## 6. 输出契约与解析容错（`parseNextActions()`）

**模型应给的**：

```json
[ {"tool":"grep_files","action":"把缺计划量的那两行找出来看看"},
  {"tool":"write_file","action":"把这份计划导出成 CSV 方便下发"} ]
```

**解析侧必须容忍 / 必须拒绝**：

| 情况 | 处理 |
|---|---|
| 裸 JSON / 代码块包裹 / 前后有寒暄噪声 | 提取**首个**合法 JSON 数组 |
| `[]` | **正常结果**：无建议，`next_tools.skip`（info），**不落 warn**（`NT-07`/`NT-13`） |
| 完全解析不出数组 | 降级：`next_tools.degraded`（warn） |
| `tool` 不在候选清单 | 丢弃该条 |
| `action` 空 / 非字符串 | 丢弃该条 |
| `action` > 120 字 | 截断（`NEXT_ACTIONS_ACTION_MAX_CHARS`） |
| 同一 `tool` 重复 | 只留首次出现 |
| 条目 > 3 | 截断到 3（`NEXT_ACTIONS_MAX`） |
| 有条目但**全部**被丢弃 | 降级（warn）——与 `[]` 严格区分 |
| 顺序 | **保持模型给的顺序**，后端不重排（`NT-08`） |

## 7. 提示词里"刻意不写"的东西（登记，避免后来者加上）

| 不加 | 原因 |
|---|---|
| 工具结果正文（查询到的数据） | 会撑爆上下文（与 002 `TR-18`/`TR-21` 的"上下文有界"取向冲突）；代价是可能建议"已经做过的事"，已由规则 3 缓解并登记为已知限制 |
| 要求输出概率 / 置信度 / 匹配度 | 界面不展示，且模型自报数值无依据 = 制造"看似权威"的数字（原则九②） |
| 要求解释理由（`reason`） | 无消费方：卡片只展示 `action` 与工具显示名 |
| 让模型直接调工具（给 `tools`） | 本特性只做"建议"，不替用户执行（非目标）；也避免污染对话流 |
| few-shot 示例（除格式示例） | 示例里出现的具体工具名会被模型当成"候选"，反而容易越界；格式示例只用占位符 |

## 8. 测试断言清单（`tests/unit/next-actions.spec.ts`）

- systemPrompt 含：白名单要求、用户口吻要求、不重复建议、允许 `[]`、JSON 格式示例
- user 消息含**五段**标题字面量齐备，且顺序固定
- 角色摘要 / 用户诉求 / 回答各自：未超限不截断、恰好等于上限不截断、超限出现 `…（已截断）`
- 空值占位正确（`（未配置）` / `（空输入）` / `（无文本回答）` / `无`）
- 工具清单：行格式 `- name ：label`、简介截 80 字、简介缺失时省略该行、清单里**不含**被排除服务的工具、超过 40 条只渲染前 40
- 末尾输出要求那一行存在
- 调用参数：`tools: []`、`thinking: false`、传入 `signal`
