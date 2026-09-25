/**
 * 后台产出接口（`contracts/runtime-api-delta.md` §10.5）
 *
 * 三个能力：列表（有界返回）、标记已读（批量、幂等）、SSE 信号订阅（负载为空）。
 *
 * 信号语义：只表示"产出**可能**已变"，前端收到后**重拉列表**——因此信号丢失无后果
 * （产出物是文件，"有哪些"可从目录重算），断线由 `EventSource` 自带重连。
 */

import { parseErrorResponse, type HttpClient } from './http'

/** 一条后台产出（`GET /api/produced` 的 `items` 元素） */
export interface ProducedItem {
  /** 服务侧任务号（幂等键、状态查询的键） */
  job_id: string
  /** 发起该任务的会话（= `thread_id`）；决定这条产出能否"接回"某次对话 */
  sid?: string
  /** 关联那次"已受理"的工具调用（对话内卡片的挂载点） */
  call_id?: string
  /** 运行环境侧工具全名（含 `{server}__` 前缀） */
  tool: string
  /** 一行摘要（可缺省；缺省时界面给兜底文案，MUST NOT 留白） */
  summary?: string
  size: number
  /** 落盘名（含 `{prefix}_`） */
  filename: string
  status: 'done'
  created_at: string
  finished_at: string
  /**
   * 已读时刻（契约 §10.5 ⑤）：**缺省 = 未读**。
   *
   * 与产出**同生命周期**——产出被 7 天清理时它一起消失，未读数因此自然归零，
   * 不会出现"角标 > 0 而列表为空"的悬空状态（§10.6 不变式 7）。
   */
  read_at?: string
  /**
   * 发起该任务的数字人名称（运行环境按 `sid` 反查会话的 `agent_name`）。
   *
   * **查询期联结字段，不落盘**：`sid` 缺失或会话已删除时缺省，界面据此显示"未知"。
   */
  agent_name?: string
  /** 相对 user-data 的路径（模型据此 `read_file`；界面用于打开预览） */
  relPath: string
}

/** 产出列表响应（有界返回，按完成时间倒序） */
export interface ProducedListResponse {
  items: ProducedItem[]
}

/** 标记已读的返回：**实际写入** `read_at` 的条数 */
export interface ProducedReadResponse {
  marked: number
}

/** 产出接口。 */
export interface ProducedApi {
  /** `GET /api/produced?limit=` */
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
   * （产出可能已被 7 天清理，那不是调用方的错误），只体现在 `marked` 的差值里。
   */
  markRead(jobIds: readonly string[]): Promise<ProducedReadResponse>
  /**
   * 订阅产出变更**信号**（SSE `GET /api/produced/events`）。
   *
   * 事件名 `produced`、**负载为空**——收到即视为"清单可能已变"，调用方应重拉列表。
   * 返回退订函数；`EventSource` 自带断线重连。
   */
  subscribe(onSignal: () => void): () => void
}

/** 创建产出 API。 */
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
