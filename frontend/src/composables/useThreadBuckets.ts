/**
 * 按会话分桶的输入区状态（2026-11-17，023 v1.4）
 *
 * 为什么需要通用件：输入区现在有**两样**会话级状态——草稿文本、文件引用——它们必须遵守
 * 同一套"切走存、切回取"规则。规则写两遍迟早走偏（长度上限、淘汰顺序、`null` 语义），
 * 所以抽成一份实现，`useThreadDrafts` 与 `useFileMention` 都基于它。
 *
 * 三条语义（与 `useThreadDrafts` 最初的设计一致）：
 * 1. **切走存、切回取**：`stash(旧)` + `take(新)`；
 * 2. **桶上限**：逛过很多会话也不无限增长，超限先淘汰最久没碰过的那一个；
 * 3. **`null`（视图态新对话）不建桶**：它要么随发送被消费、要么随离开丢弃。若也留一份，
 *    那份状态会变成下次点「新建会话」时冒出来的幽灵。
 *
 * `move(旧, 新)` 是给"自动建会话"用的：首条消息发送时 `null → 真 id`，这批状态属于
 * **正在发送的这条消息**，应当跟着走，而不是当成一次会话切换被丢掉。
 */
import type { Ref } from 'vue'

/** 桶上限：逛过很多会话也不无限增长，超限先淘汰最久没碰过的那一个 */
export const THREAD_BUCKETS_LIMIT = 50

/** 按会话分桶的输入区状态。 */
export interface ThreadBuckets<T> {
  /** 把当前值存进某个会话的桶（"空值"不留桶；超限淘汰最旧） */
  stash(threadId: string | null): void
  /** 取回某个会话的值（无桶 / `null` 会话一律返回空值） */
  take(threadId: string | null): T
  /** 把某个桶整体搬给另一个会话（自动建会话时"接管"，不是"切换"） */
  move(from: string | null, to: string | null): void
  /** 清空所有桶（切换数字人：路径语义已变，旧状态一律作废） */
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
    // 先删后塞：Map 按插入序淘汰，这样"最近用过的桶"排在最后
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
