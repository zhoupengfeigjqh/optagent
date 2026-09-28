/**
 * 发消息（SSE 流式）与流事件解码（`contracts/backend-api.md` §4）
 *
 * 请求体字段（`additionalProperties: false`）：`content` / `thinking` / `model` / `attachments`。
 * - `content`：**去掉 `@文件名` 引用文本后**的正文，`minLength: 1`
 * - `model`：未选择时**不传该字段**，由后端使用默认模型（FR-013）
 * - `attachments`：结构化 `{dir, filename}[]`，`maxItems: 10`（FR-016、SC-019）
 */

import type { FileReference, RawSseEvent, SendMessageRequest, StreamEvent, Usage } from './types'
import { SSE_EVENT } from '../constants/events'
import { postSseStream, type SseRequestOptions } from './sse'

/** 发消息入参（组件/composable 视角）。 */
export interface SendMessageInput {
  /** 已去除 `@文件名` 引用文本的正文 */
  content: string
  /** 思考开关状态；`false` 即快速模式 */
  thinking: boolean
  /** 当前选中模型；`null` / 空串表示不提交该字段 */
  model: string | null
  /** 结构化引用 */
  attachments: FileReference[]
}

/**
 * 构造发消息请求体。
 *
 * 刻意省略空值字段：后端 Schema 为 `additionalProperties: false`，
 * 且 `model` / `attachments` 有 `minLength` / `maxItems` 约束。
 */
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
  return body
}

/** 把 SSE 原始事件解码为类型化的 `StreamEvent`；未知事件或非法 JSON 返回 `null`。 */
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

    case SSE_EVENT.TOOL_CALL:
      return {
        type: 'tool_call',
        data: {
          call_id: asString(payload.call_id),
          name: asString(payload.name),
          status: 'running',
        },
      }

    case SSE_EVENT.TOOL_CALL_END:
      return {
        type: 'tool_call_end',
        data: {
          call_id: asString(payload.call_id),
          status: payload.status === 'error' ? 'error' : 'success',
        },
      }

    case SSE_EVENT.INTERACTION_REQUEST: {
      const schema = asRecord(payload.schema) ?? { type: 'object', properties: {} }
      // 可选字段"有才写"：与后端不写空壳的同一口径（缺省即不出现，而不是空串）
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
          // 以下两项曾在逐字段构造时漏映射（本函数**不是**透传，漏了就静默丢）：
          // 2026-09-23 修复——`rules_field` 丢失会让「从算法规则选择」入口永不出现，
          // `tool_description` 丢失会让弹窗头部少一句工具说明。
          ...(toolDescription !== '' ? { tool_description: toolDescription } : {}),
          ...(rulesField !== '' ? { rules_field: rulesField } : {}),
        },
      }
    }

    case SSE_EVENT.DONE:
      return {
        type: 'done',
        data: {
          // 缺省视为 completed（后端仅返回 completed / stop）
          finish_reason: payload.finish_reason === 'stop' ? 'stop' : 'completed',
          usage: asUsage(payload.usage),
          duration_seconds: asNumber(payload.duration_seconds),
          message_id: typeof payload.message_id === 'string' ? payload.message_id : null,
          // 会话可跨数字人：本轮由谁回答（缺省空串，UI 回退为「助手」）
          agent_name: asString(payload.agent_name),
        },
      }

    case SSE_EVENT.ERROR: {
      const error = asRecord(payload.error)
      return {
        type: 'error',
        data: {
          error: {
            code: asString(error?.code, 'INTERNAL_ERROR'),
            message: asString(error?.message),
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

/** 流式发送选项（测试注入 `fetchImpl`）。 */
export interface SendMessageStreamOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * 发起一轮对话（POST + SSE 流式读取）。
 *
 * 每个事件解码后回调 `onEvent`；终止条件由调用方依据 `done` / `error` 判定。
 * 读取异常直接向上抛出（调用方标记 `failed` 并提供"重新获取"，FR-050）。
 */
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

/* ---------- 内部解析辅助 ---------- */

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
