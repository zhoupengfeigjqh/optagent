# 任务清单：数字人管理平台登录授权入口

**端点命名（2026-11-23 定稿）**：`POST /api/admin/auth/admin-login`、`GET /api/admin/auth/admin-me`、`POST /api/admin/auth/admin-logout`（模块名仍用 `console`，指"控制台会话"，用于区分 024 的业务使用者登录）。

**输入**：`specs/028-admin-login-auth/` 下的 `spec.md`（v1.1）、`plan.md`、`research.md`、`data-model.md`、`contracts/console-auth-api.md`、`quickstart.md`
**影响侧**：`admin-backend`（接口与守卫）、`admin-frontend`（登录页与守卫）；`gateway` / `frontend` / `agent-backend` 不改
**测试**：**必做**（宪章原则三 NON-NEGOTIABLE）：后端每端点集成测试 + 领域/基础设施单测；前端组件与 composable / api 模块同名同目录 spec。**先写测试并确认失败，再实现**。

> **v1.1（2026-11-23，按 `/speckit.analyze` 修订）**：新增 T020（前端不持久化凭据验证）、T033（双登录并存隔离）、T039（后退/前进不可绕过）；T029 扩展为覆盖**写接口**且断言无副作用；T026 增补"账号不存在与密码错误同码"断言；T027 明确 `req_id` 由**路由层**记录；T017/T023 补齐组件级键盘/读屏验证与防重复提交、空字段不发请求的断言；T046 明确性能测量口径。

## 格式说明

- `[P]`：与同批次其它任务**不同文件**且无未完成依赖，可并行
- `[USn]`：对应 `spec.md` 的用户故事（仅用户故事阶段标注）
- 路径均为仓库相对路径（`admin-backend/…`、`admin-frontend/…`、`specs/…`）

---

## Phase 1：准备（共享基础设施）

**目的**：把跨故事共用的配置、错误码与契约先钉死，避免实现期反复改动。

- [ ] T001 在 `admin-backend/src/config.ts` 增加 `AUTH_CENTER_URL`（默认 `http://192.168.0.156:8999/dh-auth-center`）、`AUTH_CENTER_TIMEOUT_MS`（默认 5000，≥100）、`AUTH_CONSOLE_TTL_SECONDS`（默认 43200，≥60）三项及对应 `AppConfig` 字段；同步补 `admin-backend/.env`、`admin-backend/.env.example`（含 `.env.local` 创建样板注释）说明"内网地址、容器可直连"
- [ ] T002 [P] 新增错误码 `ADM_AUTH_CENTER_UNREACHABLE`（503）**四处同步**：`admin-backend/src/domain/error-codes.ts`（常量 + `ERROR_STATUS`）、`specs/001-digital-human-platform/contracts/admin-api.md` §0.4 总表、`admin-frontend/src/constants/error-messages.ts`（常量 + 中文文案「认证服务暂不可用，请稍后重试」）
- [ ] T003 [P] 更新 `specs/001-digital-human-platform/contracts/admin-api.md`：§11 状态从"预登记、未实施"改为"已实施（028）：`/api/admin/*` 统一 401 拦截，放行清单见 028 契约"；§12 增补一行指向 `specs/028-admin-login-auth/contracts/console-auth-api.md`

**Checkpoint**：配置与错误码可编译；`cd admin-backend && npm run check:contract` 通过。

---

## Phase 2：基础能力（阻塞所有用户故事）

**目的**：认证中心客户端、控制台会话签发/验签、装配与测试夹具。**⚠️ 本阶段完成前不得开始任何用户故事。**

- [ ] T004 [P] 实现 `admin-backend/src/infra/auth-center-client.ts`：`adminLogin(username, password)` → `{accessToken, expiresIn}`；`AbortController` 有界超时；按**业务码**映射（`401`→`ADM_INVALID_CREDENTIALS`、`400`→`VALIDATION_FAILED`、其它非 0/非 JSON/网络失败/超时→`ADM_AUTH_CENTER_UNREACHABLE`）；不记录请求体；**不保存** `accessToken`（仅回传 `expiresIn` 供会话定长）
- [ ] T005 [P] 编写 `admin-backend/tests/unit/auth-center-client.spec.ts`：成功、业务码 401、业务码 400、业务码未知、非 JSON、超时/连接失败（注入 `fetch` 桩）
- [ ] T006 [P] 实现 `admin-backend/src/domain/auth/console-token.ts`：独立 Cookie 名 `optagent_console`、`aud=optagent-admin-console`、`iss=optagent-admin`、HS256（复用 `AUTH_SECRET`）、TTL 取 `min(expiresIn, AUTH_CONSOLE_TTL_SECONDS)`；`signConsoleSession` / `verifyConsoleSession` / `consoleCookieHeader` / `clearConsoleCookieHeader`
- [ ] T007 [P] 编写 `admin-backend/tests/unit/console-token.spec.ts`：签发后可验、过期拒、篡改拒、`aud` 不符拒、024 凭据（`aud=optagent-agent`）互相不认账
- [ ] T008 实现 `admin-backend/src/domain/auth/console-service.ts`：编排"调用认证中心 → 签发会话 → 校验 → 清除"，不含 HTTP 细节（依赖 T004、T006）
- [ ] T009 编写 `admin-backend/tests/unit/console-service.spec.ts`：登录成功返回 Cookie、认证中心异常向上映射、TTL 截断、验签失败归为未认证
- [ ] T010 在 `admin-backend/src/context.ts` 增加 `consoleAuth` 字段，并在 `admin-backend/src/server.ts` 装配（构造 `AuthCenterClient` + `ConsoleAuthService` 并注入 ctx）
- [ ] T011 修改 `admin-backend/tests/helpers/fixture.ts`：默认给 `app.inject` 附带有效控制台会话 Cookie（保留调用方显式传入的 Cookie），并支持 `createFixture({ consoleSession: false })` 关闭

**Checkpoint**：后端单测全绿；夹具默认登录态生效，既有集成测试仍全绿。

---

## Phase 3：US1 - 打开管理平台先见登录页（P1）

**目标**：未登录时访问任何管理地址只看到登录页。
**独立测试**：清空 Cookie 后打开 `/admin/` 与 `/admin/deploy?tab=history`，均停在登录页；已登录时探测接口返回 200。

- [ ] T012 [P] [US1] 新建 `admin-backend/tests/integration/console-auth.spec.ts`：`GET /api/admin/auth/admin-me` 无 Cookie → 401 `ADM_UNAUTHENTICATED`；带有效 Cookie → 200 `{username}`
- [ ] T013 [US1] 新建 `admin-backend/src/routes/console-auth.ts` 实现 `GET /api/admin/auth/admin-me`，并在 `admin-backend/src/server.ts` 注册（接口层只做 HTTP 与错误抛出）
- [ ] T014 [P] [US1] 在 `admin-frontend/src/api/types.ts` 增加控制台会话类型（`ConsoleSession`），新建 `admin-frontend/src/api/console-auth.ts` 提供 `me()`
- [ ] T015 [P] [US1] 新建 `admin-frontend/src/composables/useConsoleAuth.spec.ts`：`checking` 起始态、探针 200 → `authenticated`、探针 401 → `anonymous`、探针网络失败 → `anonymous` 且带可读提示
- [ ] T016 [P] [US1] 新建 `admin-frontend/src/components/auth/LoginPage.spec.ts`：渲染品牌区与「管理员登录」标题、账号/密码输入、显隐按钮、登录按钮；`label for` 与 `aria-describedby` 关联；**不**出现演示账号与"原型说明"文案；仅用键盘可聚焦并提交（触发 `submit` 事件）
- [ ] T017 [P] [US1] 新建 `admin-frontend/src/components/auth/LoginPage.vue`（`<script setup>` + scoped CSS）：布局与字段对齐原型「管理员登录」；表单为原生 `<form>`；错误区 `role="status"`/`aria-live`；实现态不含任何演示凭据。**组件自身任务内完成键盘与读屏验证**（Tab 顺序、焦点可见、`aria-describedby` 指向错误文本、显隐按钮有可读标签）
- [ ] T018 [US1] 实现 `admin-frontend/src/composables/useConsoleAuth.ts`：状态机 `checking/anonymous/authenticated`、`probe()`、`username`（依赖 T014）
- [ ] T019 [US1] 在 `admin-frontend/src/App.vue` 接入守卫：`checking` 渲染"正在校验登录状态"、`anonymous` 只渲染 `LoginPage`、`authenticated` 渲染 `AppShell` 与原功能区；新建 `admin-frontend/src/App.spec.ts` 覆盖三种状态（依赖 T017、T018）
- [ ] T020 [US1] 在 `admin-frontend/src/composables/useConsoleAuth.spec.ts` 与 `admin-frontend/src/components/auth/LoginPage.spec.ts` 增补"凭据不外露"断言：登录前后 `localStorage`/`sessionStorage` 均无写入、请求体与对外暴露的状态中不含令牌字段（对应 FR-006）

**Checkpoint**：US1 可独立验收（登录页出现、探针与状态机正确、凭据不经前端持久化）。

---

## Phase 4：US2 - 管理员用账号密码登录（P1）

**目标**：正确账号密码可进入管理台，并回到原目标页面。
**独立测试**：`admin/123456` 登录成功进入管理台；刷新保持登录。

- [ ] T021 [P] [US2] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加：登录成功 → 200 `{username:"admin"}` + `Set-Cookie: optagent_console=…; HttpOnly`；随后带该 Cookie 调 `me` → 200
- [ ] T022 [US2] 在 `admin-backend/src/routes/console-auth.ts` 增加 `POST /api/admin/auth/admin-login`（请求体 zod 校验 `username`/`password`，成功下发 Cookie，失败不下发）
- [ ] T023 [US2] 在 `admin-frontend/src/api/console-auth.ts` 增加 `login(username, password)`
- [ ] T024 [US2] 在 `admin-frontend/src/components/auth/LoginPage.vue` 实现提交：本地非空校验（字段级提示、**为空时不发起请求**）、请求中按钮禁用并显示"登录中"（**重复点击只产生一次请求**）、成功后 `emit('success')`，失败保留账号并清空密码；同步在 `LoginPage.spec.ts` 用 `fetch`/api 桩断言"空字段零调用""连点一次调用"
- [ ] T025 [US2] 在 `admin-frontend/src/composables/useConsoleAuth.ts` 增加 `login()` 并补充 spec：成功 → `authenticated` + `username`；在 `App.spec.ts` 断言登录后仍渲染原功能区（URL 未变，故原目标路径自然保留）

**Checkpoint**：登录闭环可用（US1 + US2 = 最小可用增量）。

---

## Phase 5：US3 - 登录失败与认证服务异常的明确反馈（P1）

**目标**：错误密码、认证服务不可达、非预期响应都有确定提示，且不放行。
**独立测试**：错误密码与不可达地址各试一次，均停留登录页且提示可读。

- [ ] T026 [P] [US3] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加：认证中心业务码 401 → 401 `ADM_INVALID_CREDENTIALS`（**账号不存在与密码错误返回同一码同一文案**）；业务码 400 → 400 `VALIDATION_FAILED`；不可达/非 JSON/其它业务码 → 503 `ADM_AUTH_CENTER_UNREACHABLE`；断言响应体不含密码、不含业务数据（认证中心以注入桩替换）
- [ ] T027 [US3] 在 `admin-backend/src/infra/auth-center-client.ts` 完善错误映射（仅抛结构化 `ApiError`，可选接收 `reqId`）；在 `admin-backend/src/routes/console-auth.ts` 的登录路径**捕获并记录**结构化日志：`auth_center.login_rejected`（info，含业务码）、`auth_center.unreachable`（warn，含 `req_id`/耗时/原因），**不含请求体与密码**
- [ ] T028 [US3] 在 `admin-frontend/src/components/auth/LoginPage.vue` 完成失败态：按 `code` 映射文案（`ADM_INVALID_CREDENTIALS` 提示账号或密码不正确；`ADM_AUTH_CENTER_UNREACHABLE` 提示认证服务暂不可用；`VALIDATION_FAILED` 提示内容不合法）、错误区 `aria-live` 播报、失败后聚焦首个错误字段；同步补 `LoginPage.spec.ts` 失败态用例（3 种码 + 网络错误）

**Checkpoint**：US3 可独立验收（三类失败提示均正确且不放行，日志含可关联线索且不含密码）。

---

## Phase 6：US4 - 未登录不得取用管理数据（P1）

**目标**：服务端统一拦截未认证访问；页面 401 时回登录页且无副作用。
**独立测试**：无 Cookie 直接请求任意管理接口被拒；伪/过期 Cookie 同样被拒；写接口被拒后磁盘无变化；024 端点、OPTIONS 与双登录并存不受影响。

- [ ] T029 [P] [US4] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加守卫用例：无 Cookie 调 `GET /api/admin/agents` → 401 `ADM_UNAUTHENTICATED` 且无业务数据；伪造/过期 Cookie → 401；带有效 Cookie → 200；**无 Cookie 调任一写端点（如 `POST /api/admin/agents`）→ 401，且用 `snapshotTree` 断言平台设计态目录零变化**；`GET /api/admin/auth/session/valid` 无 Cookie → 200；`OPTIONS` 预检 → 非 401
- [ ] T030 [US4] 在 `admin-backend/src/server.ts` 增加 `onRequest` 守卫钩子：仅 `/api/admin/` 前缀生效、放行 `/api/admin/auth/` 与 `OPTIONS`、验签失败抛 `ApiError(ADM_UNAUTHENTICATED, '登录状态已失效，请重新登录')`
- [ ] T031 [US4] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加 `consoleSession: false` 夹具分支的用例（确认关闭后业务端点返回 401），避免"夹具默认登录"掩盖守卫缺陷
- [ ] T032 [US4] 在 `admin-frontend/src/api/http.ts` 增加模块级 `onUnauthorized` 回调（仅 `status===401 && code==='ADM_UNAUTHENTICATED'` 触发）并补 `admin-frontend/src/api/http.spec.ts` 用例；在 `useConsoleAuth.ts` 注册"清状态 + 回登录页 + 提示已失效"
- [ ] T033 [US4] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加**双登录并存**用例（SC-009 / FR-012）：同一请求同时带 `optagent_auth` 与 `optagent_console` 时，024 的 `/api/admin/auth/me` 与 `admin-me` 各认自己的凭据；控制台登出后 024 凭据仍可通过其 `/me`，反之亦然（不互相清除）

**Checkpoint**：US4 可独立验收（接口层拒绝、写操作无副作用、页面自动回登录页、两套登录互不干扰）。

---

## Phase 7：US5 - 退出登录与登录态过期（P2）

**目标**：退出即时生效、二次确认、后退不可回；过期有明确提示。
**独立测试**：登录 → 退出 → 再访问需重新登录；模拟过期 → 提示并回登录页；后退/前进不回到已登录内容。

- [ ] T034 [P] [US5] 在 `admin-backend/tests/integration/console-auth.spec.ts` 增加：`POST /api/admin/auth/admin-logout` 204 + 清 Cookie（`Max-Age=0`）；未登录登出同样 204；登出后 `me` → 401
- [ ] T035 [US5] 在 `admin-backend/src/routes/console-auth.ts` 增加 `POST /api/admin/auth/admin-logout`（幂等，不调用认证中心）
- [ ] T036 [US5] 在 `admin-frontend/src/api/console-auth.ts` 增加 `logout()`；在 `useConsoleAuth.ts` 增加 `logout()`（失败也在 `finally` 清状态回登录页），补 spec
- [ ] T037 [US5] 在 `admin-frontend/src/components/layout/AppShell.vue` 增加账号区（显示 `username` + 「退出登录」按钮，`ConfirmDialog` 二次确认，`emit('logout')`），新增 `admin-frontend/src/components/layout/AppShell.spec.ts` 覆盖显示、点击、确认/取消、键盘可达
- [ ] T038 [US5] 在 `admin-frontend/src/App.vue` 接 `AppShell` 的 `logout` 事件并调用 `useConsoleAuth.logout()`；补 `App.spec.ts` 退出后回到登录页的断言
- [ ] T039 [US5] 在 `admin-frontend/src/App.spec.ts` 增补"后退/前进不可绕过"用例：以 `popstate` 模拟历史导航到管理路径，断言未登录时仍只渲染 `LoginPage`（对应 US4-3 / FR-011）

**Checkpoint**：全部用户故事独立可用。

---

## Phase 8：收尾与横切关注点

- [ ] T040 [P] 在 `admin-frontend/vite.config.ts` 的 80% 门禁清单新增 `src/api/console-auth.ts` 与 `src/composables/useConsoleAuth.ts`
- [ ] T041 [P] 校对 `specs/028-admin-login-auth/` 的契约与数据模型与实际实现一致（字段、错误码、Cookie 属性、文件名）；如有偏差回写并补规格 §6 修订记录
- [ ] T042 运行后端门禁：`cd admin-backend && npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build && npm run check:contract && npm run check:lines && npm run check:deps`
- [ ] T043 运行前端门禁：`cd admin-frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run check:lines && npm run check:deps`
- [ ] T044 按 `specs/028-admin-login-auth/quickstart.md` §3（9 条界面验收，含第 9 条双登录并存）与 §4（7 条 curl 打点）逐条验证并记录结果
- [ ] T045 部署冒烟：`docker compose up -d --build` 后按 `quickstart.md` §6 执行 ①～⑦（未登录 401 → 登录 200 → 带 Cookie 200 → 登出 204 → 再访问 401）
- [ ] T046 勾选本文件任务状态，并在 `plan.md` §2 登记实测结果：登录/探针/登出各连跑 20 次取服务端 `reply.elapsedTime` 的 P95 ≤ 500ms、守卫额外开销 P95 ≤ 5ms、前端状态切换反馈 ≤ 100ms（口径见 plan §2）

---

## 依赖关系

```text
Phase 1 (T001–T003)
      │
      ▼
Phase 2 (T004–T011)  ← 阻塞全部用户故事
      │
      ├──────────────┬──────────────┬──────────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼
  US1 T012–T020  US2 T021–T025  US3 T026–T028  US4 T029–T033  US5 T034–T039
      │              │              │              │              │
      └──────────────┴──────────────┴──────────────┴──────────────┘
                                    │
                                    ▼
                          Phase 8 (T040–T046)
```

**说明**：

- US1 → US2 存在**单向**依赖（登录页由 US1 建立，US2 只管提交）；其余故事互不阻塞，但同一文件（`console-auth.spec.ts`、`routes/console-auth.ts`、`api/console-auth.ts`、`LoginPage.vue`、`LoginPage.spec.ts`、`useConsoleAuth.ts`、`App.vue`、`App.spec.ts`）跨故事复用，**按编号顺序做**最稳。
- US4 的守卫会让 US1～US3 期间的集成用例开始要求登录态——T011 已在 Phase 2 预先解决，故顺序不受影响。
- T020、T025、T028、T032、T039 均落在既有 spec 文件上，故不带 `[P]`。
- 每个故事完成即可独立验证；不得跳过测试先写实现（宪章原则三）。

## 并行示例

```text
# Phase 2 可并行（不同文件）：
T004 auth-center-client.ts   ↗
T005 客户端单测               │  同时进行
T006 console-token.ts         │
T007 令牌单测                 ↘

# US1 可并行：
T014 api/console-auth.ts + types.ts
T015 useConsoleAuth.spec.ts
T016 LoginPage.spec.ts
T017 LoginPage.vue

# Phase 8 可并行：
T040 vite.config.ts 覆盖率清单
T041 契约与数据模型校对
```

## 实施策略

1. **最小可用增量**：Phase 1 → Phase 2 → US1 + US2（登录页 + 登录成功进入管理台）。仅完成 US1 时登录不可用，不构成可用增量，故 MVP 边界定在 US1+US2。
2. **增量交付**：US3（失败反馈）→ US4（接口守卫与双登录隔离）→ US5（退出、过期与历史导航）；每步独立验证后再进入下一步。
3. **单人顺序**：按 T001→T046 顺序执行，遇跨故事同文件时严格按编号。
4. **并行团队**：Phase 2 完成后，后端可并行推进 US4 守卫与 US2/US5 端点（不同文件），前端并行推进 US1 页面与 US3 失败态。

## 备注

- 测试一律在**宿主机本地**执行，容器只用于部署冒烟（宪章原则三/八）。
- 提交信息用中文并注明影响侧（如「028 管理台登录：admin-backend 新增控制台会话与守卫」「028 管理台登录：admin-frontend 新增登录页与守卫」）。
- 不得引入新依赖；不得改动 `gateway` / `frontend` / `agent-backend` 的既有行为。
