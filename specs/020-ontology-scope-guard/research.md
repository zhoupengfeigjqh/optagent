# 研究记录：本体行为权限闸门

**输入**：[spec.md](./spec.md)（`FR-001`~`FR-025`）、[plan.md](./plan.md)

**范围**：只涉及运行环境 `agent-backend`。管理平台与前端在本次无改动，故不产生新的技术选型。

---

## 事实核对（先查现状，再做决策）

| # | 事实 | 证据 | 对设计的影响 |
|---|---|---|---|
| F1 | 运行环境**从未读取** `securities.yaml`；全仓 `action_name` / `confirm_content` / `securities` 在 `agent-backend/src/**` 零命中 | 全目录检索 | 这是新增能力，不是修正既有逻辑；无兼容负担 |
| F2 | `securities.yaml` 由平台随本体整包物化到 `users/{用户}/agents/{数字人}/ontology/{场景}/{本体}/`，平台**不解析语义** | `admin-backend/src/domain/deploy/materialize.ts`、`admin-backend/src/domain/ontology/store.ts` | 闸门只能读部署产物；平台侧零改动 |
| F3 | 样例本体 8 个 `behaviors[].name` 与 `securities[].action_name` **一一对应** | 用 `yaml` 解析 `生产调度/原材料采购和库存` 两份文件比对，`missing=[]`、`extra=[]` | "缺条目"是异常态而非常态，fail-closed 不会误伤常规部署 |
| F4 | 暴露给模型的 MCP 工具名形如 `{服务名}__{工具名}`；内置工具名为 `read_file` 等小写下划线形态 | `infra/agent-factory.ts`（构造 `t.name.startsWith(`${server.name}__`)`）、`domain/next-actions.ts` 注释与 `isCompliantPrompt` | 归属识别必须剥前缀；内置工具名天然不与本体行为（CamelCase）同名 |
| F5 | "当前用户名"在全系统唯一存在形式是用户标识：部署路径 `users/{用户名}/`、会话归属、用量统计、平台 `user_id` 均用同一个值 | `domain/dirs.ts`、`domain/current-user.ts`、`admin-backend/src/routes/users.ts` | 闸门用实例的 `key.userId`，无需任何映射表或新增字段 |
| F6 | 配置指纹只覆盖 `SOUL.md` / `TOOL.json` / `MCP.json` / `scenario.json` + `skills/**`，**不含 `ontology/**`** | `domain/config-fingerprint.ts` | 只改本体的部署不会因指纹换代；闸门必须自带失效判据 |
| F7 | 部署是"目录级原子改名"（整只数字人目录替换） | `admin-backend/src/infra/opt-agent-writer.ts` | 读侧要么看到旧目录要么看到新目录，不会读到半更新内容；目录 mtime 必然变化，可作失效签名 |
| F8 | 工具失败有统一通道：`toolErrorResult(message, code)` → `details.toolError` → `afterToolCall` 翻 `isError` → 卡片标红；**禁止用抛异常表达业务失败** | `domain/tool-error.ts`、`infra/tool-intercept.ts`、`infra/agent-loop.ts` | 拒绝必须走该通道；不能新造第二种失败表达 |
| F9 | 工具包装已有先例：`wrapToolWithInteraction` 在装配期逐工具包装，且不含任何具体工具名 | `infra/tool-intercept.ts` 文首"解耦红线" | 权限闸门复用同一形态：`infra` 只做包装，策略在 `domain` |
| F10 | 测试环境无 MCP 桩服务（只有 401 桩），集成测试通过 `app.inject` + 假 provider 运行 | `tests/unit/mcp-client-headers.spec.ts`、`tests/integration/builtin-tools.spec.ts` | 端到端"MCP 调用被拒"只能手验；自动化覆盖到"包装器 + 进程内 loop" |
| F11 | 意图聚焦已有本体目录枚举 + YAML 读取实现（含符号链接拒绝、坏文件降级） | `domain/intent-focus/ontology-loader.ts` | 同一规则不应两处实现，需抽出低层工具（D2） |

---

## D1 解耦形态：纯领域包 + 端口 + 单一适配器 + 3 处装配行

**Decision**：权限判断做成独立领域包 `domain/scope-guard/**`，只对外暴露 `ScopeGuardPort`（`check` / `invalidate`）
与决策类型；`infra/tool-scope-guard.ts` 是唯一 `AgentTool` 包装器；`agent-factory.ts` 只增加"构造 + 包装 + 传参"三处。

**Rationale**：
- 判定逻辑（四条规则）与执行环境（工具、MCP、HITL）**变化频率不同**：规则会随治理口径调整，工具装配不会；
  两者分开后，规则改动只碰 `domain`，且可用纯数据单测覆盖全部矩阵。
- 用户明确要求"不能与当前代码高耦合"。把判定写在 `agent-factory` 里最短，但会让装配函数继续膨胀，
  且规则无法脱离工具对象测试——正是要避免的耦合。
- 与既有先例一致：HITL 的包装器同样只做包装，不掺业务。

**Alternatives considered**：
1. **直接写在 `infra/agent-factory.ts`**：改动最少，但规则与装配混在一起，`agent-factory` 已承担过多职责，
   单测只能通过构造工具间接验证；否决。
2. **写在 `infra/mcp/mcp-tool-adapter.ts`**：只覆盖 MCP 工具，内置工具漏判（规格要求一视同仁）；
   且适配器与授权策略耦合，MCP 协议变更会牵连权限逻辑；否决。
3. **独立微服务 / 独立进程**：权限判定是内存查表 + 小文件读取，引入进程间调用只会增加故障点与延迟；否决。
4. **在 `run-consume` 前置批量判定**：工具调用发生在 loop 内部，前置拿不到具体调用；且拒绝必须回到单次调用的结果里；否决。

---

## D2 目录枚举与 YAML 读取抽为唯一来源 `domain/ontology-files.ts`

**Decision**：新增 `domain/ontology-files.ts`，提供 `listOntologyDirs` 与 `readYamlObject`；
`domain/scope-guard/catalog.ts` 与 `domain/intent-focus/ontology-loader.ts` 都改用它。

**Rationale**：
- "什么是本体目录""哪些文件可以读"是**安全相关规则**（符号链接逃逸、真实目录校验、坏文件降级）。
  两处各写一套，迟早一边修好一边没修（宪章原则二：同一规则唯一来源）。
- 该工具**不含业务判断**（不认行为、不认 scope），因此两个特性共用它不构成耦合。

**Alternatives considered**：
1. **在 `scope-guard` 内复制 15~60 行枚举/解析**：短期零改动，但规则漂移风险高；否决。
2. **让 `scope-guard` 依赖 `intent-focus/ontology-loader`**：会把权限闸门绑到一个带 Laya、SOUL 开关、
   发散建模的**可选特性**上——权限是常开能力，不能依赖一个可能整块下线的特性；否决。
3. **把两特性合并成一个"本体域"大模块**：范围失控，且 016/019 的模型（概念/关系/候选/提示）与权限无关；否决。

**兼容性**：重构只搬移枚举与解析，不改变意图聚焦的字段建模与告警关键片段
（`invalid_yaml` / `not_object` / `not_regular_file` / `unreadable` 保持不变），既有 `intent-focus-loader.spec.ts` 必须全量通过。

---

## D3 归属识别：去服务前缀 + 归一化 + 与 `behaviors[].name` 精确匹配

**Decision**：判定时同时查两个候选键——**完整工具名**与**去掉第一个 `__` 前缀之后的名字**（均去首尾空白、转小写），
与同样归一化的 `behaviors[].name` 比对；任一命中即"本体行为"，两个都命中按多绑定处理；都匹配不到即"非本体行为"。

**Rationale**：
- 工具名是运行环境唯一能拿到的"模型调用标识"，而服务名前缀是装配层人为加的（F4），必须剥掉才能对上行为名；
- 归一化（去空白 + 小写）避免 `QueryInventory` / `queryinventory ` 这类书写差异造成**漏拦**——安全语义下"漏拦"比"误拦"严重；
- 精确匹配而非模糊匹配：权限判断不能靠相似度，否则无法解释"为什么这次放行了"。

**Alternatives considered**：
1. **平台下发"工具→行为"映射表**：平台当前无此数据，需要改管理端与物化契约（跨两侧大改）；且映射本身会漂移；否决。
2. **用工具 `description` 做语义匹配**：不可审计、结果不稳定；否决。
3. **按 MCP 服务名推断本体**（一个服务一个本体）：服务与本体并非一一对应，且内置工具无服务；否决。

---

## D4 配置异常一律 fail-closed（缺条目 / 缺文件 / 坏文件 / 结构非法）

**Decision**：命中本体行为但取不到可用 `scope` 时 → 拒绝，错误码 `ONTOLOGY_SCOPE_UNAVAILABLE`，日志告警级。

**Rationale**：
- 安全管控的失败方向应当朝"不执行"；fail-open 会把一次部署缺陷变成**静默越权**，且没有任何信号；
- F3 证明正常部署下条目齐全，因此该分支只在真正异常时触发，不会误伤日常；
- 与规格 `FR-022` 一致。

**Alternatives considered**：
1. **fail-open + 告警**：对用户更"顺滑"，但违背管控目的；否决。
2. **按"无条目 = 未配置 = 放行"**：等于给所有漏配条目开后门；否决。
3. **启动期校验并拒绝加载数字人**：影响面过大（一个坏文件让整只数字人不可用），且与"坏文件不中断"的既有降级口径冲突；否决。

---

## D5 多本体同名行为：拒绝优先

**Decision**：同一行为名命中多个本体时逐条判定，任一拒绝即拒绝；同码取稳定顺序的第一条，并记一条冲突 warning。

**Rationale**：
- 归属有歧义时，放宽等于给"重名"留后门；
- 判定顺序按场景名/本体名排序，结果可复现，便于解释与排障。

**Alternatives considered**：首个命中（取决于目录遍历顺序，不可解释）；合并 scope（"任一本体放行即放行"，等于最宽松者胜）；均否决。

---

## D6 缓存与失效：实例内快照 + 每次判定比对 `ontology` 目录签名

**Decision**：guard 首次 `check` 时加载快照并缓存；之后每次 `check` 先 `statSync({agentDir}/ontology).mtimeMs`
比对签名，变化即整份重载。**不依赖配置指纹换代**。

**Rationale**：
- F6：指纹不含 `ontology/**`，只改本体的部署不会让实例换代——若只靠实例缓存，`FR-023`（部署后下一次调用即生效）不成立；
- F7：部署是目录级原子改名，目录 mtime 必变，且读侧不会看到半更新内容，签名判据成立；
- 稳态成本仅一次 `stat`，远低于"每次全量读 YAML"，也满足 `SC-004`。

**Alternatives considered**：
1. **只靠 R7 指纹**：漏掉"只换本体"的部署，且实例可能在 30 分钟内不回收（静默用旧策略）；否决。
2. **每次判定全量重读**：5 个本体 × 2 文件 × 每次调用，IO 抖动且违反时延目标；否决。
3. **定时轮询 / 文件监听**：常驻句柄与生命周期管理，收益不抵复杂度（Windows 监听行为另有差异）；否决。
4. **把 `ontology/**` 加入 `computeConfigFingerprint`**：会改变既有换代语义（一次部署内所有实例行为变化），
   影响面超出本特性；且仍无法覆盖"运行中目录被替换"的即时生效；否决（登记为备选）。

---

## D7 与人工确认（HITL）的顺序：权限闸门在外

**Decision**：先判权限，再走人工确认；被拒不出确认弹窗。

**Rationale**：让用户为一次注定失败的调用点确认是浪费，并会误导"确认了就能跑"；被拒也不应产生交互挂起点。

**Alternatives considered**：闸门在内（用户先确认再被拒）——体验更差且浪费一次交互；否决。

---

## D8 失败表达：复用 `toolErrorResult`，不抛异常

**Decision**：拒绝返回 `toolErrorResult(message, code)`，`details.toolError` 被打标，`afterToolCall` 翻成 `isError`。

**Rationale**：F8 是既有唯一通道；抛异常会被 SDK 覆盖整个结果（结构化信息丢失），且模型看不到既定文案。

**Alternatives considered**：抛 `Error`（丢失结构化信息、与既有口径冲突）；新增 SSE 事件（前端与契约双双改动，收益为零）；否决。

---

## D9 两个专用错误码

**Decision**：`ONTOLOGY_SCOPE_DENIED`（未授权，**含 `scope` 含 `disable`**）、
`ONTOLOGY_SCOPE_UNAVAILABLE`（管控配置不可用）。

**Rationale**：两类原因对应两种处置动作（找管理员授权 / 重新部署本体），合并成一个码会让排障与产品提示都退化；
命名沿用既有"领域前缀 + 语义"风格（`HITL_REJECTED` / `HITL_EXPIRED` / `HITL_ABORTED`）。

> **修订（2026-11-09）**：原设计有第三个码 `ONTOLOGY_BEHAVIOR_DISABLED`（"已停用"）。实践发现
> "被停用"与"没被授权"对用户是同一个动作（找管理员），分两个码反而让前端多一条映射、产品多一句难解释的话。
> 判定优先级不变，区分下沉到 `reason: 'disabled'` / `scope_kind: 'disable'`。

**Alternatives considered**：~~单一 `SCOPE_DENIED`~~（原判：无法区分"停用"与"未授权"，日志与用户提示都变糊；
2026-11-09 修订：该顾虑由 `reason` / `scope_kind` 内部字段解决，故对**外**合并为单一"未授权"码）；
沿用 HTTP 错误码体系（工具层不是 HTTP）；否决。

---

## D10 文案与日志分离

**Decision**：模型/用户可见文案只讲"哪个本体、哪个行为、哪类原因"，**不含** `scope` 清单；
日志记 `scope_kind`（`everyone` / `disable` / `users` / `unavailable`）与 `scope_size`，不落具体用户名。

**Rationale**：授权配置属于管理信息，泄露给终端用户既无必要也有风险；排障所需的"是否配了人、配了几个"已足够定位，
具体名单可由管理员直接看 `securities.yaml`。

**Alternatives considered**：文案列出授权用户（便于用户自助判断，但泄露配置）；日志全量落 scope（便于排障，但与"最小必要"冲突）；否决。

---

## D11 同步文件读取

**Decision**：`catalog` 使用同步 `fs`（与 `intent-focus/ontology-loader` 一致），失败即降级为空快照 + 告警。

**Rationale**：文件体量小（KB 级）、有缓存、首次加载发生在工具调用前；异步化会把 Promise 引入
`createScopeGuard` 的构造与 `check` 契约，扩散到装配层。

**Alternatives considered**：异步预加载（需生命周期钩子与竞态处理）；后台线程（Worker）读取（进程模型变复杂）；否决。

---

## D12 测试分层与已知缺口

**Decision**：
- `domain` 纯策略与加载：临时目录单测，覆盖规则矩阵、坏文件、符号链接、中文路径、缓存与重载；
- `infra` 包装器：假 `AgentTool` + 假 `ScopeGuardPort`；
- 接线：进程内 `runAgentLoopEvents` + 假 `streamFn`，验证"拒绝 → `isError` → `tool_call_end.status='error'`"；
- **不新增 MCP 端到端自动化**（无桩服务，F10），以 `quickstart.md` 六场景手验补位。

**Rationale**：能在纯数据层证明的正确性不做成集成测试；唯一无法自动化的一环如实登记，不假装覆盖。

**Alternatives considered**：手写 MCP streamable-http 桩服务（工作量大、脆弱、与权限逻辑无关）；只做单测不做 loop 接线测试
（会漏掉 `isError` 翻牌，2026-10-29 已有先例证明该环节会静默退化）；否决。

---

## 无新增依赖声明

- 解析：复用 `yaml`（已在 `intent-focus` 与 `agent-instance` 使用）；
- 文件：`node:fs` / `node:path`；
- 工具类型：`@earendil-works/pi-agent-core`（仅 `infra` 层引用类型）；
- 测试：Vitest 5 + `os.tmpdir()`。

`package.json` **零变更**。
