/**
 * 专属注册链接路由（028 §4.3，管理员）。
 *
 * - `GET    /api/admin/register-links`：列表（可按 `agent_code` 过滤）；
 * - `POST   /api/admin/register-links`：生成（返回 token + 可直接分发的 url）；
 * - `DELETE /api/admin/register-links/:token`：软撤销（幂等，保留审计轨迹）。
 *
 * 角色强制校验按 D8 后置到阶段 4（届时统一由 admin 路由的鉴权钩子承担）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { normalizeAgentCode } from '../domain/account/account-store.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export function registerRegisterLinkRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/register-links', async (req) => {
    const q = (req.query ?? {}) as { agent_code?: unknown };
    const agentCode =
      typeof q.agent_code === 'string' && q.agent_code.trim() !== ''
        ? normalizeAgentCode(q.agent_code)
        : undefined;
    return { items: await ctx.registerLinks.list(agentCode) };
  });

  app.post('/api/admin/register-links', async (req, reply) => {
    const body = (req.body ?? {}) as {
      agent_code?: unknown;
      expires_in_seconds?: unknown;
    };
    const agentCode = normalizeAgentCode(body.agent_code);
    let expiresIn: number | null | undefined;
    if (body.expires_in_seconds !== undefined && body.expires_in_seconds !== null) {
      const value = Number(body.expires_in_seconds);
      if (!Number.isInteger(value) || value < 0) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `expires_in_seconds 须为 ≥0 的整数（0 = 长期有效；当前：${String(body.expires_in_seconds)}）`,
        );
      }
      expiresIn = value === 0 ? null : value;
    }
    // `created_by` 暂缺（2026-11-27 记录）：本组路由尚无登录鉴权，拿不到"当前是谁"。
    // 待 `/api/admin/*` 统一接入 `requireLogin` 后，把返回值传进来即可补齐审计。
    const link = await ctx.registerLinks.create({ agentCode, expiresIn });
    return reply.status(201).send({
      token: link.token,
      url: ctx.registerLinks.urlOf(link.token),
      agent_code: link.agent_code,
      expires_at: link.expires_at,
    });
  });

  app.delete('/api/admin/register-links/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    await ctx.registerLinks.revoke(token);
    return reply.status(204).send();
  });
}
