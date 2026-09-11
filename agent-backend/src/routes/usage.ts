/**
 * Token 用量查询路由（US5 / T048）。
 *
 * GET /api/usage/summary?thread_id&agent_name&from&to（from/to 为 ISO8601）
 * 响应为契约的 snake_case：total + grouped（thread+agent 聚合）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';

interface UsageQuery {
  thread_id?: string;
  agent_name?: string;
  from?: string;
  to?: string;
}

export function registerUsageRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/usage/summary', async (req) => {
    const q = req.query as UsageQuery;
    const summary = ctx.usage.summary({
      userId: getCurrentUser().userId,
      ...(q.thread_id ? { threadId: q.thread_id } : {}),
      ...(q.agent_name ? { agentName: q.agent_name } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
    return {
      total_input_tokens: summary.total.inputTokens,
      total_output_tokens: summary.total.outputTokens,
      records: summary.total.count,
      grouped: summary.grouped.map((g) => ({
        thread_id: g.threadId,
        agent_name: g.agentName,
        input_tokens: g.inputTokens,
        output_tokens: g.outputTokens,
        records: g.count,
      })),
    };
  });
}
