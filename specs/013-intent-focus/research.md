# 013 研究：意图聚焦（Intent Focus）技术决策

> **口径提示（2026-10-26 更新）**：本文"每个候选工具一条 `noul`"的结论**几经反复**。2026-10-25 晚曾因
> 实测切不开而改为一条 `choice`（选项 = 工具名 + `__none__`）；2026-10-26 用户拍板**回到 `noul`**：
> 每个候选一条，"本轮用户发起的任务是否需要使用 X ？" + 极简判据（`需要 / 不需要`），阈值 0.6，
> 并配合**软措辞**的聚焦提示（"仅供参考，不必局限"）容纳 noul 的噪声（多给几个的代价低于漏选）。
> 现行口径以 [`contracts/intent-focus-api.md` §3.2](./contracts/intent-focus-api.md) 为准；
> 三套措辞的对照实测见 [`spec.md`](./spec.md) 的 2026-10-26 修订记录与
> `agent-backend/scripts/calibrate-intent-focus.mjs`。本文保留为研究过程记录（含已被否决的备选方案）。

- **特性标识**：`013-intent-focus`
- **日期**：2026-10-25
- **规格**：[spec.md](./spec.md)
- **结论摘要**：判定用 **Laya 多语言版决策模型（`laya-multilingual`）**，官方镜像独立容器部署，
  运行环境**直接 HTTP 调用其 System One 线协议端点**（不经 MCP、不注册为工具）；
  一次请求内对"每个候选工具"各发一个真值命题，按概率阈值 + 条数上限筛出工具组合；
  聚焦提示只追加本轮素材、不落历史；判定记录单独落线程目录。

---

## 0. 取证（写计划前核实的事实）

| # | 事实 | 来源 |
|---|---|---|
| F1 | Laya 是**结构化决策模型**（System One）：用 Choice（单选）/ Score（评分）/ Noul（真值概率）三类问题对文本或状态做一次推理，**不是对话/生成模型** | 1Panel 应用商店说明、`savrn.com` 模型页 |
| F2 | 模型身份 `laya-multilingual` 为 mmBERT-base 基座、100+ 语言、ONNX fp32；官方容器镜像仓库 `chaitin/decis`，tag 即引擎名，`laya-multilingual` 带裸 `latest` 别名，当前发布版本 **v0.4.0**；**发布 tag 不可变，`latest` 随 release 移动** | `chaitin/Decis` `docs/deployment.md` |
| F3 | 容器内监听 **8000**；`docker run -p 8000:8000 -e DECIS_API_KEY=... chaitin/decis:laya-multilingual` 即可起服务；**无需 GPU**，权重已烤进镜像 | 同上 + 1Panel 说明 |
| F4 | 已核实的运行时环境变量：`DECIS_API_KEY`（单 token 鉴权；非 loopback 且未配置 token 时**拒绝启动**）、`DECIS_ALLOW_NO_AUTH`（仅设 `1` 才允许无鉴权启动）、`DECIS_SHUTDOWN_GRACE_MS`（优雅关闭宽限）、`DECIS_PLAYGROUND_HOST_PORT`（playground 绑定地址）、`COMPOSE_PROFILES`（引擎 profile）。完整清单在上游 `configuration.md` | `docs/deployment.md` |
| F5 | 探针语义**不可互换**：`/healthz` = 进程存活（liveness）；`/readyz` = 可应答（readiness，冷启动约 2 分钟，`503` 为**终态**应告警而非重试）；`/v1/models` = 模型列表 | 同上 |
| F6 | 端点 `/v1/systemone` 为 **System One 线协议**；官方部署文档**未列出** `/v1/chat/completions` 等对话补全端点，只把 `/v1/models` 列为兼容端点 | 同上 |
| F7 | 本仓库 `jev-service` 已实现同一线协议：`POST {base_url}` + `Authorization: Bearer <token>` + body `{ state, model, questions: { <key>: <question> } }`，响应 `{ answers: { <key>: {...} }, model, usage }`；单问题键由调用方自定义；**同一 state 下多个问题并行且相互隔离求值** | `jev-service/jev_core.py` L309-311、L440-498；`server.py` L128-148 |
| F8 | 运行侧现有对话模型走 `pi-ai` 的 `deepseekProvider()`，构造时**必须在 pi-ai 模型目录中命中模型 id**（否则抛错）；目录中不含 Laya | `agent-backend/src/infra/llm/pi-ai-provider.ts` L24-33 |
| F9 | 发送请求体 schema 为 `additionalProperties: false`，新增字段必须三处同改（前端请求构造 / 后端 schema / 后端路由类型声明） | `agent-backend/src/routes/chat.ts` L40-65、L126-132 |
| F10 | 会话历史 `history.jsonl` 由 `prompt-builder` 切片进 messages；`systemExtra` 段序为「摘要 → 外置结果索引 → 后台产出 → 当前时间 → guidance」 | `agent-backend/src/domain/prompt-builder.ts` L88-99 |
| F11 | 行数基线（2026-10-25 实测）：`run-manager.ts` **539**（已超 500 硬门禁，本次必然触及）、`next-actions.ts` **543**（存量超限，本次不动）、`server.ts` **498**（贴线）、`frontend/src/api/types.ts` 525（存量超限，不动）、`soul-design.ts` 490、`useChatPanel.ts` 486、`ChatPanel.vue` 474 | 逐文件实测 |

---

## 1. 决策（D1~D13）

### D1 走 System One 线协议，不走对话补全接口

**决策**：判定调用 `POST {base_url}/v1/systemone`，请求体
`{ state, model, questions: { result: <question> } }`，`Authorization: Bearer <token>`。

**理由**：Laya 是决策模型（F1），官方未列出对话补全端点（F6）；而 `jev-service` 已证明该线协议的
请求/响应形状在本项目内可复用（F7），"直接调用"因此有现成口径，不需要新增依赖。

**被否决**：
- *按 OpenAI `/v1/chat/completions` 调用* —— 官方部署文档未列出该端点，赌它存在等于把功能建在未证实的接口上；
- *复用 `PiAiLlmProvider`* —— 它绑定 `deepseekProvider()` 的模型目录，Laya 不在目录内，构造即抛错（F8）；
- *复用 `jev-service`（MCP）* —— 用户明确要求**不经 MCP**（FR-054），且 MCP 工具会出现在模型工具清单里，
  主模型可能"顺手"调用判定能力，语义污染。

### D2 多标签用"N 个真值命题"，不用一次单选

**决策**：为每个候选工具构造一个 `noul`（真值概率）命题，**同一次请求内批量提交**：

```
questions: {
  t1: { type: "noul", instructions: "本轮用户输入是否需要用工具 {name} 来完成？", criteria: { true: "{用途}", false: "不需要该工具" } },
  t2: { ... },
  ...
}
```

按 `answers[tN].noul` 取概率，`≥ 阈值` 的按概率降序取前 `max_actions` 个。

**理由**：
- 需求要的是"工具**组合**"（多选）。`choice` 是**单选**，其 `probabilities` 归一到 1——
  候选工具一多，单题概率被稀释，任何统一阈值都失效；
- `noul` 每题独立输出 0~1 真值概率，天然可比、可阈值化；
- 同一 `state` 下多问题**并行且相互隔离**（F7），所以"N 题"仍只是**一次 HTTP 调用**，满足"每条消息调用一次"的口径。

**代价与限制**：题量 = 候选工具数，CPU 上 N 次前向的耗时随 N 增长 ⇒ 候选上限 **24**；
超限时按工具清单原序截取前 24 个（并在留档标注 `truncated`），阈值与题量需按 `quickstart.md §7` 标定。

**被否决**：
- *单选 `choice` + 取 top-k 概率*：概率归一导致阈值不可用（同上）；
- *两次调用（先选类目再选工具）*：违反"每条消息一次调用"的确定性，也放大尾延迟；
- *让模型生成自然语言再解析工具名*：Laya 不产出自然语言（F1），解析分支是死代码。

### D3 判定能力不注册为工具、不经 MCP

**决策**：Laya 只被 backend 直接调用；不新增 MCP 服务、不进入任何数字人的工具清单、不进入 `TOOL.json`。

**理由**：用户口径（FR-054）。另外工具清单是主模型可见的（007 的 Tail Protocol 会把它写进提示词），
把判定能力放进去会让主模型自己"决定要不要聚焦"，破坏"每次必先判定"的确定性（FR-001）。

### D4 阻塞式前置 + 有界超时 + 不重试

**决策**：判定在 `run-manager` 组装 prompt **之前**同步执行；默认超时 **3000ms**（配置上限 5000ms），
失败即降级，**不重试**。

**理由**：需求原文是"在用户输入正式送入大模型前"（FR-001），异步补做不到"影响本轮规划"。
"每次对话一次调用"使重试的收益低于其尾延迟代价；阈值化后单次失败只是"本轮不聚焦"。

**被否决**：
- *异步生成、下一轮才用*：与 FR-001 / FR-005 冲突（用户看到的是"这轮没聚焦"）；
- *重试 1~2 次*：把 P99 尾延迟从 3s 抬到 6~9s，而失败本就等价于"无聚焦"（FR-009）。

### D5 记录落 `intent-focus.jsonl`（与历史、侧车数据分离）

**决策**：线程目录新增 `intent-focus.jsonl`，每轮一条；per-thread 串行追加（复用 `history.ts` 的
Promise 链范式）；文件超过 **256KB 或 200 行**时重写保留最近 **100** 条（原子改名）。

**理由**：FR-020/FR-022/FR-023。独立文件保证"不进入历史上下文"在**存储层**就成立——
组装路径读的是 `history.jsonl` 与 `next-actions.json`，永远不会碰到这个文件。

**被否决**：
- *写进 `history.jsonl` 的元数据*：一旦进历史文件，任何按"读历史"实现的上下文组装都有机会带上它，
  违反 FR-011（重点约束）；
- *写进 `meta.json`*：单文件随轮次增长，且与 `ThreadStore` 的读改写竞争；
- *数据库表*：违反"沿用既有落盘范式"（TR-08）且引入新存储面。

### D6 开关经 SOUL frontmatter（复用 007 范式）

**决策**：`SOUL.md` frontmatter 新增 `intent_focus: true`，**仅开启时写**；运行侧新增
`SoulMeta.intentFocus` + `isIntentFocusEnabled()`（失败 → `false`，逐次读盘）。

**理由**：与 `next_action_hints` 完全同构（F11 之外的既有实现），天然满足"不进 System Prompt"与
"关闭态部署无残留"；不新增配置文件形态。

### D7 跳过标记走请求体，由服务端校验

**决策**：`POST /api/threads/{id}/messages` 新增 `skip_intent_focus: boolean`（缺省 false）；
前端在两个**预置动作入口**置 `true`：下一步动作卡片确认发送、首屏问题实例卡片点击。

**理由**：FR-040/FR-043/FR-044。放在请求体而不是"前端不触发"是因为节流判据必须**服务端可校验**，
否则绕过前端（改脚本、旧前端缓存）就能让判定被静默跳过。标记不入库、不进消息内容（FR-042）。

**被否决**：
- *用 `guidance` 是否存在推断跳过*：`guidance` 是"隐藏工具引导"，未来可能有别的来源，语义不同；
- *前端自行不请求判定*：前端无法决定后端行为，且不可测。

### D8 聚焦提示插在 `guidance` 之前

**决策**：`systemExtra` 段序变为「摘要 → 外置结果索引 → 后台产出 → 当前时间 → **聚焦提示** → `guidance`」。

**理由**：`guidance` 是"本轮指令"，既有设计刻意让它紧邻用户消息、处于最末段（F10）；聚焦提示是
"本轮规划范围"，属于较粗的约束，放在它前面既保住既有口径，又让模型先看范围再看具体工具。

### D9 阈值与上限：`threshold=0.5`、`max_actions=3`、候选上限 24

**决策**：三项均可配置；默认如上。筛出顺序：概率降序 → 同概率按工具清单原序（保证确定性）。

**理由**：0.5 是"多数置信"的最小可用默认；3 与 007 的动作上限同源（提示词长度可控）；
"同概率按清单序"保证同输入同输出，便于测试断言与问题复现。

### D10 配置块 `intent_focus`（可选，缺省不启用）

**决策**：`config.yaml` 新增可选块：

```yaml
intent_focus:
  base_url: http://laya:8000      # 必填（启用时）
  model: laya-multilingual        # 缺省即此值
  api_key: $DECIS_API_KEY         # 必填（启用时），支持 $ENV 引用
  timeout_ms: 3000                # 上限 5000
  threshold: 0.5                  # 0~1
  max_actions: 3                  # 1~3
```

**理由**：`models` 数组是"对话模型"语义（第一项 = 默认模型，会影响主链路），把判定模型塞进去会
改变默认模型的选择面；独立命名空间最安全。令牌**独立解析**：失败即"未配置"，
MUST NOT 落到 `DEEPSEEK_API_KEY` 兜底（否则会拿错密钥去打 Laya，表现为 401 而非"未配置"）。

### D11 镜像固定版本化 tag，环境变量按模型要求注入

**决策**：编排使用 `chaitin/decis:laya-multilingual-v0.4.0`（**不用裸 `latest`**），服务名 `laya`，
容器端口 8000、宿主映射 **8103**（8100/8101/8102 已被 ocr/jev/bom 占用），注入：

| 环境变量 | 取值 | 依据 |
|---|---|---|
| `DECIS_API_KEY` | 与运行侧 `intent_focus.api_key` 同值（由 `.env.local` 提供） | 非 loopback 且无 token 时**拒绝启动**（F4） |
| `DECIS_SHUTDOWN_GRACE_MS` | `25000`（与 backend `stop_grace_period: 25s` 同口径） | F4 |
| `DECIS_ALLOW_NO_AUTH` | **不设**（保持鉴权开启） | F4 |

`DECIS_PLAYGROUND_HOST_PORT` 不启用（镜像默认不带 playground profile）；完整变量清单以上游
`configuration.md` 为准，部署时按 `quickstart.md §2` 的核对清单确认一次。

**被否决**：*`latest`* —— 官方明示 `latest` 随 release 移动，重跑 `docker compose up --build` 会静默换模型版本，
判定阈值随之漂移（F2）。

### D12 `run-manager.ts` 拆分（硬门禁，非可选）

**现状**：**539 行**（已超 500），本次必然触及（前置判定 + 传入 prompt）。
**决策**：把**轮次执行**（`consume`：流消费 + 事件分派 + 收尾调用 + 结束日志，约 190 行）
**纯搬运**到新模块 `domain/run-consume.ts`（导出 `consumeTurn(deps, run, opts, turn, ...)`），
`run-manager.ts` 只留编排（配额、活跃表、`startRun`、`buildPrompt`、意图聚焦前置）。
预计 `run-manager` 539 → **约 355**，`run-consume` 约 **215**。

**约束**：MUST 纯搬运（不改行为、不改事件顺序、不改落盘顺序），既有 `run-manager-*.spec.ts` 保持全绿；
若用例直接依赖私有方法，只改导入路径，MUST NOT 改断言口径。

### D13 `server.ts` 装配外移（守住硬门禁）

**现状**：**498 行**，距 500 只差 2 行，而本次要新增「意图聚焦服务装配 + 注入 RunManager」。
**决策**：把**附加能力装配**（`summary` / `nextActions` / 新增 `intentFocus` 的构造与告警节流）
纯搬运到 `src/server-attachments.ts`（新文件，导出 `buildAttachments(root, config, history, deps)`），
`server.ts` 只调用一次。预计 `server.ts` 498 → **约 470**。

**被否决**：*在 `server.ts` 里省注释腾 2 行* —— 只是把超限风险推给下一个改动，不符合"不得保留"的口径。

---

## 2. 被否决的替代方案（汇总）

| # | 方案 | 否决理由 |
|---|---|---|
| 1 | 用主对话模型做判定 | 用户明确要求独立轻量模型（FR-050）；且会翻倍主模型调用成本 |
| 2 | 把 Laya 包装成 MCP 服务 | 用户明确"不通过 MCP/工具调用"（FR-054）；且会进入工具清单 |
| 3 | 把 Laya 注册为内置工具 | 同上，且让主模型可自行决定是否聚焦，破坏确定性 |
| 4 | 用 `choice` 单选 + top-k | 概率归一到 1，工具多时阈值失效（D2） |
| 5 | 让模型生成动作中文名再解析 | Laya 不产出自然语言（D2） |
| 6 | 判定结果写进历史/摘要 | 违反 FR-011（不进入历史上下文） |
| 7 | 把判定记录塞进 `meta.json` | 与线程元数据读写竞争、随轮次膨胀（D5） |
| 8 | 异步生成、下一轮生效 | 与 FR-001/FR-005 冲突（D4） |
| 9 | 复用 `pi-ai` provider 打 Laya | 模型目录不含 Laya，构造即抛错（F8） |
| 10 | 前端自行跳过而不发标记 | 服务端不可校验（D7） |
| 11 | 用裸 `latest` 镜像 | 版本静默漂移，阈值失准（D11） |
| 12 | `server.ts` 内挤行数 | 把超限风险后移（D13） |

---

## 3. 对本特性交付的硬约束（来自宪章与规格）

- 判定调用 MUST 有界（超时 ≤5s、不重试），降级 MUST 静默但**原始错误落结构化日志**（原则九）；
- 记录写入失败 MUST NOT 影响对话；重写 MUST 原子替换（原则五）；
- 新增模块 MUST 进覆盖率清单（≥80%），测试全部本地执行（原则三/八）；
- 四侧契约同改（原则七），中文文档（原则一）。
