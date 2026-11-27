import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { ApiError } from '../server.js';
import type { FeedbackValue } from '../types.js';

const feedbackBodySchema = {
  type: 'object',
  required: ['value'],
  additionalProperties: false,
  properties: { value: { enum: ['up', 'down', null] } },
} as const;

export function registerFeedbackRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.put(
    '/api/threads/:id/messages/:mid/feedback',
    { schema: { body: feedbackBodySchema } },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { id: threadId, mid } = req.params as { id: string; mid: string };
      const { value } = req.body as { value: FeedbackValue };

      // 009：作用域＝当前选中数字人；会话不属于它 → 404（与"不存在"不可区分）
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再操作对话',
        route: 'PUT /api/threads/:id/messages/:mid/feedback',
      });
      const meta = ctx.threadStore.get(userId, agentName, threadId);
      const messages = ctx.history.readAll(userId, agentName, threadId);
      const exists = messages.some((m, i) => (m.id ?? `${threadId}-${i + 1}`) === mid);
      if (!exists) {
        throw new ApiError(404, 'MESSAGE_NOT_FOUND', `消息不存在: ${mid}（线程 ${meta.threadId}）`);
      }

      const current = ctx.history.readFeedback(userId, agentName, threadId).get(mid) ?? null;
      const next: FeedbackValue = value === current ? null : value;
      await ctx.history.appendFeedback(userId, agentName, threadId, mid, next);
      return { message_id: mid, feedback: next };
    },
  );
}
