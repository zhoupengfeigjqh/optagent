import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizeLimit } from '../domain/paging.js';
import type { Deployer } from '../domain/deploy/deployer.js';

export function registerDeployRoutes(app: FastifyInstance, ctx: AppContext, deployer: Deployer): void {
  app.post('/api/admin/deploy', async (req) => {
    const body = (req.body ?? {}) as { user_ids?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    const userIds = parseUserIds(body.user_ids);
    return deployer.deploy(userIds, body.revision);
  });

  /**
   * 部署历史（**仅运维查询**，2026-11-27）：管理台「数字人部署」区已下架，前端无调用方。
   * 保留是因为 `deploy/history.jsonl` 是部署动作的唯一审计轨迹，排障时需要。
   */
  app.get('/api/admin/deploy/history', async (req) => {
    const query = (req.query ?? {}) as { limit?: unknown };
    const limit = normalizeLimit(query.limit, 20, 100);
    return deployer.history.list(limit);
  });

  app.get('/api/admin/deploy/manifest', async () => {
    const items = deployer.manifest.read();
    return { items, total: items.length, revision: ctx.store.revision() };
  });

  app.post('/api/admin/deploy/withdraw', async (req) => {
    const body = (req.body ?? {}) as { user_id?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    if (typeof body.user_id !== 'string' || body.user_id.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'user_id 必填且不能为空');
    }
    return deployer.withdraw(body.user_id.trim(), body.revision);
  });
}

function parseUserIds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'user_ids 须为字符串数组（缺省表示全部用户）');
  }
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'user_ids 含空值或非字符串项');
    }
  }
  return raw as string[];
}
