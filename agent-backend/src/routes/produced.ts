/**
 * 后台产出路由（R11，契约 §10.5）：
 * - `GET /api/produced?limit=50`：产出列表（有界返回，按完成时间倒序）
 * - `GET /api/produced/events`：SSE 信号（事件名 `produced`，**负载为空**；建连即推一次
 *   → 之后按 userId 过滤推送 → 25s 心跳）
 *
 * 信号语义：只表示"产出**可能**已变"，前端收到后重新拉列表；
 * 因此信号丢失无后果（产出物本身是文件，可从目录重算）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import { FileAccess } from '../domain/file-access.js';
import { PRODUCED_LIST_MAX, listProduced } from '../domain/produced.js';

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { limit: { type: 'string', minLength: 1 } },
} as const;

function accessFor(ctx: AppContext, userId: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
}

export function registerProducedRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/produced', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const raw = (req.query as { limit?: string }).limit;
    const requested = raw === undefined ? PRODUCED_LIST_MAX : Number(raw);
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : PRODUCED_LIST_MAX;
    const items = await listProduced(accessFor(ctx, userId), limit);
    return { items };
  });

  app.get('/api/produced/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    // 建连即推一次（与 MCP 状态推送同一形态）：客户端不必自己判断"是不是还没变化"
    const push = (): void => {
      reply.raw.write('event: produced\ndata: \n\n');
    };
    push();
    const unsubscribe = ctx.producedEvents.onChanged((changedUserId) => {
      if (changedUserId === userId) push();
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
