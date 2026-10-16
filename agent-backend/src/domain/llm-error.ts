/**
 * LLM 失败分类（唯一实现，2026-10-15）。
 *
 * **为什么单独成模块**：直聊（`infra/llm/pi-ai-provider.ts` 的 `streamChat`）与工具循环
 * （`infra/agent-loop.ts` 的 `runAgentLoopEvents`）两条路径 MUST 给出**同一个错误码**——
 * 否则前端文案（按码分派）与运维日志（`run.end` 的 `error_code`、`llm.call.failed`）
 * 会各说一套（原则二"同一职责只有一处实现"）。
 *
 * **输入形态**：`pi-ai` 的 `formatProviderError` 只产出两种文案：
 *   - `<status>: <body>`             （无 provider 前缀）
 *   - `<prefix> (<status>): <body>`  （有前缀，如 `deepseek (503): {…}`）
 * 因此先取"显式状态码"（抛出的 Error 上带的 `status` / `statusCode`），取不到再从
 * 文案前导位置解析；错误体（JSON）里尽力取 `type` / `request_id`，取不到即省略——
 * **本模块永不抛错**（分类失败只应退化为 `LLM_ERROR`，绝不能把收尾链路带崩）。
 *
 * **输出字段用 snake_case**：它们就是契约字段（`contracts/runtime-api-delta.md` §19.3），
 * 会被原样写进 `history.jsonl` 的失败行与 SSE `error` 事件——同一份诊断从分类到落盘
 * 只构造一次，不做二次改名。
 *
 * 契约：`runtime-api-delta.md` §19.2 / §19.3 / §19.4。
 */
import type { HistoryErrorInfo } from '../types.js';

/** 流级错误码（`ABORTED` / `LLM_ERROR` 为既有码，语义不变；其余为 2026-10-15 新增） */
export type LlmErrorCode =
  | 'ABORTED'
  | 'LLM_ERROR'
  | 'LLM_UNAVAILABLE'
  | 'LLM_RATE_LIMITED'
  | 'LLM_INSUFFICIENT_BALANCE'
  | 'LLM_UNAUTHORIZED'
  | 'LLM_CONTEXT_TOO_LONG';

/** 失败信息（落盘 / SSE 同形；三个诊断字段**有才写**） */
export interface LlmFailure {
  code: LlmErrorCode;
  message: string;
  /** 上游 HTTP 状态码（如 503） */
  upstream_status?: number;
  /** 上游错误类型（如 `service_unavailable_error`） */
  upstream_type?: string;
  /** 上游请求 id（向 provider 报障用） */
  request_id?: string;
}

/**
 * 需要**人工介入**的错误码：充值 / 换 Key 是运维动作，用户自愈不了。
 *
 * 只有这两类在日志里带 `alert: true`（§19.4）——把"用户稍后重试就好"的 5xx 也标成
 * 告警会让 alert 失去意义。
 */
export const ALERT_LLM_ERROR_CODES: readonly LlmErrorCode[] = [
  'LLM_INSUFFICIENT_BALANCE',
  'LLM_UNAUTHORIZED',
];

/** 该错误码是否需要告警（`run-finalize` 记日志时用；判据与服务端文案表同源） */
export function isAlertLlmFailure(code: string): boolean {
  return (ALERT_LLM_ERROR_CODES as readonly string[]).includes(code);
}

/** 分类失败时的兜底文案（与分类落地前的实现逐字一致，避免无谓的文案漂移） */
export const LLM_FAILURE_FALLBACK_MESSAGE = 'LLM 调用失败';

/** 用户中断的兜底文案（pi-ai 未给 `errorMessage` 时用） */
export const LLM_ABORTED_MESSAGE = '已中断';

/**
 * 从任意"含诊断字段的错误对象"里挑出 `HistoryErrorInfo`（**唯一**的字段归一实现）。
 *
 * 只挑五个字段、且**有才写**：不直接把上游对象 `{ ...ev }` 摊开——那样会把
 * `usage` / `type` 之类的旁字段带进 `history.jsonl` 的失败行，破坏"失败行结构固定"的既有口径。
 * 两个调用点（`run-finalize` 收尾、`run-manager` 转发 LlmEvent）MUST 都用它，
 * 以保证"落盘行与 SSE 事件同形"（§19.5 不变式 5）。
 */
export function toHistoryErrorInfo(source: {
  code: string;
  message: string;
  upstream_status?: number;
  upstream_type?: string;
  request_id?: string;
}): HistoryErrorInfo {
  const info: HistoryErrorInfo = { code: source.code, message: source.message };
  if (source.upstream_status !== undefined) info.upstream_status = source.upstream_status;
  if (source.upstream_type !== undefined) info.upstream_type = source.upstream_type;
  if (source.request_id !== undefined) info.request_id = source.request_id;
  return info;
}

export interface LlmFailureInput {
  /** pi-ai 给出的错误文案；缺失时用兜底文案 */
  message?: string;
  /** 显式状态码（抛出的 Error 上的 `status` / `statusCode`），优先于文案解析 */
  status?: number;
  /**
   * 用户中断：分类器**不猜**中断——由调用点按 `pi` 的 `reason === 'aborted'`
   * 显式传入（"用户点了停止"与"上游报 499"是两回事）。
   */
  aborted?: boolean;
}

/** 把上游/pi-ai 的失败归一到错误码 + 诊断字段（纯函数） */
export function classifyLlmFailure(input: LlmFailureInput = {}): LlmFailure {
  const raw = input.message?.trim() ?? '';
  if (input.aborted) {
    return { code: 'ABORTED', message: raw || LLM_ABORTED_MESSAGE };
  }

  const status = normalizeStatus(input.status) ?? parseStatusFromMessage(raw);
  const body = parseErrorBody(raw);
  const failure: LlmFailure = {
    code: codeForStatus(status, raw, body),
    message: raw || LLM_FAILURE_FALLBACK_MESSAGE,
  };
  if (status !== undefined) failure.upstream_status = status;
  if (body?.type) failure.upstream_type = body.type;
  const requestId = body?.requestId ?? parseRequestIdFromMessage(raw);
  if (requestId) failure.request_id = requestId;
  return failure;
}

/**
 * 从抛出的任意值里取 HTTP 状态码。
 *
 * `openai` SDK 用 `status`，Mistral 用 `statusCode`（见 pi-ai 的 `normalizeProviderError`）；
 * 两者都取不到就返回 `undefined`，交给文案解析。
 */
export function statusOfError(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const record = err as { status?: unknown; statusCode?: unknown };
  return normalizeStatus(record.status) ?? normalizeStatus(record.statusCode);
}

/** 状态码 → 错误码（§19.2 的判定顺序） */
function codeForStatus(
  status: number | undefined,
  raw: string,
  body: ErrorBody | undefined,
): LlmErrorCode {
  if (status === undefined) return 'LLM_ERROR';
  if (status === 401 || status === 403) return 'LLM_UNAUTHORIZED';
  if (status === 402) return 'LLM_INSUFFICIENT_BALANCE';
  if (status === 429) return 'LLM_RATE_LIMITED';
  // 408 = 上游等待超时：与 5xx 同归"服务端暂时不可用"（不单独立码，见 §19.2 注）
  if (status === 408 || status >= 500) return 'LLM_UNAVAILABLE';
  if (status === 400 && looksLikeContextOverflow(raw, body)) return 'LLM_CONTEXT_TOO_LONG';
  return 'LLM_ERROR';
}

/** 上下文超长特征词（只在 `400` 分支上判定，避免与"鉴权失败"之类误判） */
const CONTEXT_OVERFLOW_HINTS = [
  'context length',
  'context_length',
  'maximum context',
  'too long',
  'max_tokens',
  'maximum number of tokens',
];

function looksLikeContextOverflow(raw: string, body: ErrorBody | undefined): boolean {
  const haystack = `${body?.type ?? ''} ${raw}`.toLowerCase();
  return CONTEXT_OVERFLOW_HINTS.some((hint) => haystack.includes(hint));
}

function normalizeStatus(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 100 && value <= 599 ? value : undefined;
}

/**
 * 从文案里取状态码，三种已知形态（按可信度排序）：
 *
 * 1. `<prefix> (<status>):` —— pi 带 provider 前缀的报错；
 * 2. 行首 `<status>:`       —— pi 的 `"<status>: <body>"`（真实样本见模块头注释）；
 * 3. 行首 `<status>` + 空白  —— `openai` SDK 自己的措辞，如 `"503 status code (no body)"`、
 *    `"429 Too Many Requests"`（**实测**：桩 fetch 返回非 2xx 时 pi 会把 SDK 的这句原文
 *    直接当作 `errorMessage` 透出，若不识别就会把 503 退化成 `LLM_ERROR`）。
 */
function parseStatusFromMessage(message: string): number | undefined {
  const prefixed = /\((\d{3})\)\s*:/.exec(message);
  if (prefixed) return normalizeStatus(Number(prefixed[1]));
  const leadingWithColon = /^\s*(\d{3})\s*:/.exec(message);
  if (leadingWithColon) return normalizeStatus(Number(leadingWithColon[1]));
  const leading = /^\s*(\d{3})\b/.exec(message);
  return leading ? normalizeStatus(Number(leading[1])) : undefined;
}

interface ErrorBody {
  type?: string;
  requestId?: string;
}

/**
 * 尽力从报文里的第一个 JSON 对象取 `type` / `request_id`。
 *
 * 不抛错：上游可能给非 JSON 体（HTML 错误页、纯文本），此时返回 `undefined`，
 * 诊断字段随之省略——宁缺勿假。
 */
function parseErrorBody(message: string): ErrorBody | undefined {
  const start = message.indexOf('{');
  if (start < 0) return undefined;
  const parsed =
    tryParseJson(message.slice(start)) ?? tryParseJson(trimToLastBrace(message, start));
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const nested = record.error;
  const nestedRecord =
    typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : undefined;
  const body: ErrorBody = {};
  const type = asNonEmptyString(record.type) ?? asNonEmptyString(nestedRecord?.type);
  const requestId = asNonEmptyString(record.request_id) ?? asNonEmptyString(record.requestId);
  if (type) body.type = type;
  if (requestId) body.requestId = requestId;
  return body;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function trimToLastBrace(message: string, start: number): string {
  const end = message.lastIndexOf('}');
  return end > start ? message.slice(start, end + 1) : message.slice(start);
}

/**
 * 从报文文本里抽 `request_id`。
 *
 * 真实样本（DeepSeek 2026-10-15）：`request_id` 被写在**错误体的 message 字符串内部**
 * —`"Service is too busy… (request_id: 7eac5255-…)"`，不是独立字段；只读 JSON 字段会漏掉它。
 */
function parseRequestIdFromMessage(message: string): string | undefined {
  const matched = /request[_-]?id["'\s:=]+([A-Za-z0-9_-]{8,})/i.exec(message);
  return matched?.[1];
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
