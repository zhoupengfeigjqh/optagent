/**
 * 后台产出（R11，契约 §10.5 ⑤⑥）：列表 + 未读数 + 标记已读 + 信号订阅。
 *
 * 三条语义（都直接来自契约，别在这里"顺手优化"掉）：
 *
 * 1. **未读数由本 store 自算**（列表里 `read_at` 缺省的条数）——不新增计数端点、
 *    不落第二份可漂移的状态（原则五：目录即索引）。
 * 2. **信号只是加速器**：收到信号即重拉列表；信号丢失**无后果**（产出物是文件，
 *    可重算），所以打开页面时**主动拉一次**就能补齐离线期间到达的产出。
 * 3. **标记已读只由"点开某条查看"触发**——打开列表本身 MUST NOT 标记，
 *    否则"未读"无从表达、角标永远是 0（§10.5 ⑤）。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ProducedApi, ProducedItem } from '../api/produced'
import type { ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

/** store 构造参数。 */
export interface ProducedStoreOptions {
  produced: ProducedApi
  /** 列表条数上限；缺省走后端默认（有界返回） */
  limit?: number
}

/** 后台产出 store。 */
export interface ProducedStore {
  readonly items: Readonly<Ref<ProducedItem[]>>
  readonly loading: Readonly<Ref<boolean>>
  readonly error: Readonly<Ref<ErrorInfo | null>>
  /** 未读数（列表内 `read_at` 缺省的条数）；角标即用它 */
  readonly unreadCount: ComputedRef<number>
  /** 拉取列表（打开页面 / 收到信号 / 手动刷新） */
  refresh(): Promise<void>
  /** 批量标记已读（幂等）；成功后**就地**改本地状态，不重拉列表 */
  markRead(jobIds: readonly string[]): Promise<void>
  /**
   * 读产出正文（供"点开查看"）。
   *
   * 失败返回 `null` **且不写 `error`**：这是"看某一条"的局部失败（多半是已被 7 天清理），
   * 写进全局错误会让整个面板变成错误态、把还能看的其它条目一起遮掉。
   * 界面据此给**局部降级文案**而不是通用报错。
   */
  text(jobId: string): Promise<string | null>
  /** 开始订阅信号（**幂等**：重复调用不叠加连接） */
  start(): void
  /** 停止订阅（组件卸载时调用；之后可再次 `start()`） */
  stop(): void
}

/** 创建后台产出 store。 */
export function createProducedStore(options: ProducedStoreOptions): ProducedStore {
  const items = ref<ProducedItem[]>([])
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  /** 当前订阅的退订函数；`null` = 未订阅（`start()` 的幂等判据） */
  let unsubscribe: (() => void) | null = null

  const unreadCount = computed(
    () => items.value.filter((item) => item.read_at === undefined).length,
  )

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      items.value = (await options.produced.list(options.limit)).items
    } catch (err) {
      error.value = toErrorInfo(err)
    } finally {
      loading.value = false
    }
  }

  /**
   * 标记已读。
   *
   * **成功后就地改本地项、不重拉列表**：重拉会把"面板打开期间新到达的产出"与本地的
   * 已读状态搅在一次竞态里（新条目可能被旧响应覆盖）。`read_at` 用本地时刻：
   * 它只承担"是不是已读"与"何时读的"两件事，毫秒级偏差无实质影响；
   * 真正权威的值由下一次 `refresh()` 自然拉回。
   *
   * 与后端同口径地**只标记当前未读的**本地条目：请求里可能混入已读项（重复点击）
   * 或已被清理的项（后端忽略），此处都无需回改。
   */
  async function markRead(jobIds: readonly string[]): Promise<void> {
    if (jobIds.length === 0) return
    const wanted = new Set(jobIds)
    const pending = items.value.filter(
      (item) => wanted.has(item.job_id) && item.read_at === undefined,
    )
    if (pending.length === 0) return
    try {
      const { marked } = await options.produced.markRead(pending.map((item) => item.job_id))
      if (marked === 0) return
      const at = new Date().toISOString()
      items.value = items.value.map((item) =>
        wanted.has(item.job_id) && item.read_at === undefined ? { ...item, read_at: at } : item,
      )
    } catch (err) {
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

  async function text(jobId: string): Promise<string | null> {
    try {
      return await options.produced.text(jobId)
    } catch {
      // 刻意吞掉：见接口注释——这是"某一条读不出来"，不该让整面板进入错误态
      return null
    }
  }

  return { items, loading, error, unreadCount, refresh, markRead, text, start, stop }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useProduced(): ProducedStore {
  return useSession().produced
}
