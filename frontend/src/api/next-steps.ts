
import type { HttpClient } from './http'
import type { NextStepAction, ToolTip } from './types'
import type { ThreadNextSteps } from './threads'

export interface NextStepsApi {
  fetch(threadId: string): Promise<ThreadNextSteps>
}

/** 空形态（常量工厂：每次返回新对象，避免调用方就地改共享引用）。 */
export function emptyNextSteps(): ThreadNextSteps {
  return { message_id: null, actions: [] }
}

export function createNextStepsApi(client: HttpClient): NextStepsApi {
  return {
    async fetch(threadId: string): Promise<ThreadNextSteps> {
      try {
        const body = await client.get<unknown>(
          `/api/threads/${encodeURIComponent(threadId)}/next-actions`,
        )
        return normalizeNextSteps(body)
      } catch {
        // 静默降级：网络失败 / 404 / 5xx 在这里一视同仁（PR-042：降级 MUST NOT 呈现错误）
        return emptyNextSteps()
      }
    },
  }
}

/**
 * 形状校验：不合法一律空形态（防线在渲染之前，而不是在组件里）。
 *
 * 导出给 `api/messages.ts` 复用：SSE `done` 事件的 `next_actions` 字段与本端点
 * 是**同一份快照**的两个出口，形状校验必须同一条实现（TR-02 唯一实现原则）。
 */
export function normalizeNextSteps(raw: unknown): ThreadNextSteps {
  if (raw === null || typeof raw !== 'object') return emptyNextSteps()
  const record = raw as { message_id?: unknown; actions?: unknown }
  if (typeof record.message_id !== 'string' || !Array.isArray(record.actions)) {
    return emptyNextSteps()
  }
  const actions: NextStepAction[] = []
  for (const item of record.actions) {
    const action = toAction(item)
    if (action) actions.push(action)
  }
  if (actions.length === 0) return emptyNextSteps()
  return { message_id: record.message_id, actions }
}

function toAction(value: unknown): NextStepAction | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as { prompt?: unknown; tool_tips?: unknown }
  if (typeof record.prompt !== 'string' || record.prompt === '') return null
  return { prompt: record.prompt, tool_tips: toToolTips(record.tool_tips) }
}

function toToolTips(raw: unknown): ToolTip[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const record =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      name: typeof record.name === 'string' ? record.name : '',
      title: typeof record.title === 'string' ? record.title : '',
      ontology_id: typeof record.ontology_id === 'string' ? record.ontology_id : '',
      ontology_name: typeof record.ontology_name === 'string' ? record.ontology_name : null,
    }
  })
}
