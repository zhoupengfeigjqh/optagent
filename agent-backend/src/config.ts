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
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPT_AGENT_ROOT: z.string().min(1).default('.opt-agent'),
  POOL_SIZE: z.coerce.number().int().min(1).max(32).default(5),
  IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(1_800_000),
  /** 单次 MCP 工具调用超时（毫秒）；同步型算法工具（如 hd_scheduling_submit）依赖此上限，勿再调小 */
  MCP_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  /**
   * 单个 MCP 服务的**建连**超时（毫秒，2026-10-18）。
   *
   * 与 `MCP_TIMEOUT_MS` 刻意分开：后者是工具调用上限（默认 60s，算法类工具需要），
   * 拿它做建连超时会让"服务挂起"时的等待长达一分钟——而建连期用户正在等首条消息。
   * 超时即判该服务 failed（有连接结果、不再是 unknown），并交给既有退避重连接管。
   */
  MCP_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(10_000),
  /**
   * 单文件上传上限（MB）：全项目统一 5MB（文件空间上传、SKILL ZIP 导入同一约束）。
   * 改这里时 MUST 同步改：admin-backend/src/config.ts 的同名项、
   * gateway/nginx.conf 的 client_max_body_size（= 此值 + 1MB multipart 余量，否则 5MB 文件传不上）。
   */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(5),
  /**
   * 内联预览大小上限（MB）。**防御性上限**：文件进入文件空间的每条路径（上传 / 产出回写 /
   * 模型 `write_file`）都被 `UPLOAD_MAX_MB` 卡在 5MB，故实际不存在超过它的文件，
   * 413 分支当前恒不触发（`routes/files.ts` / `routes/produced.ts`）；取值与上传上限对齐，保留兜底。
   */
  PREVIEW_MAX_MB: z.coerce.number().int().min(1).default(5),
  READ_TRUNCATE_KB: z.coerce.number().int().min(1).default(128),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
  /**
   * LLM 调用的**重试次数**（首次调用不计；`0` = 不重试）。
   *
   * 由 pi-ai 既有的 `retryProviderRequest` 执行（指数退避 + 抖动 / `x-should-retry` 优先 /
   * 尊重 `Retry-After` / 睡眠可被 AbortSignal 打断），运行环境**不自建**退避实现。
   * 契约：`contracts/runtime-api-delta.md` §19.1（默认 2 ⇒ 单轮总尝试 ≤ 3）。
   */
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * 单次重试的**等待上限**（毫秒）：上游要求的退避超过它即立即失败，不静默长等
   * （`0` = 不设上限，与 pi-ai 的 `maxRetryDelayMs` 同义）。
   */
  LLM_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(15_000),
  /** MCP 签名直链的对外基址（MCP 服务回源下载用；**必填**，由 loadConfig 显式校验并给出可读报错） */
  PUBLIC_BASE_URL: z.string().url().optional(),
  /** 签名直链 HMAC 密钥（≥16 字符；缺省启动时随机生成——重启后未过期 URL 失效） */
  FILE_SIGN_SECRET: z.string().min(16).optional(),
  /**
   * 013：意图聚焦判定阈值（0~1）。设置后**覆盖** `config.yaml` 的 `intent_focus.threshold`。
   *
   * 为什么允许双源：工具数量与问法差异会让概率分布整体偏移，阈值是最需要现场调的参数；
   * 容器部署时可只改环境变量、不必改挂载的配置文件。越界即启动失败（不静默收敛）。
   *
   * **空串 = 未设置**：`.env` 里写了 `INTENT_FOCUS_THRESHOLD=` 很常见（模板没删干净），
   * 而 `z.coerce.number()` 会把 `''` 变成 `0` —— 阈值 0 意味着**所有工具都入选**，
   * 症状是"回答突然变慢、什么工具都被拉着用"，却没有任何报错。宁可回落到配置文件。
   */
  INTENT_FOCUS_THRESHOLD: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().min(0).max(1).optional(),
  ),
});

const modelEntrySchema = z.object({
  model: z.string().min(1),
  api_key: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
});

/**
 * 013：意图聚焦判定模型（Laya）的参数区间与缺省值。
 *
 * **单处定义**（与 `contracts/intent-focus-api.md §5.1` 同口径）：取值区间既要用于
 * 启动校验，也要出现在报错文案与示例文件里——三处各写一份，迟早会漂移。
 */
export const INTENT_FOCUS_LIMITS = {
  /**
   * 单次判定超时（毫秒）：低于下限会被冷启动/长题面误伤；
   * 上限 10s 是因为 `noul` 按批发送——32 题一批约 1.8~2.2s，最多 3 批仍在预算内。
   */
  timeoutMsMin: 300,
  timeoutMsMax: 10_000,
  /** 分数阈值 */
  thresholdMin: 0,
  thresholdMax: 1,
} as const;

/**
 * 013：可省略字段的缺省值（缺省即"照默认跑"，不是"功能关闭"）。
 *
 * `threshold` 与 `domain/intent-focus.ts` 的 `DEFAULT_THRESHOLD` 同口径：0.6 是
 * 2026-10-26 命题改版（任务式问法 + 极简判据）后重新标定的拐点——0.5 下平均每轮
 * 入选 2.4 个工具且噪声大，0.6 压到 1.2 个而召回不变。
 */
export const INTENT_FOCUS_DEFAULTS = {
  model: 'laya-multilingual',
  timeoutMs: 10_000,
  threshold: 0.6,
} as const;

/**
 * 013：意图聚焦判定模型（Laya）的可选配置块。
 *
 * 整块缺失 = 功能不可用（fail-closed），**不影响启动**；块存在但字段不全/越界 = 启动失败——
 * 半配置最容易被误读成"运行期故障"，不如启动时就报出来。
 *
 * 这里只用 `z.unknown()` 兜住形状，**类型与区间一律在 `resolveIntentFocus` 里校验**：
 * zod 的默认报错是 `[{ code: 'too_small', ... }]` 这样的结构体，管理员看不懂，
 * 而这些参数恰恰最需要"一眼知道该填什么"。`strict()` 保证拼错键（`timeout` / `max_action`）
 * 立刻报错，而不是被静默忽略后跑默认值。
 */
const intentFocusYamlSchema = z
  .object({
    base_url: z.unknown(),
    model: z.unknown().optional(),
    api_key: z.unknown(),
    timeout_ms: z.unknown().optional(),
    threshold: z.unknown().optional(),
  })
  .strict();

const yamlSchema = z.object({
  models: z.array(modelEntrySchema).min(1, 'config.yaml 的 models 列表缺失或为空，拒绝启动'),
  intent_focus: intentFocusYamlSchema.optional(),
});

export interface ModelEntry {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * LLM 调用的**有界重试**参数（直接作为 pi-ai `StreamOptions` 的 `maxRetries` /
 * `maxRetryDelayMs` 传给 `streamSimple`；运行环境不自建退避实现）。
 *
 * 契约：`contracts/runtime-api-delta.md` §19.1。
 */
export interface LlmRetryOptions {
  /** 重试次数（首次调用不计；0 = 不重试） */
  maxRetries: number;
  /** 单次重试等待上限（毫秒；0 = 不设上限，与 pi-ai 语义一致） */
  maxRetryDelayMs: number;
}

/**
 * 013：意图聚焦判定模型的接入参数（装配后冻结）。
 *
 * 六个字段与 `contracts/intent-focus-api.md §5.1` 一一对应；除 `threshold` 外**只有一个来源**
 * （`config.yaml` 的 `intent_focus` 块），避免"改了 A 没改 B"的错配。
 *
 * `threshold` 的取值来源优先级：环境变量 `INTENT_FOCUS_THRESHOLD` > `config.yaml` > 0.5。
 */
export interface IntentFocusConfig {
  /** 形如 `http://laya:8000`（只到主机端口，不要带 `/v1`；请求路径由客户端拼） */
  baseUrl: string;
  /** `/v1/systemone` 请求体里的 `model`，需与 `GET /v1/models` 返回的标识一致 */
  model: string;
  /** Laya 容器 `DECIS_API_KEY` 同值 */
  apiKey: string;
  /** 整轮判定总预算（毫秒）：分批时按批数均分，到时即降级，**不重试** */
  timeoutMs: number;
  /** 入选分数阈值（0~1）。`noul` 分数不是归一化概率，故按绝对分数筛选 */
  threshold: number;
}

export interface AppConfig {
  port: number;
  /** 运行数据根目录（绝对路径） */
  optAgentRoot: string;
  poolSize: number;
  idleTimeoutMs: number;
  mcpTimeoutMs: number;
  /** 单服务建连超时（毫秒）；超时判 failed，由退避重连接管 */
  mcpConnectTimeoutMs: number;
  uploadMaxMb: number;
  /** 内联预览大小上限（MB） */
  previewMaxMb: number;
  readTruncateKb: number;
  shutdownGraceMs: number;
  /** LLM 调用的有界重试参数（唯一表示；不要另存两个标量，避免两份口径） */
  llmRetry: LlmRetryOptions;
  /** MCP 签名直链对外基址 */
  publicBaseUrl: string;
  /** 签名直链 HMAC 密钥 */
  fileSignSecret: string;
  models: readonly ModelEntry[];
  /** 默认模型 = models 第一项 */
  defaultModel: ModelEntry;
  /** 013：意图聚焦判定模型；缺省 = 该功能不可用（不判定、不追加聚焦提示） */
  intentFocus?: IntentFocusConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type EnvSource = Record<string, string | undefined>;

/**
 * `$VAR` 形式的值 → 环境变量实值（`config.yaml` 的密钥统一走这一条通道）。
 *
 * 空串按"未设置"处理：`.env` 里留一个空键（`DECIS_API_KEY=`）是常见做法，
 * 若当成有效值，运行期会变成 401 而不是"配置缺失"，最费时间。
 */
function resolveEnvRef(raw: string, env: EnvSource, label: string): string {
  if (!raw.startsWith('$')) return raw;
  const name = raw.slice(1);
  if (name === '') throw new ConfigError(`${label} 的 $ENV 引用缺少变量名（当前 "${raw}"）`);
  const value = env[name];
  if (!value) {
    throw new ConfigError(`config.yaml 的 ${label} 引用的环境变量 $${name} 未设置或为空`);
  }
  return value;
}

/** 解析 api_key：字面量直接使用；`$VAR` 形式引用环境变量；未配置走兜底 */
function resolveApiKey(entry: z.infer<typeof modelEntrySchema>, env: EnvSource): string {
  const raw = entry.api_key;
  if (raw) return resolveEnvRef(raw, env, `模型 ${entry.model} 的 api_key`);
  const fallback = env.DEEPSEEK_API_KEY;
  if (!fallback) {
    throw new ConfigError(`模型 ${entry.model} 未配置 api_key，且 DEEPSEEK_API_KEY 兜底为空`);
  }
  return fallback;
}

/** 必填文本项（去首尾空白后不得为空）；报错指名 YAML 路径 */
function readRequiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${label} 必填且不能为空（当前：${describe(value)}）`);
  }
  return value.trim();
}

/** 可选文本项：缺省取 fallback；给了但类型不对 → 拒绝（不静默当缺省） */
function readOptionalText(value: unknown, label: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${label} 须为非空字符串（当前：${describe(value)}）`);
  }
  return value.trim();
}

/** 整数项：缺省取 fallback；非整数 / 越界 → 拒绝，并在报错里写清区间与当前值 */
function readIntInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
  fallback: number,
  unit = '',
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${label} 须为 ${min}~${max} 的整数${unit}（当前：${describe(value)}）`);
  }
  return parsed;
}

/** 比例项（0~1）：缺省取 fallback；越界 / 非数字 → 拒绝 */
function readRatio(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isFinite(parsed) ||
    parsed < INTENT_FOCUS_LIMITS.thresholdMin ||
    parsed > INTENT_FOCUS_LIMITS.thresholdMax
  ) {
    throw new ConfigError(
      `${label} 须为 ${INTENT_FOCUS_LIMITS.thresholdMin}~${INTENT_FOCUS_LIMITS.thresholdMax} 的数值（当前：${describe(value)}）`,
    );
  }
  return parsed;
}

/** 报错文案里的"当前值"：字符串加引号，其余走 JSON，`undefined` 显示缺省 */
function describe(value: unknown): string {
  if (value === undefined) return '未填写';
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

/**
 * 013：解析 `intent_focus` 块。
 *
 * - 整块缺失 → `undefined`（功能不可用，不报错）；
 * - `api_key` 仅支持字面量或 `$ENV` 引用，**不**回落到 `DEEPSEEK_API_KEY`
 *   （落到主模型密钥会表现为 401，而不是"未配置"，极难定位）；
 * - `base_url` 必须是 http(s) 绝对地址（`laya:8000` 这类在 WHATWG 解析下"合法"但不可用）；
 * - `threshold` 环境变量优先（唯一允许双源的参数）；但配置文件里的取值**照样校验**——
 *   留着越界值不报错，下次撤掉环境变量就会静默生效。
 */
function resolveIntentFocus(
  entry: z.infer<typeof intentFocusYamlSchema> | undefined,
  env: EnvSource,
  envThreshold: number | undefined,
): IntentFocusConfig | undefined {
  if (!entry) return undefined;

  const baseUrl = readRequiredText(entry.base_url, 'intent_focus.base_url').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new ConfigError(
      `intent_focus.base_url 必须以 http:// 或 https:// 开头（当前 "${baseUrl}"）`,
    );
  }
  // 只校验协议头不够：`http://laya:8000/v1` 拼出来是 `/v1/v1/systemone`，404 后才被发现
  if (new URL(baseUrl).pathname !== '/') {
    throw new ConfigError(
      `intent_focus.base_url 只填到主机端口，不要带路径（请求路径由客户端拼 /v1/systemone；当前 "${baseUrl}"）`,
    );
  }

  const model = readOptionalText(entry.model, 'intent_focus.model', INTENT_FOCUS_DEFAULTS.model);
  const apiKey = resolveEnvRef(
    readRequiredText(entry.api_key, 'intent_focus.api_key'),
    env,
    'intent_focus.api_key',
  );
  const timeoutMs = readIntInRange(
    entry.timeout_ms,
    'intent_focus.timeout_ms',
    INTENT_FOCUS_LIMITS.timeoutMsMin,
    INTENT_FOCUS_LIMITS.timeoutMsMax,
    INTENT_FOCUS_DEFAULTS.timeoutMs,
    '（毫秒）',
  );
  const yamlThreshold = readRatio(
    entry.threshold,
    'intent_focus.threshold',
    INTENT_FOCUS_DEFAULTS.threshold,
  );

  return Object.freeze({
    baseUrl,
    model,
    apiKey,
    timeoutMs,
    threshold: envThreshold ?? yamlThreshold,
  });
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

  // 013：意图聚焦判定模型（可选块；缺失即功能不可用）
  const intentFocus = resolveIntentFocus(
    yamlParsed.data.intent_focus,
    env,
    e.INTENT_FOCUS_THRESHOLD,
  );

  // 签名直链的对外基址与部署形态强相关，必须显式声明：
  // 兜底成 localhost 时容器间的 MCP 服务（如 OCR）会回源打到它自己，
  // 且不会启动失败，只在运行期表现为"下载失败"，极难定位。
  const publicBaseUrl = e.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    throw new ConfigError(
      '缺少必填环境变量 PUBLIC_BASE_URL（MCP 服务回源下载的对外基址，容器内应为 http://backend:3000）',
    );
  }
  // 仅 url() 不够：`backend:3000` 之类的值在 WHATWG 解析下也算合法 URL（scheme=backend），
  // 但铸出的直链不可用——MCP 服务是按 http(s) 回源的。
  if (!/^https?:\/\//.test(publicBaseUrl)) {
    throw new ConfigError(
      `PUBLIC_BASE_URL 必须以 http:// 或 https:// 开头（当前 "${publicBaseUrl}"）`,
    );
  }

  const config: AppConfig = {
    port: e.PORT,
    optAgentRoot: path.resolve(process.cwd(), e.OPT_AGENT_ROOT),
    poolSize: e.POOL_SIZE,
    idleTimeoutMs: e.IDLE_TIMEOUT_MS,
    mcpTimeoutMs: e.MCP_TIMEOUT_MS,
    mcpConnectTimeoutMs: e.MCP_CONNECT_TIMEOUT_MS,
    uploadMaxMb: e.UPLOAD_MAX_MB,
    previewMaxMb: e.PREVIEW_MAX_MB,
    readTruncateKb: e.READ_TRUNCATE_KB,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
    llmRetry: { maxRetries: e.LLM_MAX_RETRIES, maxRetryDelayMs: e.LLM_RETRY_MAX_DELAY_MS },
    publicBaseUrl,
    fileSignSecret: e.FILE_SIGN_SECRET ?? randomBytes(32).toString('hex'),
    models,
    defaultModel: models[0]!,
    ...(intentFocus ? { intentFocus } : {}),
  };
  return Object.freeze(config);
}
