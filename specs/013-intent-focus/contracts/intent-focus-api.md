# 013 契约增量：意图聚焦（Intent Focus）

- **特性标识**：`013-intent-focus`
- **日期**：2026-10-25
- **规格**：[spec.md](../spec.md) ｜ **数据模型**：[data-model.md](../data-model.md)
- **须回写的上游契约**：
  - `specs/001-digital-human-platform/contracts/admin-api.md` —— §5 SOUL 字段表新增 `intent_focus`
  - `specs/001-digital-human-platform/contracts/runtime-api-delta.md` —— `POST /api/threads/{id}/messages` 新增 `skip_intent_focus`；SOUL frontmatter 新增键；线程目录新增 `intent-focus.jsonl`

> 本文覆盖四段契约：**配置（设计态/物化）**、**公开 HTTP（消息发送）**、
> **内部 HTTP（backend → Laya）**、**线程目录文件（记录）**。
> 结论先行：**SSE、会话详情、`next-actions` 端点、数字人详情、工具清单三处零变更**（§7）。

---

## 1. 配置契约：SOUL 结构化字段（设计态 → 物化）

### 1.1 设计态 API 字段

| 字段 | 类型 | 可选 | 缺省 | 校验 |
|---|---|---|---|---|
| `soul.intent_focus` | `boolean` | 是 | `false` | 缺键 → `false`；非布尔 → **400 拒绝**（拒绝式校验，与 `next_action_hints` 同口径） |

- 读接口对外**恒有**该键（`withSoulDefaults` 补齐），与 007 的 `next_action_hints` 一致；
- 写接口（保存设计态）接受缺省（等价 `false`）；
- 旧设计态 / 旧字符串 SOUL 升级后为 `false`。

### 1.2 物化产物 `SOUL.md`

```markdown
---
soul_version: 1
intent_focus: true          # 仅在开启时写入；关闭时整键不出现
---
```

| 规则 | 口径 |
|---|---|
| 写入条件 | `intent_focus === true` |
| 关闭态 | 键**不存在**（部署产物无残留，规格 FR-033） |
| 正文 | 逐字不变；该键**不进** System Prompt（规格 FR-034） |
| 运行侧解析 | 非布尔 / 缺失 → `false`（fail-closed） |

---

## 2. 公开 HTTP：[`POST /api/threads/{id}/messages`] 请求体新增字段

### 2.1 请求

```jsonc
{
  "content": "string, minLength 1, required",
  "thinking": "boolean, optional",
  "model": "string, optional",
  "guidance": "string, maxLength 500, optional",
  "attachments": "array, maxItems 10, optional",
  "skip_intent_focus": "boolean, optional"      // 013 新增
}
```

**Schema 增量**（`agent-backend/src/routes/chat.ts` 的 `messageBodySchema`）：

```ts
skip_intent_focus: { type: 'boolean' },
```

- 仍为 `additionalProperties: false` ⇒ 未同步 schema 的新字段会被 **400** 拒绝；
- 类型声明同步：路由内 `body` 类型 + `StartRunOptions` + 前端 `SendMessageInput`。

### 2.2 语义

| 输入 | 行为 |
|---|---|
| 缺省 / `false` | 按数字人 SOUL 开关决定是否判定 |
| `true` | **本轮跳过**判定（不调用、不追加上下文），仅留档 `disposition=skipped` |
| `guidance` 非空白（未带标记或显式 `false`） | **服务端归一为跳过**：`guidance` 就是卡片自带的工具引导，与聚焦提示属同一层"本轮工具建议"，共存会互相拉扯（聚焦提示位置更靠后、权重更大）。归一在域层（`run-consume`）实现，任何调用方都受同一约束 |
| 数字人开关关闭 + `true` | 无记录（开关关闭不留档，规格 FR-032） |

### 2.3 不允许的用法

- MUST NOT 由前端"不发请求"来模拟跳过（服务端可校验）；
- MUST NOT 把该标记写进 `content`、消息气泡或历史；
- MUST NOT 因该标记改变状态码或 SSE 事件序列（正常 200 + 流式，与既有完全一致）。

---

## 3. 内部 HTTP：backend → Laya（System One 线协议）

> 非公开接口（不经 gateway，前端不可见），但形状必须稳定：它是"判定能力"的唯一出入口。

### 3.1 端点与鉴权

| 项 | 值 |
|---|---|
| 方法 / 路径 | `POST {intent_focus.base_url}/v1/systemone` |
| 鉴权 | `Authorization: Bearer {intent_focus.api_key}` |
| Content-Type | `application/json` |
| 超时 | `intent_focus.timeout_ms`（默认 3000，上限 5000），超时即降级、**不重试** |
| 连接复用 | 平台原生 `fetch`（无第三方 HTTP 客户端） |

### 3.2 请求体

```jsonc
{
  "state": "本轮用户输入原文（超长取尾部：≤200 字符，尽量对齐句首）",
  "model": "laya-multilingual",
  "questions": {
    "read_file": {
      "type": "noul",
      "instructions": "本轮用户发起的任务是否需要使用 读取文件 ？",
      "criteria": { "true": "需要", "false": "不需要" }
    },
    "erp__query_order": {
      "type": "noul",
      "instructions": "本轮用户发起的任务是否需要使用 erp: query_order ？",
      "criteria": { "true": "需要", "false": "不需要" }
    }
    // … 每个候选工具一条；键 = 工具名（不是 t1/t2 下标）
  }
}
```

**形态：每个候选工具一条 `noul`（真值概率），同一次请求内批量提交**（2026-10-26 标定）：

| 决策点 | 口径 |
|---|---|
| 为什么不用 `choice` | `choice` 是单选、概率归一到 1：候选一多 top1 被稀释，且最多只能选 1 个，无法表达"这轮要用两个工具"。`noul` 各题**互不竞争**，天然支持多工具同时命中 |
| 键 = 工具名 | 响应 `answers[qid].noul` 按同名键回传，不需要"tN 下标 → 工具名"的对齐（错位时表现为工具串位，最难排查） |
| 命题正文 | `本轮用户发起的任务是否需要使用 {展示名} ？`；展示名 = 内置工具中文 `label` / MCP 的 `server: tool`，超 40 字截断 |
| 判据 | `{ true: '需要', false: '不需要' }`——实测**判据越朴素越好**，写成"用户明确要求…"反而让无关项飙升 |
| 分批 | 每批 ≤32 题、候选 ≤96；超限按原序切批**串行**发送，单批超时 = `max(300, ⌊总预算 ÷ 批数⌋ − 100)` 毫秒 |
| 题面长度 | 单题 ≤256 token（超了 `422 too_long`）；现行命题固定十余字，恒在预算内 |

### 3.3 响应体（只依赖 `answers[*].noul`）

```jsonc
{
  "answers": {
    "read_file":        { "type": "noul", "noul": 0.104 },
    "erp__query_order": { "type": "noul", "noul": 0.912 }
  },
  "model": "decis/laya-multilingual@...",
  "usage": { "input_tokens": 210, "output_tokens": 0 },
  "decis": { "engine": "laya-multilingual", "device": "cpu", "latency_ms": 1800 }
}
```

| 容错 | 口径 |
|---|---|
| 某题缺 `noul` / 非数字 | **跳过该题**（32 条里坏一条不该让整轮丢失），其余照常参与筛选 |
| 一条分数都取不到 | `degraded`，原因 `invalid_response` |
| 缺 `answers` / 响应非 JSON | `degraded`，原因 `invalid_response` |
| HTTP 非 2xx | `degraded`，`error` 记 `batch_N:http:503`，`message` 带**响应体摘要**（422 这类 schema 拒绝只看状态码无法定位） |
| 超时 | `degraded`，`reason=timeout`；**不重试** |
| 额外字段 | 忽略（不视为错误，便于上游演进） |

### 3.4 健康与就绪（部署核对用，非运行期依赖）

| 端点 | 用途 | 注意 |
|---|---|---|
| `GET /healthz` | 进程存活 | **仅**用于 liveness |
| `GET /readyz` | 可应答（冷启动约 2 分钟） | `503` 为**终态**，应告警而非重试；**不可**当 liveness |
| `GET /v1/models` | 模型列表 | 部署冒烟用 |

> 运行期**不**做前置健康检查：每次消息已是一次真实调用，健康探测只会多一跳；
> 失败按"本轮不聚焦"降级（规格 FR-052）。

---

## 4. 线程目录文件契约：`intent-focus.jsonl`

| 项 | 值 |
|---|---|
| 路径 | `users/{uid}/user-data/{agentName}/threads/{threadId}/intent-focus.jsonl` |
| 编码 | UTF-8，每行一个 JSON 对象（紧凑），行尾 `\n` |
| 写入 | 每轮判定后追加 1 行；per-thread 串行；失败只告警 |
| 上限 | > 256KB 或 > 200 行 → 重写保留最近 100 条（临时文件 + 原子改名） |
| 读取 | 仅离线分析；**运行期无读取方**（规格 FR-023） |
| 删除 | 随线程目录删除 |
| 版本 | 字段只增不改义；新增字段必须可选，旧记录仍可解析 |

字段表与处置枚举见 [data-model.md §6](../data-model.md)。**该文件不属于任何 HTTP 响应**。

---

## 5. 运行环境配置与容器契约

### 5.1 `config.yaml` 新增可选块

```yaml
intent_focus:
  base_url: http://laya:8000
  model: laya-multilingual
  api_key: $DECIS_API_KEY
  timeout_ms: 10000      # 缺省；区间 300~10000
  threshold: 0.6         # 缺省；可被 INTENT_FOCUS_THRESHOLD 覆盖
```

| 情形 | 结果 |
|---|---|
| 整块缺失 | 启动成功，功能不可用（`unconfigured`），一条 `info` 日志 |
| `base_url` 与 `api_key` 任一缺失 | **启动失败**（可读报错：半配置会被误读成运行期故障） |
| `$ENV` 引用未设置或为**空串** | **启动失败**（MUST NOT 落到 `DEEPSEEK_API_KEY` 兜底；空串按"未设置"处理） |
| `timeout_ms ∉ [300,10000]` / `threshold ∉ [0,1]` | **启动失败**（报错指名 `intent_focus.<字段>` 与合法区间、当前值；即使阈值被环境变量覆盖，配置文件里的坏值照样拒绝） |
| 出现 `max_actions` | **启动失败**（该键 2026-10-26 起已移除：入选不设条数上限；留着旧键会静默失效） |
| 块内出现**未知键**（如把 `timeout_ms` 写成 `timeout`） | **启动失败**（`strict`，MUST NOT 静默跑缺省） |
| 设了 `INTENT_FOCUS_THRESHOLD` 且 ∈ `[0,1]` | 覆盖配置块的 `threshold`（**环境变量优先**） |
| `INTENT_FOCUS_THRESHOLD` 为**空串**（`INTENT_FOCUS_THRESHOLD=`） | 视为**未设置**，回落配置文件（`z.coerce.number` 会把 `''` 变成 `0` ⇒ 所有工具都入选且零报错，故必须显式拦掉） |
| `INTENT_FOCUS_THRESHOLD` 越界或非数字 | **启动失败**（不静默收敛） |
| `base_url` 非 `http(s)://` 开头 | **启动失败** |
| `base_url` 带路径（如 `http://laya:8000/v1`） | **启动失败**（请求路径由客户端拼 `/v1/systemone`，带路径会变成 `/v1/v1/systemone`） |

> **参数区间的单一来源**：`agent-backend/src/config.ts` 的 `INTENT_FOCUS_LIMITS` /
> `INTENT_FOCUS_DEFAULTS`。报错文案、示例文件与本文的区间都引用同一组数字。

### 5.2 容器（`docker-compose.yml` 新增 `laya` 服务）

| 项 | 契约 |
|---|---|
| 镜像 | `chaitin/decis:laya-multilingual-v0.4.0`（**固定版本 tag**；MUST NOT `latest`） |
| 端口 | 容器 `8000`；宿主 `8103`（8100/8101/8102 已占用） |
| 必设 env | `DECIS_API_KEY`（= 运行侧 `intent_focus.api_key`） |
| 其它 env | `DECIS_SHUTDOWN_GRACE_MS=25000`；**不设** `DECIS_ALLOW_NO_AUTH`；**不设** `DECIS_PLAYGROUND_HOST_PORT` |
| 资源 | `mem_limit: 6g`（官方占位值，按实测调整） |
| 健康检查 | 镜像自带（`/healthz`） |
| 暴露 | 仅 compose 内网；**不新增 gateway 路由** |
| 依赖方向 | `backend` 单向依赖 `laya`（MUST NOT 反向） |

---

## 6. 降级与错误矩阵

| 场景 | `disposition` | 用户可见 | 日志 |
|---|---|---|---|
| 正常入选 ≥1 工具 | `focused` | 正常回答（规划被聚焦） | `intent-focus.ok`（含阈值/入选数/耗时） |
| 全部低于阈值 | `empty` | 与未开启一致 | `intent-focus.empty` |
| 数字人无可用工具 | `empty` | 与未开启一致（**不发起调用**） | `intent-focus.empty`（`reason=no_tools`） |
| 预置动作入口 | `skipped` | 与未开启一致 | `intent-focus.skipped`（`reason=skip:*`） |
| 超时 | `degraded` | 无感 | `intent-focus.failed`（`reason=timeout`，`alert: true`） |
| HTTP 非 200 | `degraded` | 无感 | 同上（含 `status`） |
| 响应形状非法 | `degraded` | 无感 | 同上（`reason=invalid_response`） |
| 未配置 / 半配置 | `unconfigured` | 无感 | 启动期 `info` + 首轮 `warn`（节流） |
| 记录写入失败 | 不变 | 无感 | `intent-focus.record.failed`（`alert: true`） |

**统一约束**：任何一行失败都 MUST NOT 改变响应状态码、SSE 事件序列、回答正文与历史内容。

---

## 7. 零变更声明（显式）

| 契约 | 结论 |
|---|---|
| SSE 事件序列（`thinking` / `content` / `tool_call*` / `done` / `error`） | **零变更** |
| `GET /api/threads/{id}`（会话详情） | **零变更**（不新增字段） |
| `GET /api/threads/{id}/next-actions` | **零变更** |
| 数字人详情（`intro` / `welcome` / `starters`） | **零变更**（不暴露开关） |
| 工具清单（内置 + MCP，`TOOL.json` / `MCP.json`） | **零变更**（判定能力不入清单） |
| 错误响应格式 | 复用既有 `{ error: { code, message, details? } }`，**不新增错误码**（判定失败从不向用户暴露） |
