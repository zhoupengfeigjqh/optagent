import { describe, expect, it } from 'vitest'

import { createFilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { SPACE_DIRECTORIES } from '../constants/directories'
import { createFetchRouter, errorResponse, jsonResponse } from '../../tests/helpers'
import { createToastStore } from './useToast'
import { createWorkspaceStore, emptyWorkspace } from './useWorkspace'

function makeStore(routes: Parameters<typeof createFetchRouter>[0]) {
  const router = createFetchRouter(routes)
  const files = createFilesApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  // 提示队列是删除结果的观察点；拉长存活时长，避免测试收尾时定时器仍在飞
  const toast = createToastStore({ durationMs: 60_000 })
  return { store: createWorkspaceStore({ files, toast }), router, toast }
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

  /* ---------- US8：折叠状态 ---------- */

  it('分组折叠状态默认全收起，toggleDir 可往返且不影响清单', async () => {
    const { store } = makeStore({})

    expect(store.expandedDirs.value).toEqual([])

    store.toggleDir('生产计划')
    expect(store.expandedDirs.value).toEqual(['生产计划'])

    store.toggleDir('tmp')
    expect(store.expandedDirs.value).toEqual(['生产计划', 'tmp'])

    store.toggleDir('生产计划')
    expect(store.expandedDirs.value).toEqual(['tmp'])
  })

  it('重新加载清单不会重置折叠状态（本次会话内保持）', async () => {
    let call = 0
    const { store } = makeStore({
      'GET /api/files/workspace': () => {
        call += 1
        return jsonResponse({ dirs: [{ dir: 'tmp', files: [] }] })
      },
    })

    store.toggleDir('tmp')
    await store.load()
    await store.load()

    expect(call).toBe(2)
    expect(store.expandedDirs.value).toEqual(['tmp'])
  })

  /* ---------- US8：删除 ---------- */

  it('删除成功后仅移除该条并提示成功', async () => {
    const { store, router, toast } = makeStore({
      'GET /api/files/workspace': () =>
        jsonResponse({
          dirs: [
            {
              dir: '生产计划',
              files: [
                { filename: 'a.csv', size: 1, updated_at: '2026-09-10T00:00:00Z' },
                { filename: 'b.csv', size: 2, updated_at: '2026-09-10T00:00:00Z' },
              ],
            },
            { dir: 'tmp', files: [{ filename: 'c.csv', size: 3, updated_at: '2026-09-10T00:00:00Z' }] },
          ],
        }),
      'DELETE /api/files': () =>
        jsonResponse({ dir: '生产计划', filename: 'a.csv', deleted: true }),
    })

    await store.load()
    const removed = await store.remove({ dir: '生产计划', filename: 'a.csv' })

    expect(removed).toBe(true)
    expect(store.filesOf('生产计划').map((file) => file.filename)).toEqual(['b.csv'])
    // 其他目录不受影响
    expect(store.filesOf('tmp')).toHaveLength(1)
    expect(router.countOf('DELETE', '/api/files')).toBe(1)
    expect(toast.items.value.at(-1)?.level).toBe('success')
    expect(toast.items.value.at(-1)?.text).toContain('a.csv')
  })

  it('删除失败时提示原因且清单不变（共享目录被后端拒绝）', async () => {
    const { store, toast } = makeStore({
      'GET /api/files/workspace': () =>
        jsonResponse({
          dirs: [
            {
              dir: 'shared',
              files: [{ filename: 'ref.csv', size: 1, updated_at: '2026-09-10T00:00:00Z' }],
            },
          ],
        }),
      'DELETE /api/files': () =>
        errorResponse('FILE_READONLY', '共享空间为只读目录，不支持删除', 403),
    })

    await store.load()
    const removed = await store.remove({ dir: 'shared', filename: 'ref.csv' })

    expect(removed).toBe(false)
    expect(store.filesOf('shared')).toHaveLength(1)
    expect(toast.items.value.at(-1)?.level).toBe('error')
    expect(toast.items.value.at(-1)?.text).toContain('只读')
  })
})
