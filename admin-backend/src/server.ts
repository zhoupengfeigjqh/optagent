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
import type { AccountStorePort } from './domain/account/account-store.js';
import { AgentServiceCatalog } from './domain/account/agent-services.js';
import { RegisterLinkService } from './domain/account/register-links.js';
import { RegistrationService } from './domain/account/registration.js';
import { FileAccountStore } from './domain/account/file-account-store.js';
import { MysqlAccountStore } from './domain/account/mysql-account-store.js';
import { AuthService } from './domain/auth/service.js';
import { createAdminGuard, type AdminGuard } from './domain/auth/guard.js';
import { SessionStore, type SessionPort } from './domain/auth/session-store.js';
import { MysqlSessionStore } from './domain/auth/mysql-session-store.js';
import { AgentDesignService } from './domain/config-center/agent-design.js';
import { agentsReferencingService, expandToPairs } from './domain/config-center/references.js';
import { UnifiedCatalog } from './domain/config-center/unified-catalog.js';
import { UserLinkService, type UserLinkPort } from './domain/config-center/user-links.js';
import { MysqlUserLinkService, MysqlUserRepository } from './domain/config-center/mysql-user-link-service.js';
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
import { MysqlConnection } from './infra/mysql.js';
import { OptAgentWriter } from './infra/opt-agent-writer.js';
import { PlatformStore } from './infra/platform-store.js';
import { RuntimeClient } from './infra/runtime-client.js';
import { createLoggers } from './logging.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerAgentServiceRoutes } from './routes/agent-services.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBuiltinToolRoutes } from './routes/builtin-tools.js';
import { registerDeployRoutes } from './routes/deploy.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerOntologyRoutes } from './routes/ontologies.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerReferenceRoutes } from './routes/references.js';
import { registerRegisterLinkRoutes } from './routes/register-links.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerUserRoutes } from './routes/users.js';

export { ApiError } from './domain/api-error.js';
export { ERROR_CODES } from './domain/error-codes.js';

export interface BuildServerOptions {
  config?: AppConfig;
  /** 测试可注入自定义存储根（默认取 `config.platformDataDir`） */
  store?: PlatformStore;
  /** 测试可注入运行环境客户端假实现（工具目录/调用统计） */
  runtime?: RuntimeClient;
  /** 测试可注入 MCP 客户端假实现（工具清单 / 连通性与能力测试） */
  mcpClient?: McpClientService;
  /**
   * 测试可注入鉴权钩子（030）。缺省 = 真实守卫（`createAdminGuard`）；
   * 既有集成测试注入 no-op，避免上千处 `inject` 逐个补 Cookie；
   * 鉴权行为本身由 `tests/integration/admin-auth.spec.ts` 用真实守卫覆盖。
   */
  adminGuard?: AdminGuard;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const loggers = createLoggers(config.platformDataDir, { level: config.logLevel });

  // ---- wiring：routes → domain → infra ----
  const store = options.store ?? new PlatformStore(config.platformDataDir, { logger: loggers.logger });
  // 029 FR-027：mysql 驱动的账号域不在 `.platform-data/accounts/**`，不建空目录也不告警
  store.ensureLayout({ accounts: config.storageDriver === 'file' });

  const runtime =
    options.runtime ??
    new RuntimeClient({
      baseUrl: config.optAgentBackendUrl,
      timeoutMs: config.runtimeTimeoutMs,
    });

  const skills = new SkillLibraryService(store, { logger: loggers.logger });
  // 本体库（2026-10-03）：只读浏览 + 本体市场导入/更新/删除（FR-058~FR-061）
  const ontologies = new OntologyStore(store, { logger: loggers.logger });
  const agents = new AgentDesignService(store);

  // ---- 028 阶段 1：账号域存储按 STORAGE_DRIVER 选择（默认 file，可回滚）----
  // mysql 驱动：启动即验证连通（不可达 = 拒绝启动，不静默回退文件存储），
  // 并全量加载内存投影——读路径保持同步，Deployer/references/MCP 引用零改动。
  let users: UserLinkPort;
  let sessionStore: SessionPort;
  let mysqlConn: MysqlConnection | undefined;
  if (config.storageDriver === 'mysql' && config.mysql) {
    mysqlConn = new MysqlConnection({ ...config.mysql, logger: loggers.logger });
    await mysqlConn.ping();
    const mysqlUsers = new MysqlUserLinkService(new MysqlUserRepository(mysqlConn), store);
    await mysqlUsers.init();
    const mysqlSessions = new MysqlSessionStore(mysqlConn);
    await mysqlSessions.init();
    users = mysqlUsers;
    sessionStore = mysqlSessions;
    loggers.logger.info(
      {
        event: 'storage.driver',
        driver: 'mysql',
        database: config.mysql.database,
        host: config.mysql.host,
        port: config.mysql.port,
      },
      `账号域存储：MySQL ${config.mysql.database}@${config.mysql.host}:${config.mysql.port}`,
    );
  } else {
    users = new UserLinkService(store);
    sessionStore = new SessionStore(store);
  }
  // 024：登录鉴权（会话登记 + 登录编排）
  const auth = new AuthService(users, sessionStore, {
    secret: config.authSecret,
    ttlSeconds: config.authTokenTtlSeconds,
  });

  // ---- 028 阶段 2/3：账号域第三块（服务目录 / 注册链接 / 授权）按同一驱动装配 ----
  let accountStore: AccountStorePort;
  if (config.storageDriver === 'mysql' && config.mysql && mysqlConn) {
    accountStore = new MysqlAccountStore(mysqlConn);
  } else {
    accountStore = new FileAccountStore(store);
  }
  await accountStore.init();
  const agentServices = new AgentServiceCatalog(accountStore, users);
  const registerLinks = new RegisterLinkService(accountStore, {
    defaultTtlSeconds:
      config.registerLinkTtlSeconds === 0 ? null : config.registerLinkTtlSeconds,
    publicBaseUrl: config.registerLinkPublicBaseUrl,
  });
  const registration = new RegistrationService(users, registerLinks, loggers.logger);
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

  /** 引用某 MCP 服务的「用户 × 数字人」对（§3.2/§3.3 的影响面） */
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
    agentServices,
    registerLinks,
    registration,
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
   * 于是"谁删了数字人""谁删了 MCP 服务""谁改了调用地址"在日志里查不到。
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

  // 030：鉴权钩子必须先于路由注册——白名单之外一律要求登录，管理类端点再要求管理员。
  const adminGuard = options.adminGuard ?? createAdminGuard(ctx);
  app.addHook('onRequest', async (req) => {
    await adminGuard(req);
  });

  // pino Logger 与 FastifyBaseLogger 的泛型差异对路由注册无实质影响
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
  // 028：账号与数字人服务绑定（注册链接 / 服务目录）；授权已并入 users.agents（2026-11-27）
  registerAgentServiceRoutes(routeApp, ctx);
  registerRegisterLinkRoutes(routeApp, ctx);
  // 024：登录鉴权（login/me/logout/session/valid；028 扩展 register 与 my-agents）
  registerAuthRoutes(routeApp, ctx);

  app.addHook('onClose', async () => {
    // 028：mysql 驱动时关闭连接池（file 驱动无资源需要释放）
    if (mysqlConn) await mysqlConn.close();
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
  main().catch((err: unknown) => {
    // 启动期失败必须是"能照着做"的提示：库模式缺配置或库不可达时，进程直接退出不半启动
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[admin-backend] 启动失败：${message}`);
    if (/STORAGE_DRIVER=mysql|MYSQL_|账号库/.test(message)) {
      console.error('[admin-backend] 账号库模式三步：npm run db:up → npm run db:init → npm run dev');
    }
    process.exit(1);
  });
}
