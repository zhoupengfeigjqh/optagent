
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ModelsApi } from '../api/models'
import type { ErrorInfo, Model } from '../api/types'
import { STORAGE_KEY_MODEL } from '../constants/limits'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

export interface ModelsDeps {
  models: ModelsApi
  storage?: Storage | null
}

export interface ModelsStore {
  models: Readonly<Ref<Model[]>>
  current: Readonly<Ref<string | null>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  isDefaultSelected: ComputedRef<boolean>
  load(): Promise<void>
  select(model: string): void
}

export function createModelsStore(deps: ModelsDeps): ModelsStore {
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage

  const models = ref<Model[]>([])
  const current = ref<string | null>(readStoredModel(storage))
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)

  const isDefaultSelected = computed(() => {
    const selected = current.value
    if (selected === null) {
      return false
    }
    return models.value.some((item) => item.model === selected && item.is_default)
  })

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const list = await deps.models.list()
      models.value = list

      const stored = readStoredModel(storage)
      const usable = stored !== null && list.some((item) => item.model === stored)
      if (!usable) {
        const fallback = list.find((item) => item.is_default)?.model ?? list[0]?.model ?? null
        current.value = fallback
        writeStoredModel(storage, fallback)
      } else {
        current.value = stored
      }
    } catch (cause) {
      error.value = toErrorInfo(cause)
      models.value = []
    } finally {
      loading.value = false
    }
  }

  function select(model: string): void {
    current.value = model
    writeStoredModel(storage, model)
  }

  return { models, current, loading, error, isDefaultSelected, load, select }
}

export function useModels(): ModelsStore {
  return useSession().models
}

/* ---------- sessionStorage 读写（容错：隐私模式 / SSR 下不可用） ---------- */

function safeSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

function readStoredModel(storage: Storage | null): string | null {
  try {
    const value = storage?.getItem(STORAGE_KEY_MODEL)
    return value === null || value === undefined || value === '' ? null : value
  } catch {
    return null
  }
}

function writeStoredModel(storage: Storage | null, model: string | null): void {
  try {
    if (model === null) {
      storage?.removeItem(STORAGE_KEY_MODEL)
      return
    }
    storage?.setItem(STORAGE_KEY_MODEL, model)
  } catch {
    // 存储不可用时静默降级：模型仍在本轮内存中生效
  }
}
