# 实施计划：本体行为权限闸门（工具调用前置授权）

- **分支**：`020-ontology-scope-guard`
- **日期**：2026-11-08
- **规格**：[spec.md](./spec.md)
- **输入**：`specs/020-ontology-scope-guard/spec.md`
- **说明**：技术栈完全沿用现状（TypeScript 6 / Node ≥ 20 / Fastify 5 / Vitest 5 / `yaml`），**不新增依赖、不新增端点、不改前端**。
  本计划的重点不是"加一处判断"，而是**把权限判断做成可独立演进、可独立测试的模块**，与工具装配、MCP、HITL、意图聚焦保持单向依赖。

## 摘要

在工具真正执行前加一层"本体行为 → `securities.yaml` 的 `scope`"授权判定：

1. **归属识别**：工具名去掉 MCP 服务前缀后，与已部署本体的 `behaviors[].name` 匹配（去空白、大小写不敏感）；匹配不到即"非本体行为"，直接放行。
2. **授权判定**：命中行为后读该本体的 `securities.yaml`，取 `action_name` 对应的 `scope` ——
   含 `everyone` 放行；含 `disable` 拒绝（优先于 `everyone`）；否则当前数字人的归属用户名在 `scope` 中放行、不在则拒绝；空 `scope` 与"缺条目/文件损坏"按安全默认拒绝并告警。
3. **拒绝语义**：不执行、无副作用、不发 MCP 请求，以既有"工具失败结果"通道返回（卡片标红 + 可读文案），三个专用错误码，一条结构化日志。

**解耦形态**（本次的硬约束）：
`domain/scope-guard/**`（纯策略，零 infra / MCP / pi / Fastify / 意图聚焦依赖）+ `infra/tool-scope-guard.ts`（唯一 `AgentTool` 包装器，约 60 行）+ `agent-factory.ts` **3 处新增行**（构造、包装、传入）。

## 技术上下文

**Language/Version**：TypeScript 6 / Node.js ≥ 20，ESM（`agent-backend/package.json`）。

**Primary Dependencies**：
- Fastify 5（HTTP 层，本次**不改任何路由**）
- `yaml` 2.9（解析 `ontology.yaml` / `securities.yaml`，**已存在，不新增依赖**）
- `@earendil-works/pi-agent-core`（仅 `infra/tool-scope-guard.ts` 引用其 `AgentTool` 类型；`domain/` 不引用）
- 复用 `domain/tool-error.ts` 的失败标记通道（HITL 已在用，不是新机制）

**Storage**：只读
- `.opt-agent/users/{用户}/agents/{数字人}/ontology/{场景}/{本体}/ontology.yaml`（行为清单与本体身份）
- 同目录 `securities.yaml`（`action_name` / `scope`）
- **无新增存储、无迁移、无写回**；判定结果不落盘（日志除外）

**Testing**：Vitest 5，`npm run test` / `npm run test:integration` / `npm run test:coverage`；
不依赖真实 MCP 服务、不依赖真实 LLM（进程内假 `streamFn` 驱动）。

**Target Platform**：Linux 容器（部署）/ Windows 本地开发（中文路径、盘符大小写）。路径一律 `node:path`，目录枚举只接受真实目录并拒绝符号链接。

**Project Type**：Web 服务（后端）；本次**只改 `agent-backend`**，`frontend` / `admin-backend` / `admin-frontend` 零改动。

**Performance Goals**：
- 判定对单次工具调用的**额外耗时**：已缓存 P95 ≤ 10ms、未缓存首次 ≤ 50ms（`SC-004`）；
- 稳态每次判定 = 1 次 `statSync`（目录签名）+ 纯内存查表，无 YAML 重读；
- 不改变工具本身时延，不引入网络或数据库访问。

**Constraints**：
- 零新增依赖；零新增配置项、端点、SSE 事件、前端字段；
- 单文件 ≤ 500 行；新增模块语句覆盖率 ≥ 80%；
- `domain/scope-guard/**` MUST NOT import：`../infra/**`、`./intent-focus/**`、`./mcp/**`、`@earendil-works/**`、`fastify`、`pino`；
- 判定 MUST NOT 抛异常穿透（`check` 契约：永不抛错）。

**Scale/Scope**：
- 单数字人本体数通常 1~5（上限按目录自然枚举）；单本体行为 8~60；
- 单轮工具调用 1~10 次（含并行批次），每次判定一次。

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项必须在「复杂度跟踪」中说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文与规格驱动 | 通过 | 规格、计划、研究、数据模型、契约、快速验证全部中文；实现期回写规格修订记录 |
| 二、代码质量与模块化 | 通过 | 权限策略集中在 `domain/scope-guard/**`（5 个文件，均 < 150 行）；`infra` 只留一个包装器；目录枚举与 YAML 读取抽为唯一来源 `domain/ontology-files.ts`（见研究 D2） |
| 三、测试完备性 | 通过 | 新增模块全部同名同目录单测；进程内 loop 端到端验证"拒绝 → `isError` → 卡片标红"接线；**无真实 MCP 端到端自动化**（仓库无 MCP 桩），以 `quickstart.md` 手验补位并在此登记 |
| 四、无障碍 | 不适用（有约束） | 无 UI 变更；拒绝沿用既有"失败卡片 + 文案"，不新增仅靠颜色传达的信息 |
| 五、性能与一致性 | 通过 | P95 增量 ≤ 10ms（缓存）/ ≤ 50ms（首次）；单次判定只 `stat` 一次；读文件按"完整文件"解析，不读半更新内容（部署为目录级原子改名） |
| 六、依赖治理 | 通过 | 零新增依赖；`package.json` 不变 |
| 七、接口契约两侧同改 | 通过 | 无端点/事件/字段变更；在 `specs/001-.../contracts/runtime-api-delta.md` 补登 R27 与新章节；前端无字段依赖（拒绝只看 `isError` 与文案） |
| 八、测试部署简单可控 | 通过 | 复用 `agent-backend` 单命令门禁；部署路径不变，冒烟沿用既有脚本 |
| 九、优雅降级与可观测 | 通过 | 拒绝用户可感知（文案 + 标红）；每次拒绝一条结构化日志；配置异常为告警级；无重试放大（拒绝不外呼、不重试）；fail-closed 的取舍见研究 D4 |

**Phase 1 后复核**：设计未引入新依赖、未新增公开 API、未改变工具清单与权限模型；`domain` 依赖方向仍单向；仍通过。

## 解耦设计（本次核心约束）

### 依赖方向（只允许向下）

```text
agent-factory.ts（装配）
    │  构造 + 包装（3 处新增行）
    ├──► infra/tool-scope-guard.ts（唯一 AgentTool 包装器）
    │        │  只依赖：AgentTool 类型、ScopeGuardPort、tool-error
    │        └──► domain/scope-guard（端口与决策）
    └──► domain/scope-guard/index.ts（工厂）
             ├─ policy.ts   四条规则（纯函数，零 IO）
             ├─ catalog.ts  行为→(本体, 条目) 索引（只读 IO）
             ├─ guard.ts    缓存 + 签名重载 + 决策合成 + 中文文案
             └─ 依赖 domain/ontology-files.ts（目录枚举 + YAML 读取）
```

- **反向依赖为 0**：`domain/scope-guard` 不知道工具从哪来、不知道 MCP、不知道 HITL、不知道意图聚焦、不知道 Fastify；
- **旁路依赖为 0**：`agent-factory` 之外没有任何调用点，删除该特性只需回退 3 处装配行与两个新目录；
- **测试可注入**：包装器只依赖 `ScopeGuardPort` 接口，测试用假实现即可覆盖"放行/拒绝"两条路径，不需要构造真实本体目录。

### 公共接口（唯一导出面 `domain/scope-guard/index.ts`）

```ts
export interface ScopeGuardPort {
  /** 判定一个工具名；永不抛错。会按目录签名自动重载。 */
  check(toolName: string): ScopeDecision;
  /** 强制丢弃缓存（测试与运维入口） */
  invalidate(): void;
}

export type ScopeDecision =
  | { kind: 'not_ontology' }
  | { kind: 'allow'; behavior: BehaviorRef; rule: 'everyone' | 'user' }
  | { kind: 'deny'; behavior: BehaviorRef | null; code: ScopeDenyCode; reason: DenyReason; message: string };
```

- `ScopeDenyCode` ∈ `ONTOLOGY_SCOPE_DENIED`（含 `disable`）/ `ONTOLOGY_SCOPE_UNAVAILABLE`；
- `message` 是**唯一**中文拒绝文案来源（包装器不拼文案）；
- 工厂入参只有一个对象：`{ agentDir, username, warn? }`，不接收 logger、fastify、MCP。

### 装配点最小改动（`infra/agent-factory.ts`）

| 位置 | 改动 | 行数 |
|---|---|---|
| `create()` | `const scopeGuard = createScopeGuard({ agentDir, username: key.userId, warn })` | +2 |
| `run` 闭包 | `run: (req) => this.runWith(instance, mcp, req, scopeGuard)` | 改 1 行 |
| `runWith()` 工具装配末尾 | `const guarded = guardTools(tools, scopeGuard, { logger, userId, agentName, threadId })`，后续 `availableTools` 与 loop 用 `guarded` | +2 / 改 3 行 |

**不做的事**（防止耦合回潮）：
- 不在 `mcp-tool-adapter`、`tool-intercept`、`builtin-tools` 里加任何权限判断；
- 不在 `ChatAgent` 接口上新增方法，不把 guard 塞进 `types.ts`；
- 不给 `McpManager` / `AgentConfigBundle` 增加权限字段；
- 不新建进程、不新建数据库表、不改 `MCP.json` / `TOOL.json` 形状。

### 与既有能力的关系

| 既有能力 | 关系 |
|---|---|
| HITL 人工确认（`tool-intercept.ts`） | 权限闸门**在外**、确认在内：先判权限，被拒不弹确认框；两者互不引用 |
| 工具失败标记（`tool-error.ts`） | **复用**：拒绝走同一通道，`afterToolCall` 翻 `isError`，卡片标红，模型收到可读文案 |
| 配置指纹换代（R7） | 独立：指纹不含 `ontology/**`（已核对），故闸门自带目录签名重载（研究 D6） |
| 意图聚焦（016/019） | 完全独立：闸门不判分、不调 Laya、不读技能；两者只共用 `ontology-files.ts` 的目录枚举 |
| 工具白名单 / 文件沙箱 | 不变：白名单仍决定"模型看得见什么"，闸门决定"看得见的能不能执行" |

## Phase 0：研究与决策

- 产出：[research.md](./research.md)
- 已收敛的关键决策（D1~D12）：
  1. **D1** 解耦形态：纯领域包 + 端口 + 单一适配器 + 3 处装配行（否决：直接写在 `agent-factory`、写在 MCP 适配器、独立服务）；
  2. **D2** 目录枚举与 YAML 读取抽为唯一来源 `domain/ontology-files.ts`，意图聚焦改为复用（行为与告警文案不变）；
  3. **D3** 归属识别：同时查"完整工具名"与"去首个 `__` 前缀名"两个候选键（去空白 + 大小写不敏感）；
  4. **D4** 缺条目 / 缺文件 / 坏文件 / 结构非法 → fail-closed 拒绝 + 告警（否决 fail-open）；
  5. **D5** 多本体同名行为 → 拒绝优先（否决"首个命中"）；
  6. **D6** 缓存：实例内持有快照 + 每次判定比一次 `ontology` 根目录签名；**不依赖 R7 指纹**；
  7. **D7** 与 HITL 顺序：闸门在外；
  8. **D8** 失败表达：复用 `toolErrorResult`，不抛异常；
  9. **D9** 三个错误码，命名与语义一一对应；
  10. **D10** 文案与日志分离：文案不含授权清单，日志只记 `scope_kind` / `scope_size`；
  11. **D11** 同步文件读取可接受（小文件 + 缓存 + 与 016 一致），纳入风险登记；
  12. **D12** 测试分层：领域单测 + 包装器单测 + 进程内 loop 端到端；无 MCP 桩，手工验证补位。
- 无 `NEEDS CLARIFICATION` 残留；无新增依赖。

## Phase 1：设计与契约

- 产出：
  - [data-model.md](./data-model.md)：快照结构、行为与管控条目的绑定规则、判定结果与日志字段、判定矩阵；
  - [contracts/scope-guard.md](./contracts/scope-guard.md)：模块端口契约、工具结果语义、错误码、日志事件、无端点变更声明；
  - [quickstart.md](./quickstart.md)：六类可运行验证场景与排障命令。
- 设计复核：未新增依赖 / 服务 / 公开 API；工具清单与白名单语义不变；管理端与前端无字段变更；Phase 1 后宪章检查仍通过。

## 项目结构

### 文档（本特性）

```text
specs/020-ontology-scope-guard/
├── plan.md                       # 本文件
├── research.md                   # Phase 0：技术决策与取舍
├── data-model.md                 # Phase 1：快照、绑定、判定、日志字段
├── quickstart.md                 # Phase 1：可运行验证指南
├── contracts/
│   └── scope-guard.md            # 模块契约 + 错误码 + 无端点变更声明
├── checklists/
│   └── requirements.md           # 规格质量检查表（已通过）
└── tasks.md                      # Phase 2（已由 /speckit.tasks 生成）
```

### 源码（仓库根）

```text
agent-backend/
├── src/
│   ├── domain/
│   │   ├── ontology-files.ts                # 新增：本体目录枚举 + YAML 读取（唯一来源，两处复用）
│   │   ├── scope-guard/
│   │   │   ├── index.ts                     # 唯一导出面（工厂 + 端口类型 + 错误码）
│   │   │   ├── types.ts                     # 快照 / 绑定 / 决策 / 端口类型
│   │   │   ├── policy.ts                    # 名称归一化 + 四条授权规则（纯函数）
│   │   │   ├── catalog.ts                   # 加载 ontology.yaml + securities.yaml → 索引快照
│   │   │   └── guard.ts                     # 缓存 / 签名重载 / 多本体合成 / 中文文案
│   │   └── intent-focus/
│   │       └── ontology-loader.ts           # 改：改用 ontology-files（行为不变）
│   └── infra/
│       ├── tool-scope-guard.ts              # 新增：唯一 AgentTool 包装器 + 拒绝日志
│       └── agent-factory.ts                 # 改：3 处装配行
├── tests/
│   ├── unit/
│   │   ├── ontology-files.spec.ts           # 新增：目录枚举 + YAML 读取（符号链接 / 坏文件 / 中文路径）
│   │   ├── scope-guard-policy.spec.ts       # 新增：规则矩阵 + 名称匹配
│   │   ├── scope-guard-catalog.spec.ts      # 新增：加载 / 缓存 / 签名重载 / 坏文件
│   │   ├── tool-scope-guard.spec.ts         # 新增：包装器 + 拒绝日志
│   │   └── scope-guard-loop.spec.ts         # 新增：进程内 loop 端到端（拒绝 → isError → 无确认请求）
│   └── integration/
│       └── （无新增：本特性无端点变更）
└── package.json                             # 不变（零新增依赖）

specs/001-digital-human-platform/contracts/
└── runtime-api-delta.md                     # 改：变更登记表新增 R27 + 语义章节
```

**结构决策**：沿用"`domain/` 纯逻辑 + `infra/` 适配 + `agent-factory` 装配"的既有分层。
`scope-guard/` 是一个**自洽的特性包**：规则、加载、缓存、文案各自一个文件，外部只看到 `index.ts`。
`ontology-files.ts` 是唯一被两个特性共用的**低层工具**（枚举与解析），不放任何业务判断。

## 数据流（一次工具调用）

```text
模型发起工具调用（toolCallId, params）
  └─ infra/tool-scope-guard.ts 的 execute
       ├─ guard.check(tool.name)
       │    ├─ 目录签名变化？→ 重读 ontology/** 与 securities.yaml（首次或部署后）
       │    ├─ 生成候选键（完整名 / 去首个 `__` 前缀）+ 归一化（去空白、小写）
       │    ├─ 查 byBehavior：未命中 → { kind: 'not_ontology' }
       │    ├─ 命中多条（多本体同名）→ 逐条判定，任一拒绝即拒绝优先
       │    ├─ 单条：找 securities 条目
       │    │    ├─ 无条目 / 文件不可用 → deny(ONTOLOGY_SCOPE_UNAVAILABLE)
       │    │    ├─ scope 含 disable → deny(ONTOLOGY_SCOPE_DENIED, reason=disabled)
       │    │    ├─ scope 含 everyone → allow(rule=everyone)
       │    │    ├─ 用户名 ∈ scope → allow(rule=user)
       │    │    └─ 否则 → deny(ONTOLOGY_SCOPE_DENIED)
       │    └─ 内部异常 → deny(ONTOLOGY_SCOPE_UNAVAILABLE) + 告警（永不抛）
       ├─ allow / not_ontology → 调真实 execute（HITL 包装在内的原逻辑不变）
       └─ deny → 不调真实实现；写一条结构化日志；返回 toolErrorResult(message, code)
```

## 模块职责与接口

### 1. `domain/ontology-files.ts`（新增，约 80 行）

- `listOntologyDirs(agentDir, warnings, label?): OntologyDirRef[]`
  - 枚举 `{agentDir}/ontology/{场景}/{本体}/`，只接受**真实目录**（`Dirent.isDirectory()` 且非符号链接）；
  - 不存在 → 空数组且不告警；不可读 → `<label>:unreadable:*` 告警；
  - 返回 `{ scenario: string; ontology: string; dir: string }`，场景与本体按名称排序（判定顺序稳定）。
- `readYamlObject(file, warnings): Record<string, unknown> | null`
  - `lstat` 拒绝符号链接与非普通文件（`not_regular_file`）；
  - 解析失败 → `invalid_yaml`；非对象 → `not_object`；**永不抛错**。
- 意图聚焦的 `ontology-loader.ts` 改为调用这两个函数（其告警关键片段 `invalid_yaml` / `not_object` /
  `not_regular_file` / `unreadable` 保持不变，既有单测不受影响）。

### 2. `domain/scope-guard/policy.ts`（新增，约 90 行，纯函数）

- `normalizeName(raw): string`：去首尾空白 + 小写。
- `matchKeys(toolName): string[]`：返回 1~2 个候选键——完整名；若含 `__`，再加去掉**第一个** `__` 及其前缀后的名字。
  **不依赖服务清单**，也不猜测"哪一段是服务名"；两个候选都命中时按多绑定处理（拒绝优先）。
- `decideScope(entry, username): ScopeVerdict`
  - 规则顺序：`disable` → `everyone` → 用户名命中 → 拒绝（空 `scope` 走拒绝）；
  - `scope` 元素归一化：非字符串 / 空串丢弃并计入 `ignored`；
  - 返回 `{ kind: 'allow' | 'deny', rule, code, reason }`，**不做 IO、不碰文件**。
- `RESERVED = ['everyone', 'disable']`：保留标记不参与用户名比较。

### 3. `domain/scope-guard/catalog.ts`（新增，约 130 行）

- `loadGuardCatalog(agentDir): { snapshot: GuardSnapshot; warnings: string[] }`
  - 对每个本体目录：读 `ontology.yaml` → `metadata.scenario_name` / `ontology_name`（展示名，缺失回退目录名）
    与 `behaviors[].name`；读 `securities.yaml` → `securities[]` 的 `action_name` 与 `scope`；
  - 行为 → 条目绑定按 `normalizeName(action_name)` 精确匹配；**不猜、不模糊匹配**；
  - 每本体 `status` ∈ `ok` / `no_securities`（文件缺失或不可解析）/ `no_entry`（该行为无条目）；
    后两者在判定期落到 `ONTOLOGY_SCOPE_UNAVAILABLE`；
  - `behaviors[].name` 缺失或非字符串 → 丢弃并告警；同名行为重复 → 保留首个并告警；
  - 返回 `byBehavior: Map<string, BehaviorBinding[]>`（同一行为名可挂多个本体）。
- `catalogSignature(agentDir): string`：`statSync({agentDir}/ontology).mtimeMs`，缺失为 `missing`；
  **只一次 stat**，供 `guard.ts` 判断是否需要重载。

### 4. `domain/scope-guard/guard.ts`（新增，约 120 行）

- `createScopeGuard({ agentDir, username, warn? }): ScopeGuardPort`
  - 惰性加载：首次 `check` 才读盘；之后每次先比签名，变了才重读；
  - `check` 合成决策：
    - 未命中 → `not_ontology`；
    - 多个绑定 → 依 `catalog` 的稳定顺序收集判定，**任一 deny 即 deny**（同码时取第一个），并 `warn` 一次冲突；
    - 单条 deny → 生成中文文案（`message.ts` 内联于本文件，唯一来源）。
  - 全函数 `try/catch` 兜底：任何异常 → `deny(ONTOLOGY_SCOPE_UNAVAILABLE)` + `warn`，**永不抛**。
- 文案模板（不含授权清单）：
  - 未授权（含 `disable`，2026-11-09 合并）：`本体行为「{本体}/{行为}」未授权给当前用户，已拒绝执行。`
  - 管控不可用：`本体行为「{本体}/{行为}」的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。`

### 5. `infra/tool-scope-guard.ts`（新增，约 65 行）

- `guardTools(tools, guard, ctx): AgentTool[]`：逐工具包装（**每工具仅一次**），保留 `name` / `label` /
  `description` / `parameters` / `executionMode`（HITL 的 `sequential` 不被破坏）。
- `wrapToolWithScopeGuard(tool, guard, ctx)`：
  - `check` 为 `deny` → **不调**原 `execute`；写日志 `scope_guard.denied`（`warn`，配置异常时 `error`）；
    返回 `toolErrorResult(message, code)`；
  - 其他情况原样透传 `(toolCallId, params)`；
  - 本文件**不含**任何本体名、工具名、YAML 解析或规则判断（解耦红线）。
- 拒绝日志字段：`event`、`code`、`user_id`、`agent_name`、`thread_id`、`tool_name`、`ontology`、`behavior`、
  `scope_kind`、`scope_size`；**不含**授权用户名清单与工具入参。

### 6. `infra/agent-factory.ts`（改，3 处）

- `create()` 内构造 guard（`agentDir` 已有，`username = key.userId`，`warn` 接到 `logger.warn` 并带 `alert: true`）；
- 装配末尾：`const guarded = guardTools(tools, scopeGuard, { logger, userId, agentName, threadId })`；
- `req.runtime.availableTools` 与 `runAgentLoopEvents({ tools })` 改用 `guarded`（名称不变，语义不变）。
- **不动**：内置工具构造、MCP 白名单、HITL 包装分支、系统提示装配、降级分支。

## 实施顺序

1. **低层工具**：新增 `domain/ontology-files.ts`；把 `intent-focus/ontology-loader.ts` 改为复用；跑既有 loader 单测（应与改动前逐字一致）。
2. **纯策略**：新增 `scope-guard/types.ts`、`policy.ts`；补规则矩阵与名称匹配单测。
3. **加载与缓存**：新增 `catalog.ts`、`guard.ts`、`index.ts`；补坏文件、缺文件、缺条目、多本体、签名重载单测。
4. **包装器**：新增 `infra/tool-scope-guard.ts`；补放行 / 拒绝 / 透传 / 保形 / 日志单测。
5. **端到端接线**：`agent-loop` 用假 `streamFn` 驱动一次被拒调用，断言工具未执行、`tool_call_end.status='error'`、文案与错误码正确。
6. **装配**：`agent-factory.ts` 3 处改动；跑全量单测与集成测试确认零回归。
7. **契约与文档**：新增 `contracts/scope-guard.md`；在 `runtime-api-delta.md` 登记 R27；回写 `spec.md` 修订记录（如实现期出现口径变化）。
8. **门禁与冒烟**：本地单命令门禁 + `quickstart.md` 的六类手验。

## 测试策略

### 单元测试（不依赖 MCP / LLM）

| 文件 | 覆盖 |
|---|---|
| `scope-guard-policy.spec.ts` | 四条规则；`disable` 优先于 `everyone`；空 `scope` 拒绝；非字符串元素忽略；大小写与空白；`scope` 含未知标记按用户名比较；用户名为空 → 拒绝；服务前缀剥离（含 `a__b__c`）；无前缀原样；行为名归一化 |
| `scope-guard-catalog.spec.ts` | 两文件齐全；缺 `securities.yaml` → `no_securities`；坏 YAML；`securities` 非数组；`scope` 非数组；`behaviors` 缺 `name`；同名行为重复；多本体同名行为；符号链接目录跳过；中文路径；空目录不抛错；签名变化触发重载；签名不变不重读（用读取计数桩） |
| `tool-scope-guard.spec.ts` | 放行：原 `execute` 收到同一 `(toolCallId, params)`；拒绝：原 `execute` **零调用**、返回 `details.toolError.code` 正确、文案含本体与行为；`not_ontology` 透传；`label` / `description` / `parameters` / `executionMode` 保形；日志字段齐全且不含用户名清单；`guard.check` 抛错时包装器不崩（降级为拒绝）；进程内 loop：拒绝 → `tool_call_end.status='error'` |

### 集成测试

**无新增**：本特性不新增/不修改任何 HTTP 端点与 SSE 事件，既有 `chat-*` 集成测试即回归门禁。
端到端"模型真的调用 MCP 工具后被拒"的自动化需要 MCP 桩服务（仓库目前只有 401 桩），
**本期不引入**，由 `quickstart.md` 场景 B/C/E 手验覆盖，并在下文风险表登记。

### 质量门禁（本地，单命令）

```bash
cd agent-backend
npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build
```

## 覆盖率缺口处置结论（宪章「仍生效的待办与口径」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7 个）与 `src/composables/**`（13 个）尚无同名测试，
其**补测顺序与范围** MUST 在下一个特性的 `plan.md` 给出结论，且 MUST NOT 发起专项。

**本次结论**：

| 项 | 结论 |
|---|---|
| 是否触及 `frontend` | **否**（本特性只改 `agent-backend`，拒绝复用既有失败卡片通道） |
| 本次范围 | 不新增、不调整任何前端补测；不为存量模块补测 |
| 顺序（沿用先例，不变更） | ① 网络与契约边界：`api/http.ts`、`api/threads.ts`、`api/files.ts`、`api/produced.ts`；② 产出与预览：`usePreview.ts`、`useWorkspace.ts`；③ 会话与流式：`useChatPanel.ts`、`useThreads.ts`、`useSessionSearch.ts`；④ 其余 |
| 机制 | "触达即补"：仅当某前端模块在后续特性中被改动时，才为其补同名测试；本特性零触达，故零补测 |
| 全局地板 | 只可随补测上调，MUST NOT 下调 |

## 平台差异风险登记（宪章原则三）

**登记结论：本次存在文件系统相关行为，风险已识别并有对应措施。**

| 风险 | 表现 | 措施 |
|---|---|---|
| Windows 目录名大小写不敏感 vs Linux 敏感 | 本体目录 `原材料采购和库存` 与行为名比对不受影响（只在内存比较字符串），但**目录枚举**需正确 | 只在内存做名称归一化；目录枚举用真实 `readdir` 结果，不做路径猜测 |
| 中文路径 | `statSync` / `readFileSync` 在 Windows + 中文路径下可用；删除类操作才有已知缺陷 | 本次只读不删；路径一律 `node:path.join` |
| 行尾符（CRLF / LF） | `securities.yaml` 由平台物化，行尾可能不同 | YAML 解析对行尾不敏感；不按行切分文本 |
| 符号链接逃逸 | 物化产物应为普通文件/目录 | `ontology-files.ts` 统一拒绝符号链接（与意图聚焦同口径） |

部署后冒烟沿用既有 `quickstart` 打点确认服务可达；**冒烟不作为测试结论**。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 工具名与行为名不同名（命名漂移） | 该工具被当作"非本体行为"放行（漏拦） | `FR-003` 已显式登记为唯一漏拦面；`quickstart.md` 场景 F 核对真实服务；后续可由平台侧"工具—行为"对照表增强（本期不做） |
| 同步读盘阻塞事件循环 | 首字/工具时延抖动 | 只读小文件；实例内缓存 + 目录签名；稳态仅一次 `stat`；`SC-004` 量化门禁 |
| fail-closed 放大部署错误 | 坏 `securities.yaml` 会让该本体所有行为不可用 | 告警级日志 + 用户可读文案（指引重新部署）；平台侧两文件强制成对下发，异常属部署缺陷 |
| 多本体同名行为 | 归属歧义 | 拒绝优先 + 冲突 warning；不猜"更相关"的本体 |
| 意图聚焦 loader 重构引入回归 | 016/019 行为改变 | 重构只搬移枚举/解析，不动字段建模；既有 `intent-focus-loader.spec.ts` 全量通过为验收条件 |
| 无 MCP 端到端自动化 | 接线错误可能只在手验暴露 | 进程内 loop 端到端覆盖"拒绝 → 标红"；装配处仅 3 行且由包装器单测覆盖透传语义；手验清单固定 6 个场景 |
| 判定缓存读到半更新内容 | 同一轮内策略不一致 | 部署为目录级原子改名；每文件整体解析，不流式读；签名变化后整份重载（不做增量补丁） |

## 复杂度跟踪

| 违规（潜在） | 为什么需要 | 更简单的替代为何不可行 |
|---|---|---|
| 新增 `domain/scope-guard/**` 5 个文件 | 规则、加载、缓存、文案、类型职责不同，且要求可独立测试 | 单文件会超 500 行且把纯策略与 IO 混在一起，无法用假数据覆盖规则矩阵 |
| 新增 `domain/ontology-files.ts` 并改动意图聚焦 loader | 目录枚举 + 符号链接拒绝是**安全相关规则**，两处各写一套必然漂移（原则二） | 若在新模块里复制一份：短期零改动，但"哪些目录算本体"会出现两个解释，且符号链接校验可能只在一侧修好 |
| 每次判定一次 `statSync` | R7 指纹不含 `ontology/**`（已核对），仅靠实例换代无法覆盖"只换本体"的部署 | 不做签名：部署后必须重启或等实例回收，违背 `FR-023`；每调用全量重读：IO 抖动且违反 `SC-004` |
| 同步文件读取（首调用） | 与意图聚焦一致；文件极小（KB 级）；异步化会扩散 Promise 链路到 `execute` 前的装配 | 异步预加载需要额外的生命周期钩子（实例创建、部署回调），收益低于复杂度 |
| fail-closed 拒绝策略 | 安全语义要求"无法判定即不执行" | fail-open 会把配置缺陷变成静默越权，且与规格 `FR-022` 冲突 |
| 平台差异风险 | 见上节 | — |

## 规格修订（plan 阶段事实校正）

1. **`FR-003` 匹配形态**（已回写 `spec.md` 修订记录，2026-11-08）：由"去掉服务前缀后匹配"细化为
   "**完整名 + 去首个 `__` 前缀名**两种形态各试一次"，任一命中即本体行为。原因：装配层加前缀是既有事实，
   但"工具名本身就是行为名"的服务同样存在；只按一种形态匹配会造成无解释的漏拦。行为口径不变。
2. **`FR-023` 的生效口径**：部署为**目录级原子改名**，闸门按 `ontology` 目录签名重载，因此"下一次工具调用即生效"
   在实现上成立（即使处于同一轮对话）。此项与规格原文一致，无需改写；仅在本计划登记实现依据。
3. **`FR-006` 的绑定口径**：行为与 `action_name` 的绑定只做"归一化后精确匹配"，**不引入**编辑距离、别名或
   服务名推断。规格未要求模糊匹配，本项为显式约束，不改变行为。
4. **`SC-004` 的测量位**：已按口径表实测并回填（2026-11-08，5 本体 × 8 行为，本机 Windows）：
   已缓存 **P95 ≈ 0.02~0.03ms**（中位 0.011~0.014ms），未缓存首次 **6.2~17.6ms**；两档分别满足 ≤10ms / ≤50ms。
   结果同时登记在 `spec.md` 的 `SC-004` 表与 `tasks.md`「基线记录」。
5. 除第 1 条已回写规格外，其余均不改变用户可见行为，`FR` / `SC` 编号与语义保持原样。

## 完成定义

- [ ] `spec.md` 的 `FR-001`~`FR-025`、`SC-001`~`SC-008` 均有实现或测试对应，逐条可勾。
- [ ] `domain/scope-guard/**` 的 import 清单中不含 infra / intent-focus / mcp / pi / fastify / pino（可用 grep 断言）。
- [ ] `agent-factory.ts` 的改动只落在装配 3 处，无其他行为变化。
- [ ] 六类判定（everyone / disable / 含本人 / 仅他人 / 空 scope / 缺条目）在单测矩阵中全绿。
- [ ] 拒绝路径：工具零执行、零 MCP 请求、零业务写入、卡片标红、一条结构化日志。
- [ ] 非本体工具、未部署本体的数字人零行为变化（既有单测与集成测试全绿）。
- [ ] `contracts/scope-guard.md` 与 `runtime-api-delta.md` R27 已登记；`quickstart.md` 六场景可复现。
- [ ] 本地门禁全绿；新增模块覆盖率 ≥ 80%；`SC-004` 实测值已回填。
