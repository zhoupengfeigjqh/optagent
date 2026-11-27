import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerMcpCallStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/mcp-call-stats', async () => {
    try {
      const stats = ctx.usage.mcpCallStats();
      return { stats_available: true, items: stats.items, groups: stats.groups };
    } catch {
      // 统计存储不可读：明确标注为"不可用"，让平台显示"未知"而不是 0
      return { stats_available: false, items: [], groups: [] };
    }
  });
}
