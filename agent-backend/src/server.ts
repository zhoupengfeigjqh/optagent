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
import { computeConfigFingerprint } from './domain/config-fingerprint.js';
import { ensureRootDirs, userAgentsDir, userDataDir, SPACE_TMP } from './domain/dirs.js';
import { HistoryStore } from './domain/history.js';
import { McpStatusEvents } from './domain/mcp-events.js';
import { RunManager } from './domain/run-manager.js';
import { SummaryStore } from './domain/summary.js';
import { ThreadStore } from './domain/thread-store.js';
import { cleanupTmpDir } from './domain/tmp-cleanup.js';
import { gracefulShutdown } from './graceful-shutdown.js';
import { AgentInstanceFactory, type ChatAgent } from './infra/agent-factory.js';
import type { LlmProvider } from './infra/llm/llm-provider.js';
import { PiAiLlmProvider } from './infra/llm/pi-ai-provider.js';
import { IntervalScheduler } from './infra/scheduler.js';
import { UsageDb } from './infra/usage-db.js';
import { createLoggers } from './logging.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerBuiltinToolRoutes } from './routes/builtin-tools.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerFileRoutes } from './routes/files.js';
import { registerMcpCallStatsRoutes } from './routes/mcp-call-stats.js';
import { registerModelRoutes } from './routes/models.js';
import { registerMonitorRoutes } from './routes/monitor.js';
import { registerThreadRoutes } from './routes/threads.js';
import { registerUsageRoutes } from './routes/usage.js';

/** 统一错误 envelope：{ error: { code, message, details? } }（details 为可选的逐条问题清单） */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** 结构化问题清单（如上传表校验的逐条问题）；仅 `FILE_SCHEMA_INVALID` 使用 */
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
    warn: (msg) => loggers.logger.warn({ alert: true, event: 'history.recover', scope: 'system' }, msg),
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
      warn: (msg: string) => loggers.logger.warn({ alert: true, event: 'summary.failed', scope: 'system' }, msg),
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
    // R4：工具调用完成即按服务名计数（成功/失败分列），供管理平台只读采集；
    // userId 一并落事件明细，支撑按用户明细（2026-09-16 十四次调整）
    onMcpCall: (serviceName, ok, userId) => usageDb.recordMcpCall(serviceName, ok, userId),
  });

  // 后台调度（T040）：每小时清理 tmp/ 下 7 天未访问的临时产出
  const scheduler = new IntervalScheduler({
    warn: (msg) => loggers.logger.warn({ alert: true, event: 'scheduler.task.failed', scope: 'system' }, msg),
  });
  scheduler.every(
    60 * 60 * 1000,
    async () => {
      await cleanupTmpDir(path.join(userDataDir(root, userId), SPACE_TMP), {
        logger: {
          warn: (msg) =>
            loggers.logger.warn({ alert: true, event: 'tmp.cleanup.failed', scope: 'system' }, msg),
          info: (msg) => loggers.logger.info({ event: 'tmp.cleanup', scope: 'system' }, msg),
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
        loggers.logger.info(
          { event: 'pool.idle.evict', scope: 'system', evicted },
          `回收空闲实例 ${evicted.length} 个`,
        );
      }
      // R7：因配置变化换下、但当时仍有在途轮次的实例，等轮次结束后回收
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
      if (existing) {
        // R7 / FR-034：取用前比对配置指纹
        // ① 配置未变 → 命中同一实例（池化收益不被破坏）
        // ② 配置已变 → 换代：空闲实例立即销毁；仍有在途轮次的转入退休表，
        //    既不中断进行中的回答，又让"其后的新对话"立刻用上新配置
        const current = existing as unknown as ChatAgent;
        const diskFingerprint = computeConfigFingerprint(
          path.join(userAgentsDir(root, key.userId), key.agentName),
        );
        if (current.configFingerprint === diskFingerprint) return existing as never;
        pool.retire(current);
      }
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
    // 只保留关键行为（任务 2026-09-15）：给 Fastify 一个 warn 级别的 child logger，
    // 逐请求的 info 访问日志被丢弃；warn/error（请求级错误）仍会输出。
    // 关键业务事件由各 domain 用 loggers.logger（info）显式记录。
    loggerInstance: loggers.logger.child({}, { level: 'warn' }),
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
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
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
  // R2：内置工具目录（只读，供管理平台投影；FR-011）
  registerBuiltinToolRoutes(routeApp, ctx);
  // R4：MCP 调用统计（只读，供管理平台投影；FR-049/FR-050）
  registerMcpCallStatsRoutes(routeApp, ctx);

  app.addHook('onClose', async () => {
    // 顺序要点（都是实测踩出来的）：
    // ① `shutdown.closed` MUST **先**记：清理步骤抛错、或日志流已关闭，这行就永远看不到；
    // ② 清理失败只告警不抛出，否则 `app.close()` 会 reject，连"服务已关闭"都无从谈起；
    // ③ 关闭日志流要 await：否则 `process.exit` 会截断最后几条日志。
    loggers.logger.info({ event: 'shutdown.closed', scope: 'system' }, 'HTTP 服务已关闭');
    try {
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
  // T050：SIGTERM/SIGINT → 优雅关闭（draining → 宽限 abort → close）
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
          // 先在日志里留痕再退出：容器 stdout 是管道，`process.exit` 会把 console.error 截断
          ctx.loggers.logger.error({ err, event: 'shutdown.failed', scope: 'system' }, '优雅关闭失败，强制退出');
          void ctx.loggers.close().finally(() => process.exit(1));
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
