import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { probePath } from '../infra/fs-probe.js';
import { probeMysql } from '../infra/mysql.js';

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * 健康检查（`quickstart.md` §4 的冒烟确认入口）。
   * **不返回错误码**：依赖不可达以字段表达，便于一次性看到全部问题。
   *
   * 029 D-4：仅 `STORAGE_DRIVER=mysql` 时多一个 `database` 字段
   * （`{ reachable, host, database, error }`）；库不可达不影响 HTTP 200。
   */
  app.get('/api/admin/platform/health', async () => {
    const platformData = probePath(ctx.config.platformDataDir);
    const optAgent = probePath(ctx.config.optAgentRoot);

    const body: Record<string, unknown> = {
      platform_data: { writable: platformData.writable, path: ctx.config.platformDataDir },
      opt_agent: {
        readable: optAgent.readable,
        writable: optAgent.writable,
        path: ctx.config.optAgentRoot,
      },
    };
    if (ctx.config.mysql) {
      body.database = await probeMysql(ctx.config.mysql);
    }
    return body;
  });
}
