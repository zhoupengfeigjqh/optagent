import { describe, expect, it } from 'vitest'

import { createFilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { SPACE_DIRECTORIES } from '../constants/directories'
import { createFetchRouter, errorResponse, jsonResponse } from '../../tests/helpers'
import { createWorkspaceStore, emptyWorkspace } from './useWorkspace'

function makeStore(routes: Parameters<typeof createFetchRouter>[0]) {
  const router = createFetchRouter(routes)
  const files = createFilesApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  return { store: createWorkspaceStore({ files }), router }
}

describe('useWorkspace', () => {
  it('加载前即为 9 个空目录（顺序与常量一致）', () => {
    const { store } = makeStore({})

    expect(store.dirs.value).toHaveLength(9)
    expect(store.dirs.value.map((item) => item.dir)).toEqual(
      SPACE_DIRECTORIES.map((item) => item.dir),
    )
    expect(store.dirs.value.every((item) => item.files.length === 0)).toBe(true)
  })

  it('后端只返回部分目录时，仍归一化为 9 个且顺序固定（SC-021）', async () => {
    const { store } = makeStore({
      'GET /api/files/workspace': () =>
        jsonResponse({
          dirs: [
            { dir: 'tmp', files: [{ filename: 'a.csv', size: 1, updated_at: '2026-09-10T00:00:00Z' }] },
            { dir: '共享空间-误写', files: [] },
          ],
        }),
    })

    await store.load()

    expect(store.dirs.value.map((item) => item.dir)).toEqual(
      SPACE_DIRECTORIES.map((item) => item.dir),
    )
    expect(store.filesOf('tmp')).toHaveLength(1)
    // 非白名单目录被丢弃
    expect(store.dirs.value.some((item) => item.dir === '共享空间-误写')).toBe(false)
  })

  it('后端返回的目录顺序被打乱时按常量顺序重排', async () => {
    const { store } = makeStore({
      'GET /api/files/workspace': () =>
        jsonResponse({
          dirs: [
            { dir: 'tmp', files: [] },
            { dir: '生产计划', files: [] },
            { dir: 'shared', files: [] },
          ],
        }),
    })

    await store.load()

    expect(store.dirs.value.map((item) => item.dir).slice(0, 2)).toEqual(['生产计划', '产线信息'])
    expect(store.dirs.value.at(-1)?.dir).toBe('tmp')
  })

  it('filesOf 对未知目录返回空数组', () => {
    const { store } = makeStore({})

    expect(store.filesOf('不存在')).toEqual([])
  })

  it('exists 依据当前清单判断引用有效性（V-15）', async () => {
    const { store } = makeStore({
      'GET /api/files/workspace': () =>
        jsonResponse({
          dirs: [
            {
              dir: '生产计划',
              files: [{ filename: '计划_1.csv', size: 10, updated_at: '2026-09-10T00:00:00Z' }],
            },
          ],
        }),
    })

    await store.load()

    expect(store.exists({ dir: '生产计划', filename: '计划_1.csv' })).toBe(true)
    expect(store.exists({ dir: '生产计划', filename: '计划_2.csv' })).toBe(false)
    expect(store.exists({ dir: 'tmp', filename: '计划_1.csv' })).toBe(false)
  })

  it('加载失败时保持 9 个空目录并记录错误（界面不塌陷）', async () => {
    const { store } = makeStore({
      'GET /api/files/workspace': () => errorResponse('INTERNAL_ERROR', 'boom', 500),
    })

    await store.load()

    expect(store.error.value?.code).toBe('INTERNAL_ERROR')
    expect(store.dirs.value).toHaveLength(9)
    expect(store.loading.value).toBe(false)
  })

  it('emptyWorkspace 返回全新数组（避免共享可变引用）', () => {
    const first = emptyWorkspace()
    const second = emptyWorkspace()

    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first).toHaveLength(9)
  })
})
