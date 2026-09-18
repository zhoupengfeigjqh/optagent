/**
 * 配置模块（**唯一**读取 `process.env` 的地方）。
 *
 * 全部经 zod 校验后导出冻结对象；缺必填项即拒启动并给出**可读报错**，
 * 而不是在运行期表现为某个接口静默失败。
 *
 * 之所以把 `COMPOSE_FILE_PATH` / `DOCKER_SOCKET_PATH` 做成显式配置而非写死：
 * 这两项决定平台能否读到"应该有什么"（编排声明）与"实际是什么"（容器状态），
 * 正是 `FR-043` / `FR-052` 的判定依据，配错了必须启动即暴露。
 */
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** 平台设计态根目录（bind mount；不进镜像） */
  PLATFORM_DATA_DIR: z.string().min(1),
  /** 运行环境用户数据根（`.opt-agent`），与运行环境共享同一份（`FR-001`） */
  OPT_AGENT_ROOT: z.string().min(1),
  /** 容器编排文件路径（只读投影，`FR-043`） */
  COMPOSE_FILE_PATH: z.string().min(1),
  /** Docker Engine socket（容器状态/日志/启停，`research.md` D3） */
  DOCKER_SOCKET_PATH: z.string().min(1).default('/var/run/docker.sock'),
  /**
   * 运行环境（agent-backend）只读端点基址（`GET /api/builtin-tools`、`GET /api/mcp-call-stats`）。
   * 平台是独立服务，故必须显式声明运行环境位置（`plan.md` R2/R4）。
   * 仅用于运行观测的只读采集（`RuntimeClient`），不承载配置数据流。
   */
  OPT_AGENT_BACKEND_URL: z.string().min(1).default('http://127.0.0.1:3000'),
  /** 运行环境只读端点 / Docker socket 共用超时（毫秒） */
  RUNTIME_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  /** MCP 客户端超时（毫秒） */
  MCP_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  /** SKILL ZIP 上传大小上限（MB）：全项目统一 5MB（与 agent-backend 文件上传同一约束） */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(5),
  /** 平台容器是否可管理：缺省仅在容器内可用；测试可注入 */
  LOG_LEVEL: z.string().default('info'),
});

export interface AppConfig {
  port: number;
  platformDataDir: string;
  optAgentRoot: string;
  composeFilePath: string;
  dockerSocketPath: string;
  optAgentBackendUrl: string;
  runtimeTimeoutMs: number;
  mcpTimeoutMs: number;
  uploadMaxMb: number;
  logLevel: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /** 默认取 `process.env`；测试可注入 */
  env?: Record<string, string | undefined>;
  /** 相对路径的解析基准，默认 `process.cwd()` */
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
        '必填：PLATFORM_DATA_DIR / OPT_AGENT_ROOT / COMPOSE_FILE_PATH（见 docker-compose.yml 的 admin-backend 服务）。',
    );
  }

  const e = parsed.data;
  const config: AppConfig = {
    port: e.PORT,
    platformDataDir: path.resolve(cwd, e.PLATFORM_DATA_DIR),
    optAgentRoot: path.resolve(cwd, e.OPT_AGENT_ROOT),
    composeFilePath: path.resolve(cwd, e.COMPOSE_FILE_PATH),
    dockerSocketPath: e.DOCKER_SOCKET_PATH,
    optAgentBackendUrl: e.OPT_AGENT_BACKEND_URL.replace(/\/+$/, ''),
    runtimeTimeoutMs: e.RUNTIME_TIMEOUT_MS,
    mcpTimeoutMs: e.MCP_TIMEOUT_MS,
    uploadMaxMb: e.UPLOAD_MAX_MB,
    logLevel: e.LOG_LEVEL,
  };
  return Object.freeze(config);
}
