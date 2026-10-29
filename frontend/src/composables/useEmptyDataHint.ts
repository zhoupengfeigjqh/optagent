/**
 * 空数据新手引导的状态机（014）。
 *
 * 为什么用**显式 `visible`** 而不是 `computed` 派生（见 `research.md` D4）：
 * 派生写法会在"用户上传后又把文件删空"时让气泡自动重现，而规格只允许"切换数字人"这一个
 * 触发点（FR-005 / FR-014）。显式状态让"出现"只发生在切换后的那一次判定。
 *
 * 依赖由装配层注入（`useAppSession`），本模块不自行取 store，便于单测。
 */
import { ref, watch, type Ref } from 'vue'

import type { ErrorInfo, WorkspaceSpace } from '../api/types'
import { needsDataUpload } from '../utils/empty-data-hint'

/** 装配依赖（最小化：只需清单与加载错误）。 */
export interface EmptyDataHintDeps {
  /** 当前数字人的文件空间清单（`workspace.spaces`） */
  spaces: Readonly<Ref<WorkspaceSpace[]>>
  /** 清单加载错误（`workspace.error`；非空时不提示，且不掩盖既有提示） */
  error: Readonly<Ref<ErrorInfo | null>>
}

/** 对外能力。 */
export interface EmptyDataHint {
  /** 气泡是否展示 */
  visible: Readonly<Ref<boolean>>
  /** 切换数字人**成功**且清单加载完成后调用（唯一触发点） */
  onAgentSwitched(): void
  /** 用户点「×」关闭：本次数字人选择下不再自动出现 */
  dismiss(): void
}

export function useEmptyDataHint(deps: EmptyDataHintDeps): EmptyDataHint {
  const visible = ref(false)
  /** 关闭标记：只在切换数字人时重置 */
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
