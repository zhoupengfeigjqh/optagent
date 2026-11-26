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
