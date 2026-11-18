/**
 * 登录鉴权路由（`contracts/auth-api.md` §2）。
 *
 * - `POST /api/admin/auth/login`：校验账号密码 → 下发 HttpOnly Cookie。
 * - `GET  /api/admin/auth/me`：登录态探针。
 * - `POST /api/admin/auth/logout`：清会话 + 清 Cookie。
 * - `GET  /api/admin/auth/session/valid`：会话内省（供运行侧，免鉴权只读）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import {
  AUTH_COOKIE_NAME,
  clearCookieHeader,
  readCookie,
  verifySession,
} from '../domain/auth/token.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/admin/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { user_id?: unknown; password?: unknown };
    const result = await ctx.auth.login(body.user_id, body.password);
    reply.header('set-cookie', result.cookie);
    return reply.status(200).send({ user_id: result.userId });
  });

  app.get('/api/admin/auth/me', async (req) => {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
    if (!token) throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '未登录');
    try {
      const claims = await verifySession(token, ctx.config.authSecret);
      // 单会话：登出/被踢后该会话已非当前会话 → 探针即失效
      if (!ctx.auth.introspect(claims.userId, claims.sessionId)) {
        throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '登录已失效');
      }
      return { user_id: claims.userId };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '登录已过期或无效');
    }
  });

  app.post('/api/admin/auth/logout', async (req, reply) => {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
    let cookie = clearCookieHeader();
    if (token) {
      try {
        const claims = await verifySession(token, ctx.config.authSecret);
        cookie = ctx.auth.logout(claims.userId);
      } catch {
        /* 凭据无效：仍清除客户端 Cookie，登出保持幂等 */
      }
    }
    reply.header('set-cookie', cookie);
    return reply.status(204).send();
  });

  app.get('/api/admin/auth/session/valid', async (req) => {
    const q = (req.query ?? {}) as { user_id?: unknown; session_id?: unknown };
    const userId = typeof q.user_id === 'string' ? q.user_id : '';
    const sessionId = typeof q.session_id === 'string' ? q.session_id : '';
    return { valid: userId !== '' && sessionId !== '' && ctx.auth.introspect(userId, sessionId) };
  });
}
