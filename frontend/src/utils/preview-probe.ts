/**
 * 同源地址的「能否内联渲染」预检（2026-10-15）。
 *
 * 跳转入口点击后：**异源**直跳（由浏览器按响应头决定打开还是下载）；**同源**则需在塞进
 * `<iframe>` 之前先判一次——iframe 一旦加载，下载型响应（`Content-Disposition: attachment`）
 * 会直接触发下载、面板一片空白，且前端**无法再在 iframe 里补一个下载入口**。
 *
 * 判据是**响应头**（业内通用做法：`Content-Type` / `Content-Disposition`），不是 URL 特征：
 * 同源 `fetch` 能读响应头（跨域会被 CORS 挡住——但跨域本就直走外跳，不需要预检）。
 *
 * 三态结果：
 * - `renderable`：可内联（`text/*`、`application/pdf`、`application/json`、`image/*`）
 * - `download`：明确要求下载（`attachment`），或二进制 / 未知类型
 * - `fallback`：预检本身失败（网络错误 / 超时 / 非 2xx）→ 上层降级为**外部跳转**
 */

/** 预检结果。 */
export type ProbeOutcome = 'renderable' | 'download' | 'fallback'

/** 可内联渲染的响应类型（与浏览器内联能力一致）。 */
const RENDERABLE_CONTENT_TYPE = /^(?:text\/|application\/(?:pdf|json)|image\/)/

/** 依赖注入（单测用桩 `fetch`）。 */
export interface ProbeDeps {
  fetchImpl?: typeof fetch
}

/**
 * 预检一个**同源**地址能否放进 `<iframe>` 渲染。
 *
 * 实现要点：
 * - 用 `fetch`（而非导航）：**不会触发浏览器下载**，对 attachment 响应也安全；
 *   读完立刻 `cancel()` 掉响应体（真正的渲染由 iframe 自己发起）。
 * - 调用方负责只在**同源**时调用（跨域读不到响应头，且有 CORS 副作用）。
 * - 任何异常都不抛：统一归为 `fallback`（降级不是异常，宪章原则九）。
 */
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
