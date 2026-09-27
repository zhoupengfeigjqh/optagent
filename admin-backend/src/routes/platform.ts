/**
 * 平台健康检查路由（`contracts/admin-api.md` §1.1）。
 *
 * **2026-09-27 改版（全人工配置）**：MCP 服务不再取自容器编排声明、平台不再读
 * Docker 容器状态，因此：
 * - 移除 `runtime_form` / `compose_file` / `docker` 三个字段（前提概念已下架）；
 * - **移除** §1.2 读取设置、§1.3 运行形态列表、§1.4 切换运行形态——
 *   平台不再有"目标运行形态"这一等概念。
 *
 * 保留下来的只有**外部依赖可达性的只读体检**：平台设计态与运行环境用户数据根。
 */
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
