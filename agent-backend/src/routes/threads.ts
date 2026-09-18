/**
 * 对话管理路由（T034 / FR-010）：
 * - POST /api/threads：创建（未选中 → 409 AGENT_NOT_SELECTED、AGENT_NOT_FOUND；**不限制会话总数**，
 *   上限只作用于"进行中"的会话，见 chat.ts 的 THREAD_BUSY_LIMIT）。
 *   传入的 `agent_name` 仅作为**起始数字人标签**——会话不绑定数字人（FR-014 修订）
 * - GET /api/threads：列表（agent_name 过滤、updated_at 倒序、默认标题）
 * - GET /api/threads/:id：详情 + 历史分页（limit≤200 默认 50、offset 从最新往前数、total、running）
 * - PATCH /api/threads/:id：重命名（≤100 字）
 * - DELETE /api/threads/:id：删除连带清理（进行中 run 先 abort）
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { getCurrentUser } from '../domain/current-user.js';
import { userAgentsDir } from '../domain/dirs.js';
import { defaultTitleOf } from '../domain/thread-store.js';
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

function metaJson(m: { threadId: string; agentName: string; title: string | null; createdAt: string; updatedAt: string }) {
  return {
    thread_id: m.threadId,
    agent_name: m.agentName,
    title: m.title,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

export function registerThreadRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/threads', { schema: { body: createBodySchema } }, async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { agent_name: agentName } = req.body as { agent_name: string };

    // 未选中数字人 → 拒绝（会话需要一个起始数字人；之后可在会话内切换，FR-014 修订）
    if (!ctx.currentAgent.current(userId)) {
      throw new ApiError(409, 'AGENT_NOT_SELECTED', '请先选定数字人再创建对话');
    }

    // 数字人配置必须可加载（损坏的数字人不允许开对话）
    try {
      loadAgentConfig(path.join(userAgentsDir(ctx.config.optAgentRoot, userId), agentName));
    } catch (err) {
      if (err instanceof AgentConfigError) throw new ApiError(404, 'AGENT_NOT_FOUND', err.message);
      throw err;
    }

    const meta = ctx.threadStore.create(userId, agentName);
    return reply.status(201).send({ thread_id: meta.threadId, title: meta.title, created_at: meta.createdAt });
  });

  app.get('/api/threads', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { agent_name: agentName } = req.query as { agent_name?: string };
    return ctx.threadStore.list(userId, agentName).map(metaJson);
  });

  app.get('/api/threads/:id', { schema: { querystring: detailQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { limit, offset } = req.query as { limit: number; offset: number };
    const meta = ctx.threadStore.get(userId, threadId); // 404
    // 一次读盘取回消息 + 反馈（原先 readAll + readFeedback 会把同一文件解析两遍）
    const snapshot = ctx.history.readSnapshot(userId, threadId);
    const all = snapshot.messages;
    const feedback = snapshot.feedback;
    const total = all.length;
    // offset 从最新往前数；返回按时间正序
    const end = Math.max(0, total - offset);
    const page = all.slice(Math.max(0, end - limit), end);
    // 契约升级（002 US2/US3）：消息带元数据与反馈状态；
    // 旧格式行合成稳定 id（{threadId}-{全局序号}）、ts 回填线程创建时间
    const messages = page.map((m, i) => {
      const globalIndex = Math.max(0, end - limit) + i + 1;
      const id = m.id ?? `${threadId}-${globalIndex}`;
      return {
        id,
        role: m.role,
        content: m.content,
        ts: m.ts ?? meta.createdAt,
        // 会话可跨数字人：每条消息带上当轮数字人（旧数据缺省）
        ...(m.agent_name ? { agent_name: m.agent_name } : {}),
        ...(m.status ? { status: m.status } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.duration_ms !== undefined ? { duration_seconds: Math.round(m.duration_ms) / 1000 } : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
        ...(m.error ? { error: m.error } : {}),
        feedback: feedback.get(id) ?? null,
      };
    });
    // 空 title 回落默认标题（与列表一致）；复用上面已读到的消息，不再重复读盘
    const title = meta.title ?? defaultTitleOf(all);
    return {
      ...metaJson({ ...meta, title }),
      total,
      messages,
      running: ctx.runManager.hasActive(threadId),
      // HITL 断连恢复：若当前有等待用户确认的工具调用，附快照让前端重建弹窗
      pending_interaction: ctx.runManager.pendingInteractionOf(threadId),
    };
  });

  app.patch('/api/threads/:id', { schema: { body: renameBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { title } = req.body as { title: string };
    const meta = ctx.threadStore.rename(userId, threadId, title); // 404
    return { thread_id: meta.threadId, title: meta.title };
  });

  app.delete('/api/threads/:id', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    ctx.threadStore.get(userId, threadId); // 404
    // 有进行中 run 先 abort（契约：丢弃本轮但记 usage）
    ctx.runManager.stop(threadId);
    ctx.threadStore.delete(userId, threadId);
    return reply.status(204).send();
  });
}
