/**
 * 数字人服务基本信息路由（028 §4.4）。
 *
 * - `GET    /api/admin/agent-services`：列表（含已授权用户数）；
 * - `POST   /api/admin/agent-services`：新增（`platform_agent_name` MUST 在平台设计态存在）；
 * - `PUT    /api/admin/agent-services/:code`：改名称 / 启停（code 不可改）；
 * - `DELETE /api/admin/agent-services/:code`：被授权或链接引用 → 409。
 *
 * 角色强制校验按 D8 后置到阶段 4（与 `grants.ts` 同口径）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import {
  normalizeAgentCode,
  requireAgentServiceName,
  requirePlatformAgentName,
} from '../domain/account/account-store.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export function registerAgentServiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/agent-services', async () => {
    return { items: await ctx.agentServices.list() };
  });

  app.post('/api/admin/agent-services', async (req, reply) => {
    const body = (req.body ?? {}) as {
      code?: unknown;
      name?: unknown;
      platform_agent_name?: unknown;
    };
    const code = normalizeAgentCode(body.code, 'code');
    const name = requireAgentServiceName(body.name);
    const platformAgentName = requirePlatformAgentName(body.platform_agent_name);
    // `FR-025` 同口径：绑定落点必须是平台内已存在的数字人，否则授权无法物化
    if (!ctx.agents.exists(platformAgentName)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `platform_agent_name 对应的数字人不存在：${platformAgentName}（须先在数字人设计区创建）`,
      );
    }
    const view = await ctx.agentServices.create({ code, name, platform_agent_name: platformAgentName });
    return reply.status(201).send(view);
  });

  app.put('/api/admin/agent-services/:code', async (req) => {
    const { code: rawCode } = req.params as { code: string };
    const code = normalizeAgentCode(rawCode);
    const body = (req.body ?? {}) as { name?: unknown; status?: unknown };
    const patch: { name?: string; status?: 'enabled' | 'disabled' } = {};
    if (body.name !== undefined && body.name !== null && body.name !== '') {
      patch.name = requireAgentServiceName(body.name);
    }
    if (body.status !== undefined && body.status !== null && body.status !== '') {
      if (body.status !== 'enabled' && body.status !== 'disabled') {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'status 只支持 enabled / disabled');
      }
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '至少提供 name 或 status 之一');
    }
    return ctx.agentServices.update(code, patch);
  });

  app.delete('/api/admin/agent-services/:code', async (req, reply) => {
    const { code: rawCode } = req.params as { code: string };
    await ctx.agentServices.remove(normalizeAgentCode(rawCode));
    return reply.status(204).send();
  });
}
