# 数据模型：意图聚焦指代改写（027）

**范围**：本特性涉及的三类"数据"——设计态开关（平台侧字段）、运行期判定 / 改写结果（内存实体）、留档记录（`intent-focus.jsonl` 追加字段）。不涉及数据库、不涉及新文件格式。

---

## 1. 实体总览

```text
SoulDesign（平台设计态，.platform-data/agents/{name}.json）
  └─ soul.intent_focus / input_rewrite / term_normalize ──物化──▶ SOUL.md frontmatter
                                                                    │
                                                    SOUL.md（运行环境只读）
                                                                    │
                       ┌────────────────────────────────────────────┴──────────────┐
                       ▼                                                           ▼
              TermNormalize（发送前预检）                                IntentFocusRunner（每轮）
              POST /api/term-normalize                                    │
              闸门：intent_focus && term_normalize                        ├─ NeedRewriteDecision
                       │                                                  ├─ RewriteQuery
                       ▼                                                  ├─ FocusState
              确认后的本轮文本（userMessage）                              └─ IntentFocusRecord（留档）
                       │
                       └──────────────▶ 指代判断 ──▶ 改写 ──▶ 技能/行为评分
```

---

## 2. 设计态开关（平台）

### 2.1 `SoulDesign` 新增字段

| 字段 | 类型 | 必填 | 缺省 | 语义 |
|---|---|---|---|---|
| `input_rewrite` | `boolean` | ➖ | `false` | 「输入重写」：与 `intent_focus` 逻辑与，决定是否做指代判断与改写 |
| `term_normalize` | `boolean` | ➖ | `false` | 「术语替换」：与 `intent_focus` 逻辑与，决定是否执行术语替换（位于意图聚焦配置区） |

### 2.2 校验（`normalizeSoulDesign`，拒绝式）

| 输入 | 结果 |
|---|---|
| 键缺失 / `undefined` | `false`（存量文档照常打开与保存） |
| `true` / `false` | 原值 |
| `null` / `"true"` / `1` / `{}` | `400 VALIDATION_FAILED`（MUST NOT 隐式转换） |

**不做的事**：`intent_focus=false` 时**不清空**这两个值（与 `019` 阶数同口径：管理台置灰、值保留、重新开启即恢复）。

### 2.3 物化（`renderSoulMd` → `SOUL.md` frontmatter）

| 条件 | 产物 |
|---|---|
| `intent_focus === true && input_rewrite === true` | 写 `input_rewrite: true` |
| 其它（含 `false` / 未设置 / 聚焦关闭） | **不写该键**（关闭态产物逐字不变） |
| `intent_focus === true && term_normalize === true` | 写 `term_normalize: true` |
| 其它 | 不写该键 |

产物片段示例（三开关全开）：

```yaml
---
soul_version: 1
intent_focus: true
intent_focus_depth: 1
input_rewrite: true
term_normalize: true
next_action_hints: true
next_action_hints_count: 3
---
```

### 2.4 读取归一化（`withSoulDefaults`）

- 非布尔 → `false`（fail-closed，与运行侧 `parseSoulMeta` 同口径）；
- 对外契约**恒有这两个键**（前端不必判空、脏检查与 `emptySoulDesign` 同形）；
- 变更检测包含这两个字段：值被收敛时才重建对象。

---

## 3. 运行期实体

### 3.1 `NeedRewriteDecision`（指代判断结论）

| 字段 | 类型 | 说明 |
|---|---|---|
| `needed` | `boolean \| null` | `null` = 未执行（开关关 / 跳过 / 短路 / 未配置 / 降级） |
| `score` | `number \| null` | 单条 `noul` 分数；未执行或失败为 `null` |
| `state` | `string` | 实际提交的判定素材（尾部 200 字，替换生效时为替换后文本） |
| `truncated` | `boolean` | 素材是否被 200 字截断 |
| `reason` | `string \| null` | `below_threshold` / `judge_failed` / `switch_off` / `budget_exhausted` |
| `ms` | `number \| null` | 判定耗时 |

**不变量**：`needed === true` 当且仅当 `score > rewrite_threshold`（严格大于）。

### 3.2 `RewriteQuery`（改写结果）

| 字段 | 类型 | 说明 |
|---|---|---|
| `text` | `string` | ≤100 字符（码点）；归一化后的纯文本；空串 = 未改写 |
| `truncated` | `boolean` | 是否因超 100 字被截断 |
| `source` | `'model' \| 'fallback_original'` | 来源；回退时 `text` 为空串 |
| `historyTurns` | `number` | 实际参与的历史轮次数（0~3） |
| `ms` | `number \| null` | 改写耗时（含判定结束到改写完成） |
| `reason` | `string \| null` | `llm_failed` / `empty_output` / `budget_exhausted` / `no_history` |

**约束**：
- `text !== ''` 时，`text` MUST NOT 出现在消息数组、`systemExtra`、历史、卡片、SSE 中；
- `source === 'fallback_original'` 时，聚焦素材回落为判定素材；
- 每轮至多一次改写（无递归）。

### 3.3 `FocusState`（送入评分的文本）

| 字段 | 类型 | 说明 |
|---|---|---|
| `state` | `string` | 送入技能 / 行为评分与发散的文本 |
| `truncated` | `boolean` | 是否被 200 字截断（改写 ≤100 字时恒 false） |
| `origin` | `'rewrite' \| 'original'` | 来源 |

**唯一来源规则**：`origin === 'rewrite'` ⇔ `needed === true && text !== ''`。其余情况 `state = prepareState(userInput).state`（与改造前逐字一致）。

### 3.4 `RewriteMaterial`（改写输入素材）

| 字段 | 类型 | 说明 |
|---|---|---|
| `turns` | `{ user: string; assistant: string }[]` | 最近 3 个完整问答轮，时间正序，0~3 组 |
| `current` | `string` | 本轮输入（术语替换确认后） |
| `model` | `ModelSelection \| undefined` | 本轮生效模型（用于取 provider） |

**取材规则**：
1. 只读 `history.jsonl`（该用户 / 数字人 / 线程）；
2. 过滤 `status === 'failed'`、`role === 'user'` 但 `content.trim() === ''`、附件在 content 中的路径（只取正文，不追加附件段）；
3. 从尾部向前配对 user + assistant（assistant 无对应 user 时丢弃）；
4. 取最多 3 组后反转成正序；
5. MUST NOT 读 `tool-events.jsonl` / 摘要 / 记忆。

---

## 4. 留档记录（`intent-focus.jsonl`）

### 4.1 追加字段

在既有 `IntentFocusRecord` 上追加（新记录恒写，存量记录可缺）：

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `need_rewrite` | `boolean \| null` | `null` | 判定结论；`null` = 未执行 |
| `rewrite_score` | `number \| null` | `null` | 单条命题分数 |
| `rewrite_query` | `string` | `''` | 改写结果（≤100 字） |
| `rewrite_truncated` | `boolean` | `false` | 改写结果是否被截断 |
| `rewrite_ms` | `number \| null` | `null` | 改写耗时 |
| `rewrite_history_turns` | `number` | `0` | 参与的历史轮次数 |
| `rewrite_reason` | `string \| null` | `null` | 见 3.1 / 3.2 的原因枚举 |

### 4.2 与既有字段的关系

| 既有字段 | 语义（不变） | 与本特性的关系 |
|---|---|---|
| `input` | 送入判定的原始文本（尾部 200 字） | 改写时仍是**原文**，便于对照"用户说了什么" |
| `input_truncated` | 原文是否截断 | 与 `rewrite_truncated` 独立 |
| `disposition` / `reason` | 聚焦处置 | 不变；改写失败不改变处置（仍按聚焦结果） |
| `skills` / `behaviors` / `prompt` | 评分与提示 | 由改写后的 `FocusState` 产生 |

### 4.3 落档时机

- 开关关闭 → **不留档**（与 013 一致）；
- 跳过 / 未配置 / 无技能 / 无可聚焦技能 → 留档，`need_rewrite = null`、`rewrite_query = ''`、`rewrite_reason = null`（未执行，不是失败）；
- 判定失败 → 留档 `need_rewrite = null`、`rewrite_reason = 'judge_failed'`；
- 改写失败 → 留档 `need_rewrite = true`、`rewrite_query = ''`、`rewrite_reason = <原因>`；
- 成功 → 全部字段按实际值。

### 4.4 兼容性

- 存量行无新键：解析侧（仅分析与测试）按缺省理解，MUST NOT 回写迁移；
- 滚动上限（256KB / 200 行 → 保留 100 条）与写入串行链不变。

---

## 5. 配置模型（`config.yaml` → `intent_focus` 块）

| 键 | 类型 | 缺省 | 校验 | 说明 |
|---|---|---|---|---|
| `rewrite_threshold` | number | `0.8` | `0 ≤ v ≤ 1`，越界启动失败 | 指代判定阈值；可被 `INTENT_FOCUS_REWRITE_THRESHOLD` 覆盖（环境变量优先） |
| `rewrite_timeout_ms` | number | `5000` | 整数 `300 ≤ v ≤ 10_000`，且 `v ≤ timeout_ms` | 单次改写上限；超出阶段预算直接启动失败（半配置不静默收敛） |

**整块缺失**：`undefined`（判定与改写均不可用，行为与 013 一致：不聚焦、不判断、不留档）。
**其它键**：`intent_focus` 块仍为 `.strict()`，拼错键立即启动失败。

---

## 6. 状态与顺序

### 6.1 单轮状态机（与开关组合）

```text
[意图聚焦关闭] ─────────────────────────────▶ 结束（零调用、零留档）
[跳过 / 未配置] ────────────────────────────▶ 留档（need_rewrite=null）
[读技能 / 本体索引]
   ├─ 无技能 / 无可聚焦技能 ─────────────────▶ 留档（need_rewrite=null，零判定零改写）
   └─ 有可聚焦技能
        ├─ 输入重写关闭 ─────────────────────▶ 评分（原文）→ 留档（need_rewrite=null）
        └─ 输入重写开启
             ├─ 判定失败/超时 ───────────────▶ 评分（原文）→ 留档（need_rewrite=null, judge_failed）
             ├─ score ≤ 阈值 ────────────────▶ 评分（原文）→ 留档（need_rewrite=false）
             └─ score > 阈值
                  ├─ 改写失败/超时/空/超预算 ─▶ 评分（原文）→ 留档（need_rewrite=true, reason）
                  └─ 改写成功 ────────────────▶ 评分（改写，≤100 字）→ 留档（need_rewrite=true）
```

### 6.2 与术语替换的时序

```text
用户输入
  → POST /api/term-normalize（闸门：intent_focus && term_normalize）
      ├─ 关闭 / 无映射 / 未命中 → applied:false → 原文发送
      └─ 命中 → 用户确认 → 替换后文本发送
  → POST /api/threads/{id}/messages（content = 最终文本）
      → 主模型调用前的聚焦（判定 → 改写 → 评分）
```

**约束**：运行期 MUST NOT 再次读术语表；改写结果 MUST NOT 再进入术语替换。

### 6.3 权限与可见性

| 数据 | 用户可见 | 模型可见 | 落历史 |
|---|---|---|---|
| 术语替换后的文本 | ✅（气泡） | ✅（user 消息） | ✅ |
| 改写结果 | ❌ | ❌（仅影响聚焦提示内容） | ❌ |
| 指代判定分数 | ❌ | ❌ | ❌ |
| 留档记录 | ❌ | ❌ | ❌（独立侧车） |

---

## 7. 字段唯一来源

| 规则 | 唯一落点 |
|---|---|
| 200 字符截断 | `domain/intent-focus/state.ts#prepareState`（复用，不复制） |
| 100 字符截断与归一化 | `domain/intent-focus/rewrite-prompt.ts#normalizeRewrite` |
| 最近 3 轮取材 | `domain/intent-focus/rewrite-prompt.ts#pickRecentTurns` |
| 阈值与超时缺省 | `src/config.ts`（`INTENT_FOCUS_REWRITE_*`） |
| 开关读取 | `domain/soul.ts`（`isInputRewriteEnabled` / `isTermNormalizeEnabled`） |
| 物化写键条件 | `admin-backend/.../soul-design.ts#renderSoulMd` |
| 设计态缺省 | `admin-backend` / `admin-frontend` 的 `emptySoulDesign`（形态必须一致） |
| 留档字段 | `domain/intent-focus/store.ts` 类型 + `record.ts` 铸造 |
