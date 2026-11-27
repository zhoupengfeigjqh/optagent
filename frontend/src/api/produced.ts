
import { parseErrorResponse, type HttpClient } from './http'

export interface ProducedItem {
  /** 服务侧任务号（幂等键、状态查询的键） */
  job_id: string
  sid?: string
  call_id?: string
  tool: string
  /** 一行摘要（可缺省；缺省时界面给兜底文案，MUST NOT 留白） */
  summary?: string
  size: number
  filename: string
  status: 'done'
  created_at: string
  finished_at: string
  read_at?: string
  agent_name?: string
  relPath: string
}

export interface ProducedListResponse {
  items: ProducedItem[]
}

export interface ProducedReadResponse {
  marked: number
}

export interface ProducedApi {
  list(limit?: number): Promise<ProducedListResponse>
  /**
   * `GET /api/produced/raw?job_id=` → 产出正文（纯文本）。
   *
   * **刻意不走 `files` 的预览接口**：那个接口的 `dir` 是**空间顶层目录**，
   * 而产出落在二级目录 `临时空间/后台产出/`（契约 §10.5 ⑦）。
   */
  text(jobId: string): Promise<string>
  /**
   * `POST /api/produced/read` → 批量标记已读。
   *
   * **幂等**（已读的条目不改动原 `read_at`）；**不存在的 `job_id` 忽略**
   * （产出可能已被 30 天清理，那不是调用方的错误），只体现在 `marked` 的差值里。
   */
  markRead(jobIds: readonly string[]): Promise<ProducedReadResponse>
  subscribe(onSignal: () => void): () => void
}

export function createProducedApi(client: HttpClient): ProducedApi {
  return {
    list: (limit) =>
      client.get<ProducedListResponse>(
        '/api/produced',
        limit === undefined ? undefined : { limit },
      ),
    markRead: (jobIds) =>
      client.post<ProducedReadResponse>('/api/produced/read', { job_ids: [...jobIds] }),
    text: async (jobId) => {
      const response = await client.fetchImpl(client.url('/api/produced/raw', { job_id: jobId }))
      if (!response.ok) {
        throw await parseErrorResponse(response)
      }
      return response.text()
    },
    subscribe: (onSignal) => {
      const source = new EventSource(`${client.baseUrl}/api/produced/events`)
      source.addEventListener('produced', () => onSignal())
      return () => source.close()
    },
  }
}
