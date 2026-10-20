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

  /**
   * 请求代际（**切换数字人必须重拉**，见 `clear()`）。
   *
   * 后端清单按"当前选中数字人"定位目录，切人瞬间在途的旧请求可能晚于新请求返回；
   * 只有最新一代的响应允许写回状态，否则旧数字人的列表会覆盖新数字人的。
   */
  let generation = 0

  const unreadCount = computed(
    () => items.value.filter((item) => item.read_at === undefined).length,
  )

  async function refresh(): Promise<void> {
    const token = ++generation
    loading.value = true
    error.value = null
    try {
      const next = (await options.produced.list(options.limit)).items
      if (token !== generation) return
      items.value = next
    } catch (err) {
      if (token !== generation) return
      error.value = toErrorInfo(err)
    } finally {
      if (token === generation) loading.value = false
    }
  }

  function clear(): void {
    // 自增即作废旧代际：在途请求返回后一律丢弃（含它 finally 里的 loading 归位）
    generation++
    items.value = []
    error.value = null
    loading.value = false
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
    // 代际快照：请求期间若切了数字人（`clear()`），旧条目的已读回写一律丢弃
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

  async function text(jobId: string): Promise<string | null> {
    try {
      return await options.produced.text(jobId)
    } catch {
      // 刻意吞掉：见接口注释——这是"某一条读不出来"，不该让整面板进入错误态
      return null
    }
  }

  return { items, loading, error, unreadCount, refresh, clear, markRead, text, start, stop }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useProduced(): ProducedStore {
  return useSession().produced
}
