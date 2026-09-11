/**
 * 消息反馈路由（002 US3 / FR-013~017）：
 * - PUT /api/threads/:id/messages/:mid/feedback — 提交/切换/取消点赞点踩
 *   value 枚举 up/down/null；同值重复提交 = 取消（置 null）；互斥由单值覆盖保证
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
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
  app.put('/api/threads/:id/messages/:mid/feedback', { schema: { body: feedbackBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId, mid } = req.params as { id: string; mid: string };
    const { value } = req.body as { value: FeedbackValue };

    const meta = ctx.threadStore.get(userId, threadId); // ThreadNotFoundError → 404
    const messages = ctx.history.readAll(userId, threadId);
    // 新行带 id；旧行 id 合成规则与 GET /api/threads/:id 一致（{threadId}-{全局序号}）
    const exists = messages.some((m, i) => (m.id ?? `${threadId}-${i + 1}`) === mid);
    if (!exists) {
      throw new ApiError(404, 'MESSAGE_NOT_FOUND', `消息不存在: ${mid}（线程 ${meta.threadId}）`);
    }

    const current = ctx.history.readFeedback(userId, threadId).get(mid) ?? null;
    // 同值重复提交 = 取消
    const next: FeedbackValue = value === current ? null : value;
    await ctx.history.appendFeedback(userId, threadId, mid, next);
    return { message_id: mid, feedback: next };
  });
}
