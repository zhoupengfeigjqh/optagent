/**
 * 配置模块（**唯一**读取 `process.env` 的地方）。
 *
 * 全部经 zod 校验后导出冻结对象；缺必填项即拒启动并给出**可读报错**，
 * 而不是在运行期表现为某个接口静默失败。
 *
 * **2026-09-27**：`COMPOSE_FILE_PATH` / `DOCKER_SOCKET_PATH` 随
 * 「MCP 服务全人工配置」一并移除——平台不再读容器编排声明，也不再读
 * Docker 容器状态（`.env*` 里遗留的同名变量被忽略，不影响启动）。
 */
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  // 与本地形态/容器形态统一口径 3001（2026-09-20）：避开 agent-backend 的 3000；
  // admin-frontend 的 vite proxy 与本服务两边都按 3001 约定
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** 平台设计态根目录（bind mount；不进镜像） */
  PLATFORM_DATA_DIR: z.string().min(1),
  /** 运行环境用户数据根（`.opt-agent`），与运行环境共享同一份（`FR-001`） */
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
  /**
   * 本体市场根目录（optonto 的 `.data/onto_market`，平台侧**只读**；2026-10-02）。
   *
   * 配置后 SKILL 管理可从市场目录直接导入技能（`/api/admin/skills/onto-market*`）；
   * 缺省 = 该功能不可用（列表返回 `configured: false`，导入给出可读报错），不影响启动。
   * 本地形态：`../optonto/.data/onto_market`；容器形态：只读挂载点 `/opt/onto_market`。
   */
  ONTO_MARKET_DIR: z.string().min(1).optional(),
  /**
   * SKILL ZIP 上传大小上限（MB）：全项目统一 5MB（与 agent-backend 文件上传同一约束）。
   * 改这里时 MUST 同步改：agent-backend/src/config.ts 的同名项、
   * gateway/nginx.conf 的 client_max_body_size（= 此值 + 1MB multipart 余量，否则 5MB 包传不上）。
   */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(5),
  /** 平台容器是否可管理：缺省仅在容器内可用；测试可注入 */
  LOG_LEVEL: z.string().default('info'),
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
  };
  return Object.freeze(config);
}
