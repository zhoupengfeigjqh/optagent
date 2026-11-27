import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { loadConfig, summarizeConfig, unknownEnvKeys, type AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { AgentPool } from './domain/agent-pool.js';
import { listAgents } from './domain/agent-catalog.js';
import { CurrentAgentStore } from './domain/current-agent.js';
import { getCurrentUser } from './domain/current-user.js';
import { listUserIds, migrateAllUsers } from './domain/data-migration.js';
import { ensureRootDirs } from './domain/dirs.js';
import { FileAccess } from './domain/file-access.js';
import { HistoryStore } from './domain/history.js';
import { McpStatusEvents } from './domain/mcp-events.js';

import { ProducedEvents } from './domain/produced-events.js';
import { formatProducedList, listProduced } from './domain/produced.js';
import { RunManager } from './domain/run-manager.js';

import { SummaryStore } from './domain/summary.js';
import { ThreadStore } from './domain/thread-store.js';
import { cleanupAllAgentTmpDirs } from './domain/tmp-cleanup.js';
import { ToolEventStore } from './domain/tool-events.js';
import { gracefulShutdown } from './graceful-shutdown.js';
import { AgentInstanceFactory, type ChatAgent } from './infra/agent-factory.js';
import type { LlmProvider } from './infra/llm/llm-provider.js';
import { PiAiLlmProvider } from './infra/llm/pi-ai-provider.js';
import { createAuthHook, createIntrospector } from './infra/auth.js';
import { IntervalScheduler } from './infra/scheduler.js';
import { UsageDb } from './infra/usage-db.js';
import { createLoggers } from './logging.js';
import { createAgentProvider } from './server-agents.js';
import { buildAttachments } from './server-attachments.js';
import { buildScheduledTasks } from './server-schedule.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerBuiltinToolRoutes } from './routes/builtin-tools.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerFileRoutes } from './routes/files.js';
import { registerMcpCallStatsRoutes } from './routes/mcp-call-stats.js';
import { registerModelRoutes } from './routes/models.js';
import { registerMonitorRoutes } from './routes/monitor.js';
import { registerProducedRoutes } from './routes/produced.js';
import { registerScheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { registerTermNormalizeRoutes } from './routes/term-normalize.js';
import { registerThreadRoutes } from './routes/threads.js';
import { registerUsageRoutes } from './routes/usage.js';
import type { ModelSelection } from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** domain 错误 code → HTTP 状态码映射（避免 routes 到处 try/catch） */
const DOMAIN_ERROR_STATUS: Record<string, number> = {
  THREAD_RUN_ACTIVE: 409,
  THREAD_BUSY_LIMIT: 409,
  AGENT_NOT_SELECTED: 409,
  // 009 新增：已选定但该数字人对本用户不可用（配置目录不存在或配置损坏）
  AGENT_NOT_AVAILABLE: 409,
  POOL_EXHAUSTED: 409,
  THREAD_NOT_FOUND: 404,
  THREAD_ID_INVALID: 400,
  AGENT_NOT_FOUND: 404,
  SCHEDULED_TASK_NOT_FOUND: 404,
  SCHEDULED_TASK_NAME_CONFLICT: 409,
  SCHEDULED_TASK_ENABLED: 409,
  SCHEDULED_TASK_EXHAUSTED: 409,
  UNAUTHENTICATED: 401,
  SESSION_REVOKED: 401,
};

export interface BuildServerOptions {
  config?: AppConfig;
  llmProvider?: LlmProvider;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const loggers = createLoggers(config.optAgentRoot);
  // 2026-11-26：一行摘要回答"这台机器上哪个值生效"（密钥不打码项一律不出现）
  loggers.logger.info(
    { event: 'config.effective', ...summarizeConfig(config) },
    '配置生效值',
  );
  const staleEnv = unknownEnvKeys();
  if (staleEnv.length > 0) {
    loggers.logger.warn(
      { alert: true, event: 'config.unknown_env', keys: staleEnv },
      '检测到未生效或已废弃的环境变量（拼写错误 / 已迁入 config.yaml / 已降为常量）',
    );
  }
  const root = config.optAgentRoot;
  const { userId } = getCurrentUser();
  ensureRootDirs(root, [userId]);

  migrateAllUsers(root, { logger: loggers.logger });

  const usageDb = new UsageDb(path.join(root, 'usage.db'), loggers.logger);
  const history = new HistoryStore(root, {
    warn: (msg) =>
      loggers.logger.warn({ alert: true, event: 'history.recover', scope: 'system' }, msg),
  });
  const threadStore = new ThreadStore(root, history);
  // 工具调用记录（002 特性）：元数据常驻会话目录，超阈值的结果正文外置到临时空间。
  const toolEvents = new ToolEventStore({
    root,
    logger: {
      warn: (msg: string) =>
        loggers.logger.warn({ alert: true, event: 'tool-events.recover', scope: 'system' }, msg),
    },
    // 外置正文落在**该数字人**的临时空间（009）：读写口按（用户，数字人）取用
    artifacts: (userId: string, agentName: string) =>
      new FileAccess({
        optAgentRoot: root,
        userId,
        agentName,
        logger: loggers.logger,
        truncateKb: config.readTruncateKb,
      }),
  });
  const pool = new AgentPool({ maxSize: config.poolSize });
  const currentAgent = new CurrentAgentStore();
  const mcpEvents = new McpStatusEvents();
  const producedEvents = new ProducedEvents();

  let llmInstance: LlmProvider | undefined = options.llmProvider;
  const llm = () => (llmInstance ??= new PiAiLlmProvider(config.defaultModel, config.llmRetry));
  const providerFor = (entry: ModelSelection): LlmProvider =>
    options.llmProvider ?? new PiAiLlmProvider(entry, config.llmRetry);

  const summary = new SummaryStore(root, history, {
    llm,
    logger: {
      warn: (msg: string) =>
        loggers.logger.warn({ alert: true, event: 'summary.failed', scope: 'system' }, msg),
    },
  });

  const agentFactory = new AgentInstanceFactory({
    root,
    llm,
    providerFor,
    logger: loggers.logger,
    mcpTimeoutMs: config.mcpTimeoutMs,
    mcpConnectTimeoutMs: config.mcpConnectTimeoutMs,
    // 028：规划上限（yaml `plan` 块；缺省 = 原代码常量）
    planLimits: config.planLimits,
    // 2026-10-15：请求级模型覆盖的临时 provider 用同一份重试口径（与默认模型单例同源）
    llmRetry: config.llmRetry,
    truncateKb: config.readTruncateKb,
    // 028：规划门禁阈值（intent_focus.plan_threshold；未配置 = 门禁关闭）
    ...(config.intentFocus?.planThreshold !== undefined
      ? { planThreshold: config.intentFocus.planThreshold }
      : {}),
    // 2026-11-16：write_file 的落盘上限与预览上限同源（超限在写入前拒绝，
    writeMaxBytes: config.previewMaxMb * 1024 * 1024,
    publicBaseUrl: config.publicBaseUrl,
    fileSignSecret: config.fileSignSecret,
    onMcpStatus: (key) => mcpEvents.emitChanged(key.userId),
    onMcpCall: (event) => usageDb.recordMcpCall(event),
  });

  // 后台调度（T040）：每小时清理 tmp/ 下 30 天未访问的临时产出
  const scheduler = new IntervalScheduler({
    warn: (msg) =>
      loggers.logger.warn({ alert: true, event: 'scheduler.task.failed', scope: 'system' }, msg),
  });
  scheduler.every(
    60 * 60 * 1000,
    async () => {
      // 009：临时空间是**数字人级**的 ⇒ 按（用户 × 数字人）逐一清理，
      await cleanupAllAgentTmpDirs(
        root,
        listUserIds(root),
        (uid) => listAgents(root, uid).map((a) => a.agent_name),
        {
          logger: {
            warn: (msg) =>
              loggers.logger.warn(
                { alert: true, event: 'tmp.cleanup.failed', scope: 'system' },
                msg,
              ),
            info: (msg) => loggers.logger.info({ event: 'tmp.cleanup', scope: 'system' }, msg),
          },
        },
      );
    },
    'tmp-cleanup',
  );

  // 空闲实例回收（T049）：每分钟淘汰空闲超时（默认 30min）的实例
  scheduler.every(
    60 * 1000,
    async () => {
      const evicted = pool.evictIdle(config.idleTimeoutMs);
      if (evicted.length > 0) {
        loggers.logger.info(
          { event: 'pool.idle.evict', scope: 'system', evicted },
          `回收空闲实例 ${evicted.length} 个`,
        );
      }
      const swept = pool.sweepRetired();
      if (swept > 0) {
        loggers.logger.info(
          { event: 'pool.retired.sweep', scope: 'system', swept },
          `回收退休实例 ${swept} 个`,
        );
      }
    },
    'pool-idle-evict',
  );

  // 这里定期对池内实例的已连接服务发探针：探测失败即降级变红并推送；
  // 不可用的服务由 McpManager 的保活重连负责（每 2 分钟一次），恢复后自动变绿。
  scheduler.every(
    60 * 1000,
    async () => {
      for (const instance of pool.list()) {
        const agent = instance as unknown as ChatAgent;
        if (typeof agent.probeMcp !== 'function') continue;
        try {
          const failed = await agent.probeMcp();
          if (failed.length > 0) {
            loggers.logger.warn(
              {
                event: 'mcp.probe.failed',
                scope: 'system',
                user_id: agent.key.userId,
                agent_name: agent.key.agentName,
                servers: failed,
              },
              `MCP 健康探测发现服务不可用：${failed.join('、')}`,
            );
          }
        } catch (err) {
          loggers.logger.warn(
            { err, event: 'mcp.probe.error', scope: 'system', agent_name: agent.key.agentName },
            'MCP 健康探测异常（不影响主流程）',
          );
        }
      }
    },
    'mcp-health-check',
  );

  const attachments = buildAttachments({
    root,
    config,
    logger: loggers.logger,
    llm,
    providerFor,
    readHistory: (userId, agentName, threadId) => history.readAll(userId, agentName, threadId),
  });

  const runManager = new RunManager({
    history,
    usage: usageDb,
    logger: loggers.logger,
    summary,
    toolEvents,
    nextActions: attachments.nextActions,
    // 007 修订：开关与条数逐次现读（SOUL.md frontmatter）；开启时条数上限同时驱动
    llmInfo: () => ({ provider: 'deepseek', model: config.defaultModel.model }),
    nextActionsConfig: attachments.nextActionsConfig,
    // 013：意图聚焦判定口（未配置判定模型时缺省不注入 = 功能不可用）
    ...(attachments.intentFocus ? { intentFocus: attachments.intentFocus } : {}),
    onCrash: (key) => pool.remove(key),
    // 避免把别的对话提交的任务结果污染进本轮上下文；无产出时返回空串（该段长度为 0）
    produced: async (userId, agentName, threadId) => {
      const items = await listProduced(
        new FileAccess({
          optAgentRoot: root,
          userId,
          agentName,
          logger: loggers.logger,
          truncateKb: config.readTruncateKb,
        }),
      );
      return formatProducedList(items.filter((item) => item.sid === threadId));
    },
  });

  const getOrCreateAgent = createAgentProvider({ root, pool, factory: agentFactory });

  const scheduled = buildScheduledTasks({
    root,
    mcpConnectTimeoutMs: config.mcpConnectTimeoutMs,
    logger: loggers.logger,
    threadStore,
    runManager,
    getOrCreateAgent,
  });

  const ctx: AppContext = {
    config,
    loggers,
    pool,
    currentAgent,
    threadStore,
    history,
    summary,
    toolEvents,
    nextActions: attachments.nextActions,
    runManager,
    usage: usageDb,
    mcpEvents,
    producedEvents,
    scheduled,
    getOrCreateAgent,
  };

  const app = Fastify({
    loggerInstance: loggers.logger.child({}, { level: 'warn' }),
    bodyLimit: config.uploadMaxMb * 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  await app.register(cors, { origin: true });
  const multipartOptions = {
    limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1 },
    defParamCharset: 'utf8',
  };
  await app.register(multipart, multipartOptions);
  // 这样无需注册 `'*'` 兜底、不改变任何既有端点的 content-type 行为。
  app.addContentTypeParser(
    ['application/octet-stream', 'text/plain'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  // 024：鉴权钩子（须在路由注册前；未配 AUTH_SECRET 时放行回退 legacy 单用户）
  app.addHook(
    'onRequest',
    createAuthHook({
      ...(config.authSecret ? { secret: config.authSecret } : {}),
      ...(config.authSecret ? { introspect: createIntrospector(config.adminBackendUrl) } : {}),
    }),
  );

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
    }
    const code = (err as { code?: string }).code;
    if (code && code in DOMAIN_ERROR_STATUS) {
      const statusCode = DOMAIN_ERROR_STATUS[code]!;
      return reply.status(statusCode).send({ error: { code, message: (err as Error).message } });
    }
    const e = err as { statusCode?: number; message?: string };
    const statusCode = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    const errCode = statusCode < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
    if (statusCode >= 500) req.log.error({ err, event: 'unhandled_error' }, e.message);
    return reply
      .status(statusCode)
      .send({ error: { code: errCode, message: e.message ?? '内部错误' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } }),
  );

  const routeApp = app as unknown as FastifyInstance;
  registerChatRoutes(routeApp, ctx);
  registerThreadRoutes(routeApp, ctx);
  registerTermNormalizeRoutes(routeApp, ctx);
  registerAgentRoutes(routeApp, ctx);
  registerFileRoutes(routeApp, ctx);
  registerMonitorRoutes(routeApp, ctx);
  registerUsageRoutes(routeApp, ctx);
  registerFeedbackRoutes(routeApp, ctx);
  registerModelRoutes(routeApp, ctx);
  registerBuiltinToolRoutes(routeApp, ctx);
  registerMcpCallStatsRoutes(routeApp, ctx);
  registerProducedRoutes(routeApp, ctx);
  registerScheduledTaskRoutes(routeApp, ctx);

  scheduled.start();

  app.addHook('onClose', async () => {
    // ② 清理失败只告警不抛出，否则 `app.close()` 会 reject，连"服务已关闭"都无从谈起；
    // ③ 关闭日志流要 await：否则 `process.exit` 会截断最后几条日志。
    loggers.logger.info({ event: 'shutdown.closed', scope: 'system' }, 'HTTP 服务已关闭');
    try {
      scheduled.stop();
      scheduler.stopAll();
      usageDb.close();
    } catch (err) {
      loggers.logger.warn(
        { err, event: 'shutdown.cleanup.failed', scope: 'system' },
        '关闭清理未完成（实例已退出，不影响下次启动）',
      );
    } finally {
      await loggers.close();
    }
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  ensureRootDirs(config.optAgentRoot, [getCurrentUser().userId]);
  const app = await buildServer({ config });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      const ctx = (app as unknown as { ctx: AppContext }).ctx;
      gracefulShutdown(app, ctx.runManager, config.shutdownGraceMs, ctx.loggers.logger)
        .then(async (outcome) => {
          ctx.loggers.logger.info(
            { event: 'shutdown.exit', scope: 'system', outcome },
            `进程即将退出（${outcome === 'drained' ? '在途 run 已收尾' : '宽限到期，已中断残留 run'}）`,
          );
          // 退出前**必须**等日志落盘：`process.exit` 会截断未完成的写（实测丢过日志）。
          // `close()` 幂等：钩子里已关过则立即返回。
          await ctx.loggers.close();
          process.exit(0);
        })
        .catch((err) => {
          ctx.loggers.logger.error(
            { err, event: 'shutdown.failed', scope: 'system' },
            '优雅关闭失败，强制退出',
          );
          void ctx.loggers.close().finally(() => process.exit(1));
        });
    });
  }
  // 双栈监听：'::' 默认接受 IPv4（IPv4-mapped），避免客户端把 localhost 解析成 ::1 时
  // IPv6 不可用的环境回落到 IPv4 通配地址。
  try {
    await app.listen({ port: config.port, host: '::' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EADDRNOTAVAIL' && code !== 'EAFNOSUPPORT') throw err;
    await app.listen({ port: config.port, host: '0.0.0.0' });
  }
}

const invokedAs = process.argv[1] ?? '';
if (/server\.(ts|js)$/.test(invokedAs)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
