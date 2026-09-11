/**
 * 模型列表与当前选择（FR-013）
 *
 * 模型是**请求级**参数：切换只改本地状态，随下一条消息提交（`POST .../messages` 的 `model`）。
 * 当前选择缓存于 `sessionStorage` 键 `optagent.model`；缓存值失效（不在最新列表中）时回退默认项。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { ModelsApi } from '../api/models'
import type { ErrorInfo, Model } from '../api/types'
import { STORAGE_KEY_MODEL } from '../constants/limits'
import { toErrorInfo } from '../utils/error-message'
import { useSession } from './useAppSession'

/** 构造参数。 */
export interface ModelsDeps {
  models: ModelsApi
  /** 注入存储（测试用内存实现）；传 `null` 关闭持久化 */
  storage?: Storage | null
}

/** 模型 composable 契约。 */
export interface ModelsStore {
  models: Readonly<Ref<Model[]>>
  current: Readonly<Ref<string | null>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** 当前模型是否为后端默认项 */
  isDefaultSelected: ComputedRef<boolean>
  /** 拉取列表并校正缓存值 */
  load(): Promise<void>
  /** 切换当前模型（仅本地，发送时提交） */
  select(model: string): void
}

/** 创建模型状态。 */
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
        // 缓存值失效 → 回退默认项（多项 is_default 时取第一项）
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

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
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
