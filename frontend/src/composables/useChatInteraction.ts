import { computed, ref, watch } from 'vue'

import type { useChatStream } from './useChatStream'
import type { useThreads } from './useThreads'

/** 创建 HITL 装配（必须在 `setup()` 内调用）。 */
export function useChatInteraction(
  chat: ReturnType<typeof useChatStream>,
  threads: ReturnType<typeof useThreads>,
) {
  const pendingInteraction = computed(() => chat.pendingInteraction.value)
  const interactionError = ref('')

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
