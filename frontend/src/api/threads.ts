/**
 * 会话接口（`contracts/backend-api.md` §3）
 *
 * ⚠️ §7 差异 2：`GET /api/threads` **不支持 `limit` / `offset`**
 * （Schema `additionalProperties: false`，但 Fastify 默认 `removeAdditional: true` →
 * 未声明参数会被**静默丢弃、不报错**；2026-09-10 联调实测）——
 * 历史列表 10 / 100 条由**前端切片**实现（FR-039、FR-040）。
 * 只有**详情**接口支持分页（`limit` 默认 50 / 上限 200，`offset` 从最新往前数）。
 */

import type { HttpClient } from './http'
import type {
  Conversation,
  FeedbackResponse,
  FeedbackValue,
  InteractionSubmitRequest,
  InteractionSubmitResponse,
  StopResponse,
  ThreadCreateResponse,
  ThreadDetail,
} from './types'

/** 会话详情分页参数。 */
export interface ThreadDetailQuery {
  limit?: number
  offset?: number
}

/** 会话 API 接口。 */
export interface ThreadsApi {
  /** `POST /api/threads` → 201（**不返回** `agent_name` 与 `updated_at`） */
  create(agentName: string): Promise<ThreadCreateResponse>
  /** `GET /api/threads`（可选 `agent_name`）→ 顶层数组，按 `updated_at` 倒序，**不接受分页参数** */
  list(agentName?: string): Promise<Conversation[]>
  /** `GET /api/threads/{id}` → 详情（含 `total` / `messages` / `running`） */
  detail(threadId: string, query?: ThreadDetailQuery): Promise<ThreadDetail>
  /** `PATCH /api/threads/{id}` → 重命名（本期无 UI 入口，接口保留） */
  rename(threadId: string, title: string): Promise<{ thread_id: string; title: string }>
  /** `DELETE /api/threads/{id}` → 204（服务端先 stop 进行中的 run） */
  remove(threadId: string): Promise<void>
  /** `PUT /api/threads/{id}/messages/{messageId}/feedback`（同值重复提交 = 取消） */
  feedback(
    threadId: string,
    messageId: string,
    value: FeedbackValue,
  ): Promise<FeedbackResponse>
  /** `POST /api/threads/{id}/stop` → 中断本轮（本轮不落盘） */
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

/** 创建会话 API。 */
export function createThreadsApi(client: HttpClient): ThreadsApi {
  const base = (threadId: string): string => `/api/threads/${encodeURIComponent(threadId)}`

  return {
    create: (agentName) => client.post<ThreadCreateResponse>('/api/threads', { agent_name: agentName }),

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
