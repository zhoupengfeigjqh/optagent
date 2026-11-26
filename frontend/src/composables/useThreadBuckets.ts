import type { Ref } from 'vue'

/** 桶上限：逛过很多会话也不无限增长，超限先淘汰最久没碰过的那一个 */
export const THREAD_BUCKETS_LIMIT = 50

export interface ThreadBuckets<T> {
  stash(threadId: string | null): void
  take(threadId: string | null): T
  move(from: string | null, to: string | null): void
  clear(): void
}

/**
 * @param state 当前输入区状态（读写，状态源）
 * @param empty 空值工厂（`''` / `[]`）
 * @param isEmpty 判定"不留桶"的空值口径
 * @param limit 桶上限（测试可注入更小值）
 */
export function useThreadBuckets<T>(
  state: Ref<T>,
  empty: () => T,
  isEmpty: (value: T) => boolean,
  limit: number = THREAD_BUCKETS_LIMIT,
): ThreadBuckets<T> {
  const buckets = new Map<string, T>()

  function stash(threadId: string | null): void {
    if (threadId === null) return
    buckets.delete(threadId)
    if (isEmpty(state.value)) return
    buckets.set(threadId, state.value)
    while (buckets.size > limit) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  function take(threadId: string | null): T {
    return threadId === null ? empty() : (buckets.get(threadId) ?? empty())
  }

  function move(from: string | null, to: string | null): void {
    if (to === null) return
    const value = from === null ? state.value : (buckets.get(from) ?? state.value)
    if (from !== null) buckets.delete(from)
    if (isEmpty(value)) return
    buckets.delete(to)
    buckets.set(to, value)
  }

  function clear(): void {
    buckets.clear()
  }

  return { stash, take, move, clear }
}
