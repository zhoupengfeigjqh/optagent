# 任务清单：意图聚焦指代改写（027）

**输入**：`specs/027-intent-focus-query-rewrite/` 下的 `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/intent-focus-rewrite.md`、`quickstart.md`

**前置**：`plan.md`（技术栈与结构）、`spec.md`（用户故事与优先级）

**测试说明**：宪章原则三为 NON-NEGOTIABLE，本清单**包含测试任务**（每个纯函数 / 编排 / 端点 / 组件都有同名 spec）。测试只在宿主机本地执行，容器不承担测试。

**组织方式**：按用户故事分组，每个故事可独立实现与验收；`[P]` 表示不同文件、无依赖，可并行。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（**不同文件**、无未完成依赖）。同一文件的多个任务（如都写 `chat-rewrite.spec.ts`）MUST NOT 同时标 `[P]`，避免并行写冲突
- **[Story]**：所属用户故事（US1 / US2 / US3 / US4）；Setup / Foundational / Polish 阶段不带故事标签
- 每条任务都写明确切文件路径

## 路径约定

- 运行环境：`agent-backend/src/...`、`agent-backend/tests/...`
- 管理平台服务：`admin-backend/src/...`、`admin-backend/tests/...`
- 管理前端：`admin-frontend/src/...`（组件 spec 与组件同目录）
- 聊天前台 `frontend/` **零改动**（本特性不涉及）
- 规格与契约：`specs/027-intent-focus-query-rewrite/...`

---

## Phase 1: Setup（共享前置）

**目的**：确认基线、补齐配置文档示例；不改业务代码。

- [X] T001 跑三侧基线门禁并记录结果（`agent-backend`: `npm run gate`；`admin-backend`: `npm test`；`admin-frontend`: `npm test`），把存量失败与耗时写入 `specs/027-intent-focus-query-rewrite/quickstart.md` 的排障小节，作为后续对比基线
- [X] T002 [P] 在 `agent-backend/config.example.yaml` 的 `intent_focus` 块补 `rewrite_threshold`（缺省 0.8，可被 `INTENT_FOCUS_REWRITE_THRESHOLD` 覆盖）与 `rewrite_timeout_ms`（缺省 5000，不得超过 `timeout_ms`）的注释示例

---

## Phase 2: Foundational（阻塞性前置）

**目的**：把开关读取、配置、留档、纯函数、模型适配与编排接线全部就绪；未完成前任何用户故事都无法验收。

**⚠️ 关键**：本阶段完成后，US1 / US2 / US4 共用同一管线；US3 的开关与管理侧改动可并行推进。

- [X] T003 [P] 在 `agent-backend/src/config.ts` 的 `intent_focus` 块新增 `rewrite_threshold` / `rewrite_timeout_ms`（zod 校验 `0~1`、`300~10000` 且 `≤ timeout_ms`；环境变量优先），并在 `agent-backend/tests/unit/config.spec.ts` 补缺省 / 越界 / 环境变量覆盖 / **整块缺失不阻断启动**四类用例
- [X] T004 [P] 在 `agent-backend/src/domain/soul.ts` 的 `SoulMeta` 增加 `inputRewrite` / `termNormalize` 解析，并新增 `isInputRewriteEnabled` / `isTermNormalizeEnabled`（逐次读盘、缺键或非布尔按 `false` 并告警），在 `agent-backend/tests/unit/soul.spec.ts` 覆盖缺失 / 非布尔 / 读取异常
- [X] T005 [P] 在 `agent-backend/src/domain/intent-focus/store.ts` 记录类型追加 7 个改写字段（`need_rewrite` / `rewrite_score` / `rewrite_query` / `rewrite_truncated` / `rewrite_ms` / `rewrite_history_turns` / `rewrite_reason`），并在 `agent-backend/src/domain/intent-focus/record.ts` 统一补默认值（`null` / `''` / `0` / `false`）；在 `agent-backend/tests/unit/intent-focus-record.spec.ts` 断言早退分支也恒有这些键、既有 `input` / `input_truncated` 语义不变
- [X] T006 [P] 新建 `agent-backend/src/domain/intent-focus/rewrite-prompt.ts`：`NEED_REWRITE_QID`、`buildNeedRewriteQuestion()`、`shouldRewrite(score, threshold)`、`pickRecentTurns(messages, 3)`、`buildRewriteMessages(turns, current)`（**恒返回 1 条 user 消息**）、`normalizeRewrite(raw)`（码点 100 字截断与引号 / 前缀 / 围栏归一），并新建同名 spec `agent-backend/tests/unit/intent-focus-rewrite-prompt.spec.ts` 覆盖契约 §7 全部步骤与失败轮 / 附件 / 空正文过滤
- [X] T007 [P] 新建 `agent-backend/src/infra/rewrite-llm.ts`：实现 `RewriteLlm` 端口（`streamChat` → 聚合 `content_delta`；`tools: []`、无 thinking；`error` 事件转失败；超时与本轮中止信号合并），并新建 `agent-backend/tests/unit/rewrite-llm.spec.ts` 用假 `LlmProvider` 覆盖正常 / `error` / 超时 / 中止 / 模型选择
- [X] T008 新建 `agent-backend/src/domain/intent-focus/rewrite.ts`：编排「开关 → 判定 → 素材 → 改写 → 归一 → 降级 → 计时」，返回 `RewriteOutcome`（`state` / `truncated` / `needRewrite` / `score` / `rewrite` / `rewriteTruncated` / `rewriteMs` / `historyTurns` / `reason`），并在 `agent-backend/tests/unit/intent-focus-rewrite.spec.ts` 覆盖双开关矩阵、判定失败、预算不足、改写失败 / 空输出 / 超长、**每轮至多一次改写（不递归）**
- [X] T009 在 `agent-backend/src/domain/intent-focus/runner.ts` 的「无技能 / 无可聚焦技能」短路之后、技能评分之前调用改写阶段，并用返回的 `focusState` 参与技能 / 行为评分与发散；留档保持 `input` 为原文、另记改写字段，在 `agent-backend/tests/unit/intent-focus-runner.spec.ts` 补"短路零调用"与"评分 state 已切换"
- [X] T010 在 `agent-backend/src/server-attachments.ts` 的判定依赖中注入 `isRewriteEnabled`、`readHistory`、`rewriteLlm`（均可选，缺省 = 改写不可用，保持既有测试构造方式可用）
- [X] T011 在 `agent-backend/src/server.ts` 把请求级模型 provider 解析抽成共享的 `providerFor`（同时传给 `agent-factory` 与 `buildAttachments`），并把 `HistoryStore.readAll` 以只读闭包注入 `buildAttachments`
- [X] T012 在 `agent-backend/src/domain/run-consume.ts` 把本轮 `opts.model` 与 `run.controller.signal` 透传给聚焦判定入参（不改事件顺序、不改既有限流与收尾逻辑）

**检查点**：`cd agent-backend && npm test` 全绿；既有 013/016/019 用例零改动通过。

---

## Phase 3: 用户故事 1 — 指代型输入先改写再聚焦（P1）

**目标**：三开关全开时，指代输入触发 1 次判定 + 1 次改写，评分使用改写结果；用户消息 / 历史 / 界面仍是原话。

**独立验收**：单轮指代输入跑通，记录含 `need_rewrite=true` 与非空 `rewrite_query`；`history.jsonl` 的 user 行逐字等于提交内容；聚焦提示、工具清单与卡片结构不变。

- [X] T013 [US1] 新建 `agent-backend/tests/integration/chat-rewrite.spec.ts`：三开关全开 + 指代输入 + 有历史 → 判定 1 次、改写 1 次、评分 `state` 为改写结果；断言用户消息、`systemExtra` 聚焦提示、`history.jsonl` 与 SSE 中改写文本零出现
- [X] T014 [US1] 在 `agent-backend/tests/integration/chat-rewrite.spec.ts` 覆盖"改写为陈述句 / 指令"与"改写超 100 字被截断"两条路径（桩 `RewriteLlm` 返回对应文本），断言均被正常采用、不因非问句失败
- [X] T015 [US1] 在 `agent-backend/tests/integration/chat-rewrite.spec.ts` 增两条：①**重新生成**本轮 → 判定 2 次、改写 2 次、留档 2 条（不复用上一轮）；②**术语替换命中后的文本**作为提交内容 → 判定素材等于该文本（含替换值），且运行期术语表读取 0 次
- [X] T016 [US1] 跑既有 `agent-backend/tests/integration/chat-intent-focus.spec.ts` 与本体聚焦用例，并用快照断言：聚焦提示五元组格式、`tool_tips` 四字段、卡片结构、**本轮工具清单**与 **SOUL 正文**逐字未变（有差异只修桥接，不改格式）
- [ ] T017 [US1] 按 `specs/027-intent-focus-query-rewrite/quickstart.md` §2.1/§2.2 做一次真实链路手工验证，并用脚本跑 **20 轮**指代输入采样，把 `rewrite_ms` 的 P90、阶段总耗时与 `rewrite_chars` / `rewrite_history_turns` 记录到同一文档的"验证记录"小节

**检查点**：US1 可独立演示（手动写 SOUL frontmatter 即可开启，无需管理台）。

---

## Phase 4: 用户故事 2 — 非指代输入零改写（P1）

**目标**：判定为 false 时零改写调用，聚焦素材与改造前逐字一致。

**独立验收**：独立问句轮次只多一次单条 Laya 判定；记录 `need_rewrite=false`、`rewrite_query=""`；无改写耗时。

- [X] T018 [US2] 在 `agent-backend/tests/integration/chat-rewrite.spec.ts` 增"独立问句 → 判定 1 次、改写 0 次、评分 state = 原文（尾部 200 字）"，并断言 `rewrite_ms` 为空、日志无改写模型调用
- [X] T019 [US2] 在 `agent-backend/tests/unit/intent-focus-rewrite-prompt.spec.ts` 增 `shouldRewrite` 边界用例：分数**等于**阈值不改写、低于阈值不改写、高于阈值改写（严格大于口径）
- [X] T020 [US2] 在 `agent-backend/tests/integration/chat-rewrite.spec.ts` 做回归对比：同一输入下（改写关闭 vs 判定 false）聚焦记录中的 `skills` / `behaviors` / `prompt` 逐字一致，作为"零回归"证据

**检查点**：US2 与改造前行为无法区分（除多一条 Laya 调用）。

---

## Phase 5: 用户故事 3 — 开关、转发入口与无技能短路（P2）

**目标**：两个新开关在管理台可配、部署物化正确、意图聚焦关闭时置灰保留值；术语替换改为双开关闸门；跳过与短路轮零调用。

**独立验收**：三开关组合矩阵符合契约 §10 / 研究 R13；管理台勾选保存并部署后 SOUL 产物键正确；关闭态产物零残留。

- [X] T021 [P] [US3] 在 `admin-backend/src/domain/config-center/soul-design.ts` 增加 `input_rewrite` / `term_normalize` 字段（拒绝式校验、缺省 `false`、不随意图聚焦清空），并在 `renderSoulMd` 实现"仅 AND 为真才写键"，在 `admin-backend/tests/unit/soul-design.spec.ts` 补校验与物化用例
- [X] T022 [P] [US3] 在 `admin-backend/src/domain/config-center/agent-design.ts` 的 `withSoulDefaults` 补齐两个布尔键的收敛（非布尔 → false）与变更检测，并在 `admin-backend/tests/unit/agent-design.spec.ts` 补读取归一化用例
- [X] T023 [P] [US3] 新建 `admin-backend/tests/unit/soul-design-switches.spec.ts`：三开关组合矩阵（聚焦 × 输入重写 / 聚焦 × 术语替换）与关闭态产物零残留；并在 `admin-backend/tests/unit/materialize.spec.ts` 增部署产物断言
- [X] T024 [P] [US3] 在 `admin-frontend/src/api/soul.ts` 的 `SoulDesign` 增两个 `boolean`、`admin-frontend/src/constants/agent-design.ts` 的 `emptySoulDesign` 显式落 `false`、`admin-frontend/src/composables/useAgentDesign.ts` 的 `cloneSoul` 显式复制，并在对应 `*.spec.ts` 断言脏检查与"复制数字人"不丢字段
- [X] T025 [US3] 在 `admin-frontend/src/components/agents/SoulEditor.vue` 的意图聚焦配置区新增「输入重写」「术语替换」两个复选框（`intent_focus !== true` 时 `disabled` 但保留勾选值），「术语替换」旁给出固定说明文案"仅当该数字人拥有本体术语映射集时，开启本功能才会生效"；在 `admin-frontend/src/components/agents/SoulEditor.spec.ts` 覆盖勾选 / 置灰 / 值保留 / 文案 / 键盘与读屏标签
- [X] T026 [P] [US3] 在 `agent-backend/src/routes/term-normalize.ts` 把闸门改为 `isIntentFocusEnabled && isTermNormalizeEnabled`（关闭时在读取术语表之前返回 `applied:false`），并在 `agent-backend/tests/integration/term-normalize.spec.ts` 增四组合用例（含"关闭时不读术语文件"断言）
- [X] T027 [P] [US3] 在 `agent-backend/tests/integration/chat-intent-focus.spec.ts` 增"输入重写关闭""术语替换关闭""卡片入口""显式技能""无技能 / 无可聚焦技能"五种零调用断言（术语替换关闭时判定与改写仍需照常，素材为原文）

**检查点**：不写 SOUL 手工配置，仅通过管理台即可开启并验证。

---

## Phase 6: 用户故事 4 — 降级、留档与可分析（P3）

**目标**：判定 / 改写 / 预算 / 留档任一失败都不影响回答；记录可完整区分"真 / 假 / 未执行 / 失败"。

**独立验收**：五类失败各跑一轮，回答正常、无用户可见错误、记录原因准确、日志不含正文。

- [X] T028 [US4] 新建 `agent-backend/tests/unit/intent-focus-rewrite-fail.spec.ts`，覆盖判定失败四形态（超时 / HTTP 非 200 / 响应形状非法 / 缺分数）：按不改写继续、`need_rewrite=null`、`reason=judge_failed`、不重试
- [X] T029 [US4] 在 `agent-backend/tests/unit/intent-focus-rewrite-fail.spec.ts` 覆盖改写失败三形态（超时 / `error` 事件 / 归一为空）：回退原文、`rewrite_query=""`、原因分别为 `llm_failed` / `empty_output`
- [X] T030 [P] [US4] 新建 `agent-backend/tests/integration/chat-rewrite-budget.spec.ts`：把 `timeout_ms` / `rewrite_timeout_ms` 调到边界（含剩余 <300ms），断言阶段在预算内结束、本轮按原文聚焦、记录 `budget_exhausted`
- [X] T031 [US4] 在 `agent-backend/tests/unit/intent-focus-record.spec.ts` 覆盖记录写入失败（只读目录 / 磁盘异常注入），并新建 `agent-backend/tests/integration/chat-rewrite-degrade.spec.ts` 断言回答与聚焦正常、原始错误进结构化日志；同时断言 `intent-focus.rewrite.done` / `.degraded` / `.skipped` 三个事件的字段不含用户原文与改写全文

**检查点**：断网 / 超时 / 空输出三种恶劣条件下，用户体验与改造前一致。

---

## Phase 7: Polish（横切收尾）

- [X] T032 三侧门禁：`cd agent-backend && npm run gate`；`cd admin-backend && npm test`；`cd admin-frontend && npm test`；确认全绿且无新增依赖（`package.json` / lockfile 无变化）
- [X] T033 [P] 覆盖率清单：确认 `rewrite-prompt.ts`、`rewrite.ts`、`rewrite-llm.ts` 语句覆盖率 ≥ 80%，在 `agent-backend/vitest.config.ts` 的覆盖率阈值说明处登记这三项，并在 `specs/027-intent-focus-query-rewrite/plan.md` 的「测试与验证策略」补一行实测数字
- [X] T034 [P] 文档一致性核对：`specs/001-digital-human-platform/contracts/admin-api.md` §5.3（字段名 / 物化条件 / 说明文案）、`runtime-api-delta.md` R30 与 §21.7（事件名 / 记录字段 / 预算）、`specs/018-term-normalize/contracts/term-normalize-api.md`（闸门）与本实现逐项对齐，有偏差只改文档或只改代码一侧
- [X] T035 升级与部署说明：在 `agent-backend/config.example.yaml` 的 `intent_focus` 块与 `specs/027-intent-focus-query-rewrite/quickstart.md` §6 明确"输入重写与术语替换均默认关闭；术语替换升级后需管理员显式开启并重新部署"
- [ ] T036 建立指代判定评测资产并执行一次：新建 `agent-backend/tests/fixtures/rewrite-labeled-set.json`（**≥30 条**，代指型 / 独立问句 / 短句 / 长粘贴各 ≥6）与离线评测脚本 `agent-backend/scripts/eval-need-rewrite.mjs`（逐条打真实 Laya、输出准确率与误判率），把结果写入 `specs/027-intent-focus-query-rewrite/quickstart.md` 的验证记录（对应 SC-001）

---

## 依赖关系

```text
Phase 1 (T001–T002)
  └─ Phase 2 (T003–T012)
       ├─ T003 / T004 / T005 / T006 / T007 互相独立（可并行）
       ├─ T008 依赖 T003,T004,T006,T007
       ├─ T009 依赖 T005,T006,T008
       ├─ T010 依赖 T009
       ├─ T011 依赖 T010
       └─ T012 依赖 T011
            ├─ US1 (T013–T017) 依赖 Phase 2；T013→T014→T015 同文件顺序执行
            ├─ US2 (T018–T020) 依赖 T008/T009；与 US1 共用 `chat-rewrite.spec.ts`，须在 T015 之后接入
            ├─ US3 (T021–T027) 依赖 T004；管理侧 T021–T024 与运行侧 T025–T026 可并行，T025 依赖 T024
            └─ US4 (T028–T031) 依赖 T008/T009/T005；T028→T029 同文件顺序执行
                 └─ Polish (T032–T036) 依赖全部；T036 亦依赖 T008（需可运行的判定链路）
```

**故事完成顺序**：US1（MVP）→ US2 → US3（可在此之前手动写 SOUL 验证）→ US4 → Polish。

---

## 并行执行示例

### 用户故事 1

```bash
# 同文件按顺序：T013 → T014 → T015（不并行，避免写冲突）
Task: "chat-rewrite.spec.ts 主路径（判定→改写→评分→零污染）"
# 之后可并行：结构快照与手工采样
Task: "chat-intent-focus.spec.ts + 快照（提示 / tool_tips / 工具清单 / SOUL 正文）"
Task: "quickstart §2.1/2.2 手工验证 + 20 轮采样"
```

### 用户故事 2

```bash
# 并行：阈值边界单元（不同文件）+ false 分支集成（chat-rewrite.spec.ts，接在 T015 之后）
Task: "intent-focus-rewrite-prompt.spec.ts shouldRewrite 边界"
Task: "chat-rewrite.spec.ts 独立问句零改写 + 零回归对比"
```

### 用户故事 3

```bash
# 并行：管理服务字段 / 管理前端字段 / 术语闸门 / 短路用例
Task: "soul-design.ts + soul-design.spec.ts"
Task: "agent-design.ts + soul-design-switches.spec.ts + materialize.spec.ts"
Task: "api/soul.ts + constants + useAgentDesign clone"
Task: "routes/term-normalize.ts 双开关闸门"
Task: "chat-intent-focus.spec.ts 五种零调用"
# 依赖：T025（SoulEditor.vue）在 T024 之后
```

### 用户故事 4

```bash
# 并行：降级主文件（T028→T029 顺序）+ 预算集成 + 留档写入失败
Task: "intent-focus-rewrite-fail.spec.ts 判定失败 → 改写失败"
Task: "chat-rewrite-budget.spec.ts 预算边界"
Task: "intent-focus-record.spec.ts + chat-rewrite-degrade.spec.ts 写入失败与日志字段"
```

---

## 实施策略

### MVP 优先（仅 US1）

1. 完成 Phase 1 + Phase 2（阻塞性前置）；
2. 完成 Phase 3（T013–T017）；
3. **停下来验证**：手动写 SOUL `intent_focus: true` + `input_rewrite: true`，跑 quickstart §2.1，确认判定 / 改写 / 零污染 / P90；
4. 可部署演示（管理台入口尚未提供，属 US3）。

### 增量交付

1. Setup + Foundational → 管线就绪；
2. US1 → 独立验收（MVP）；
3. US2 → 确认零回归；
4. US3 → 管理台可配（业务可自助开启）；
5. US4 → 降级与可观测收尾；
6. Polish → 门禁、覆盖率、契约核对、升级说明、评测资产。

### 并行团队分工

- 开发 A：T003–T009（配置 / SOUL / 记录 / 纯函数 / 编排 / runner）
- 开发 B：T007、T010–T012（LLM 适配 / server 接线 / run-consume）
- 开发 C：T021–T025（管理平台服务与前端）
- 开发 D：T026–T031（术语闸门 / 零调用 / 降级矩阵）
- 收尾：T032–T036 任一成员

### 风险提示（实施时盯）

- `runner.ts` 只加编排调用、不堆逻辑（技术债见文末）；
- 改写文本只经返回值流动，禁止写入 `opts` / `storedUserMessage` / `systemExtra`；
- 改写素材恒为 **1 条 user 消息**（以模板拼装，不拆多轮）；
- 两个新开关必须三处同步（类型 / 常量 / 深拷贝），否则脏检查误报；
- 术语替换闸门只在 `term-normalize` 路由一处判定；
- 同一测试文件的多个任务不标 `[P]`。

---

## 技术债（非本特性验收）

- **待拆分**：`agent-backend/src/domain/intent-focus/runner.ts`（存量 680 行，超 500 行门禁）——建议拆为"短路与目录装载"、"评分与发散编排"、"提示铸造与留档"三文件，拆分后回归 013/016/019 全部用例。本特性只增加约 15 行编排调用，不在此次拆分。

---

## 实施记录（2026-11-19）

**已完成**：T001–T016、T018–T035（共 33 项）。**未完成 2 项**，均因本机无真实 Laya 服务与模型 key：

- **T017**（真实链路手工验证 + 20 轮 P90 采样）：自动化端到端已覆盖同一路径（`chat-rewrite*.spec.ts`，含降级与预算），但 P90 与 `rewrite_chars` / `rewrite_history_turns` 的现场采样未做；`quickstart.md` §7 已留空行待补。
- **T036**（标注集 + 评测脚本已建成并 `--dry-run` 校验通过；**真实 Laya 评测未执行**）：`quickstart.md` §7 已登记"未执行"及补跑命令。

### 与任务的偏差（均为减少重复覆盖，已逐一说明）

| 任务 | 原计划文件 | 实际落点 | 理由 |
|---|---|---|---|
| T023 | `soul-design-switches.spec.ts` | `soul-design-rewrite-switch.spec.ts` | 与既有的 `soul-design-focus-depth.spec.ts` 命名一致（按被测主题命名），覆盖内容不变（聚焦 × 输入重写 / 聚焦 × 术语替换矩阵 + 关闭态零残留） |
| T028 / T029 | `intent-focus-rewrite-fail.spec.ts` | `intent-focus-rewrite.spec.ts` 的「判定分支 / 改写失败矩阵」两节 | 两文件会覆盖同一编排函数的同一组分支；拆开后任一文件都不足以说明降级矩阵完整性 |
| T031（前半） | `intent-focus-record.spec.ts` 记录写入失败 | 既有 `intent-focus-store.spec.ts` 的只读目录用例 + 本次 `record.spec` 的七字段默认值断言 | 写入失败是 **store** 的职责，record 只是铸造；在 record 里注入磁盘故障会重复覆盖且层次错位 |
| T015（②）/ T027（术语替换关闭） | 分列两条 | 合成"术语替换关闭时判定素材就是提交原文"一条（目录里放了术语表作探针） | 两件事是同一条路径的两个断言，合在一起才排除"运行期二次替换" |

### 额外落点（任务未列但为消除重复而新增）

- `agent-backend/tests/integration/support/rewrite-env.ts`：三个集成测试文件共用的"真 HTTP + 桩模型"夹具（Laya 桩 / fake LlmProvider / 部署产物写入 / 起服务）。若不抽出来，三份文件会各自维护一份 `buildServer` 构造口径，容易出现"某个文件永远绿"的漂移。
- `agent-backend/tests/integration/chat-intent-focus.spec.ts` 新增快照（`tests/integration/__snapshots__/`）：剔除时间戳 / 自增号 / 耗时与七个新字段后，留档与聚焦提示必须与 016~019 时期逐字一致。

### 实施中修正的存量问题（非本特性引入）

- `agent-backend/tests/unit/file-access.spec.ts`：ADS 用例的夹具在 `临时空间` 预置了 `说明.txt`，却断言该目录为空数组——该用例在任何一次运行都会失败（与冒号文件名拒绝逻辑无关）。已按夹具事实改为断言"目录里只有 `说明.txt`（即没有新增落盘）"。
- `admin-frontend/src/components/agents/SoulEditor.spec.ts`：013 的一条用例断言的界面文案（"只有关联了本体技能才生效"）与组件现有文案（"有本体技能时阶数配置才生效！"）不一致；已把断言对齐到现有文案（组件文案未改）。