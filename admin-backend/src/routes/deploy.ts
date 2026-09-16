/**
 * 部署路由（`contracts/admin-api.md` §6.5~§6.9）。
 *
 * - `POST /api/admin/deploy/validate` — **只读**预检，让管理员在真正部署前看到全部错误项
 * - `POST /api/admin/deploy`          — 部署生效（预校验 → 全部通过才写入）
 * - `GET  /api/admin/deploy/history`  — 部署历史（有界返回）
 * - `GET  /api/admin/deploy/manifest` — 部署清单（部署状态与差异报告的基准）
 * - `POST /api/admin/deploy/withdraw` — 撤回：清空该用户在运行环境中的数字人目录
 *
 * 部署对象（`user_ids`）由管理员在「用户与关联数字人」页勾选后传入，
 * **界面 MUST 至少选一个用户**（2026-09-16 十一次调整：不再提供"部署全部用户"的入口，
 * 服务端"缺省 = 全部用户"的语义保留，供脚本/接口调用）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizeLimit } from '../domain/paging.js';
import type { Deployer } from '../domain/deploy/deployer.js';

export function registerDeployRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deployer: Deployer,
): void {
  app.post('/api/admin/deploy/validate', async (req) => {
    const body = (req.body ?? {}) as { user_ids?: unknown };
    const userIds = parseUserIds(body.user_ids);
    return deployer.validate(userIds);
  });

  app.post('/api/admin/deploy', async (req) => {
    const body = (req.body ?? {}) as { user_ids?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    const userIds = parseUserIds(body.user_ids);
    return deployer.deploy(userIds, body.revision);
  });

  app.get('/api/admin/deploy/history', async (req) => {
    const query = (req.query ?? {}) as { limit?: unknown };
    const limit = normalizeLimit(query.limit, 20, 100);
    return deployer.history.list(limit);
  });

  app.get('/api/admin/deploy/manifest', async () => {
    const items = deployer.manifest.read();
    return { items, total: items.length };
  });

  /**
   * 撤回部署（契约 §6.9，用户卡片上的「撤回」）。
   *
   * 清空该用户在运行环境中的**数字人目录**（这些数字人随即失去能力），
   * 平台侧关联与用户文件空间保留——需要时重新部署即可恢复。
   */
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

/** `user_ids` 缺省表示全部用户（契约 §6.5/§6.6） */
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
