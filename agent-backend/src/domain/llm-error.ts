import type { HistoryErrorInfo } from '../types.js';

export type LlmErrorCode =
  | 'ABORTED'
  | 'LLM_ERROR'
  | 'LLM_UNAVAILABLE'
  | 'LLM_RATE_LIMITED'
  | 'LLM_INSUFFICIENT_BALANCE'
  | 'LLM_UNAUTHORIZED'
  | 'LLM_CONTEXT_TOO_LONG';

export interface LlmFailure {
  code: LlmErrorCode;
  message: string;
  upstream_status?: number;
  upstream_type?: string;
  request_id?: string;
}

export const ALERT_LLM_ERROR_CODES: readonly LlmErrorCode[] = [
  'LLM_INSUFFICIENT_BALANCE',
  'LLM_UNAUTHORIZED',
];

export function isAlertLlmFailure(code: string): boolean {
  return (ALERT_LLM_ERROR_CODES as readonly string[]).includes(code);
}

/** 分类失败时的兜底文案（与分类落地前的实现逐字一致，避免无谓的文案漂移） */
export const LLM_FAILURE_FALLBACK_MESSAGE = 'LLM 调用失败';

/** 用户中断的兜底文案（pi-ai 未给 `errorMessage` 时用） */
export const LLM_ABORTED_MESSAGE = '已中断';

export function toHistoryErrorInfo(source: {
  code: string;
  message: string;
  upstream_status?: number;
  upstream_type?: string;
  request_id?: string;
  details?: string[];
  reason?: 'unregistered' | 'condition_false' | 'config_unavailable';
}): HistoryErrorInfo {
  const info: HistoryErrorInfo = { code: source.code, message: source.message };
  if (source.upstream_status !== undefined) info.upstream_status = source.upstream_status;
  if (source.upstream_type !== undefined) info.upstream_type = source.upstream_type;
  if (source.request_id !== undefined) info.request_id = source.request_id;
  // 兼容改动前已落盘的失败行（前端仍按 `details` 展示旧记录）。
  if (source.details !== undefined) info.details = source.details;
  if (source.reason !== undefined) info.reason = source.reason;
  return info;
}

export interface LlmFailureInput {
  /** pi-ai 给出的错误文案；缺失时用兜底文案 */
  message?: string;
  status?: number;
  aborted?: boolean;
}

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

export function statusOfError(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const record = err as { status?: unknown; statusCode?: unknown };
  return normalizeStatus(record.status) ?? normalizeStatus(record.statusCode);
}

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

function parseRequestIdFromMessage(message: string): string | undefined {
  const matched = /request[_-]?id["'\s:=]+([A-Za-z0-9_-]{8,})/i.exec(message);
  return matched?.[1];
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
