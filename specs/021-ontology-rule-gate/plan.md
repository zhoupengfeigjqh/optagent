# 实施计划：本体行为规则闸门（前置规则判定与后置规则提示）

- **分支**：`021-ontology-rule-gate`
- **日期**：2026-11-09
- **规格**：[spec.md](./spec.md)
- **输入**：`specs/021-ontology-rule-gate/spec.md`
- **说明**：技术栈完全沿用现状（TypeScript 6 / Node ≥ 20 / Fastify 5 / Vitest 5 / `yaml`），
  **不新增依赖、不新增端点、不新增 SSE 事件类型**。
  本计划的重点不是"加一段判断"，而是**把规则体系做成可独立演进、可独立测试的纯领域包**：
  解析（`rule_design` → 结构）、求值（记录 + 结构 → `true/false`）、闸门（前置/后置）、
  记录（轮内函数结果）四件事各自一个文件，包装器与装配层只做接线。

## 摘要

在 020 权限闸门**通过之后**、本体行为**真正执行之前**，插入一次**完全确定性的规则判定**
（硬编码解析 `rule_design`，绝不交给 LLM）：

1. **轮内函数记录**：每轮对话新建一份 `函数名 → 最后一次调用的结果` 的内存映射；
   只记"函数"（非内置工具、非本体行为），**成败都记**（失败/无结果记 `null`），同名**最后一次覆盖**、轮末丢弃。
   键存在 = 本轮已执行过；未真正发出的调用（被权限拒绝 / 被暂停 / 未执行）不写。
2. **前置闸门**：读该行为所属本体 `ontology.yaml` 的 `rules`（`position: 前置`），顺序固定为
   「缺函数 → **注册校验** → 暂停/阻断 → 求值」：
   ① `related_functions` 未全部记录 → 先查这些函数是否**已注册**（本轮挂载给模型的工具集合）；
   全部已注册 → **暂停**（不执行；规则全文 + 缺失函数清单返回模型，本轮继续）；
   任一未注册 → **阻断**（不执行、直接中止整轮，`reason=unregistered`）；
   ② 齐备 → 用记录对 `rule_design` 做**两级 AND/OR** 机械求值；
   ③ `true` → 执行；`false` → 拒绝并**中止整轮**（失败轮留痕 + 逐条原因）。
3. **后置提示**：行为执行**成功之后**，先对 `position: 后置` 规则的 `related_functions` 做**注册校验**：
   全部已注册 → 把规则全文附着在结果后面，提示模型继续推导；任一未注册 → **不追加**、中止整轮，
   文案声明"该行为已执行成功、业务数据已写入"（`reason=unregistered`）。

**解耦形态**（本次硬约束）：

```
domain/rule-gate/**       纯领域包（解析 / 求值 / 目录 / 文案 / 端口），零 IO、零依赖、零 LLM
domain/ontology-doc.ts    ontology.yaml 的统一解析与名称归一（020 与 021 共用，唯一来源）
infra/tool-rule-gate.ts   唯一的 AgentTool 包装器（~130 行，只认端口）
domain/run-consume.ts     中止接线（3 行）
infra/agent-factory.ts    装配（4 行）
frontend/utils/error-message.ts  一条错误码映射 + 受控 details 透传
```

## 技术上下文

**Language/Version**：TypeScript 6 / Node.js ≥ 20，ESM（`agent-backend/package.json`）。

**Primary Dependencies**：
- `yaml` 2.9（解析 `ontology.yaml`，**已存在，不新增依赖**）
- `@earendil-works/pi-agent-core`（仅 `infra/tool-rule-gate.ts` 引用 `AgentTool` 类型；`domain/` 不引用）
- 复用 `domain/tool-error.ts` 的失败标记通道（020 与 HITL 已在用）
- 复用 020 的 `domain/ontology-files.ts`（目录枚举 + 安全 YAML 读取）
- **不引入** JSONPath / JSON Schema / 表达式求值库（见 `research.md` D3、D6）
- **不新增**"函数注册表"：注册判据直接复用装配层已有的 `availableTools` 名字集合（`research.md` D15）

**Storage**：只读（无新增存储、无迁移、无写回）
- `{agentDir}/ontology/{场景}/{本体}/ontology.yaml`：`behaviors[]`（识别）、`rules[]`（判定）、
  `functions[].response`（字段类型强制）
- 轮内函数记录：**纯内存**，轮结束即丢，不落盘、不进历史

**Testing**：Vitest 5；`npm run gate`（typecheck → lint → test:coverage → build）；
不依赖真实 MCP 服务与真实 LLM（进程内假 `streamFn` 驱动 loop）。

**Target Platform**：Linux 容器（部署）/ Windows 本地开发（中文路径）。路径一律 `node:path`；
目录枚举与 YAML 读取沿用 `ontology-files.ts` 的"真实目录 + 拒绝符号链接"口径。

**Project Type**：Web 服务（后端为主）。受影响侧：`agent-backend`（主要落点）+ `frontend`（一条
错误码文案映射）。`admin-backend` / `admin-frontend` **零改动**（`rules` 现状已整包下发、平台不解析）。

**Performance Goals**（`SC-004`）：
- 规则判定对单次行为调用的**额外耗时**：已缓存 **P95 ≤ 5ms**、未缓存首次 **≤ 50ms**；
- 稳态每次判定 = 1 次 `statSync`（目录签名）+ 纯内存求值（条件数 ≤ 25）；
- 不改变工具本身时延，不引入网络或数据库访问。

**Constraints**：
- 零新增依赖；零新增端点、SSE 事件类型、请求字段；`package.json` 不变；
- 单文件 ≤ 500 行；新增模块语句覆盖率 ≥ 80%；
- `domain/rule-gate/**` MUST NOT import：`../infra/**`、`./scope-guard/**`、`./intent-focus/**`、
  `./mcp/**`、`@earendil-works/**`、`fastify`、`pino`、`node:fs`；
- 求值 MUST 是纯函数：不读时钟、不读环境、不发网络、**不调用 LLM**；
- `prepare` / `postHint` / `record.add` **永不抛错**（坏数据一律收敛为 `deny`/`unavailable` + 告警）。

**Scale/Scope**：
- 单数字人本体数通常 1~5；单本体行为 8~60、规则 4~20、函数 5~20；
- 单轮工具调用 1~10 次（含并行批次）；单轮记录条目 ≤64（超限丢弃 + 告警）。

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项必须在「复杂度跟踪」中说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文与规格驱动 | 通过 | 规格/计划/研究/数据模型/契约/快速验证全中文；实现期如出现口径变化回写 `spec.md` 修订记录 |
| 二、代码质量与模块化 | 通过 | `rule-gate/**` 9 个文件，各自 < 200 行；"什么算一个本体行为"与名称归一收敛到 `ontology-doc.ts`（唯一来源）；包装器只做接线 |
| 三、测试完备性 | 通过 | 新增模块全部同名同目录单测（7 个领域含 `format` + 1 个包装器 + 1 个 loop 端到端 + 1 个解析）；前端 `error-message.spec.ts` 补用例；**无真实 MCP 端到端自动化**（仓库无 MCP 桩），以 `quickstart.md` 手验补位并在此登记 |
| 四、无障碍 | 不适用（有约束） | 无 UI 变更；暂停复用既有工具失败卡片，失败提示复用 `ErrorNotice`，不新增仅靠颜色传达的信息 |
| 五、性能与一致性 | 通过 | `SC-004` 增量 ≤5ms（缓存）/ ≤50ms（首次）；单次判定一次 `stat`；记录为内存原子覆盖（无部分提交） |
| 六、依赖治理 | 通过 | 零新增依赖；`package.json` 不变；不引入 JSONPath / JSON Schema / 求值库（D3） |
| 七、接口契约两侧同改 | 通过 | 无端点/事件变更；`error` 对象新增可选 `details` → 同一次改动里更新：`contracts/rule-gate.md`、`runtime-api-delta.md` R28、`types.ts`、前端 `error-message.ts` 与其单测 |
| 八、测试部署简单可控 | 通过 | 复用 `agent-backend` 单命令门禁 `npm run gate`；部署路径不变，冒烟沿用既有 `scripts/smoke.ts` |
| 九、优雅降级与可观测 | 通过 | 暂停/拒绝用户可感知（卡片 + 逐条原因）；规则不可用 error 级告警；求值异常不抛穿；无重试放大（不自动重试被拒调用） |

**Phase 1 后复核**：设计未引入新依赖、未新增公开 API、未改变工具清单与权限模型；
`rule-gate` 的依赖方向仍单向（→ `ontology-doc` → `ontology-files`）；仍通过。

## 解耦设计（本次核心约束）

### 依赖方向（只允许向下）

```text
agent-factory.ts（装配，4 行）
    ├──► infra/tool-rule-gate.ts（唯一包装器）
    │        ├─ 依赖：AgentTool 类型、RuleGatePort、FunctionRecord、tool-error
    │        └──► domain/rule-gate/index.ts（端口与决策）
    └──► domain/rule-gate/index.ts（工厂）
             ├─ types.ts        端口 / 规则 / 设计 / 结果类型（无逻辑）
             ├─ design.ts       rule_design 解析与归一（纯函数）
             ├─ field-path.ts   field 路径语法（含 []）与读取（纯函数）
             ├─ operators.ts    16 算子 + 类型强制 + 比较（纯函数）
             ├─ evaluate.ts     两级 AND/OR 合成 + 失败条件收集（纯函数）
             ├─ catalog.ts      规则/函数声明/行为索引 + 签名缓存（只读 IO）
             ├─ format.ts       中文文案与"规则全文"块的唯一来源
             └─ record.ts       轮内函数记录（纯内存）
                      │
                      └──► domain/ontology-doc.ts ──► domain/ontology-files.ts（既有）
```

- **反向依赖为 0**：`rule-gate` 不知道工具从哪来、不知道 MCP、不知道 HITL、不知道权限闸门、
  不知道 Fastify；
- **横向依赖为 0**：`rule-gate` 不 import `scope-guard`（"行为识别"由两者共用 `ontology-doc` 的实现，
  而不是互相引用）；
- **旁路依赖为 0**：包装器只有 `agent-factory` 一个装配点；删除本特性 = 回退 4 行装配 +
  `run-consume`/`run-impl` 各 1~3 行 + 删除两个新目录；
- **测试可注入**：包装器只依赖端口接口，测试用假实现即可覆盖四种结局，不需要构造真实本体目录。

### 公共接口（唯一导出面 `domain/rule-gate/index.ts`）

```ts
export interface RuleGatePort {
  prepare(input: PrepareInput): PrepareResult;        // 永不抛
  postHint(input: PostHintInput): PostHintResult;      // 永不抛
  invalidate(): void;
}

export interface PrepareInput {
  toolName: string;
  record: FunctionRecord;
  available: ReadonlySet<string>;   // 本轮挂载给模型的工具名（已归一）——注册判据
}

export type PrepareResult =
  | { kind: 'function' }                                     // 非本体行为（非内置）→ 执行 + 记录
  | { kind: 'behavior' }                                     // 本体行为，可执行
  | { kind: 'pause'; message: string; details: string[] }     // 缺函数但已注册 → 不执行，本轮继续
  | { kind: 'deny'; message: string; details: string[]
      reason: 'unregistered' | 'condition_false' | 'config_unavailable' };
                                                             // 不执行 + 中止（共用中止码）

export type PostHintResult =
  | null                                                      // 无后置规则
  | { kind: 'append'; text: string; rules: string[] }          // 函数全部已注册 → 追加
  | { kind: 'blocked'; message: string; details: string[]; rules: string[] };
                                                             // 存在未注册 → 不追加 + 中止

export function createFunctionRecord(): FunctionRecord;       // 每轮一个
```

- 工厂入参只有 `{ agentDir, warn? }`，不接收 logger / fastify / MCP / run 状态；
  "本轮可用工具集合"通过 `PrepareInput.available` 传入，**由装配层从最终工具数组生成**，闸门不自建清单；
- `message` 与 `details` 是**唯一**的中文文案来源（包装器不拼字）；
- 规则本体的归一结构（`RuleSpec` / `RuleDesign` / `RuleCondition`）全部从 `index.ts` 出，
  外部（含测试）只经这个面；
- `deny.reason` 与 `postHint.blocked` 是**判定语义的一部分**（不是日志细节）：包装器据此选文案与日志事件。

### 装配点最小改动

| 位置 | 改动 | 行数 |
|---|---|---|
| `agent-factory.create()` | `const ruleGate = createRuleGate({ agentDir, warn })`（与 `scopeGuard` 并列） | +2 |
| `agent-factory.runWith()` | `const record = createFunctionRecord()`（每轮新建）、`builtinNames` 取自 `buildBuiltinTools` 产物、`availableNames` 由最终工具数组经 `normalizeName` 生成 | +3 |
| `agent-factory.runWith()` 装配末尾 | `const ruled = ruleGateTools(tools, { gate, record, builtinNames, availableNames, onDeny: (r) => req.abortRun?.(r), ... })`，随后 `guardTools(ruled, …)` | +3 / 改 2 行 |
| `run-manager.ts` | `AgentRunRequest` 新增可选 `abortRun?` | +6（含注释） |
| `run-consume.ts` | 传入 `abortRun`（写 `run.ruleAbort` + `run.stop()`）；`error` 分支先看 `run.ruleAbort` | +8 / 改 4 行 |
| `run-impl.ts` | 新增 `ruleAbort?: RuleAbortReason` 字段 | +5 |
| `llm-error.ts` | `toHistoryErrorInfo` 透传可选 `details` | +3 |
| `types.ts` | `HistoryErrorInfo.details?: string[]` | +6（含注释） |
| `frontend/utils/error-message.ts` | 新码映射 + `details` 受控透传 | +10 |

**不做的事**（防止耦合回潮）：
- 不在 `mcp-tool-adapter`、`tool-intercept`、`builtin-tools` 里加任何规则判断；
- 不在 `ChatAgent` 接口上新增方法，不把 gate 塞进 `AgentConfigBundle`；
- 不给 `McpManager` / `ScopeGuardPort` 增加规则字段；
- 不新增 SSE 事件类型、不改 `run-events.ts` 的 `SsePayload` 联合；
- 不在 `domain/rule-gate` 里读时钟/环境变量/文件（文件只经 `catalog.ts` → `ontology-doc`）。

### 与既有能力的关系

| 既有能力 | 关系 |
|---|---|
| 020 权限闸门（`tool-scope-guard.ts`） | **在外**：先判权限，通过后才判规则；两者互不引用，只共享 `ontology-doc` 的识别口径 |
| HITL 人工确认（`tool-intercept.ts`） | 规则闸门在权限闸门内侧、HITL 外侧 ⇒ 暂停/拒绝**不会**弹确认框 |
| 工具失败标记（`tool-error.ts`） | **复用**：暂停走同一通道；"是否成功"也用它判定（`details.toolError`） |
| 工具白名单（`mcp-tool-scope.ts`） | 不变，但**成为注册判据的来源**：白名单过滤后的集合就是"已注册"（被过滤掉 = 未注册 → 阻断，`research.md` D15） |
| 意图聚焦（016/019） | 完全独立：不判分、不调 Laya；只共用 `ontology-files` 的目录枚举 |
| 会话历史 / 回灌 | 不变：记录不落盘；后置提示随工具结果落 `tool-events`（模型看到的 == 记录的） |

## Phase 0：研究与决策

- 产出：[research.md](./research.md)
- 已收敛的关键决策（D1~D13）：
  1. **D1** 解析口径：固定两层 AND/OR（根 → 组 → 条件），无 NOT/无嵌套；空 `combine` 按 `and`；
     运行期不因超限拒绝（否决：通用表达式树 / `eval` / LLM 解读）；
  2. **D2** 记录值取**业务数据**：有 `{success,data,error}` 信封取 `data`，无信封取本体（否决：只存文本）；
  3. **D3** `field` 路径含 `[]`，类型按 `functions[].response` 声明强制（否决：JSONPath / ajv / 猜类型）；
  4. **D4** 解耦形态：纯领域包 + 单一包装器 + 共用 `ontology-doc`（否决：塞进 020 / 塞进装配）；
  5. **D5** 包装顺序：020 在外、021 在内（否决：021 在外 + 二次 `check`）；
  6. **D6** 行为识别与名称归一唯一来源 `ontology-doc.ts`，020 改为复用（否决：各写一套）；
  7. **D7** 目录签名缓存（`ontology` 根 `mtimeMs`），惰性加载（否决：每次重读 / 只读一次 / 指纹）；
  8. **D8** 多规则多本体：缺函数优先（暂停）→ 其后任一 `false` 即拒绝（否决：只取第一条 / 就近择一）；
  9. **D9** 中止：`abortRun` 回调 + `run.stop()` + 失败轮收尾 + `details`（否决：工具内 `throw` / 新 SSE 事件）；
  10. **D10** 成败判据：`details.toolError`（否决：看 `isError` / 看文案）；
  11. **D11** 两个错误码分两条通道（暂停走工具结果、中止走失败轮）；
  12. **D12** 资源边界：单条结果 256KB、条目 64、`matches` 文本 4096（丢弃 = 未记录 → 暂停）；
  13. **D13** 测试分层：领域单测 + 包装器单测 + 进程内 loop 端到端；无 MCP 桩，手验补位；
  14. **D14** 记录值可为 `null`（成败都记、最后一次覆盖、键存在 = 已执行）；
  15. **D15** 注册校验判据 = 本轮挂载给模型的工具集合（非服务全集、非 `functions[]`）；
  16. **D16** 阻断复用中止码，靠 `reason`（`unregistered` / `condition_false` / `config_unavailable`）分类。
- 无 `NEEDS CLARIFICATION` 残留；无新增依赖。

## Phase 1：设计与契约

- 产出：
  - [data-model.md](./data-model.md)：本体文档 / 规则归一 / 设计树 / 记录 / 业务数据抽取 /
    判定结果 / 日志字段 / 16 行判定矩阵；
  - [contracts/rule-gate.md](./contracts/rule-gate.md)：模块端口、包装器逐步语义、状态表、
    错误码、`error.details` 增量、前端消费契约、日志事件、无端点变更声明；
  - [quickstart.md](./quickstart.md)：单命令门禁、单测矩阵、进程内端到端、真实数字人手验 6 场景、
    前端文案验证、性能复现。
- 设计复核：未新增依赖 / 服务 / 公开 API；工具清单与白名单语义不变；管理端与前端无字段变更
  （前端仅一条错误码映射）；Phase 1 后宪章检查仍通过。

## 项目结构

### 文档（本特性）

```text
specs/021-ontology-rule-gate/
├── plan.md                       # 本文件
├── research.md                   # Phase 0：技术决策与取舍（D1~D13）
├── data-model.md                 # Phase 1：结构与判定矩阵
├── quickstart.md                 # Phase 1：可运行验证指南
├── contracts/
│   └── rule-gate.md              # 模块契约 + 错误码 + error.details 增量
├── checklists/
│   └── requirements.md           # 规格质量检查表（已通过）
└── tasks.md                      # Phase 2（由 /speckit.tasks 生成）
```

### 源码（仓库根）

```text
agent-backend/
├── src/
│   ├── domain/
│   │   ├── ontology-doc.ts                 # 新增：ontology.yaml 统一解析 + 名称归一 + 目录签名
│   │   ├── rule-gate/
│   │   │   ├── index.ts                    # 唯一导出面（工厂 + 端口 + 记录 + 类型 + 错误码）
│   │   │   ├── types.ts                    # 端口 / 规则 / 设计 / 条件 / 结果类型
│   │   │   ├── design.ts                   # rule_design 解析与归一（含算子与取值个数校验）
│   │   │   ├── field-path.ts               # field 路径语法（`.` 与 `[]`）与读取
│   │   │   ├── operators.ts                # 16 算子 + 类型强制 + 比较
│   │   │   ├── evaluate.ts                 # 两级 AND/OR 合成 + 失败条件收集
│   │   │   ├── catalog.ts                  # 规则/函数/行为索引 + 签名缓存
│   │   │   ├── format.ts                   # 文案与"规则全文"块的唯一来源
│   │   │   └── record.ts                   # 轮内函数记录（只记成功、同名覆盖、有界）
│   │   ├── scope-guard/
│   │   │   ├── policy.ts                   # 改：normalizeName/matchKeys 改为再导出（行为不变）
│   │   │   └── catalog.ts                  # 改：行为解析与目录签名改用 ontology-doc
│   │   ├── run-impl.ts                     # 改：新增 ruleAbort 字段
│   │   ├── run-manager.ts                  # 改：AgentRunRequest 新增 abortRun?
│   │   ├── run-consume.ts                  # 改：接线 abortRun + error 分支改写
│   │   └── llm-error.ts                    # 改：toHistoryErrorInfo 透传 details
│   ├── types.ts                            # 改：HistoryErrorInfo.details?
│   └── infra/
│       ├── tool-rule-gate.ts                # 新增：唯一 AgentTool 包装器 + 结构化日志
│       └── agent-factory.ts                 # 改：构造 gate + 轮内记录 + 包装（约 7 行）
├── tests/
│   ├── unit/
│   │   ├── ontology-doc.spec.ts             # 新增：解析 / 告警 / 符号链接 / 签名
│   │   ├── rule-gate-design.spec.ts         # 新增：归一 / 算子集合 / 取值个数 / 空设计
│   │   ├── rule-gate-field-path.spec.ts     # 新增：`pass` / `a.b` / `items[].qty` / 缺失
│   │   ├── rule-gate-operators.spec.ts      # 新增：16 算子 × 类型矩阵 + 边界
│   │   ├── rule-gate-evaluate.spec.ts       # 新增：and/or 合成 + 失败条件 + 缺值
│   │   ├── rule-gate-catalog.spec.ts        # 新增：加载 / 缓存 / 签名重载 / 坏数据
│   │   ├── rule-gate-record.spec.ts         # 新增：只记成功 / 覆盖 / 归一 / 上限
│   │   ├── rule-gate-gate.spec.ts           # 新增：prepare 四结局 + postHint + 告警
│   │   ├── rule-gate-format.spec.ts         # 新增：暂停/中止文案 + 规则全文块（文案唯一来源）
│   │   ├── tool-rule-gate.spec.ts           # 新增：包装器（暂停/拒绝/记录/追加/保形/日志）
│   │   └── rule-gate-loop.spec.ts           # 新增：进程内 loop 端到端（暂停→补齐→放行；拒绝→error）
│   └── integration/
│       └── （无新增：本特性无端点变更）
└── package.json                             # 不变（零新增依赖）

frontend/
├── src/utils/
│   ├── error-message.ts                     # 改：`ONTOLOGY_RULE_DENIED` 文案 + details 受控透传
│   └── error-message.spec.ts                # 改：新增用例（含未知码回退不变）

specs/001-digital-human-platform/contracts/
└── runtime-api-delta.md                     # 改：变更登记表新增 R28 + §26 语义章节
```

**结构决策**：沿用"`domain/` 纯逻辑 + `infra/` 适配 + `agent-factory` 装配"的既有分层。
`rule-gate/` 是一个**自洽的特性包**：解析、求值、目录、文案、记录各自一个文件，外部只看到
`index.ts`；`ontology-doc.ts` 是唯一被 020/021 共用的**低层解析**，不放任何判定语义。

## 数据流（一次本体行为调用）

```text
模型发起工具调用（toolCallId, params）
  └─ 020 infra/tool-scope-guard.ts（外层）
       ├─ deny → 拒绝（不进入规则闸门）
       └─ allow / not_ontology → 进入 021 infra/tool-rule-gate.ts（内层）
            ├─ 内置工具？→ 原样执行（不判定、不记录）
            ├─ gate.prepare({ toolName, record, available })
            │    ├─ 目录签名变化？→ 重读 ontology/**（首次或部署后）
            │    ├─ 工具名归一 + 两形态匹配 behaviors[] → 未命中 ⇒ { kind:'function' }
            │    ├─ 收集该行为的**前置规则**（多本体合并）
            │    ├─ 无前置规则 ⇒ { kind:'behavior' }
            │    ├─ 有规则缺 related_functions：
            │    │    ├─ 缺失函数**全部已注册**（∈ available）⇒ { kind:'pause' }
            │    │    └─ 存在**未注册**函数 ⇒ { kind:'deny', reason:'unregistered' }
            │    ├─ 逐条求值（记录 + design）：
            │    │    ├─ 任一 false ⇒ { kind:'deny', reason:'condition_false' }
            │    │    ├─ 结构非法/求值异常 ⇒ { kind:'deny', reason:'config_unavailable' }
            │    │    └─ 全部 true ⇒ { kind:'behavior' }
            │    └─ 无 design 的前置规则：不阻断 + 告警
            ├─ pause → 不执行；返回 toolErrorResult(message, ONTOLOGY_RULE_FUNCTIONS_MISSING)
            ├─ deny  → 不执行；onDeny({code:'ONTOLOGY_RULE_DENIED', message, details, reason})
            │           → run.ruleAbort = reason; run.stop()（中断本轮）
            │           → 返回 toolErrorResult(message, ONTOLOGY_RULE_DENIED)
            ├─ 真实执行（含 HITL 在内的内层包装不变）
            └─ 执行后：
                 ├─ role='function' ⇒ record.add(name, 结果或 null)（**成败都记**）
                 └─ role='behavior' 且成功 ⇒ gate.postHint({ toolName, record, available })：
                      ├─ append  ⇒ 追加文本块后返回
                      ├─ blocked ⇒ 不追加、结果原样返回；onDeny(reason:'unregistered') 中止
                      └─ null    ⇒ 原样返回
```

**中止的事件链**：`run.stop()` → loop 报 `error(ABORTED)` → `run-consume` 见 `run.ruleAbort`
→ `finalizer.error(run, …, { code:'ONTOLOGY_RULE_DENIED', message, details, reason })`
→ SSE `error` + 失败轮落盘 → 前端复用既有失败提示块渲染 `details` 逐条原因。

## 模块职责与接口

### 1. `domain/ontology-doc.ts`（新增，约 130 行）

- `normalizeName(raw): string`（去首尾空白 + 小写）、`stripServicePrefix(name): string`
  （去掉首个 `__` 及其前缀）、`matchKeys(toolName): string[]`（完整名 + 去前缀名）；
- `ontologySignature(agentDir): string`（`{agentDir}/ontology` 的 `mtimeMs`，缺失 `missing`）；
- `parseOntologyDoc(raw, warnings, dirName): OntologyDoc`：抽 `metadata` 展示名、`behaviors[]`、
  `rules[]` 原样、`functions[]`（`name` / `response` / `type`）；结构非法只告警、不抛；
- `loadOntologyDocs(agentDir, warnings): OntologyDoc[]`（经 `ontology-files.listOntologyDirs` +
  `readYamlObject`，保持"真实目录 + 拒绝符号链接"）；
- 020 的 `policy.ts` / `catalog.ts` 改为从这里再导出同名函数，**行为与告警片段逐字不变**。

### 2. `domain/rule-gate/design.ts`（新增，约 150 行，纯函数）

- `OPERATOR_CODES`（16 个）、`valueCountOf(operator)`、`isOperatorCode(raw)`；
- `normalizeDesign(raw, warnings): RuleDesign | null`
  - `combine` 非 `and/or` → `''`（读侧按 `and`）；
  - `groups` 非数组/空 → `null`；组内 `conditions` 非数组/空 → 该组丢弃；
  - 条件缺 `function`/`field`、`operator` 非法 → 条件保留但标记 `invalid`（恒 false）；
  - `values` 非数组 → 单值包裹；元素 `String()`；不做内容校验（空串合法）；
  - 不因组数/条数超限拒绝（设计期约束，见 `research.md` D1）。

### 3. `domain/rule-gate/field-path.ts`（新增，约 110 行，纯函数）

- `parseFieldPath(raw): Segment[] | null`（`name` / `name[]`；空串与空段非法）；
- `readField(value, segments): { found: boolean; value?: unknown }`（`[]` 逐元素投影、缺失丢弃）；
- `declaredTypeOf(response, segments): string | undefined`（吃"属性映射"与 JSON Schema 两形态，
  遇 `properties` 先解包；`[]` 段下钻 `items.properties`）。

### 4. `domain/rule-gate/operators.ts`（新增，约 180 行，纯函数）

- `coerce(raw: string, type: string | undefined): unknown`
  - `boolean`：`'true'/'false'`（大小写不敏感）；其他 → `undefined`（条件不成立）
  - `integer` / `number`：转数字（`NaN` → `undefined`）
  - 其他 / 未声明：原字符串
- `compare(actual, found, operator, values, type): boolean`（16 个分支，**全 total**：
  任何类型不符/非法正则/超长文本都返回 false，绝不抛）；
- `isEmptyValue(v): boolean`（`undefined`/`null`/`''`/空数组/无键对象）；
- 常量 `REGEX_MAX_INPUT = 4096`。

### 5. `domain/rule-gate/evaluate.ts`（新增，约 120 行，纯函数）

- `evaluateDesign(design, ctx): { passed: boolean; failed: ConditionHit[] }`
  - `ctx = { resultOf(fn): { found, value }, typeOf(fn, segments): string | undefined }`
  - 组内按 `combine` 合成、组间按根 `combine` 合成；**不短路**（≤25 条，穷举以收集失败条件）；
  - `failed` 最多保留 10 条（`{rule 由调用方补, function, field, operator}`）；
- 不读时钟/环境；同输入同输出（单测可穷举）。

### 6. `domain/rule-gate/catalog.ts`（新增，约 170 行）

- `loadGateCatalog(agentDir, signature): { snapshot, warnings }`
  - 遍历 `loadOntologyDocs`：建 `behaviorIndex`（前置/后置规则按行为分组）、
    `functionResponses`（`归一函数名 → response`）；
  - 规则归一为 `RuleSpec`（`position` 只认"前置"/"后置"，其他忽略 + 告警；`behavior` 空 → 忽略 + 告警）；
  - 行为名 → 规则的索引按 `normalizeName` 归一键，值按"本体键升序 + 文件内顺序"稳定排序；
- `catalogSignature(agentDir)`：复用 `ontology-doc`（020 同口径）。

### 7. `domain/rule-gate/format.ts`（新增，约 170 行）

唯一的中文文案来源：
- `pauseMessage(behaviorRef, rules, missing)`：`「{本体}/{行为}」的前置规则校验未通过：规则「{名}」所需的
  【{缺失函数，顿号分隔}】尚未执行，规则校验无法通过，请先执行完善后再重试该行为。`
- `denyMessage(behaviorRef, hits, reason)`：三种原因三句文案（求值不成立 / 规则不可用 / 函数未注册）；
- `blockedPostMessage(behaviorRef, rules, unregistered)`：**后置阻断专用**，必须含
  "该行为已执行成功、业务数据已写入"，并列出未注册函数与"检查白名单/函数声明"的建议；
- `ruleBlock(rule): string`：把 `RuleSpec` 渲染成"全部内容"块（名称/标题/描述/行为/位置/关联函数/
  数据补充/判定结论/规则设计摘要），供暂停反馈与后置提示复用；
- `denyDetails(behaviorRef, hits, reason)`：3~6 条中文列表（供 `error.details`；未注册时含
  `未注册函数：…` 与建议行）。

### 8. `domain/rule-gate/record.ts`（新增，约 110 行，纯内存）

- `createFunctionRecord(): FunctionRecord`
  - `add(toolName, result)`：**成败都写**——先判成败（`readToolError` / 异常标记），失败写 `null`；
    成功则抽业务数据（`research.md` D2）；再算序列化体积（>256KB 丢弃 + 告警）、
    再判条目上限（>64 丢弃 + 告警），最后按归一键**覆盖（最后一次调用胜出）**；
  - `has` / `get` 用同一归一键；**`has` 判键存在，`get` 可能返回 `null`**（禁止用真值判断代替 `has`）；
  - `size` 只读；记录不含入参、不含原始 `CallToolResult`。

### 9. `domain/rule-gate/gate.ts`（新增，约 230 行）

- `createRuleGate({ agentDir, warn? }): RuleGatePort`
  - 惰性加载 + 签名重载（与 020 同法）；全函数 `try/catch` 兜底 → `deny(reason:'config_unavailable')`
    + 告警（**永不抛**）；
  - `prepare` 合成顺序（`FR-013`）：识别（`matchKeys`）→ 无前置规则 → `behavior`；
    有规则 → 缺函数检查 → **注册校验**（`available` 成员测试）→ `pause` / `deny('unregistered')`
    → 求值（多规则 AND）→ `deny('condition_false')` / `behavior`；
  - `postHint` 三态：无后置 → `null`；有后置且函数全部已注册 → `append`（`format.postBlock`）；
    存在未注册 → `blocked`（**不追加**，附文案）；
  - 未命中任何行为 → `function`（是否内置由包装器先过滤）。

### 10. `infra/tool-rule-gate.ts`（新增，约 150 行）

- `ruleGateTools(tools, ctx)`：逐工具包装（每工具一次），保留全部非 `execute` 字段；
- `execute` 六步语义见 `contracts/rule-gate.md` §2（含"成败都记"与后置 `blocked` 分支）；
- 日志：`rule_gate.paused` / `denied`（带 `reason`）/ `blocked`（带 `phase`、`unregistered_functions`、
  后置时 `executed:true`）/ `unavailable` / `posted` / `record.dropped`（字段见 `data-model.md` §7），
  **不含**结果正文与入参；
- 本文件不含任何本体名、工具名、YAML 字段或求值逻辑（解耦红线）。

### 11. 中止接线（`run-manager` / `run-consume` / `run-impl` / `llm-error` / `types`）

- `AgentRunRequest.abortRun?({ code, message, details })`；
- `run-consume` 传入实现：`run.ruleAbort = reason; run.stop()`；
- 事件流 `error` 分支：`run.ruleAbort` 优先 → `finalizer.error(...)`（**失败轮**，不是 `aborted`）；
- `HistoryErrorInfo.details?: string[]`；`toHistoryErrorInfo` "有才写"透传。

## 实施顺序

1. **低层解析**：新增 `domain/ontology-doc.ts`；把 `scope-guard/policy.ts`、`catalog.ts` 改为复用；
   跑 020 的两个既有单测，必须逐字不变地全绿（回归门槛）。
2. **纯计算**：新增 `rule-gate/types.ts`、`design.ts`、`field-path.ts`、`operators.ts`、`evaluate.ts`；
   先补 4 个纯函数单测（算子矩阵 / 路径 / 归一 / 合成），此时**不碰任何 IO**。
3. **记录**：新增 `rule-gate/record.ts` + `rule-gate-record.spec.ts`（**成败都记**、失败记 `null`、
   最后一次覆盖、上限）。
4. **目录与闸门**：新增 `catalog.ts`、`format.ts`、`gate.ts`、`index.ts`；补目录/文案/prepare 四结局单测。
5. **注册校验与阻断**：`gate.ts` 加 `available` 成员测试（前置 `deny('unregistered')`、后置 `blocked`），
   `format.ts` 补三套文案（求值不成立 / 规则不可用 / 函数未注册，后置另含"已写入"声明）。
6. **包装器**：新增 `infra/tool-rule-gate.ts` + 单测（暂停/拒绝/阻断/记录/追加/保形/日志）。
7. **中止接线**：`types.ts` → `llm-error.ts` → `run-impl.ts` → `run-manager.ts` → `run-consume.ts`；
   补 `rule-gate-loop.spec.ts`（暂停→补齐→放行；求值拒绝；前置未注册阻断；后置未注册阻断）。
8. **装配**：`agent-factory.ts` 约 8 行改动（含 `availableNames` 生成）；跑 `npm run gate` 确认零回归。
9. **前端**：`error-message.ts` 一条映射 + `details` 受控透传 + 单测；跑前端门禁。
10. **契约与文档**：`contracts/rule-gate.md`（已产出）；`runtime-api-delta.md` 登记 R28 + §26；
    回写 `spec.md` 修订记录（如实现期出现口径变化）；`SC-004` 实测值回填。
11. **手验**：按 `quickstart.md` 场景 A~G 在真实数字人上走一遍（新增 G：未注册阻断）。

## 测试策略

### 单元测试（不依赖 MCP / LLM）

| 文件 | 覆盖 |
|---|---|
| `ontology-doc.spec.ts` | 三段的解析与缺省；`behaviors[].name` 空值丢弃 + 告警；`rules` 非数组；符号链接目录跳过；中文路径；签名变化 |
| `rule-gate-design.spec.ts` | `combine` 非法 → and；组/条件过滤；`values` 单值包裹与 `String()`；算子非法标记；空设计 → `null`；超限不拒绝 |
| `rule-gate-field-path.spec.ts` | `pass` / `detail.qty` / `items` / `items[].qty` / `a[].b[].c`；缺失段；非对象中间层；空串路径 |
| `rule-gate-operators.spec.ts` | 16 算子 × {boolean, integer, number, string, 未声明}；`between` 闭区间；`contains` 字符串/数组；`matches` 非法正则与超长；`empty`/`not_empty` 六种"空" |
| `rule-gate-evaluate.spec.ts` | 组内 and/or × 组间 and/or；两条规则合成；失败条件收集（不短路）；记录缺函数 |
| `rule-gate-catalog.spec.ts` | 规则归一（位置/行为非法忽略 + 告警）；行为索引稳定顺序；函数 response 索引；签名重载与不重读（读取计数桩） |
| `rule-gate-record.spec.ts` | **成败都记**（失败 `null`）；同名**最后一次覆盖**（失败覆盖成功）；键存在≠值为真（`has` 与 `get` 分离）；名称归一；256KB 与 64 条上限；业务数据抽取四形态 |
| `rule-gate-gate.spec.ts` | `prepare` 四结局 × {无规则 / 有规则 / 多规则 / 多本体 / 无 design / 坏 design / 公共函数无声明 / **缺函数且已注册 → pause** / **缺函数但未注册 → deny(unregistered)** / **服务有但白名单过滤 → 未注册**}；`postHint` 三态（无 / append / **blocked**）；`invalidate` |
| `rule-gate-format.spec.ts` | `pauseMessage` 含行为与规则名 + 缺失函数；`denyMessage` / `denyDetails` 三种 `reason` 文案（含 `fail_message`、未注册函数名与建议）；`blockedPostMessage` 含"已执行成功/数据已写入"；`ruleBlock` 覆盖规则全部字段 |
| `tool-rule-gate.spec.ts` | 内置透传；`function` 成败都记录（失败 `null`）；`behavior` append；`pause`/`deny` 时**原 execute 零调用**；**后置 blocked 时 execute 已调用且结果原样不变**；`onDeny` 调用一次且 `reason` 正确；保形；日志字段（含 `ts` / `reason` / `phase`）；`prepare` 抛错时不崩 |
| `rule-gate-loop.spec.ts` | 假 `streamFn`：首次暂停 → 补函数 → 二次成功；求值 false → `error` + `details`、无 `done`；**未注册 → `error(reason=unregistered)` 且行为零执行**；**后置未注册 → 行为已执行 + `error` 文案含"已写入"** |

### 集成测试

**无新增**：本特性不新增/不修改任何 HTTP 端点与 SSE 事件类型；既有 `chat-*` 集成测试即回归门禁。
"真模型 + 真 MCP 工具"的自动化需要 MCP 桩服务（仓库目前只有 401 桩），**本期不引入**，
由 `quickstart.md` 场景 A~F 手验覆盖（与 020 同一处置）。

### 前端测试

`frontend/src/utils/error-message.spec.ts` 新增：`ONTOLOGY_RULE_DENIED` + `details: string[]`
→ 逐条拼接；`details` 缺失/类型不符 → 固定文案；其他错误码文案逐字不变。

### 质量门禁（本地，单命令）

```bash
cd agent-backend && npm run gate
cd frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

## 覆盖率缺口处置结论（宪章「仍生效的待办与口径」第 1 项）

| 项 | 结论 |
|---|---|
| 是否触及 `frontend` | **是**（`src/utils/error-message.ts`）——但它**不在** 20 个存量 0% 模块清单内（清单为 `src/api/**` 7 个 + `src/composables/**` 13 个） |
| 本次范围 | 只补本次改动的 `error-message.ts` 用例；**不为清单内模块补测**，不发起专项 |
| 顺序（沿用 020 结论，不变更） | ① 网络与契约边界：`api/http.ts`、`api/threads.ts`、`api/files.ts`、`api/produced.ts`；② 产出与预览：`usePreview.ts`、`useWorkspace.ts`；③ 会话与流式：`useChatPanel.ts`、`useThreads.ts`、`useSessionSearch.ts`；④ 其余 |
| 机制 | "触达即补"：仅当清单内模块在后续特性中被改动时补同名测试 |
| 全局地板 | 只可随补测上调，MUST NOT 下调 |

## 平台差异风险登记（宪章原则三）

**登记结论：本次存在文件系统相关行为，风险已识别并有对应措施。**

| 风险 | 表现 | 措施 |
|---|---|---|
| Windows 目录名大小写不敏感 / Linux 敏感 | 行为名与函数名只在**内存**比较（已归一为小写），目录枚举仍按真实 `readdir` | 目录名与展示名不参与判定；归一函数是唯一入口 |
| 中文路径 | `ontology.yaml` 位于中文场景/本体目录下 | 只读；路径一律 `node:path.join`；复用 020 已验证的 `ontology-files` |
| 行尾符（CRLF / LF） | 规则文本字段可能带 `\r` | YAML 解析对行尾不敏感；比对前对 `behavior` / `related_functions` / 函数名做去空白 |
| 同名规则在多个本体 | 多本体同名行为 | 合并判定（缺函数优先，其后任一 false 即拒绝），并记冲突相关日志 |
| 正则回溯（`matches` 由数据提供） | 灾难性回溯 | 输入限长 4096 + `try/catch`，失败即条件不成立（`research.md` D12） |

部署后冒烟沿用既有 `npm run smoke`；**冒烟不作为测试结论**。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 函数名与 `related_functions` 不同名 | 该函数永远"未执行" → 行为持续暂停（不是静默放行） | 文案点名缺失函数；`rule_gate.paused` 日志可检索；`quickstart.md` 场景 A 手验核对真实服务 |
| `rule_design` 与运行期求值口径漂移 | 平台配得出、运行期算不对 | 解析与类型口径**照抄权威文档**并写成单测矩阵；`FR-019`/`FR-020` 已固化全集与比较口径 |
| fail-closed 放大配置错误 | 坏规则会让该行为不可执行 | `rule_gate.unavailable` 为 `error` + `alert`；文案指明"规则配置不可用，请联系管理员" |
| 规则求值阻塞事件循环 | 工具时延抖动 | 条件是纯内存比较（≤25 条）；稳态只多一次 `statSync`；`SC-004` 量化门禁 |
| 020 解析重构引入回归 | 权限判定行为改变 | 只搬移归一与行为解析，判定语义零改动；020 两个既有单测全绿是验收条件 |
| 记录体积与条目膨胀 | 单轮内存增长 | 单条 256KB、条目 64、超限丢弃 + 告警（丢弃 = 键不存在 = 未执行 → 暂停/注册校验，不会静默放行） |
| **白名单过滤导致误阻断**（最需警惕） | 函数在服务里存在但没挂载给模型 → 判"未注册" → 整轮中止，表现为"以前能跑的行为突然不可用" | 文案点名函数并提示"检查工具白名单与本体函数声明"；`rule_gate.blocked` 为 `error` 级；`quickstart.md` 场景 G 手验；上线前对齐一次"本体 `functions[]` ↔ 实际挂载工具"清单 |
| **后置阻断造成半截状态** | 行为已落库但本轮报错，用户可能重复下单 | 文案强制声明"已执行成功、数据已写入"；`details` 与日志带 `executed:true`；手验场景 G 覆盖 |
| 记录 `null` 语义被实现成"未执行" | 失败被误判为待办 → 模型空转补调 | `has` 与 `get` 分离（禁止真值判断）；单测专列"失败覆盖成功"与"键存在值为 `null`"两例 |
| 中止被误用成"用户中断" | 失败轮丢失留痕 | `run.ruleAbort` 优先级高于 `ABORTED`，走 `finalizer.error`；loop 用例断言"无 `done` 且有失败行" |
| 无 MCP 端到端自动化 | 接线错误可能只在手验暴露 | 进程中 loop 端到端覆盖四条主链路（暂停/求值拒绝/前置阻断/后置阻断）；装配仅 8 行由包装器单测覆盖透传语义 |

## 复杂度跟踪

| 违规（潜在） | 为什么需要 | 更简单的替代为何不可行 |
|---|---|---|
| 新增 `domain/rule-gate/**` 9 个文件 | 解析 / 路径 / 算子 / 合成 / 目录 / 文案 / 记录 / 端口职责不同，且要求可独立测试与独立演进 | 合并成 2 个文件会逼近 500 行硬门禁，并把纯函数与只读 IO 混在一起，无法用假数据穷举算子矩阵 |
| 新增 `domain/ontology-doc.ts` 并改动 020 的两处 | "什么算一个本体行为"是**安全相关**判据，两处各写一套必然漂移（原则二） | 在 `rule-gate` 里复制一份 behaviors 解析：短期零改动，但"权限认它是行为、规则不认"会成为长期隐患 |
| 每次判定一次 `statSync` | 020 的指纹不含 `ontology/**`，仅靠实例换代覆盖不到"只换本体"的部署 | 不做签名：部署后必须重启，违背 `FR-038`；每调用全量重读：IO 抖动，违背 `SC-004` |
| `error` 对象新增可选 `details` | 中止原因必须"讲清哪个行为、哪条规则、为什么"，而前端不展示后端 `message` | 塞进 `message`：前端按既有口径不会展示，用户只看到笼统短语，等于没有原因 |
| 中止走 `finalizer.error` 而非 `aborted` | 规则拒绝是"失败且要留痕"，与用户主动停止（丢弃本轮）语义不同 | 复用 `aborted`：历史里查不到这轮，用户刷新后"提问凭空消失" |
| 前端新增一条"受控原文透传"例外 | 与既有 `FILE_SCHEMA_INVALID` 同口径的第二个例外，属于刻意破例 | 不破例：用户只能看到"请求失败，请稍后重试"，无法定位是哪条规则 |

## 规格修订（plan 阶段事实校正）

1. **`FR-006` 记录值形态**：明确为"业务数据部分"（有 `{success,data,error}` 信封取 `data`，
   无信封取本体，数组记 `{count,items}`）。原因：`field` 是相对信封 `data` 声明的既定口径。
2. **`FR-019` 算子集合**：由"至少支持"升级为**全集 16 个**，并写明取值个数口径
   （`eq/ne/gt/gte/lt/lte/contains/not_contains/starts_with/ends_with/matches/in/not_in` 各 1 个，
   `between` 2 个，`in/not_in` ≥1 个，`empty/not_empty` 0 个；原文 `neq` 更名 `ne`）。
3. **`FR-020` 类型强制**：改为"按函数 `response` 声明的字段类型强制转换"，`field` 语法补 `[]`。
4. **`FR-002` 行为识别口径**：明确"与权限闸门同口径同实现"（`behaviors[]` 命中即本体行为）。
   原因：`securities.yaml` 的 `action_name` 与 `behaviors[]` 是一一对应的两处登记，以 `behaviors[]`
   为唯一识别点是 020 已生效的口径。
5. **`FR-034` 原因下发**：明确逐条原因随失败轮下发、前端做一次受控原文透传（与
   `FILE_SCHEMA_INVALID` 同口径的例外）。
6. 以上均已回写 `spec.md` 修订记录（2026-11-09 plan 阶段）；`SC` 编号与其余语义保持原样。

### clarify 阶段同步（2026-11-09，**语义变更**）

- **记录语义**：`FR-003`/`FR-005` 由"只记成功、失败不覆盖"改为"**成败都记**、失败记 `null`、
  **最后一次覆盖**"；键存在 = 已执行。对应 `research.md` D14、`data-model.md` §4。
- **新增注册校验**：`FR-041`~`FR-044`（新 F 节）。判据 = 本轮挂载给模型的工具集合（`research.md` D15）；
  前置未注册 → `deny(reason:'unregistered')`；后置未注册 → `postHint.blocked`（执行成功后，`D16` 与用户选择 B）。
- **端口变化**：`prepare(input)` / `postHint(input)` 改为接收 `{ toolName, record, available }`；
  `deny` 增 `reason`，`postHint` 变三态（`null` / `append` / `blocked`）。
- **错误码**：仍为 2 个；阻断复用 `ONTOLOGY_RULE_DENIED`，靠 `reason` 分类（`research.md` D16）。
- **呈现**：中断原因复用既有失败提示块（`FR-034`），不新增消息类型。
- 新增验收 `SC-009`（未注册阻断）/ `SC-010`（`null` 语义）。受影响的实现落点与测试矩阵已在
  §模块职责、§数据流、§测试策略、§完成定义中同步。

## 完成定义

- [ ] `spec.md` 的 `FR-001`~`FR-044`、`SC-001`~`SC-010` 均有实现或测试对应，逐条可勾。
- [ ] `domain/rule-gate/**` 的 import 清单不含 infra / scope-guard / intent-focus / mcp / pi / fastify / pino / `node:fs`（可用 grep 断言）。
- [ ] `rule_design` 的求值是**纯函数**：无 LLM 调用、无网络、无时钟；同输入同输出（单测穷举）。
- [ ] 22 行判定矩阵（`data-model.md` §8）全部在单测中覆盖且全绿。
- [ ] 记录语义：成败都记、失败记 `null`、最后一次覆盖；`has` 与 `get` 分离（`null` 不被当成"未执行"）。
- [ ] 暂停路径：行为零执行、零副作用、卡片失败态、文案点名缺失函数（且函数**已注册**）。
- [ ] 前置阻断路径：函数未注册 → 行为零执行、整轮中止、`reason='unregistered'`、`details` 点名未注册函数。
- [ ] 后置阻断路径：行为已执行并落库、**不追加**提示、整轮中止、文案含"已执行成功、数据已写入"。
- [ ] 拒绝路径：行为零执行、整轮中止、`error.code = ONTOLOGY_RULE_DENIED`、`details` 3~6 条、`reason='condition_false'`。
- [ ] 后置提示：原文逐字保留 + 追加块；执行失败不追加；无规则零变化；函数全部已注册才追加。
- [ ] 非本体工具、内置工具、"未部署本体/无规则"的数字人零行为变化（既有单测与集成测试全绿）。
- [ ] 020 的既有单测全绿（解析重构零回归）。
- [ ] `contracts/rule-gate.md` 与 `runtime-api-delta.md` R28 已登记；前端 `error-message` 用例覆盖新码。
- [ ] 本地门禁全绿；新增模块覆盖率 ≥ 80%；`SC-004` 实测值已回填 `spec.md`。
- [ ] `quickstart.md` 场景 A~G 手验通过并记录结论（G = 未注册阻断，含前置与后置两种）。

---

## 软收尾改造（2026-11-09，用户决策；本文件前文的中止设计以本节为准）

> 前文出现的 `abortRun` / `run.ruleAbort` / `onDeny` / "失败轮收尾"均为改造前设计，**已删除**。
> 现行方案见 `spec.md` `FR-032`~`FR-034`、`FR-045`~`FR-047` 与 `research.md` D17。

**改动落点**

| 文件 | 变更 |
|---|---|
| `domain/tool-suspension.ts` | **新增**：本轮挂起状态 + 拦截 + 兜底出口 + `SUSPENDED_MESSAGE` |
| `infra/tool-rule-gate.ts` | `RuleGateContext.onDeny` → `suspension`；拦截前置；`deny`/`blocked` 改软收尾 + 三段式卡片 |
| `infra/tool-scope-guard.ts` | 内部 `SuspendState` → 共享 `ToolSuspension`（可选第 4 参）；文案改用 `SUSPENDED_MESSAGE` |
| `infra/agent-factory.ts` | 每轮 `createToolSuspension(() => req.interruptRun?.())`，同时传给 020/021 |
| `domain/rule-gate/format.ts` | 新增 `RULE_TERMINAL_NOTICE` / `denyCardBody`；拒绝文案由"本轮已中止"改为"本次调用已拒绝" |
| `domain/run-manager.ts` / `run-impl.ts` / `run-consume.ts` | 删除 `abortRun` / `ruleAbort` / `finalizeRuleAbort` 与两处失败轮分支 |

**完成定义（本节覆盖前文对应条目）**

- [x] 拒绝路径：行为零执行、**挂起本轮工具**、卡片含结论/明细/终局指令、`toolError.code = ONTOLOGY_RULE_DENIED`。
- [x] 拒绝**不产生 error 失败轮**：模型总结后正常 `done`；挂起后其余工具零执行。
- [x] 有界退出：第 2 次拦截触发一次纯中止（`ABORTED`），单轮至多一次。
- [x] 配置类拒绝仍 `error` 级 + `alert: true`；挂起后每次拦截记 `rule_gate.suspended`。
- [x] 前端零改动（复用既有工具卡片；`ONTOLOGY_RULE_DENIED` 映射保留给历史失败行）。
