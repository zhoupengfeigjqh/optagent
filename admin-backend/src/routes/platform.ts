import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { probePath } from '../infra/fs-probe.js';

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * 健康检查（`quickstart.md` §6 的冒烟确认入口）。
   * **不返回错误码**：依赖不可达以字段表达，便于一次性看到全部问题。
   */
  app.get('/api/admin/platform/health', async () => {
    const platformData = probePath(ctx.config.platformDataDir);
    const optAgent = probePath(ctx.config.optAgentRoot);

    return {
      platform_data: { writable: platformData.writable, path: ctx.config.platformDataDir },
      opt_agent: {
        readable: optAgent.readable,
        writable: optAgent.writable,
        path: ctx.config.optAgentRoot,
      },
    };
  });
}
