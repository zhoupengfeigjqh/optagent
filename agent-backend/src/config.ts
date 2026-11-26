import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PREVIEW_MAX_MB, READ_TRUNCATE_KB, UPLOAD_MAX_MB } from './domain/limits.js';
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from './domain/plan/types.js';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPT_AGENT_ROOT: z.string().min(1).default('.opt-agent'),
  /**
   * 024：登录凭据验签密钥（**可选**）。与 admin-backend 同值。
   * 缺省 = 鉴权未启用，运行环境回退 legacy 单用户（可回滚，`research.md` D9）。
   */
  AUTH_SECRET: z.string().min(16).optional(),
  ADMIN_BACKEND_URL: z.string().min(1).default('http://127.0.0.1:3001'),
  POOL_SIZE: z.coerce.number().int().min(1).max(32).default(5),
  IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(1_800_000),
  // 2026-11-26：UPLOAD_MAX_MB / PREVIEW_MAX_MB / READ_TRUNCATE_KB 降为代码常量
  // （跨服务契约与工具语义，见 `domain/limits.ts`），不再接受环境变量。
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
  // 2026-11-26：MCP_TIMEOUT_MS / MCP_CONNECT_TIMEOUT_MS / LLM_MAX_RETRIES /
  // LLM_RETRY_MAX_DELAY_MS 迁入 config.yaml 的 `runtime` 块（业务口径，不是机器属性）。
  PUBLIC_BASE_URL: z.string().url().optional(),
  FILE_SIGN_SECRET: z.string().min(16).optional(),
  /**
   * 2026-11-26 配置收敛：`INTENT_FOCUS_*_THRESHOLD`（skill / ontology_behavior /
   * ontology_function / rewrite / plan）已删除。
   *
   * 阈值属于业务口径（"判多严"），只认 `config.yaml`；同名环境变量曾与之构成双真源，
   * 出现"改了 yaml 没生效"的排查困境。见 `specs/028-task-planning/spec.md` v0.20。
   */
  /**
   * 意图聚焦（laya）凭据，由 `config.yaml` 的 `intent_focus.api_key: $DECIS_API_KEY` 引用。
   *
   * 在此声明不是为了让校验变严（`intent_focus` 整块本就是可选的），而是把它纳入
   * "env 参数清单"：拼错变量名时能立即看出；同时 `$VAR` 解析失败时错误信息仍指向 yaml 字段。
   */
  DECIS_API_KEY: z.string().min(1).optional(),
  /**
   * 意图聚焦地址，由 `config.yaml` 的 `intent_focus.base_url: $INTENT_FOCUS_BASE_URL` 引用。
   *
   * 声明在此有两个作用：纳入 env 清单（拼错即时可见）、让 `unknownEnvKeys` 不再把它当遗留键；
   * 真正的地址校验仍在 yaml 解析处（必须是 http(s) 且不带路径）。
   */
  INTENT_FOCUS_BASE_URL: z.string().min(1).optional(),
});

const modelEntrySchema = z.object({
  model: z.string().min(1),
  api_key: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
});

export const INTENT_FOCUS_LIMITS = {
  timeoutMsMin: 300,
  timeoutMsMax: 30_000,
  thresholdMin: 0,
  thresholdMax: 1,
  /** 单轮技能候选上限 */
  maxSkillsMin: 1,
  maxSkillsMax: 256,
  /**
   * 单轮行为候选上限。
   *
   * 上限 96 是**规格硬界**（FR-027），不是运维偏好：96 = 3 批 × 32，按 32 题
   * 约 1.8~2.2s 估算约 6~7s，即便整轮预算取 10s 也仍有余量；放宽到 256 会退化成
   * 8 批串行，大概率在最后几批超时降级，反而让配置项看起来"改大了却没效果"。
   */
  maxCapabilitiesMin: 1,
  maxCapabilitiesMax: 96,
  /**
   * 027：单次改写的超时区间（毫秒）。
   *
   * 下限 300 与判定批次的 `MIN_BATCH_TIMEOUT_MS` 同口径（再低会把正常前向计算误伤成超时）；
   * 上限 10s 是**单次改写**的绝对上限（一次非流式聚合调用，再长也不会有额外收益），
   * 与整轮预算解耦；校验时仍要求 `rewrite_timeout_ms <= timeout_ms`。
   */
  rewriteTimeoutMsMin: 300,
  rewriteTimeoutMsMax: 10_000,
  /**
   * 028：规划门禁单次判定超时（毫秒）。
   *
   * 门禁只判"一句话是否多步"，不需要长思考；下限与判定批次同口径（300ms），
   * 上限 10s 仅为防呆——正常取值 1~2s，实际还会被整轮预算再收紧。
   */
  planTimeoutMsMin: 300,
  planTimeoutMsMax: 10_000,
} as const;

/**
 * 013：可省略字段的缺省值（缺省即"照默认跑"，不是"功能关闭"）。
 *
 * 阈值缺省 **0.8**（2026-11 产品口径：技能与本体行为同阈值，两者是"本轮要不要用"
 * 的同一个判断）。阈值不在此收敛也不在 domain 层兜底：环境变量 / 配置文件越界
 * 一律启动失败，避免"写错却静默跑默认值"。
 */
export const INTENT_FOCUS_DEFAULTS = {
  model: 'laya-multilingual',
  /** 整轮聚焦预算，缺省 **30s**（2026-11-26 由 10s 提高：判定决定本轮提示词，宁可等也不降级） */
  timeoutMs: 30_000,
  skillThreshold: 0.8,
  ontologyBehaviorThreshold: 0.8,
  ontologyFunctionThreshold: 0.8,
  maxSkills: 32,
  maxCapabilities: 96,
  rewriteThreshold: 0.8,
  /** 027：单次改写超时，缺省 5s（受整轮预算约束，实际取 `min(该值, 剩余-100)`） */
  rewriteTimeoutMs: 5000,
  /**
   * 028：规划门禁阈值缺省 **0.4**（2026-11-26 产品口径）。
   *
   * 取向是"宁可多规划、不可漏规划"：漏判会让多 command 任务退化为直聊（乱序、漏前置），
   * 代价远大于多花一次规划调用；阈值只影响"值不值得规划"，不参与工具准入。
   */
  planThreshold: 0.4,
  /**
   * 028：门禁单次判定超时缺省 **5s**（2026-11-26 由 2s 提高：门禁与意图聚焦共用 laya，
   * 冷启动首包常在 2s 以上，2s 会把正常判定打成超时→fail-open，等于白花一次调用）。
   * 失败仍 fail-open（走规划），故放宽超时只是让判定更准，不增加最坏路径上的风险。
   */
  planTimeoutMs: 5000,
} as const;

/**
 * 2026-11-26：运行期策略缺省值（原 `MCP_TIMEOUT_MS` / `LLM_*` 环境变量）。
 *
 * `mcpTimeoutMs` 取 **90s**：算法类同步工具（如 `hd_scheduling_submit`）实测常在 60s 上下，
 * 之前由部署方在 env 里改到 90s，等于"每个部署点都要记得改"；现在作为口径写进 yaml 缺省。
 */
export const RUNTIME_DEFAULTS = {
  mcpTimeoutMs: 90_000,
  mcpConnectTimeoutMs: 10_000,
  llmMaxRetries: 2,
  llmRetryMaxDelayMs: 15_000,
} as const;

export const RUNTIME_LIMITS = {
  mcpTimeoutMsMin: 1_000,
  mcpTimeoutMsMax: 600_000,
  mcpConnectTimeoutMsMin: 1_000,
  mcpConnectTimeoutMsMax: 60_000,
  llmMaxRetriesMin: 0,
  llmMaxRetriesMax: 5,
  llmRetryMaxDelayMsMin: 0,
  llmRetryMaxDelayMsMax: 60_000,
} as const;

/** 028：`plan` 块区间（越界拒绝启动；上限取"再大也失去意义"的经验界） */
export const PLAN_LIMITS_BOUNDS = {
  timeoutMsMin: 1_000,
  timeoutMsMax: 600_000,
  totalStepsMaxMin: 1,
  totalStepsMaxMax: 100,
  replanMaxPerRunMin: 0,
  replanMaxPerRunMax: 50,
} as const;

const intentFocusYamlSchema = z
  .object({
    base_url: z.unknown(),
    model: z.unknown().optional(),
    api_key: z.unknown(),
    timeout_ms: z.unknown().optional(),
    skill_threshold: z.unknown().optional(),
    ontology_behavior_threshold: z.unknown().optional(),
    ontology_function_threshold: z.unknown().optional(),
    max_skills: z.unknown().optional(),
    max_capabilities: z.unknown().optional(),
    // 027：输入改写（指代判定阈值 / 单次改写超时）
    rewrite_threshold: z.unknown().optional(),
    rewrite_timeout_ms: z.unknown().optional(),
    // 028：规划门禁（阈值 / 单次判定超时）
    plan_threshold: z.unknown().optional(),
    plan_timeout_ms: z.unknown().optional(),
  })
  .strict();

/**
 * 2026-11-26：运行期策略（原 MCP_TIMEOUT_MS / LLM_* 环境变量）。
 *
 * 归 yaml 的理由：这些数随**工具语义**与**模型能力**变（算法类工具要 90s、换模型后重试预算
 * 要跟着变），不随机器快慢变；放 env 会让同一条指令在不同部署点得到不同结果。
 */
const runtimeYamlSchema = z
  .object({
    mcp_timeout_ms: z.unknown().optional(),
    mcp_connect_timeout_ms: z.unknown().optional(),
    llm_max_retries: z.unknown().optional(),
    llm_retry_max_delay_ms: z.unknown().optional(),
  })
  .strict();

/**
 * 028：规划上限（2026-11-26 由代码常量提升为 yaml 项）。
 *
 * 只开三个口子：超时、单轮总步数、失败重规划次数——它们随业务复杂度与模型能力变；
 * 其余 13 项规划常量是算法不变量，仍由 `domain/plan/types.ts` 钉死。
 */
const planYamlSchema = z
  .object({
    timeout_ms: z.unknown().optional(),
    total_steps_max: z.unknown().optional(),
    replan_max_per_run: z.unknown().optional(),
  })
  .strict();

const yamlSchema = z.object({
  models: z.array(modelEntrySchema).min(1, 'config.yaml 的 models 列表缺失或为空，拒绝启动'),
  intent_focus: intentFocusYamlSchema.optional(),
  runtime: runtimeYamlSchema.optional(),
  plan: planYamlSchema.optional(),
});

export interface ModelEntry {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface LlmRetryOptions {
  maxRetries: number;
  /** 单次重试等待上限（毫秒；0 = 不设上限，与 pi-ai 语义一致） */
  maxRetryDelayMs: number;
}

export interface IntentFocusConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 整轮判定总预算（毫秒）：分批时按批数均分，到时即降级，**不重试** */
  timeoutMs: number;
  skillThreshold: number;
  ontologyBehaviorThreshold: number;
  ontologyFunctionThreshold: number;
  /** 单轮技能候选上限 */
  maxSkills: number;
  /** 单轮**行为 + 函数**候选合计上限（键名保留以兼容存量配置） */
  maxCapabilities: number;
  rewriteThreshold: number;
  /**
   * 027：单次改写的超时上限（毫秒）。实际取值还会被阶段剩余预算进一步收紧
   * （`min(rewriteTimeoutMs, 剩余 - 100)`，剩余 < 300ms 直接放弃）。
   */
  rewriteTimeoutMs: number;
  /**
   * 028：规划门禁阈值。**未配置 = 门禁关闭**（开启规划即发起规划调用，行为与门禁前一致）。
   *
   * 分数 ≥ 该值才走规划；分数缺失/判定失败一律按"走规划"处理（fail-open）。
   */
  planThreshold?: number;
  /** 028：门禁单次判定超时（毫秒），受整轮预算进一步收紧 */
  planTimeoutMs: number;
}

export interface AppConfig {
  port: number;
  optAgentRoot: string;
  poolSize: number;
  idleTimeoutMs: number;
  mcpTimeoutMs: number;
  /** 单服务建连超时（毫秒）；超时判 failed，由退避重连接管 */
  mcpConnectTimeoutMs: number;
  /** 028：规划上限（`config.yaml` 的 `plan` 块）；装配层注入编排器 */
  planLimits: PlanLimits;
  uploadMaxMb: number;
  /** 内联预览大小上限（MB） */
  previewMaxMb: number;
  readTruncateKb: number;
  shutdownGraceMs: number;
  /** LLM 调用的有界重试参数（唯一表示；不要另存两个标量，避免两份口径） */
  llmRetry: LlmRetryOptions;
  publicBaseUrl: string;
  fileSignSecret: string;
  models: readonly ModelEntry[];
  defaultModel: ModelEntry;
  /** 013：意图聚焦判定模型；缺省 = 该功能不可用（不判定、不追加聚焦提示） */
  intentFocus?: IntentFocusConfig;
  /** 024：登录凭据验签密钥；缺省 = 鉴权未启用（回退 legacy 单用户） */
  authSecret?: string;
  adminBackendUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type EnvSource = Record<string, string | undefined>;

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

function describe(value: unknown): string {
  if (value === undefined) return '未填写';
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

/** `runtime` 块解析：越界一律拒绝启动，不静默兜底（与 intent_focus 同口径） */
function resolveRuntime(entry: z.infer<typeof runtimeYamlSchema> | undefined) {
  const e = entry ?? {};
  const mcpTimeoutMs = readIntInRange(
    e.mcp_timeout_ms,
    'runtime.mcp_timeout_ms',
    RUNTIME_LIMITS.mcpTimeoutMsMin,
    RUNTIME_LIMITS.mcpTimeoutMsMax,
    RUNTIME_DEFAULTS.mcpTimeoutMs,
    '（毫秒）',
  );
  const mcpConnectTimeoutMs = readIntInRange(
    e.mcp_connect_timeout_ms,
    'runtime.mcp_connect_timeout_ms',
    RUNTIME_LIMITS.mcpConnectTimeoutMsMin,
    RUNTIME_LIMITS.mcpConnectTimeoutMsMax,
    RUNTIME_DEFAULTS.mcpConnectTimeoutMs,
    '（毫秒）',
  );
  if (mcpConnectTimeoutMs > mcpTimeoutMs) {
    throw new ConfigError(
      `runtime.mcp_connect_timeout_ms 不得大于 mcp_timeout_ms（当前 ${mcpConnectTimeoutMs} > ${mcpTimeoutMs}）`,
    );
  }
  const llmMaxRetries = readIntInRange(
    e.llm_max_retries,
    'runtime.llm_max_retries',
    RUNTIME_LIMITS.llmMaxRetriesMin,
    RUNTIME_LIMITS.llmMaxRetriesMax,
    RUNTIME_DEFAULTS.llmMaxRetries,
  );
  const llmRetryMaxDelayMs = readIntInRange(
    e.llm_retry_max_delay_ms,
    'runtime.llm_retry_max_delay_ms',
    RUNTIME_LIMITS.llmRetryMaxDelayMsMin,
    RUNTIME_LIMITS.llmRetryMaxDelayMsMax,
    RUNTIME_DEFAULTS.llmRetryMaxDelayMs,
    '（毫秒）',
  );
  return { mcpTimeoutMs, mcpConnectTimeoutMs, llmMaxRetries, llmRetryMaxDelayMs };
}

/** 028：`plan` 块解析；缺键取 `DEFAULT_PLAN_LIMITS`（= 原代码常量） */
function resolvePlanLimits(entry: z.infer<typeof planYamlSchema> | undefined): PlanLimits {
  const e = entry ?? {};
  return {
    timeoutMs: readIntInRange(
      e.timeout_ms,
      'plan.timeout_ms',
      PLAN_LIMITS_BOUNDS.timeoutMsMin,
      PLAN_LIMITS_BOUNDS.timeoutMsMax,
      DEFAULT_PLAN_LIMITS.timeoutMs,
      '（毫秒）',
    ),
    totalStepsMax: readIntInRange(
      e.total_steps_max,
      'plan.total_steps_max',
      PLAN_LIMITS_BOUNDS.totalStepsMaxMin,
      PLAN_LIMITS_BOUNDS.totalStepsMaxMax,
      DEFAULT_PLAN_LIMITS.totalStepsMax,
    ),
    replanMaxPerRun: readIntInRange(
      e.replan_max_per_run,
      'plan.replan_max_per_run',
      PLAN_LIMITS_BOUNDS.replanMaxPerRunMin,
      PLAN_LIMITS_BOUNDS.replanMaxPerRunMax,
      DEFAULT_PLAN_LIMITS.replanMaxPerRun,
    ),
  };
}

function resolveIntentFocus(
  entry: z.infer<typeof intentFocusYamlSchema> | undefined,
  env: EnvSource,
): IntentFocusConfig | undefined {
  if (!entry) return undefined;

  // 2026-11-26：`base_url` 同样允许 `$VAR` 引用——本地是 127.0.0.1:8103，容器内是 laya:8000，
  // 两形态共用同一份 config.yaml，地址只能由 env 提供，否则容器内永远打到自己。
  const baseUrl = resolveEnvRef(
    readRequiredText(entry.base_url, 'intent_focus.base_url'),
    env,
    'intent_focus.base_url',
  ).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new ConfigError(
      `intent_focus.base_url 必须以 http:// 或 https:// 开头（当前 "${baseUrl}"）`,
    );
  }
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
  const yamlSkillThreshold = readRatio(
    entry.skill_threshold,
    'intent_focus.skill_threshold',
    INTENT_FOCUS_DEFAULTS.skillThreshold,
  );
  const yamlOntologyBehaviorThreshold = readRatio(
    entry.ontology_behavior_threshold,
    'intent_focus.ontology_behavior_threshold',
    INTENT_FOCUS_DEFAULTS.ontologyBehaviorThreshold,
  );
  const yamlOntologyFunctionThreshold = readRatio(
    entry.ontology_function_threshold,
    'intent_focus.ontology_function_threshold',
    INTENT_FOCUS_DEFAULTS.ontologyFunctionThreshold,
  );
  const maxSkills = readIntInRange(
    entry.max_skills,
    'intent_focus.max_skills',
    INTENT_FOCUS_LIMITS.maxSkillsMin,
    INTENT_FOCUS_LIMITS.maxSkillsMax,
    INTENT_FOCUS_DEFAULTS.maxSkills,
  );
  const maxCapabilities = readIntInRange(
    entry.max_capabilities,
    'intent_focus.max_capabilities',
    INTENT_FOCUS_LIMITS.maxCapabilitiesMin,
    INTENT_FOCUS_LIMITS.maxCapabilitiesMax,
    INTENT_FOCUS_DEFAULTS.maxCapabilities,
  );
  const yamlRewriteThreshold = readRatio(
    entry.rewrite_threshold,
    'intent_focus.rewrite_threshold',
    INTENT_FOCUS_DEFAULTS.rewriteThreshold,
  );
  // 5s 的缺省改写超时会直接让服务起不来；这不是用户写错配置，不该拒绝启动
  const rewriteTimeoutMs = readIntInRange(
    entry.rewrite_timeout_ms,
    'intent_focus.rewrite_timeout_ms',
    INTENT_FOCUS_LIMITS.rewriteTimeoutMsMin,
    INTENT_FOCUS_LIMITS.rewriteTimeoutMsMax,
    Math.min(INTENT_FOCUS_DEFAULTS.rewriteTimeoutMs, timeoutMs),
    '（毫秒）',
  );
  if (rewriteTimeoutMs > timeoutMs) {
    throw new ConfigError(
      `intent_focus.rewrite_timeout_ms 不得大于 timeout_ms（当前 ${rewriteTimeoutMs} > ${timeoutMs}）`,
    );
  }

  // 028：规划门禁（缺键 = 关闭；给了就必须在 0~1，不静默兜底）
  const planThreshold =
    entry.plan_threshold === undefined
      ? undefined
      : readRatio(
          entry.plan_threshold,
          'intent_focus.plan_threshold',
          INTENT_FOCUS_DEFAULTS.planThreshold,
        );
  const planTimeoutMs = readIntInRange(
    entry.plan_timeout_ms,
    'intent_focus.plan_timeout_ms',
    INTENT_FOCUS_LIMITS.planTimeoutMsMin,
    INTENT_FOCUS_LIMITS.planTimeoutMsMax,
    Math.min(INTENT_FOCUS_DEFAULTS.planTimeoutMs, timeoutMs),
    '（毫秒）',
  );
  if (planTimeoutMs > timeoutMs) {
    throw new ConfigError(
      `intent_focus.plan_timeout_ms 不得大于 timeout_ms（当前 ${planTimeoutMs} > ${timeoutMs}）`,
    );
  }

  return Object.freeze({
    baseUrl,
    model,
    apiKey,
    timeoutMs,
    skillThreshold: yamlSkillThreshold,
    ontologyBehaviorThreshold: yamlOntologyBehaviorThreshold,
    ontologyFunctionThreshold: yamlOntologyFunctionThreshold,
    maxSkills,
    maxCapabilities,
    rewriteThreshold: yamlRewriteThreshold,
    rewriteTimeoutMs,
    ...(planThreshold !== undefined ? { planThreshold } : {}),
    planTimeoutMs,
  });
}

export interface LoadConfigOptions {
  env?: EnvSource;
  configPath?: string;
}

/**
 * 2026-11-26：拼错的 env 键检测（只告警，不拒绝启动）。
 *
 * 用前缀白名单圈定"本服务参数"，避免把宿主环境里的 `PATH`、`HOME` 等误报；
 * 已删除的历史键（`INTENT_FOCUS_*_THRESHOLD`、`MCP_TIMEOUT_MS` 等）也会落进来，
 * 启动时提示"这行已经不起作用"，避免"改了没生效"式排查。
 */
export function unknownEnvKeys(env: EnvSource = process.env): string[] {
  const known = new Set(Object.keys(envSchema.shape));
  const suspect =
    /^(PORT|OPT_AGENT_ROOT|AUTH_SECRET|ADMIN_BACKEND_URL|POOL_SIZE|IDLE_TIMEOUT_MS|SHUTDOWN_GRACE_MS|PUBLIC_BASE_URL|FILE_SIGN_SECRET|DEEPSEEK_API_KEY|DECIS_API_KEY|MC[A-Z0-9_]*|LLM[A-Z0-9_]*|INTENT_FOCUS_[A-Z0-9_]*|UPLOAD_[A-Z0-9_]*|PREVIEW_[A-Z0-9_]*|READ_TRUNCATE_[A-Z0-9_]*)$/;
  return Object.keys(env)
    .filter((key) => suspect.test(key) && !known.has(key))
    .sort();
}

/**
 * 启动摘要（密钥一律打码）：回答"这台机器上到底哪个值生效"。
 *
 * 只列真正影响行为的项，不列文件路径等噪声；`intentFocus` 缺失时明确写 null，
 * 避免"以为开了意图聚焦其实整块没配"。
 */
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  return {
    port: config.port,
    pool_size: config.poolSize,
    idle_timeout_ms: config.idleTimeoutMs,
    mcp_timeout_ms: config.mcpTimeoutMs,
    mcp_connect_timeout_ms: config.mcpConnectTimeoutMs,
    llm_max_retries: config.llmRetry.maxRetries,
    llm_retry_max_delay_ms: config.llmRetry.maxRetryDelayMs,
    plan_timeout_ms: config.planLimits.timeoutMs,
    plan_total_steps_max: config.planLimits.totalStepsMax,
    plan_replan_max_per_run: config.planLimits.replanMaxPerRun,
    model: config.defaultModel.model,
    public_base_url: config.publicBaseUrl,
    admin_backend_url: config.adminBackendUrl,
    auth_enabled: config.authSecret !== undefined,
    intent_focus: config.intentFocus
      ? {
          base_url: config.intentFocus.baseUrl,
          timeout_ms: config.intentFocus.timeoutMs,
          skill_threshold: config.intentFocus.skillThreshold,
          plan_threshold: config.intentFocus.planThreshold ?? null,
          plan_timeout_ms: config.intentFocus.planTimeoutMs,
        }
      : null,
  };
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
  const intentFocus = resolveIntentFocus(yamlParsed.data.intent_focus, env);

  const runtime = resolveRuntime(yamlParsed.data.runtime);
  const planLimits = resolvePlanLimits(yamlParsed.data.plan);

  // 签名直链的对外基址与部署形态强相关，必须显式声明：
  // 兜底成 localhost 时容器间的 MCP 服务（如 OCR）会回源打到它自己，
  const publicBaseUrl = e.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    throw new ConfigError(
      '缺少必填环境变量 PUBLIC_BASE_URL（MCP 服务回源下载的对外基址，容器内应为 http://backend:3000）',
    );
  }
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
    mcpTimeoutMs: runtime.mcpTimeoutMs,
    mcpConnectTimeoutMs: runtime.mcpConnectTimeoutMs,
    uploadMaxMb: UPLOAD_MAX_MB,
    previewMaxMb: PREVIEW_MAX_MB,
    readTruncateKb: READ_TRUNCATE_KB,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
    llmRetry: { maxRetries: runtime.llmMaxRetries, maxRetryDelayMs: runtime.llmRetryMaxDelayMs },
    planLimits,
    publicBaseUrl,
    fileSignSecret: e.FILE_SIGN_SECRET ?? randomBytes(32).toString('hex'),
    models,
    defaultModel: models[0]!,
    ...(intentFocus ? { intentFocus } : {}),
    ...(e.AUTH_SECRET ? { authSecret: e.AUTH_SECRET } : {}),
    adminBackendUrl: e.ADMIN_BACKEND_URL.replace(/\/+$/, ''),
  };
  return Object.freeze(config);
}
