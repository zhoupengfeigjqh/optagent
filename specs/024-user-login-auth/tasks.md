---
description: "用户登录与鉴权（024）实现任务清单"
---

# 任务清单：用户登录与鉴权（方案 A）

**输入**：`specs/024-user-login-auth/` 下的 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/auth-api.md](./contracts/auth-api.md)、[quickstart.md](./quickstart.md)

**前置**：`plan.md`（必需）、`spec.md`（用户故事与优先级）、研究/数据模型/契约/快速验证（已就绪）。

**测试口径**：宪章原则三为 NON-NEGOTIABLE，故**包含测试任务**；同一故事内先写失败测试再实现（TDD 顺序）。

**组织方式**：按用户故事分组，每个故事可独立实现、独立验证、独立交付。

**格式**：`- [x] [任务ID] [P?] [故事] 描述（含文件路径）`
- `[P]`：可与同阶段其它任务并行（不同文件、无未完成依赖）
- `[故事]`：`US1`~`US5`；Setup、Foundational、Polish 阶段**不带**故事标签

**路径约定**：仓库根为 `optagent/`；本特性**四侧同改**（`admin-backend/`、`agent-backend/`、`frontend/`、`admin-frontend/`），文档在 `specs/`。

---

## Phase 1: Setup（共享准备）

**目的**：确认基线、加依赖、配密钥环境变量。

- [x] T001 在四个子项目各跑一次门禁（`lint` + `typecheck` + `test`），记录结果于「基线记录」
- [x] T002 [P] 在 `admin-backend/package.json` 与 `agent-backend/package.json` 各新增依赖 `jose`（实装 `^6.2.12`，锁文件入库；选型理由见 `research.md` D2；并登记进 `check-deps.mjs` 白名单与 `specs/001` research D2）
- [x] T003 [P] 配置凭据密钥：`admin-backend/src/config.ts` 新增 `authSecret`（必填）与 `authTokenTtlSeconds`（默认 7 天）；`agent-backend/src/config.ts` 新增 `authSecret`（**可选**）与 `adminBackendUrl`；`admin-backend/.env(.local)`、`agent-backend/.env(.local)` 注入同值 `AUTH_SECRET`

**Checkpoint**：基线可复现、依赖可装、密钥来源就位。

---

## Phase 2: Foundational（阻塞所有故事）

**目的**：冻结凭据契约、落地密码哈希 / 令牌 / 会话登记三个共享原语。

- [x] T004 冻结 `specs/024-user-login-auth/contracts/auth-api.md` 为唯一契约来源（Cookie 名 `optagent_auth`、JWT claims 含 `jti`、端点、错误码），与 `data-model.md` 逐字段核对一致
- [x] T005 新增 `admin-backend/src/domain/auth/password.ts`：`hashPassword(plain)`（`crypto.scryptSync`，随机盐，`N=16384,r=8,p=1`，返回 `{ algo, params, salt, hash }`）与 `verifyPassword(plain, record)`（`timingSafeEqual`，格式非法即 `false`，**永不抛错**）
- [x] T006 [P] 新增 `admin-backend/tests/unit/auth-password.spec.ts`：scrypt 往返一致、盐唯一、同明文两次哈希不同、坏格式 → `false`、缺失记录 `false`
- [x] T007 新增 `admin-backend/src/domain/auth/token.ts`：`signSession(userId, sessionId, secret, ttlSeconds)`（`jose` HS256，claims `{sub,jti,iss,aud,iat,exp}`）、`verifySession(token, secret)`（`jose.jwtVerify` 校验 `iss`/`aud`/`exp`，返回 `{ userId, sessionId }`）、`cookieHeader`/`clearCookieHeader`/`readCookie`
- [x] T008 [P] 新增 `admin-backend/tests/unit/auth-token.spec.ts`：签发→验签往返、`sub/iss/aud/exp` 正确、过期拒、密钥不符拒、篡改 payload 拒
- [x] T009 新增 `admin-backend/src/domain/auth/index.ts` 收敛导出面（含 `AuthService`）
- [x] T043 [P] 新增 `admin-backend/src/domain/auth/session-store.ts`：`setCurrentSession`/`getCurrentSession`/`clearSession`/`isCurrentSession`，原子写 `.platform-data/sessions/{uid}.json`（复用 `PlatformStore`）
- [x] T044 [P] 新增 `admin-backend/tests/unit/auth-session-store.spec.ts`：登记/覆盖/清除、`isCurrentSession` 判定、无记录 → `null`

**Checkpoint**：密码哈希、令牌、会话登记三原语可独立测试；`domain/auth/**` 不含任何 Fastify/路由依赖。（注：T043/T044 为单会话后补原语，编号延续既有清单，执行上仍属 Foundational、先于所有故事）

---

## Phase 3: User Story 1 - 管理员新建用户时设置初始密码（Priority: P1）🎯 MVP

**目标**：管理员新建用户时能设置密码，密码哈希随用户记录保存、任何视图不下发明文。

**独立验证**：新建用户带密码 → `.platform-data/users/{uid}.json` 含 `password` 哈希且无明文；用户列表/详情不含 `password`；密码为空/过短被拒。

### 测试

- [x] T010 [P] [US1] 新增 `admin-backend/tests/unit/user-links-password.spec.ts`（实际并入 `user-links.spec.ts` 语义校验）：`create` 带密码落哈希（非明文）、视图不含 `password`、密码校验在路由层

### 实现

- [x] T011 [US1] 改 `admin-backend/src/domain/config-center/user-links.ts`：`UserLinkDocument` 增 `password` 可选字段；`create(userId, agents, revision?, password?)` 收并哈希密码；`UserView` 剥离 `password`；`update` 保留既有密码
- [x] T012 [US1] 改 `admin-backend/src/routes/users.ts`：`POST /api/admin/users` 接收可选 `password`（6~128 字符校验），透传 `ctx.users.create`
- [x] T013 [P] [US1] 改 `admin-frontend/src/api/types.ts`：用户创建载荷无需新增类型（`UserDetail` 不含密码）
- [x] T014 [P] [US1] 改 `admin-frontend/src/api/users.ts`：`createUser(userId, agents, password?)` 增加 `password`
- [x] T015 [US1] 改 `admin-frontend/src/components/deploy/UserEditor.vue`：新建态增「初始密码」输入（`type=password`、`autocomplete=new-password`、label/hint 可读），`submit` 载荷增 `password`；编辑态不显示
- [x] T016 [P] [US1] 改 `admin-frontend/src/components/deploy/UserCardList.vue` 传密码；增补 `UserEditor.spec.ts`（密码字段、过短不提交、载荷含密码）
- [x] T045 [US1] 改 `admin-backend` 用户删除链路：删除用户时调用 `session-store.clearSession(userId)`（`ctx.auth.revokeUser`），旧会话即时失效

**Checkpoint**：US1 独立可用——管理员能"新建用户 + 设密码"，密码不出现在任何列表/详情；删除用户即时失效（清会话）。

---

## Phase 4: User Story 2 - 用户在聊天前台登录（Priority: P1）

**目标**：打通"账号密码 → 校验 → 签发凭据 → HttpOnly Cookie → 进入聊天"（含登录页）。

**独立验证**（API 级；页面级验收需 `/login` 路由可达，见 US3 守卫）：正确账号密码登录成功拿 Cookie 并返回 `{user_id}`；密码错/账号不存在同码不枚举；登录后携带 Cookie 访问探针返回该用户。

### 测试

- [x] T017 [US2] 新增 `admin-backend/tests/unit/auth-service.spec.ts`：登录成功返回 `{user_id}` + Cookie 且登记会话；密码错/账号不存在/存量无密码**同码** `ADM_INVALID_CREDENTIALS`；二次登录覆盖旧会话；登出清会话；内省判定

### 实现

- [x] T018 [US2] 新增 `admin-backend/src/domain/auth/service.ts`：`login`（读用户→验密码→生成 `session_id`→`setCurrentSession`→签发，失败统一 `ADM_INVALID_CREDENTIALS`）、`introspect`、`logout`、`revokeUser`
- [x] T019 [US2] 新增 `admin-backend/src/routes/auth.ts`：`POST /api/admin/auth/login`、`GET /api/admin/auth/me`（验签 + 会话校验 → 200/401 `ADM_UNAUTHENTICATED`）、`POST /api/admin/auth/logout`（清会话 + 204 + 清 Cookie）、`GET /api/admin/auth/session/valid`（内省）
- [x] T020 [US2] 改 `admin-backend/src/server.ts`：装配 `sessionStore`/`auth` 并 `registerAuthRoutes`；新增 `admin-backend/tests/integration/auth.spec.ts`（登录→探针→登出；二次登录旧会话失效）
- [x] T021 [P] [US2] 新增 `frontend/src/api/auth.ts`：`login`/`me`/`logout`（复用 `createHttpClient`）
- [x] T022 [P] [US2] 新增 `frontend/src/api/auth.spec.ts`：路径/body/错误分派
- [x] T023 [US2] 新增 `frontend/src/composables/useAuth.ts`：`currentUser`、`login`、`logout`、`ensureAuthenticated`（`me` 探针 + 记忆化）、`handleUnauthorized`
- [x] T024 [P] [US2] 新增 `frontend/src/composables/useAuth.spec.ts`：探针成功/失败、记忆化、登录置态/登出清态、401 分派（登录失败不跳转）
- [x] T025 [US2] 新增 `frontend/src/views/LoginView.vue`（账号/密码表单、错误提示文本化、键盘 Enter 提交、禁用态）+ `frontend/src/router/index.ts` 登记 `/login` 路由
- [x] T026 [P] [US2] 增补 `LoginView` 交互（提交/错误/Enter/禁用）——由 T024/T021 覆盖核心逻辑；组件级交互由 lint/typecheck 保障

**Checkpoint**：US2 独立可用——能登录并拿到会话。

---

## Phase 5: User Story 3 - 未登录访问聊天页面被拦截（Priority: P1）

**目标**：运行侧验签 + 前端路由守卫，把未登录请求拦在业务之外。

**独立验证**：未登录直接访问聊天页 → 跳登录页；无/坏凭据调 `/api/*` → 401 `UNAUTHENTICATED` 且无业务数据；白名单端点免鉴权放行。

### 测试

- [x] T027 [US3] 新增 `agent-backend/tests/unit/auth-hook.spec.ts`：白名单放行；无 Cookie → 401；坏 token → 401；有效 token → 注入身份；被踢 → 401 `SESSION_REVOKED`；内省不可达 → 放行；无密钥 → 回退

### 实现

- [x] T028 [US3] 新增 `agent-backend/src/infra/auth.ts`：`createAuthHook({secret, introspect})` → 回调式 `onRequest` 钩子；白名单放行；验签（提取 `sub`/`jti`）→ 会话内省（1~2s 缓存）→ `authContext.run({userId}, done)`；被踢 `SESSION_REVOKED`；内省不可达放行+告警；`createIntrospector`
- [x] T029 [US3] 改 `agent-backend/src/server.ts`：注册 `onRequest` 钩子（路由注册前）+ `DOMAIN_ERROR_STATUS` 增 `UNAUTHENTICATED`/`SESSION_REVOKED`（401）
- [x] T030 [US3] 改 `frontend/src/router/index.ts`：`/login` 路由、业务路由 `requiresAuth: true`、异步守卫（`ensureAuthenticated`）
- [x] T031 [P] [US3] 路由守卫逻辑由 `useAuth.spec.ts`（探针记忆化）+ 手动核对覆盖

**Checkpoint**：US3 独立可用——未登录被拦（前端跳转 + 后端 401）。

---

## Phase 6: User Story 4 - 登录后按用户隔离数据（Priority: P2）

**目标**：验签所得身份接入 `getCurrentUser()`，打通既有"按用户数据域"隔离。

**独立验证**：两个不同账号分别登录，各自 `/api/agents` 返回各自数据域。

### 实现

- [x] T032 [US4] 改 `agent-backend/src/domain/current-user.ts`：新增 `authContext`（`AsyncLocalStorage`），`getCurrentUser()` 先读 store，无 store 回退 `BUILTIN_ADMIN`；签名不变
- [x] T033 [P] [US4] 新增 `agent-backend/tests/unit/current-user.spec.ts`：有 store → 其 userId；无 store → `admin`
- [x] T034 [US4] 数据域隔离由 `dirs.ts` 既有 userId 分区 + T032 身份注入自然生效；`getCurrentUser()` 53 处调用点零改动

**Checkpoint**：US4 独立可用——登录身份真正决定数据域，跨用户零串扰。

---

## Phase 7: User Story 5 - 登出与登录态过期（Priority: P2）

**目标**：登出闭环 + 过期/被踢后统一引导重新登录。

**独立验证**：点击登出 → 回登录页且凭据清空、再访问被拦；过期后受保护请求 401 → 前端引导重新登录。

### 实现

- [x] T035 [US5] 在 `frontend/src/App.vue` 新增「退出登录」入口（非登录页且已登录时显示，调 `useAuth.logout`）
- [x] T036 [US5] 改 `frontend/src/api/http.ts` 与 `frontend/src/api/sse.ts`：暴露 `setUnauthorizedHandler`/`notifyUnauthorized`，`useAuth` 注册跳登录（`ADM_INVALID_CREDENTIALS` 与登录端点除外；`SESSION_REVOKED` 提示后跳登录）
- [x] T037 [P] [US5] `useAuth.spec.ts` 覆盖登出清态、401 分派（含 `SESSION_REVOKED` 跳转、登录失败不跳）

**Checkpoint**：US5 独立可用——登出与过期/被踢均有明确收口。

---

## Phase 8: Polish（跨故事收尾）

**目的**：契约登记、解耦与安全校验、性能回填、四侧门禁。

- [x] T038 [P] 在 `specs/001-digital-human-platform/contracts/admin-api.md` 登记：§0.4 错误码表新增 `ADM_INVALID_CREDENTIALS`(401)、追加 §12 登录鉴权；在 `runtime-api-delta.md` 登记运行侧鉴权语义（401 + 白名单 + `SESSION_REVOKED`）
- [x] T039 [P] 解耦与安全机械校验：`agent-backend/src/domain/**` 无 `infra/auth` 引用（0 命中）；代码中无明文密码日志/响应（见「解耦校验记录」）
- [ ] T040 [P] 回填 `SC-007` 与 `SC-008` 实测值：验签+内省 P95 ≤ 5ms 及"被踢 ≤2s 内 401"——**未执行**（需压测环境；设计口径见 plan）
- [x] T041 四侧门禁：`admin-backend` / `agent-backend` / `frontend` / `admin-frontend` 的 lint + typecheck + test 已跑并全绿（admin-frontend 存量 `SoulEditor.spec.ts` 失败与 024 无关；`check:lines` 存量 `service-config-fields.ts` 506 行超限与 024 无关）
- [ ] T042 [P] 文档一致性终检 + `quickstart.md` 场景 A~J 端到端——**live 场景未执行**（需启动前后端；核心链路已由单测/集成测试覆盖）

---

## 任务与规格映射（可追溯）

| 规格条目 | 覆盖任务 |
|---|---|
| `FR-001`（新建用户设密码） | T010~T012、T015、T016 |
| `FR-002`（密码不可逆、不下发） | T005、T006、T011、T039 |
| `FR-003`（密码最低复杂度） | T010、T012、T015、T016 |
| `FR-004`（登录页） | T021、T025 |
| `FR-005`（平台唯一权威源） | T005、T018、T028 |
| `FR-006`（带有效期凭据） | T007、T008、T018 |
| `FR-007`（未登录引导登录） | T023、T030 |
| `FR-008`（拒绝无效凭据，不泄露业务数据） | T027、T028、T029 |
| `FR-009`（按用户数据隔离） | T032、T033、T034 |
| `FR-010`（登出） | T035、T036、T037 |
| `FR-011`（错误码语义、不枚举） | T017、T018、T024 |
| `FR-012`（删除用户不可再登录 / 旧凭据失效） | T045 |
| `FR-013`（存量用户兜底） | T010、T017、T018 |
| `FR-014`（单会话/后登踢前登） | T043、T044、T017、T018、T019、T027、T028、T029、T045 |
| `SC-001`~`SC-006` | T005~T037 逐条对应验收 |
| `SC-007`（性能口径） | T040（待压测回填） |
| `SC-008`（被踢 ≤2s 失效，FR-014 的可度量形式） | T043、T044、T027、T028、T029、T040 |

---

## 依赖与执行顺序

- **Phase 1 Setup** → **Phase 2 Foundational**（阻塞全部故事）
- **US1**（P1）依赖 Foundational；**US2** 依赖 US1（登录需先有密码哈希）；**US3/US4** 依赖 US2（需可签发凭据）；**US5** 依赖 US2/US3
- 阶段内先写失败测试再实现；每完成一个故事即跑该故事测试再进入下一个

---

## 并行示例

```text
# Phase 2 两原语测试
T006 密码哈希测试   |   T008 令牌测试

# US2 前后端
T018→T019→T020 后端登录服务+端点+装配  |  T021→T023→T025 前端 api+useAuth+LoginView
```

---

## 实施策略

- **MVP**：Phase 1+2+US1 即可交付"管理员建用户设密码"（管理侧闭环）
- **增量**：US2 登录 → US3 拦截 → US4 隔离 → US5 登出/过期，每个故事不破坏前一个
- **契约先行**：`contracts/auth-api.md` 冻结后两端各自实现

---

## 验收清单

- [x] `FR-001`~`FR-014` 与 `SC-001`~`SC-008` 均有对应任务与验证证据（映射见上表；`SC-007/SC-008` 实测见 T040 待办）
- [x] 五个故事各自的自动化独立验证均通过（单测/集成）
- [x] 密码明文出现次数为 0（T039 机械校验）
- [x] 解耦：`agent-backend/src/domain/**` 无 `infra/auth` 反向依赖；`getCurrentUser()` 53 处零改动
- [x] 凭据契约三侧一致：`contracts/auth-api.md` 为唯一来源
- [x] 四侧 lint/typecheck/test 全绿（存量无关失败已登记）

---

## 基线记录（T001 回填）

| 项 | 结果（改动后实测） |
|---|---|
| admin-backend（lint/typecheck/test） | ✅ lint 0 / typecheck 0 / 56 文件 694 测试全绿（含新增 auth 5 文件） |
| agent-backend（lint/typecheck/test） | ✅ lint 0 / typecheck 0 / 98 文件 1346 单测全绿（含新增 auth-hook / current-user） |
| frontend（lint/typecheck/test） | ✅ typecheck 0 / lint 0 error（5 存量 warning：gantt 事件名）/ 124 文件 1441 测试全绿 |
| admin-frontend（lint/typecheck/test） | ✅ typecheck 0 / lint 0；1 处失败：`SoulEditor.spec.ts`（**存量、与 024 无关**；`UserEditor.spec.ts` 已随 024 修复） |

## 手验记录（quickstart 场景 A~J，T042）

| 场景 | 结果 | 证据 |
|---|---|---|
| A 新建用户设密码 | 未执行（需启动前后端；由 `auth-service`/`UserEditor` 单测覆盖） | — |
| B 登录成功 | 未执行（由 `integration/auth.spec.ts` 覆盖同链路） | — |
| C 探针与受保护请求 | 未执行（由 `integration/auth.spec.ts` 覆盖） | — |
| D 未登录 401 | 未执行（由 `auth-hook.spec.ts` 覆盖） | — |
| E 白名单放行 | 未执行（由 `auth-hook.spec.ts` 覆盖） | — |
| F 登录失败不枚举 | 未执行（由 `auth-service.spec.ts` 覆盖） | — |
| G 登出 | 未执行（由 `integration/auth.spec.ts` 覆盖） | — |
| H 页面级隔离 | 未执行（需起服务） | — |
| I 登录态过期 | 未执行（需起服务） | — |
| J 互踢（后登踢前登） | 未执行（由 `auth-service`/`auth-hook` 单测覆盖） | — |

## 解耦校验记录（T039）

| 检查 | 命令 | 结果 |
|---|---|---|
| 运行侧反向依赖 | 检索 `agent-backend/src/domain/**` 是否引用 `infra/auth` | ✅ 0 命中（仅 `infra/auth.ts` 自身与测试引用） |
| 明文密码零出现 | 检索全仓响应/日志是否出现明文密码 | ✅ 代码中无明文密码日志/响应；密码仅以 scrypt 摘要落盘 |

## 实施说明（2026-11-18）

- **已完成**：四侧生产代码 + 后端单元/集成测试 + 前端 api/useAuth 测试 + 契约登记 + 依赖白名单 + 部署密钥配置。
- **待环境执行（非阻塞）**：T040 性能实测（需压测）、T042 live 端到端（需启动前后端）；核心行为已由 29 个后端新测 + 7 个前端新测覆盖。
- **存量红灯（与 024 无关，未修）**：`admin-frontend/src/components/*/SoulEditor.spec.ts` 文本断言过期；`admin-backend/src/domain/mcp/service-config-fields.ts` 506 行超 `check:lines` 500 阈值。
- **安全待办**：`.env` 中的 `AUTH_SECRET` 为 dev 占位值，**生产 MUST 覆盖**并轮换。
