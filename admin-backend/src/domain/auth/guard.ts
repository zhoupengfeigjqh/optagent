/**
 * 管理端接口统一鉴权（030）。
 *
 * 此前只有 `routes/auth.ts` 内部 4 个端点走 `requireLogin`，其余 `/api/admin/**`
 * 裸注册，导致「未登录可调管理接口」「普通用户可调管理接口」「被踢下线仍能操作」
 * （单会话语义只在页面刷新调用 `/auth/me` 时才生效）。
 *
 * 这里把守卫集中成一处：`server.ts` 在注册路由前挂 `onRequest` 钩子。
 * 分级只有两档——白名单放行、其余须登录；登录后再按路径判是否要求管理员。
 */
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { AUTH_COOKIE_NAME, readCookie, verifySession } from './token.js';

interface RouteRule {
  method: string;
  path: string;
  /** `true` = 路径前缀匹配（用于 `:param` 结尾的端点） */
  prefix?: boolean;
}

/**
 * 免鉴权端点。`session/valid` 由运行环境在无 Cookie 下调用（会话内省的唯一入口）；
 * `platform/health` 是运维/探活口，不含任何账号数据。
 */
export const AUTH_PUBLIC_ROUTES: readonly RouteRule[] = Object.freeze([
  { method: 'POST', path: '/api/admin/auth/login' },
  { method: 'POST', path: '/api/admin/auth/register' },
  { method: 'GET', path: '/api/admin/auth/register-links/', prefix: true },
  { method: 'GET', path: '/api/admin/auth/session/valid' },
  { method: 'GET', path: '/api/admin/platform/health' },
  // 登出天然幂等：只清自己的 Cookie，且会话行仅在「凭据即当前会话」时才删
  // （`AuthService.logout` 内置归属校验）。放进白名单可让旧会话登出返回 204 而非 401。
  { method: 'POST', path: '/api/admin/auth/logout' },
]);

/** 登录即可（不要求管理员）：前台登录态与自助接口 */
export const AUTH_USER_LEVEL_ROUTES: readonly RouteRule[] = Object.freeze([
  { method: 'GET', path: '/api/admin/auth/me' },
  { method: 'GET', path: '/api/admin/auth/my-agents' },
]);

const PREFIX = '/api/admin';

function matches(rule: RouteRule, method: string, path: string): boolean {
  if (rule.method !== method) return false;
  return rule.prefix ? path.startsWith(rule.path) : path === rule.path;
}

/** 该请求是否命中某组规则（导出供单测与路由归类核对） */
export function matchesRules(rules: readonly RouteRule[], method: string, path: string): boolean {
  return rules.some((rule) => matches(rule, method, path));
}

/** 从 Cookie 解出当前登录用户（无效/未登录 → `ADM_UNAUTHENTICATED`） */
export async function requireLogin(req: FastifyRequest, ctx: AppContext): Promise<string> {
  const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
  if (!token) throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '未登录');
  try {
    const claims = await verifySession(token, ctx.config.authSecret);
    // 单会话：登出/被踢后该会话已非当前会话 → 探针即失效
    if (!(await ctx.auth.introspect(claims.userId, claims.sessionId))) {
      throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '登录已失效');
    }
    if (!ctx.users.exists(claims.userId)) {
      throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '登录已失效');
    }
    return claims.userId;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '登录已过期或无效');
  }
}

export type AdminGuard = (req: FastifyRequest) => Promise<void>;

/** 生成 `onRequest` 钩子：白名单 → 登录 → 角色 */
export function createAdminGuard(ctx: AppContext): AdminGuard {
  return async (req: FastifyRequest): Promise<void> => {
    const path = (req.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
    if (!path.startsWith(PREFIX)) return;
    const method = req.method.toUpperCase();
    if (matchesRules(AUTH_PUBLIC_ROUTES, method, path)) return;

    const userId = await requireLogin(req, ctx);
    if (matchesRules(AUTH_USER_LEVEL_ROUTES, method, path)) return;

    const user = ctx.users.readOrNull(userId);
    // 缺省角色按普通用户处理：宁可拒绝，也不因字段缺失放行
    if ((user?.role ?? 'user') !== 'admin') {
      throw new ApiError(ERROR_CODES.ADM_FORBIDDEN, '需要管理员权限');
    }
  };
}
