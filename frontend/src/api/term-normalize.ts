/**
 * 术语替换预检（018）客户端。
 *
 * 后端 `POST /api/term-normalize` 是**薄编排**：开关关闭、没有字典、字典损坏时都返回
 * `applied:false`，客户端据此直接按原话发送。因此本模块不做任何业务判断，只负责
 * "发一次请求、把结构化结果拿回来"；超时/降级策略由调用方（`useTermNormalize`）决定。
 */

import type { HttpClient } from './http'

/** 单次命中（`start`/`end` 是原话的 UTF-16 下标，可直接用于切片高亮） */
export interface TermMatch {
  term: string
  value: string
  start: number
  end: number
}

export interface TermNormalizeResult {
  /** 是否真的发生了改变（命中即同值不算） */
  applied: boolean
  original: string
  normalized: string
  matches: TermMatch[]
}

export interface TermNormalizeApi {
  review(content: string, signal?: AbortSignal): Promise<TermNormalizeResult>
}

export function createTermNormalizeApi(client: HttpClient): TermNormalizeApi {
  return {
    review: (content, signal) =>
      client.request<TermNormalizeResult>('/api/term-normalize', {
        method: 'POST',
        body: { content },
        ...(signal ? { signal } : {}),
      }),
  }
}
