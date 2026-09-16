/**
 * 错误码 → 中文文案映射（与既有 `frontend/src/utils/error-message.ts`
 * **同一实现思路**，避免两套错误展示习惯）。
 *
 * - 后端统一错误体为 `{ error: { code, message } }`
 * - 前端**不直接展示**后端 `message`，一律按 `code` 分派
 * - 未知码回退通用文案并**保留原码**，便于排查
 */

import type { ErrorInfo } from '../api/types'
import { ERROR_MESSAGES, GENERIC_MESSAGE } from '../constants/error-messages'

/**
 * 把错误信息翻译为管理员可读的中文文案。
 *
 * @param error 后端错误体（`null` / `undefined` 视为未知错误）
 */
export function toUserMessage(error: ErrorInfo | null | undefined): string {
  const code = error?.code
  if (!code) return GENERIC_MESSAGE
  const mapped = ERROR_MESSAGES[code]
  if (mapped) return mapped
  // 未知码：通用文案 + 保留原码
  return `${GENERIC_MESSAGE}（${code}）`
}

/**
 * 把任意抛出物归一为 `ErrorInfo`。
 *
 * - 带 `code` 的对象（`ApiError`）→ 原样保留后端错误码
 * - 其他 `Error` → `NETWORK_ERROR`
 * - 其他类型 → `INTERNAL_ERROR`
 */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown }
    if (typeof record.code === 'string' && record.code !== '') {
      return {
        code: record.code,
        message: typeof record.message === 'string' ? record.message : '',
      }
    }
  }
  if (error instanceof Error) return { code: 'NETWORK_ERROR', message: error.message }
  return { code: 'INTERNAL_ERROR', message: '' }
}

/**
 * 从错误对象的 `details.errors` 中抽出**全部**错误项文案
 * （`FR-027`、`SC-020`：部署前校验 MUST 一次性列出全部错误项）。
 */
export interface DetailErrorEntry {
  user_id: string
  agent_name: string
  category: string
  code: string
  message: string
}

export function extractDetailErrors(details: unknown): DetailErrorEntry[] {
  if (typeof details !== 'object' || details === null) return []
  const errors = (details as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []
  return errors.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>
    return {
      user_id: typeof item.user_id === 'string' ? item.user_id : '',
      agent_name: typeof item.agent_name === 'string' ? item.agent_name : '',
      category: typeof item.category === 'string' ? item.category : '',
      code: typeof item.code === 'string' ? item.code : '',
      message: typeof item.message === 'string' ? item.message : '',
    }
  })
}
