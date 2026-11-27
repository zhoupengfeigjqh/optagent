import { ref, watch, type Ref } from 'vue'

import type { ErrorInfo, WorkspaceSpace } from '../api/types'
import { needsDataUpload } from '../utils/empty-data-hint'

export interface EmptyDataHintDeps {
  spaces: Readonly<Ref<WorkspaceSpace[]>>
  error: Readonly<Ref<ErrorInfo | null>>
}

export interface EmptyDataHint {
  visible: Readonly<Ref<boolean>>
  onAgentSwitched(): void
  dismiss(): void
}

export function useEmptyDataHint(deps: EmptyDataHintDeps): EmptyDataHint {
  const visible = ref(false)
  const dismissed = ref(false)

  function evaluate(): void {
    visible.value =
      !dismissed.value && deps.error.value === null && needsDataUpload(deps.spaces.value)
  }

  /**
   * 条件失效自动隐藏（FR-015）：上传成功后 `registerFile` 会就地改写 `spaces`，
   * 此时气泡说的"还没有准备数据"已不成立，必须自己消失。
   *
   * 注意这里**不**重置 `dismissed`，也不反向触发出现——否则"删空文件"会让气泡重现，
   * 违反"只有切换数字人才重新判定"。
   */
  watch([deps.spaces, deps.error], () => {
    if (!visible.value) return
    if (deps.error.value !== null || !needsDataUpload(deps.spaces.value)) visible.value = false
  })

  return {
    visible,
    onAgentSwitched(): void {
      dismissed.value = false
      evaluate()
    },
    dismiss(): void {
      dismissed.value = true
      visible.value = false
    },
  }
}
