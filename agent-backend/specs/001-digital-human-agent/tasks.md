# Tasks: 数字人Agent对话后端

**Input**: Design documents from `/specs/001-digital-human-agent/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、
[data-model.md](./data-model.md)、[contracts/](./contracts/)、[quickstart.md](./quickstart.md)

**Tests**: 章程 III「测试覆盖（不可协商）」要求每个功能模块有单元测试、核心逻辑 ≥80%、
覆盖正常/异常/边界三类场景——故各故事均含测试任务，且先写测试确认失败再实现。

**技术依据**: 全部选型见 [sel_tech.md](../../../docs/decisions/sel_tech.md)；
Node.js 20+/TypeScript ESM、Fastify 5、`@earendil-works/pi-agent-core@0.85.1`（精确锁定）、
pi-ai deepseek provider、better-sqlite3、pino、zod、vitest。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事（US1–US5 对应 spec.md）

---

## Phase 1: Setup（项目初始化）

- [x] T001 创建项目骨架：package.json（"type":"module"）、tsconfig.json（strict 全套 + noUncheckedIndexedAccess）、目录结构按 plan.md（src/{routes,domain,infra}、tests/{unit,integration,helpers}、scripts/、docs/）
- [x] T002 安装依赖：生产依赖精确锁 `@earendil-works/pi-agent-core@0.85.1`、`@earendil-works/pi-ai@0.85.1`；fastify@^5、@fastify/multipart、@fastify/cors、@modelcontextprotocol/sdk、better-sqlite3（锁版本）、pino、pino-pretty、zod、yaml、xlsx、pdfjs-dist；开发依赖 typescript、tsx、vitest、eslint、@typescript-eslint/*、prettier
- [x] T003 [P] 配置 ESLint（typescript-eslint 推荐集）+ Prettier，package.json 加 `lint`/`format`/`dev`（tsx watch）/`build`（tsc）/`start`（node --env-file=.env dist/server.js）/`test`/`test:integration`/`smoke` 脚本
- [x] T004 [P] 编写 .env.example（DEEPSEEK_API_KEY 兜底、PORT、OPT_AGENT_ROOT、POOL_SIZE、IDLE_TIMEOUT_MS、MCP_TIMEOUT_MS、UPLOAD_MAX_MB、READ_TRUNCATE_KB、SHUTDOWN_GRACE_MS）与 config.yaml 示例（models 列表：model/api_key/base_url，默认取第一项）及 .gitignore（.env、config.yaml、.opt-agent/、dist/、node_modules/）

---

## Phase 2: Foundational（阻塞性基础设施）

**⚠️ 本阶段完成前，任何用户故事不得开工**

- [x] T005 实现 src/config.ts：zod schema 双源校验——.env（运行参数）+ config.yaml（models 列表，yaml 包解析）；合并规则（条目 api_key 优先、DEEPSEEK_API_KEY 兜底、默认模型=第一项；models 缺失/为空即拒启动），导出冻结配置对象；单元测试 tests/unit/config.test.ts（含双源优先级、非法值拒绝、默认值填充）
- [x] T006 [P] 实现 src/logging.ts：pino 按日写 .opt-agent/logs/app-YYYY-MM-DD.log，child logger 规范字段（user_id/thread_id/agent_name/event/duration_ms），告警带 alert:true；Token 审计 child logger 写 usage-*.log
- [x] T007 [P] 实现 src/domain/current-user.ts："当前用户"抽象（本期固定返回 admin，接口按 JWT 预留）；单元测试
- [x] T008 实现 src/server.ts 骨架：Fastify 装配、全局 setErrorHandler（统一错误 envelope {error:{code,message}}，语义化状态码）、@fastify/cors、@fastify/multipart（限 50MB）、路由占位注册、健康探针
- [x] T009 实现目录初始化模块（.opt-agent 根、users/admin/user-data/ 下 7 业务目录+tmp+shared+threads、logs/ 惰性创建）；单元测试（重复初始化幂等）
- [x] T010 实现 src/domain/file-access.ts：FileAccess 代理层——路径规范化（resolve 后判白名单，防 .. 与符号链接穿越）、目录权限矩阵（7 业务目录+shared 只读、tmp 可写须 thread_id 前缀）、违规抛 PermissionError 并记日志；单元测试 tests/unit/file-access.test.ts 覆盖权限矩阵全组合与穿越攻击用例
- [x] T011 实现 src/infra/usage-db.ts：better-sqlite3 全局单库 usage.db，建表 usage_records 与索引（thread_id/agent_name/created_at），实现 domain 的 UsageStore 接口（record 失败记日志不抛出）；单元测试用临时库
- [x] T012 **竖切原型（最险点验证，最高优先级）**：scripts/smoke.ts 最小脚本——pi-agent-core 低层 runAgentLoop + pi-ai deepseek provider（模型取 config.yaml 第一项，本期 `deepseek-v4-flash-vision-exp`）+ thinking 开/关 + AbortController 中断，真 API key 各跑一遍，确认事件粒度（thinking/content/tool 调用）与中断语义符合预期；**发现 API 与假设不符时回到 research.md 修订，再继续**
- [x] T013 实现 src/infra/llm/pi-ai-provider.ts：LlmProvider 接口（contracts/internal-interfaces.md §1）的 pi-ai 实现，thinking 开关映射为请求级参数，usage 从 done 事件提取；配套 tests/helpers/fake-llm-provider.ts（可编程事件节奏：推送 N 段→停住→等信号→再推，供集成测试复现断连/stop 时序）
- [x] T014 实现 src/infra/agent-loop.ts：pi 低层 runAgentLoop 调用封装——入参（systemPrompt、拼装后 messages、工具集、signal），出参统一为 LlmEvent 异步迭代；工具执行经 file-access 代理的工具实现
- [x] T015 实现 src/domain/agent-pool.ts：PoolStore 内存实现——key=(user_id,agent_name)，LRU 仅淘汰空闲实例（active_threads=0）、空闲超时 10min、池满且无空闲 → POOL_EXHAUSTED；单元测试（淘汰顺序、忙碌实例豁免、池满拒绝、空闲超时）
- [x] T016 实现 src/domain/current-agent.ts：用户当前选中数字人状态（select/exit/查询，内存 Map；重复 select 幂等、**选中他人直接覆盖**——2026-09-10 修订，无需先 exit）；单元测试

**Checkpoint**: 地基就绪（竖切原型已验证 pi 低层用法），用户故事可开工

---

## Phase 3: User Story 1 - 与数字人流式对话 (P1) 🎯 MVP

**Goal**: 选定数字人后发送消息，SSE 流式返回（thinking/content/done/error）；
断连照跑落盘；stop 中断；3 并发上限；MCP 降级不阻断。

**Independent Test**: quickstart.md 场景 1（select → 发消息 → thinking 流 →
断连 20s 后历史完整 → stop 中断 → 3 并发/第 4 个 409）。

### Tests for User Story 1（先写，确认失败）

- [x] T017 [P] [US1] run-manager 状态机单元测试 tests/unit/run-manager.test.ts：先画 5 事件源（推理推进/断连/stop/关机/报错）× 状态（running/draining/done/aborted/error）转移表再编码；用 fake-llm-provider 覆盖"推一半断开→落盘完成""推一半 stop→丢弃但记 usage""关机 draining→当前消息写完"
- [x] T018 [P] [US1] agent-instance 配置加载测试 tests/unit/agent-instance.test.ts：SOUL.md+skills frontmatter 拼 System Prompt、TOOL.json 过滤启用工具、配置损坏跳过并告警
- [x] T019 [P] [US1] 对话链路集成测试 tests/integration/chat.test.ts：app.inject + fake-llm-provider 覆盖 SSE 四类事件序列、断连续跑落盘、stop、THREAD_RUN_ACTIVE/POOL_EXHAUSTED/THREAD_BUSY_LIMIT 三条 409

### Implementation for User Story 1

- [x] T020 [P] [US1] 实现 src/domain/agent-instance.ts：读取 agents/{name}/ 的 SOUL.md、skills/*/SKILL.md（仅 YAML frontmatter）、TOOL.json、MCP.json，产出配置包（systemPrompt/tools/mcp_configs）
- [x] T021 [US1] 实现 src/infra/mcp/mcp-manager.ts 与 mcp-tool-adapter.ts：McpManager 接口实现——stdio + Streamable HTTP 传输、**异步并发建连不阻断实例就绪**、unavailable 降级标记、调用 30s 超时+重试 1 次、McpUnavailableError → 自然语言降级提示；单元测试用 mock transport
- [x] T022 [US1] 实现 src/domain/run-manager.ts：Run 生命周期管理——每 thread 单活跃 run、事件总线（SSE 订阅者+落盘器订阅者广播）、AbortController 登记、断连仅退订+draining 收尾标记（不开新 loop 步骤）、done 后 content 落盘+usage 记录、aborted 丢弃消息但记 usage；依赖 T013/T014
- [x] T023 [US1] 实现 src/domain/history.ts：history.jsonl 追加写（仅 user/assistant）、坏行跳过、整体损坏重建并告警（FR-029）；单元测试 tests/unit/history.test.ts（坏行/整体损坏/并发追加）
- [x] T024 [US1] 实现 src/routes/chat.ts：POST /api/threads/:id/messages（SSE：reply.raw 订阅 run 事件流，四类事件映射；409 判定链）+ POST /api/threads/:id/stop（幂等）；请求体 JSON Schema 校验
- [x] T025 [US1] 接线 select 校验到对话链路：发消息/建 thread 前校验处于选中态（AGENT_NOT_SELECTED）；本轮由**当前选中数字人**执行（**2026-09-10 修订**：会话不绑定数字人、切换无需先 exit，移除 AGENT_SWITCH_REQUIRED）
- [x] T026 [US1] 并发上限执行：发消息前校验该用户活跃 thread ≥3（跨数字人累计）→ 409 THREAD_BUSY_LIMIT（**2026-09-10 修订**：原实现在 POST /api/threads 创建处按"会话总数"判定，与 FR-014「最多 3 个**并发**对话」口径不符，该处判定已移除；并发统计口径由 (user, agent) 改为 userId）
- [x] T027 [US1] Agent 崩溃恢复（FR-030）：run 未知异常 → 销毁实例+崩溃日志，下次发消息经 agent-pool 自动重建；集成测试复现

**Checkpoint**: US1 独立可用（MVP 可演示）；npm test 与 test:integration 全绿

---

## Phase 4: User Story 2 - 管理对话 Thread 生命周期 (P2)

**Goal**: thread 创建/列表/详情/重命名/删除（连带清理）；滚动摘要保持长对话连贯。

**Independent Test**: quickstart.md 场景 2（列表倒序+标题前 20 字、重命名、
删除连带清理 tmp 前缀文件、25+ 轮后摘要生效、摘要失败不阻塞）。

### Tests for User Story 2

- [x] T028 [P] [US2] thread-store 单元测试 tests/unit/thread-store.test.ts：meta.json 读写、列表按 updated_at 倒序、标题取首条 user 消息前 20 字、删除连带清理（history/summary/tmp 前缀）
- [x] T029 [P] [US2] summary 单元测试 tests/unit/summary.test.ts：窗口边界 19/20/21 条、增量重写拼装（旧摘要+新归档 20 条）、失败降级用旧摘要、per-thread 串行互斥
- [x] T030 [P] [US2] threads 路由集成测试 tests/integration/threads.test.ts：CRUD 全流程 + 分页（limit/offset/total）

### Implementation for User Story 2

- [x] T031 [US2] 实现 src/domain/thread-store.ts：meta.json（thread_id/agent_name/title/created_at/updated_at）、创建（UUID）、列表、重命名、删除连带清理、updated_at 维护；依赖 T009
- [x] T032 [US2] 实现 src/domain/summary.ts：滚动摘要——每轮结束检查窗口外攒满 20 条则 fire-and-forget 增量重写（复用 LlmProvider），per-thread Promise 链串行，失败记日志用旧摘要；summary.json（summary+covered_count）
- [x] T033 [US2] 对话上下文拼装接入 run-manager：每轮加载 history 最近 20 条 + summary 注入 System Prompt（FR-017）
- [x] T034 [US2] 实现 src/routes/threads.ts：POST 创建 / GET 列表（agent_name 过滤、倒序）/ GET 详情（分页 limit≤200 默认 50 + total + running 字段）/ PATCH 重命名（≤100 字）/ DELETE 删除（进行中 run 先 abort）

**Checkpoint**: US1+US2 均独立可用

---

## Phase 5: User Story 3 - 上传文件供数字人使用 (P2)

**Goal**: 上传业务文件（时间戳命名/50MB/格式白名单）；Agent 经工具读文件作答、
写 tmp 产出；写业务目录被拦截不中断对话；tmp 7 天清理。

**Independent Test**: quickstart.md 场景 3（上传 xlsx 后问答引用内容、越界/超限
拒绝、写生产计划被拒但对话继续、tmp 产出带 thread_id 前缀可下载）。

### Tests for User Story 3

- [x] T035 [P] [US3] 文件路由集成测试 tests/integration/files.test.ts：上传（时间戳命名/格式与大小拒绝/dir=tmp 403/路径穿越 400）、列表、下载
- [x] T036 [P] [US3] 工具单元测试 tests/unit/tools.test.ts：read_file 各格式（csv/txt/json 直读、xlsx→CSV、pdf 文本层、无文本层友好提示、32KB 截断+offset/limit）、write_file 前缀强制、grep_files 跳过二进制并注明、calculator 拒绝非表达式注入

### Implementation for User Story 3

- [x] T037 [P] [US3] 实现 src/domain/tools/read-file.ts：扩展名分派（SheetJS xlsx→CSV 逐 sheet；pdfjs-dist 提取文本层；文本直读），统一 32KB 截断（可配）+ offset/limit 分段；读 tmp 时 fs.utimes 刷新访问时间；经 file-access 代理
- [x] T038 [P] [US3] 实现 src/domain/tools/{write-file,list-dir,grep-files,calculator}.ts：write_file 仅 tmp+thread_id 前缀；grep 限文本格式跳过 xlsx/pdf；calculator 安全表达式求值（expr-eval 或等价，禁 eval）
- [x] T039 [US3] 实现 src/routes/files.ts：POST /api/files/upload（multipart 流式、dir 白名单含 shared 拒 tmp、时间戳命名）、GET /api/files/list（含 tmp）、GET /api/files/download（路径穿越拒绝）
- [x] T040 [US3] 实现 src/infra/scheduler.ts + tmp 清理任务：Scheduler 接口实现（setInterval 注册/优雅关闭 stopAll）；每小时扫描 tmp 删除 7 天未访问文件；单元测试（构造过期文件）
- [x] T041 [US3] 权限违规的对话内体验：工具抛 PermissionError → loop 继续，Agent 在 content 中说明无权限；日志 file.write.denied；集成测试验证对话不中断

**Checkpoint**: US1+US2+US3 均独立可用

---

## Phase 6: User Story 4 - 数字人配置查询 (P3)

**Goal**: 数字人列表/详情只读接口；配置损坏的不出现并告警。

**Independent Test**: quickstart.md 场景 4（列表/详情字段、移走 SOUL.md 后消失
并告警、恢复后重现）。

- [x] T042 [P] [US4] agents 查询测试 tests/integration/agents.test.ts：列表/详情结构、损坏配置排除
- [x] T043 [US4] 实现 src/domain/agent-catalog.ts：扫描 users/{uid}/agents/，解析并校验各配置文件（复用 T020 加载逻辑），损坏跳过+告警；detail 不含密钥字段
- [x] T044 [US4] 实现 src/routes/agents.ts：GET /api/agents、GET /api/agents/:name、POST /api/agents/:name/select、POST /api/agents/current/exit（接 T016）

**Checkpoint**: US4 独立可用；select/exit 与 US1 校验链（T025）端到端打通

---

## Phase 7: User Story 5 - 运维监控与用量统计 (P3)

**Goal**: 实例明细与健康监控只读接口；Token 用量多维汇总查询。

**Independent Test**: quickstart.md 场景 5（health 含 RSS/磁盘、agents 明细含
unavailable_mcp、按 agent/thread/时间范围汇总与轮次数吻合、POOL_SIZE=1 验证
池满拒绝）。

- [x] T045 [P] [US5] usage 查询测试 tests/unit/usage-db.test.ts：按 thread_id/agent_name/时间范围过滤与 SUM 汇总正确性（临时库灌数据）
- [x] T046 [P] [US5] monitor/usage 集成测试 tests/integration/monitor.test.ts：两监控端点结构 + 用量汇总端点
- [x] T047 [US5] 实现 src/routes/monitor.ts：GET /api/monitor/agents（池明细：user/agent/活跃 thread/空闲时长/unavailable_mcp）、GET /api/monitor/health（uptime/process.memoryUsage().rss/.opt-agent 磁盘可用空间）
- [x] T048 [US5] 实现 src/routes/usage.ts：GET /api/usage/summary（thread_id/agent_name/from/to 过滤，返回 total 与 grouped）
- [x] T049 [US5] 实例空闲回收任务接入 scheduler：每分钟扫描 agent-pool evictIdle(10min)；单元测试

**Checkpoint**: 全部 5 个用户故事独立可用

---

## Phase 8: Polish & Cross-Cutting

- [x] T050 优雅关闭接线 src/server.ts：SIGTERM/SIGINT → 停止接新请求 → 进行中 run draining（复用断连收尾）→ 15s 宽限 abort 尽力落盘 → SQLite close + pino flush + scheduler.stopAll；集成测试模拟信号
- [x] T051 [P] 编写 docs/api.md：与 contracts/http-api.md + sse-events.md 同步的手写接口文档（章程 VII）
- [x] T052 [P] 覆盖率核验：vitest --coverage，domain 核心模块（file-access/history/summary/agent-pool/run-manager）≥80%，缺口补测
- [x] T053 [P] 性能核验：非 LLM 接口 P95 ≤200ms（autocannon 或自写脚本压 threads 列表/文件列表/用量查询）；首字延迟 <5s 用冒烟脚本实测（含 MCP 异步建连不阻塞验证）
- [x] T054 容量与容灾全量演练：quickstart.md 场景 5.5（POOL_SIZE=1 池满 409）与场景 6（坏行/整体损坏重建、SIGTERM draining）逐项过
- [x] T055 冒烟脚本完善 scripts/smoke.ts：真 DeepSeek key 覆盖 thinking 开关、token 落库、stop；文档化运行方式
- [x] T056 全流程回归：quickstart.md 场景 1–6 逐项人工/自动验证并记录结果

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：无依赖，立即开工
- **Foundational (Phase 2)**：依赖 Setup；**T012 竖切原型是本阶段关键闸门**——
  pi 低层用法验证不过，后续全部返工
- **User Stories (Phase 3–7)**：均依赖 Foundational；US1(P1) 是主干，US2 的
  摘要拼装（T033）依赖 US1 的 run-manager；US3 的工具（T037/T038）依赖
  Foundational 的 file-access（T010）；US4/US5 相对独立可并行
- **Polish (Phase 8)**：依赖全部故事完成

### User Story Dependencies

- **US1 (P1)**：Foundational 后可开工，无故事间依赖 → **MVP**
- **US2 (P2)**：T033 依赖 US1 run-manager（T022），其余可并行
- **US3 (P2)**：依赖 Foundational file-access；T041 依赖 US1 对话链路
- **US4 (P3)**：基本独立；T044 select/exit 端点复用 US1 已接线的 current-agent
- **US5 (P3)**：依赖 Foundational usage-db 与 agent-pool

### Parallel Opportunities

- Phase 1：T003/T004 并行
- Phase 2：T005–T011 大部分并行（T010/T011 无相互依赖）；T012 独立
- 每故事内：测试任务 [P] 可并行编写；US3 的 T037/T038 并行
- US4 与 US5 整体可并行（不同文件）

### Parallel Example: User Story 1

```bash
# 先并行写三组测试：
Task: "run-manager 状态机单元测试 tests/unit/run-manager.test.ts"
Task: "agent-instance 配置加载测试 tests/unit/agent-instance.test.ts"
Task: "对话链路集成测试 tests/integration/chat.test.ts"
# 确认全部失败后再实现 T020–T027
```

---

## Implementation Strategy

### MVP First（仅 US1）

1. Phase 1 Setup → 2. Phase 2 Foundational（**T012 竖切原型为闸门**）
   → 3. Phase 3 US1 → **停下来按 quickstart 场景 1 验证** → 可演示

### Incremental Delivery

US1（对话核心）→ US2（对话管理+摘要）→ US3（文件）→ US4/US5 可并行
→ Phase 8 加固。每个故事独立验证、不破坏已交付故事。

## Notes

- 文件 ≤500 行（章程 II），超出按职责拆分
- domain 层禁止 import Fastify/pi/better-sqlite3（依赖方向向内）
- 每个任务或逻辑组完成后提交；测试先写先败后实现

---

## 后续变更（2026-09-13）

上述任务记录为历史，**不回溯改写**；以下为在此之后落地的模型变更：

**1. 三空间取代"7 业务目录 + shared/ + tmp/"（影响 T009/T010 及全部文件相关任务）**

- `users/{user_id}/user-data/` 下为 `数据准备/`（Agent 只读，二级目录由 scenario 定义）、
  `共享空间/`（Agent 只读，扁平）、`临时空间/`（Agent 唯一可写，须 `{thread_id}_` 前缀）
- `ensureUserDirs` 只创建三个空间 + `threads/` + `agents/`；数据准备子目录由 scenario 加载时惰性创建
- 旧目录与其数据已彻底删除，**不提供兼容与回退**
- `FileAccess` 沙箱读白名单改为三个空间；数据准备首段之后 MUST 是磁盘上已存在的 scenario 二级目录；
  `grep` 经 `expandSpaces()` 展开数据准备子目录

**2. 新增场景配置 scenario.json（FR-007a）**

- 位置 `users/{user_id}/scenario.json`（与 `user-data/`、`agents/` 平级），形如
  `{"scenario": "生产调度", "data_prep_dirs": ["生产计划", ...]}`
- 目录名校验（不允许 `/`、`\`、`..`，≤64 字符，去重）；按 mtime 缓存 + **热加载**（改文件无需重启）
- 缺失或损坏：进程不退出，业务 API 返回 503 `SCENARIO_NOT_CONFIGURED`

**3. 内置工具目录说明动态化**

`read_file`/`list_dir` 的可用目录由 scenario 动态生成（数据准备各子目录 + 共享空间 + 临时空间）；
scenario 缺失时降级为仅共享空间/临时空间；`write_file` 仅写临时空间。

**4. 上传扩展名按空间区分**

数据准备仅 `.csv`/`.xlsx`；共享空间与临时空间为 `.csv/.xlsx/.txt/.json/.pdf` + 图片
（`.jpg/.jpeg/.png/.bmp/.webp/.gif/.tif/.tiff`）。

**5. 错误码映射**

非法 `dir` → 400 `VALIDATION_FAILED`；未知空间/未知数据准备子目录 → 403 `UPLOAD_DIR_FORBIDDEN`；
删除共享空间文件 → 403 `FILE_READONLY`；scenario 缺失 → 503 `SCENARIO_NOT_CONFIGURED`。
