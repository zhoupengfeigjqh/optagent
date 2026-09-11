import { describe, expect, it } from 'vitest'

import { createFilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { MAX_UPLOAD_BYTES } from '../constants/limits'
import { createFetchRouter, errorResponse, jsonResponse, makeFile } from '../../tests/helpers'
import { createUploadsStore } from './useUploads'

const UPLOAD_PATH = 'POST /api/files/upload'

function makeStore(routes: Parameters<typeof createFetchRouter>[0]) {
  const router = createFetchRouter(routes)
  const files = createFilesApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  return { store: createUploadsStore({ files }), router }
}

describe('useUploads - 客户端预校验（V-13：不合规不发请求）', () => {
  it('扩展名不在白名单 → failed 且不发请求', async () => {
    const { store, router } = makeStore({})

    await store.upload('生产计划', [makeFile('说明.docx', 1024)])

    expect(router.calls).toHaveLength(0)
    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0].status).toBe('failed')
    expect(store.items.value[0].error?.code).toBe('VALIDATION_FAILED')
  })

  it('超过 50MB → failed 且不发请求', async () => {
    const { store, router } = makeStore({})

    await store.upload('tmp', [makeFile('big.csv', MAX_UPLOAD_BYTES + 1)])

    expect(router.calls).toHaveLength(0)
    expect(store.items.value[0].error?.code).toBe('FILE_TOO_LARGE')
  })

  it('恰好 50MB 允许上传', async () => {
    const { store, router } = makeStore({
      [UPLOAD_PATH]: () => jsonResponse({ dir: 'tmp', filename: 'ok_1.csv', size: 1 }, 201),
    })

    await store.upload('tmp', [makeFile('ok.csv', MAX_UPLOAD_BYTES)])

    expect(router.countOf('POST', '/api/files/upload')).toBe(1)
    expect(store.items.value[0].status).toBe('success')
  })
})

describe('useUploads - 逐文件各发一次请求（§7 差异 5）', () => {
  it('多选 3 个文件产生 3 次请求，状态互相独立', async () => {
    let sequence = 0
    const { store, router } = makeStore({
      [UPLOAD_PATH]: () => {
        sequence += 1
        return jsonResponse({ dir: 'tmp', filename: `f_${sequence}.csv`, size: 10 }, 201)
      },
    })

    await store.upload('tmp', [
      makeFile('a.csv', 10),
      makeFile('b.csv', 10),
      makeFile('c.csv', 10),
    ])

    expect(router.countOf('POST', '/api/files/upload')).toBe(3)
    expect(store.items.value).toHaveLength(3)
    expect(store.items.value.every((item) => item.status === 'success')).toBe(true)
  })

  it('每次请求都带 dir 与 file 两个 part', async () => {
    const { store, router } = makeStore({
      [UPLOAD_PATH]: () => jsonResponse({ dir: '使用规则', filename: 'x_1.csv', size: 1 }, 201),
    })

    await store.upload('使用规则', [makeFile('x.csv', 1)])

    const body = router.calls[0].body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('dir')).toBe('使用规则')
    expect((body.get('file') as File).name).toBe('x.csv')
  })

  it('单个文件失败不影响其他项（Promise.all 各自捕获）', async () => {
    let call = 0
    const { store } = makeStore({
      [UPLOAD_PATH]: () => {
        call += 1
        return call === 2
          ? errorResponse('TMP_WRITE_FAILED', 'disk full', 500)
          : jsonResponse({ dir: 'tmp', filename: `ok_${call}.csv`, size: 1 }, 201)
      },
    })

    await store.upload('tmp', [
      makeFile('a.csv', 1),
      makeFile('b.csv', 1),
      makeFile('c.csv', 1),
    ])

    expect(store.items.value.map((item) => item.status)).toEqual([
      'success',
      'failed',
      'success',
    ])
    expect(store.items.value[1].error?.code).toBe('TMP_WRITE_FAILED')
  })

  it('落盘名取自响应而非本地文件名（后端已加时间戳）', async () => {
    const { store } = makeStore({
      [UPLOAD_PATH]: () =>
        jsonResponse({ dir: 'tmp', filename: '计划_20260910_120000.csv', size: 5 }, 201),
    })

    await store.upload('tmp', [makeFile('计划.csv', 5)])

    expect(store.items.value[0].name).toBe('计划.csv')
    expect(store.items.value[0].serverFilename).toBe('计划_20260910_120000.csv')
  })
})

describe('useUploads - 重试与清理（FR-011）', () => {
  it('retry 对失败项重新发起请求', async () => {
    let fail = true
    const { store, router } = makeStore({
      [UPLOAD_PATH]: () =>
        fail
          ? errorResponse('TMP_WRITE_FAILED', 'x', 500)
          : jsonResponse({ dir: 'tmp', filename: 'retry_1.csv', size: 1 }, 201),
    })

    await store.upload('tmp', [makeFile('a.csv', 1)])
    expect(store.items.value[0].status).toBe('failed')

    fail = false
    await store.retry(store.items.value[0].localId)

    expect(router.countOf('POST', '/api/files/upload')).toBe(2)
    expect(store.items.value[0].status).toBe('success')
    expect(store.items.value[0].error).toBeNull()
  })

  it('retry 预校验失败项时仍不发请求', async () => {
    const { store, router } = makeStore({})
    await store.upload('tmp', [makeFile('a.docx', 1)])

    await store.retry(store.items.value[0].localId)

    expect(router.calls).toHaveLength(0)
    expect(store.items.value[0].status).toBe('failed')
  })

  it('retry 未知 localId 为无操作', async () => {
    const { store, router } = makeStore({})

    await expect(store.retry('missing')).resolves.toBeUndefined()
    expect(router.calls).toHaveLength(0)
  })

  it('clear 只移除已完成项，失败项保留以便重试', async () => {
    const { store } = makeStore({
      [UPLOAD_PATH]: () => jsonResponse({ dir: 'tmp', filename: 'ok.csv', size: 1 }, 201),
    })

    await store.upload('tmp', [makeFile('a.csv', 1)])
    await store.upload('tmp', [makeFile('b.docx', 1)])

    store.clear()

    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0].status).toBe('failed')
  })

  it('上传中的状态先置 uploading 再置 success', async () => {
    const { store } = makeStore({
      [UPLOAD_PATH]: () => jsonResponse({ dir: 'tmp', filename: 'ok.csv', size: 1 }, 201),
    })

    const task = store.upload('tmp', [makeFile('a.csv', 1)])
    expect(store.items.value[0].status).toBe('uploading')

    await task
    expect(store.items.value[0].status).toBe('success')
  })
})
