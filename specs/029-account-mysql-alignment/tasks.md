---
description: "账号域 MySQL 模式功能对齐（029）实现任务清单"
---

# 任务清单：账号域 MySQL 模式功能对齐

**输入**：`specs/029-account-mysql-alignment/` 下的 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)（§必迁列清单为列口径唯一来源）、[contracts/account-api.md](./contracts/account-api.md)（仅 4 项差异 D-1～D-4）、[quickstart.md](./quickstart.md)（U01–U24 对拍编号）

**前置**：plan.md、spec.md 已完成；`checklists/requirements.md` 全部勾选。

**测试口径**：宪章原则三为 NON-NEGOTIABLE，故**包含测试任务**（模板中的"测试可选"在本仓库被宪章覆盖）；同一故事内先写失败用例再实现。数据库用例连本地独立测试库，不可达时**先打印"已跳过"再跳过**。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

**格式**：`- [ ] [任务ID] [P?] [故事] 描述（含文件路径）`
- `[P]`：可与同阶段其它任务并行（不同文件、无未完成依赖）
- `[故事]`：`US1`~`US6`；Setup、Foundational、Polish 阶段**不带**故事标签

**路径约定**：仓库根 `optagent/`；本特性只改 `admin-backend/` 与 `specs/`，两个前端与运行侧零改动（仅回归）。

---

## Phase 1: Setup（共享准备）

**目的**：确认基线、备份、库就位。

- [x] T001 在 `admin-backend` 跑一次门禁（`lint` / `typecheck` / `test` / `check:lines` / `check:contract`），结果记入「基线记录」
- [ ] T002 [P] 备份 file 数据：`admin-backend/.platform-data/accounts/**` 整份复制到仓库外，记录条数（当前 users=2 / sessions=2 / services=7 / links=36）
- [x] T003 [P] 确认本地 MySQL 可用：`optagent`（生产口径）与 `optagent_test`（测试口径）两库可连；记录版本与字符集
- [x] T004 [P] 在 `admin-backend/package.json` 登记 `"db:init": "tsx --env-file=.env.local scripts/db-init.ts"`（与其它脚本一致，确保读到 `MYSQL_*`；脚本在 T009 实现）
- [x] T005 [P] 确认 `.env.local` 的 `STORAGE_DRIVER` / `MYSQL_*` 仍缺省走 file（不改默认值）
- [x] T006 在 `admin-backend/.env.example` 补「首次切换」注释段：`db:init` → `migrate:mysql` → 启动

**Checkpoint**：基线可复现、有备份、有两库、步骤有文字依据。

---

## Phase 2: Foundational（阻塞所有故事）

**目的**：把 DDL 与代码口径对齐，补出后续故事依赖的端口能力。

**⚠️ 关键**：本阶段未完成前，任何用户故事都不能开始。

- [x] T007 改 `specs/028-account-mysql-binding/schema.sql`：删 `users.status`；删 `fk_users_source` 与 `fk_register_links_agent`（保留各自索引）；`sessions` 保留 `fk_sessions_user`；**确认密码列为 `password`（与文件键同名，2026-11-28 已改）**，补既有库升级说明（`ALTER TABLE users CHANGE COLUMN password_record password ...`，执行前先查 `information_schema`）
- [x] T008 [P] 新增 `admin-backend/tests/helpers/mysql-schema.ts`：读取并执行 `schema.sql`（剥离 `CREATE DATABASE` / `USE`），供真库用例共用
- [x] T009 新增 `admin-backend/scripts/db-init.ts`：`schema.sql` 以"可被 `mysql` 客户端整份执行"为准；脚本侧剥离 `CREATE DATABASE` / `USE` 后执行表级 DDL（与 T008 helper 共用同一剥离函数），重复执行不报错
- [x] T010 [P] 新增 `admin-backend/tests/unit/db-schema.spec.ts`：语句数符合预期、含四表、不含 `users.status` 与两处外键（防回归）
- [x] T011 改 `admin-backend/tests/unit/mysql-stores.spec.ts`：建表改调 T008 helper，删除自建 DDL 副本；既有用例保持通过
- [x] T012 改 `admin-backend/src/domain/account/account-store.ts`：端口新增 `revokeLinksOf(agentCodes, revokedAt)`（返回受影响条数）与 `incrementUseCount(token)`（无返回）
- [x] T013 [P] 改 `admin-backend/src/domain/account/file-account-store.ts`：实现两个新方法（各一次整份写盘）
- [x] T014 [P] 改 `admin-backend/src/domain/account/mysql-account-store.ts`：`revokeLinksOf` 单条 `UPDATE`（返回受影响行数）、`incrementUseCount` 单条自增；`listRegisterLinks` 改 `ORDER BY created_at ASC, token ASC`
- [x] T015 [P] 新增 `admin-backend/tests/unit/account-store-parity.spec.ts`：两个新方法在内存桩与真库上的终态一致（不可达打印后跳过）
- [x] T016 改 `admin-backend/src/infra/mysql.ts`：`translateMysqlError` 补「外键引用」「表不存在」的可读文案（仍统一 `ADM_STORAGE_UNAVAILABLE`）
- [x] T017 [P] 改 `admin-backend/src/infra/platform-store.ts` 的 `ensureLayout` 支持"不建账号目录/不告警"；`admin-backend/src/server.ts` 按存储传入（对应 FR-027）
- [x] T018 [P] 新增 `admin-backend/tests/unit/platform-store-layout.spec.ts`：关闭账号目录时不留空目录、不产生告警（对应 FR-027）

**Checkpoint**：DDL 与代码/测试一致；端口具备原子动作；`db:init` 可用。

---

## Phase 3: User Story 1 - 切换存储后所有人与权限都还在（Priority: P1）🎯 MVP

**目标**：数据搬运完整、幂等、可对账、可重跑，切换后管理员仍是管理员。

**独立验证**：搬运后四类实体与 `data-model.md` §必迁列清单 逐列一致；`admin` 的角色/用户名与源一致；重复执行与中断后重跑均无差异。

### 测试

- [x] T019 [P] [US1] 新增 `admin-backend/tests/unit/migrate-to-mysql.spec.ts`：按 `data-model.md` §必迁列清单 逐列断言映射（不硬写列数），差异需能定位到列名；断言**表列名与文件键同名同义**（防再次出现 `password_record` 类改名）；另断言 `issued_at` 的 ISO→本地时间转换（含毫秒与跨零点用例）
- [x] T020 [P] [US1] 同文件补两类边界用例：①中途中断后重跑（源未改、目标无重复）；②源目录新旧布局并存时的取值与告警
- [x] T021 [P] [US1] 新增 `admin-backend/tests/integration/migrate-mysql.spec.ts`（真库，不可达跳过）：搬运两次断言幂等；断言管理员角色与手机号被保留

### 实现

- [x] T022 [US1] 重写 `admin-backend/scripts/migrate-to-mysql.ts`：按必迁列清单全字段（列名与文件键同名，**不再有 `password`→`password_record` 之类的别名**；账号无时间戳列，不迁不比对），顺序 `服务 → 账号 → 链接 → 会话`，"存在即更新"且不改已存在记录的 `created_at`；`issued_at` 由 ISO 按本地时区转换为本地时间字符串（唯一转换点）
- [x] T023 [US1] 同文件补对账与退出语义：逐列比对、差异打印明细、有差异退出码 1
- [x] T024 [US1] 同文件补重跑与兼容：写入前不做破坏性清理（保证中断可重跑）、旧目录布局告警
- [ ] T025 [US1] 实库验收（`optagent`）：`db:init` + `migrate:mysql`，核对四类实体条数、`admin` 的角色/用户名；**逐个枚举已知密码的账号各登录一次**（SC-001），未知密码者登记原因并比对密码摘要；记录切换耗时（SC-005）
  - 已核对：四类实体 7/2/36/2 逐列一致，`admin.role=admin`、手机号保留、`issued_at` 为本地时间字符串；**逐账号登录未执行**（需启动 mysql 模式服务）

**Checkpoint**：数据与权限无损，可进入下一故事。

---

## Phase 4: User Story 2 - 管理界面的账户操作行为不变（Priority: P1）

**目标**：配置版本语义、列表字段、改密、删账号与 file 完全一致。

**独立验证**：旧版本提交授权被拒；改授权后旧版本部署被拒；改密后旧登录态 401；删账号三步都完成。

### 测试

- [x] T026 [P] [US2] 新增 `admin-backend/tests/integration/mysql-user-link-revision.spec.ts`（真库，不可达跳过）：无版本新建推进、带过期版本拒绝、改授权过期拒绝且不写、改密不推进、删号推进；版本比较若可纯函数化，另在 `tests/unit/` 补一份不连库的映射用例
- [x] T027 [P] [US2] 新增 `admin-backend/tests/integration/account-parity.spec.ts`：列表（字段/分页/排序）、新建（含手机号/角色/来源）、改授权、改密、删除在两种存储下响应逐字段相等；含 ①改密后旧 Cookie 访问 `/me` → 401（FR-012）②删除账号后旧 Cookie 访问 `/me` → 401（边界 9）③两个无手机号账号可同时存在（唯一索引多 NULL，边界 4）
- [x] T028 [P] [US2] 新增 `admin-backend/tests/integration/revision-deploy-conflict.spec.ts`：改授权成功 → 用改前版本请求部署 → 409 且不落盘（FR-011）
- [x] T029 [P] [US2] 新增 `admin-backend/tests/integration/users-delete-failure.spec.ts`：制造撤回失败，断言账号未删、错误码正确、日志含事件名（FR-013）

### 实现

- [x] T030 [US2] 改 `admin-backend/src/domain/config-center/mysql-user-link-service.ts`：新建/改授权"校验 → 写入 → 推进"；改密不推进；删号推进；清理过时注释
- [x] T031 [US2] 改 `admin-backend/src/routes/users.ts`：删除链路失败时如实报错并记录上下文（不吞错）
- [ ] T032 [US2] 实库验收：`admin` 登录 → `/me` 含 `role=admin` → 列表含 `role/phone/source_agent_code` → 旧版本改授权得 409

**Checkpoint**：管理台在两种存储下无行为差异。

---

## Phase 5: User Story 3 - 新用户通过注册链接注册的结果不变（Priority: P1）

**目标**：注册的成功、失败、并发、计数与 file 相同。

**独立验证**：正常注册 + 手机号重复 + 四种失效链接 + 同链接并发两次。

### 测试

- [x] T033 [P] [US3] 新增 `admin-backend/tests/unit/register-links-consume.spec.ts`：`consume` 调用自增端口；无效/已撤销/已过期链接抛 `ADM_INVALID_LINK`
  - 落在既有 `tests/unit/register-links.spec.ts`（同职责不另起文件）：自增端口、撤销/过期/停用/不存在四类失效矩阵、清单顺序
- [x] T034 [P] [US3] 新增 `admin-backend/tests/unit/registration-rollback.spec.ts`：计数失败 → 账号被删 + 结构化告警（FR-017）
- [ ] T035 [P] [US3] 新增 `admin-backend/tests/integration/register-parity.spec.ts`（真库）：注册成功（自动关联、密码摘要、计数 +1、不下发 Cookie）、手机号重复 409、链接状态矩阵（已撤销 / 已过期 / 过期后再撤销 / 服务停用）统一 400、并发同手机号仅一成功、并发同链接计数 +2
  - 已覆盖 5 例：成功注册（自动关联 + 计数 +1 + 无 Cookie）、手机号重复 409、已撤销 400、服务停用 400、并发同链接计数 +2
  - **未覆盖**：已过期 / 过期后再撤销、并发同手机号仅一成功

### 实现

- [x] T036 [US3] 改 `admin-backend/src/domain/account/register-links.ts`：`consume` 改用自增；`list` 不再依赖存储顺序
- [x] T037 [US3] 改 `admin-backend/src/domain/account/registration.ts`：补偿失败记 `warn`（含 `user_id`/`token`），构造函数增加 logger 并同步 `admin-backend/src/server.ts`
- [ ] T038 [US3] 实库验收：用切换前的有效链接真实注册一次 → 手机号登录 → `/me` → `my-agents` 断言「返回集合 = 该账号 `agents[]` ∩ 部署清单数字人」（不预设为空）→ 清理测试账号

**Checkpoint**：注册链路两种存储逐字段相同。

---

## Phase 6: User Story 4 - 数字人卡片与服务编码的行为不变（Priority: P1）

**目标**：编码生成、链接清单、删除判定、影响面统计一致，删除不再报错。

**独立验证**：只剩失效链接时删服务成功；仍有有效链接时删服务被拒；自动生成编码不撞码。

### 测试

- [x] T039 [P] [US4] 新增 `admin-backend/tests/unit/agent-services-revoke.spec.ts`：删除数字人时只调一次撤销端口，入参为全部相关编码、时间戳同批一致
- [x] T040 [P] [US4] 新增 `admin-backend/tests/integration/agent-services-parity.spec.ts`（真库）：省略编码自动生成、重复编码 400、仅失效链接可删、有有效链接拒删、同一数字人存在多条历史服务记录时一并处理、数字人已删但历史链接仍在时的清单行为
- [x] T041 [P] [US4] 新增 `admin-backend/tests/integration/register-links-order.spec.ts`：两种存储各生成 3 条，清单顺序一致（`created_at` 升序，同刻按 `token`）
  - 顺序断言落在 `tests/unit/register-links.spec.ts`（领域层唯一实现点），两种存储因此天然同序

### 实现

- [x] T042 [US4] 改 `admin-backend/src/domain/account/agent-services.ts`：级联撤销改调撤销端口；删除判定保持"有效链接或用户关联"唯一口径；多条历史服务记录一并撤销
- [ ] T043 [US4] 实库验收：数字人卡片编码、注册管理（复用有效链接 / 生成 7d / 停止注册逐条与全部 / 删除数字人影响面），并核对 `created_at` 展示与有效期判定（U24）

**Checkpoint**：删除曾有链接的服务不再出现 5xx。

---

## Phase 7: User Story 5 - 并发与故障下不产生难以解释的错误（Priority: P2）

**目标**：并发与故障路径有测试证据、有可读错误。

**独立验证**：并发同名账号仅一成功；库不可达时响应可读且健康检查可见。

### 测试

- [x] T044 [P] [US5] 新增 `admin-backend/tests/integration/mysql-concurrency.spec.ts`（真库）：并发建同名账号仅一成功；并发改授权（同版本）仅一成功
- [x] T045 [P] [US5] 新增 `admin-backend/tests/integration/mysql-unavailable.spec.ts`：连接指向不可达端口，断言可读错误码 + 结构化日志
- [x] T046 [P] [US5] 新增 `admin-backend/tests/unit/mysql-error-translate.spec.ts`：外键引用、表缺失均给中文可读消息（不出现裸 `ER_`）

### 实现

- [x] T047 [US5] 改 `admin-backend/src/server.ts` 与 `admin-backend/src/infra/mysql.ts` 的**启动期**失败路径：配置缺失、库不可达时给出可直接定位的退出信息（与 T016 的运行期翻译不重叠）

**Checkpoint**：并发与故障路径可验证。

---

## Phase 8: User Story 6 - 运维可切换、可回滚（Priority: P2）

**目标**：脚本按存储生效、健康检查可见、切换与回滚可复现（含新增数据导出，FR-026）。

**独立验证**：数据库模式下改密真实生效；停库后健康检查标记不可用；回滚导出命令可用。

### 测试

- [x] T048 [P] [US6] 新增 `admin-backend/tests/unit/account-stores-factory.spec.ts`：两种配置返回对应实现；配置缺失时报错
- [x] T049 [P] [US6] 新增 `admin-backend/tests/integration/platform-health.spec.ts`：文件模式响应**不含** `database`；数据库模式含 `reachable/host/database/error` 四字段且类型正确；库不可达时 `reachable=false`、`error≠null` 且 HTTP 仍为 200

### 实现

- [x] T050 [US6] 新增 `admin-backend/scripts/lib/account-stores.ts`：按当前存储装配账号端口与账号存储（与主程序同一口径）
- [x] T051 [US6] 改 `admin-backend/scripts/set-user-password.ts`：走 T050 装配
- [x] T052 [US6] 改 `admin-backend/scripts/backfill-agent-services.ts`：走 T050 装配
- [x] T053 [US6] 改 `admin-backend/src/routes/platform.ts`：数据库模式的健康检查增加 `database` 字段（探测失败不抛 500）
- [x] T054 [US6] 运维验收：数据库模式下执行改密脚本并用新密码登录；停止数据库后访问健康检查；按 `quickstart.md` §7 导出新增数据
  - 实测：`npm run set:user-password` 写库后，旧密码 401 / 新密码 200（**顺带修掉一个真实缺陷**：mysql 驱动内存投影导致跨进程改密不生效，已加 `UserLinkPort.refresh()` 并在登录前重载）；健康检查不可达分支由 `platform-health.spec.ts` 覆盖；导出命令见 quickstart §7

**Checkpoint**：运维能力在两种存储下都真实生效。

---

## Phase 9: Polish（收尾）

**目的**：跨故事一致性、文档回写、前端零改动证据、回滚演练。

- [x] T055 回写 `specs/028-account-mysql-binding/方案与契约.md`：新增「029 对齐修订」小节（配置版本口径修正、去外键、状态列移除）
- [ ] T056 [P] 回写 `specs/029-account-mysql-alignment/spec.md` §修订记录与 `plan.md`「测量结果」（含 SC-009 三个端点的 P95 实测与口径）
- [ ] T057 后端全量门禁：`npm run lint && npm run typecheck && npm run test && npm run check:lines && npm run check:contract && npm run check:deps && npm run test:coverage`
  - 覆盖率统计范围＝本次新增/修改的 `domain/**`、`infra/**`、`routes/**`、`scripts/**`；语句覆盖率 ≥ **80%**（宪章原则三）；结果记入「基线记录」
- [ ] T058 [P] 前端零改动证据（SC-008）：先以 T001 记录的分支基线执行 `git diff <base> --stat -- frontend admin-frontend` 确认无本特性改动；再分别在 `frontend`、`admin-frontend` 执行 `npm run test` 与 `npm run build` 并全部通过
- [ ] T059 双驱动对拍报告：按 `quickstart.md` §5 的 U01–U24 逐条记录两种存储的响应差异（预期无差异），归档到「基线记录」
- [ ] T060 回滚演练：按 `quickstart.md` §7 导出 → 切回 file → 重启 → 管理台登录与列表可用，记录耗时（SC-005）
- [ ] T061 [P] 清理注释债：删改本次触及文件中与新实现不符的旧注释（`mysql-user-link-service.ts`、`mysql-account-store.ts`、`registration.ts` 顶部说明）；同步修正 `src/routes/platform.ts:7` 注释中 quickstart 章节号的引用（§6 → §4）

---

## Dependencies & Execution Order

### 阶段依赖

- **Setup（Phase 1）**：无依赖，可立即开始。
- **Foundational（Phase 2）**：依赖 Setup；**阻塞全部用户故事**（DDL 与端口能力是所有故事的前提）。
- **用户故事（Phase 3–8）**：均依赖 Foundational；可按优先级顺序执行，也可并行（见下）。
- **Polish（Phase 9）**：依赖所需故事全部完成；T058 与 T059 依赖 T057 通过。

### 用户故事依赖

- **US1（P1，MVP）**：仅依赖 Foundational。搬运是切换可用的前提。
- **US2（P1）**：依赖 Foundational；与 US1 共用账号端口，可独立验证。
- **US3（P1）**：依赖 Foundational（自增端口）；实库验收假定库中已有搬运后的数据。
- **US4（P1）**：依赖 Foundational（撤销端口）；与 US3 无直接依赖。
- **US5（P2）**：依赖 US2/US3 的错误路径已实现（并发与故障才有意义）。
- **US6（P2）**：依赖 Foundational；脚本装配可与故事并行，验收需数据库实例与 US1 数据。

### 每个故事内部

- 先写测试并确认失败 → 再实现 → 再跑门禁。
- 端口/实现（数据访问层）先于领域编排；领域编排先于路由调整。
- 故事通过独立验证后再进入下一个优先级。

### 并行机会

- Setup 中 `[P]` 任务互不冲突。
- Foundational 中 T013 / T014 分属不同文件可并行；T012（端口定义）必须先落地。
- US2 与 US4 的测试文件互不重叠，可并行编写；US3 的三个测试文件可并行。
- Polish 中 T056 / T058 / T061 互不重叠，可并行。

---

## Parallel Example: User Story 3

```text
# 并行编写三个测试文件（不同文件，互不依赖）
Task: "register-links-consume.spec.ts —— consume 调自增端口 + 失效链接矩阵"
Task: "registration-rollback.spec.ts —— 计数失败回滚与告警"
Task: "register-parity.spec.ts —— 双驱动注册对拍（真库）"

# 再串行实现（同一文件链：register-links.ts → registration.ts → server.ts）
```

---

## Implementation Strategy

### MVP First（仅 US1）

1. Phase 1 Setup + Phase 2 Foundational（关键，阻塞全部）。
2. US1（搬运 + 对账 + 重跑）。
3. **停下来验证**：库中四类数据与源逐列一致、逐账号可登录。
4. 此时已具备"可切换"的最低价值，可先做一次真实切换演练。

### Incremental Delivery

1. US1 → 数据与权限无损（可切换）。
2. + US2 → 管理台操作行为一致（含冲突保护）。
3. + US3 → 注册可用（新用户能进来）。
4. + US4 → 服务与链接管理不再报错。
5. + US5/US6 → 并发、故障、运维闭环。
6. 每个增量独立回归，前一增量不因后一增量回退。

---

## 缺陷修复：mysql / file 一致性复核（2026-11-28）

- [x] **F1 会话判定回源**（spec v0.7 ①）：`SessionPort` 四方法 async 化；`MysqlSessionStore` 删掉启动期 `rows` 投影，`getCurrentSession` 每次 `SELECT session_id FROM sessions WHERE user_id = ?`，`clearSession` 无条件 `DELETE`（去掉"本地无记录即跳过"）；`SessionStore`（file）同步改 async 并每次都读盘；`AuthService.introspect` → async，`routes/auth.ts` 两处 `await`（HTTP 契约不变）。
  - 修复的行为：跨进程/跨实例的"后登踢前登"与登出此前不生效；运维删 `sessions` 行后旧凭据仍可用。
- [x] **F2 标识与凭据大小写敏感**（spec v0.7 ②）：`schema.sql` 中 `users.user_id`、`sessions.user_id`、`register_links.token` 改 `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`，并在文件头补存量库升级脚本（先 `DROP FOREIGN KEY fk_sessions_user`，改列后再建）。
  - 修复的行为：此前 `_ai_ci` 使 `Admin` 与 `admin` 撞唯一键（file 模式允许共存）、token 大小写变体可命中同一条链接。
- 用例：`tests/unit/mysql-stores.spec.ts` 新增「用户标识区分大小写」与「另一实例写入后本实例立即可见」；`tests/unit/account-store-parity.spec.ts` 两侧各新增「token 区分大小写」；`auth-session-store.spec.ts` 新增 file 侧跨实例可见性。既有 8 处同步调用改 `await`。
- 回归：`npx vitest --run` → **86 files / 865 tests 全绿**（含真库对拍）；`tsc --noEmit` 与 `eslint src tests` 干净。既有开发库已执行迁移：三列均为 `utf8mb4_bin`、外键重建成功、数据行数不变（users 2 / register_links 38 / agent_services 8），`SELECT … WHERE user_id='ADMIN'` 由"命中 admin"变为 0 行。

---

## Notes

- `[P]` 表示不同文件、无未完成依赖；同一文件的多处改动不得并行。
- 列口径只认 `data-model.md` §必迁列清单；任务中不再写具体列数（避免口径漂移）。
- 对拍编号只认 `quickstart.md` §5 的 U01–U24；`spec.md` SC-002 引用同一编号。
- 数据库用例不可达时**必须**先打印"已跳过"再跳过，避免"绿但没跑"。
- 每个 Checkpoint 都是可停止点：停下来跑一遍该故事的独立验证，再继续。
- 提交粒度：一个任务或一组紧耦合任务一次提交；搬运脚本与 DDL 变更必须同步提交。

---

## 需求覆盖索引

| 需求 | 任务 |
|---|---|
| FR-001 账号全字段搬运 | T019 T020 T021 T022 T023 T025 |
| FR-002 服务全字段搬运 | T019 T021 T022 T023 |
| FR-003 链接全字段搬运 | T019 T021 T022 T023 |
| FR-004 会话搬运 | T019 T021 T022 T023 |
| FR-005 幂等 | T021 T022 |
| FR-006 对账失败整体失败 | T023 |
| FR-007 切换后可登录 | T025 T038 |
| FR-008 管理员权限保留 | T021 T025 T032 |
| FR-009 列表一致 | T027 T032 |
| FR-010 版本冲突保护 | T026 T027 T030 |
| FR-011 授权后旧版本部署被拒 | T028 T032 |
| FR-012 改密不推进 + 旧会话失效 | T026 T027 |
| FR-013 删账号三步 | T029 T031 |
| FR-014 注册链路 | T035 T036 T038 |
| FR-015 失效链接统一提示 | T033 T035 |
| FR-016 并发注册 | T035 |
| FR-017 注册失败回滚与留痕 | T034 T037 |
| FR-018 编码唯一/自动生成 | T040 T042 |
| FR-019 删除判定唯一 | T040 T042 |
| FR-020 删数字人级联撤销 | T039 T040 T042 T043 |
| FR-021 链接排序 | T014 T036 T041 |
| FR-022 存储不可用可读错误 | T016 T045 T046 T047 |
| FR-023 健康检查反映存储 | T049 T053 |
| FR-024 运维能力真实生效 | T048 T050 T051 T052 T054 |
| FR-025 前端零改动 | T058 |
| FR-026 回滚可导出 | T054 T060 |
| FR-027 不建账号空目录/不误告警 | T017 T018 |
| FR-028 列名与文件字段同名同义 | T007 T019 T022 |
| SC-001 逐账号可登录 | T025 |
| SC-002 U01–U24 一致率 | T027 T028 T035 T040 T041 T059 |
| SC-003 删服务成功率 | T040 |
| SC-004 重复搬运无差异 | T021 |
| SC-005 切换/回滚耗时 | T025 T060 |
| SC-006 并发偏差为 0 | T035 |
| SC-007 故障在健康检查可见 | T049 T053 |
| SC-008 前端零改动证据 | T058 |
| SC-009 性能 P95 | T056 |

---

## 基线记录

> 以下各项在执行时回填实测值（不要保留"待填"字样提交）。

| 项 | 结果 | 日期 |
|---|---|---|
| 基线门禁（T001） | lint 0 问题；typecheck 通过；`test` 69 文件 / 780 用例全绿；check:lines 151 文件均 ≤500 行；check:contract 31 个错误码一致 | 2026-11-28 |
| 备份位置与条数（T002） | `d:/公司项目/智能体/_optagent-backup-029/accounts`（仓库外），6 个文件（users 2 / sessions 2 / agent-services.json / register-links.json） | 2026-11-28 |
| 本地 MySQL 版本 / 两库（T003） | Docker `mysql:8.0`（8.0.46）；`optagent` / `optagent_test` 均可连；`character_set_server=utf8mb4`、`collation_server=utf8mb4_0900_ai_ci`、`time_zone=+08:00`；容器 `optagent-mysql-dev`（`docker-compose.mysql.yml`） | 2026-11-28 |
| 开发栈归并（2026-11-28 补记） | 上行的独立开发栈 compose 已删除：`db:up / db:down / db:reset` 统一走仓库根 `docker-compose.yml` 的 mysql 服务（容器 `optagent-mysql`、卷 `optagent_mysql_data`），`db:reset` 改为 `db-init.ts --reset`（DROP DATABASE，不再 `down -v`） | 2026-11-28 |
| 实库搬运对账与逐账号登录（T025） | `optagent`：服务 7 / 账号 2 / 链接 36 / 会话 2，脚本报「逐列一致」；`admin.role=admin`、手机号保留、`sessions.issued_at` 为本地时间字符串；**逐账号登录未执行**（待 mysql 模式服务启动后补） | 2026-11-28 |
| 管理台实库验收（T032） | — | — |
| 注册实库验收（T038） | — | — |
| 双驱动对拍 U01–U24（T059） | — | — |
| 账号接口 P95（T056） | — | — |
| 改动模块语句覆盖率（T057） | 全量 93.66%（语句 92.42%）；本次改动：`registration.ts` 91.17%、`infra/mysql.ts` 92.68%、`routes/platform.ts` 100%、`routes/users.ts` 88.13%、`account-store.ts` 76.19%（剩余缺口为 3 个校验 throw 分支） | 2026-11-28 |
| 最终门禁（T057） | lint 0；typecheck 通过；**79 文件 / 839 用例全绿**；check:lines 159 文件 ≤500 行；check:contract 31 码一致；check:deps 通过 | 2026-11-28 |
| 回滚演练耗时（T060） | — | — |
