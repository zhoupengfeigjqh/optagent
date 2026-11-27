import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { ApiError } from './domain/api-error.js';
import { auditOf } from './domain/audit.js';
import { AuthService } from './domain/auth/service.js';
import { SessionStore } from './domain/auth/session-store.js';
import { AgentDesignService } from './domain/config-center/agent-design.js';
import { agentsReferencingService, expandToPairs } from './domain/config-center/references.js';
import { UnifiedCatalog } from './domain/config-center/unified-catalog.js';
import { UserLinkService } from './domain/config-center/user-links.js';
import { ERROR_CODES } from './domain/error-codes.js';
import { Deployer } from './domain/deploy/deployer.js';
import { DeployHistoryService } from './domain/deploy/history.js';
import { DeployManifestService } from './domain/deploy/manifest.js';
import { McpServiceOperations } from './domain/mcp/operations.js';
import { McpServiceConfigService } from './domain/mcp/service-config.js';
import { McpServiceListService } from './domain/mcp/service-list.js';
import { OntologyStore } from './domain/ontology/store.js';
import { SkillLibraryService } from './domain/skill-library/install.js';
import { McpClientService } from './infra/mcp-client.js';
import { OptAgentWriter } from './infra/opt-agent-writer.js';
import { PlatformStore } from './infra/platform-store.js';
import { RuntimeClient } from './infra/runtime-client.js';
import { createLoggers } from './logging.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBuiltinToolRoutes } from './routes/builtin-tools.js';
import { registerDeployRoutes } from './routes/deploy.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerOntologyRoutes } from './routes/ontologies.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerReferenceRoutes } from './routes/references.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerUserRoutes } from './routes/users.js';

export { ApiError } from './domain/api-error.js';
export { ERROR_CODES } from './domain/error-codes.js';

export interface BuildServerOptions {
  config?: AppConfig;
  store?: PlatformStore;
  runtime?: RuntimeClient;
  mcpClient?: McpClientService;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const loggers = createLoggers(config.platformDataDir, { level: config.logLevel });

  const store = options.store ?? new PlatformStore(config.platformDataDir, { logger: loggers.logger });
  store.ensureLayout();

  const runtime =
    options.runtime ??
    new RuntimeClient({
      baseUrl: config.optAgentBackendUrl,
      timeoutMs: config.runtimeTimeoutMs,
    });

  const skills = new SkillLibraryService(store, { logger: loggers.logger });
  const ontologies = new OntologyStore(store, { logger: loggers.logger });
  const agents = new AgentDesignService(store);
  const users = new UserLinkService(store);
  const sessionStore = new SessionStore(store);
  const auth = new AuthService(users, sessionStore, {
    secret: config.authSecret,
    ttlSeconds: config.authTokenTtlSeconds,
  });
  const mcpConfigs = new McpServiceConfigService(store);
  const manifest = new DeployManifestService(store);
  const history = new DeployHistoryService(store);
  const writer = new OptAgentWriter({ optAgentRoot: config.optAgentRoot, logger: loggers.logger });
  const catalog = new UnifiedCatalog({
    runtime,
    mcpConfigs,
    skills,
    ontologies,
    logger: loggers.logger,
  });
  const mcpClient = options.mcpClient ?? new McpClientService({ timeoutMs: config.mcpTimeoutMs });

  const referencesOfService = (serviceName: string) =>
    expandToPairs(
      agentsReferencingService(agents.refSources(), serviceName),
      users.listAll().map((user) => ({ user_id: user.user_id, agents: [...user.agents] })),
    );

  const mcpServices = new McpServiceListService({
    configs: mcpConfigs,
    mcpClient,
    referencesOf: referencesOfService,
    currentRevision: () => store.revision(),
  });
  const mcpOperations = new McpServiceOperations({
    configs: mcpConfigs,
    mcpClient,
    runtime,
  });

  const ctx: AppContext = {
    config,
    loggers,
    store,
    runtime,
    agents,
    users,
    skills,
    ontologies,
    mcpConfigs,
    mcpServices,
    mcpOperations,
    manifest,
    history,
    writer,
    catalog,
    sessionStore,
    auth,
    deployer: new Deployer({
      store,
      agents,
      users,
      mcpConfigs,
      skills,
      ontologies,
      writer,
      manifest,
      history,
      logger: loggers.logger,
    }),
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

  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const isWrite = (method: string): boolean => WRITE_METHODS.has(method);

  app.addHook('onResponse', async (req, reply) => {
    if (!isWrite(req.method) || reply.statusCode >= 400) return;
    loggers.logger.info(
      {
        event: 'admin.write',
        action: `${req.method} ${routePatternOf(req)}`,
        method: req.method,
        path: req.url,
        ...auditTarget(req),
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
        revision: store.revision(),
        req_id: req.id,
      },
      `写操作完成：${req.method} ${routePatternOf(req)}`,
    );
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined) body.error.details = err.details;
      logRejectedWrite(req, err.code, err.statusCode);
      return reply.status(err.statusCode).send(body);
    }

    const e = err as { statusCode?: number; message?: string };
    const statusCode = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    const code = statusCode >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
    if (statusCode >= 500) req.log.error({ err, event: 'unhandled_error' }, e.message);
    else logRejectedWrite(req, code, statusCode);
    return reply.status(statusCode).send({ error: { code, message: e.message ?? '内部错误' } });
  });

  function logRejectedWrite(req: FastifyRequest, code: string, statusCode: number): void {
    if (!isWrite(req.method) || statusCode >= 500) return;
    loggers.logger.warn(
      {
        event: 'admin.write.rejected',
        action: `${req.method} ${routePatternOf(req)}`,
        method: req.method,
        path: req.url,
        ...auditTarget(req),
        status: statusCode,
        code,
        req_id: req.id,
      },
      `写操作被拒绝：${req.method} ${routePatternOf(req)} → ${code}`,
    );
  }

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: '接口不存在' } }),
  );

  const routeApp = app as unknown as FastifyInstance;
  registerPlatformRoutes(routeApp, ctx);
  registerBuiltinToolRoutes(routeApp, ctx);
  registerAgentRoutes(routeApp, ctx);
  registerMcpRoutes(routeApp, ctx, { serviceList: mcpServices, operations: mcpOperations });
  registerUserRoutes(routeApp, ctx);
  registerSkillRoutes(routeApp, ctx);
  registerOntologyRoutes(routeApp, ctx);
  registerReferenceRoutes(routeApp, ctx);
  registerDeployRoutes(routeApp, ctx, ctx.deployer);
  registerAuthRoutes(routeApp, ctx);

  app.addHook('onClose', async () => {
    await loggers.close();
  });

  return app;
}

function routePatternOf(req: FastifyRequest): string {
  return req.routeOptions?.url ?? req.url;
}

/**
 * 审计用的"操作目标"。
 *
 * 只取**标识**（路径参数、请求体里的名称、或路由显式标注，见 `domain/audit.ts`），
 * **不取内容**——避免把 SOUL 正文、文件内容、消息文本写进日志。
 * `fields` 给出本次提交涉及了哪些字段（只有键名），用于回答"到底改了哪一项"。
 */
function auditTarget(req: FastifyRequest): Record<string, unknown> {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const marked = auditOf(req);
  let target = marked.target ?? '';
  for (const key of ['name', 'user_id', 'id']) {
    if (target !== '') break;
    const value = params[key];
    if (typeof value === 'string' && value !== '') target = value;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyIsObject = body !== undefined && body !== null && typeof body === 'object';
  if (target === '' && bodyIsObject) {
    for (const key of ['name', 'user_id', 'target_name']) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') {
        target = value;
        break;
      }
    }
  }

  const fields =
    bodyIsObject && !Array.isArray(body) && !(body instanceof Buffer)
      ? Object.keys(body as Record<string, unknown>)
      : [];

  return {
    ...(target === '' ? {} : { target }),
    ...(fields.length === 0 ? {} : { fields }),
    ...(marked.extra ?? {}),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
  await app.listen({ port: config.port, host: '::' }).catch(async (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EAFNOSUPPORT') throw err;
    await app.listen({ port: config.port, host: '0.0.0.0' });
  });
}

const invokedAs = process.argv[1] ?? '';
if (/server\.(ts|js)$/.test(invokedAs)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
