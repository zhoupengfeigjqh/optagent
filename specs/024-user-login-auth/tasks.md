---
description: "用户登录与鉴权（024）实现任务清单"
---

# 任务清单：用户登录与鉴权（方案 A）

**输入**：`specs/024-user-login-auth/` 下的 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/auth-api.md](./contracts/auth-api.md)、[quickstart.md](./quickstart.md)

**前置**：`plan.md`（必需）、`spec.md`（用户故事与优先级）、研究/数据模型/契约/快速验证（已就绪）。

**测试口径**：宪章原则三为 NON-NEGOTIABLE，故**包含测试任务**；同一故事内先写失败测试再实现（TDD 顺序）。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

**格式**：`- [ ] [任务ID] [P?] [故事] 描述（含文件路径）`
- `[P]`：可与同阶段其它任务并行（不同文件、无未完成依赖）
- `[故事]`：`US1`~`US5`；Setup、Foundational、Polish 阶段**不带**故事标签

**路径约定**：仓库根为 `optagent/`；本特性**四侧同改**（`admin-backend/`、`agent-backend/`、`frontend/`、`admin-frontend/`），文档在 `specs/`。

---

## Phase 1: Setup（共享准备）

**目的**：确认基线、加依赖、配密钥环境变量。

- [ ] T001 在四个子项目各跑一次改动前门禁（`lint` + `typecheck` + `test`），记录存量红灯，避免把存量问题算到本特性头上；结果写入本文件末尾「基线记录」
- [ ] T002 [P] 在 `admin-backend/package.json` 与 `agent-backend/package.json` 各新增依赖 `jose`（执行 `npm i jose`，锁文件入库；版本与选型理由见 `research.md` D2）
- [ ] T003 [P] 配置凭据密钥：`admin-backend/src/config.ts` 新增 `authSecret`（必填，zod）与 `authTokenTtlSeconds`（默认 7 天）；`agent-backend/src/config.ts` 新增 `authSecret`（**可选**，zod）；`docker-compose.yml` 给 `backend` 与 `admin-backend` 两服务注入 `AUTH_SECRET`；各 `.env` / `.env.local` 补充 `AUTH_SECRET`（两侧**同值**）

**Checkpoint**：基线可复现、依赖可装、密钥来源就位。

---

## Phase 2: Foundational（阻塞所有故事）

**目的**：冻结凭据契约、落地密码哈希与令牌两个共享原语。**此阶段完成前任何故事都不能开始。**

- [ ] T004 冻结 `specs/024-user-login-auth/contracts/auth-api.md` 为唯一契约来源（Cookie 名 `optagent_auth`、JWT claims、端点、错误码），与 `data-model.md` 逐字段核对一致
- [ ] T005 新增 `admin-backend/src/domain/auth/password.ts`：`hashPassword(plain)`（`crypto.scrypt`，随机盐，`N=16384,r=8,p=1`，返回 `{ algo, params, salt, hash }`）与 `verifyPassword(plain, record)`（`timingSafeEqual` 恒定比较，格式非法即 `false`，**永不抛错**）
- [ ] T006 [P] 新增 `admin-backend/tests/unit/auth-password.spec.ts`：scrypt 往返一致、盐唯一、同明文两次哈希不同、坏格式 → `false`、空/超长输入、`verifyPassword` 对错值 `false`
- [ ] T007 新增 `admin-backend/src/domain/auth/token.ts`：`signSession(userId, secret, ttlSeconds)`（`jose` HS256，claims `{sub,iss,aud,iat,exp}`）、`verifySession(token, secret)`（`jose.jwtVerify` 校验 `iss`/`aud`/`exp`，返回 `{ userId }`，无效即抛可识别错误）、`cookieHeader(token, maxAge)`（HttpOnly/Path=/SameSite=Lax）、`clearCookieHeader()`（Max-Age=0）
- [ ] T008 [P] 新增 `admin-backend/tests/unit/auth-token.spec.ts`：签发→验签往返、`sub/iss/aud/exp` 正确、过期拒、密钥不符拒、篡改 payload 拒、`verifySession` 对 `iss`/`aud` 不符拒
- [ ] T009 新增 `admin-backend/src/domain/auth/index.ts` 收敛导出面（`hashPassword`/`verifyPassword`/`signSession`/`cookieHeader`/`clearCookieHeader` 与端口类型）
- [ ] T043 [P] 新增 `admin-backend/src/domain/auth/session-store.ts`：`setCurrentSession(userId, sessionId)` / `getCurrentSession(userId)` / `clearSession(userId)` / `isCurrentSession(userId, sessionId)`，原子写 `.platform-data/sessions/{uid}.json`（复用 `PlatformStore`）
- [ ] T044 [P] 新增 `admin-backend/tests/unit/auth-session-store.spec.ts`：登记/覆盖/清除、`isCurrentSession` 判定、原子写、无记录 → `null`

**Checkpoint**：密码哈希、令牌、会话登记三原语可独立测试；`domain/auth/**` 不含任何 Fastify/路由依赖。（注：T043/T044 为单会话后补原语，编号延续既有清单，执行上仍属 Foundational、先于所有故事）

---

## Phase 3: User Story 1 - 管理员新建用户时设置初始密码（Priority: P1）🎯 MVP

**目标**：管理员新建用户时能设置密码，密码哈希随用户记录保存、任何视图不下发明文。

**独立验证**：新建用户带密码 → `.platform-data/users/{uid}.json` 含 `password` 哈希且无明文；用户列表/详情不含 `password`；密码为空/过短被拒且已填内容不丢。

### 测试（先写，必须失败）

- [ ] T010 [P] [US1] 新增 `admin-backend/tests/unit/user-links-password.spec.ts`：`create` 带密码落哈希（非明文）、`listAll`/`read` 视图不含 `password`、密码为空/过短 → `VALIDATION_FAILED`、无密码入参（存量兼容）不落字段、删除用户后 `read` 不存在（FR-012 不可再登录的前提）

### 实现

- [ ] T011 [US1] 改 `admin-backend/src/domain/config-center/user-links.ts`：`UserLinkDocument` 增 `password` 可选字段；`create()` 接收并哈希密码；`list`/`listAll` 映射视图剥离 `password`（读原样可带、对外不下发）
- [ ] T012 [US1] 改 `admin-backend/src/routes/users.ts`：`POST /api/admin/users` 接收 `password`（6~128 字符、非空、无控制字符），透传 `ctx.users.create`
- [ ] T013 [P] [US1] 改 `admin-frontend/src/api/types.ts`：用户创建载荷类型增 `password` 字段
- [ ] T014 [P] [US1] 改 `admin-frontend/src/api/users.ts`：`createUser(userId, agents, password)` 增加 `password` 入参并写入请求体
- [ ] T015 [US1] 改 `admin-frontend/src/components/deploy/UserEditor.vue`：新建态增「设置密码」输入框（`type="password"`、`autocomplete="new-password"`、label/hint 可读），`submit` 事件载荷增 `password`；编辑态不显示密码
- [ ] T016 [P] [US1] 改 `admin-frontend/src/components/deploy/UserCardList.vue`：`createUser(payload.user_id, payload.agents, payload.password)` 传入密码；增补 `UserCardList.spec.ts` 与 `UserEditor.spec.ts`（密码字段渲染、校验提示、提交载荷含密码）
- [ ] T045 [US1] 改 `admin-backend` 用户删除链路：删除用户时调用 `session-store.clearSession(userId)`，使旧会话即时失效；增补 `user-links-password.spec.ts` 断言"删除后其会话登记被清除"

**Checkpoint**：US1 独立可用——管理员能"新建用户 + 设密码"，密码不出现在任何列表/详情；删除用户即时失效（清会话）；此后可选做 MVP 交付。

---

## Phase 4: User Story 2 - 用户在聊天前台登录（Priority: P1）

**目标**：打通"账号密码 → 校验 → 签发凭据 → HttpOnly Cookie → 进入聊天"链路（含登录页）。

**独立验证**（API 级；页面级验收需 `/login` 路由可达，见 US3 守卫）：正确账号密码登录成功拿 Cookie 并返回 `{user_id}`；密码错/账号不存在同码不枚举；登录后携带 Cookie 访问探针返回该用户。

### 测试（先写，必须失败）

- [ ] T017 [US2] 新增 `admin-backend/tests/unit/auth-service.spec.ts`：登录成功返回 `{user_id}` + Cookie 头且登记会话；密码错/账号不存在/存量无密码**同码** `ADM_INVALID_CREDENTIALS`（不枚举）；二次登录覆盖旧会话（内省旧 `session_id` → `valid:false`）；`me` 有/无 Cookie；`logout` 清会话 + 清 Cookie；日志不含明文密码

### 实现

- [ ] T018 [US2] 新增 `admin-backend/src/domain/auth/service.ts`：`login(userId, password)`（读用户→验密码→生成 `session_id`→`setCurrentSession`→签发，失败统一 `ADM_INVALID_CREDENTIALS`）、`me(userId)`、`logout(userId)`（清会话 + 清 Cookie）、`introspect(userId, sessionId)`；验签失败/异常落结构化日志（含 `req_id`，不含明文）
- [ ] T019 [US2] 新增 `admin-backend/src/routes/auth.ts`：`POST /api/admin/auth/login`（zod 校验 body）、`GET /api/admin/auth/me`（验签 → 200/401 `ADM_UNAUTHENTICATED`）、`POST /api/admin/auth/logout`（清会话 + 204 + 清 Cookie）、`GET /api/admin/auth/session/valid`（query `{user_id, session_id}` → `{ valid }`，供运行侧内省）
- [ ] T020 [US2] 改 `admin-backend/src/server.ts`：装配 `authService` 并 `registerAuthRoutes(routeApp, ctx, authService)`；新增 `admin-backend/tests/integration/auth.spec.ts`（登录→探针→登出 全链路，内存 store + 假密钥）
- [ ] T021 [P] [US2] 新增 `frontend/src/api/auth.ts`：`login(userId, password)`、`me()`、`logout()`（复用 `createHttpClient`，路径按 `contracts/auth-api.md`）
- [ ] T022 [P] [US2] 新增 `frontend/src/api/auth.spec.ts`：登录/探针/登出请求方法、路径、body 与错误分派（`ADM_INVALID_CREDENTIALS` 不跳转）
- [ ] T023 [US2] 新增 `frontend/src/composables/useAuth.ts`：`currentUser` 状态、`login()`（成功后置态）、`logout()`（清态）、`ensureAuthenticated()`（`me` 探针 + 记忆化）
- [ ] T024 [P] [US2] 新增 `frontend/src/composables/useAuth.spec.ts`：探针成功/失败、记忆化（只探一次）、登录置态、登出清态、401 跳转（登录端点除外）
- [ ] T025 [US2] 新增 `frontend/src/views/LoginView.vue`：账号/密码表单、`<form>` 提交、错误提示文本化、键盘 Enter 提交、禁用态；并在 `frontend/src/router/index.ts` 登记 `/login` 路由
- [ ] T026 [P] [US2] 新增 `frontend/src/views/LoginView.spec.ts`：提交触发 `login`、错误文案渲染、Enter 提交、busy 禁用

**Checkpoint**：US2 独立可用——能登录并拿到会话；此后 US3 才有"拦截"的对象。

---

## Phase 5: User Story 3 - 未登录访问聊天页面被拦截（Priority: P1）

**目标**：运行侧验签 + 前端路由守卫，把未登录请求拦在业务之外。

**独立验证**：未登录直接访问聊天页 → 跳登录页；无/坏凭据调 `/api/*` → 401 `UNAUTHENTICATED` 且无业务数据；白名单端点免鉴权放行。

### 测试（先写，必须失败）

- [ ] T027 [US3] 新增 `agent-backend/tests/unit/auth-hook.spec.ts`：白名单放行；无 Cookie → 401；坏/过期/篡改 token → 401；有效 token → 内省通过 → ALS 注入 `userId`；被踢 → 401 `SESSION_REVOKED`；内省不可达 → 放行 + 告警；无密钥配置 → 放行回退；401 响应体不含业务数据

### 实现

- [ ] T028 [US3] 新增 `agent-backend/src/infra/auth.ts`：`createAuthHook({ secret, introspect })` → Fastify `onRequest` 钩子；白名单（`/api/monitor/health`、`/api/monitor/agents`、`/api/builtin-tools`、`/api/mcp-call-stats`）放行；其余验签 Cookie（提取 `sub`/`jti`）→ 会话内省（1~2s 缓存）→ 有效 `ALS.run({ userId }, next)`、被踢 401 `SESSION_REVOKED`、内省不可达放行+告警；验签失败 401 `UNAUTHENTICATED`；`secret` 未配置直接放行；**不含**用户记录/密码/业务判断
- [ ] T029 [US3] 改 `agent-backend/src/server.ts`：注册 `onRequest` 鉴权钩子（在路由注册前）；新增 `agent-backend/tests/integration/auth.spec.ts`（未带凭据 401、无效凭据 401、白名单放行、被踢会话 401 `SESSION_REVOKED`）
- [ ] T030 [US3] 改 `frontend/src/router/index.ts`：新增 `/login` 路由；业务路由（`/`、`/datapage/:pageid`、`/taskresult`）加 `meta.requiresAuth: true`；`beforeEach` 改为异步探针（`useAuth.ensureAuthenticated()`），未登录跳 `/login`、已登录访问 `/login` 跳 `/`
- [ ] T031 [P] [US3] 新增 `frontend/src/router/index.spec.ts`：未登录访问业务路由 → 重定向 `/login`；已登录 → 放行；已登录访问 `/login` → 跳 `/`

**Checkpoint**：US3 独立可用——未登录被拦（前端跳转 + 后端 401）；此后 US4 才注入真实身份。

---

## Phase 6: User Story 4 - 登录后按用户隔离数据（Priority: P2）

**目标**：验签所得身份接入 `getCurrentUser()`，打通既有"按用户数据域"隔离。

**独立验证**：两个不同账号分别登录，各自 `/api/agents` 返回各自数据域；A 看不到 B 的数字人/会话/文件。

### 实现

- [ ] T032 [US4] 改 `agent-backend/src/domain/current-user.ts`：新增 `AsyncLocalStorage` 实例，`getCurrentUser()` 改为先读 ALS store 的 `userId`（有则返回），无 store（启动期 `ensureRootDirs` 或未配密钥）回退 `BUILTIN_ADMIN`；签名不变
- [ ] T033 [P] [US4] 新增 `agent-backend/tests/unit/current-user.spec.ts`：ALS 有 store → 返回其 `userId`；无 store → 回退 `admin`
- [ ] T034 [US4] 在 `agent-backend/tests/integration/auth.spec.ts` 追加：两个不同 `sub` 的凭据分别访问 `/api/agents` → 各自命中 `users/{sub}/agents` 数据域，互不可见

**Checkpoint**：US4 独立可用——登录身份真正决定数据域，跨用户零串扰；53 处调用点零改动。

---

## Phase 7: User Story 5 - 登出与登录态过期（Priority: P2）

**目标**：登出闭环 + 过期后统一引导重新登录。

**独立验证**：点击登出 → 回登录页且 Cookie 清空、再访问被拦；凭据过期后受保护请求 401 → 前端引导重新登录，无业务副作用。

### 实现

- [ ] T035 [US5] 在 `frontend` 工作台（`views/WorkbenchView.vue` 或头栏组件）新增登出入口：调 `useAuth.logout()` → 清态 → 跳 `/login`
- [ ] T036 [US5] 改 `frontend/src/api/http.ts` 与 `frontend/src/api/sse.ts`：暴露 401 处理钩子（`setUnauthorizedHandler`），`useAuth` 注册"跳登录页"回调（`ADM_INVALID_CREDENTIALS` 与登录端点除外；`SESSION_REVOKED` 提示"已在其它设备登录"后跳登录）
- [ ] T037 [P] [US5] 新增/增补 `frontend` 测试：`useAuth` 登出清态、`http.ts`/`sse.ts` 401 触发回调、`SESSION_REVOKED` 提示"已在其它设备登录"、登录端点 401 **不**触发跳转

**Checkpoint**：US5 独立可用——登出与过期均有明确收口；此后进入收尾。

---

## Phase 8: Polish（跨故事收尾）

**目的**：契约登记、解耦与安全校验、性能回填、四侧门禁全绿。

- [ ] T038 [P] 在 `specs/001-digital-human-platform/contracts/admin-api.md` 登记：§6.2 请求体加 `password`、§9 鉴权更新、§11 `ADM_UNAUTHENTICATED` 已启用、新增 §12 登录端点；在 `runtime-api-delta.md` 登记运行侧鉴权语义（401 + 白名单 + 错误码 `SESSION_REVOKED`）
- [ ] T039 [P] 解耦与安全机械校验：检索 `agent-backend/src/domain/**` 不含 `infra/auth` 引用（身份只经 `getCurrentUser()`）；检索全仓响应/日志不含明文密码（`password` 明文零出现）；把命令与结果记入本文件「解耦校验记录」
- [ ] T040 [P] 回填 `SC-007` 与 `SC-008` 实测值：测验签 + 会话内省对受保护请求的额外耗时（目标 P95 ≤ 5ms）及"被踢后 ≤2s 内 401"（内省缓存 TTL），结果写入 `plan.md` 与 `spec.md` 成功标准表
- [ ] T041 四侧完整门禁：`admin-backend`/`agent-backend`/`frontend`/`admin-frontend` 各跑 `lint + typecheck + test:coverage + build`，确认新增/修改模块覆盖率 ≥ 80%、单文件 ≤ 500 行
- [ ] T042 [P] 文档一致性终检：`spec.md` 修订记录、`contracts/auth-api.md`、`quickstart.md` 与实际实现一致；按 `quickstart.md` 场景 A~I 过一遍端到端并记录证据

---

## 任务与规格映射（可追溯）

| 规格条目 | 覆盖任务 |
|---|---|
| `FR-001`（新建用户设密码） | T010、T011、T012、T015、T016 |
| `FR-002`（密码不可逆、不下发） | T005、T006、T010、T011、T039 |
| `FR-003`（密码最低复杂度） | T010、T012、T015、T016 |
| `FR-004`（登录页） | T021、T025、T026 |
| `FR-005`（平台唯一权威源） | T005、T018、T028 |
| `FR-006`（带有效期凭据） | T007、T008、T018 |
| `FR-007`（未登录引导登录） | T023、T030、T031 |
| `FR-008`（拒绝无效凭据，不泄露业务数据） | T027、T028、T029 |
| `FR-009`（按用户数据隔离） | T032、T033、T034 |
| `FR-010`（登出） | T035、T036、T037 |
| `FR-011`（错误码语义、不枚举） | T017、T018、T024 |
| `FR-012`（删除用户不可再登录） | T010（删除后 `read` 不存在）、T045（删除清会话） |
| `FR-013`（存量用户兜底） | T010、T017、T018 |
| `FR-014`（单会话/后登踢前登） | T043、T044、T017、T018、T019、T027、T028、T029、T045 |
| `SC-001`~`SC-006` | T005~T037 逐条对应验收 |
| `SC-007`（性能口径） | T040 |
| `SC-008`（被踢 ≤2s 失效，FR-014 的可度量形式） | T043、T044、T027、T028、T029、T040 |

---

## 依赖与执行顺序

### 阶段依赖

- **Phase 1 Setup**：无依赖，可立即开始
- **Phase 2 Foundational**：依赖 Setup，**阻塞全部用户故事**
- **Phase 3~7 用户故事**：均依赖 Foundational；**US2 依赖 US1**（登录需先有密码哈希）；**US3/US4 依赖 US2**（需先有可签发的凭据）；**US5 依赖 US2/US3**
- **Phase 8 Polish**：依赖所有计划内故事完成

### 故事间依赖

| 故事 | 依赖 | 说明 |
|---|---|---|
| US1（P1） | Phase 2 | 密码哈希（`password.ts`）就位后即可落"建用户设密码" |
| US2（P1） | Phase 2 + **US1** | 登录要验密码，需 US1 的哈希存储 |
| US3（P1） | Phase 2 + **US2** | 运行侧验签与前端守卫都以"存在可签发的凭据"为前提 |
| US4（P2） | Phase 2 + **US3** | 身份注入依赖 US3 的验签钩子；`current-user.ts` 读 ALS 接通隔离 |
| US5（P2） | Phase 2 + **US2/US3** | 登出/过期依赖登录与 401 语义 |

> 说明：US1 是唯一可**完全独立**交付的前端+后端切片（不依赖登录链路）；
> US2 起才引入"凭据"这一跨侧契约。US4 与 US5 各自的验收（隔离、登出/过期）可在
> 前置故事完成后独立验证，不需要对方就位。

### 故事内部顺序

1. 测试先行（TDD）：先提交失败测试，再实现；
2. 后端原语 → 后端端点 → 前端 API → 前端视图/守卫；
3. 每完成一个故事立即跑该故事测试与 `quickstart.md` 对应场景，再进入下一故事。

### 并行机会

- Phase 1：T002 与 T003 可并行（依赖 vs 配置，不同文件）
- Phase 2：T006 与 T008 可并行（两个测试文件）；T005/T007 与其各自测试可先后成对推进
- US1：T010 测试先行；T013/T014（admin-frontend api 两文件）可并行；T016 与 T015 可并行
- US2：T022（api 测试）、T024（useAuth 测试）、T026（LoginView 测试）可并行；T021/T023 与 T018/T019（前端 vs 后端）可并行
- US3：T031 与 T027 可并行（不同侧测试文件）
- US4：T033 与 T032 可并行（测试 vs 实现文件）
- US5：T037 与 T035/T036 可并行
- Phase 8：T038、T039、T040、T042 可并行（四份不同文档/校验）

---

## 并行示例

```text
# 并行 A：Phase 2 两原语测试
T006 密码哈希测试（tests/unit/auth-password.spec.ts）
T008 令牌测试（tests/unit/auth-token.spec.ts）

# 并行 B：US2 前后端
T018→T019→T020 后端登录服务 + 端点 + 装配（admin-backend）
T021→T023→T025 前端 api/auth + useAuth + LoginView（frontend）

# 并行 C：US2 三个前端测试
T022 api/auth.spec.ts
T024 useAuth.spec.ts
T026 LoginView.spec.ts
```

---

## 实施策略

### MVP 优先（只做 US1）

1. 完成 Phase 1 + Phase 2（不可跳过）；
2. 完成 Phase 3（US1）；
3. **停下验证**：`user-links-password.spec.ts` 全绿 + `quickstart.md` 场景 A；
4. 此时已可交付"管理员新建用户并设密码"的最小闭环（管理侧）。

### 增量交付

1. Setup + Foundational → 底座就绪（密码哈希 + 令牌原语）；
2. US1 → 独立验证 → 可演示（建用户设密码）；
3. US2 → 独立验证 → 可演示（登录）；
4. US3 → 独立验证 → 可演示（未登录拦截）；
5. US4 → 独立验证 → 可演示（按用户数据隔离）；
6. US5 → 独立验证 → 可演示（登出与过期）；
7. 每个故事都不破坏前一个故事的验收。

### 多人协作

- Phase 1~2 由一人主推（文件少、强顺序）；
- US1 后端（admin-backend）与 US1 前端（admin-frontend）可两人并行；
- US2 起，admin-backend（登录服务）与 frontend（登录页/守卫）可两人并行，但 `contracts/auth-api.md`
  是唯一契约来源，两端必须先行对齐再各自实现（契约冻结在 T004）。

---

## 验收清单（全部满足才算完成）

- [ ] `FR-001`~`FR-014` 与 `SC-001`~`SC-008` 均有对应任务与验证证据（映射见上表）
- [ ] 五个故事各自的**自动化**独立验证均通过
- [ ] 密码明文在响应/列表/详情/日志/审计中的出现次数为 0（T039 可机械断言）
- [ ] 解耦：`agent-backend/src/domain/**` 无 `infra/auth` 反向依赖；`getCurrentUser()` 53 处调用点零改动（T032/T039）
- [ ] 凭据契约三侧一致：`contracts/auth-api.md` 为唯一来源（T004）
- [ ] 四侧门禁全绿、新增/修改模块覆盖率 ≥ 80%、单文件 ≤ 500 行、`SC-007` 实测值已回填（T041/T040）

---

## 基线记录（T001 回填）

| 项 | 结果 |
|---|---|
| admin-backend 改动前（lint/typecheck/test） | 待回填 |
| agent-backend 改动前（lint/typecheck/test） | 待回填 |
| frontend 改动前（lint/typecheck/test） | 待回填 |
| admin-frontend 改动前（lint/typecheck/test） | 待回填 |

## 手验记录（quickstart 场景 A~J，T042 回填）

| 场景 | 结果 | 证据 |
|---|---|---|
| A 新建用户设密码 | 待回填 | — |
| B 登录成功 | 待回填 | — |
| C 探针与受保护请求 | 待回填 | — |
| D 未登录 401 | 待回填 | — |
| E 白名单放行 | 待回填 | — |
| F 登录失败不枚举 | 待回填 | — |
| G 登出 | 待回填 | — |
| H 页面级隔离 | 待回填 | — |
| I 登录态过期 | 待回填 | — |
| J 互踢（后登踢前登） | 待回填 | — |

## 解耦校验记录（T039 回填）

| 检查 | 命令 | 结果 |
|---|---|---|
| 运行侧反向依赖 | 检索 `agent-backend/src/domain/**` 是否引用 `infra/auth` | 待回填 |
| 明文密码零出现 | 检索全仓响应/日志是否出现明文密码 | 待回填 |
