/**
 * HITL 装配：工具调用人工确认（自 `useChatPanel.ts` 拆分，宪章原则二）。
 *
 * 只做三件事：
 * 1. 把 SSE 事件或断连恢复快照里的"等待确认"请求交给弹窗渲染；
 * 2. 提交/拒绝转发给 `useChatStream`，服务端终验失败时把逐字段错误回写给弹窗；
 * 3. 断连恢复——线程详情带着等待中的快照时重建弹窗。
 *
 * 不新增字段来源、不持有业务数据：状态仍全部取自传入的 `chat` / `threads`。
 */
import { computed, ref, watch } from 'vue'

import type { useChatStream } from './useChatStream'
import type { useThreads } from './useThreads'

/** 创建 HITL 装配（必须在 `setup()` 内调用）。 */
export function useChatInteraction(
  chat: ReturnType<typeof useChatStream>,
  threads: ReturnType<typeof useThreads>,
) {
  /** 弹窗渲染源：等待确认的工具调用（SSE 事件或断连恢复快照） */
  const pendingInteraction = computed(() => chat.pendingInteraction.value)
  /** 服务端终验失败的逐字段错误（提交失败后回写弹窗） */
  const interactionError = ref('')

  // 断连恢复：线程详情带有等待中的确认快照（页面刷新/重连）→ 重建弹窗
  watch(
    () => threads.pendingInteraction.value,
    (snapshot) => {
      if (snapshot) {
        chat.restoreInteraction(snapshot)
      }
    },
  )

  async function onSubmitInteraction(args: Record<string, unknown>): Promise<void> {
    interactionError.value = ''
    const result = await chat.submitInteraction(args)
    if (!result.close && result.message) {
      interactionError.value = result.message
    }
  }

  function onRejectInteraction(): void {
    interactionError.value = ''
    void chat.rejectInteraction()
  }

  return { pendingInteraction, interactionError, onSubmitInteraction, onRejectInteraction }
}
