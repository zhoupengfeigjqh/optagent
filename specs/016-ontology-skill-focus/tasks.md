---
description: "本体技能聚焦（技能 / 本体行为）实施任务清单"
---

# 任务清单：本体技能聚焦（Ontology Skill Focus）

> **2026-11-06 修订**：T002 / T007 / T011 / T013 / T020 / T021 / T025~T029 / T030 / T031
> 等条目中的"函数 / 规则 / 数据补充"已作废——能力聚焦只到本体行为，记录只写入选行为。
> 现行口径以 [spec.md](./spec.md)（Session 2026-11-06）与 [data-model.md](./data-model.md) 为准。

- **特性标识**：`016-ontology-skill-focus`
- **输入**：[spec.md](./spec.md)（4 个用户故事，P1~P3）｜[plan.md](./plan.md)（模块职责、实施顺序）｜[research.md](./research.md)（R1~R12）｜[data-model.md](./data-model.md)（实体 / 记录 schema / 提示语法）｜[contracts/intent-focus-api.md](./contracts/intent-focus-api.md)｜[quickstart.md](./quickstart.md)
- **测试口径**：宪章原则三为 **NON-NEGOTIABLE**，故测试任务不是可选项：新增纯函数与模块 MUST 有单测（正常 / 异常 / 边界），改动端点 MUST 有集成测试，全部在**宿主机本地**执行，容器不参与。
- **路径约定**：本仓库为多子项目布局，任务中的 `agent-backend/` 前缀即仓库根下的真实目录。
- **零新增依赖**：全部复用 `yaml`、`zod`、既有 `LayaClient` 与 `node:path`；任何新增依赖须先回写 `research.md`。

## 格式

`[ID] [P?] [Story] 描述（含精确文件路径）`

- **[P]**：可并行（不同文件、不依赖未完成任务）
- **[Story]**：用户故事标签（仅用户故事阶段）
- 每条形如 `- [ ] T001 …`

---

## Phase 1：准备（共享基础设施）

**目的**：把类型契约、配置项与样例钉死，避免后续每个模块各写一套字段。

- [x] T001 核对基线并登记：确认 `agent-backend/src/domain/intent-focus.ts` 现有导出（`ToolCandidate` / `selectCandidates` / `composeFocusPrompt` 等）、`agent-backend/src/server-attachments.ts` 的 runner 装配点、`agent-backend/src/domain/run-consume.ts` 的 `buildPrompt` 调用位置；把行数与待删清单写入本文件"基线备注"，与 `plan.md` 不一致处先更正 plan
- [x] T002 [P] 新增 `agent-backend/src/domain/ontology-focus/types.ts`：定义 `SkillHeader`、`OntologyDefinition`、`OntologyFunction`、`OntologyBehavior`、`OntologyRule`（含 `dataSupplements: string[]`）、`SkillCandidate`、`CapabilityCandidate`、`SkillDecision`、`CapabilityDecision`（`source: 'direct' | 'supplement' | 'direct+supplement'`）、`DataSupplement`（`behavior` / `supplement` / `found`）、`QuestionMap`
- [x] T003 在 `agent-backend/src/config.ts` 的 `intentFocusYamlSchema` 增加可选键 `ontology_threshold`（0~1）、`max_skills`（1~256）、`max_capabilities`（1~256），扩展 `INTENT_FOCUS_DEFAULTS`（`0.6` / `32` / `96`），并支持 `INTENT_FOCUS_ONTOLOGY_THRESHOLD` 覆盖；越界仍启动失败
- [x] T004 [P] 在 `agent-backend/config.example.yaml` 补 `intent_focus.ontology_threshold` / `max_skills` / `max_capabilities` 注释示例，注明"整块缺失即功能不可用、环境变量优先"

**检查点**：`npm run typecheck` 通过；`config.example.yaml` 可被现有配置加载路径解析。

---

## Phase 2：地基（阻塞所有用户故事）

**目的**：技能头部、本体加载、noul 核心、记录存储四件公共零件。**⚠️ 本阶段完成前，任何用户故事都不能开始。**

- [x] T005 [P] 新增 `agent-backend/src/domain/skill-header.ts`：`readSkillHeaderFile`（有界读取 ≤64KB）与 `parseSkillHeader`（校验 `name` / `description` 非空；`ontology_id` / `scenario_id` 归一化为字符串；`ontology_name` / `scenario_name` 去空白），并提供 `loadSkillHeaders(agentDir)` 只读 `skills/*/SKILL.md`；非法文件返回可区分原因而不是抛整轮错误
- [x] T006 新增 `agent-backend/tests/unit/skill-header.spec.ts`：正常 frontmatter、`ontology_id` 为数字 / 字符串、缺 `ontology_name`、缺 `name`、frontmatter 未闭合、超长正文只读头部、中文路径 7 类用例
- [x] T007 [P] 新增 `agent-backend/src/domain/ontology-focus/ontology-loader.ts`：枚举 `ontology/{scenario}/{ontology}/ontology.yaml`（拒绝符号链接与越界），只提取 `metadata`、`functions[]`（`name`/`title`）、`behaviors[]`（`name`/`title`/`description`/`op_type`）、`rules[]`（`behavior`/`data_supplements`）；按归一化 `ontology_id` 建索引；坏文件进 `warnings` 不中断
- [x] T008 新增 `agent-backend/tests/unit/ontology-loader.spec.ts`：多本体同 ID、缺 `metadata`、缺 `title`（回退 `name`）、`data_supplements` 缺失 / 空数组 / 非数组 / 悬空行为名、`rules[].behavior` 空白、坏 YAML、符号链接目录、中文路径
- [x] T009 [P] 收敛 `agent-backend/src/domain/intent-focus.ts`：只保留 `MAX_QUESTIONS_PER_BATCH` / `MAX_CANDIDATES` / `MAX_STATE_CHARS`（200）/ `DEFAULT_THRESHOLD`、`prepareState`、`normalizeThreshold`、`buildNoulQuestion`、`decideDisposition`；删除所有工具候选与旧提示 API；空结果原因改为 `no_skills` / `below_threshold` / `no_focusable_skills`
- [x] T010 重写 `agent-backend/tests/unit/intent-focus.spec.ts`：`prepareState` 200 字符（取尾部、对齐句首）、处置五态、空结果三原因、`noul` 命题结构逐字断言
- [x] T011 [P] 改造 `agent-backend/src/domain/intent-focus-store.ts`：记录 schema 改为 `skills` / `ontology_files` / `behaviors` / `functions` / `data_supplements` / `selected_*` / `prompt`，不再写 `probabilities` / `actions`；滚动上限与 per-thread 串行不变；单轮候选明细超限时按上限截断明细、保留结论与计数并标 `truncated`（FR-053）；`readAll` 对旧行容错
- [x] T012 更新 `agent-backend/tests/unit/intent-focus-store.spec.ts`：新 schema 字段完整性、并发 5 条不交错、>256KB 或 >200 行滚动保留 100 条、单轮明细超限被截断且保留结论与计数、原子替换失败保留原文件、旧行可读不报错
- [x] T013 新增 `agent-backend/src/domain/ontology-focus/record.ts`：把技能决策 / 能力决策 / 数据补充明细 / 提示 / warnings 映射为 `IntentFocusRecordDraft`，确保 `data_supplements` 与 `selected_*` 计数正确（依赖 T002、T011）

**检查点**：`tests/unit/{skill-header,ontology-loader,intent-focus,intent-focus-store}.spec.ts` 全绿；此时尚无任何用户故事可演示。

---

## Phase 3：用户故事 1 - 技能聚焦（优先级：P1）🎯 MVP

**目标**：非本体技能与可匹配本体的本体技能进入同一评分链路，严格阈值筛选，结果可留档。
**独立测试**：4 个技能（非本体 A、可匹配本体 B、`ontology_id` 无匹配 C、非本体低分 D）跑一轮，A/B/D 评分、C 不评分；无工具候选评分调用。

- [x] T014 [P] [US1] 新增 `agent-backend/tests/unit/ontology-candidates.spec.ts`（先写技能部分）：非本体技能进入、未匹配本体技能不进入且带 `no_matching_ontology`、`qid` 唯一、≤32 截断与 `truncated` 标记
- [x] T015 [US1] 在 `agent-backend/src/domain/ontology-focus/candidates.ts` 实现 `buildSkillCandidates`：非本体技能直接可聚焦；本体技能仅当 `ontology_id` 命中索引才可聚焦；未命中返回 `excluded` 列表（不评分、留原因）
- [x] T016 [US1] 在同文件 `candidates.ts` 实现技能题面与批次：`noul` 命题（`name` + `description` + `metadata`，≤40 字），`qid` 为 `s1..sN`，单批 ≤32（与 T015 同文件，串行）；单题面 MUST 落在 ≤256 token（FR-028），超限整批不提交、记 `degraded` 原因并停止该批后续重试（MUST NOT 无界重试）
- [x] T017 [P] [US1] 在 `agent-backend/src/domain/ontology-focus/selection.ts` 实现 `selectSkills`：`score > threshold`（严格大于）、分数降序、同分按技能原序，返回全部决策（含未入选及原因）
- [x] T018 [US1] 在 `agent-backend/src/domain/intent-focus-runner.ts` 打通最小闭环：开关关闭不记录 → 跳过记 `skipped` → 未配置记 `unconfigured` → 读取技能头部与本体索引 → 技能评分 → 筛选 → 无入选记 `empty`（`no_skills` / `no_focusable_skills` / `below_threshold`）→ 返回空串
- [x] T019 [US1] 重写 `agent-backend/tests/unit/intent-focus-runner.spec.ts` 技能部分：A/B/D 评分、C 不评分、0.60/0.61/0.82（阈值 0.6）只保留后两个、分数降序、开关关闭零调用、跳过/未配置各留一条记录

**检查点**：仅凭 `agent-backend/tests/unit/{ontology-candidates,intent-focus-runner}.spec.ts` 即可验证 US1；此时提示仍为空串，属预期。

---

## Phase 4：用户故事 2 - 本体行为与函数聚焦（优先级：P1）

**目标**：对入选本体技能所关联本体，按 `name`/`title` 逐候选评分，行为与函数分类保存。
**独立测试**：2 行为 + 3 函数、阈值 0.6、桩分数 0.9/0.5/0.7/0.6/0.8 → 行为保留 1 项、函数保留 2 项，两类不混。

- [x] T020 [US2] 在 `agent-backend/src/domain/ontology-focus/candidates.ts` 实现 `buildCapabilityCandidates`：只处理入选本体技能引用的本体；行为与函数分别取 `name`（+ `displayTitle`）；同本体按路径去重只收集一次；上限取 `config.maxCapabilities`（缺省 96）与单批 ≤32、按本体原序截断；题面只用 `title（name）`，`op_type` 仅留档、不参与题面
- [x] T021 [US2] 在 `selection.ts` 实现 `selectCapabilities` 的**直接入选**部分：`score > threshold`、行为与函数分别成集、去重键 `kind + name`、类内分数降序 / 同分原序
- [x] T022 [US2] 在 `intent-focus-runner.ts` 扩展能力阶段：同一本体本轮只解析一次、只评分一次；无 `behaviors` / `functions` 时该本体零产出不失败；多技能共享本体时复用结果
- [x] T023 [US2] 在 `agent-backend/tests/unit/ontology-candidates.spec.ts` 补能力候选用例：仅选中技能的本体、同本体多技能只收集一次、`title` 缺失回退、配置覆写上限（`max_capabilities: 2` 时只提交 2 条）与单批 32 截断、`qid c1..cN`、题面不含 `op_type`、超长题面整批降级（FR-028）
- [x] T024 [US2] 在 `agent-backend/tests/unit/intent-focus-runner.spec.ts` 补能力阶段用例：行为 1 项 / 函数 2 项、等于阈值被丢弃、同本体解析次数 1、空本体不视为失败

**检查点**：US2 可独立验证"分类正确 + 阈值边界 + 共享本体不重复评分"；US3 未完成时补充项为空。

---

## Phase 5：用户故事 3 - 规则数据补充（查询行为）与去重（优先级：P2）

**目标**：直接入选行为按 `rules[].data_supplements` 补入同本体查询行为，不受阈值约束、只进行为类、不级联；随后去重与上限截断。
**独立测试**：B1 入选 / B2 未入选，R1（`data_supplements: [Q1, Q2]`）/ R2（`Q3`）→ 结果含 Q1、Q2 不含 Q3，Q1 只一次且来源合并。

- [x] T025 [P] [US3] 新增 `agent-backend/tests/unit/ontology-selection.spec.ts`：B1/B2/R1/R2/Q1/Q2/Q3 场景；未入选行为不触发补充；悬空行为名记 `missing_supplement_behavior`；同一行为被多条规则引用取并集；补充项自身被规则引用时**不级联**；`op_type` 非 query 仍补入
- [x] T026 [US3] 在 `selection.ts` 实现数据补充：仅对**直接入选**行为匹配 `rules[].behavior`，收集 `data_supplements` 并集，在同本体 `behaviors[]` 按 `name` 取 `title`，追加 `source='supplement'`、`score=null`、`selected=true`；不进入函数类
- [x] T027 [US3] 在 `agent-backend/src/domain/ontology-focus/selection.ts` 实现去重与上限：`kind + name` 为键、保留最高分、来源合并为 `direct+supplement`、`ontologyIds` 并集、`title` 取首次；去重后行为类 ≤96，超限按本体原序截断补充项并置 `truncated`
- [x] T028 [US3] 扩展 `record.ts` 与 `intent-focus-runner.ts`：写入 `data_supplements`（`behavior` / `supplement` / `found`），悬空项 `found=false`，`selected_behaviors` 含补充项
- [x] T029 [US3] 在 `agent-backend/tests/unit/intent-focus-store.spec.ts` 补 `data_supplements` 字段与计数用例：`found=false` 仍留档、去重后计数与 `selected_behaviors` 一致

**检查点**：US3 可独立验证"补什么 / 不补什么 / 补几次 / 排序与上限"；此时提示仍未接入。

---

## Phase 6：用户故事 4 - 提示绑定、替换旧方案与降级（优先级：P3）

**目标**：把聚焦结果铸造成单行中文提示，追加到本轮 `systemExtra` 末尾；停用原工具聚焦；失败静默降级。
**独立测试**：开关关闭、卡片入口、无关联技能、Laya 超时各跑一轮 → 正常回答、无提示、历史无痕、工具评分 0 次、记录五态可区分。

- [x] T030 [P] [US4] 新增 `agent-backend/src/domain/ontology-focus/prompt.ts`：固定前缀、技能段（`description` ≤80 字、空则省略括号）、本体技能 `本体能力：` 行为在前函数在后、空类别省略、同本体能力归属分数最高技能、段间中文分号、单行、≤1200 字符按完整条目截断
- [x] T031 [US4] 新增 `agent-backend/tests/unit/ontology-prompt.spec.ts`：非本体技能无能力段、本体技能说明在前、同本体多技能能力不重复、空类别省略、`title` 缺失回退、1200 截断不出现半截条目、整体单行无换行、输出为中文且技能 / 行为 / 函数 `name` 与本体原文逐字一致（不翻译、不改写）
- [x] T032 [US4] 在 `intent-focus-runner.ts` 接入提示铸造、降级与结构化日志：仅入选非空时返回提示；Laya 未配置 / 不可达 / 超时 / 响应非法 / 分数缺失 → `degraded` 且不追加；总预算 ≤10 秒；部分批次失败但有结果继续；按 `plan.md` §10 输出 `skipped` / `unconfigured` / `done` / `degraded` / `record.failed` 五类事件，字段含 `req_id`（如可用）、`thread_id`、`agent_name`、`stage`、`reason`、`round_ms`（FR-058 / TR-10）
- [x] T033 [US4] 在 `agent-backend/src/domain/run-consume.ts` 调整调用点：`buildPrompt` 成功后、`agent.run` 之前调用 `judge`，把返回提示追加到 `prompt.systemExtra` 末尾（空行分隔），删除 `focusJudge` 闭包与 `tools` 依赖
- [x] T034 [US4] 在 `agent-backend/src/server-attachments.ts` 改为始终装配 `IntentFocusRunner`（`config.client` 可选），使"开关开启但 Laya 未配置"也能留档 `unconfigured`
- [x] T035 [P] [US4] 删除 `agent-backend/src/domain/run-manager.ts` 的 `AgentRunRequest.focusJudge` 与 `agent-backend/src/infra/agent-factory.ts` 的工具候选回调块；工具装配、白名单与权限逻辑保持不变
- [x] T036 [US4] 删除或改造工具聚焦存量测试，**范围限定**为工具候选 / 工具评分专属用例与 `agent-backend/infra/agent-factory` 相关断言（`agent-backend/tests/unit/intent-focus.spec.ts` 已由 T010 重写，不再改动）；并更新 `agent-backend/tests/unit/soul-intent-focus.spec.ts` 只保留开关语义
- [x] T037 [US4] 重写 `agent-backend/tests/integration/chat-intent-focus.spec.ts`：开关关闭零读取零调用、卡片 `skipped`、未配置 `unconfigured`、只有非本体技能、本体技能含数据补充、部分批次失败、两轮互不携带、旧工具聚焦零执行 8 个场景；并断言五态各留一条记录且 `disposition` 可区分、日志事件含 `stage` / `reason` 且不含输入正文与提示全文
- [x] T038 [P] [US4] 复核 `specs/013-intent-focus/contracts/intent-focus-api.md` 的废止说明：确认已写明"工具候选 / `probabilities` / `actions` / 旧提示前缀不再适用，以 016 契约为准"，缺失则补

**检查点**：US4 完成即端到端可用；提示只出现一次且不进入历史 / 摘要 / 记忆 / 界面。

---

## Phase 7：收尾与横切关注

- [x] T039 在 `agent-backend` 用单条命令跑全量门禁：`npm run gate`（已在 `agent-backend/package.json` 固化 `typecheck → lint → test:coverage → build`，宪章原则八）；任一项失败必须修复后重跑（不得以"存量红灯"为由跳过），并把 `npm run gate` 写入 `quickstart.md §5`
- [x] T040 覆盖率达标：确认新增 `domain/ontology-focus/*` 与 `skill-header.ts` 语句覆盖率 ≥80%，并把新文件纳入后端覆盖率阈值清单
- [x] T041 不变性核对：逐个检查 `agent-backend/src/domain/ontology-focus/*.ts`、`skill-header.ts`、`intent-focus-runner.ts` 单文件 ≤500 行（超限按"拆函数 / 拆文件"处理）；并核对平台侧无改动、部署物化产物仍同时含 `skills/*/SKILL.md` 与 `ontology/*/*/ontology.yaml`、格式未变（FR-064）
- [x] T042 按 `specs/016-ontology-skill-focus/quickstart.md` 实跑单测 + 集成 + 记录检查命令，把实际输出作为验收证据补记到本文件
- [x] T043 契约一致性复核：提示格式、`source` 枚举、记录字段 `data_supplements`、配置键在 `contracts/intent-focus-api.md`、`data-model.md` 与代码三处逐项对齐
- [x] T044 回写文档：`spec.md` 修订记录补"实现期结论"（若有偏差）、勾选本文件任务、必要时更新 `agent-backend/README.md` 的 016 配置说明

---

> **实施后调整（2026-11-04，按试用反馈）**：记录删除 `ontology_files` / `selected_*` / 能力 `ontology_ids` / 能力 `reason`；
> 去重键改为 `ontology_id + name`（函数与行为同逻辑，跨本体同名各自保留）；提示改为编号清单（本体技能带本体 id/name 与行为/函数）。
> 下文 T011 / T013 / T027 / T028 / T037 描述的字段为**当时**口径，最新口径以 `spec.md §修订记录` 与 `data-model.md §5/§6/§7.3` 为准。

## 验收证据（T042，2026-11-04，宿主机本地实测）

### 全量门禁

```bash
cd agent-backend
npm run gate      # typecheck → lint → test:coverage → build
```

实际结果：四项全部通过，退出码 0；`dist/` 构建成功；`package.json` / lockfile 无新增依赖。

### 测试

```bash
npx vitest run                        # 全量
npx vitest run tests/unit/intent-focus-runner.spec.ts tests/unit/soul-intent-focus.spec.ts
```

- 全量：**84 个测试文件 / 1137 个用例全通过**
- 016 相关用例数：`intent-focus-runner` 17、`chat-intent-focus`（集成）16、
  `intent-focus-store` 16、`skill-header` 12、`intent-focus` 10、`soul-intent-focus` 6，
  另有 `ontology-candidates` / `ontology-selection` / `ontology-prompt` / `ontology-record`
  各 4~12 例

### 覆盖率（`npm run test:coverage` 实测）

| 模块 | 语句 | 分支 | 函数 | 行 |
|---|---|---|---|---|
| `src/domain/ontology-focus`（合计） | 94.9 | 85.3 | 100 | 95.31 |
| `src/domain/skill-header.ts` | 96 | 89.47 | 100 | 95.74 |
| `src/domain/intent-focus.ts` | 100 | 100 | 100 | 100 |

七个新文件均已登记到 `agent-backend/vitest.config.ts` 的 80% 阈值清单（T040）。

### 单文件行数（T041）

`batch-decider` 100｜`candidates` 205｜`ontology-loader` 173｜`prompt` 123｜`record` 117｜
`run-record` 101｜`selection` 208｜`types` 130｜`intent-focus-runner` 500｜`skill-header` 151｜
`intent-focus-store` 205 —— 全部 ≤500 行。**`intent-focus-runner.ts` 恰好 500，无余量**：
下次在该文件加任何内容前，应先把 `fail()` / `log()` / `degradedLog()` 三个观测方法外移。

### 装配与调用点核对

- `src/server-attachments.ts`：`IntentFocusRunner` **常驻装配**，判定模型缺省时只缺 `client`
  （以便留 `unconfigured` 记录）
- `src/domain/run-consume.ts`：`buildPrompt` 成功后、`agent.run` 之前调用 `judge`，
  返回非空才追加到 `systemExtra` 末尾；`skip` = `skipIntentFocus === true || guidance 非空`
- 旧工具聚焦链路零残留：`src/` 内 `focusJudge` / `selectCandidates` / `ToolCandidate` /
  `probabilities` 均无匹配

---

## 依赖关系

```text
Phase 1（T001-T004）
   └─ Phase 2（T005-T013，阻塞全部故事）
        ├─ US1（T014-T019）  ← MVP
        │     └─ US2（T020-T024）
        │           └─ US3（T025-T029）
        └─ US4（T030-T038）：提示与装配可在 US1 后开工，
              但端到端验收需 US2 / US3 完成后重跑 T037
```

- US1 → US2：能力聚焦依附"入选本体技能"，无 US1 无候选。
- US2 → US3：数据补充依附"直接入选行为"，且需要本体已解析。
- US4 的 T030/T031 可与 US2 并行（不同文件）；T032~T035 需在 US2 后接入，T037 放最后。

## 并行示例

```text
# Phase 2：四件公共零件的实现互不冲突，可同时开工
T005 skill-header.ts  ∥  T007 ontology-loader.ts  ∥  T009 intent-focus.ts 收敛  ∥  T011 store schema
# 其单测（T006/T008/T010/T012）各自紧随对应实现串行补写，因此不带 [P]

# Phase 6：互不依赖的收尾可同时推进
T030 prompt.ts  ∥  T034 server-attachments 装配  ∥  T035 删除旧工具链路  ∥  T038 013 契约复核
```

**标注口径**：测试任务只有在本实现尚未落地、且允许先写（如 T014 / T025）时才带 [P]；其余测试任务均排在其实现之后，不带 [P]，避免"测试先跑必红"被误读为失败。

**不可并行**：`candidates.ts`（T015/T016/T020）、`selection.ts`（T017/T021/T026/T027）、`intent-focus-runner.ts`（T018/T022/T028/T032）为同文件串行任务，按编号顺序执行。

## 实施策略

### MVP 优先（仅 US1）

1. 完成 Phase 1 + Phase 2（地基）。
2. 完成 US1（T014-T019）。
3. **停下验证**：4 技能用例 + 阈值边界 + 零工具调用。
4. 此时系统能"选出该看哪本本体"，但不会给主模型任何提示——属预期，不对外交付。

### 增量交付

1. 地基 → US1（可验证技能筛选）→ US2（可验证能力分类）→ US3（可验证补充与去重）→ US4（端到端 + 旧链路停用）。
2. 每个故事结束跑对应单测 + 全量 `test`，保持绿。
3. US4 完成后跑 `quickstart.md` 的端到端与记录检查，作为交付证据。

## 需求覆盖索引

| 需求 | 任务 |
|---|---|
| FR-001~FR-006（触发与前置） | T018、T032、T033 |
| FR-010~FR-019（技能识别与聚焦） | T005~T010、T014~T019 |
| FR-020~FR-027（能力聚焦与分类） | T007、T020~T024 |
| **FR-028（单题 ≤256 token 与批次降级）** | T016、T023 |
| FR-030~FR-035（数据补充与去重） | T025、T026、T027、T028 |
| FR-040~FR-045、FR-047~FR-048（提示结构） | T030、T031、T032、T037 |
| **FR-046（中文输出、name 不翻译）** | T031 |
| FR-050~FR-052、FR-054~FR-057（记录与降级） | T011~T013、T028、T029、T032 |
| **FR-053（记录明细截断）** | T011、T012 |
| **FR-058（结构化日志）** | T032、T037 |
| FR-060~FR-063（开关与配置） | T003、T004、T018、T034 |
| **FR-064（平台侧与物化产物不变）** | T041 |
| **FR-022（题面素材，`op_type` 不参与）** | T020、T023 |
| SC-001~SC-014 | T019、T024、T025、T031、T037、T039~T042 |

## 基线备注

- T001 基线（实施前 → 实施后）：
  - `src/domain/intent-focus.ts`：原含工具候选与旧提示 API，收敛后 114 行，只留
    `MAX_QUESTIONS_PER_BATCH` / `MAX_CANDIDATES` / `MAX_STATE_CHARS` / `DEFAULT_THRESHOLD`、
    `prepareState`、`normalizeThreshold`、`decideDisposition`、`IntentFocusDisposition`。
  - `src/server-attachments.ts`：装配点原为「未配置即整体不装配」，改为**始终装配** runner、
    仅按配置决定是否带 `client`（约 59~80 行）。
  - `src/domain/run-consume.ts`：`buildPrompt` 成功之后、`agent.run` 之前插入 `judge` 调用
    （约 145~178 行），提示追加到 `systemExtra` 末尾。
  - 待删除符号（已删净）：`AgentRunRequest.focusJudge`、`buildPrompt` 的 `tools` 依赖、
    `agent-factory.ts` 工具候选回调块、`selectCandidates` / `ToolCandidate` / `probabilities` /
    `actions` 记录字段。
- 实施后事实：`agent-backend/src/domain/ontology-focus/` 共 8 个文件（types / ontology-loader /
  candidates / selection / prompt / record / run-record / batch-decider），合计 1157 行。
- 分析整改（2026-11-04）：按 `/speckit.analyze` 结论，新增 `agent-backend/package.json` 的 `gate` 脚本（宪章原则八单命令门禁）；T011 / T012 补 FR-053（明细截断）、T016 / T023 补 FR-028（题面 token 与批次降级）、T032 / T037 补 FR-058（结构化日志与五态留档）、T041 补 FR-064（物化产物不变）、T031 补 FR-046（中文与 `name` 不翻译）、T020 / T023 明确 `op_type` 不参与题面；T036 收窄范围避免与 T010 抢同一文件。
