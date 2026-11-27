
import type { HttpClient } from './http'
import type {
  Conversation,
  FeedbackResponse,
  FeedbackValue,
  InteractionSubmitRequest,
  InteractionSubmitResponse,
  NextStepAction,
  StopResponse,
  ThreadCreateResponse,
  ThreadDetail,
} from './types'

export interface ThreadDetailQuery {
  limit?: number
  offset?: number
}

export interface ThreadNextSteps {
  message_id: string | null
  actions: NextStepAction[]
}

export interface ThreadsApi {
  create(agentName: string): Promise<ThreadCreateResponse>
  list(agentName?: string): Promise<Conversation[]>
  detail(threadId: string, query?: ThreadDetailQuery): Promise<ThreadDetail>
  rename(threadId: string, title: string): Promise<{ thread_id: string; title: string }>
  remove(threadId: string): Promise<void>
  feedback(threadId: string, messageId: string, value: FeedbackValue): Promise<FeedbackResponse>
  stop(threadId: string): Promise<StopResponse>
  /**
   * `POST /api/threads/{id}/interaction` → HITL 人工确认提交/拒绝（202，幂等）。
   * `submit` 的服务端终验失败返回 400 `SCHEMA_VALIDATION_FAILED`（interaction 保持挂起可重提）。
   */
  submitInteraction(
    threadId: string,
    body: InteractionSubmitRequest,
  ): Promise<InteractionSubmitResponse>
}

export function createThreadsApi(client: HttpClient): ThreadsApi {
  const base = (threadId: string): string => `/api/threads/${encodeURIComponent(threadId)}`

  return {
    create: (agentName) =>
      client.post<ThreadCreateResponse>('/api/threads', { agent_name: agentName }),

    // 注意：MUST NOT 传 limit / offset（会被静默丢弃，拿不到分页效果）
    list: (agentName) =>
      client.get<Conversation[]>('/api/threads', agentName ? { agent_name: agentName } : undefined),

    detail: (threadId, query) =>
      client.get<ThreadDetail>(base(threadId), {
        limit: query?.limit,
        offset: query?.offset,
      }),

    rename: (threadId, title) =>
      client.patch<{ thread_id: string; title: string }>(base(threadId), { title }),

    remove: (threadId) => client.del<void>(base(threadId)),

    feedback: (threadId, messageId, value) =>
      client.put<FeedbackResponse>(
        `${base(threadId)}/messages/${encodeURIComponent(messageId)}/feedback`,
        { value },
      ),

    stop: (threadId) => client.post<StopResponse>(`${base(threadId)}/stop`),

    submitInteraction: (threadId, body) =>
      client.post<InteractionSubmitResponse>(`${base(threadId)}/interaction`, body),
  }
}
