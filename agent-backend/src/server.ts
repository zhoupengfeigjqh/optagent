/**
 * HTTP 服务装配：Fastify + 全局错误 envelope + CORS + multipart + 路由注册。
 *
 * buildServer 供集成测试（app.inject）与正式启动共用；
 * 直接运行时（tsx watch src/server.ts / node dist/server.js）进入 listen 分支。
 * 优雅关闭的完整接线在 T050。
 */
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { AgentPool } from './domain/agent-pool.js';
import { CurrentAgentStore } from './domain/current-agent.js';
import { getCurrentUser } from './domain/current-user.js';
import { ensureRootDirs, userDataDir, TMP_DIR } from './domain/dirs.js';
import { HistoryStore } from './domain/history.js';
import { McpStatusEvents } from './domain/mcp-events.js';
import { RunManager } from './domain/run-manager.js';
import { SummaryStore } from './domain/summary.js';
import { ThreadStore } from './domain/thread-store.js';
import { cleanupTmpDir } from './domain/tmp-cleanup.js';
import { gracefulShutdown } from './graceful-shutdown.js';
import { AgentInstanceFactory } from './infra/agent-factory.js';
import type { LlmProvider } from './infra/llm/llm-provider.js';
import { PiAiLlmProvider } from './infra/llm/pi-ai-provider.js';
import { IntervalScheduler } from './infra/scheduler.js';
import { UsageDb } from './infra/usage-db.js';
import { createLoggers } from './logging.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerFileRoutes } from './routes/files.js';
import { registerModelRoutes } from './routes/models.js';
import { registerMonitorRoutes } from './routes/monitor.js';
import { registerThreadRoutes } from './routes/threads.js';
import { registerUsageRoutes } from './routes/usage.js';

/** 统一错误 envelope：{ error: { code, message } } */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
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
  POOL_EXHAUSTED: 409,
  THREAD_NOT_FOUND: 404,
  AGENT_NOT_FOUND: 404,
};

export interface BuildServerOptions {
  config?: AppConfig;
  /** 测试注入假 LlmProvider；缺省惰性创建 PiAiLlmProvider（默认模型） */
  llmProvider?: LlmProvider;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const loggers = createLoggers(config.optAgentRoot);
  const root = config.optAgentRoot;
  const { userId } = getCurrentUser();
  ensureRootDirs(root, [userId]);

  // ---- wiring：routes → domain → infra ----
  const usageDb = new UsageDb(path.join(root, 'usage.db'), loggers.logger);
  const history = new HistoryStore(root, {
    warn: (msg) => loggers.logger.warn({ alert: true, event: 'history.recover' }, msg),
  });
  const threadStore = new ThreadStore(root, history);
  const pool = new AgentPool({ maxSize: config.poolSize });
  const currentAgent = new CurrentAgentStore();
  const mcpEvents = new McpStatusEvents();

  // LlmProvider 惰性单例：测试注入 fake 时不触碰 pi-ai/真 key
  let llmInstance: LlmProvider | undefined = options.llmProvider;
  const llm = () => (llmInstance ??= new PiAiLlmProvider(config.defaultModel));

  const summary = new SummaryStore(root, history, {
    llm,
    logger: {
      warn: (msg: string) => loggers.logger.warn({ alert: true, event: 'summary.failed' }, msg),
    },
  });

  const agentFactory = new AgentInstanceFactory({
    root,
    llm,
    // 测试注入 fake provider 时，请求级模型覆盖同样落到 fake（不触碰真 key）
    ...(options.llmProvider ? { providerFor: () => options.llmProvider! } : {}),
    logger: loggers.logger,
    mcpTimeoutMs: config.mcpTimeoutMs,
    truncateKb: config.readTruncateKb,
    publicBaseUrl: config.publicBaseUrl,
    fileSignSecret: config.fileSignSecret,
    // 建连落定 → 事件总线 → SSE 路由推送最新快照（替代前端轮询）
    onMcpStatus: (key) => mcpEvents.emitChanged(key.userId),
  });

  // 后台调度（T040）：每小时清理 tmp/ 下 7 天未访问的临时产出
  const scheduler = new IntervalScheduler({
    warn: (msg) => loggers.logger.warn({ alert: true, event: 'scheduler.task.failed' }, msg),
  });
  scheduler.every(
    60 * 60 * 1000,
    async () => {
      await cleanupTmpDir(path.join(userDataDir(root, userId), TMP_DIR), {
        logger: {
          warn: (msg) => loggers.logger.warn({ alert: true, event: 'tmp.cleanup.failed' }, msg),
          info: (msg) => loggers.logger.info({ event: 'tmp.cleanup' }, msg),
        },
      });
    },
    'tmp-cleanup',
  );

  // 空闲实例回收（T049）：每分钟淘汰空闲超时（默认 10min）的实例
  scheduler.every(
    60 * 1000,
    async () => {
      const evicted = pool.evictIdle(config.idleTimeoutMs);
      if (evicted.length > 0) {
        loggers.logger.info({ event: 'pool.idle.evict', evicted }, `回收空闲实例 ${evicted.length} 个`);
      }
    },
    'pool-idle-evict',
  );

  const runManager = new RunManager({
    history,
    usage: usageDb,
    logger: loggers.logger,
    summary,
    // FR-030：实例崩溃 → 销毁（下一条消息经 getOrCreateAgent 自动重建）
    onCrash: (key) => pool.remove(key),
  });

  const ctx: AppContext = {
    config,
    loggers,
    pool,
    currentAgent,
    threadStore,
    history,
    summary,
    runManager,
    usage: usageDb,
    mcpEvents,
    async getOrCreateAgent(key) {
      const existing = pool.get(key);
      if (existing) return existing as never;
      const instance = await agentFactory.create(key);
      try {
        pool.put(instance);
      } catch (err) {
        await instance.dispose();
        throw err;
      }
      return instance;
    },
  };

  const app = Fastify({
    loggerInstance: loggers.logger,
    bodyLimit: config.uploadMaxMb * 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  await app.register(cors, { origin: true });
  // defParamCharset 是 busboy 透传选项（@fastify/multipart 类型未暴露，
  // 单独声明避开字面量超额属性检查）：中文文件名按 UTF-8 解析
  const multipartOptions = {
    limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1 },
    defParamCharset: 'utf8',
  };
  await app.register(multipart, multipartOptions);

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    // domain 错误（带 code 字段）按映射表转为语义化状态码
    const code = (err as { code?: string }).code;
    if (code && code in DOMAIN_ERROR_STATUS) {
      const statusCode = DOMAIN_ERROR_STATUS[code]!;
      return reply.status(statusCode).send({ error: { code, message: (err as Error).message } });
    }
    // Fastify 校验错误（JSON Schema 不满足等）→ 400
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

  // pino Logger 与 FastifyBaseLogger 的泛型差异对路由注册无实质影响，此处统一收敛类型
  const routeApp = app as unknown as FastifyInstance;
  registerChatRoutes(routeApp, ctx);
  registerThreadRoutes(routeApp, ctx);
  registerAgentRoutes(routeApp, ctx);
  registerFileRoutes(routeApp, ctx);
  registerMonitorRoutes(routeApp, ctx);
  registerUsageRoutes(routeApp, ctx);
  registerFeedbackRoutes(routeApp, ctx);
  registerModelRoutes(routeApp, ctx);

  app.addHook('onClose', async () => {
    scheduler.stopAll();
    usageDb.close();
    loggers.close();
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  ensureRootDirs(config.optAgentRoot, [getCurrentUser().userId]);
  const app = await buildServer({ config });
  // T050：SIGTERM/SIGINT → 优雅关闭（draining → 宽限 abort → close）
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      const ctx = (app as unknown as { ctx: AppContext }).ctx;
      gracefulShutdown(app, ctx.runManager, config.shutdownGraceMs, ctx.loggers.logger)
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('优雅关闭失败，强制退出', err);
          process.exit(1);
        });
    });
  }
  // 双栈监听：'::' 默认接受 IPv4（IPv4-mapped），避免客户端把 localhost 解析成 ::1 时
  // 因「进程只监听 IPv4」触发 ~2s 的连接回退（本机实测：::1 无监听 → 2.03s 才失败）。
  // IPv6 不可用的环境回落到 IPv4 通配地址。
  try {
    await app.listen({ port: config.port, host: '::' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EADDRNOTAVAIL' && code !== 'EAFNOSUPPORT') throw err;
    await app.listen({ port: config.port, host: '0.0.0.0' });
  }
}

// 直接运行（非被测试 import）时启动
const invokedAs = process.argv[1] ?? '';
if (/server\.(ts|js)$/.test(invokedAs)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
