/**
 * 按会话分桶的输入区草稿（2026-10-16，自 `useChatStream.ts` 抽出）
 *
 * 抽出来的理由：它是一段**自带状态与淘汰策略**的独立单元（一张有上限的 Map + 两个动作），
 * 与"本轮运行状态机"没有任何关系；搬运时行为零变化（宪章原则二：单文件 ≤500 行）。
 *
 * 为什么必须分桶：原先只有一个全局草稿——在 A 里打了一半去 B 问一句，那半句会跟着跑到 B 的
 * 输入框（串台），或者在 B 发送时被清掉（丢失）。这里按会话 id 分桶，切换时"存旧、取新"。
 *
 * `null`（视图态新对话，FR-010）**不建桶**：它要么随发送被消费、要么随离开丢弃；
 * 若也留一份，首条消息发送时（`threads.create()` 让 id 由 `null` 变为真 id）那份文本
 * 会变成下次点「新建会话」时冒出来的幽灵草稿。
 *
 * 只活在内存里：刷新即失（持久化留待后续，避免把"会话级草稿"变成第二套存储契约）。
 */
import type { Ref } from 'vue'

/** 桶上限：逛过很多会话也不无限增长，超限先淘汰最久没碰过的那一个 */
export const DRAFT_BUCKETS_LIMIT = 50

/** 会话草稿桶。 */
export interface ThreadDrafts {
  /** 把当前草稿存进某个会话的桶（空串不留桶；超限淘汰最旧） */
  stash(threadId: string | null): void
  /** 取回某个会话的草稿（无桶 / `null` 会话一律返回空串） */
  take(threadId: string | null): string
}

/**
 * @param draft 当前输入区文本（读写，状态源）
 * @param limit 桶上限（测试可注入更小值）
 */
export function useThreadDrafts(draft: Ref<string>, limit: number = DRAFT_BUCKETS_LIMIT): ThreadDrafts {
  const drafts = new Map<string, string>()

  function stash(threadId: string | null): void {
    if (threadId === null) return
    // 先删后塞：Map 按插入序淘汰，这样"最近用过的桶"排在最后
    drafts.delete(threadId)
    if (draft.value === '') return
    drafts.set(threadId, draft.value)
    while (drafts.size > limit) {
      const oldest = drafts.keys().next().value
      if (oldest === undefined) break
      drafts.delete(oldest)
    }
  }

  function take(threadId: string | null): string {
    return threadId === null ? '' : (drafts.get(threadId) ?? '')
  }

  return { stash, take }
}
