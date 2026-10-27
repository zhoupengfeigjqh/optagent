/**
 * 单元测试：上传状态机（`useUploads`，012 起补同名测试）
 *
 * 钉住四件事（对应 012 FR-003 / FR-005 / FR-010 / FR-012 / FR-013）：
 * 1. 预校验失败**不发请求**，直接 `failed`（省一次往返）；
 * 2. 逐文件各发一次请求，单个失败不影响其余项；
 * 3. 落盘名只取响应 `filename`（本次改为 `原名 / 原名(n).ext`，前端不拼接）；
 * 4. `clear()` 只清**终态**（成功 / 失败），`pending` / `uploading` 保留——关闭面板时正在传的文件不能消失。
 */
import { describe, expect, it, vi } from 'vitest'

import type { FilesApi } from '../api/files'
import type { ToastStore } from './useToast'
import { createUploadsStore } from './useUploads'

function file(name: string, size = 64): File {
  return new File([new Uint8Array(size)], name, { type: 'text/plain' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeStore(upload: ReturnType<typeof vi.fn>) {
  const toast = { push: vi.fn() } as unknown as ToastStore
  const store = createUploadsStore({ files: { upload } as unknown as FilesApi, toast })
  return { store, toast, upload }
}

describe('useUploads —— 上传状态机', () => {
  it('预校验失败（扩展名不在白名单）→ 直接 failed，不发请求', async () => {
    const upload = vi.fn()
    const { store } = makeStore(upload)

    await store.upload('临时空间', [file('a.exe')], ['.csv'])

    expect(upload).not.toHaveBeenCalled()
    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0]!.status).toBe('failed')
    expect(store.items.value[0]!.error?.code).toBe('VALIDATION_FAILED')
  })

  it('成功：落盘名取响应 filename（带 (1) 后缀也不改写）', async () => {
    const upload = vi.fn().mockResolvedValue({
      dir: '临时空间',
      filename: '报告(1).csv',
      size: 64,
    })
    const { store } = makeStore(upload)

    await store.upload('临时空间', [file('报告.csv')], ['.csv'])

    const item = store.items.value[0]!
    expect(item.status).toBe('success')
    expect(item.serverFilename).toBe('报告(1).csv')
    expect(item.error).toBeNull()
    // 请求带原始文件名，落盘名由服务端决定
    expect(upload).toHaveBeenCalledWith('临时空间', expect.any(File), '报告.csv')
  })

  it('失败：保留 error 与可重试；重试成功后沿用同一 localId', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'boom' })
      .mockResolvedValueOnce({ dir: '临时空间', filename: 'a.csv', size: 64 })
    const { store } = makeStore(upload)

    await store.upload('临时空间', [file('a.csv')], ['.csv'])
    const localId = store.items.value[0]!.localId
    expect(store.items.value[0]!.status).toBe('failed')
    expect(store.items.value[0]!.error?.code).toBe('NETWORK_ERROR')

    await store.retry(localId)

    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0]!.localId).toBe(localId)
    expect(store.items.value[0]!.status).toBe('success')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('retry 未知 localId ⇒ no-op（不抛错、不发请求）', async () => {
    const upload = vi.fn()
    const { store } = makeStore(upload)

    await store.retry('upload-不存在')

    expect(upload).not.toHaveBeenCalled()
    expect(store.items.value).toEqual([])
  })

  it('预校验失败的项点重试 ⇒ 请求前**再次**预校验仍不通过，保持 failed 且不发请求', async () => {
    const upload = vi.fn()
    const { store } = makeStore(upload)

    await store.upload('临时空间', [file('a.exe')], ['.csv'])
    const localId = store.items.value[0]!.localId

    await store.retry(localId)

    expect(upload).not.toHaveBeenCalled()
    expect(store.items.value[0]!.status).toBe('failed')
  })

  it('批量：单个失败不影响其余项，且有失败时只提示一次', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ dir: '临时空间', filename: 'ok.csv', size: 1 })
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'boom' })
    const { store, toast } = makeStore(upload)

    await store.upload('临时空间', [file('ok.csv'), file('bad.csv')], ['.csv'])

    expect(store.items.value.map((item) => item.status)).toEqual(['success', 'failed'])
    expect(toast.push).toHaveBeenCalledTimes(1)
    expect(toast.push).toHaveBeenCalledWith('error', expect.stringContaining('1 个文件上传失败'))
  })
})

describe('useUploads.clear —— 只清终态（012 FR-010 / FR-013）', () => {
  it('1 成功 + 1 失败 + 1 上传中 ⇒ 只剩上传中；其完成后再变成功且不被清掉', async () => {
    const pending = deferred<{ dir: string; filename: string; size: number }>()
    // 调用顺序＝选择顺序：slow（挂起）→ ok → bad
    const upload = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ dir: '临时空间', filename: 'ok.csv', size: 1 })
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'boom' })
    const { store } = makeStore(upload)

    const inFlight = store.upload('临时空间', [file('slow.csv')], ['.csv'])
    await store.upload('临时空间', [file('ok.csv'), file('bad.csv')], ['.csv'])
    expect(store.items.value.map((item) => item.status)).toEqual(['uploading', 'success', 'failed'])

    store.clear()

    // 终态被清，进行中的保留（Q2 = B：关闭面板不丢"正在传"的那一条）
    expect(store.items.value.map((item) => item.status)).toEqual(['uploading'])

    pending.resolve({ dir: '临时空间', filename: 'slow.csv', size: 1 })
    await inFlight

    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0]!.status).toBe('success')
    expect(store.items.value[0]!.serverFilename).toBe('slow.csv')
  })

  it('清空后再上传 ⇒ 从空列表开始，localId 与上一轮不同（FR-012）', async () => {
    const upload = vi.fn().mockResolvedValue({ dir: '临时空间', filename: 'a.csv', size: 1 })
    const { store } = makeStore(upload)

    await store.upload('临时空间', [file('a.csv')], ['.csv'])
    const first = store.items.value[0]!.localId

    store.clear()
    expect(store.items.value).toEqual([])

    await store.upload('临时空间', [file('a.csv')], ['.csv'])
    expect(store.items.value).toHaveLength(1)
    expect(store.items.value[0]!.localId).not.toBe(first)
  })

  it('空列表上清空是幂等的（重复收起不抛错）', () => {
    const { store } = makeStore(vi.fn())

    expect(() => {
      store.clear()
      store.clear()
    }).not.toThrow()
    expect(store.items.value).toEqual([])
  })
})
