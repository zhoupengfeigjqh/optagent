import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { PRODUCED_DIR } from '../domain/dirs.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { onSseDisconnect } from '../infra/sse.js';
import {
  PRODUCED_LIST_MAX,
  findProduced,
  listProduced,
  markProducedRead,
} from '../domain/produced.js';
import type { ProducedItem } from '../domain/produced.js';
import { ApiError } from '../server.js';

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { limit: { type: 'string', minLength: 1 } },
} as const;

/**
 * 一次可标记的 `job_id` 条数上限（契约 §10.5 ⑤）。
 *
 * 界面是**一次提交当前未读的全部**，量级本就很小；这里设上限只为挡住异常/恶意请求体
 * ——真正有界的是产出目录本身（30 天内的产出数）。
 */
const READ_BATCH_MAX = 200;

const readBodySchema = {
  type: 'object',
  required: ['job_ids'],
  additionalProperties: false,
  properties: {
    job_ids: {
      type: 'array',
      maxItems: READ_BATCH_MAX,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

const rawQuerySchema = {
  type: 'object',
  required: ['job_id'],
  additionalProperties: false,
  properties: { job_id: { type: 'string', minLength: 1 } },
} as const;

function accessFor(ctx: AppContext, userId: string, agentName: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    agentName,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
}

function withAgentNames(
  ctx: AppContext,
  userId: string,
  scopeAgentName: string,
  items: ProducedItem[],
): ProducedItem[] {
  const cache = new Map<string, string | undefined>();
  return items.map((item) => {
    const sid = item.sid;
    if (!sid) return item;
    if (!cache.has(sid)) {
      let name: string | undefined;
      try {
        name = ctx.threadStore.get(userId, scopeAgentName, sid).agentName;
      } catch {
        name = undefined;
      }
      cache.set(sid, name);
    }
    const agentName = cache.get(sid);
    return agentName ? { ...item, agent_name: agentName } : item;
  });
}

export function registerProducedRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/produced', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const raw = (req.query as { limit?: string }).limit;
    const requested = raw === undefined ? PRODUCED_LIST_MAX : Number(raw);
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : PRODUCED_LIST_MAX;
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再操作文件空间',
      route: 'GET /api/produced',
    });
    const items = await listProduced(accessFor(ctx, userId, agentName), limit);
    return { items: withAgentNames(ctx, userId, agentName, items) };
  });

  /**
   * §10.5 ⑤ 批量标记已读。
   *
   * 语义要点（均有契约依据）：**幂等**（已读的条目不动 `read_at`）、**不存在的 `job_id`
   * 忽略**（可能已被 30 天清理，不是调用方的错误）、返回**实际写入条数**。
   * 未读数不在这里算——界面从列表项自算（原则五：不落第二份可漂移的状态）。
   */
  app.get('/api/produced/raw', { schema: { querystring: rawQuerySchema } }, async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { job_id } = req.query as { job_id: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再操作文件空间',
      route: 'GET /api/produced/raw',
    });
    const access = accessFor(ctx, userId, agentName);
    const item = await findProduced(access, job_id);
    if (!item) {
      throw new ApiError(404, 'FILE_NOT_FOUND', `后台产出不存在或已被清理：${job_id}`);
    }
    if (!item.relPath.startsWith(`${PRODUCED_DIR}/`) || item.relPath.includes('..')) {
      throw new ApiError(404, 'FILE_NOT_FOUND', `后台产出不存在或已被清理：${job_id}`);
    }
    let buf: Buffer;
    try {
      buf = await access.readBuffer(item.relPath);
    } catch (err) {
      // `PermissionError` 即"文件不存在或不可读"（目录被清理）= 与查不到同一语义
      if (err instanceof PermissionError) {
        throw new ApiError(404, 'FILE_NOT_FOUND', `后台产出不存在或已被清理：${job_id}`);
      }
      throw err;
    }
    const maxBytes = ctx.config.previewMaxMb * 1024 * 1024;
    if (buf.length > maxBytes) {
      throw new ApiError(413, 'FILE_TOO_LARGE', `产出超过预览上限（${ctx.config.previewMaxMb}MB）`);
    }
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('x-content-type-options', 'nosniff')
      .send(buf.toString('utf8'));
  });

  app.post('/api/produced/read', { schema: { body: readBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { job_ids } = req.body as { job_ids: string[] };
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再操作文件空间',
      route: 'POST /api/produced/read',
    });
    const marked = await markProducedRead(accessFor(ctx, userId, agentName), job_ids);
    ctx.loggers.logger.info(
      { event: 'produced.read', user_id: userId, requested: job_ids.length, marked },
      `后台产出标记已读：${marked}/${job_ids.length}`,
    );
    return { marked };
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

    const push = (): void => {
      reply.raw.write('event: produced\ndata: \n\n');
    };
    push();
    const unsubscribe = ctx.producedEvents.onChanged((changedUserId) => {
      if (changedUserId === userId) push();
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    // 断连钩子必须挂响应：`req.raw` 的 close 在请求体读完时已触发过（见 infra/sse.ts）
    onSseDisconnect(reply.raw, () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
