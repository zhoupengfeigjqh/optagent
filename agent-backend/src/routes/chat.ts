import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AgentConfigError } from '../domain/agent-instance.js';
import { PoolExhaustedError } from '../domain/agent-pool.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  DirValidationError,
  ScenarioNotConfiguredError,
  agentDir,
  parseSpaceDir,
  userDataDir,
} from '../domain/dirs.js';
import { listSkillNames } from '../domain/tools/skill-access.js';
import type { FocusToolTip } from '../domain/intent-focus/types.js';
import { MAX_TOOL_TIPS_PER_ACTION } from '../domain/next-actions.js';
import { MAX_ACTIVE_THREADS_PER_USER } from '../domain/run-limits.js';
import { ThreadRunActiveError, type Run } from '../domain/run-manager.js';
import { onSseDisconnect, openSseConnection } from '../infra/sse.js';
import { ApiError } from '../server.js';
import type { FileReference } from '../types.js';

const MAX_ATTACHMENTS = 10;

const MAX_CONTENT_CHARS = 32_000;

const messageBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS },
    thinking: { type: 'boolean' },
    model: { type: 'string', minLength: 1 },
    guidance: { type: 'string', maxLength: 500 },
    // 服务端据此不发起判定——放在请求体而不是"前端少发一次请求"，因为跳过必须是可校验的。
    skip_intent_focus: { type: 'boolean' },
    // 但服务端会过 `normalizeToolTips`（条数截断 + 字段兜底，2026-11-26）。
    tool_tips: {
      type: 'array',
      maxItems: MAX_TOOL_TIPS_PER_ACTION,
      items: { type: 'object' },
    },
    // 服务端保留解析以兼容旧客户端：收到时仍按"`content` 给模型、本字段落盘"处理。
    original_content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS },
    skill: { type: 'string', minLength: 1, maxLength: 64 },
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

/** 允许出现的请求体字段（与 `messageBodySchema.properties` 同源，避免两处清单漂移） */
const MESSAGE_BODY_KEYS = new Set(Object.keys(messageBodySchema.properties));

function assertStrictMessageBody(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const raw = body as Record<string, unknown>;

  const unknown = Object.keys(raw).filter((key) => !MESSAGE_BODY_KEYS.has(key));
  if (unknown.length > 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', `不支持的请求字段: ${unknown.join(', ')}`);
  }
  if (raw.skip_intent_focus !== undefined && typeof raw.skip_intent_focus !== 'boolean') {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      `skip_intent_focus 须为布尔值（当前：${JSON.stringify(raw.skip_intent_focus)}）`,
    );
  }
  if (raw.skill !== undefined && (typeof raw.skill !== 'string' || raw.skill.trim() === '')) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      `skill 须为非空技能名（当前：${JSON.stringify(raw.skill)}）`,
    );
  }
}

/**
 * 人工确认提交/拒绝（HITL）：action=submit 必须带 args（服务端按挂起时的
 * inputSchema 终验，失败不落定、可修正重提）；action=reject 忽略 args。
 */
const interactionBodySchema = {
  type: 'object',
  required: ['interaction_id', 'action'],
  additionalProperties: false,
  properties: {
    interaction_id: { type: 'string', minLength: 1 },
    action: { type: 'string', enum: ['submit', 'reject'] },
    args: { type: 'object' },
  },
} as const;

function validateAttachments(
  root: string,
  userId: string,
  agentName: string,
  attachments: FileReference[],
): void {
  for (const att of attachments) {
    let target;
    try {
      target = parseSpaceDir(root, userId, agentName, att.dir);
    } catch (err) {
      if (err instanceof DirValidationError) {
        throw new ApiError(
          err.statusCode,
          err.statusCode === 400 ? 'VALIDATION_FAILED' : 'UPLOAD_DIR_FORBIDDEN',
          err.message,
        );
      }
      if (err instanceof ScenarioNotConfiguredError) {
        throw new ApiError(503, 'SCENARIO_NOT_CONFIGURED', err.message);
      }
      throw err;
    }
    if (att.filename !== path.basename(att.filename) || att.filename.includes('..')) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${att.filename}`);
    }
    const abs = path.join(userDataDir(root, userId, agentName), target.relPath, att.filename);
    let isFile: boolean;
    try {
      isFile = fs.statSync(abs).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      throw new ApiError(400, 'FILE_REF_NOT_FOUND', `引用的文件不存在: ${att.dir}/${att.filename}`);
    }
  }
}

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/threads/:id/messages',
    {
      schema: { body: messageBodySchema },
      preValidation: async (req) => assertStrictMessageBody(req.body),
    },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { id: threadId } = req.params as { id: string };
      const body = req.body as {
        content: string;
        thinking?: boolean;
        model?: string;
        guidance?: string;
        attachments?: FileReference[];
        skip_intent_focus?: boolean;
        tool_tips?: FocusToolTip[];
        /** 018：术语替换前的原话（已停用，仅为旧客户端兼容；模型仍看 `content`） */
        original_content?: string;
        skill?: string;
      };

      // 归属唯一来源＝服务端当前选中数字人；不可用（已被移除/配置损坏）→ 409 AGENT_NOT_AVAILABLE
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人再发送消息',
        route: 'POST /api/threads/:id/messages',
      });
      // 失败即普通 JSON 错误、不开 SSE，也不占用并发额度。
      // 名称安全由"必须命中目录清单"天然覆盖（`../x`、含分隔符的串都不可能出现在清单里）。
      const skill = body.skill?.trim();
      if (body.skill !== undefined && skill !== undefined) {
        const available = listSkillNames(
          path.join(agentDir(ctx.config.optAgentRoot, userId, agentName), 'skills'),
        );
        if (!available.includes(skill)) {
          const hint =
            available.length > 0
              ? `；可用技能：${available.join('、')}`
              : '；该数字人当前没有配置任何技能';
          throw new ApiError(
            400,
            'VALIDATION_FAILED',
            `当前数字人没有名为「${skill}」的技能${hint}`,
          );
        }
      }

      // 会话不属于当前数字人 → 404（与"不存在"不可区分，FR-021）
      ctx.threadStore.get(userId, agentName, threadId);

      let model;
      if (body.model !== undefined) {
        model = ctx.config.models.find((m) => m.model === body.model);
        if (!model) {
          throw new ApiError(400, 'MODEL_NOT_FOUND', `模型不存在或不可用: ${body.model}`);
        }
      }

      if (body.attachments && body.attachments.length > 0) {
        validateAttachments(ctx.config.optAgentRoot, userId, agentName, body.attachments);
      }

      // 2026-11-26：判定前移到配额之前——否则关闭期每个请求仍要取实例、等一次 MCP 超时
      // （默认 10s）才返回 503，期间还白占一个并发名额。
      if (ctx.runManager.isDraining()) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', '服务正在关闭，请稍后重试');
      }

      // 并发上限（T026）：该用户活跃回复 ≥3 → 409 THREAD_BUSY_LIMIT（跨数字人累计；
      // 与下方 await 取实例之间没有被并发请求插队的窗口——占位已计入额度，
      // 后续请求不可能同时通过判定（原实现在此判定、到 startRun 才注册，存在 TOCTOU 超发）。
      const releaseQuota = ctx.runManager.acquireQuota(
        userId,
        threadId,
        MAX_ACTIVE_THREADS_PER_USER,
      );

      let agent;
      try {
        agent = await ctx.getOrCreateAgent({ userId, agentName });
      } catch (err) {
        releaseQuota(); // 未走到 startRun，额度必须归还，否则该用户永久少一个并发名额
        if (err instanceof PoolExhaustedError)
          throw new ApiError(409, 'POOL_EXHAUSTED', err.message);
        // 否则同一个故障会因时序不同返回 404 或 409（2026-11-26）
        if (err instanceof AgentConfigError)
          throw new ApiError(409, 'AGENT_NOT_AVAILABLE', err.message);
        throw err;
      }

      // MCP 就绪兜底（2026-10-18）：实例刚创建（新登录 / 切换 / 空闲回收后）时建连仍在
      // 超时即降级继续（原则九：有界等待 + 可观测），不阻断本轮回答。
      try {
        const ready = await agent.mcpReady(ctx.config.mcpConnectTimeoutMs);
        if (!ready) {
          ctx.loggers.logger.warn(
            {
              event: 'mcp.ready.timeout',
              user_id: userId,
              agent_name: agentName,
              thread_id: threadId,
              timeout_ms: ctx.config.mcpConnectTimeoutMs,
            },
            'MCP 建连未在超时内落定，本轮按现有可用工具开跑（降级）',
          );
        }
      } catch (err) {
        ctx.loggers.logger.warn(
          { err, event: 'mcp.ready.error', user_id: userId, agent_name: agentName },
          'MCP 就绪等待异常，本轮按现有可用工具开跑（降级）',
        );
      }

      // 否则用户已断流、界面已显示停止，后端仍会跑完并落一条谁也看不见的回答；
      if (ctx.runManager.takeCancel(threadId)) {
        releaseQuota();
        throw new ApiError(409, 'RUN_CANCELLED', '本轮已被停止');
      }

      let run: Run;
      try {
        run = ctx.runManager.startRun({
          userId,
          threadId,
          agent,
          userMessage: body.content,
          thinking: body.thinking ?? false,
          ...(body.attachments && body.attachments.length > 0
            ? { attachments: body.attachments }
            : {}),
          ...(model ? { model } : {}),
          ...(body.guidance ? { guidance: body.guidance } : {}),
          ...(body.skip_intent_focus === true ? { skipIntentFocus: true } : {}),
          ...(body.tool_tips && body.tool_tips.length > 0 ? { toolTips: body.tool_tips } : {}),
          ...(skill ? { skill } : {}),
          ...(body.original_content && body.original_content !== body.content
            ? { displayContent: body.original_content }
            : {}),
        });
      } catch (err) {
        releaseQuota();
        if (err instanceof ThreadRunActiveError)
          throw new ApiError(409, 'THREAD_RUN_ACTIVE', err.message);
        throw err;
      }

      agent.activeThreads++;
      void run.settled.then(() => {
        agent.activeThreads--;
        // 只刷新 updated_at：会话归属在创建时写定，MUST NOT 因轮次改变（FR-022）
        ctx.threadStore.touch(userId, agentName, threadId);
      });

      reply.hijack();
      try {
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          // 关掉 Nginx 的响应缓冲：否则注释帧/增量会被攒着不发，"流式"退化为一次性返回
          'x-accel-buffering': 'no',
        });
        // 首帧注释 + 15s 心跳（见 `infra/sse.ts`）：建连即写首个字节，避免本轮在
        const sse = openSseConnection(reply.raw);
        const unsubscribe = run.subscribe((e) => {
          sse.event(e.type, e.data);
          if (e.type === 'done' || e.type === 'error') sse.finish();
        });
        // 断连钩子必须挂响应：`req.raw` 的 close 在请求体读完时已触发过（见 sse.ts）
        onSseDisconnect(reply.raw, () => {
          sse.dispose();
          unsubscribe();
        });
      } catch (err) {
        // 避免"没人消费事件流"的 run 继续烧 token、占并发名额（2026-11-26）
        ctx.loggers.logger.error(
          { err, event: 'sse.attach.failed', thread_id: threadId },
          'SSE 建立失败，终止本轮',
        );
        run.stop();
        reply.raw.end();
      }
      return reply;
    },
  );

  app.post('/api/threads/:id/stop', async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'POST /api/threads/:id/stop' });
    ctx.threadStore.get(userId, agentName, threadId);
    return { stopped: ctx.runManager.stop(threadId) };
  });

  // 人工确认提交/拒绝（HITL）：幂等（重复提交返回首次结果）；
  app.post(
    '/api/threads/:id/interaction',
    { schema: { body: interactionBodySchema } },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { id: threadId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        route: 'POST /api/threads/:id/interaction',
      });
      ctx.threadStore.get(userId, agentName, threadId);
      const body = req.body as {
        interaction_id: string;
        action: 'submit' | 'reject';
        args?: Record<string, unknown>;
      };
      if (body.action === 'submit' && body.args === undefined) {
        throw new ApiError(400, 'VALIDATION_FAILED', '提交确认时必须提供 args');
      }
      const result = ctx.runManager.resolveInteraction(
        threadId,
        body.interaction_id,
        body.action,
        body.args,
      );
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') {
          throw new ApiError(404, 'INTERACTION_NOT_FOUND', result.message);
        }
        if (result.code === 'EXPIRED') {
          throw new ApiError(409, 'INTERACTION_EXPIRED', result.message);
        }
        throw new ApiError(400, 'SCHEMA_VALIDATION_FAILED', result.message);
      }
      return reply.status(202).send({ accepted: true, result: result.result });
    },
  );
}
