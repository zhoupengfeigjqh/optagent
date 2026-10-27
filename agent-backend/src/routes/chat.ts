/**
 * 对话路由（T024/T025/T026 + 002 特性）：
 * - POST /api/threads/:id/messages — SSE（订阅 run 事件流；断连仅退订）
 *   body 扩展：model（请求级模型，非法 → 400 MODEL_NOT_FOUND）、
 *   attachments（@ 文件引用 ≤10，目录白名单 + 存在性校验 → 400 FILE_REF_NOT_FOUND）
 * - POST /api/threads/:id/stop — 幂等中断
 *
 * 409 判定链（009）：AGENT_NOT_SELECTED → AGENT_NOT_AVAILABLE → THREAD_NOT_FOUND（404，
 * 会话不属于当前数字人时与"不存在"不可区分）→ THREAD_BUSY_LIMIT
 * （并发上限，唯一的会话数量约束）→ POOL_EXHAUSTED → THREAD_RUN_ACTIVE。
 * THREAD_BUSY_LIMIT 由 runManager.acquireQuota 同步「检查+占位」完成：
 * 判定与 run 注册之间不再有 await 窗口，同一用户的并发请求无法同时通过。
 *
 * **数字人归属（009，取代 002 的"会话可跨数字人"口径）**：会话归属在创建时写定
 * （＝其所在目录，FR-022），生命周期内**不可变更**；本轮由「当前选中数字人」执行，
 * 若该数字人已不可用 → `409 AGENT_NOT_AVAILABLE`（陈旧上下文 MUST 失败且可读，
 * MUST NOT 静默改由其他数字人回答，FR-032）。
 */
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
  parseSpaceDir,
  userDataDir,
} from '../domain/dirs.js';
import { ThreadRunActiveError, type Run } from '../domain/run-manager.js';
import { ApiError } from '../server.js';
import type { FileReference } from '../types.js';

const MAX_ACTIVE_THREADS_PER_USER = 3;
const MAX_ATTACHMENTS = 10;

const messageBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    model: { type: 'string', minLength: 1 },
    // 004：问题实例关联工具生成的隐藏引导。只追加到本轮系统提示词，
    // 不落盘、不进历史 —— 用户气泡里看不到它。
    guidance: { type: 'string', maxLength: 500 },
    // 013：本轮跳过意图聚焦（预置动作入口：下一步动作卡片 / 首屏问题实例卡片）。
    // 服务端据此不发起判定——放在请求体而不是"前端少发一次请求"，因为跳过必须是可校验的。
    skip_intent_focus: { type: 'boolean' },
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

/**
 * 013：请求体的**严格校验**（`preValidation`，此时 body 刚解析、schema 尚未改写它）。
 *
 * 为什么不能只靠 Fastify 的 JSON Schema：默认 ajv 配置是
 * `coerceTypes: true` + `removeAdditional: true`——`"true"` 会被悄悄转成 `true`，
 * 拼错的字段（`skipIntentFocus`）会被静默丢掉。对"跳过意图聚焦"这种
 * **服务端可校验标记**来说，这两种静默都不可接受：错配只会表现为
 * "该跳过的没跳过 / 不该跳过的跳过了"，没有任何报错可循。
 *
 * 作用域仅限本路由（不全局改 ajv 选项，避免影响其余端点）。
 */
function assertStrictMessageBody(body: unknown): void {
  // 非对象交给 schema 报"类型不符"，这里不重复造错
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

/**
 * 校验 @ 引用：空间目录校验（数据准备须命中**本轮数字人**的 scenario 清单）+ 文件存在性。
 * 场景随数字人存放，故同一引用在不同数字人下可能合法/非法——按本轮数字人判定。
 */
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
    if (!fs.existsSync(abs)) {
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
      };

      // 归属唯一来源＝服务端当前选中数字人；不可用（已被移除/配置损坏）→ 409 AGENT_NOT_AVAILABLE
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人再发送消息',
        route: 'POST /api/threads/:id/messages',
      });
      // 会话不属于当前数字人 → 404（与"不存在"不可区分，FR-021）
      ctx.threadStore.get(userId, agentName, threadId); // ThreadNotFoundError → 404（全局映射）

      // 请求级模型解析（FR-023/024）：未指定 → 默认模型
      let model;
      if (body.model !== undefined) {
        model = ctx.config.models.find((m) => m.model === body.model);
        if (!model) {
          throw new ApiError(400, 'MODEL_NOT_FOUND', `模型不存在或不可用: ${body.model}`);
        }
      }

      // @ 文件引用校验（FR-028/029）：按本轮数字人的场景清单判定
      if (body.attachments && body.attachments.length > 0) {
        validateAttachments(ctx.config.optAgentRoot, userId, agentName, body.attachments);
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
        agent = await ctx.getOrCreateAgent({ userId, agentName });
      } catch (err) {
        releaseQuota(); // 未走到 startRun，额度必须归还，否则该用户永久少一个并发名额
        if (err instanceof PoolExhaustedError)
          throw new ApiError(409, 'POOL_EXHAUSTED', err.message);
        if (err instanceof AgentConfigError)
          throw new ApiError(404, 'AGENT_NOT_FOUND', err.message);
        throw err;
      }

      // MCP 就绪兜底（2026-10-18）：实例刚创建（新登录 / 切换 / 空闲回收后）时建连仍在
      // 飞行中，而本轮工具装配按 `isAvailable` 过滤 —— 不等待就会**静默缺少 MCP 工具**，
      // 状态却在随后变绿。已落定（常态）立即返回，不影响稳态首字延迟。
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
          // 004：问题实例的隐藏工具引导（只影响本轮系统提示词，不落盘）
          ...(body.guidance ? { guidance: body.guidance } : {}),
          // 013：预置动作入口跳过意图聚焦（只影响本轮判定，不落历史、不改 SSE 序列）
          ...(body.skip_intent_focus === true ? { skipIntentFocus: true } : {}),
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
    },
  );

  app.post('/api/threads/:id/stop', async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'POST /api/threads/:id/stop' });
    ctx.threadStore.get(userId, agentName, threadId); // 404 校验
    return { stopped: ctx.runManager.stop(threadId) };
  });

  // 人工确认提交/拒绝（HITL）：幂等（重复提交返回首次结果）；
  // submit 的服务端终验失败返回 400 + 逐字段错误，interaction 保持挂起可重提
  app.post(
    '/api/threads/:id/interaction',
    { schema: { body: interactionBodySchema } },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { id: threadId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        route: 'POST /api/threads/:id/interaction',
      });
      ctx.threadStore.get(userId, agentName, threadId); // 404 校验
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
