# 任务清单：管理端接口统一鉴权

- [ ] T001 新增 `admin-backend/src/domain/auth/guard.ts`：路由白名单（公开 4 条 / 登录即可 3 条）、`requireLogin` 迁入、`createAdminGuard` 钩子
- [ ] T002 `admin-backend/src/routes/auth.ts` 改为复用 guard 的 `requireLogin`（导出保持兼容）
- [ ] T003 `admin-backend/src/server.ts` 注册钩子；`BuildServerOptions` 增加 `adminGuard` 注入点
- [ ] T004 `AuthService.logout(userId, sessionId)` 加会话归属校验；路由传 `claims.sessionId`
- [ ] T005 `tests/helpers/fixture.ts` 默认注入 no-op 守卫，并支持 `requireAdminAuth: true` 走真实守卫
- [ ] T006 新增 `tests/unit/auth-guard.spec.ts`：路由归类与匹配
- [ ] T007 新增 `tests/integration/admin-auth.spec.ts`：401 / 403 / 自助端点 / 双会话 / 登出隔离
- [ ] T008 同步 `tests/unit/auth-service.spec.ts` 的 logout 调用
- [ ] T009 回归：`vitest --run`、`tsc --noEmit`、`eslint src tests`
- [ ] T010 回写 `specs/001-digital-human-platform/contracts/admin-api.md` 的鉴权说明（哪些端点需登录 / 需管理员）
