# 契约：意图聚焦指代改写（运行期）

**版本**：1（2026-11-19）
**适用**：`agent-backend` 运行期；`admin-backend` / `admin-frontend` 仅涉及 §2 的开关字段与物化；`frontend` 不涉及。
**规格**：[../spec.md](../spec.md)　**数据模型**：[../data-model.md](../data-model.md)

---

## 1. 不变量（任何实现都 MUST 满足）

| # | 不变量 |
|---|---|
| C-1 | 改写结果 MUST NOT 进入会话历史、消息数组、`systemExtra` 的用户可见段落、SSE 事件、下一步动作卡片、记忆或摘要 |
| C-2 | 本轮用户消息的唯一事实源是 `StartRunOptions.userMessage`（术语替换确认后）；改写只按值传递，不回写 |
| C-3 | 关闭 / 跳过 / 未配置 / 无技能 / 无可聚焦技能轮次：零判定、零改写、零历史读取、零新增字段 |
| C-4 | 判定与改写共用意图聚焦阶段预算；任一失败只降级，不改变本轮回答 |
| C-5 | 每轮至多一次改写；不递归、不对改写结果再做指代判断 |
| C-6 | 术语替换只在 `intent_focus && term_normalize` 时执行，且只在 `POST /api/term-normalize` 一处判定 |

---

## 2. SOUL frontmatter 新增键

```yaml
---
soul_version: 1
intent_focus: true
input_rewrite: true      # 仅 intent_focus===true && input_rewrite===true 时写入
term_normalize: true     # 仅 intent_focus===true && term_normalize===true 时写入
---
```

| 项 | 口径 |
|---|---|
| 写入条件 | 两个开关皆为真；任一为假则**整键不出现**（部署零残留） |
| 读取 | 逐次读盘、不缓存；缺键 / 非布尔 → `false`（fail-closed） |
| 正文 | 两个键都不进 System Prompt，正文开 / 关逐字一致 |
| 与 007 / 019 | 互不影响；`next_action_hints` 仍只看 `intent_focus` |

**运行期读取函数**（`src/domain/soul.ts`）：

```ts
export function isInputRewriteEnabled(root, userId, agentName, logger?): boolean;
export function isTermNormalizeEnabled(root, userId, agentName, logger?): boolean;
```

两者与 `isIntentFocusEnabled` 同构：文件缺失 / 读取异常 / YAML 非法 / 键缺失或非布尔 → `false` + 告警。

---

## 3. 配置（`config.yaml` → `intent_focus`）

| 键 | 缺省 | 区间 / 校验 | 环境变量 |
|---|---|---|---|
| `rewrite_threshold` | `0.8` | `0 ≤ v ≤ 1`，越界启动失败 | `INTENT_FOCUS_REWRITE_THRESHOLD`（优先） |
| `rewrite_timeout_ms` | `5000` | 整数 `300~10_000`，且 MUST `≤ timeout_ms` | 无（只从配置文件） |

`IntentFocusConfig` 新增 `rewriteThreshold: number`、`rewriteTimeoutMs: number`；整块缺失语义不变（功能不可用）。

---

## 4. 端口（domain 只依赖这两个接口）

```ts
/** 一次性文本生成（无工具、无历史副作用）。由 infra 实现，测试注入桩。 */
export interface RewriteLlm {
  complete(req: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** 本轮生效模型；缺省 = 服务默认模型 */
    model?: ModelSelection;
    timeoutMs: number;
    /** 本轮中止信号（用户停止 / 关机） */
    signal?: AbortSignal;
  }): Promise<string>;
}

/** 读该线程全部消息（复用 HistoryStore.readAll 的结构子集） */
export type ReadHistory = (
  userId: string,
  agentName: string,
  threadId: string,
) => ReadonlyArray<{ role: 'user' | 'assistant'; content: string; status?: 'completed' | 'failed' }>;
```

`IntentFocusRunnerDeps` 新增（全部可选；缺省 = 改写不可用，行为与改造前一致）：

```ts
isRewriteEnabled?: (userId: string, agentName: string) => boolean;
readHistory?: ReadHistory;
rewriteLlm?: RewriteLlm;
```

`IntentFocusInput` 新增：

```ts
/** 本轮生效模型（请求级覆盖优先） */
model?: ModelSelection;
/** 本轮中止信号 */
signal?: AbortSignal;
```

---

## 5. 指代判断（Laya 单条 `noul`）

**请求**（`POST {base_url}/v1/systemone`，由既有 `LayaClient.decide` 发出）：

```json
{
  "state": "<prepareState(userInput).state>",
  "model": "<intent_focus.model>",
  "questions": {
    "need_rewrite": {
      "type": "noul",
      "instructions": "该输入含有明确代指，需结合上文才能理解",
      "criteria": {
        "true": "含明确代指词（如上文、上述、这个、它、该结果）",
        "false": "语义自足，不依赖上文即可理解"
      }
    }
  }
}
```

| 项 | 口径 |
|---|---|
| 题数 | 恒 1 条；MUST NOT 拆题、MUST NOT 使用 `choice` |
| `state` | 复用 `prepareState`（尾部 200 字、句首对齐、`truncated` 标注） |
| 超时 | `min(config.timeoutMs, max(300, deadline - now))` |
| 判真 | `score > rewriteThreshold`（严格大于） |
| 失败（timeout / http / network / invalid_response / 无该题分数） | 视为 `need_rewrite = null`，原因 `judge_failed`，不重试，按原文继续 |

---

## 6. 改写调用（`LlmProvider.streamChat`）

**请求**：

```ts
{
  systemPrompt:
    '你是输入改写助手。把用户给的“当前输入”改写成一段简洁、清晰、可独立理解的表述，' +
    '不要解释、不要加引号、不要输出多余内容，不超过 100 字。' +
    '改写结果可以是陈述句、指令或问句，不要强行改成问句。',
  messages: [{ role: 'user', content: '<见 §6 素材拼装：最近 2 轮 + 当前输入>' }],
  tools: [],
  thinking: false,
  signal: <AbortSignal：超时 ∪ 本轮中止>,
}
```

**素材拼装**（模板常量唯一落点：`rewrite-prompt.ts`）：

```text
【最近对话】
用户：<第 1 轮 user>
助手：<第 1 轮 assistant>
用户：<第 2 轮 user>
助手：<第 2 轮 assistant>

【当前输入】
<本轮输入>

请只输出改写后的文本。
```

| 规则 | 口径 |
|---|---|
| 轮数 | 0~2 组；无历史时整个【最近对话】段省略 |
| 顺序 | 时间正序；不足 2 组按实际 |
| 排除 | `status=failed`、空正文、附件路径、工具信息、思考内容、系统补充素材、聚焦提示、摘要 |
| 模型 | `input.model`（缺省默认模型）；不降级到其它模型 |
| 超时 | `min(rewriteTimeoutMs, deadline - now - 100)`；剩余 < 300ms 不发起（原因 `budget_exhausted`） |
| 输出 | 收集全部 `content_delta`；出现 `error` 事件即失败（`llm_failed`） |

---

## 7. 输出归一化与截断（纯函数）

```ts
normalizeRewrite(raw: string): { text: string; truncated: boolean }
```

算法顺序（MUST 按此顺序，便于测试逐项断言）：

1. `trim()`；
2. 若整段被 ``` 围栏包裹 → 去掉围栏行；
3. 若首行匹配 `^(改写|重写|输出)为?[：:]\s*` → 去前缀；
4. 剥离成对包裹引号（`"`、`“”`、`'`、`「」`）；
5. 取第一条非空行；
6. 按码点截断到 100：`Array.from(text).slice(0, 100).join('')`；`truncated = 码点数 > 100`；
7. 归一后为空串 → 调用方按 `empty_output` 失败处理。

**禁止**：把结果强制加问号 / 转问句；按字符 `slice` 截断（会切开代理对）。

---

## 8. 留档字段（`intent-focus.jsonl`）

字段定义见 [data-model.md §4](../data-model.md)。契约级要求：

| 要求 | 说明 |
|---|---|
| 新记录恒有 7 个新键 | 由 `buildRecordDraft` 统一补齐，调用方不必关心早退分支 |
| 未执行 ≠ 失败 | `need_rewrite = null` 且 `rewrite_reason = null`（未执行）；失败时 `rewrite_reason` 非空 |
| 不改既有键 | `input` / `input_truncated` / `disposition` / `skills` / `behaviors` / `prompt` 语义不变 |
| 不迁移存量 | 旧行缺键按缺省理解；写入滚动上限不变 |
| 无读取方 | 记录 MUST NOT 进入任何上下文组装路径 |

---

## 9. 结构化日志

| 事件 | 级别 | 字段 | 触发 |
|---|---|---|---|
| `intent-focus.rewrite.done` | info | `thread_id`、`agent_name`、`need_rewrite`、`score`、`history_turns`、`rewrite_chars`、`rewrite_truncated`、`rewrite_ms` | 判定 / 改写正常结束（含判 false） |
| `intent-focus.rewrite.degraded` | warn（`alert: true`） | `stage`（`judge` / `rewrite`）、`reason`、`detail`、`thread_id`、`agent_name` | 判定 / 改写失败或超预算 |
| `intent-focus.rewrite.skipped` | info | `reason`（`switch_off` / `budget_exhausted`） | 开关关闭或预算不足 |

**禁止**记录用户原文、改写全文（只记长度）。

---

## 10. 降级矩阵

| 情形 | `need_rewrite` | 改写 | 聚焦素材 | 用户可见影响 |
|---|---|---|---|---|
| 意图聚焦关闭 | `null` | 不执行 | — | 无（不聚焦） |
| 跳过 / 未配置 | `null` | 不执行 | — | 无 |
| 无技能 / 无可聚焦技能 | `null` | 不执行 | — | 无 |
| 输入重写关闭 | `null` | 不执行 | 原文（200 字） | 无 |
| 判定失败 / 超时 | `null` | 不执行 | 原文 | 无 |
| `score ≤ 阈值` | `false` | 不执行 | 原文 | 无 |
| 改写失败 / 超时 / 非 JSON 流 | `true` | 空 | 原文 | 无 |
| 改写归一后为空 | `true` | 空 | 原文 | 无 |
| 改写超 100 字 | `true` | 截断后 | 改写 | 无 |
| 剩余预算 < 300ms | `true` | 空（`budget_exhausted`） | 原文 | 无 |
| 改写成功 | `true` | 有意义文本 | 改写 | 无（仅聚焦结果可能更准） |

**任何一行都 MUST NOT**：改变本轮回答、改变 SSE 事件序列、产生错误提示。

---

## 11. 顺序保证（可测）

| # | 保证 | 测试方式 |
|---|---|---|
| O-1 | 术语替换在发送前完成，运行期不读术语表 | 断言 `loadTermTable` 在 chat 链路中零调用 |
| O-2 | 判定与改写在技能评分之前 | 记录 `seq` 内的字段与桩调用顺序 |
| O-3 | 无技能 / 无可聚焦技能短路先于判定 | 桩调用计数 = 0 |
| O-4 | 判定素材与改写素材均为"替换确认后文本" | 输入含替换说法，断言桩收到的 `state` / 素材含替换值 |
| O-5 | 改写只影响评分与提示内容，不影响 user 消息 | 集成断言历史行与请求体逐字一致 |

---

## 12. 测试矩阵（最小必测集）

| 用例 | 期望 |
|---|---|
| 三开关全开 + 指代输入 + 有历史 | 1 次判定、1 次改写、评分 state = 改写；记录字段完整 |
| 三开关全开 + 独立问句 | 1 次判定、0 次改写；评分 state = 原文 |
| 输入重写关闭 | 0 判定、0 改写、0 读历史 |
| 术语替换关闭 | 不读术语表、无弹窗；判定 / 改写照常（基于原文） |
| 无技能 / 无可聚焦技能 | 0 判定、0 改写；记录 `need_rewrite=null` |
| 判定超时 / HTTP 500 / 分数缺失 | 不改写；记录 `judge_failed`；回答正常 |
| 改写超时 / `error` 事件 | 回退原文；记录 `llm_failed` |
| 改写返回空白 / 只有引号 | `empty_output`；回退原文 |
| 改写返回 120 字 | 截到 100；`rewrite_truncated=true`；仍只用于评分 |
| 改写返回陈述句 | 正常采用（不因非问句失败） |
| 历史含失败轮 / 附件轮 / 工具记录 | 过滤正确；素材只含正文；最多 2 组 |
| 首轮无历史 | 判定照常；改写素材只有当前输入；`history_turns=0` |
| 预算不足（总预算耗尽） | 不发起改写；`budget_exhausted`；阶段在预算内结束 |
| 重新生成 | 新一轮独立判定 / 改写 / 留档 |
| 记录写入失败 | 回答与聚焦正常；仅告警 |
