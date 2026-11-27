
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ProducedApi, ProducedItem } from '../api/produced'
import type { ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

export interface ProducedStoreOptions {
  produced: ProducedApi
  /** 列表条数上限；缺省走后端默认（有界返回） */
  limit?: number
}

export interface ProducedStore {
  readonly items: Readonly<Ref<ProducedItem[]>>
  readonly loading: Readonly<Ref<boolean>>
  readonly error: Readonly<Ref<ErrorInfo | null>>
  readonly unreadCount: ComputedRef<number>
  refresh(): Promise<void>
  /**
   * 清空列表与未读（**切换数字人时**调用）。
   *
   * 产出清单是**数字人级**的（后端按当前作用域定位目录），切人后旧条目一律不再成立；
   * 清空的另一重作用是让在途的旧请求失效（见 `generation`），避免旧响应晚到后把
   * 新数字人的列表覆盖回去。
   */
  clear(): void
  /** 批量标记已读（幂等）；成功后**就地**改本地状态，不重拉列表 */
  markRead(jobIds: readonly string[]): Promise<void>
  /**
   * 读产出正文（供"点开查看"）。
   *
   * 失败返回 `null` **且不写 `error`**：这是"看某一条"的局部失败（多半是已被 30 天清理），
   * 写进全局错误会让整个面板变成错误态、把还能看的其它条目一起遮掉。
   * 界面据此给**局部降级文案**而不是通用报错。
   */
  text(jobId: string): Promise<string | null>
  /** 开始订阅信号（**幂等**：重复调用不叠加连接） */
  start(): void
  stop(): void
  onNewItems(listener: (items: readonly ProducedItem[]) => void): () => void
}

export function createProducedStore(options: ProducedStoreOptions): ProducedStore {
  const items = ref<ProducedItem[]>([])
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  /** 当前订阅的退订函数；`null` = 未订阅（`start()` 的幂等判据） */
  let unsubscribe: (() => void) | null = null

  /**
   * 请求代际（**切换数字人必须重拉**，见 `clear()`）。
   *
   * 后端清单按"当前选中数字人"定位目录，切人瞬间在途的旧请求可能晚于新请求返回；
   * 只有最新一代的响应允许写回状态，否则旧数字人的列表会覆盖新数字人的。
   */
  let generation = 0

  let seen = new Set<string>()
  let baselineReady = false
  const newItemListeners = new Set<(items: readonly ProducedItem[]) => void>()

  const unreadCount = computed(
    () => items.value.filter((item) => item.read_at === undefined).length,
  )

  function notifyNew(added: readonly ProducedItem[]): void {
    if (added.length === 0) return
    for (const listener of [...newItemListeners]) {
      try {
        listener(added)
      } catch {
        // 刻意吞掉：见上——列表已经刷新，提示失败不影响这个事实
      }
    }
  }

  async function refresh(): Promise<void> {
    const token = ++generation
    loading.value = true
    error.value = null
    try {
      const next = (await options.produced.list(options.limit)).items
      if (token !== generation) return
      const added = baselineReady ? next.filter((item) => !seen.has(item.job_id)) : []
      seen = new Set(next.map((item) => item.job_id))
      baselineReady = true
      items.value = next
      notifyNew(added)
    } catch (err) {
      if (token !== generation) return
      error.value = toErrorInfo(err)
    } finally {
      if (token === generation) loading.value = false
    }
  }

  function clear(): void {
    generation++
    items.value = []
    error.value = null
    loading.value = false
    seen = new Set()
    baselineReady = false
  }

  async function markRead(jobIds: readonly string[]): Promise<void> {
    if (jobIds.length === 0) return
    const wanted = new Set(jobIds)
    const pending = items.value.filter(
      (item) => wanted.has(item.job_id) && item.read_at === undefined,
    )
    if (pending.length === 0) return
    const token = generation
    try {
      const { marked } = await options.produced.markRead(pending.map((item) => item.job_id))
      if (marked === 0 || token !== generation) return
      const at = new Date().toISOString()
      items.value = items.value.map((item) =>
        wanted.has(item.job_id) && item.read_at === undefined ? { ...item, read_at: at } : item,
      )
    } catch (err) {
      if (token !== generation) return
      error.value = toErrorInfo(err)
    }
  }

  function start(): void {
    if (unsubscribe !== null) return
    unsubscribe = options.produced.subscribe(() => {
      void refresh()
    })
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  function onNewItems(listener: (items: readonly ProducedItem[]) => void): () => void {
    newItemListeners.add(listener)
    return () => {
      newItemListeners.delete(listener)
    }
  }

  async function text(jobId: string): Promise<string | null> {
    try {
      return await options.produced.text(jobId)
    } catch {
      return null
    }
  }

  return {
    items,
    loading,
    error,
    unreadCount,
    refresh,
    clear,
    markRead,
    text,
    start,
    stop,
    onNewItems,
  }
}

export function useProduced(): ProducedStore {
  return useSession().produced
}
