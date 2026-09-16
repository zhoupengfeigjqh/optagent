/**
 * HTTP 服务装配：Fastify + 统一错误 envelope + CORS + multipart + 路由注册。
 *
 * `buildServer` 供集成测试（`app.inject`）与正式启动共用；直接运行时进入 `listen` 分支。
 *
 * 分层：`routes → domain → infra`。`context.ts` 承载 wiring，
 * 避免 `routes ↔ server` 循环 import（与 `agent-backend` 同构）。
 */
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { ApiError } from './domain/api-error.js';
import { auditOf } from './domain/audit.js';
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
import { PlatformSettingsService } from './domain/platform-settings.js';
import { SkillLibraryService } from './domain/skill-library/install.js';
import { ComposeReader } from './infra/compose-reader.js';
import { DockerHost } from './infra/docker-host.js';
import { McpClientService } from './infra/mcp-client.js';
import { OptAgentWriter } from './infra/opt-agent-writer.js';
import { PlatformStore } from './infra/platform-store.js';
import { RuntimeClient } from './infra/runtime-client.js';
import { createLoggers } from './logging.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerBuiltinToolRoutes } from './routes/builtin-tools.js';
import { registerDeployRoutes } from './routes/deploy.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerReferenceRoutes } from './routes/references.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerUserRoutes } from './routes/users.js';

export { ApiError } from './domain/api-error.js';
export { ERROR_CODES } from './domain/error-codes.js';

export interface BuildServerOptions {
  config?: AppConfig;
  /** 测试可注入自定义存储根（默认取 `config.platformDataDir`） */
  store?: PlatformStore;
  /** 测试可注入 Docker 假实现（容器状态/日志/启停） */
  docker?: DockerHost;
  /** 测试可注入运行环境客户端假实现（工具目录/调用统计） */
  runtime?: RuntimeClient;
  /** 测试可注入 MCP 客户端假实现（工具清单 / 连通性与能力测试） */
  mcpClient?: McpClientService;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const loggers = createLoggers(config.platformDataDir, { level: config.logLevel });

  // ---- wiring：routes → domain → infra ----
  const store = options.store ?? new PlatformStore(config.platformDataDir, { logger: loggers.logger });
  store.ensureLayout();

  const compose = new ComposeReader(config.composeFilePath);
  const docker =
    options.docker ??
    new DockerHost({
      socketPath: config.dockerSocketPath,
      timeoutMs: config.runtimeTimeoutMs,
      // 启停白名单＝编排声明的服务名（FR-043「不允许启停未声明服务」）
      isManageable: (name) => {
        try {
          return compose.listMcpServices().some((s) => s.name === name);
        } catch {
          return false;
        }
      },
    });
  const runtime =
    options.runtime ??
    new RuntimeClient({
      baseUrl: config.runtimeApiBaseUrl,
      timeoutMs: config.runtimeTimeoutMs,
    });

  const settings = new PlatformSettingsService(store);
  const skills = new SkillLibraryService(store, { logger: loggers.logger });
  const agents = new AgentDesignService(store);
  const users = new UserLinkService(store);
  const mcpConfigs = new McpServiceConfigService(store);
  const manifest = new DeployManifestService(store);
  const history = new DeployHistoryService(store);
  const writer = new OptAgentWriter({ optAgentRoot: config.optAgentRoot, logger: loggers.logger });
  const catalog = new UnifiedCatalog({ runtime, compose, skills, logger: loggers.logger });
  const mcpClient = options.mcpClient ?? new McpClientService({ timeoutMs: config.mcpTimeoutMs });

  /** 引用某 MCP 服务的「用户 × 数字人」对（§3.2/§3.3 的影响面） */
  const referencesOfService = (serviceName: string) =>
    expandToPairs(
      agentsReferencingService(agents.refSources(), serviceName),
      users.listAll().map((user) => ({ user_id: user.user_id, agents: [...user.agents] })),
    );

  const mcpServices = new McpServiceListService({
    compose,
    docker,
    configs: mcpConfigs,
    mcpClient,
    referencesOf: referencesOfService,
    targetForm: () => settings.targetForm(),
    currentRevision: () => store.revision(),
  });
  const mcpOperations = new McpServiceOperations({
    docker,
    configs: mcpConfigs,
    mcpClient,
    serviceList: mcpServices,
    runtime,
    targetForm: () => settings.targetForm(),
  });

  const ctx: AppContext = {
    config,
    loggers,
    store,
    compose,
    docker,
    runtime,
    settings,
    agents,
    users,
    skills,
    mcpConfigs,
    mcpServices,
    mcpOperations,
    manifest,
    history,
    writer,
    catalog,
    deployer: new Deployer({
      optAgentRoot: config.optAgentRoot,
      store,
      agents,
      users,
      mcpConfigs,
      skills,
      catalog,
      settings,
      writer,
      manifest,
      history,
      logger: loggers.logger,
    }),
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
  // defParamCharset 是 busboy 透传选项（@fastify/multipart 类型未暴露）：
  // 中文文件名与目录名按 UTF-8 解析（本产品的目录名常态是中文）
  const multipartOptions = {
    limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1 },
    defParamCharset: 'utf8',
  };
  await app.register(multipart, multipartOptions);

  /**
   * 写操作留痕（任务 2026-09-16）。
   *
   * 关闭逐请求访问日志后，admin 侧的写操作一度只剩"部署"与"技能文件保存"有记录，
   * 于是"谁删了数字人""谁关了 MCP 服务""谁改了调用地址"在日志里查不到。
   * 这里用**一个钩子 + 错误处理器**统一补齐，不必逐个路由插桩：
   * - 成功（2xx/3xx）→ info `admin.write`；
   * - 被拒（4xx）→ warn `admin.write.rejected`（含错误码，界面报错可直接对到日志）；
   * - 服务端异常（5xx）→ 沿用 `unhandled_error`（带堆栈），**不重复记**审计行。
   * **只覆盖写方法**：GET 仍不记逐请求日志（`catalog.tools.unavailable` 那类关键事件另有专门记录）。
   */
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

    // Fastify 校验错误（JSON Schema 不满足等）→ 400
    const e = err as { statusCode?: number; message?: string };
    const statusCode = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    const code = statusCode >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
    if (statusCode >= 500) req.log.error({ err, event: 'unhandled_error' }, e.message);
    else logRejectedWrite(req, code, statusCode);
    return reply.status(statusCode).send({ error: { code, message: e.message ?? '内部错误' } });
  });

  /** 4xx：写操作被拒要有迹可循（含错误码，便于与界面提示对齐） */
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

  // pino Logger 与 FastifyBaseLogger 的泛型差异对路由注册无实质影响
  const routeApp = app as unknown as FastifyInstance;
  registerPlatformRoutes(routeApp, ctx);
  registerBuiltinToolRoutes(routeApp, ctx);
  registerAgentRoutes(routeApp, ctx);
  registerMcpRoutes(routeApp, ctx, { serviceList: mcpServices, operations: mcpOperations });
  registerUserRoutes(routeApp, ctx);
  registerSkillRoutes(routeApp, ctx);
  registerReferenceRoutes(routeApp, ctx);
  registerDeployRoutes(routeApp, ctx, ctx.deployer);

  app.addHook('onClose', async () => {
    await loggers.close();
  });

  return app;
}

/** 路由模式（如 `PUT /api/admin/skills/:name/file`）：日志里用模式而非具体 URL，便于聚合 */
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

  // multipart（技能安装）的 req.body 不存在：这类操作由路由用 markAudit 补上对象名
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

// 直接运行（非被测试 import）时启动
const invokedAs = process.argv[1] ?? '';
if (/server\.(ts|js)$/.test(invokedAs)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
