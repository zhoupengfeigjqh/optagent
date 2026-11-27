# 任务清单：多步任务规划与滚动执行（028）

- **规格**：[spec.md](./spec.md)
- **计划**：[plan.md](./plan.md)
- **数据模型**：[data-model.md](./data-model.md)
- **日期**：2026-11-25
- **说明**：`[P]` 表示可与同阶段其他 `[P]` 任务并行。测试任务与实现任务同批交付（宪章原则三：同名同目录 spec）。

---

## Phase 0：前置（已完成）

| 编号 | 任务 | 状态 |
|---|---|---|
| T000 | 全局工具批次串行：`agent-loop.ts` 的 `AgentLoopConfig` 增加 `toolExecution: 'sequential'` | **已完成（2026-11-25）** |
| T000b | 回归：全量单测 102 files / 1479 tests、`tsc --noEmit`、`eslint` | **已完成** |

---

## Phase 1：纯函数基础（`domain/plan`）

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T101 | 定义全部类型与配置常量 | `src/domain/plan/types.ts` | T000 | 导出 `PlanStep` / `PlanState` / `StepStatus` / **data-model §5 全部 16 项常量**（含 `ROLL_MAX_PER_RUN`、`BUILTIN_TOOL_NAMES`——后者 MUST 由 `builtinToolNames()` 生成，不得硬编码）；无运行期逻辑 |
| T101s | 同名 spec（常量边界） | `src/domain/plan/types.spec.ts` | T101 | 断言常量值与 data-model §5 一致；覆盖 `PLAN_MAX_STEPS=3`、`TOTAL_STEPS_MAX=20`、`REPLAN_MAX_PER_RUN=6`、`ROLL_MAX_PER_RUN=无（不设上限）` |
| T102 | 容错解析：LLM 原始文本 → `RawStep[]` | `src/domain/plan/parse.ts` | T101 | 剥离代码块围栏；JSON 非法/非数组/字段缺失分别返回结构化错误；不做推断修补 |
| T102s | 同名 spec | `src/domain/plan/parse.spec.ts` | T102 | 覆盖：合法数组、带围栏、前后空白、非 JSON、对象而非数组、字段缺失；**空数组 `[]` → 返回空 `RawStep[]`（合法，不报错，对应 FR-004a）**；4 步 → 越界标记 |
| T103 | 归一化：完整工具名解析 + `type` 推导 + `dependTools` 推导 + `seqId` 分配 | `src/domain/plan/normalize.ts` | T101 | 复用 `matchKeys` / `normalizeName`；**现场建「归一键 → 原样工具名[]」映射**（`availableNames` 只有归一键、拿不回原名）；`coreAction` MUST 存原样完整名，MUST NOT 存归一键/裸名；0 候选与多候选均返回失败标记；`type` 与 `behaviorIndex` 一致；幂等 |
| T103s | 同名 spec | `src/domain/plan/normalize.spec.ts` | T103 | 覆盖：单服务解析、多服务同名歧义、无匹配、**归一键命中但原样名保大小写**、**归一键误入 `coreAction` 的回归用例**、三种 `type`、`dependTools` 四条规则、`seqId` 跨批连续、两次调用结果相同 |
| T104 | 六条硬校验 C0~C5 | `src/domain/plan/check.ts` | T103 | 纯判定不改数据；多失败项同时返回；每条失败带 `{code, seqId, field, detail}` |
| T104s | 同名 spec | `src/domain/plan/check.spec.ts` | T104 | 覆盖 C0~C5 各自失败与通过；query/function 批内重复通过；command 重复拒绝；步数/字数边界（20/300） |
| T105 | 计划快照渲染 + 原地替换 + 行级截断 | `src/domain/plan/snapshot.ts` | T101 | 1200 字符上限；整行丢弃；标记为 `［执行进度］`；替换而非追加 |
| T105s | 同名 spec | `src/domain/plan/snapshot.spec.ts` | T105 | 覆盖：格式逐字、`doneSummary` 最多 5 条、超限截断不留半行、替换后 messages 长度不增 |
| T106 | 规划专用提示词与输入素材装配 | `src/domain/plan/prompt.ts` | T101 | **六段** system prompt（角色 / 聚焦起点 / 本体关系 / 可用函数 / 命令前置约束 / 输出格式，见 data-model §1.1）；messages 只取最近 3 轮正文、不含 `toolResult`；第 4 段函数清单不带 schema；**不读取技能文件** |
| T106s | 同名 spec | `src/domain/plan/prompt.spec.ts` | T106 | 断言：历史过滤掉 `toolResult`；不足 6 条不补齐；单条 >1500 字截断；**工具清单超 60 项时不截断**（第 4/5 段不设上限，只记 `system_chars`）；重试时追加反馈段；**技能文件内容（含 `##` 章节标题）不出现在任一 prompt 段**；**前置约束段覆盖全部可用 command（含无前置者标「（无）」）且不截断函数列表**；**「以意图聚焦为起点」强指令同时出现在第 1、2 段，且第 2 段标题含「起点」字样** |

---

## Phase 2：状态机与事实索引（Foundational）

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T201 | 三态归类（**新建分类**：现存代码无 `retryable`，须从 `PrepareResult` 五态 + `details.toolError` 派生） | `src/domain/plan/state.ts` | T101 | 判定顺序固定 `isError` → code → message；`pause` 归 `retryable`；`deny`/`fatal`/未注册/abort 归 `failed`；**SDK 错误结果 `details` 恒为 `{}`**，无 code 时默认 `retryable`；仅 message 精确匹配 `Tool <name> not found` 归不计三态 |
| T202 | 完成判定 + 出队推进 + 指纹 + 终止判据 | `src/domain/plan/state.ts` | T201 | 三条件 A/C；`done` 为出队动作；禁止回退；`idleTurns` 用指纹；终止**六类**齐全（① 正常完成不走 `suspendTools`，②~⑤ 超限走软收尾，⑥ 用户中断走 `run.stop()`）；先判 `[]` 再判超限 |
| T202s | 同名 spec（覆盖 T201+T202） | `src/domain/plan/state.spec.ts` | T201, T202 | 覆盖：`pause` 不触发重规划；C 不满足时留驻；连续 3 次 retryable 转 failed；指纹相同时 idleTurns 递增；**总步数 20 / 失败重规划 6** 超限返回终止；**正常滚动不占用 `replanCount`**；`doneSummary` 截取 ≤80 字/条、只保留最近 5 条 |
| T203 | 本体事实索引（概念 → 行为、函数 → 关联概念），带 mtime 缓存 | `src/domain/plan/ontology-facts.ts` | 无 | 复用 `intent-focus` 的 `loadOntologyIndex`（该加载器目前每轮全量读盘，缓存须本任务新增；`ontologyDirSignature` 若不存在同样新增）；签名不变命中缓存；**同名跨本体按名合并**（同名即同一工具/同一功能，不做歧义告警）；**MUST NOT 改用闸门侧 `ontology-doc.ts`**（读不到 `related_concepts`） |
| T203s | 同名 spec | `src/domain/plan/ontology-facts.spec.ts` | T203 | 覆盖：缓存命中/失效、跨本体同名、无概念行为返回空 |
| T204 | 规则闸门只读查询端口：按归一裸名返回 `opType` 与前置 `relatedFunctions`（同名跨本体已合并，无需本体维度入参） | `src/domain/rule-gate/`（端口扩展） | 无 | 现状 `RuleGatePort` 只有 `prepare` / `invalidate`，本任务**新增**只读方法（或直接读 `GateSnapshot.behaviorIndex` 的桶：`bucket.pre[].relatedFunctions`）；桶键不含本体维度，**跨本体同名按名合并**（同名即同一工具）；只读、不改判定；spec 覆盖 command/query/未命中/跨本体同名合并 |
| T204s | 同名 spec | `src/domain/rule-gate/*.spec.ts` | T204 | 同 T204；**另加回归断言：新增只读方法前后 `prepare` 的判定结果完全一致**（FR-029「不改规则闸门语义」） |

---

## Phase 3：用户故事 1（P1）— 单步规划与执行

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T301 | 编排器骨架：持有 `PlanState`、调 LLM、暴露四个钩子 | `src/infra/plan-orchestrator.ts` | Phase 1,2 | 规划调用 `tools: []`、`thinking: false`、**20s 硬超时（2026-11-26 由 5s 提高；超时即放弃、不重试）**；**单批重试上限 2 次**（仅限解析/校验失败），第 3 次失败记 `plan.abandoned` 并回退既有流程（NFR-006） |
| T302 | `prepareNextTurn`：切换 `context.tools` + 注入快照 | `src/infra/plan-orchestrator.ts` | T301 | 过滤对象为 `guarded`；集合 = coreAction ∪ dependTools ∪ **全部内置工具（`builtinToolNames()`，当前 7 个）**；快照原地替换；**MUST NOT 硬编码工具名单** |
| T303 | `afterToolCall`：只记录事实 | 同上 | T301 | 累加 `attempts`、置 `coreActionOk`、记录 `lastCoreActionTurn`；不改状态 |
| T304 | `shouldStopAfterTurn`：归类 + 判定 + 推进 | 同上 | T202, T303 | 唯一状态转移点；出队后切换 current |
| T305 | `agent-loop.ts` 透传四个可选钩子 | `src/infra/agent-loop.ts` | 无 | 缺省不挂；不改变既有 `afterToolCall` 语义 |
| T306 | `agent-factory.ts` 装配：开关读取 + 装配后创建编排器 + 钩子下发 | `src/infra/agent-factory.ts` | T301, T305 | `availableNames` 保持全量；装配顺序不变；增量 ≤40 行 |
| T307 | `task_planning` 开关读取（fail-closed） | `src/domain/soul.ts` | 无 | 与 `intent_focus` 同款：`record.task_planning === true` + `readSoulField`；缺键/非布尔即 false；与 `intent_focus` 逻辑与；**MUST NOT 落 `config.ts`**（该文件只承载 env 阈值） |
| T308 | 集成测试：两步计划端到端 | `tests/integration/plan-basic.spec.ts` | T306 | 断言规划在装配后、工具清单等于 `availableNames`、第 1 步不可见第 2 步工具、成功后推进且 `doneSummary` 增长、无弹窗无新 SSE；**每步 `systemPrompt` 引用相等（FR-017 KV-cache）**；**规划失败/超时后回落既有流程且本轮仍可用（FR-005 / NFR-006）** |

---

## Phase 4：用户故事 2（P1）— `pause` 可补调

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T401 | `retryable` 分支与重试上限 | `src/domain/plan/state.ts` | T202 | `pause` 不推进、不重规划；连续 3 次转 `failed` |
| T402 | 集成测试：缺前置函数 → 补调 → 成功 | `tests/integration/plan-pause.spec.ts` | T306, T401 | 桩工具首次返回 `RULE_FUNCTIONS_MISSING_CODE`；断言未触发重规划、`attempts===2`、终态 `done` |
| T403 | 断言 `dependTools` 出现在该步 `context.tools` | 同上 | T302, T402 | 若依赖不在可见集合，用例必须失败（防死锁回归） |

---

## Phase 5：用户故事 3（P2）— 滚动与失败重规划

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T501 | 规划触发条件与输入装配（**滚动 / 失败两类**） | `src/infra/plan-orchestrator.ts` | T301 | 滚动 = 队列耗尽（无失败原因）；失败 = 步骤失败 / 卡死 / 写后失效（带失败原因）；输入为 goal + doneSummary（+ 失败原因）+ 工具清单；不重传历史；事件 `plan.replanned` 带 `kind` |
| T502 | 写后失效风险识别 | `src/domain/plan/state.ts` | T204 | 后续 command 的 `dependTools` 所在函数记录已过期时返回「需重规划」 |
| T503 | 次数上限与降级 | `src/infra/plan-orchestrator.ts` | T501 | **仅失败重规划**达 6 次转软收尾；总步数达 20 转软收尾；正常滚动不计入 6 次 |
| T504 | 集成测试：两个连续 command | `tests/integration/plan-replan.spec.ts` | T501~T503 | 第一批 `[commandA, commandB]`（**两个不同 command**，同 command 会被 C4 拒），第二批 `[function, command]`；断言 `replanCount===1`、`rollCount===0` |
| T505 | 滚动规划：队列耗尽 → 再规划；`[]` = 完成 | `src/infra/plan-orchestrator.ts` | T501 | `rollCount` 与 `replanCount` **分开计数**（前者不设独立上限，只受总步数 20 约束）；滚动输入含 `doneSummary` + 工具清单；返回 `[]` → `plan.finished(completed)`，MUST NOT 计入任何超限；首次规划返回 `[]` → 结束规划、交回主对话 |
| T505s | 编排层 spec（桩 LLM + 桩工具） | `src/infra/plan-orchestrator.spec.ts` | T505 | 覆盖：滚动返回 1~3 步入队、返回 `[]` 完成、首轮 `[]` 交主对话、滚动 10 次不被判超限、失败重规划 6 次被终止；纯函数侧的计数与终止断言留在 `state.spec.ts`（T202s），**MUST NOT 跨目录写 spec** |

---

## Phase 6：用户故事 4（P2）— 卡死与预算兜底

| 编号 | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T601 | `getFollowUpMessages`：计划未完成时续跑 | `src/infra/plan-orchestrator.ts` | T304 | 有次数上限；超限不无限注入 |
| T602 | 终止路径分工 | 同上 | T303 | **②~⑤** 超限走 `suspendTools`；**① 正常完成直接收尾、MUST NOT `suspendTools`**；⑥ 用户中断走 `run.stop()`；全程不使用 `abortRunFatal` |
| T603 | 集成测试：模型空转 | `tests/integration/plan-stall.spec.ts` | T601, T602 | 断言 `idleTurns` 达 2 触发**失败重规划**（`replanCount+=1`，`rollCount` 不变）；超限后软收尾且本轮正常 `done` |

---

## Phase 7：管理端开关与观测

| 编号 | 任务 | 侧 | 验收 |
|---|---|---|---|
| T701 | SOUL 读写支持 `task_planning`（缺省 false，读写归一） | `admin-backend` | 与 `input_rewrite` 同模式；存量无值即 false |
| T701s | 同名 spec | `admin-backend` | 读写往返、缺键降级 |
| T702 | 设计器新增复选框「任务规划」+ 固定说明 | `admin-frontend` | 位于**意图聚焦配置区**；`intent_focus` 关闭时置灰但保留已选值；**未勾选即该数字人零规划调用**（与 FR-001 一致） |
| T702s | `SoulEditor.spec.ts` | `admin-frontend` | 键盘可达、读屏文案、置灰语义、开关往返 |
| T703 | 观测事件落地（**13 个事件**，以 data-model §10 表为准） | `agent-backend` | 字段与 data-model §10 一致；不记正文与用户原话；`plan.skipped` 的 reason 含 `switch_off` / `focus_disabled` / `no_tools` / `empty_focus` |
| T703s | 事件断言 spec | `agent-backend` | 每个事件至少一条断言；敏感字段缺失断言 |

---

## Phase 8：验收

| 编号 | 任务 | 验收 |
|---|---|---|
| T801 | `agent-backend` 门禁：`npm run gate`（typecheck → lint → coverage → build） | 全绿；新增模块覆盖率 ≥80% |
| T801a | `admin-backend` / `admin-frontend` 门禁（各自 `npm run lint` / `typecheck` / `test`） | 宪章原则八「四侧对称」：各自单命令可跑；MUST NOT 以“本侧改动小”跳过 |
| T802 | 全量单测 + 集成测试 | 全绿；无新增跳过用例 |
| T803 | 性能实测：首字延迟增量、规划调用耗时、单轮 token | 满足 SC-005；记录口径与结果到 spec |
| T804 | 回归：规划关闭时零差异 | 链路行为、日志、token 与上线前一致（SC-006） |
| T805 | 回归：前端工具卡片（多工具批次） | 串行后事件顺序变化无渲染异常 |
| T806 | 回写规格修订记录（含 P0 串行的前置结论） | `spec.md` 修订记录新增一行 |
| T807 | 抽样回放与统计口径（SC-001 / SC-003 / SC-007） | 回放脚本或 `quickstart.md` 记录；若本期不做回放，MUST 在 `spec.md` 登记为「上线后观测」而非验收项 |

---

## Phase 9：计划进度可见性（方案 B，`spec.md` v0.12 / FR-034、FR-035）

> 用户 2026-11-25 确认要做。**纯展示增量**：不动规划、不动执行、不改闸门；唯一新增对外契约是 1 个 SSE 事件。
> 原型见 `demos/plan-progress-demo.html`（已确认交互形态）。

| 编号 | 任务 | 负责侧 | 验收 / 约束 |
|---|---|---|---|
| T901 | 编排器 emit `plan_progress`：三处（①`enqueue()` 与 `shouldStopAfterTurn` 完成分支；②`replanAfterFailure()` / `roll()` 装批后；③`terminate()`） | `agent-backend` | 字段仅 `{ seqId, label, phase }`，`phase ∈ {running, replanned, done}`；MUST NOT 带计划正文、失败原因、工具结果；发出点 MUST 与 `refreshVisible()` 同点，避免"进度条跳了但工具集没切" |
| T901s | 事件断言（扩展 `plan-events.spec.ts`） | `agent-backend` | 三处各 1 条断言；重规划时 `phase=replanned` 且 `seqId` 跟随新批；`terminate` 只发 1 次 `done` |
| T902 | SSE 契约：`src/types.ts` 增事件类型 + `run-consume` 转发 | `agent-backend` | 复用既有 SSE 通道与断线处理；MUST NOT 新增 HTTP 端点（FR-030）；事件频率 = 步数，与 `tool_call_*` 同量级 |
| T902s | 集成断言（扩展 `plan-basic.spec.ts`） | `agent-backend` | 两批执行内收到的 `plan_progress` 次数 = 步数 + 2（装批 + done）；末次必为 `done`；中途不断连 |
| T903 | `PlanProgressBar.vue` + `useChatStream` 接入 | `frontend` | 单行「第 N 步 · 步骤名」；`role="status"` + `aria-live="polite"`；结束淡出但保留占位不抖动正文；MUST NOT 渲染步骤列表、MUST NOT 写对话历史 |
| T903s | `PlanProgressBar.spec.ts` | `frontend` | 文案、读屏属性、`replanned` 跳变、`done` 淡出、无 progress 时不渲染 |
| T904 | 文案口径定稿（FR-035 待确认项） | 产品 + `frontend` | 二选一：**默认不带总步数**；若要求带总数，必须同时实现跳变闪示且禁用百分比。结论回写 `spec.md` |
| T905 | 四侧门禁 + 回写修订记录 | 全部 | `agent-backend` gate 全绿；`frontend` 全量测试绿；既有 `tool_call_*` 顺序断言不受影响 |

---

## 依赖图

```
T000（已完成）
  └─ Phase 1（T101→T102/T103→T104，T105/T106 可并行）
       └─ Phase 2（T201→T202；T203/T204 可并行）
            ├─ Phase 3（T301→T302/T303→T304；T305/T307 可并行）→ T306（依赖 T301+T305+T307）→ T308
            │    ├─ Phase 4（T401→T402/T403）
            │    ├─ Phase 5（T501/T502→T503→T504）
            │    └─ Phase 6（T601/T602→T603）
            └─ Phase 7（T701/T702/T703 可并行）
                 └─ Phase 8（全部验收）
                      └─ Phase 9（T901/T902 后端可并行 → T903 前端 → T904 → T905）
                           ※ 与 P4/P5 相互独立；T904 未定稿时 T903 按「不带总步数」先行
```

## 实施状态（2026-11-25）

> 与上表逐条对应；`[x]` 已交付并跑过验证，`[~]` 有等价覆盖但未按原任务形态交付，`[ ]` 未做。

### Phase 1（纯函数，全部完成）

- [x] T101 / T101s（`types.ts` + `plan-types.spec.ts`）
- [x] T102 / T102s（`parse.ts` + `plan-parse.spec.ts`）
- [x] T103 / T103s（`normalize.ts` + `plan-normalize.spec.ts`）
- [x] T104 / T104s（`check.ts` + `plan-check.spec.ts`）
- [x] T105 / T105s（`snapshot.ts` + `plan-snapshot.spec.ts`，7 例，含 `applySnapshotMessage` 原地替换）
- [x] T106 / T106s（`prompt.ts` + `plan-prompt.spec.ts`，9 例）
- [x] 额外：`batch.ts` + `plan-batch.spec.ts`（7 例，从编排器抽出的纯函数，保证单文件 ≤500 行）

### Phase 2（状态机与事实索引）

- [x] T201 / T202 / T202s（`state.ts` + `plan-state.spec.ts`）
- [x] T203（`ontology-facts.ts`，含 `getIndex()` 共享缓存）+ T203s（`plan-ontology-facts.spec.ts`，7 例）
- [x] T204（`RuleGatePort.lookupBehavior`）+ T204s（`rule-gate-gate.spec.ts` 新增 5 例，含「调用前后 `prepare` 结果一致」回归）

### Phase 3（单步规划与执行）

- [x] T301~T304（`infra/plan-orchestrator.ts`：`begin` / 四个钩子 / 单批重试 2 次 / 20s 超时且超时不重试）
- [x] T305（`agent-loop.ts` 透传 `prepareNextTurn` / `shouldStopAfterTurn` / `getFollowUpMessages` / `afterToolCall`，缺省不挂；`agent-loop-hooks.spec.ts` 5 例锁死「钩子真的改到下一跳」与「不传 hooks 零调用」）
- [x] T306（`agent-factory.ts` 装配后挂载；`availableNames` 与工具装配顺序未变；增量 59 行）
- [x] T307（`domain/soul.ts` 新增 `taskPlanning` + `isTaskPlanningEnabled`，与 `intentFocus` 逻辑与）
- [x] T308（`tests/integration/plan-basic.spec.ts` 2 例：真实 pi loop + 真实闸门 + 真实编排器，逐步收窄 / 两步完成 / 滚动 `[]` 收尾 / 不挂起；首轮 `[]` 时编排器不接管 loop）
- [x] T305 补（2026-11-26，缺陷修复）：`agent-loop.ts` 新增**仅用于展示名索引**的 `labelTools`（缺省回退 `tools`），建表来源从「每步收窄后的可见集」改为「全量装配集」。原实现下第 2 步起新出现的工具查不到 label，`tool_call_start` 不带该字段，前端回退显示 `server__tool` 调用名（如 `onto_behaviors_QueryInventory`）。`agent-factory.ts` 传 `guarded`；`agent-loop-label.spec.ts` 3 例（次步工具仍带人读名 / 缺省回退 / 非空才写）。不影响工具可见性、越界拒绝、HITL 与 SSE 契约。

### Phase 4~6（暂停 / 滚动 / 卡死）

- [x] T401（连续 3 次 retryable 转 failed，`plan-state.spec.ts` 覆盖）
- [x] T402 / T403（`tests/integration/plan-pause.spec.ts`：首次暂停不重规划、`attempts=2`、补调依赖后重试成功；依赖函数调用成功即为「在可见集内」的证据）
- [x] T501（滚动 / 失败两类输入装配，失败原因进角色消息、不重传历史）
- [x] T502（写后失效：`state.ts` 推进点用 `isStale` 探测 `dependTools`，命中则不标 failed 而是 `needsReplan` + `staleStep`；`plan-state.spec.ts` 4 例、`plan-orchestrator.spec.ts` 2 例、`plan-replan.spec.ts` 端到端）
- [x] T503（失败重规划 6 次 / 总步数 20 转软收尾；滚动不占 `replanCount`）
- [x] T504（`tests/integration/plan-replan.spec.ts`：两个不同 command → commandA 写后失效 → 第二批 `[function, command]`；断言 `replanCount=1` 且**重规划时** `rollCount=0`）
- [x] T505 + T505s（`plan-orchestrator.spec.ts` 13 例：滚动 1~3 步 / `[]` 完成 / 首轮 `[]` 交主对话 / 失败重规划上限 / 卡死转重规划 / 快照原地替换 / `getFollowUpMessages` 上限 / 写后失效）
- [x] T601 / T602（`getFollowUpMessages` 续跑有上限；①②正常完成不挂起、②~⑤ 超限 `suspendTools`、不使用 `abortRunFatal`）
- [x] T603（`tests/integration/plan-stall.spec.ts` 2 例：连续 2 turn 无进展 → `step.stalled` → 失败重规划；6 次用尽 → 软收尾 `stalled` 且本轮仍正常 `done`、无 error 事件）

### Phase 7（管理端与观测）

- [x] T701 + T701s（`admin-backend` `soul-design.ts`：缺省 false / 非布尔拒绝 / 仅 AND 为真写键；`soul-design-task-planning.spec.ts` 8 例）
- [x] T702 + T702s（`admin-frontend` 设计器意图聚焦区新增「任务规划」复选框 + 固定说明；`SoulEditor.spec.ts` 新增 4 例，含置灰语义与键盘可达）
- [x] T703（13 个事件全部落地在编排器：`plan.skipped` / `requested` / `parsed` / `rejected` / `abandoned` / `started` / `step.out_of_focus` / `step.started` / `step.done` / `step.failed` / `step.stalled` / `replanned` / `finished`）
- [x] T703s（`tests/unit/plan-events.spec.ts` 3 例：13 个事件在各自真实路径上逐个发出 / 事件不含用户原话与工具结果正文 / `skipped` 的 `no_tools` 与 `empty_focus`）

### Phase 8（验收）

- [x] T801（`agent-backend`：`npm run gate` 全绿——`tsc --noEmit` / `eslint` / 覆盖率门禁通过；146 files · 1887 tests，All files 87.53% stmts / 80.45% branch / 89.70% lines）
- [x] T801a（两侧 `tsc` 通过；`admin-backend` 58 files / 725 tests、`admin-frontend` 57 files / 687 tests 全绿。顺带修掉一条与 028 无关的**存量**红：`SoulEditor.spec.ts > 007 界面说明…` 断言的 `next-action-hints-hint` 在 2026-11-20 合并四个开关时已随模板移除，改为断言组头 `intent-focus-group-hint` + 条数说明同源 + 关闭置灰）
- [x] T802（`npm run gate` 内含全量单测 + 集成，146 files / 1887 tests 全绿；新增用例无一 `skip`）
- [x] T804（关闭零差异：`agent-loop-hooks.spec.ts` 断言不传 `hooks` 时四钩子零调用、工具集原样进入 loop；`soul-task-planning.spec.ts` 6 例锁死「未勾选 / 聚焦关闭 / 缺键 / 读盘失败一律不规划」，即关闭态不构造编排器、不产生额外模型往返）
- [x] T805（串行化只改执行顺序，事件序列与字段不变；`ToolCallList.spec.ts` 新增「多工具批次串行到达」2 例：顺序/终态/计数/报错数）
- [x] T806（`spec.md` 修订记录新增 v0.10、v0.11）
- [ ] T803（P90 规划延迟实测）/ T807（抽样回放）：需要真实模型与历史会话样本，本期不做——**硬超时（20s 到点即返回，含 provider 不响应 abort 的兜底）已由 `plan-llm.spec.ts` 钉死**，剩下的是延迟分布统计，登记为「上线后观测」

### Phase 9（计划进度，方案 B —— 已交付 2026-11-26）

- [x] T901 / T901s（编排器三处 emit：`enqueue` 装批与步推进 / 重规划装批 `replanned` / `terminate` `done`；`plan-progress.spec.ts` 4 例覆盖三态顺序、重规划跳变、空轮零发、字段收敛）
- [x] T902 / T902s（`run-events.ts` 新增 SSE 类型 + `run-consume.ts` 只转发不留痕；`agent-loop.ts` 接收 begin 期间积压与实时回调，`agent-factory.ts` 接线）
- [x] T903 / T903s（`PlanProgressBar.vue` + 6 例：单行文案 / `role="status"` / 展开只列已见步 / 重规划闪示 / 结束淡出 / 空态不渲染；`useChatStream.plan-progress.spec.ts` 4 例）
- [x] T904（文案口径：`第 N 步 · 步名`，默认不带总步数；展开按钮只显示"已出现 N 步"）
- [x] T905（门禁：`agent-backend` 全量单测 **1674** + typecheck + lint 0；`frontend` 全量单测 **1494** + typecheck + lint 0；`spec.md` 修订记录 v0.17）
- 行数复核：`plan-orchestrator.ts` **580** / `agent-factory.ts` **525** 均为存量超限（本次各 +15 行，按 `plan.md` 复杂度跟踪「不拆分存量」执行）；`agent-loop.ts` 228、`useChatStream.ts` 471、`ChatPanel.vue` 447、`PlanProgressBar.vue` 258，均 ≤500

### Phase 10（规划门禁，FR-037 —— 已交付 2026-11-26）

- [x] T1001（`intent_focus.plan_threshold` / `plan_timeout_ms` 解析与校验：缺键=关闭、越界拒绝启动、`INTENT_FOCUS_PLAN_THRESHOLD` 覆盖；`config.example.yaml` 同步）
- [x] T1002（`domain/intent-focus/plan-gate.ts`：题面 + `judgePlanGate` + `planGateBlocks`；`plan-gate.spec.ts` 7 例）
- [x] T1003（`runner.ts`：开规划才判定、用剩余预算单独判一次、失败 fail-open；`plan_score` / `plan_round_ms` 落 `intent-focus.jsonl`；`intent-focus-runner.spec.ts` +4 例）
- [x] T1004（链路：`run-consume` → `AgentRunRequest.planScore` → `agent-factory` 分流 + `plan.skipped(below_threshold)`；`server-attachments` 注入 `isTaskPlanning`；`server.ts` 注入阈值）
- [x] T1005（规格与契约：`spec.md` FR-037 + v0.18；`contracts/README.md` §1.2；门禁：`agent-backend` typecheck / lint 0 / **124 files / 1690 tests**）
- 配置收敛（2026-11-26，v0.21，批次 2~4）：删除 5 个 `INTENT_FOCUS_*_THRESHOLD` env；`MCP_TIMEOUT_MS`/`MCP_CONNECT_TIMEOUT_MS`/`LLM_MAX_RETRIES`/`LLM_RETRY_MAX_DELAY_MS` 迁入 yaml `runtime` 块；`UPLOAD_MAX_MB`/`PREVIEW_MAX_MB`/`READ_TRUNCATE_KB` 降为 `domain/limits.ts` 常量；新增 yaml `plan` 块三项并注入编排器（`PlanLimits` / `DEFAULT_PLAN_LIMITS` / `advanceBatch.limits`）；启动打 `config.effective` 与 `config.unknown_env`；`config.spec.ts` **43 例**、后端 **124 files / 1694 tests** 全绿
- 配置分层（2026-11-26，v0.20，批次 1）：`intent_focus.base_url` 支持 `$VAR`（`config.yaml` → `$INTENT_FOCUS_BASE_URL`，本地 `127.0.0.1:8103` / 容器 `laya:8000`）；compose `backend` 去掉 `environment` 覆盖、`env_file` 只留 `.env`；`.env` 转私产（`git rm --cached`）并恢复 `.env.example`；`DECIS_API_KEY` 进 `envSchema`；`config.spec.ts` 40 例全绿
- 口径调整（2026-11-26，v0.19）：`agent-backend/config.yaml` 补 `plan_threshold: 0.4`（此前缺键 = 门禁关闭，配置写了却不生效）；`plan_timeout_ms` 缺省由 2000 提到 **5000**（冷启动首包常超 2s，2s 会被打成超时后 fail-open），`config.example.yaml` 同步；`config.spec.ts` 缺省断言同步，门禁三份 spec **77 passed**
- 决策追加（2026-11-27，v0.22）：规划资格收紧——`IntentFocusResult.hasCapability`（只认**直接命中**的本体行为/函数，上/下游发散不算起点）、`plan-gate.ts` 新增 `planCapabilityBlocks`、`AgentRunRequest.planEligible`、`agent-factory` 新增 `plan.skipped(no_focus_capability)` 分流；无能力时 `runner` 连门禁判定也不发起；测试 `plan-gate.spec` +2 例、`intent-focus-runner.spec` +2 例
- 决策追加（2026-11-28，v0.23）：提示词「段 1 三条硬要求」（聚焦优先 / `coreAction` 必须在工具清单 / 不得绕开清单）+「段 6 单对象单步（即使动作相同也拆步）」；门禁口径由"批量查询算一个任务"翻转为"多对象即多步"；测试 `plan-gate.spec` +1 例、`plan-prompt.spec` +2 例
- 存量清理（2026-11-28）：删除 `plan-gate.ts` 孤立导出 `judgePlanGate`（生产零引用、与 runner 私有方法同名异义），runner 私有方法改名 `judgePlanGateScore` 消歧；`plan-gate.spec.ts` 删 3 例、现 7 例
- 行数复核：`runner.ts` **801**、`plan-orchestrator.ts` **580**、`agent-factory.ts` **543**、`config.ts` **524** 均为存量超限（`runner.ts` HEAD 即 757、`config.ts` HEAD 593，本次只加门禁判定与配置解析；按 `plan.md` 复杂度跟踪「不拆分存量」执行，判定逻辑本身抽到 `plan-gate.ts` **50** 行）；`run-consume.ts` 310、`server.ts` 447、`server-attachments.ts` 98，均 ≤500

## 规模估算

| 阶段 | 新增/改动文件 | 预计增量行 |
|---|---|---|
| Phase 1 | 7 实现 + 7 spec | ~1100 |
| Phase 2 | 2 实现 + 2 spec + 1 端口 | ~500 |
| Phase 3 | 1 编排 + 3 改动 + 1 集成 | ~900 |
| Phase 4 | 1 改动 + 1 集成 | ~150 |
| Phase 5 | 2 改动 + 1 集成 | ~350 |
| Phase 6 | 1 改动 + 1 集成 | ~200 |
| Phase 7 | 4 文件 + 3 spec | ~400 |
| **合计** | 约 28 个文件 | **≈ 3600 行**（含测试） |
