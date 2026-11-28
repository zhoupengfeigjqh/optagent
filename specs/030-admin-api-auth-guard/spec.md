# 特性规格：管理端接口统一鉴权

**特性分支**：`030-admin-api-auth-guard`
**创建日期**：2026-11-28
**状态**：Draft
**输入**：用户实测「A 浏览器登录 admin，B 浏览器再登录，A 仍可继续操作，刷新后才退出」

## 问题陈述

`/api/admin/**` 当前只有 4 个 auth 端点走 `requireLogin`（`routes/auth.ts:25`），其余路由（users / agents / mcp / skills / ontology / deploy / platform / agent-services / register-links）在 `server.ts:303-316` 直接注册，没有任何鉴权钩子。后果：

1. 未登录即可调管理接口（`tests/integration/users.spec.ts` 无任何 Cookie 却 17 个用例全绿，即为反证）；
2. `role=user` 的普通用户拿到 Cookie 后同样可调管理接口——后端不校验角色，管理台的前端守卫（`App.vue:29`）只是 UI；
3. 单会话语义事实上只在「页面刷新调用 `/auth/me`」时生效，于是出现"被踢下线仍能继续操作"的窗口；
4. `POST /auth/logout` 只按 `userId` 删会话行，A（旧会话）点登出会把 B（当前会话）踢下线。

## 用户场景

### 场景 1 - 未登录不得调用（P1）
**Given** 无 Cookie，**When** 请求 `GET /api/admin/users`、`POST /api/admin/deploy` 或任一管理接口，**Then** 返回 `401 ADM_UNAUTHENTICATED`，不产生任何副作用。

### 场景 2 - 普通用户不得管理（P1）
**Given** 以 `role=user` 登录，**When** 请求管理接口，**Then** 返回 `403 ADM_FORBIDDEN`；而 `/auth/me`、`/auth/my-agents`、`/auth/logout` 仍可用（前台登录态需要它们）。

### 场景 3 - 被踢后立即失效（P1）
**Given** A、B 两个浏览器登录同一账号，B 后登录，**When** A 发起任意管理请求，**Then** 立即 `401`（不再等到刷新），前端按既有 401 善后回登录页。

### 场景 4 - 登出只清自己的会话（P2）
**Given** B 是当前会话、A 持旧 token，**When** A 调 `POST /auth/logout`，**Then** B 的会话不受影响（A 的 token 已非当前会话，本就不该有删除权限）。

## 需求

- **FR-001** `/api/admin/**` 统一 `onRequest` 鉴权；公开端点白名单 6 条：`POST /auth/login`、`POST /auth/register`、`GET /auth/register-links/:token`、`GET /auth/session/valid`、`GET /platform/health`、`POST /auth/logout`（登出幂等，内部校验会话归属后才删行）。
- **FR-002** 登录用户端点白名单：`GET /auth/me`、`GET /auth/my-agents`；其余管理接口要求 `role === 'admin'`，否则 `403 ADM_FORBIDDEN`。
- **FR-003** 鉴权顺序：先验签 + 会话内省 + 用户存在性（`requireLogin`），再判角色。
- **FR-004** `logout` 仅当 `claims.sessionId` 仍是该账号当前会话时才删除会话行。
- **FR-005** 测试装配可注入鉴权钩子：生产默认真实守卫；既有集成测试注入 no-op（避免上千处 `inject` 逐个加 Cookie），并新增专门用例以真实守卫覆盖 FR-001~004。

## 非目标

- 不做接口级 RBAC（细粒度权限矩阵）；
- 不改前端鉴权模型（仍靠 HttpOnly Cookie + 401 统一善后）；
- 不改 agent-backend（其已有全局钩子与内省）。

## 成功标准

- **SC-001** 白名单 4 条以外的 `/api/admin/**` 在无 Cookie 时全部 401（逐路由清单核对 + 真库集成测试）。
- **SC-002** `role=user` 令牌访问管理接口全部 403，访问 3 条自助端点仍 2xx。
- **SC-003** 双会话场景下旧会话的下一次请求即 401。
- **SC-004** 全量回归绿：单测 + 集成（含真库）+ `tsc` + `eslint`。

## 修订记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-28 | v0.1 | 首版：源自实测的"被踢仍可操作"缺陷，确立全局守卫与角色分级 |
