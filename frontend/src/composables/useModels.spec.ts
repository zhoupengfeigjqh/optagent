import { describe, expect, it } from 'vitest'

import { createHttpClient } from '../api/http'
import { createModelsApi } from '../api/models'
import { STORAGE_KEY_MODEL } from '../constants/limits'
import { createFetchRouter, jsonResponse, memoryStorage } from '../../tests/helpers'
import { createModelsStore } from './useModels'

const LIST = {
  models: [
    { model: 'gpt-4o', is_default: false },
    { model: 'qwen-max', is_default: true },
    { model: 'deepseek-v3', is_default: false },
  ],
}

function makeStore(
  routes: Parameters<typeof createFetchRouter>[0],
  storage = memoryStorage(),
) {
  const router = createFetchRouter(routes)
  const models = createModelsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  return { store: createModelsStore({ models, storage }), storage, router }
}

describe('useModels', () => {
  it('首次加载选中后端默认模型', async () => {
    const { store } = makeStore({ 'GET /api/models': () => jsonResponse(LIST) })

    await store.load()

    expect(store.models.value).toHaveLength(3)
    expect(store.current.value).toBe('qwen-max')
    expect(store.isDefaultSelected.value).toBe(true)
  })

  it('缓存值仍在新列表中时沿用缓存（跨刷新保持选择）', async () => {
    const storage = memoryStorage({ [STORAGE_KEY_MODEL]: 'deepseek-v3' })
    const { store } = makeStore({ 'GET /api/models': () => jsonResponse(LIST) }, storage)

    await store.load()

    expect(store.current.value).toBe('deepseek-v3')
    expect(store.isDefaultSelected.value).toBe(false)
  })

  it('缓存值失效（不在列表中）时回退默认项', async () => {
    const storage = memoryStorage({ [STORAGE_KEY_MODEL]: '已下线模型' })
    const { store } = makeStore({ 'GET /api/models': () => jsonResponse(LIST) }, storage)

    await store.load()

    expect(store.current.value).toBe('qwen-max')
    expect(storage.getItem(STORAGE_KEY_MODEL)).toBe('qwen-max')
  })

  it('无默认标记时回退列表首项', async () => {
    const { store } = makeStore({
      'GET /api/models': () =>
        jsonResponse({ models: [{ model: 'a', is_default: false }, { model: 'b', is_default: false }] }),
    })

    await store.load()

    expect(store.current.value).toBe('a')
  })

  it('列表为空时 current 为 null（发送时不提交 model 字段）', async () => {
    const storage = memoryStorage({ [STORAGE_KEY_MODEL]: 'x' })
    const { store } = makeStore({ 'GET /api/models': () => jsonResponse({ models: [] }) }, storage)

    await store.load()

    expect(store.current.value).toBeNull()
    expect(storage.getItem(STORAGE_KEY_MODEL)).toBeNull()
  })

  it('select 只改本地状态并写入缓存（不产生网络请求）', async () => {
    const { store, router, storage } = makeStore({
      'GET /api/models': () => jsonResponse(LIST),
    })
    await store.load()

    store.select('gpt-4o')

    expect(store.current.value).toBe('gpt-4o')
    expect(storage.getItem(STORAGE_KEY_MODEL)).toBe('gpt-4o')
    expect(router.calls).toHaveLength(1)
  })

  it('多项 is_default 时取第一项（不假设唯一）', async () => {
    const { store } = makeStore({
      'GET /api/models': () =>
        jsonResponse({
          models: [
            { model: 'first', is_default: true },
            { model: 'second', is_default: true },
          ],
        }),
    })

    await store.load()

    expect(store.current.value).toBe('first')
  })

  it('storage 为 null 时不持久化但仍可用', async () => {
    const router = createFetchRouter({ 'GET /api/models': () => jsonResponse(LIST) })
    const models = createModelsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
    const store = createModelsStore({ models, storage: null })

    await store.load()
    store.select('gpt-4o')

    expect(store.current.value).toBe('gpt-4o')
  })

  it('加载失败时记录错误且模型列表为空', async () => {
    const { store } = makeStore({
      'GET /api/models': () => jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500),
    })

    await store.load()

    expect(store.error.value?.code).toBe('INTERNAL_ERROR')
    expect(store.models.value).toEqual([])
    expect(store.loading.value).toBe(false)
  })
})
