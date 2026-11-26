import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PLATFORM_DATA_DIR: z.string().min(1),
  OPT_AGENT_ROOT: z.string().min(1),
  /**
   * 运行环境（agent-backend）只读端点基址（`GET /api/builtin-tools`、`GET /api/mcp-call-stats`）。
   * 平台是独立服务，故必须显式声明运行环境位置（`plan.md` R2/R4）。
   * 仅用于运行观测的只读采集（`RuntimeClient`），不承载配置数据流。
   */
  OPT_AGENT_BACKEND_URL: z.string().min(1).default('http://127.0.0.1:3000'),
  /** 运行环境只读端点超时（毫秒） */
  RUNTIME_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  /** MCP 客户端超时（毫秒） */
  MCP_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  ONTO_MARKET_DIR: z.string().min(1).optional(),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(5),
  LOG_LEVEL: z.string().default('info'),
  /**
   * 024：登录凭据签名密钥（`AUTH_SECRET`，≥16 字符）。
   * 必须与运行环境（agent-backend）同值；缺失即拒绝启动（签发方不能静默失败）。
   */
  AUTH_SECRET: z.string().min(16),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(604_800),
});

export interface AppConfig {
  port: number;
  platformDataDir: string;
  optAgentRoot: string;
  optAgentBackendUrl: string;
  runtimeTimeoutMs: number;
  mcpTimeoutMs: number;
  uploadMaxMb: number;
  /** 本体市场根目录（绝对路径）；未配置为 null = 导入功能不可用 */
  ontoMarketDir: string | null;
  logLevel: string;
  authSecret: string;
  authTokenTtlSeconds: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
      .join('；');
    throw new ConfigError(
      `管理服务环境变量校验失败 → ${missing}。` +
        '必填：PLATFORM_DATA_DIR / OPT_AGENT_ROOT（见 docker-compose.yml 的 admin-backend 服务）。',
    );
  }

  const e = parsed.data;
  const config: AppConfig = {
    port: e.PORT,
    platformDataDir: path.resolve(cwd, e.PLATFORM_DATA_DIR),
    optAgentRoot: path.resolve(cwd, e.OPT_AGENT_ROOT),
    optAgentBackendUrl: e.OPT_AGENT_BACKEND_URL.replace(/\/+$/, ''),
    runtimeTimeoutMs: e.RUNTIME_TIMEOUT_MS,
    mcpTimeoutMs: e.MCP_TIMEOUT_MS,
    uploadMaxMb: e.UPLOAD_MAX_MB,
    ontoMarketDir: e.ONTO_MARKET_DIR ? path.resolve(cwd, e.ONTO_MARKET_DIR) : null,
    logLevel: e.LOG_LEVEL,
    authSecret: e.AUTH_SECRET,
    authTokenTtlSeconds: e.AUTH_TOKEN_TTL_SECONDS,
  };
  return Object.freeze(config);
}
