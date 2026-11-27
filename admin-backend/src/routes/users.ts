import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import {
  isPasswordLengthValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../domain/auth/password.js';
import { anomalyReason, detectAnomalies } from '../domain/config-center/references.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function resolveIndex() {
    return (await ctx.catalog.snapshot()).index;
  }

  app.get('/api/admin/users', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown; expand?: unknown };
    const page = normalizePage(query.page);
    const withSummary = query.expand === 'summary';
    const index = await resolveIndex();

    return ctx.users.list(page, (user) => {
      const agents = user.agents.map((name) => {
        const design = ctx.agents.readOrNull(name);
        if (!design) {
          return { name, abnormal: true, abnormal_reason: `数字人 ${name} 的设计态缺失` };
        }
        const anomalies = detectAnomalies(design, index);
        return { name, abnormal: anomalies.length > 0, abnormal_reason: anomalyReason(anomalies) };
      });

      return {
        user_id: user.user_id,
        agents,
        deployed_at: ctx.manifest.get(user.user_id)?.last_deployed_at ?? null,
        summary: withSummary
          ? user.agents.map((name) => {
              const design = ctx.agents.readOrNull(name);
              return {
                name,
                mcp_services: design?.mcp_services ?? [],
                enabled_tools: design?.enabled_tools ?? [],
                skills: design?.skills ?? [],
              };
            })
          : null,
      };
    });
  });

  app.post('/api/admin/users', async (req, reply) => {
    const body = (req.body ?? {}) as {
      user_id?: unknown;
      agents?: unknown;
      revision?: unknown;
      password?: unknown;
    };
    assertAgentsExist(ctx, body.agents);
    // 024：新建用户可设初始密码（缺省 = 不设，视为不可登录的存量口径）
    let password: string | undefined;
    if (body.password !== undefined && body.password !== null && body.password !== '') {
      if (
        typeof body.password !== 'string' ||
        body.password.length < PASSWORD_MIN_LENGTH ||
        body.password.length > PASSWORD_MAX_LENGTH
      ) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`,
        );
      }
      password = body.password;
    }
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    const view = ctx.users.create(body.user_id, body.agents, revision, password);
    return reply.status(201).send(view);
  });

  app.put('/api/admin/users/:user_id', async (req) => {
    const { user_id: userId } = req.params as { user_id: string };
    const body = (req.body ?? {}) as { agents?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    assertAgentsExist(ctx, body.agents);
    return ctx.users.update(userId, body.agents, body.revision);
  });

  app.post('/api/admin/users/:user_id/password', async (req) => {
    const { user_id: userId } = req.params as { user_id: string };
    const body = (req.body ?? {}) as { password?: unknown };
    const password = body.password;
    if (typeof password !== 'string' || !isPasswordLengthValid(password)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`,
      );
    }
    const view = ctx.users.setPassword(userId, password);
    ctx.auth.revokeUser(userId);
    return view;
  });

  app.delete('/api/admin/users/:user_id', async (req, reply) => {
    const { user_id: userId } = req.params as { user_id: string };
    // 不存在 → 404（先读一次，避免对未知目录做写操作）
    ctx.users.read(userId);
    ctx.deployer.purgeUser(userId);
    ctx.users.remove(userId);
    ctx.auth.revokeUser(userId);
    return reply.status(204).send();
  });
}

function assertAgentsExist(ctx: AppContext, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const missing = raw.filter((name): name is string => typeof name === 'string' && !ctx.agents.exists(name));
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `关联了不存在的数字人：${missing.join('、')}（可关联的只能是平台内已存在的数字人）`,
    );
  }
}
