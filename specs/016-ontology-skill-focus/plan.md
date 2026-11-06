# 实施计划：意图聚焦（技能与本体行为聚焦）

> **2026-11-06 修订**：能力聚焦只到本体行为，`functions` 与 `rules` / `data_supplements` 整体取消，
> 记录只写入选行为。本文件下方涉及"函数 / 数据补充 / 能力分类"的描述为历史实施记录，
> 现行口径以 [spec.md](./spec.md)（Session 2026-11-06）与 [data-model.md](./data-model.md) 为准。

- **分支**：`016-ontology-skill-focus`
- **日期**：2026-11-04（2026-11-06 修订）
- **规格**：[spec.md](./spec.md)
- **输入**：`specs/016-ontology-skill-focus/spec.md`
- **说明**：本计划基于现有 `agent-backend`、`laya-client`、SOUL 开关与线程侧车留档范式；不新增前端 / 管理台页面，不新增外部服务。

## 摘要

把现有「意图聚焦」（013，工具候选 noul 判定）**整体替换**为「技能聚焦 + 本体能力聚焦」：

1. 每轮在**主模型调用之前**，只读取当前数字人 `skills/*/SKILL.md` 的**头部**，识别非本体技能与本体技能；
2. 非本体技能只做技能聚焦；本体技能先按 `ontology_id` 匹配已物化 `ontology.yaml`，再做技能聚焦；
3. 对技能聚焦入选的本体技能，读取其 `ontology.yaml` 的 `functions` / `behaviors` / `rules`，用 Laya `noul` 逐候选评分；
4. 对直接入选的行为按 `rules[].behavior` 补入其 `data_supplements` 声明的查询行为（取同本体 `behaviors[]` 的 `name` / `title`），再按「类别 + name」全局去重；
5. 铸造一条中文本轮提示（技能说明 + 本体能力），追加到 `systemExtra` 末尾，进入主模型；
6. 原工具候选构造、工具评分与原工具提示全部停用，不保留双链路。

所有判定均为 `noul`（逐候选真值命题），不是 `choice`；技能阈值沿用 `INTENT_FOCUS_SKILL_THRESHOLD`，本体能力阈值新增 `INTENT_FOCUS_ONTOLOGY_THRESHOLD`。

## 技术上下文

**Language/Version**：TypeScript 6 / Node.js >= 20（`agent-backend/package.json`），ESM。

**Primary Dependencies**：
- Fastify 5（HTTP 层，本次不改路由）
- `yaml` 2.9（解析 `SKILL.md` frontmatter 与 `ontology.yaml`，**不新增依赖**）
- `zod` 4（配置校验）
- `@earendil-works/pi-agent-core` 0.85（Agent 运行，本次只改调用点）
- Laya 决策模型（HTTP `/v1/systemone`，经既有 `LayaClient`，**不新增 HTTP 客户端**）

**Storage**：
- 数字人目录：`.opt-agent/users/{user}/agents/{agent}/`
  - 技能：`skills/{skillDir}/SKILL.md`（只读头部）
  - 本体：`ontology/{scenarioDir}/{ontologyDir}/ontology.yaml`
- 线程侧车：`.opt-agent/users/{user}/user-data/{agent}/threads/{thread}/intent-focus.jsonl`
  （复用 013 的存储与滚动上限，**不写历史**；与 `threads/` 同域，部署不触碰）
- 无数据库、无新表、无迁移。

**Testing**：Vitest 5；`npm test`（单元）、`npm run test:integration`、`npm run test:coverage`；不依赖真实 Laya。

**Target Platform**：Linux 容器（部署）/ Windows 本地开发（路径含中文，必须用 `node:path`，禁止字符串拼接路径）。

**Project Type**：Web 服务（后端），已有管理端与聊天前端；本次只改 `agent-backend`。

**Performance Goals**：
- 聚焦阶段总预算 **10 秒**（沿用现有 `INTENT_FOCUS_DEFAULTS.timeoutMs = 10_000`，与配置 `timeout_ms` 上限一致）；
- 典型 1~3 个技能 + 1 个本体（约 40 个能力）约 3 批，P90 目标 ≤ 5 秒；
- 超时、未配置、任一阶段失败都必须 ≤ 预算内降级，不增加第二次串行等待（原工具聚焦停用）。

**Constraints**：
- 只读 `SKILL.md` 头部（有界读取，不读正文）；本体只取 `metadata`、`functions`、`behaviors`、`rules`，不读 `concepts` / `relations` / 函数代码；
- 不新增管理台开关、不新增前端字段、不新增外部服务；
- 技能候选 ≤ 32；行为 + 函数候选合计 ≤ 96；单批 ≤ 32 题；
- 单文件 ≤ 500 行；新增模块语句覆盖率 ≥ 80%；
- 不反向写回平台；平台是配置与内容的唯一权威源。

**Scale/Scope**：
- 单数字人技能数量通常 < 10，上限 32；
- 单本体函数 + 行为通常 20~60，上限 96；
- 单轮最多 4 批（1 批技能 + 最多 3 批能力），与 10 秒预算匹配。

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项必须在「复杂度跟踪」中说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文与文档 | 通过 | 本计划、research、data-model、contracts、quickstart 全部中文 |
| 二、分层边界 | 通过 | 新逻辑放 `domain/`；`infra/laya-client` 仍是唯一 Laya 出口；路由不直接读文件 |
| 三、500 行/文件 | 通过 | 按技能头部、本体加载、候选、选择、提示、编排拆分；`run-consume` 只增少量调用 |
| 四、测试 | 通过 | 纯函数单测 + 临时目录集成测试；不依赖真实 Laya；覆盖率目标 ≥ 80% |
| 五、性能 | 通过（有约束） | 10 秒总预算、批次上限、无 N+1；聚焦是聊天主链路的前置增强，不在 P95 承诺内 |
| 六、依赖 | 通过 | 复用 `yaml` / `zod` / 既有 Laya 客户端，`package.json` 不变 |
| 七、四侧同改与契约 | 通过 | 仅 `agent-backend` 改动；管理端 / 前端登记「无需改动」；新增 016 契约并更新 013 契约的废止说明 |
| 八、一键质量门禁 | 通过 | 复用 `npm run lint` / `typecheck` / `test` / `test:integration` / `build` |
| 九、降级与可观测 | 通过 | 未配置 / 超时 / 解析失败 / 批次失败均静默降级；结构化日志 + 侧车记录 |
| 十、可访问性与国际化 | 通过（不适用） | 无 UI 变更；提示为中文，技能 / 行为 / 函数 `name` 保留原文 |
| 十一、跨平台 | 通过 | 全部使用 `node:path`；只枚举真实目录并拒绝符号链接；Windows 中文路径纳入测试 |
| 十二、单一数据源 | 通过 | 阈值、上限、提示前缀、记录字段各一处定义；不复制平台数据 |

**Phase 1 后复核**：设计未引入新依赖、未改变工具权限、未新增公开 API；仍通过。

## Phase 0：研究与决策

- 产出：[research.md](./research.md)
- 已收敛的关键决策：
  1. 全部替换工具聚焦，调用点从 `agent-factory` 移到 `run-consume`；
  2. 技能与能力均用 `noul`，不用 `choice`；严格 `score > threshold`；
  3. `SKILL.md` 有界读头部，`ontology.yaml` 按目录枚举 + `ontology_id` 索引；
  4. 数据补充只对直接入选行为生效，补充项进入行为类，按 `kind + name` 去重；
  5. 提示按技能分组，同本体能力归属最高分技能，≤1200 字符；
  6. 复用 013 侧车记录，schema 替换但不迁移；
  7. 总预算 10 秒、输入 200 字符（已回写规格）。
- 无 `NEEDS CLARIFICATION` 残留；无新增依赖。

## Phase 1：设计与契约

- 产出：
  - [data-model.md](./data-model.md)：实体、字段、状态、记录 schema、提示语法、去重 / 截断规则；
  - [contracts/intent-focus-api.md](./contracts/intent-focus-api.md)：配置、输入、Laya 协议、提示、记录、降级；
  - [quickstart.md](./quickstart.md)：可运行验证与排障。
- 设计复核：未新增依赖 / 服务 / 公开 API；未改变工具权限；管理端与前端无字段变更；Phase 1 后宪章检查仍通过。

## 项目结构

### 文档（本特性）

```text
specs/016-ontology-skill-focus/
├── plan.md                       # 本文件
├── research.md                   # Phase 0：技术决策与取舍
├── data-model.md                 # Phase 1：实体、字段、记录 schema、提示语法
├── quickstart.md                 # Phase 1：可运行验证指南
├── contracts/
│   └── intent-focus-api.md       # 运行期契约（配置 / Laya / 记录 / 提示）
├── checklists/
│   └── requirements.md           # 规格质量检查表（已通过）
└── tasks.md                      # Phase 2（/speckit.tasks 生成，本命令不创建）
```

### 源码（仓库根）

```text
agent-backend/
├── src/
│   ├── config.ts                              # 增加 ontology_threshold / 候选上限；复用 timeout_ms
│   ├── server-attachments.ts                  # 始终装配 IntentFocusRunner（支持 unconfigured 留档）
│   ├── types.ts                               # SkillMeta 保持系统提示口径（其余共享类型不变）
│   ├── domain/
│   │   ├── skill-header.ts                    # 新增：SKILL.md 头部有界读取 + frontmatter 解析
│   │   ├── intent-focus.ts                    # 收敛为通用 noul 核心（state/阈值/分批/处置）
│   │   ├── intent-focus-runner.ts             # 编排：开关→跳过→未配置→加载→评分→选择→提示→留档
│   │   ├── intent-focus-store.ts              # 记录 schema 改为技能/能力；存储与滚动上限不变
│   │   ├── run-consume.ts                     # 在 buildPrompt 之后、agent.run 之前调用聚焦
│   │   ├── run-manager.ts                     # 删除 AgentRunRequest.focusJudge
│   │   ├── agent-instance.ts                  # 复用 skill-header，系统提示行为不变
│   │   └── ontology-focus/
│   │       ├── types.ts                       # 技能头部、本体定义、候选、决策、QuestionMap（Record<string, SystemOneQuestion>）
│   │       ├── ontology-loader.ts             # 枚举并解析 ontology.yaml；按 ontology_id 建索引
│   │       ├── candidates.ts                  # 技能候选 + 能力候选 + noul 题面（有界）
│   │       ├── selection.ts                   # 严格阈值筛选、数据补充、去重、稳定排序
│   │       ├── prompt.ts                      # 提示铸造与 1200 字符截断
│   │       └── record.ts                      # 决策 → IntentFocusRecordDraft（含 warnings / data_supplements found）
│   └── infra/
│       └── agent-factory.ts                   # 删除 focusJudge 回调与工具候选耦合
├── tests/
│   ├── unit/
│   │   ├── skill-header.spec.ts               # 新增
│   │   ├── ontology-loader.spec.ts            # 新增
│   │   ├── ontology-candidates.spec.ts        # 新增
│   │   ├── ontology-selection.spec.ts         # 新增
│   │   ├── ontology-prompt.spec.ts            # 新增
│   │   ├── intent-focus.spec.ts               # 重写为通用核心测试
│   │   ├── intent-focus-runner.spec.ts        # 重写为新编排测试
│   │   ├── intent-focus-store.spec.ts         # 更新记录 schema / 滚动 / 旧行容错
│   │   └── soul-intent-focus.spec.ts          # 开关语义不变，保留
│   └── integration/
│       └── chat-intent-focus.spec.ts          # 重写端到端场景
├── config.example.yaml                        # 新增 ontology_threshold / 候选上限说明
└── README.md                                  # 如涉及运行配置，补一段 016 口径
```

**结构决策**：沿用现有「`domain/` 纯逻辑 + `infra/` 适配 + `server-attachments` 装配」结构。新功能不建新进程、不建新数据库；`ontology-focus/` 是一个高内聚的特性包，`intent-focus-runner` 只做编排，避免把技能 / 本体 / 规则逻辑堆进同一个文件。

## 数据流（单轮）

```text
consumeTurn
  ├─ buildPrompt() → prompt.systemExtra（摘要等）
  ├─ intentFocus.judge({ userId, agentName, threadId, messageId, userInput, skip })
  │    ├─ isEnabled? 否 → 返回 ""（不记录）
  │    ├─ skip? 是 → 记录 skipped → 返回 ""
  │    ├─ config/client 缺失? 是 → 记录 unconfigured → 返回 ""
  │    ├─ prepareState(userInput)（200 字符，取尾部、对齐句首）
  │    ├─ loadSkillHeaders(agentDir)（只读头部）
  │    ├─ loadOntologyIndex(agentDir)（只读 metadata/functions/behaviors/rules）
  │    ├─ 构建可聚焦技能（非本体技能 + 已匹配本体的本体技能；未匹配本体者不评分但记录原因）
  │    ├─ Laya noul 分批评分技能 → 严格阈值筛选
  │    ├─ 若无入选技能 → 记录 empty（no_skills / below_threshold）→ 返回 ""
  │    ├─ 对入选本体技能构建能力候选 → noul 分批评分 → 严格阈值筛选
  │    ├─ 数据补充 → 去重 → 提示铸造（≤1200 字符）
  │    ├─ 记录 focused（技能 / 本体 / 行为 / 函数 / 数据补充 / 提示 / 耗时）
  │    └─ 返回提示
  ├─ systemExtra = [prompt.systemExtra, focusPrompt].filter(Boolean).join("\n\n")
  └─ agent.run({ systemExtra, ... })
```

## 模块职责与接口

### 1. `domain/skill-header.ts`（新增）

- `readSkillHeaderFile(file: string): SkillHeader`：有界读取（默认 64KB）并解析 frontmatter；只返回 `name`、`description`、`metadata`。
- `parseSkillHeader(raw: string): SkillHeader`：校验 `name` / `description` 非空；`metadata.ontology_id` / `scenario_id` 归一化为字符串；`ontology_name` / `scenario_name` 去空白。
- `agent-instance.ts` 的私有 `parseFrontmatter` 改为调用本模块，系统提示仍只用 `name` / `description`。

**边界**：不读取正文；frontmatter 未闭合 / 非对象 / 缺 `name` 或 `description` → 抛类型化错误，由技能加载或聚焦跳过并记录。

### 2. `domain/ontology-focus/ontology-loader.ts`（新增）

- `loadOntologyIndex(agentDir: string): OntologyIndex`
  - 枚举 `ontology/{scenario}/{ontology}/ontology.yaml`；
  - 只接受真实目录与真实文件（`Dirent` 非符号链接 + `lstat` 校验），不接受任何来自 `SKILL.md` 的路径拼接；
  - 解析 `metadata.ontology_id` / `ontology_name` / `scenario_id` / `scenario_name`；
  - 提取 `functions[]`（`name`、`title`）、`behaviors[]`（`name`、`title`、`description`、`op_type`）、`rules[]`（`behavior`、`data_supplements`）；
  - 按归一化 `ontology_id` 建索引；同一 ID 多个文件全部保留；
  - 坏文件跳过并返回 `warnings`，不抛整轮错误。
- `OntologyIndex`：`byId: Map<string, OntologyDefinition[]>`、`all: OntologyDefinition[]`、`warnings: string[]`。

### 3. `domain/ontology-focus/candidates.ts`（新增）

- `buildSkillCandidates(headers, index, limits)`：
  - 非本体技能 → 可聚焦；
  - 本体技能 → 仅当 `ontology_id` 命中索引时可聚焦；
  - 未命中本体技能 → 不生成候选、不评分，但返回 `excluded` 列表，由 runner 写成
    `selected:false / score:null / reason:'no_matching_ontology'` 的记录项；
  - 题面：`需要技能「{description 摘要}」`（≤ 40 字）；
  - 上限 32，原序截断。
- `buildCapabilityCandidates(selectedSkills, limits)`：
  - 仅对入选本体技能引用的本体，按本体原序收集行为与函数；
  - 题面：`需要行为/函数「{title or name}」`；
  - 上限 96，原序截断；同一本体只收集一次（按路径去重）。
- 所有题均为 `{ type: 'noul', instructions, criteria: { true: '需要', false: '不需要' } }`；`qid` 使用 `s1..sN` / `c1..cN`，与候选一一映射，避免中文 / 重名 qid 对齐问题。

### 4. `domain/ontology-focus/selection.ts`（新增）

- `selectSkills(decisions, scores, threshold)`：`score > threshold`（**严格大于**）；分数降序、同分原序；返回全部候选决策（含未入选）与入选列表。
- `selectCapabilities(candidates, scores, threshold, index)`：
  - 直接入选：`score > threshold`；
  - 数据补充：仅对直接入选行为，找 `rules[].behavior === behavior.name`，收集 `data_supplements`；在同本体 `behaviors` 中按 `name` 查找，作为行为项追加 `source='supplement'`、`score=null`（不进入函数类）；按名字补入、不校验 `op_type`；不级联（补充项不再触发其自身规则）；
  - 去重：`kind + name` 为键；保留最高分、合并来源（`direct+supplement`）、合并 `ontologyIds`、标题取首次出现；
  - 排序：直接入选在前（分数降序、同分原序），数据补充项在后（本体原序）；
  - 上限：去重后行为类总数 MUST ≤ 96（`FR-027`），超限按本体原序截断补充项并置 `truncated=true`；
  - 返回 `behaviors` / `functions` 决策数组、`supplements`、`selected` 名单。
- 数据补充的行为若找不到 → 丢弃并记录 `missing_supplement_behavior`。

### 5. `domain/ontology-focus/prompt.ts`（新增）

- `composeFocusPrompt(selectedSkills, capabilityDecisions, limits)`：
  - 前缀固定：`本轮可优先参考以下聚焦结果（仅供参考，不必局限）：`；
  - 按技能分数降序输出 `技能：{name}（{description ≤80 字}）`；空 `description` 省略括号；
  - 本体技能紧随其技能段输出 `本体能力：`，行为在前、函数在后，条目为 `{title}（{name}）`；空类别省略；
  - 同一本体被多个技能引用时，能力归属到**分数最高的入选技能**，其余技能只出技能段，避免重复；
  - 非本体技能不输出 `本体能力`；
  - 段间中文分号、条目中文逗号、整体单行；
  - 超过 1200 字符时按「先删能力条目、再删末尾技能段」的顺序截断完整条目，返回 `truncated=true`。

### 6. `domain/intent-focus-runner.ts`（重写内部）

- 保留 `IntentFocusPort` 与 `judge(input): Promise<string>` 外形，去掉 `tools` 参数。
- `IntentFocusInput`：`userId`、`agentName`、`threadId`、`messageId`、`userInput`、`skip`。
- 依赖：`config?`、`client?`、`store`、`isEnabled`、`root`、`logger`、`now`。
- 客户端接口保持 `decide(state, questions, timeoutMs)`，与现有 `LayaClient` 一致；测试用桩实现同签名。
- 顺序：开关 → 跳过 → 未配置 → 读取技能/本体 → 技能评分 → 技能筛选 → 能力评分 → 数据补充/去重 → 提示 → 留档。
- 失败：任一阶段异常/超时 → 记录 `degraded`（原因细分），返回 `''`；不重试，不影响主回答。
- 单轮内缓存本体解析结果；不跨轮缓存。

### 7. `domain/intent-focus.ts`（收敛）

- 只保留通用 noul 核心：`MAX_QUESTIONS_PER_BATCH`、`MAX_CANDIDATES`、`MAX_STATE_CHARS`、`DEFAULT_THRESHOLD`、`prepareState`、`normalizeThreshold`、`buildNoulQuestion`、`decideDisposition`、`IntentFocusDisposition`。
- 删除 `ToolCandidate`、`FocusAction`、`Selection`、`selectCandidates`、`displayNameOf`、`buildQuestions`、`buildQuestionBatches`、`selectActions`、`composeFocusPrompt` 及工具提示前缀。
- `decideDisposition` 的空结果原因改为 `no_skills` / `below_threshold` / `no_focusable_skills`，不保留 `no_tools`。

### 8. 装配与调用点

- `server-attachments.ts`：
  - 无论 `config.intentFocus` 是否存在，都构造 `IntentFocusRunner`；`config/client` 可选；
  - 这样开关开启但 Laya 未配置时也能留档 `unconfigured`；开关关闭仍不记录。
- `run-consume.ts`：
  - 在 `buildPrompt` 成功后、`agent.run` 之前调用 `intentFocus.judge`；
  - 将返回提示追加到 `prompt.systemExtra` 末尾（两段之间空行）；
  - 删除 `focusJudge` 闭包与 `tools` 依赖。
- `run-manager.ts` / `infra/agent-factory.ts`：
  - 删除 `AgentRunRequest.focusJudge`、`RunRequest.focusJudge` 与工具装配后的回调块；
  - 工具装配、白名单、权限逻辑不变。

### 9. 配置

- `IntentFocusConfig` 新增：
  - `ontologyThreshold: number`（0~1，缺省 0.6；环境变量 `INTENT_FOCUS_ONTOLOGY_THRESHOLD` 优先）；
  - `maxSkills: number`（缺省 32，1~256）；
  - `maxCapabilities: number`（缺省 96，1~256）。
- `intentFocusYamlSchema` 新增可选键：`ontology_threshold`、`max_skills`、`max_capabilities`；`strict()` 保持，拼错键仍启动失败。
- `INTENT_FOCUS_DEFAULTS` 增加 `ontologyThreshold: 0.6`、`maxSkills: 32`、`maxCapabilities: 96`；`timeoutMs` 保持 10_000。
- `config.example.yaml` 更新注释与示例；不新增环境变量以外的配置来源。
- 顺手修正 `IntentFocusConfig` 注释中的旧值（`0.5` → `0.6`），与 `INTENT_FOCUS_DEFAULTS` 一致；
  该修正不改变运行行为，只消除文档与代码的偏差。

### 10. 日志与观测

- `intent_focus.skipped`（`info`）：`thread_id`、`agent_name`、`reason`。
- `intent_focus.unconfigured`（`warn`，节流）：`thread_id`、`agent_name`、`reason`。
- `intent_focus.done`（`info`）：`disposition`、`reason`、`candidates`、`batches`、`round_ms`、
  `selected_skills` / `selected_behaviors` / `selected_functions` 数量、`truncated`。
- `intent_focus.degraded`（`warn`，节流）：`reason`、`stage`、`batch_index`、`round_ms`。
- `intent_focus.record.failed`（`warn`，节流）：`thread_id`、`agent_name`、`reason`。
- 所有事件带 `req_id`（如可用）、`user_id`、`thread_id`、`agent_name`；不记录输入正文、技能正文、
  本体全文、提示全文（记录文件才有提示原文，且仅用于事后分析）。

## 实施顺序

1. **通用核心与技能头部**：新增 `skill-header.ts`；收敛 `intent-focus.ts` 为 noul 核心；补单测。
2. **本体加载**：新增 `ontology-focus/types.ts`、`ontology-loader.ts`；补坏文件 / 多 ID / 中文路径测试。
3. **候选与评分**：新增 `candidates.ts`；复用 `LayaClient`，按 32 题分批；补 qid / 上限 / 截断测试。
4. **选择、数据补充、去重**：新增 `selection.ts`；补严格阈值、数据补充、跨本体同名测试。
5. **提示铸造**：新增 `prompt.ts`；补非本体 / 本体说明 / 同本体多技能 / 1200 截断测试。
6. **编排与留档**：重写 `intent-focus-runner.ts`、`intent-focus-store.ts`、`record.ts`；补开关 / 跳过 / 未配置 / 超时 / 写盘失败测试。
7. **装配与旧链路移除**：改 `server-attachments`、`run-consume`、`run-manager`、`agent-factory`；删除工具聚焦代码与测试。
8. **配置与文档**：改 `config.ts`、`config.example.yaml`；新增 016 契约；更新 013 契约废止说明。
9. **集成与回归**：重写 `chat-intent-focus.spec.ts`；跑全量门禁。

## 测试策略

### 单元测试（不依赖 Laya）

- **技能头部**：正常 frontmatter；`metadata.ontology_id` 为数字 / 字符串；缺 `ontology_name`；frontmatter 未闭合；超长正文只读头部；中文路径。
- **本体加载**：正常 YAML；多本体同 ID；缺 `metadata`；`functions` / `behaviors` 缺 `title`；`rules.data_supplements` 缺失 / 空数组 / 悬空行为名；符号链接目录跳过；坏 YAML 不影响其他文件。
- **候选构造**：非本体技能进入；未匹配本体的本体技能不进入；qid 唯一；题面截断；技能 ≤32、能力 ≤96、单批 ≤32。
- **选择**：严格大于阈值；同分原序；数据补充只对直接入选行为且**不级联**；补充项进入行为类、不校验 `op_type`；补充后行为类 ≤96 截断；跨本体同名去重；来源合并；数据补充不参与阈值。
- **提示**：非本体技能只有技能段；本体技能说明在能力之前；同本体多技能不重复能力；空类别省略；1200 字符截断完整条目。
- **通用核心**：`prepareState` 取尾部 / 对齐句首 / 200 字符；`decideDisposition` 五态。
- **记录存储**：新 schema、`warnings` 上限、256KB / 200 行滚动、旧 013 行容错、写失败不抛出。
- **配置**：`ontology_threshold` 环境变量优先；越界启动失败；候选上限范围；`timeout_ms` 上限 10000。

### 集成测试（临时目录 + 桩 Laya）

- 开关关闭：零文件读取、零 Laya 调用、零记录。
- 卡片跳过：零读取、零调用、一条 `skipped`。
- Laya 未配置：一条 `unconfigured`，回答正常。
- 只有非本体技能入选：提示只有技能段；本体读取 / 能力评分 / 工具评分均为 0。
- 本体技能入选：技能说明 + 行为 / 函数；数据补充（查询行为补入行为类）；去重；提示只追加一次。
- 部分批次失败：已得分候选可用；无结果时 `degraded`；用户无可见错误。
- 两轮独立：第二轮不携带第一轮提示；历史 / 摘要 / 记忆中无聚焦文本。
- 旧工具聚焦：工具候选构造 / 评分 / 旧提示出现次数为 0。

### 质量门禁

```bash
cd agent-backend
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:coverage
npm run build
```

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Laya 单批 32 题约 2 秒，4 批可能逼近 10 秒 | 大本体降级 | 批次上限、总预算、按批数均分超时；超限截断并在记录标注；不重试 |
| `behaviors[].title` 位置不固定（常在 `params` 之后） | 按固定位置解析会取不到标题 | 按 YAML key 读取；缺失才回退 `name`；记录 `title_fallback`；后续可评估用 `description`（本期不做） |
| 技能 / 能力跨本体重名 | 提示重复或串位 | 以 `kind + name` 去重；候选使用 `s1/c1` 不透明 qid，响应按下标回收 |
| 本体文件损坏 / 符号链接 | 读取失败或越界 | 只枚举真实目录 + `lstat` 拒绝符号链接；坏文件跳过并记录 |
| 头部读取读到正文 | 违反规格 | `readSkillHeaderFile` 有界读取（64KB），frontmatter 未闭合即失败 |
| 旧工具聚焦代码残留 | 双链路 / 误调用 | 删除 `focusJudge` 与工具候选逻辑；单测断言工具评分调用为 0 |
| 记录 schema 变更影响旧数据 | 分析脚本读旧行失败 | `readAll` 容错；旧字段不参与新记录；不做迁移 |
| 同步文件读取阻塞事件循环 | 首字节延迟 | 只读少量小文件；单轮内缓存；不跨轮缓存；后续可异步化 |

## 规格修订（plan 阶段事实校正）

1. **FR-006 / 边界情况**：判定输入上限由 8000 字符改为 **200 字符**。依据：`agent-backend/src/domain/intent-focus.ts` 的 `MAX_STATE_CHARS = 200`；Laya `max_sequence_tokens = 1024`，8000 字符会触发 422。
2. **FR-056 / SC-008 / 性能预算**：总预算由 5 秒改为 **10 秒**。依据：`INTENT_FOCUS_DEFAULTS.timeoutMs = 10_000`；技能 + 能力最多 4 批，每批约 2 秒。
3. 以上修订已回写 `spec.md` 的修订记录；不改变用户功能口径。

## 复杂度跟踪

| 违规 | 为什么需要 | 更简单的替代为何不可行 |
|---|---|---|
| 聚焦调用点从 `agent-factory` 移到 `run-consume` | 新方案不再依赖工具清单，需要 `agentDir` 与 `systemExtra` | 保留 `focusJudge` 会继续把 domain 与工具装配耦合，且无法在无工具场景执行 |
| 新增 `ontology-focus/` 多文件 | 技能头部、本体加载、候选、选择、提示、记录职责不同 | 单文件会超过 500 行且难以单测 |
| 同步读取技能 / 本体文件 | 文件小、与现有 `agent-instance` 一致、实现简单 | 异步化会扩散 Promise 链路，收益低于复杂度 |
| **平台差异风险**：本地 Windows（中文路径、盘符大小写不敏感、CRLF）与交付 Linux 容器（大小写敏感、LF）同时存在；文件枚举与 `SKILL.md` / `ontology.yaml` 读取均受影响 | 本特性必须遍历中文命名的 `skills/` 与 `ontology/` 目录，无法回避路径处理 | ①改用全局索引 / 数据库缓存：违背"不新增存储、不反向写回平台"，且无失效机制；②仅在 Linux 验证：宪章要求本地宿主机跑门禁，Windows 是必经环境；故保留 `node:path` + 真实目录校验 + 本地覆盖中文路径用例，并在 `agent-backend` 门禁内跑通 |

## 完成定义

- [ ] `spec.md` 的 FR-001~FR-064、SC-001~SC-014 均有对应实现或测试。
- [ ] 非本体技能只做技能聚焦；本体技能提示包含技能说明 + 行为 / 函数。
- [ ] 原工具聚焦零执行；工具权限、SOUL、历史 / 摘要 / 记忆不变。
- [ ] 技能与能力判定均为 `noul`；严格 `score > threshold`。
- [ ] 数据补充（含悬空名、补充项只进行为类）、去重、稳定排序、1200 字符截断均有单测。
- [ ] 配置、契约、quickstart 中文齐全；`013` 契约标注被替换。
- [ ] 全部质量门禁通过；新增模块覆盖率 ≥ 80%。
