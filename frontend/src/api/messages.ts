
import type {
  FileReference,
  RawSseEvent,
  SendMessageRequest,
  StreamEvent,
  ToolTip,
  Usage,
} from './types'
import { SSE_EVENT } from '../constants/events'
import { normalizeNextSteps } from './next-steps'
import { postSseStream, type SseRequestOptions } from './sse'

export const MAX_MESSAGE_CHARS = 32_000

export interface SendMessageInput {
  content: string
  thinking: boolean
  model: string | null
  attachments: FileReference[]
  guidance?: string
  toolTips?: ToolTip[]
  skipIntentFocus?: boolean
  skill?: string
}

export function buildSendMessageBody(input: SendMessageInput): SendMessageRequest {
  const body: SendMessageRequest = {
    content: input.content,
    thinking: input.thinking,
  }
  if (input.model) {
    body.model = input.model
  }
  if (input.attachments.length > 0) {
    body.attachments = input.attachments.map((item) => ({
      dir: item.dir,
      filename: item.filename,
    }))
  }
  if (input.guidance) {
    body.guidance = input.guidance
  }
  if (input.toolTips && input.toolTips.length > 0) {
    body.tool_tips = input.toolTips
  }
  if (input.skipIntentFocus === true) {
    body.skip_intent_focus = true
  }
  if (input.skill) {
    body.skill = input.skill
  }
  return body
}

export function decodeStreamEvent(raw: RawSseEvent): StreamEvent | null {
  const payload = parseJson(raw.data)
  if (payload === null) {
    return null
  }

  switch (raw.event) {
    case SSE_EVENT.THINKING:
      return { type: 'thinking', data: { delta: asString(payload.delta) } }

    case SSE_EVENT.CONTENT:
      return { type: 'content', data: { delta: asString(payload.delta) } }

    case SSE_EVENT.TOOL_CALL: {
      const label = asString(payload.label)
      return {
        type: 'tool_call',
        data: {
          call_id: asString(payload.call_id),
          name: asString(payload.name),
          ...(label !== '' ? { label } : {}),
          status: 'running',
        },
      }
    }

    case SSE_EVENT.TOOL_CALL_END:
      return {
        type: 'tool_call_end',
        data: {
          call_id: asString(payload.call_id),
          status: payload.status === 'error' ? 'error' : 'success',
        },
      }

    case SSE_EVENT.PLAN_PROGRESS: {
      // 缺步名就没有可展示的信息，整条丢弃（避免进度条出现空白一行）
      const label = asString(payload.label)
      if (label === '') {
        return null
      }
      const rawPhase = asString(payload.phase)
      const phase = rawPhase === 'replanned' || rawPhase === 'done' ? rawPhase : 'running'
      return {
        type: 'plan_progress',
        data: { seq_id: asNumber(payload.seq_id, 1), label, phase },
      }
    }

    case SSE_EVENT.INTERACTION_REQUEST: {
      const schema = asRecord(payload.schema) ?? { type: 'object', properties: {} }
      const toolDescription = asString(payload.tool_description)
      const rulesField = asString(payload.rules_field)
      return {
        type: 'interaction_request',
        data: {
          interaction_id: asString(payload.interaction_id),
          call_id: asString(payload.call_id),
          tool_name: asString(payload.tool_name),
          title: asString(payload.title, '确认调用参数'),
          schema,
          proposed_args: asRecord(payload.proposed_args) ?? {},
          required: Array.isArray(payload.required)
            ? payload.required.filter((r): r is string => typeof r === 'string')
            : [],
          timeout_seconds: asNumber(payload.timeout_seconds, 300),
          ...(toolDescription !== '' ? { tool_description: toolDescription } : {}),
          ...(rulesField !== '' ? { rules_field: rulesField } : {}),
        },
      }
    }

    case SSE_EVENT.DONE: {
      const nextActions =
        payload.next_actions === undefined || payload.next_actions === null
          ? null
          : normalizeNextSteps(payload.next_actions)
      return {
        type: 'done',
        data: {
          finish_reason: payload.finish_reason === 'stop' ? 'stop' : 'completed',
          usage: asUsage(payload.usage),
          duration_seconds: asNumber(payload.duration_seconds),
          message_id: typeof payload.message_id === 'string' ? payload.message_id : null,
          // 本轮由谁回答（009：会话归属固定；逐条保留以兼容存量数据。缺省空串，UI 回退为「助手」）
          agent_name: asString(payload.agent_name),
          ...(nextActions && nextActions.message_id !== null ? { next_actions: nextActions } : {}),
        },
      }
    }

    case SSE_EVENT.ERROR: {
      const error = asRecord(payload.error)
      const upstreamStatus = error?.upstream_status
      const upstreamType = asString(error?.upstream_type)
      const requestId = asString(error?.request_id)
      return {
        type: 'error',
        data: {
          error: {
            code: asString(error?.code, 'INTERNAL_ERROR'),
            message: asString(error?.message),
            ...(typeof upstreamStatus === 'number' ? { upstream_status: upstreamStatus } : {}),
            ...(upstreamType !== '' ? { upstream_type: upstreamType } : {}),
            ...(requestId !== '' ? { request_id: requestId } : {}),
          },
          duration_seconds:
            payload.duration_seconds === undefined ? undefined : asNumber(payload.duration_seconds),
          usage: payload.usage === undefined ? undefined : asUsage(payload.usage),
          agent_name: asString(payload.agent_name),
        },
      }
    }

    default:
      return null
  }
}

export interface SendMessageStreamOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function sendMessageStream(
  threadId: string,
  body: SendMessageRequest,
  onEvent: (event: StreamEvent) => void,
  options: SendMessageStreamOptions = {},
): Promise<void> {
  const request: SseRequestOptions = {
    path: `/api/threads/${encodeURIComponent(threadId)}/messages`,
    body,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  }

  await postSseStream(request, {
    onEvent: (raw) => {
      const event = decodeStreamEvent(raw)
      if (event) {
        onEvent(event)
      }
    },
  })
}


function parseJson(text: string): Record<string, unknown> | null {
  if (text.trim() === '') {
    return null
  }
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asUsage(value: unknown): Usage {
  const record = asRecord(value)
  return {
    input_tokens: asNumber(record?.input_tokens),
    output_tokens: asNumber(record?.output_tokens),
  }
}
