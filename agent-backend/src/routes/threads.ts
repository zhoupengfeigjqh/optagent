import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { userAgentsDir } from '../domain/dirs.js';
import { defaultTitleOf, type ThreadSource } from '../domain/thread-store.js';
import type { ToolCallRecord } from '../domain/tool-events.js';
import { ApiError } from '../server.js';

const createBodySchema = {
  type: 'object',
  required: ['agent_name'],
  additionalProperties: false,
  properties: { agent_name: { type: 'string', minLength: 1 } },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { agent_name: { type: 'string' } },
} as const;

const detailQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
} as const;

const renameBodySchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: { title: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

function metaJson(m: {
  threadId: string;
  agentName: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  source?: ThreadSource;
}) {
  return {
    thread_id: m.threadId,
    agent_name: m.agentName,
    title: m.title,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    ...(m.source
      ? {
          source: {
            type: m.source.type,
            task_id: m.source.taskId,
            task_name: m.source.taskName,
            triggered_at: m.source.triggeredAt,
          },
        }
      : {}),
  };
}

function toolCallJson(r: ToolCallRecord) {
  return {
    call_id: r.callId,
    name: r.name,
    ...(r.label !== undefined ? { label: r.label } : {}),
    status: r.status,
    started_at: r.startedAt,
    ...(r.durationMs !== undefined ? { duration_ms: r.durationMs } : {}),
    ...(r.size !== undefined ? { size: r.size } : {}),
    ...(r.content !== undefined ? { content: r.content } : {}),
    ...(r.artifactSize !== undefined ? { artifact_size: r.artifactSize } : {}),
    ...(r.truncated === true ? { truncated: true } : {}),
    ...(r.summary !== undefined ? { summary: r.summary } : {}),
    ...(r.argsDigest !== undefined ? { args_digest: r.argsDigest } : {}),
    ...(r.viewLinks !== undefined && r.viewLinks.length > 0 ? { view_links: r.viewLinks } : {}),
  };
}

export function registerThreadRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/threads', { schema: { body: createBodySchema } }, async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { agent_name: bodyAgentName } = req.body as { agent_name: string };

    // 归属唯一来源＝服务端当前选中数字人（未选中 / 不可用一律 409）
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人再创建对话',
      route: 'POST /api/threads',
    });
    if (bodyAgentName !== agentName) {
      ctx.loggers.logger.warn(
        {
          event: 'thread.create.agent_mismatch',
          user_id: userId,
          body_agent: bodyAgentName,
          scope_agent: agentName,
        },
        `创建会话的数字人参数与服务端当前选中不一致，已按当前选中归属（body=${bodyAgentName} scope=${agentName}）`,
      );
      try {
        loadAgentConfig(path.join(userAgentsDir(ctx.config.optAgentRoot, userId), bodyAgentName));
      } catch (err) {
        if (err instanceof AgentConfigError)
          throw new ApiError(404, 'AGENT_NOT_FOUND', err.message);
        throw err;
      }
    }

    const meta = ctx.threadStore.create(userId, agentName);
    return reply
      .status(201)
      .send({ thread_id: meta.threadId, title: meta.title, created_at: meta.createdAt });
  });

  app.get('/api/threads', { schema: { querystring: listQuerySchema } }, async () => {
    const userId = getCurrentUser().userId;
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'GET /api/threads' });
    return ctx.threadStore.list(userId, agentName).map(metaJson);
  });

  app.get('/api/threads/:id', { schema: { querystring: detailQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { limit, offset } = req.query as { limit: number; offset: number };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'GET /api/threads/:id' });
    const meta = ctx.threadStore.get(userId, agentName, threadId);
    const snapshot = ctx.history.readSnapshot(userId, agentName, threadId);
    const all = snapshot.messages;
    const feedback = snapshot.feedback;
    const total = all.length;
    const end = Math.max(0, total - offset);
    const page = all.slice(Math.max(0, end - limit), end);
    const toolCallsByMessage = ctx.toolEvents.readByMessage(userId, agentName, threadId);
    const messages = page.map((m, i) => {
      const globalIndex = Math.max(0, end - limit) + i + 1;
      const id = m.id ?? `${threadId}-${globalIndex}`;
      const toolCalls = toolCallsByMessage.get(id) ?? [];
      return {
        id,
        role: m.role,
        content: m.content,
        ts: m.ts ?? meta.createdAt,
        ...(m.agent_name ? { agent_name: m.agent_name } : {}),
        ...(m.status ? { status: m.status } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.duration_ms !== undefined
          ? { duration_seconds: Math.round(m.duration_ms) / 1000 }
          : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
        ...(m.skill ? { skill: m.skill } : {}),
        ...(m.error ? { error: m.error } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls.map(toolCallJson) } : {}),
        feedback: feedback.get(id) ?? null,
      };
    });
    const title = meta.title ?? defaultTitleOf(all);
    return {
      ...metaJson({ ...meta, title }),
      total,
      messages,
      running: ctx.runManager.hasActive(threadId),
      pending_interaction: ctx.runManager.pendingInteractionOf(threadId),
    };
  });

  app.get('/api/threads/:id/next-actions', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      route: 'GET /api/threads/:id/next-actions',
    });
    ctx.threadStore.get(userId, agentName, threadId);
    reply.header('Cache-Control', 'no-store');
    return ctx.nextActions.read(userId, agentName, threadId) ?? { message_id: null, actions: [] };
  });

  app.patch('/api/threads/:id', { schema: { body: renameBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { title } = req.body as { title: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'PATCH /api/threads/:id' });
    const meta = ctx.threadStore.rename(userId, agentName, threadId, title);
    return { thread_id: meta.threadId, title: meta.title };
  });

  app.delete('/api/threads/:id', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'DELETE /api/threads/:id' });
    ctx.threadStore.get(userId, agentName, threadId);
    ctx.runManager.stop(threadId);
    // 5s 上界：删除接口不能被卡死的 run 挂住，超时记录后继续删。
    const idle = await ctx.runManager.awaitIdle(threadId, 5_000);
    if (!idle) {
      ctx.loggers.logger.warn(
        { event: 'thread.delete.timeout', thread_id: threadId, timeout_ms: 5_000 },
        '本轮未在 5s 内收尾，仍继续删除（可能残留孤儿目录）',
      );
    }
    await Promise.all([
      ctx.history.disposeThread(userId, agentName, threadId),
      ctx.summary.disposeThread(userId, agentName, threadId),
      ctx.toolEvents.disposeThread(userId, agentName, threadId),
    ]);
    ctx.nextActions.clear(userId, agentName, threadId);
    // （否则用户紧接着的"切换会话"请求会被一起拖慢，见 fs-safe 头部实测）
    await ctx.threadStore.delete(userId, agentName, threadId);
    return reply.status(204).send();
  });
}
