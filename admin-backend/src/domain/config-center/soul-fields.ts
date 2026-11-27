import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { SOUL_LIMITS } from './soul-limits.js';

/** 必填文本：去首尾空白后不得为空，且不超过 `max` 字 */
export function readRequiredText(raw: unknown, label: string, max: number): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}必填且不能为空`);
  }
  assertLength(text, label, max);
  return text;
}

export function readBool(raw: unknown, label: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}须为布尔值（true / false，当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

export function readPositiveInt(raw: unknown): number {
  const { nextActionHintsMin: min, nextActionHintsMax: max, nextActionHintsDefault: fallback } = SOUL_LIMITS;
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `下一步动作提示条数须为 ${min}~${max} 的整数（当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

export function readFocusDepth(raw: unknown): number {
  const { focusDepthMin: min, focusDepthMax: max, focusDepthDefault: fallback } = SOUL_LIMITS;
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `聚焦阶数须为 ${min}~${max} 的整数（当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

export function readOptionalText(raw: unknown, label: string, max: number): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串`);
  }
  const text = raw.trim();
  if (text === '') return '';
  assertLength(text, label, max);
  return text;
}

/** 长度上限（中文按字符数，与界面计数一致） */
export function assertLength(text: string, label: string, max: number): void {
  if (text.length > max) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}不得超过 ${max} 字（当前 ${text.length} 字）`);
  }
}

/** 字符串数组：非空、限长、去重（重复即拒，避免"配了两遍"的隐性错误） */
export function readTextList(raw: unknown, label: string, maxItemLength: number): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串数组`);
  }
  if (raw.length > SOUL_LIMITS.listItems) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}最多 ${SOUL_LIMITS.listItems} 项（当前 ${raw.length} 项）`,
    );
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含空值或非字符串项`);
    }
    const text = item.trim();
    if (text.length > maxItemLength) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `${label}单项不得超过 ${maxItemLength} 字：「${truncate(text)}」`,
      );
    }
    if (out.includes(text)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含重复项：${text}`);
    }
    out.push(text);
  }
  return out;
}

/** 报错文案里的短摘要（避免把整段配置贴进错误信息） */
export function truncate(text: string, max = 20): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
