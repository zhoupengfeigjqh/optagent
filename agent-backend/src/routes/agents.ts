/**
 * 数字人路由（US4 / T044：列表/详情只读查询；US1 已含 select/exit 选中状态）。
 *
 * - GET  /api/agents            — 列表 { agent_name, description }；配置损坏者排除并告警
 * - GET  /api/agents/:name      — 详情（soul/skills/enabled_tools/mcp_servers，不含密钥类字段）
 * - POST /api/agents/:name/select — 配置损坏 → 404；**覆盖式选中**（可随时切换，无需先 exit）；
 *   重复 select 幂等；不销毁实例、不影响进行中的 run（下一轮对话生效）
 * - POST /api/agents/current/exit — 幂等；不销毁实例（LRU + 空闲超时自然回收）
 * - GET  /api/agents/current/mcp        — 当前数字人 MCP 连接状态快照（**只读**，不建实例）
 * - POST /api/agents/current/mcp/warm   — 显式预热：建实例 + 有界等建连落定，返回同形快照
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { getAgentDetail, listAgents } from '../domain/agent-catalog.js';
import { AgentConfigError, loadAgentConfig } from '../domain/agent-instance.js';
import { getCurrentUser } from '../domain/current-user.js';
import { migrateUserDataLayout } from '../domain/data-migration.js';
import { ensureAgentDataDirs, userAgentsDir } from '../domain/dirs.js';
import type { ChatAgent } from '../infra/agent-factory.js';
import { createThrottledWarn } from '../logging.js';
import { ApiError } from '../server.js';

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  // 目录是"每次请求现扫现解析"，配置损坏时会**每个请求告警一次** → 同一消息按窗口合并
  const catalogLogger = createThrottledWarn(ctx.loggers.logger, 'agent.config.invalid');

  /** 当前选中数字人的 MCP 状态快照（GET 轮询端点与 SSE 推送共用同一计算） */
  const mcpSnapshot = (userId: string) => {
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] as unknown[] };

    const detail = getAgentDetail(
      ctx.config.optAgentRoot,
      userId,
      selected.agentName,
      catalogLogger,
    );
    if (!detail)
      throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${selected.agentName}`);

    // 池内活跃实例 → 取实际连接结果（connected/failed，建连进行中为 unknown）；
    // 实例未创建（首次建连前或空闲回收后）→ 尚无连接结果，一律 unknown，不误报为断线（FR-019/020）
    const instance = ctx.pool.get(selected) as ChatAgent | undefined;
    return {
      agent_name: selected.agentName,
      mcp_servers: detail.mcp_servers.map((s) => ({
        name: s.name,
        transport: s.transport,
        status: instance ? instance.mcpStatusOf(s.name) : 'unknown',
      })),
    };
  };

  app.get('/api/agents', async () => {
    const userId = getCurrentUser().userId;
    return listAgents(ctx.config.optAgentRoot, userId, catalogLogger);
  });

  app.get('/api/agents/:name', async (req) => {
    const userId = getCurrentUser().userId;
    const { name } = req.params as { name: string };
    const detail = getAgentDetail(ctx.config.optAgentRoot, userId, name, catalogLogger);
    if (!detail) throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${name}`);
    return detail;
  });

  app.post('/api/agents/:name/select', async (req) => {
    const userId = getCurrentUser().userId;
    const { name } = req.params as { name: string };

    try {
      loadAgentConfig(path.join(userAgentsDir(ctx.config.optAgentRoot, userId), name));
    } catch (err) {
      if (err instanceof AgentConfigError)
        throw new ApiError(404, 'AGENT_NOT_FOUND', `数字人不存在或配置损坏：${name}`);
      throw err;
    }

    // 覆盖式选中：无需先 exit；切换后新数字人在下一轮对话生效
    ctx.currentAgent.select(userId, name);
    // 009 补判：启动期该用户可能还没有任何数字人（判定②③无从执行），此时存量数据原地保留；
    // 首次选中即触发一次迁移（判定①：当前选中），把数据搬进这个数字人目录（幂等，无源即返回）。
    //
    // **顺序不可颠倒**：迁移 MUST 早于建骨架——先把三空间骨架建出来，存量里的同名目录
    // 就会被判"目标已存在"而**全部跳过**，数据反而留在旧位（`migrateUserDataLayout` 内部同理）。
    migrateUserDataLayout(ctx.config.optAgentRoot, userId, {
      currentAgentName: name,
      logger: ctx.loggers.logger,
    });
    // 选中即初始化**该数字人**的数据域骨架（3 空间 + threads，幂等）——迁移之后补齐源里缺的目录；
    // 文件空间与「新建对话后发首条消息」都不再依赖进程启动时的预建目录
    ensureAgentDataDirs(ctx.config.optAgentRoot, userId, name);
    // 快照随选中变化 → 通知 SSE 订阅方推送新数字人的 MCP 状态
    ctx.mcpEvents.emitChanged(userId);
    return { agent_name: name, selected: true };
  });

  app.post('/api/agents/current/exit', async () => {
    const userId = getCurrentUser().userId;
    const had = ctx.currentAgent.current(userId) !== undefined;
    ctx.currentAgent.exit(userId);
    ctx.mcpEvents.emitChanged(userId);
    return { exited: had };
  });

  // 002 US4 / FR-018：当前选中数字人查询（未选中 → agent_name: null）
  app.get('/api/agents/current', async () => {
    const userId = getCurrentUser().userId;
    return { agent_name: ctx.currentAgent.current(userId)?.agentName ?? null };
  });

  // 002 US4 / FR-019/020：当前数字人挂载的 MCP 服务清单与连接状态
  app.get('/api/agents/current/mcp', async () => {
    const userId = getCurrentUser().userId;
    return mcpSnapshot(userId);
  });

  /**
   * MCP 预热（2026-10-18）：确保当前数字人的实例**已创建并开始建连**，返回落定后的快照。
   *
   * 为什么需要：实例是惰性创建的，而状态端点只读池；因此"新登录 / 切换数字人 / 空闲回收后"
   * 状态恒为 `unknown`（灰），此前唯一能把它变绿的入口是**发一轮对话**——这正是体验问题
   * 的根因。本端点提供幂等的显式唤醒：前端在挂载、切换、点击发送时调用。
   *
   * - 未选中 → `{ agent_name: null, mcp_servers: [] }`，与 GET 同形；
   * - 已有实例（常态）→ 不重复创建，仅等到建连落定（已落定则立即返回）；
   * - 建连超时 / 池满 / 建连异常 → **不抛错**，照常返回快照（仍为 unknown 的部分由调用方
   *   超时兜底，与"观测信息不阻断主流程"的既有口径一致）；
   * - 返回值与 `GET .../mcp` **同形**（`CurrentMcpResponse`），不新增字段、不新增类型。
   */
  app.post('/api/agents/current/mcp/warm', async () => {
    const userId = getCurrentUser().userId;
    const selected = ctx.currentAgent.current(userId);
    if (!selected) return { agent_name: null, mcp_servers: [] as unknown[] };

    // `false` 是"预热没成功"的兜底值：池满 / 配置损坏时连实例都拿不到（见 catch）
    let ready = false;
    try {
      const instance =
        (ctx.pool.get(selected) as ChatAgent | undefined) ??
        (await ctx.getOrCreateAgent({ userId, agentName: selected.agentName }));
      ready = await instance.mcpReady(ctx.config.mcpConnectTimeoutMs);
    } catch (err) {
      // 池满（PoolExhausted）/ 配置损坏（AgentConfigError）/ 其它：预热失败不改变调用方语义
      ctx.loggers.logger.warn(
        { err, event: 'mcp.warm.failed', user_id: userId, agent_name: selected.agentName },
        'MCP 预热失败（降级为"尚无连接结果"，不阻断发消息）',
      );
    }
    if (!ready) {
      ctx.loggers.logger.warn(
        {
          event: 'mcp.warm.timeout',
          user_id: userId,
          agent_name: selected.agentName,
          timeout_ms: ctx.config.mcpConnectTimeoutMs,
        },
        'MCP 建连未在预热超时内落定，仍返回当前快照',
      );
    }
    return mcpSnapshot(userId);
  });

  /**
   * MCP 状态推送（SSE）：替代前端轮询。
   * - 连接建立即推送一次当前快照（事件名 mcp-status，负载同 GET .../mcp）
   * - 之后每当 mcpEvents 发出 changed（建连落定 / select / exit）重算快照再推
   * - 25s 心跳注释行保活；客户端断开时退订并停心跳
   * 事件以"快照可能已变"为语义，推送时在回调时刻按当时选中重算，
   * 因此建连事件与切换事件交错时也不会把旧数字人的状态推给前端。
   */
  app.get('/api/agents/current/mcp/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const push = (): void => {
      let snapshot: unknown;
      try {
        snapshot = mcpSnapshot(userId);
      } catch {
        // 选中数字人配置损坏等异常：推送空快照，不断开流（与 GET 端点的静默降级语义一致）
        snapshot = { agent_name: null, mcp_servers: [] };
      }
      reply.raw.write(`event: mcp-status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };

    push();
    const unsubscribe = ctx.mcpEvents.onChanged((changedUserId) => {
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
