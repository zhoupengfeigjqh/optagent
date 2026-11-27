/**
 * 登录鉴权路由（`contracts/auth-api.md` §2；028 扩展注册与手机号登录）。
 *
 * - `POST /api/admin/auth/login`：校验账号密码（user_id 或手机号）→ 下发 HttpOnly Cookie。
 * - `POST /api/admin/auth/register`：专属链接注册（028，公开；注册即授权，不自动登录）。
 * - `GET  /api/admin/auth/register-links/:token`：注册页渲染前校验链接（028，公开）。
 * - `GET  /api/admin/auth/me`：登录态探针（028：响应补 phone/display_name/role）。
 * - `GET  /api/admin/auth/my-agents`：当前用户已授权数字人（028，登录）。
 * - `POST /api/admin/auth/logout`：清会话 + 清 Cookie。
 * - `GET  /api/admin/auth/session/valid`：会话内省（供运行侧，免鉴权只读）。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { buildMyAgents } from '../domain/account/my-agents.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import {
  AUTH_COOKIE_NAME,
  clearCookieHeader,
  readCookie,
  verifySession,
} from '../domain/auth/token.js';

/** 从 Cookie 解出当前登录用户（无效/未登录 → `ADM_UNAUTHENTICATED`） */
export async function requireLogin(req: FastifyRequest, ctx: AppContext): Promise<string> {
  const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
  if (!token) throw new ApiError(ERROR_CODES.ADM_UNAUTHENTICATED, '未登录');
  try {
    const claims = await verifySession(token, ctx.config.authSecret);
    // 单会话：登出/被踢后该会话已非当前会话 → 探针即失效
    if (!ctx.auth.introspect(claims.userId, claims.sessionId)) {
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

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/admin/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as {
      user_id?: unknown;
      phone?: unknown;
      password?: unknown;
    };
    const result = await ctx.auth.login(body.user_id, body.password, body.phone);
    reply.header('set-cookie', result.cookie);
    return reply.status(200).send({ user_id: result.userId });
  });

  /**
   * 专属链接注册（028 §4.1）：链接有效 → 建用户 → 自动 `approved` 授权。
   * 不下发 Cookie（D7：注册不自动登录，与原型一致）。
   */
  app.post('/api/admin/auth/register', async (req, reply) => {
    const body = (req.body ?? {}) as {
      link_token?: unknown;
      phone?: unknown;
      display_name?: unknown;
      password?: unknown;
    };
    const result = await ctx.registration.register({
      linkToken: typeof body.link_token === 'string' ? body.link_token : '',
      phone: body.phone,
      displayName: body.display_name,
      password: body.password,
    });
    return reply.status(201).send(result);
  });

  /** 注册页渲染用（公开）：无效/过期/撤销/停用统一 `ADM_INVALID_LINK`（不枚举） */
  app.get('/api/admin/auth/register-links/:token', async (req) => {
    const { token } = req.params as { token: string };
    const { agent } = await ctx.registerLinks.lookup(token);
    // 无效 / 过期 / 撤销 / 停用一律走 `ADM_INVALID_LINK`，不枚举原因；因此响应里只有 agent
    return { agent: { code: agent.code, name: agent.name } };
  });

  app.get('/api/admin/auth/me', async (req) => {
    const userId = await requireLogin(req, ctx);
    const doc = ctx.users.read(userId);
    return {
      user_id: userId,
      phone: doc.phone ?? null,
      display_name: doc.display_name ?? null,
      role: doc.role ?? 'user',
    };
  });

  /**
   * 当前用户**可切换**的数字人（对话工作台「切换数字人」渲染）。
   *
   * 2026-11-27 起判据为 `users.agents[]` ∩ 部署清单：授权只代表"允许部署"，
   * 未部署的数字人不下发（部署是唯一生效闸门）。
   */
  app.get('/api/admin/auth/my-agents', async (req) => {
    const userId = await requireLogin(req, ctx);
    return buildMyAgents(
      {
        readAgents: (id) => ctx.users.readOrNull(id)?.agents ?? null,
        deployedAgents: (id) => ctx.manifest.get(id)?.agent_names ?? [],
        listServices: () => ctx.agentServices.list(),
      },
      userId,
    );
  });

  app.post('/api/admin/auth/logout', async (req, reply) => {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
    let cookie = clearCookieHeader();
    if (token) {
      try {
        const claims = await verifySession(token, ctx.config.authSecret);
        cookie = await ctx.auth.logout(claims.userId);
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
