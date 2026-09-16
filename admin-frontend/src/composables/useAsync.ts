/**
 * 异步数据状态机（loading / error / data），供**全部**列表与详情复用。
 *
 * 统一口径的三点理由：
 * 1. 错误必须经过 `toErrorInfo` 归一，才能交给 `toUserMessage` 按码分派文案
 *    （原则七：前端 MUST NOT 直接展示后端 `message`）；
 * 2. "加载中"与"空结果"必须是**可区分**的两个状态，否则空列表会被误显示为加载失败；
 * 3. 并发请求只保留最后一次结果（避免慢响应覆盖新响应）。
 */

import { ref, shallowRef, type Ref } from 'vue'
import type { ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

export interface AsyncState<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<ErrorInfo | null>
  /** 是否已至少完成过一次加载（用于区分"首次加载中"与"刷新中"） */
  loaded: Ref<boolean>
  /** 执行一次请求；返回是否成功 */
  run(): Promise<boolean>
  /** 清空状态（切换实体时调用，避免残留上一个实体的内容） */
  reset(): void
}

export interface UseAsyncOptions {
  /** 创建后立即执行一次，默认 `false` */
  immediate?: boolean
}

export function useAsync<T>(
  loader: () => Promise<T>,
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  const loaded = ref(false)

  // 只接受最后一次发起的请求结果
  let seq = 0

  async function run(): Promise<boolean> {
    const token = ++seq
    loading.value = true
    error.value = null
    try {
      const result = await loader()
      if (token !== seq) return false
      data.value = result
      loaded.value = true
      return true
    } catch (err) {
      if (token !== seq) return false
      error.value = toErrorInfo(err)
      return false
    } finally {
      if (token === seq) loading.value = false
    }
  }

  function reset(): void {
    seq += 1
    data.value = null
    error.value = null
    loaded.value = false
    loading.value = false
  }

  if (options.immediate) void run()

  return { data, loading, error, loaded, run, reset }
}
