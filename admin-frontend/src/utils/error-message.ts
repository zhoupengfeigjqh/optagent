
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
