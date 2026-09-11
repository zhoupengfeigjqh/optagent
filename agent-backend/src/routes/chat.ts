/**
 * 对话路由（T024/T025/T026 + 002 特性）：
 * - POST /api/threads/:id/messages — SSE（订阅 run 事件流；断连仅退订）
 *   body 扩展：model（请求级模型，非法 → 400 MODEL_NOT_FOUND）、
 *   attachments（@ 文件引用 ≤10，目录白名单 + 存在性校验 → 400 FILE_REF_NOT_FOUND）
 * - POST /api/threads/:id/stop — 幂等中断
 *
 * 409 判定链：AGENT_NOT_SELECTED → THREAD_BUSY_LIMIT
 * （并发上限，唯一的会话数量约束）→ POOL_EXHAUSTED → THREAD_RUN_ACTIVE。
 * THREAD_BUSY_LIMIT 由 runManager.acquireQuota 同步「检查+占位」完成：
 * 判定与 run 注册之间不再有 await 窗口，同一用户的并发请求无法同时通过。
 *
 * 数字人归属（FR-014 修订）：会话**不绑定**数字人，本轮由「当前选中数字人」执行；
 * 用户可在同一会话内切换数字人，切换在下一轮消息生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AgentConfigError } from '../domain/agent-instance.js';
import { PoolExhaustedError } from '../domain/agent-pool.js';
import { getCurrentUser } from '../domain/current-user.js';
import { BUSINESS_DIRS, SHARED_DIR, TMP_DIR, userDataDir } from '../domain/dirs.js';
import { ThreadRunActiveError, type Run } from '../domain/run-manager.js';
import { ApiError } from '../server.js';
import type { FileReference } from '../types.js';

const MAX_ACTIVE_THREADS_PER_USER = 3;
const MAX_ATTACHMENTS = 10;
/** @ 引用可选目录（与文件列表/预览一致：7 业务 + shared + tmp） */
const ATTACHMENT_DIRS: readonly string[] = [...BUSINESS_DIRS, SHARED_DIR, TMP_DIR];

const messageBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    model: { type: 'string', minLength: 1 },
    attachments: {
      type: 'array',
      maxItems: MAX_ATTACHMENTS,
      items: {
        type: 'object',
        required: ['dir', 'filename'],
        additionalProperties: false,
        properties: {
          dir: { type: 'string', minLength: 1 },
          filename: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

/** 校验 @ 引用：目录白名单 + 路径穿越 + 文件存在性 */
function validateAttachments(root: string, userId: string, attachments: FileReference[]): void {
  for (const att of attachments) {
    if (att.dir.includes('..') || path.isAbsolute(att.dir) || /[/\\]/.test(att.dir)) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法目录参数: ${att.dir}`);
    }
    if (!ATTACHMENT_DIRS.includes(att.dir)) {
      throw new ApiError(403, 'UPLOAD_DIR_FORBIDDEN', `目录 ${att.dir} 不开放，允许：${ATTACHMENT_DIRS.join('、')}`);
    }
    if (att.filename !== path.basename(att.filename) || att.filename.includes('..')) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${att.filename}`);
    }
    const abs = path.join(userDataDir(root, userId), att.dir, att.filename);
    if (!fs.existsSync(abs)) {
      throw new ApiError(400, 'FILE_REF_NOT_FOUND', `引用的文件不存在: ${att.dir}/${att.filename}`);
    }
  }
}

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/threads/:id/messages', { schema: { body: messageBodySchema } }, async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const body = req.body as {
      content: string;
      thinking?: boolean;
      model?: string;
      attachments?: FileReference[];
    };

    ctx.threadStore.get(userId, threadId); // ThreadNotFoundError → 404（全局映射）

    // 本轮数字人 = 当前选中数字人（会话不绑定数字人，可在会话内切换）
    const selected = ctx.currentAgent.current(userId);
    if (!selected) throw new ApiError(409, 'AGENT_NOT_SELECTED', '请先选定数字人再发送消息');

    // 请求级模型解析（FR-023/024）：未指定 → 默认模型
    let model;
    if (body.model !== undefined) {
      model = ctx.config.models.find((m) => m.model === body.model);
      if (!model) {
        throw new ApiError(400, 'MODEL_NOT_FOUND', `模型不存在或不可用: ${body.model}`);
      }
    }

    // @ 文件引用校验（FR-028/029）
    if (body.attachments && body.attachments.length > 0) {
      validateAttachments(ctx.config.optAgentRoot, userId, body.attachments);
    }

    // 并发上限（T026）：该用户活跃回复 ≥3 → 409 THREAD_BUSY_LIMIT（跨数字人累计；
    // 创建接口不限制会话总数）。acquireQuota **同步**完成「检查 + 占位」，
    // 与下方 await 取实例之间没有被并发请求插队的窗口——占位已计入额度，
    // 后续请求不可能同时通过判定（原实现在此判定、到 startRun 才注册，存在 TOCTOU 超发）。
    const releaseQuota = ctx.runManager.acquireQuota(
      userId,
      threadId,
      MAX_ACTIVE_THREADS_PER_USER,
    );

    let agent;
    try {
      agent = await ctx.getOrCreateAgent({ userId, agentName: selected.agentName });
    } catch (err) {
      releaseQuota(); // 未走到 startRun，额度必须归还，否则该用户永久少一个并发名额
      if (err instanceof PoolExhaustedError) throw new ApiError(409, 'POOL_EXHAUSTED', err.message);
      if (err instanceof AgentConfigError) throw new ApiError(404, 'AGENT_NOT_FOUND', err.message);
      throw err;
    }

    let run: Run;
    try {
      run = ctx.runManager.startRun({
        userId,
        threadId,
        agent,
        userMessage: body.content,
        thinking: body.thinking ?? false,
        ...(body.attachments && body.attachments.length > 0 ? { attachments: body.attachments } : {}),
        ...(model ? { model } : {}),
      });
    } catch (err) {
      releaseQuota();
      if (err instanceof ThreadRunActiveError) throw new ApiError(409, 'THREAD_RUN_ACTIVE', err.message);
      throw err;
    }

    agent.activeThreads++;
    void run.settled.then(() => {
      agent.activeThreads--;
      // 会话的 agent_name 记录**最近一轮**使用的数字人（会话可跨数字人）
      ctx.threadStore.touch(userId, threadId, selected.agentName);
    });

    // SSE：订阅 run 事件流；客户端断开仅退订（FR-026）
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const unsubscribe = run.subscribe((e) => {
      reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
      if (e.type === 'done' || e.type === 'error') reply.raw.end();
    });
    reply.raw.on('close', unsubscribe);
    return reply;
  });

  app.post('/api/threads/:id/stop', async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    ctx.threadStore.get(userId, threadId); // 404 校验
    return { stopped: ctx.runManager.stop(threadId) };
  });
}
