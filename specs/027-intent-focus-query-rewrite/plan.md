# 实施计划：意图聚焦指代改写（输入重写）

- **分支**：`main`（本仓库未注册 `before_specify` / `before_plan` git 钩子，未新建特性分支；规格目录为权威落点）
- **日期**：2026-11-19
- **规格**：[spec.md](./spec.md)
- **输入**：`specs/027-intent-focus-query-rewrite/spec.md`
- **说明**：本计划基于现有 `agent-backend` / `admin-backend` / `admin-frontend` 技术栈；不新增依赖、不新增外部服务、不改聊天前台接口字段。

## 摘要

在意图聚焦链路中插入一个**指代改写阶段**：当「意图聚焦」「输入重写」双开关皆开时，先用既有 Laya 对「本轮输入尾部 200 字」做一次单条 `noul` 指代判断；判为真则用**本轮生效的对话模型**（既有 `LlmProvider`，无工具）结合最近 3 个完整问答轮与本轮输入，生成一段 ≤100 字、简洁自洽的改写文本；随后**只用这段改写文本**做技能 / 本体行为评分与发散。

同时把两件事落到设计态：

1. 新增数字人布尔开关「输入重写」（`input_rewrite`，缺省关闭）；
2. 新增数字人布尔开关「术语替换」（`term_normalize`，位于意图聚焦配置区，缺省关闭），把 `018` 原来的「意图聚焦即替换」改为双开关闸门，并在界面给出固定说明"拥有本体术语映射集才生效"。

**硬边界**：改写结果不进用户消息、不进 `systemExtra` 的可见段落、不进历史 / 摘要 / 记忆 / 卡片；发给主模型与用户所见的仍是「术语替换确认后的原话」。

## 技术上下文

**Language/Version**：TypeScript（ESM）/ Node.js ≥ 20（`agent-backend`、`admin-backend`），Vue 3 + Vite（`admin-frontend`）。

**Primary Dependencies**：
- Fastify 5（既有路由；本特性不新增端点）
- `zod` 4（`config.ts` 的 `intent_focus` 块校验）
- `yaml` 2.9（SOUL frontmatter 读写，既有）
- 既有 `LayaClient`（`/v1/systemone`，唯一 Laya 出口）
- 既有 `LlmProvider`（`streamChat`，`agent-backend/src/infra/llm/llm-provider.ts`）
- 既有 `HistoryStore`（`readAll`，`history.jsonl` 只含 user / assistant 正文）
- **无新增依赖**：不加 HTTP 客户端、不加改写专用模型、不加数据库。

**Storage**：
- 线程侧车：`.opt-agent/users/{user}/user-data/{agent}/threads/{thread}/intent-focus.jsonl`
  （复用现有记录文件与滚动上限；只追加字段，不新增文件）
- 历史：同目录 `history.jsonl`（只读；无新格式）
- SOUL：数字人目录 `SOUL.md` frontmatter 新增 `input_rewrite` / `term_normalize`（仅 true 时写键）
- 平台设计态：`.platform-data/agents/{name}.json` 的 `soul` 对象新增两个布尔键（读取归一化恒有该键）
- 无迁移脚本：缺键即 false，读写两侧同一 fail-closed 口径。

**Testing**：
- 后端：Vitest；`npm run test`（单元）、`npm run test:integration`、`npm run test:coverage`、`npm run gate`（typecheck → lint → coverage → build）
- 管理端：Vitest + 组件测试（`SoulEditor.spec.ts` 同名同目录）
- 管理平台服务：Vitest（`tests/unit` / `tests/integration`）
- 不依赖真实 Laya / 真实 LLM：判定客户端与 `LlmProvider` 均以桩注入。

**Target Platform**：Linux 容器（部署）/ Windows 本地开发（中文路径，全部走 `node:path`）。

**Project Type**：多端 Web 应用（运行环境 + 管理平台服务 + 管理前端 + 聊天前台）。

**Performance Goals**：
- 指代判断：1 条 `noul`，单次 ≤ 3 秒（受阶段剩余预算约束）；
- 改写：1 次非流式聚合调用，缺省上限 **5 秒**（`rewrite_timeout_ms`），且 MUST NOT 超过阶段总预算；
- 指代轮次额外等待 **P90 ≤ 3 秒**（SC-005）；聚焦阶段整体 ≤ **10 秒**（沿用 `INTENT_FOCUS_DEFAULTS.timeoutMs`）；
- 非指代轮次：只多一次单条 Laya 判定（与 013 同量级），无模型改写等待。

**Constraints**：
- 改写只在「聚焦 + 输入重写」皆开、且该轮有可聚焦技能时发生；关闭 / 跳过 / 无技能短路轮 **零新增调用**；
- 判定与改写共享 10 秒阶段预算，剩余预算不足 300ms 时放弃改写（回退原话）；
- 改写请求 `tools: []`、`thinking: false`、不写历史、不产卡片、不产生 SSE 事件；
- 单文件 ≤ 500 行（新增模块），存量超限文件不得继续堆叠逻辑；
- 后端新增模块语句覆盖率 ≥ 80%；
- 平台仍是唯一权威源，运行环境不反向写回。

**Scale/Scope**：
- 单用户工作台；单数字人技能 < 10（上限 32），行为候选 < 96；
- 历史改写素材固定 ≤ 3 轮（≤ 6 条消息）+ 当前输入；
- 改写输出 ≤ 100 字符（码点计）。

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项 MUST 在「复杂度跟踪」说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文文档与规格驱动 | 通过 | 规格已中文并含修订记录；本计划与 research / data-model / contracts / quickstart 全中文；实施时回写 `018` 与 `001` 契约 |
| 二、代码质量与模块化 | 通过（有存量约束） | 新逻辑独立成 `rewrite.ts`（编排）与 `rewrite-prompt.ts`（纯函数）；`runner.ts` 只加顺序调用（存量 680 行超限 → 见复杂度跟踪）；术语闸门只改 `routes/term-normalize.ts` 一处 |
| 三、测试完备性 | 通过 | 纯函数模块同名 spec；runner / 配置 / SOUL / 记录 / 端点均补测；覆盖率目标 ≥ 80%；管理前端组件同名 spec |
| 四、无障碍 | 通过 | 新增两个复选框复用既有 `soul-editor__switch`（原生 checkbox + 整行 label）；说明文案与 `disabled` 语义须在组件 spec 中覆盖键盘与读屏断言 |
| 五、性能与一致性 | 通过（有预算） | 额外调用受 5s/10s 双重上限与降级保护；不新增端点，接口 P95 承诺不变；历史读取为单次读盘，不在循环内查询 |
| 六、依赖治理 | 通过 | 零新增依赖；复用 `zod` / `yaml` / `LayaClient` / `LlmProvider` |
| 七、接口契约两侧同改 | 通过 | 无新增公开端点；`admin-api.md` SOUL 字段表 + `runtime-api-delta.md` + `term-normalize-api.md` 同步修订；聊天前台请求 / 响应零变更 |
| 八、测试部署简单可控 | 通过 | 各侧单命令门禁不变；部署冒烟沿用既有 quickstart 流程 |
| 九、优雅降级与可观测 | 通过 | 判定失败按不改写、改写失败回退原话；新增结构化事件与留档字段；错误不冒泡到对话主链路 |
| 治理：不追溯存量 | 通过 | 存量数字人两个开关缺省关闭；不回溯历史记录；不改存量 `intent-focus.jsonl` 行 |

**Phase 1 后复核**：未新增依赖 / 服务 / 公开 API；未改变工具权限与 SOUL 正文；管理端仅新增两个布尔字段；仍未发现新增违规（详见文末「Phase 1 复核」）。

## Phase 0：研究与决策

- 产出：[research.md](./research.md)
- 关键决策（摘要）：
  1. 指代判断复用 **Laya 单条 `noul`**（qid `need_rewrite`），不引入第二次模型判定；
  2. 改写走 **既有 `LlmProvider`**，按本轮生效模型取 provider（请求级覆盖优先），单条 user 消息承载「历史 + 当前输入」；
  3. 历史只取 **最近 3 个完整问答轮**（过滤 `status=failed` 与空正文），只读 `history.jsonl`；
  4. 改写阶段插入位置：**无技能短路之后、技能评分之前**；
  5. 预算切分：判定用剩余预算，改写用 `min(rewrite_timeout_ms, 剩余 - 100)`，低于 300ms 放弃；
  6. 100 字按**码点**截断；归一化剥离引号 / 前缀 / 代码围栏；
  7. 留档追加 7 个字段，默认 `null` / 空串，不迁移存量行；
  8. 术语替换闸门收在 `routes/term-normalize.ts`（唯一判定点），`frontend` 零代码改动；
  9. 两个新开关复用 SOUL 布尔开关范式：缺键 = false、仅 true 写键、关闭态零残留。

## Phase 1：设计与契约

- 产出：
  - [data-model.md](./data-model.md)：开关实体、判定结论、改写素材 / 结果、聚焦素材、留档 schema、配置 schema、状态与顺序；
  - [contracts/intent-focus-rewrite.md](./contracts/intent-focus-rewrite.md)：运行期契约（开关、配置、端口、Laya 命题、LLM 请求、归一化、记录、日志、降级矩阵、测试矩阵）；
  - [quickstart.md](./quickstart.md)：可运行验证（单元 / 集成 / 管理端 / 手工端到端）；
  - 同步修订：`specs/001-digital-human-platform/contracts/admin-api.md`（SOUL 字段表）、
    `.../runtime-api-delta.md`（新增 R30 与 §21.1 键表）、
    `specs/018-term-normalize/contracts/term-normalize-api.md`（闸门口径）。
- 设计复核：无新增依赖；无新增端点；工具权限 / System Prompt 正文不变；Phase 1 后宪章检查仍通过。

## 项目结构

### 文档（本特性）

```text
specs/027-intent-focus-query-rewrite/
├── plan.md                              # 本文件
├── research.md                          # Phase 0：决策与取舍
├── data-model.md                        # Phase 1：实体、字段、留档 schema、顺序
├── quickstart.md                        # Phase 1：可运行验证
├── contracts/
│   └── intent-focus-rewrite.md          # Phase 1：运行期契约
├── checklists/
│   └── requirements.md                  # 规格质量检查表（已通过）
└── tasks.md                             # Phase 2（/speckit.tasks 生成）
```

### 源码（仓库根，仅列新增 / 改动点）

```text
agent-backend/
├── src/
│   ├── config.ts                             # intent_focus 块新增 rewrite_threshold / rewrite_timeout_ms + 环境变量
│   ├── domain/
│   │   ├── soul.ts                           # SoulMeta 增 inputRewrite / termNormalize；新增两个逐次读盘读取函数
│   │   ├── run-consume.ts                    # judge 入参补 model 与 run 信号（不改事件顺序）
│   │   ├── intent-focus/
│   │   │   ├── rewrite-prompt.ts             # 新增：命题构造、素材拼装、最近轮次选取、归一化与截断（纯函数）
│   │   │   ├── rewrite.ts                    # 新增：改写阶段编排（开关 → 判定 → 改写 → 降级 → 计时）
│   │   │   ├── runner.ts                     # 仅插入“短路后调用改写阶段”，评分改用返回的 state
│   │   │   ├── record.ts                     # 记录铸造追加改写字段（默认 null/空）
│   │   │   └── store.ts                      # 记录类型追加 7 个可选字段
│   ├── infra/
│   │   └── rewrite-llm.ts                    # 新增：LlmProvider → 一次性文本聚合（tools: []、超时、无历史副作用）
│   ├── server-attachments.ts                 # 注入开关读取、历史读取、改写端口
│   ├── server.ts                             # providerFor 抽成共享函数；把 history 与 provider 传给 attachments
│   └── routes/term-normalize.ts              # 闸门改为 isIntentFocusEnabled && isTermNormalizeEnabled
└── tests/
    ├── unit/
    │   ├── intent-focus-rewrite-prompt.spec.ts   # 新增（纯函数）
    │   ├── intent-focus-rewrite.spec.ts          # 新增（编排 + 降级 + 预算）
    │   ├── rewrite-llm.spec.ts                   # 新增（聚合 / 超时 / 错误事件）
    │   ├── intent-focus-runner.spec.ts           # 增：改写接入、短路不动、记录字段
    │   ├── intent-focus-record.spec.ts           # 增：新字段默认与取值
    │   ├── soul.spec.ts                          # 增：两个新开关解析与读取
    │   └── config.spec.ts                        # 增：新配置项缺省 / 越界 / 环境变量
    └── integration/
        ├── chat-rewrite.spec.ts                  # 新增：端到端（判定→改写→评分→原话零污染）
        ├── chat-intent-focus.spec.ts             # 增：关闭态与短路态零调用
        └── term-normalize.spec.ts                # 增：术语替换双开关四组合

admin-backend/
├── src/domain/config-center/
│   ├── soul-design.ts                        # 两个新字段：校验 / 缺省 / 物化
│   └── agent-design.ts                       # withSoulDefaults 补齐与收敛
└── tests/unit/
    ├── soul-design.spec.ts                   # 增：校验与物化组合
    ├── soul-design-switches.spec.ts          # 新增：两开关矩阵（意图聚焦 × 输入重写 / 术语替换）
    ├── agent-design.spec.ts                  # 增：读取归一化
    └── materialize.spec.ts                   # 增：产物零残留

admin-frontend/
├── src/
│   ├── api/soul.ts                           # SoulDesign 类型增两个 boolean
│   ├── constants/agent-design.ts             # emptySoulDesign 显式落 false（脏检查同形）
│   ├── composables/useAgentDesign.ts         # cloneSoul 显式复制（复制数字人路径不丢字段）
│   └── components/agents/SoulEditor.vue      # 意图聚焦区内两个复选框 + 置灰 + 说明文案
└── src/components/agents/SoulEditor.spec.ts  # 增：勾选 / 置灰 / 值保留 / 文案 / 无障碍

frontend/                                      # 零改动（预检 applied:false 即不弹窗）
```

**Structure Decision**：沿用现有四侧分层。运行期新增两个 domain 模块（纯函数 + 编排）与一个 infra 适配器；管理侧只扩字段与控件；聊天前台零改动。

## 复杂度跟踪

| 违规 / 偏差 | 为何必要 | 被否决的更简方案 |
|---|---|---|
| `agent-backend/src/domain/intent-focus/runner.ts` 存量 **680 行**（超 500 门禁）；本特性会再加约 15 行编排 | 该文件是聚焦编排的既有唯一落点，把"调用改写阶段 + 使用返回 state"外移会引入无意义的两层回调，反而更难读 | ① 在本次顺带把 runner 拆成"短路/评分/铸造"三文件 —— 属大规模重构，回归面覆盖 013/016/019 全部用例，违反"不破坏其他功能"；② 让 runner 直接调用 LLM 与读历史 —— 违反分层（domain 直连 infra），已在 `rewrite.ts` 用端口隔离。拆分任务登记进 `tasks.md` 的"技术债（非本特性）" |
| 每轮多一次串行模型调用（仅指代轮次） | 不重写就无法让聚焦"看懂上文"，这是本特性的目的本身 | 并行发起判定与改写：会让**非指代轮次**也付一次模型调用，违背 SC-004 与"零回归" |
| 改写阶段额外读一次 `history.jsonl`（每轮 1 次） | `run-consume` 已为 prompt 组装读过历史，但那是 `buildPrompt` 的局部变量，未对外暴露；为不改变其职责，改写侧单独读一次 | 改 `buildPrompt` 把 `allMessages` 透传给判定口——会把"上下文组装"与"聚焦"耦合，且需要改动收尾链路签名 |
| 管理前端需同步三处（类型 / 常量 / 深拷贝） | 三处各有独立职责：类型给编译期、常量给脏检查基准、深拷贝给"复制数字人" | 只改类型：会出现复制数字人丢开关、脏检查误报（既有 007/013 都踩过） |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 判定阈值误判（把独立问句判成指代） | 多一次改写调用 + 聚焦偏移 | 阈值独立可配（缺省 0.8）；标注集回归（SC-001）；记录分数与原因便于现场标定 |
| 改写调用拖慢首字 | 用户体验 | 5s 单次上限 + 10s 阶段预算 + 剩余不足 300ms 直接放弃；仅指代轮次发生；记录 `rewrite_ms` 与 P90 采样 |
| 改写结果被误用为"本轮输入" | 直接违背需求第 5 条 | 单一事实源（`run-consume` 的 `opts.userMessage`）；改写结果只经返回值进入评分；集成测试断言历史 / 消息数组 / 界面文本零出现 |
| 术语替换默认关闭导致存量行为变化 | 用户感知"替换不见了" | 部署说明登记（FR-059）；冒烟检查 SOUL 产物键；管理台保留已选值 |
| 管理端字段漏改导致脏检查误报 / 复制丢字段 | 保存体验回归 | 三处清单同步 + 组件 / composable 单测覆盖；`emptySoulDesign` 前后端形态一致由测试钉住 |
| 阶段失败冒泡到对话主链路 | 回答失败 | `runner` / `rewrite.ts` / `rewrite-llm` 三层都只降级，异常折成"用原话继续"，并有结构化事件 |
| Windows 中文路径 | 测试失败 | 全部路径走 `node:path`；集成测试用 `mkdtempSync` 临时目录（沿用既有范式） |

## 测试与验证策略

| 层 | 覆盖点 | 命令 |
|---|---|---|
| 纯函数（`rewrite-prompt.ts`） | 命题文案稳定；素材只含 3 轮 + 当前输入、不含工具；失败轮 / 空正文 / 附件剥离；100 字码点截断；引号 / 前缀 / 围栏归一；空输出判定 | `npm test -- tests/unit/intent-focus-rewrite-prompt.spec.ts` |
| 编排（`rewrite.ts`） | 双开关矩阵；判定失败按不改写；超时 / 空输出 / 超长回退；预算不足放弃；计时与原因；不抛错 | `npm test -- tests/unit/intent-focus-rewrite.spec.ts` |
| LLM 适配（`rewrite-llm.ts`） | `tools: []`、`thinking: false`、无历史副作用；聚合 content；error 事件转失败；超时中止；请求级模型选择 | `npm test -- tests/unit/rewrite-llm.spec.ts` |
| 聚焦编排（`runner`） | 短路轮零调用；改写后评分 state 变化；记录字段；开关逐次现读 | `npm run test:integration -- chat-rewrite` |
| 端点（`term-normalize`） | 四开关组合；关闭时不读表；`applied:false` | `npm run test:integration -- term-normalize` |
| 管理平台服务 | 字段校验 / 缺省 / 物化组合 / 读取归一化 | `cd admin-backend && npm test` |
| 管理前端 | 复选框可点、置灰、值保留、说明文案、读屏标签 | `cd admin-frontend && npm test` |
| 手工端到端 + 性能采样 | 三开关组合、指代轮次、重新生成、降级；20 轮指代输入采样 `rewrite_ms` 的 P90 | [quickstart.md](./quickstart.md) |
| 评测（离线，人工执行） | `tests/fixtures/rewrite-labeled-set.json`（≥30 条）+ `scripts/eval-need-rewrite.mjs` 逐条打真实 Laya，输出准确率 / 误判率并记录 | `node scripts/eval-need-rewrite.mjs`（需真实 Laya 配置） |

**实测（2026-11-19 实施，`npm run test:coverage`）**：`rewrite-prompt.ts` stmts 100 / branch 100；
`rewrite.ts` stmts 94.33 / branch 91.89；`rewrite-llm.ts` stmts 95.45 / branch 84.61。
三项均已登记进 `agent-backend/vitest.config.ts` 的模块阈值清单（按 80% 校验）。
标注集评测脚本以 `--dry-run` 校验了标注集完备性与"命题与实现同源"；**真实 Laya 评测与 20 轮
P90 采样未在本环境执行**（无 Laya 服务与模型 key），结论待现场补跑，见 quickstart §7。

## Phase 1 复核

- 未新增依赖 / 容器 / 外部服务 / 公开端点；
- 未改变工具清单、工具权限、SOUL 正文与 SSE 事件集合；
- 管理端新增字段全部为可选布尔、缺省 false，关闭态产物零残留；
- 聊天前台零代码改动（服务端 `applied:false` 即无弹窗）；
- 遗留事项：`runner.ts` 存量超限拆分登记为独立技术债任务（不属本特性验收）。
