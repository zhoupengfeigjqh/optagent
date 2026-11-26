import type { Ref } from 'vue'

import { THREAD_BUCKETS_LIMIT, useThreadBuckets } from './useThreadBuckets'

export { THREAD_BUCKETS_LIMIT as DRAFT_BUCKETS_LIMIT }

export interface ThreadDrafts {
  stash(threadId: string | null): void
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
