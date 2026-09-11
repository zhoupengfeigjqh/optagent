/**
 * 配置模块（唯一读取 process.env 的地方）。
 *
 * 双源：
 * - .env：运行参数 + DEEPSEEK_API_KEY 兜底（经 node --env-file 注入 process.env）
 * - config.yaml：models 列表（model / api_key / base_url，默认模型 = 第一项）
 *
 * 合并规则：条目 api_key 优先（支持 `$ENV_VAR` 引用），未填时 DEEPSEEK_API_KEY 兜底；
 * models 缺失或为空即拒启动。全部经 zod 校验后导出冻结对象。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPT_AGENT_ROOT: z.string().min(1).default('.opt-agent'),
  POOL_SIZE: z.coerce.number().int().min(1).max(32).default(5),
  IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(600_000),
  MCP_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(50),
  PREVIEW_MAX_MB: z.coerce.number().int().min(1).default(10),
  READ_TRUNCATE_KB: z.coerce.number().int().min(1).default(32),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
});

const modelEntrySchema = z.object({
  model: z.string().min(1),
  api_key: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
});

const yamlSchema = z.object({
  models: z.array(modelEntrySchema).min(1, 'config.yaml 的 models 列表缺失或为空，拒绝启动'),
});

export interface ModelEntry {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface AppConfig {
  port: number;
  /** 运行数据根目录（绝对路径） */
  optAgentRoot: string;
  poolSize: number;
  idleTimeoutMs: number;
  mcpTimeoutMs: number;
  uploadMaxMb: number;
  /** 内联预览大小上限（MB） */
  previewMaxMb: number;
  readTruncateKb: number;
  shutdownGraceMs: number;
  models: readonly ModelEntry[];
  /** 默认模型 = models 第一项 */
  defaultModel: ModelEntry;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type EnvSource = Record<string, string | undefined>;

/** 解析 api_key：字面量直接使用；`$VAR` 形式引用环境变量；未配置走兜底 */
function resolveApiKey(entry: z.infer<typeof modelEntrySchema>, env: EnvSource): string {
  const raw = entry.api_key;
  if (raw) {
    if (raw.startsWith('$')) {
      const fromEnv = env[raw.slice(1)];
      if (!fromEnv) throw new ConfigError(`config.yaml 引用的环境变量 ${raw} 未设置`);
      return fromEnv;
    }
    return raw;
  }
  const fallback = env.DEEPSEEK_API_KEY;
  if (!fallback) {
    throw new ConfigError(`模型 ${entry.model} 未配置 api_key，且 DEEPSEEK_API_KEY 兜底为空`);
  }
  return fallback;
}

export interface LoadConfigOptions {
  /** 默认取 process.env；测试可注入 */
  env?: EnvSource;
  /** config.yaml 路径，默认取 cwd 下 config.yaml */
  configPath?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.resolve(process.cwd(), 'config.yaml');

  const envParsed = envSchema.safeParse(env);
  if (!envParsed.success) {
    throw new ConfigError(`.env 运行参数校验失败: ${envParsed.error.message}`);
  }

  let yamlText: string;
  try {
    yamlText = readFileSync(configPath, 'utf8');
  } catch {
    throw new ConfigError(`无法读取模型配置文件 ${configPath}`);
  }
  let yamlData: unknown;
  try {
    yamlData = parseYaml(yamlText);
  } catch (err) {
    throw new ConfigError(`config.yaml 解析失败: ${(err as Error).message}`);
  }
  const yamlParsed = yamlSchema.safeParse(yamlData ?? {});
  if (!yamlParsed.success) {
    throw new ConfigError(`config.yaml 校验失败: ${yamlParsed.error.message}`);
  }

  const models: ModelEntry[] = yamlParsed.data.models.map((m) => {
    const entry: ModelEntry = { model: m.model, apiKey: resolveApiKey(m, env) };
    if (m.base_url) entry.baseUrl = m.base_url;
    return entry;
  });

  const e = envParsed.data;
  const config: AppConfig = {
    port: e.PORT,
    optAgentRoot: path.resolve(process.cwd(), e.OPT_AGENT_ROOT),
    poolSize: e.POOL_SIZE,
    idleTimeoutMs: e.IDLE_TIMEOUT_MS,
    mcpTimeoutMs: e.MCP_TIMEOUT_MS,
    uploadMaxMb: e.UPLOAD_MAX_MB,
    previewMaxMb: e.PREVIEW_MAX_MB,
    readTruncateKb: e.READ_TRUNCATE_KB,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
    models,
    defaultModel: models[0]!,
  };
  return Object.freeze(config);
}
