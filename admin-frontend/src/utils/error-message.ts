
import type { ErrorInfo } from '../api/types'
import { ERROR_MESSAGES, GENERIC_MESSAGE } from '../constants/error-messages'

export function toUserMessage(error: ErrorInfo | null | undefined): string {
  const code = error?.code
  if (!code) return GENERIC_MESSAGE
  const mapped = ERROR_MESSAGES[code]
  if (mapped) return mapped
  return `${GENERIC_MESSAGE}（${code}）`
}

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
