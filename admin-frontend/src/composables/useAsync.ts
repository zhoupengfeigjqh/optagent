
import { ref, shallowRef, type Ref } from 'vue'
import type { ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

export interface AsyncState<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<ErrorInfo | null>
  loaded: Ref<boolean>
  run(): Promise<boolean>
  /** 清空状态（切换实体时调用，避免残留上一个实体的内容） */
  reset(): void
}

export interface UseAsyncOptions {
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
