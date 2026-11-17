/**
 * 按会话分桶的输入区草稿（2026-10-16 抽出；2026-11-17 改为复用通用分桶）
 *
 * 为什么必须分桶：原先只有一个全局草稿——在 A 里打了一半去 B 问一句，那半句会跟着跑到 B 的
 * 输入框（串台），或者在 B 发送时被清掉（丢失）。这里按会话 id 分桶，切换时"存旧、取新"。
 *
 * 具体规则（含 `null` 不建桶的理由）见 `useThreadBuckets.ts`——本文件只保留"草稿口径"：
 * 空串不留桶。抽通用件的动机是引用集合（`useFileMention`）需要同一套规则，规则写两遍会走偏。
 *
 * 只活在内存里：刷新即失（持久化留待后续，避免把"会话级草稿"变成第二套存储契约）。
 */
import type { Ref } from 'vue'

import { THREAD_BUCKETS_LIMIT, useThreadBuckets } from './useThreadBuckets'

export { THREAD_BUCKETS_LIMIT as DRAFT_BUCKETS_LIMIT }

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
export function useThreadDrafts(
  draft: Ref<string>,
  limit: number = THREAD_BUCKETS_LIMIT,
): ThreadDrafts {
  const buckets = useThreadBuckets(draft, () => '', (value) => value === '', limit)
  return {
    stash: (threadId) => buckets.stash(threadId),
    take: (threadId) => buckets.take(threadId),
  }
}
