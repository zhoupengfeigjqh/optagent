/**
 * 对话管理路由（T034 / FR-010）：
 * - POST /api/threads：创建（未选中 → 409 AGENT_NOT_SELECTED；当前数字人不可用 → 409
 *   AGENT_NOT_AVAILABLE；**不限制会话总数**，上限只作用于"进行中"的会话，见 chat.ts 的
 *   THREAD_BUSY_LIMIT）。body 的 `agent_name` **保留但不再决定归属**（009）：
 *   归属一律取服务端当前选中的数字人，两者不一致时落 `warn` 并以服务端为准
 * - GET /api/threads：列表（**只含当前数字人**、updated_at 倒序、默认标题；查询参数
 *   `agent_name` 保留但不再参与作用域，传了忽略）
 * - GET /api/threads/:id：详情 + 历史分页（limit≤200 默认 50、offset 从最新往前数、total、running）
 *   每条消息可附 `tool_calls`（002 特性：工具调用记录，元数据 + 内联小结果）
 * - GET /api/threads/:id/tool-calls/:call_id：外置结果正文（懒加载；过期 → 410）
 * - GET /api/threads/:id/next-actions：该会话最新一轮的「下一步动作提示」（007；四类空态一律 200 空）
 * - PATCH /api/threads/:id：重命名（≤100 字）
 * - DELETE /api/threads/:id：删除连带清理（进行中 run 先 abort）
 *
 * **009 归属口径**：会话归属＝**目录位置**（`user-data/{数字人}/threads/{id}`），
 * 作用域一律来自 `resolveAgentScope`（唯一判定入口）。跨数字人请求在路径层解析不到 →
 * 一律 `404 THREAD_NOT_FOUND`（与"不存在"不可区分，FR-021），MUST NOT 出现"存在但无权限"。
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { userAgentsDir } from '../domain/dirs.js';
import { defaultTitleOf } from '../domain/thread-store.js';
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
}) {
  return {
    thread_id: m.threadId,
    agent_name: m.agentName,
    title: m.title,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

/**
 * 工具调用记录 → HTTP 契约。
 *
 * `content` = 内联结果正文（小结果，随详情一起下发）；
 * `artifact_size` 有值 = 正文在临时空间，前端按需拉 `…/tool-calls/{call_id}`。
 * **不下发路径**：路径由后端按 `{threadId, callId}` 重算，避免数据被篡改成越权读。
 * `view_links` = 结果里的视图链接（地址 + 可选名称）：正文外置时它仍在详情里，
 * 因此前端不必先加载正文就能给出入口（见 `view-links.ts`）。
 */
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
    // 视图链接（2026-10-10）：只搬服务给的原值，不拼前缀、不归一化（那是前端的唯一职责）
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
      // 契约：字段保留但不再决定归属；不一致**不静默**（原则九），落 warn 并以服务端为准
      ctx.loggers.logger.warn(
        {
          event: 'thread.create.agent_mismatch',
          user_id: userId,
          body_agent: bodyAgentName,
          scope_agent: agentName,
        },
        `创建会话的数字人参数与服务端当前选中不一致，已按当前选中归属（body=${bodyAgentName} scope=${agentName}）`,
      );
      // 既有口径保留：body 指定的数字人配置损坏时仍是 404 AGENT_NOT_FOUND（不静默放过）
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
    // 查询参数 `agent_name` **退出作用域**（契约 §2）：作用域恒为当前选中数字人，
    // 传了就忽略（Schema 保留该字段，免得既有的显式传参变成 400）
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'GET /api/threads' });
    return ctx.threadStore.list(userId, agentName).map(metaJson);
  });

  app.get('/api/threads/:id', { schema: { querystring: detailQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { limit, offset } = req.query as { limit: number; offset: number };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'GET /api/threads/:id' });
    const meta = ctx.threadStore.get(userId, agentName, threadId); // 不属于本数字人 → 404
    // 一次读盘取回消息 + 反馈（原先 readAll + readFeedback 会把同一文件解析两遍）
    const snapshot = ctx.history.readSnapshot(userId, agentName, threadId);
    const all = snapshot.messages;
    const feedback = snapshot.feedback;
    const total = all.length;
    // offset 从最新往前数；返回按时间正序
    const end = Math.max(0, total - offset);
    const page = all.slice(Math.max(0, end - limit), end);
    // 002 特性：工具调用记录按归属消息分组（无记录的会话为空 Map，只多一次 existsSync）
    const toolCallsByMessage = ctx.toolEvents.readByMessage(userId, agentName, threadId);
    // 契约升级（002 US2/US3）：消息带元数据与反馈状态；
    // 旧格式行合成稳定 id（{threadId}-{全局序号}）、ts 回填线程创建时间
    const messages = page.map((m, i) => {
      const globalIndex = Math.max(0, end - limit) + i + 1;
      const id = m.id ?? `${threadId}-${globalIndex}`;
      const toolCalls = toolCallsByMessage.get(id) ?? [];
      return {
        id,
        role: m.role,
        content: m.content,
        ts: m.ts ?? meta.createdAt,
        // 每条消息记该轮**实际执行**的数字人（009 下恒等于会话归属；旧数据缺省）
        ...(m.agent_name ? { agent_name: m.agent_name } : {}),
        ...(m.status ? { status: m.status } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.duration_ms !== undefined
          ? { duration_seconds: Math.round(m.duration_ms) / 1000 }
          : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
        ...(m.error ? { error: m.error } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls.map(toolCallJson) } : {}),
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

  /**
   * 外置工具结果正文（懒加载）：前端点开卡片才请求。
   *
   * - 记录不存在 / 该调用结果未外置（已随详情内联下发）→ 404
   * - 外置文件已被临时空间清理或用户删除 → **410**（前端降级为"内容已过期"，
   *   卡片元数据仍在，不视为错误）
   */
  app.get('/api/threads/:id/tool-calls/:callId', async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId, callId } = req.params as { id: string; callId: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      route: 'GET /api/threads/:id/tool-calls',
    });
    ctx.threadStore.get(userId, agentName, threadId); // 404
    const record = ctx.toolEvents
      .readAll(userId, agentName, threadId)
      .find((r) => r.callId === callId);
    if (!record || record.artifactSize === undefined) {
      throw new ApiError(404, 'TOOL_CALL_NOT_FOUND', `工具调用结果不存在或未外置: ${callId}`);
    }
    const artifact = await ctx.toolEvents.readArtifact(userId, agentName, threadId, callId);
    if (!artifact) {
      throw new ApiError(410, 'TOOL_RESULT_EXPIRED', '工具结果内容已被临时空间清理');
    }
    return {
      call_id: record.callId,
      name: record.name,
      status: record.status,
      size: artifact.size,
      content: artifact.content,
      ...(record.truncated === true ? { truncated: true } : {}),
    };
  });

  /**
   * 007：读取该会话最新一轮的「下一步动作提示」（会话级单快照，见契约 §1）。
   *
   * 三条刻意的取舍：
   * - **会话归属校验前置**：他人会话一律 404 `THREAD_NOT_FOUND`（与详情接口同码），
   *   不让"这个 id 有没有快照"泄漏出去；
   * - **空态一律 200 + 空**（`{message_id: null, actions: []}`）：对前端而言"没有建议"
   *   是正常态而非错误态（FR-042），快照损坏/开关关闭/数字人不一致都不该变成 5xx；
   * - **判据全部在 `nextActions.read` 内收敛**：那里是唯一同时掌握"快照归属数字人"
   *   与"当前选中数字人"的地方（跨数字人越权的唯一兜底点，FR-019/SC-011）。
   *
   * `Cache-Control: no-store`：内容随轮次与开关变化，缓存住会给出过期卡片。
   */
  app.get('/api/threads/:id/next-actions', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      route: 'GET /api/threads/:id/next-actions',
    });
    ctx.threadStore.get(userId, agentName, threadId); // 404 THREAD_NOT_FOUND
    reply.header('Cache-Control', 'no-store');
    // `read` 永不抛错：快照缺失/损坏/超限/判据不符都返回 undefined
    return ctx.nextActions.read(userId, agentName, threadId) ?? { message_id: null, actions: [] };
  });

  app.patch('/api/threads/:id', { schema: { body: renameBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { title } = req.body as { title: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'PATCH /api/threads/:id' });
    const meta = ctx.threadStore.rename(userId, agentName, threadId, title); // 404
    return { thread_id: meta.threadId, title: meta.title };
  });

  app.delete('/api/threads/:id', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: threadId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, { route: 'DELETE /api/threads/:id' });
    ctx.threadStore.get(userId, agentName, threadId); // 404
    // 有进行中 run 先 abort（契约：丢弃本轮但记 usage）；仍在启动中的请求打取消标记
    ctx.runManager.stop(threadId);
    // 先等落盘链排空再删目录（2026-10-27）：
    // 1) 在途 append 会把刚删掉的目录重新建出来（残留"没有 meta.json 的孤儿目录"）；
    // 2) 顺带释放三个 store 的串行链内存——键按会话累积且原先永不清理。
    await Promise.all([
      ctx.history.disposeThread(userId, agentName, threadId),
      ctx.summary.disposeThread(userId, agentName, threadId),
      ctx.toolEvents.disposeThread(userId, agentName, threadId),
    ]);
    // 下一步动作提示是会话级单快照，随会话一起删（与"发起新一轮即清空"同一语义）
    ctx.nextActions.clear(userId, agentName, threadId);
    // 删除是「多文件 × 单次系统调用」，**await 异步版**：不让它占住事件循环
    // （否则用户紧接着的"切换会话"请求会被一起拖慢，见 fs-safe 头部实测）
    await ctx.threadStore.delete(userId, agentName, threadId);
    return reply.status(204).send();
  });
}
