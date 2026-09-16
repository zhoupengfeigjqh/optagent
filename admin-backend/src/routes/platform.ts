/**
 * 平台与配置路由（`contracts/admin-api.md` §1.1~§1.4）。
 *
 * - `GET  /api/admin/platform/health`          — 全部外部依赖可达性（一次性看到全部问题）
 * - `GET  /api/admin/platform/settings`        — 读取平台设置
 * - `GET  /api/admin/platform/runtime-forms`   — 列出可选运行形态（前端不硬编码）
 * - `PUT  /api/admin/platform/settings`        — 切换目标运行形态（破坏性操作）
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { probePath } from '../infra/fs-probe.js';

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * 健康检查（`quickstart.md` §6 的冒烟确认入口）。
   * **不返回错误码**：依赖不可达以字段表达，便于一次性看到全部问题。
   */
  app.get('/api/admin/platform/health', async () => {
    const platformData = probePath(ctx.config.platformDataDir);
    const optAgent = probePath(ctx.config.optAgentRoot);
    const compose = probePath(ctx.config.composeFilePath);
    const dockerAvailable = await ctx.docker.available();

    return {
      platform_data: { writable: platformData.writable, path: ctx.config.platformDataDir },
      opt_agent: {
        readable: optAgent.readable,
        writable: optAgent.writable,
        path: ctx.config.optAgentRoot,
      },
      compose_file: { readable: compose.readable, path: ctx.config.composeFilePath },
      docker: { available: dockerAvailable },
      runtime_form: ctx.settings.targetForm(),
    };
  });

  app.get('/api/admin/platform/settings', async () => ctx.settings.get());

  app.get('/api/admin/platform/runtime-forms', async () => ({
    items: ctx.settings.listForms(),
  }));

  app.put('/api/admin/platform/settings', async (req) => {
    const body = (req.body ?? {}) as { target_runtime_form?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    return ctx.settings.set(body.target_runtime_form, body.revision);
  });
}
