/**
 * 统一 API 错误（与 `agent-backend` 的 `ApiError` 同构）。
 *
 * 错误体固定为 `{ error: { code, message, details? } }`（契约 §0.3）：
 * - `message` MUST 可读且可定位（具体字段/文件/条目），MUST NOT 只返回"操作失败"；
 * - 校验类错误 MAY 附带 `details`，形如 `{ errors: [...] }`，
 *   用于一次性列出全部错误项（`FR-027`、`SC-020`）。
 */
import { ERROR_CODES, ERROR_STATUS } from './error-codes.js';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code] ?? 500;
    this.details = details;
  }
}

/** 400：参数不合法 */
export function validationFailed(message: string, details?: unknown): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_FAILED, message, details);
}

/** 并发编辑冲突（`FR-008`） */
export function revisionConflict(expected: number, actual: number): ApiError {
  return new ApiError(
    ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
    `配置已被他处修改（期望版本 ${expected}，当前版本 ${actual}），请刷新后重试`,
  );
}
