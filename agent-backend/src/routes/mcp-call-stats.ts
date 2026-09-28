/**
 * MCP 调用统计端点（`plan.md` R4，`contracts/runtime-api-delta.md` §4）。
 *
 * `GET /api/mcp-call-stats` —— 向管理平台提供 MCP 工具调用统计：
 * - `items`：服务级汇总（平台卡片）；
 * - `groups`：按「**服务 × 工具 × 用户**」分组的行，含四个时间窗（平台统计表，2026-09-23）。
 *
 * 口径为 **MCP 工具调用次数**（非 HTTP 请求数），详见 `UsageDb.recordMcpCall`。
 * **只读端点**，无副作用、无请求体、无鉴权（沿用运行环境既有口径）。
 * 未出现过的服务**不出现在 `items` 中**（平台侧以 0 呈现）。
 */
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
