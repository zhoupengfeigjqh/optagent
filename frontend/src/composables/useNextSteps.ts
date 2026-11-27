
import { ref, watch, type Ref } from 'vue'

import { emptyNextSteps, type NextStepsApi } from '../api/next-steps'
import type { ThreadNextSteps } from '../api/threads'
import { useSession } from './useAppSession'

export interface NextStepsStoreOptions {
  nextSteps: NextStepsApi
  activeThreadId: Readonly<Ref<string | null>>
}

export interface NextStepsStore {
  readonly steps: Readonly<Ref<ThreadNextSteps>>
  apply(steps: ThreadNextSteps): void
  reset(): void
}

export function createNextStepsStore(options: NextStepsStoreOptions): NextStepsStore {
  const steps = ref<ThreadNextSteps>(emptyNextSteps())

  async function restore(threadId: string): Promise<void> {
    let result: ThreadNextSteps
    try {
      result = await options.nextSteps.fetch(threadId)
    } catch {
      // 兜底（api 层已把失败收敛成空形态）：这里再兜一次，避免 `void restore(...)` 变成
      // unhandled rejection —— 附加能力失败绝不能打扰用户，也不能污染控制台
      return
    }
    if (options.activeThreadId.value !== threadId) return
    steps.value = result
  }

  /**
   * 切换 / 新建 / 恢复会话：清空 + 拉取最新一轮卡片（含"退出到无会话"）。
   *
   * 契约：本 watch **只认"变化"**，故 `activeThreadId` 的持有者 MUST NOT 在订阅前预置初值
   * （见 `useAppSession`）——刷新恢复依赖"装配期 null → 视图 select 写入目标 id"这一次变化。
   */
  watch(options.activeThreadId, (threadId) => {
    steps.value = emptyNextSteps()
    if (threadId !== null) void restore(threadId)
  })

  function apply(next: ThreadNextSteps): void {
    steps.value = next
  }

  function reset(): void {
    steps.value = emptyNextSteps()
  }

  return { steps, apply, reset }
}

export function useNextSteps(): NextStepsStore {
  return useSession().nextSteps
}
