# 013 数据模型：意图聚焦（Intent Focus）

- **特性标识**：`013-intent-focus`
- **日期**：2026-10-25
- **规格**：[spec.md](./spec.md) ｜ **计划**：[plan.md](./plan.md) ｜ **决策**：[research.md](./research.md)
- **说明**：本文按本仓库既有口径分"五段形状"描述同一份配置的流转：
  **设计态（平台）→ 物化（部署产物）→ 运行态（配置/判定）→ 接口（HTTP）→ 记录（线程目录）**。

---

## 1. 设计态：`SoulDesign`（管理平台）

```ts
interface SoulDesign {
  mission: string
  // …既有字段（能力标签 / 绝对禁止 / 补充说明 / 快速上手 …）
  next_action_hints?: boolean          // 007 既有
  next_action_hints_count?: number     // 007 既有
  intent_focus?: boolean               // 013 新增：意图聚焦开关
}
```

| 字段 | 类型 | 可选性 | 缺省 | 校验口径 |
|---|---|---|---|---|
| `intent_focus` | `boolean` | 可选 | **`false`** | 缺键 → `false`；非布尔 → **拒绝保存**（拒绝式校验，与 `next_action_hints` 同口径） |

- 归一化：`normalizeSoulDesign()` 内新增 `readBool(record.intent_focus)`；
- 对外契约恒有该键：`withSoulDefaults()` 补 `intent_focus: false`；
- 旧设计态升级：`fromLegacySoul()` → `false`；
- 深拷贝：`cloneSoul()` **必须显式列出该字段**（该函数是字段清单的契约，漏字段会在"复制数字人"路径整片丢失）；
- 空白态：`emptySoulDesign()` → `intent_focus: false`。

---

## 2. 物化：`SOUL.md` frontmatter

```markdown
---
soul_version: 1
next_action_hints: true
next_action_hints_count: 3
intent_focus: true          # 仅在开启时出现
---
## 主要使命
…
```

| 规则 | 内容 |
|---|---|
| 键名 | `intent_focus`（下划线小写，与既有键同风格） |
| 写入时机 | **仅 `true` 时写**；`false` 时整键不出现（关闭态部署产物无残留，FR-033） |
| 正文影响 | **零影响**：`stripFrontmatter()` 之后的正文逐字不变 ⇒ 不进 System Prompt（FR-034） |
| 运行侧解析 | `parseSoulMeta`：`intentFocus: record.intent_focus === true`（非布尔一律 `false`，fail-closed） |
| 读取 | `isIntentFocusEnabled(root, userId, agentName, logger?)`：**逐次读盘**，异常 → `false` + 告警 |

---

## 3. 运行态 A：运行环境配置（`agent-backend/config.yaml`）

```yaml
models:
  - model: deepseek-v4-flash-vision-exp
    api_key: $DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com

# 013 新增（可选块）：意图聚焦判定模型。整块缺失 = 功能不可用（fail-closed）
intent_focus:
  base_url: http://laya:8000       # 必填（启用时）；本地直跑用 http://127.0.0.1:8103
  model: laya-multilingual         # 缺省即此值
  api_key: $DECIS_API_KEY          # 必填（启用时）；支持 $ENV 引用，MUST NOT 走 DEEPSEEK_API_KEY 兜底
  timeout_ms: 10000                # 300~10000，越界拒绝启动
  threshold: 0.6                   # 0~1，越界拒绝启动；可被 INTENT_FOCUS_THRESHOLD 环境变量覆盖
                                   #   0.6 = 2026-10-26 命题改版后的标定拐点（入选不设条数上限，故无 max_actions）
```

| 校验 | 口径 |
|---|---|
| 整块缺失 | **不报错**，功能不可用（`unconfigured`），启动日志一条 `info` |
| 部分缺失（有 `base_url` 无 `api_key`） | 视为配置错误：**启动失败并给出可读原因**（半配置最易被误读成"功能故障"） |
| `api_key` 引用未设置的环境变量 | 启动失败（复用既有 `$ENV` 解析口径，但**不兜底**） |
| `timeout_ms` / `threshold` 越界 | 启动失败（与 `models` 的严格校验同风格，不做静默收敛） |
| 出现 `max_actions` | 启动失败（该键 2026-10-26 已移除；入选按阈值全量筛选，不设条数上限） |
| 端点地址 | MUST 以 `http(s)://` 开头（否则容器内解析成 scheme 会静默失效——与 `PUBLIC_BASE_URL` 同一道防线） |

### 3.1 环境变量覆写（唯一允许双源的参数）

| 环境变量 | 类型 / 范围 | 缺省 | 优先级 | 说明 |
|---|---|---|---|---|
| `INTENT_FOCUS_THRESHOLD` | `number`，`0 ≤ x ≤ 1` | 取配置块的 `threshold`；两者都缺则 `0.6` | **高于** `config.yaml` | 容器部署时不必改挂载的配置文件即可调整判定灵敏度；越界 → **启动失败**（不静默收敛） |

**为什么只有阈值双源**：工具数量与问法差异会让概率分布整体偏移，阈值是最需要现场调的参数；
其余参数（地址 / 模型 / 令牌 / 超时 / 动作上限）改动频率低，单源（仅配置块）避免"两份口径"。

> 实现落点：`config.ts` 的 `envSchema` 新增该键，`loadConfig()` 在解析配置块后用环境变量**覆盖** `threshold`。
> `process.env` 仍只在 `config.ts` 一处读取（既有模块注释的硬约束）。

**对外冻结**：装配后 `AppConfig.intentFocus?: IntentFocusConfig`，整对象 `Object.freeze`。

---

## 4. 运行态 B：模型容器（`docker-compose.yml` 新增 `laya` 服务）

| 项 | 值 | 说明 |
|---|---|---|
| 镜像 | `chaitin/decis:laya-multilingual-v0.4.0` | **固定版本化 tag**；MUST NOT 用裸 `latest`（会随 release 漂移） |
| 容器名 / 服务名 | `optagent-laya` / `laya` | 与既有 `optagent-*` 命名一致 |
| 端口 | `8103:8000` | 8100/8101/8102 已被 ocr/jev/bom 占用；容器内固定 8000 |
| 资源 | `mem_limit: 6g` + 注释"引擎加载后常驻内存，峰值为权重数倍" | 官方建议 3Gi 请求 / 6Gi 上限（占位值，以实测为准） |
| 鉴权 | `DECIS_API_KEY`（**必设**） | 非 loopback 且无 token 时服务**拒绝启动** |
| 无鉴权开关 | `DECIS_ALLOW_NO_AUTH` **不设** | 保持鉴权开启 |
| 关闭宽限 | `DECIS_SHUTDOWN_GRACE_MS=25000` | 与 backend `stop_grace_period: 25s` 同口径 |
| 健康检查 | 镜像自带 `HEALTHCHECK`（走 `/healthz`） | 冷启动约 2 分钟；`/readyz` 的 `503` 是**终态**，不可当 liveness 用 |
| 重启策略 / 日志 | `unless-stopped` / `x-default-logging` | 与既有服务一致 |
| 暴露面 | **仅 compose 内网**；宿主映射仅为本地直跑 backend 调试用 | 不新增 gateway 路由（判定不经前端） |
| playground | **不启用**（不设 `DECIS_PLAYGROUND_HOST_PORT`） | 其代理会在服务端附加 key，等于把模型开放给能访问该端口的人 |

> 环境变量清单以上游 `configuration.md` 为准；本计划只固定**已核实**的 4 项
> （`DECIS_API_KEY` / `DECIS_ALLOW_NO_AUTH` / `DECIS_SHUTDOWN_GRACE_MS` / `DECIS_PLAYGROUND_HOST_PORT`），
> 其余按镜像默认。部署核对清单见 `quickstart.md §2`。

---

## 5. 线协议：判定请求 / 响应

### 5.1 请求

```http
POST {base_url}/v1/systemone
Authorization: Bearer {api_key}
Content-Type: application/json
```

```json
{
  "state": "<本轮用户输入原文>",
  "model": "laya-multilingual",
  "questions": {
    "order_query": {
      "type": "noul",
      "instructions": "本轮用户发起的任务是否需要使用 查询订单 ？",
      "criteria": { "true": "需要", "false": "不需要" }
    },
    "capacity_query": {
      "type": "noul",
      "instructions": "本轮用户发起的任务是否需要使用 查询产能 ？",
      "criteria": { "true": "需要", "false": "不需要" }
    }
  }
}
```

| 规则 | 内容 |
|---|---|
| `state` | 本轮用户输入原文（**不含历史轮次**，FR-002）；超长按 `MAX_STATE_CHARS=200` 取**尾部**并对齐句首（用户习惯"材料在前、问题在后"） |
| `questions` 键 | **每个候选工具一条 `noul`**，键 = 工具名（响应按同名键回传，无需下标对齐） |
| 命题正文 | `本轮用户发起的任务是否需要使用 {展示名} ？`；展示名 = 内置工具中文 `label` / MCP `server: tool`，超 40 字截断 |
| `criteria` | `{ true: '需要', false: '不需要' }`——实测判据越朴素越好 |
| 题数与分批 | 单批 ≤ **32** 题、候选 ≤ **96**；超出按原序切批**串行**发送，单批超时 = `max(300, ⌊总预算 ÷ 批数⌋ − 100)` 毫秒 |
| 题面长度 | 单题 ≤ **256 token**（上游硬限，超了 `422 too_long`）；现行命题固定十余字，恒在预算内 |
| `model` | 取配置 `model`（缺省 `laya-multilingual`） |

### 5.2 响应（仅取所需字段）

```json
{
  "answers": {
    "order_query":    { "type": "noul", "noul": 0.746 },
    "capacity_query": { "type": "noul", "noul": 0.06 }
  },
  "model": "decis/laya-multilingual@…",
  "usage": { "…": "仅落日志" }
}
```

单题缺 `noul` / 非数字 → **跳过该题**；一条都取不到 → `invalid_response` → 整轮降级。

### 5.3 判定 → 动作（纯函数契约）

```ts
interface ToolCandidate {
  name: string
  description: string
  label?: string                              // 展示名：内置工具中文名 / MCP `server: tool`
}

interface SelectionInput {
  candidates: readonly ToolCandidate[]              // 本轮真实可用清单（已截断到 96）
  scores: Readonly<Record<string, number>>          // 工具名 → noul 真值分数
  threshold?: number                                // 默认 0.6
}

interface FocusAction { tools: string[]; score: number }   // 每个动作含 1~N 个工具标识

interface Selection {
  actions: FocusAction[]         // 0~N，分数降序；同分按候选清单原序（不设条数上限）
  focusPrompt: string            // 形如「本轮可优先考虑以下工具（仅供参考，不必局限）：a，b」；无入选为空串
  dropped: string[]              // 低于阈值的工具名（留档与标定用）
  scores: Record<string, number> // 有效分数表（仅形状合法的取值）
}
```

**确定性**：同输入必得同输出（排序稳定、无时间/随机因素）——测试可逐字断言。

---

## 6. 记录：`{threadDir}/intent-focus.jsonl`

**位置**：`users/{uid}/user-data/{agentName}/threads/{threadId}/intent-focus.jsonl`
（与 `meta.json` / `history.jsonl` / `next-actions.json` 同级，独立文件）

### 6.1 单行形状

```json
{
  "at": "2026-10-25T09:12:33.120Z",
  "thread_id": "9f0c…",
  "agent_name": "生产计划助手",
  "message_id": "m-1730000000000",
  "seq": 12,
  "input": "帮我看看这批订单还能不能插单",
  "disposition": "focused",
  "reason": null,
  "model": "laya-multilingual",
  "round_ms": 214,
  "candidates": 8,
  "truncated": false,
  "probabilities": { "order_query": 0.87, "capacity_query": 0.61, "bom_query": 0.09 },
  "actions": ["order_query", "capacity_query"],
  "focus_prompt": "本轮可优先考虑以下工具（仅供参考，不必局限）：order_query，capacity_query",
  "error": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `at` | ISO 8601 字符串 | 是 | 判定完成时刻 |
| `thread_id` / `agent_name` | string | 是 | 归属线索（010 起线程按数字人分目录，仍显式落一份） |
| `message_id` | string \| null | 是 | 本轮 assistant 消息 id（与历史对账用；轮次尚未定稿时也可能为空） |
| `seq` | number | 是 | 该线程内自增序号（= 第几轮判定，便于排序与去重） |
| `input` | string | 是 | 本轮用户输入原文（截断后的送入值另记 `input_truncated`） |
| `input_truncated` | boolean | 是 | 是否因长度上限被截断 |
| `disposition` | enum | 是 | `focused` / `empty` / `skipped` / `degraded` / `unconfigured` |
| `reason` | string \| null | 是 | `empty`/`skipped`/`degraded`/`unconfigured` 的可读原因（如 `skip:next_action_card`、`timeout`、`http_503`） |
| `model` | string \| null | 是 | 实际请求的模型名 |
| `round_ms` | number \| null | 是 | 判定耗时（毫秒）；跳过/未配置为 `null` |
| `candidates` | number | 是 | 提交的候选工具数（0 表示该数字人无可用工具） |
| `truncated` | boolean | 是 | 候选是否被 96 上限截断 |
| `probabilities` | object \| null | 是 | 工具名 → `noul` 真值分数（字段名沿用；降序前未排序，保留原样便于分析） |
| `actions` | string[] | 是 | 最终入选的工具标识（顺序即提示词顺序）；无入选为 `[]` |
| `focus_prompt` | string | 是 | 实际追加的提示词原文；未追加为 `""` |
| `error` | string \| null | 是 | 原始错误摘要（状态码 / 异常类型），完整栈进结构化日志 |

### 6.2 处置矩阵

| 处置 | 触发 | `focus_prompt` | 是否发起判定调用 |
|---|---|---|---|
| `focused` | 有工具概率 ≥ 阈值 | 非空 | 是 |
| `empty` | 全部低于阈值 / 数字人无可用工具 | `""` | 有工具时是；无工具时不调用 |
| `skipped` | 预置动作入口（请求体 `skip_intent_focus: true`） | `""` | 否 |
| `degraded` | 超时 / HTTP 非 200 / 响应形状非法 / 网络错误 | `""` | 是（失败） |
| `unconfigured` | 配置块缺失或不完整 | `""` | 否 |
| （无记录） | 数字人开关关闭 | — | 否（FR-032 明确"不新增判定记录"） |

### 6.3 有界与并发

| 项 | 口径 |
|---|---|
| 追加 | 每轮 **一条** JSONL，`appendFile` 后不读回 |
| 串行 | per-thread Promise 链（与 `history.ts` 同范式），避免并发写交错 |
| 上限 | 文件 > **256KB** 或 > **200 行** → 重写保留最近 **100** 条 |
| 重写 | 写临时文件 + `fs.renameSync` **原子替换**；失败保留原文件并告警（MUST NOT 抛错） |
| 读取 | **仅**离线分析/排查使用；**代码内没有任何上下文组装路径读取该文件**（FR-023） |
| 删除 | 随线程目录删除（不单独清理） |

---

## 7. 接口增量：`POST /api/threads/{id}/messages`

```jsonc
{
  "content": "帮我看看这批订单还能不能插单",
  "attachments": [],
  "guidance": "…",              // 既有：隐藏工具引导
  "skip_intent_focus": true     // 013 新增：预置动作入口为 true
}
```

| 规则 | 口径 |
|---|---|
| 类型 | `boolean`，**可选**，缺省 `false` |
| 归属 | 仅影响本轮：不落历史、不进消息内容、不回显（FR-042） |
| 未知字段 | schema 仍是 `additionalProperties: false`，故三处必须同改（前端构造 / 后端 schema / 后端类型声明） |
| 优先级 | `skip_intent_focus: true` **优先于**开关：即便数字人开启，本轮也不判定 |

---

## 8. 前端类型（`frontend/src/api/messages.ts`）

```ts
export interface SendMessageInput {
  content: string
  thinking?: boolean
  model?: string
  guidance?: string
  skipIntentFocus?: boolean      // 013 新增
}
```

- `buildSendMessageBody()`：仅在 `true` 时写入 `skip_intent_focus`（与既有"空值省略"一致）；
- 载荷来源两处：`utils/next-steps.ts` 的 `nextStepSendPayload()`（下一步动作卡片）与
  `ChatPanel.onStarterClick`（首屏问题实例卡片）——**两处都必须置 true**（FR-044）。

---

## 9. 不变量

| # | 不变量 | 落点 |
|---|---|---|
| DM-1 | `SOUL.md` frontmatter 的任何新键都 **不进** System Prompt 正文 | `stripFrontmatter` |
| DM-2 | `intent-focus.jsonl` 与 `history.jsonl` **物理分离**，且无读取方 | 存储层 |
| DM-3 | 判定结果只活在**一轮**内：不缓存、不复用、不落历史 | `run-consume` 局部变量 |
| DM-4 | 同一线程的记录追加串行、重写原子 | per-thread 串行链 + `renameSync` |
| DM-5 | 判定模型与主对话模型**配置、密钥、调用链**三方面解耦 | `config.ts` + 独立适配器 |
| DM-6 | 关闭开关时零副作用：不调用、不落记录、产物无残留键 | `isIntentFocusEnabled` + `renderSoulMd` |
