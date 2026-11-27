
export type ProbeOutcome = 'renderable' | 'download' | 'fallback'

const RENDERABLE_CONTENT_TYPE = /^(?:text\/|application\/(?:pdf|json)|image\/)/

export interface ProbeDeps {
  fetchImpl?: typeof fetch
}

export async function probeRenderable(
  url: string,
  deps: ProbeDeps = {},
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)

  let response: Response
  try {
    response = await fetchImpl(url, { method: 'GET', signal })
  } catch {
    // 网络错误 / 超时 / 被中止：不猜，交给上层降级为外部跳转
    return 'fallback'
  }

  const disposition = response.headers.get('content-disposition')?.toLowerCase() ?? ''
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  // 只关心响应头：立刻放弃响应体，避免把大文件读进内存
  try {
    await response.body?.cancel()
  } catch {
    /* 忽略：预检不需要响应体 */
  }

  if (!response.ok) return 'fallback'
  if (disposition.includes('attachment')) return 'download'
  return RENDERABLE_CONTENT_TYPE.test(contentType) ? 'renderable' : 'download'
}
