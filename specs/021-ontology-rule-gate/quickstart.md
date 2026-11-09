# 快速验证：本体行为规则闸门

- **特性**：`021-ontology-rule-gate`
- **日期**：2026-11-09
- **目的**：用可复现的步骤证明"前置规则能挡住未校验的调用、能放行合规调用、后置提示能驱动推导"。
- **前置**：Node ≥ 20；在仓库根执行；测试**只在宿主机本地跑**（宪章原则三，容器不承担测试）。

---

## 0. 单命令门禁（本地）

```bash
cd agent-backend
npm run gate        # typecheck → lint → test:coverage → build
```

前端（本特性只改一条错误码文案）：

```bash
cd frontend
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

**通过判据**：两条命令均以退出码 0 结束；新增模块语句覆盖率 ≥ 80%；无新增依赖（`package.json` 不变）。

---

## 1. 单测矩阵（最快、无需任何外部服务）

```bash
cd agent-backend
npx vitest run tests/unit/rule-gate-design.spec.ts tests/unit/rule-gate-operators.spec.ts \
  tests/unit/rule-gate-field-path.spec.ts tests/unit/rule-gate-evaluate.spec.ts \
  tests/unit/rule-gate-record.spec.ts tests/unit/rule-gate-catalog.spec.ts \
  tests/unit/rule-gate-gate.spec.ts tests/unit/rule-gate-format.spec.ts \
  tests/unit/tool-rule-gate.spec.ts tests/unit/rule-gate-loop.spec.ts \
  tests/unit/ontology-doc.spec.ts
```

**必须全绿的关键断言**（对应 `data-model.md` §8 的 16 行矩阵）：

| 断言 | 说明 |
|---|---|
| 缺函数 → `pause` 且**原 `execute` 零调用** | 行为不执行、无副作用 |
| 缺 2 条规则的函数 → 反馈**两条**规则全文 | 一次补齐 |
| 求值 `false` → `deny` + 挂起状态置位 + 卡片含结论/明细/终局指令 | 软收尾（不产生 error 轮） |
| 无 `rule_design` 的前置规则 → 放行 + 告警 | 存量数据兼容 |
| `design` 结构非法 → `deny` + `rule_gate.unavailable` | fail-closed |
| 函数成功 → 记录 1 条；失败 → 不记录、不覆盖 | 只记成功 |
| 后置规则 → 原文逐字保留 + 追加块；失败 → 不追加 | 只追加、不改写 |
| 内置工具 / 非本体工具 → 零变化（含"内置与函数同名 → 内置优先"） | `SC-006` |
| 暂停后记录仍在、补调即放行；拒绝后其余工具零执行 → 模型总结后 `done`；固执重试兜底只触发 1 次 | `FR-008` / `FR-032` / `FR-045`~`FR-047` |
| 每条日志含 `ts`；`denyDetails` 3~6 条且含 `fail_message` | `FR-035` / `SC-005` |

---

## 2. 端到端：一次"先暂停、后放行"的完整一轮（进程内）

真实模型不可控，改用 `agent-loop` + 假 `streamFn`（与 020 的 `scope-guard-loop.spec.ts` 同法）：

```bash
cd agent-backend
npx vitest run tests/unit/rule-gate-loop.spec.ts
```

**期望的事件序列**（假模型两跳）：

```
tool_call_start(CreatePurchaseRecord)
tool_call_end(status=error)          ← 暂停：缺 4 个函数
tool_call_start(checkRawMaterialUnit) … ×N   ← 模型补调（假模型脚本化）
tool_call_end(success)                ← 记录入库
tool_call_start(CreatePurchaseRecord)
tool_call_end(success)                ← 第二次：规则通过
done
```

**另一条用例（拒绝）**：

```
tool_call_start(CreatePurchaseRecord)
tool_call_end(status=error)           ← 拒绝（返回失败结果）
error(code=ONTOLOGY_RULE_DENIED)      ← 本轮中止，details 含规则名与 fail_message
（无 done）
```

---

## 3. 手工联调：在真实数字人上验证（需要一套已部署的本体）

前提：`agent-backend` 已启动，数字人目录下存在
`.opt-agent/users/{用户}/agents/{数字人}/ontology/{场景}/{本体}/ontology.yaml`，
且其中 `rules[]` 至少有一条 `position: 前置` 的规则（形如 `V01_UnitConsistency_Purchase`）。

```bash
cd agent-backend
npm run dev
```

| 场景 | 操作 | 期望 |
|---|---|---|
| A 暂停 | 直接要求"创建采购单"（不提校验） | 该工具卡片**失败态**；展开可见缺失函数清单与规则全文；本轮不中断；业务数据零变化 |
| B 自愈 | 接着让模型"先校验再创建" | 先出现若干成功卡片，随后创建成功；采购单真实落库 |
| C 拒绝+中止 | 让 `checkSupplierExistence` 返回 `pass=false`（用不存在的供应商名） | 创建不执行；本轮以失败态收尾，提示含规则名与「供应商名称不存在，禁止创建采购单」；无新增采购单 |
| D 后置提示 | 创建成功后查看该工具结果末尾 | 多出「后置规则」块（规则名、描述、`related_functions`），并提示继续调用 |
| E 跨轮 | 在**新的一轮**直接"创建采购单" | 重新暂停（上一轮的校验不算数） |
| F 无规则本体 | 换一个 `rules: []` 的数字人，重复 A | 一次直通，无暂停、无追加、日志无 `rule_gate.*` |

**排障命令**（看结构化日志）：

```bash
# 只看规则闸门相关日志（pino 输出为 JSON 行）
npm run dev 2>&1 | grep -E '"event":"rule_gate\.(paused|denied|unavailable|posted)"'
```

期望字段：`user_id` / `agent_name` / `thread_id` / `tool_name` / `behavior` / `rules`；
拒绝场景另有 `failed_conditions`；配置异常场景级别为 `error` 且带 `alert: true`。

---

## 4. 前端：中止原因必须"看得见且看得懂"

```bash
cd frontend
npx vitest run src/utils/error-message.spec.ts
```

**手工**：构造一次规则拒绝（场景 C），刷新页面后：

1. 本轮显示失败提示，文案为**逐条原因**（行为 / 规则名 / 结论 / 未成立条件），而不是
   "请求失败，请稍后重试（ONTOLOGY_RULE_DENIED）"；
2. 刷新后从历史恢复的同一条失败轮文案一致；
3. 其他错误码（如 `LLM_UNAVAILABLE`）文案不变。

---

## 5. 性能口径复现（`SC-004`）

```bash
cd agent-backend
# 用单测里的微基准，或在现有 perf 脚本里加一段（见 tasks.md）
npx vitest run tests/unit/rule-gate-evaluate.spec.ts -t "perf"
```

**约定**（与 `spec.md` 的 `SC-004` 表一致）：5 本体 × 8 行为 × 每行为 2 条前置规则；
每行为串行 50 次、丢弃前 5 次预热，取"有闸门 − 无闸门"的增量 P95。

**通过阈值**：已缓存 **P95 ≤ 5ms**；未缓存首次 **≤ 50ms**。

---

## 6. 部署后非交互冒烟（不替代测试结论）

```bash
# 仓库根
docker compose up -d --build
curl -fsS http://localhost:82/api/health
```

仅确认服务可达与关键接口状态码符合预期；规则判定的正确性结论 MUST 来自上面的本地测试与手验。
