# 实施计划：管理端接口统一鉴权

## 技术方案

1. **守卫位置**：新增 `src/domain/auth/guard.ts`，导出
   - `AUTH_PUBLIC_ROUTES`（4 条，方法 + 路径模板）、`AUTH_USER_LEVEL_ROUTES`（3 条）；
   - `requireLogin(req, ctx)`（从 `routes/auth.ts` 迁入，避免与路由模块循环依赖）；
   - `createAdminGuard(ctx)` → Fastify `onRequest` 钩子：白名单直接放行；其余先 `requireLogin`，再按角色判定。

2. **挂载点**：`server.ts` 在注册路由**之前** `app.addHook('onRequest', guard)`；`BuildServerOptions` 增加 `adminGuard?: AdminGuard`，默认取 `createAdminGuard(ctx)`。

3. **路由归属**：仅 `/auth/me`、`/auth/my-agents`、`/auth/logout` 为「登录即可」，其余 `/api/admin/**` 为管理员专用。路径匹配用**首段匹配 + 精确方法**，避免把 `/api/admin/agents` 误判为 `/auth`。

4. **登出修正**：`AuthService.logout(userId, sessionId)`，内部 `isCurrentSession` 通过才 `clearSession`；路由传 `claims.sessionId`。

5. **错误码**：复用既有 `ADM_FORBIDDEN`（403）与 `ADM_UNAUTHENTICATED`（401），不新增码，前端无需改映射。

## 测试策略

- 既有集成测试：`tests/helpers/fixture.ts` 默认注入 no-op 守卫（记录"已禁用鉴权"），保证业务用例不被登录流程淹没；
- 新增 `tests/integration/admin-auth.spec.ts`：以**真实守卫**构建，覆盖 FR-001~004（无 Cookie 401、普通用户 403、自助端点 2xx、双会话旧 token 401、登出不误杀当前会话）；
- 新增 `tests/unit/auth-guard.spec.ts`：路由归类（公开 / 登录即可 / 管理员）与匹配函数；
- `AuthService.logout` 签名变更同步 `tests/unit/auth-service.spec.ts`。

## 风险与取舍

| 风险 | 取舍 |
|---|---|
| 每个管理请求多一次用户角色读取 | 内存投影读，O(1)，可忽略 |
| 测试注入 no-op 会让业务用例不再覆盖鉴权 | 由专门 spec 覆盖；no-op 仅存在于测试装配 |
| `/auth/session/valid` 保持公开 | agent-backend 无 Cookie 调用该端点，无法加鉴权；它只返回布尔，不泄漏会话内容 |
| `/auth/me` 对普通用户开放 | 前台登录态需要；返回内容仅当前用户自身字段 |

## 验收

`npx vitest --run` 全绿 + `tsc --noEmit` + `eslint src tests` 干净；手工验证 `curl /api/admin/users` 无 Cookie 返回 401。
