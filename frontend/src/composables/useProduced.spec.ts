/**
 * 单元测试：后台产出状态（R11，契约 §10.5 ⑤⑥）
 *
 * 守住四条：
 * 1. **未读数自算** —— 列表内 `read_at` 缺省的条数，不依赖后端计数端点；
 * 2. **标记已读只提交当前未读的**，成功后**就地**更新、**不重拉列表**（避免竞态）；
 * 3. **订阅幂等** —— 重复 `start()` 不叠加连接，`stop()` 后可再 `start()`；
 * 4. **拉取失败不清空列表** —— 失败是"这次没拿到"，不等于"没有产出"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProducedApi, ProducedItem } from '../api/produced'
import { createProducedStore } from './useProduced'

function item(jobId: string, readAt?: string): ProducedItem {
  return {
    job_id: jobId,
    tool: 'ocr__ocr_image',
    size: 10,
    filename: `th_1_${jobId}.txt`,
    status: 'done',
    created_at: '2026-09-25T02:00:00.000Z',
    finished_at: '2026-09-25T02:00:00.000Z',
    relPath: `临时空间/后台产出/th_1_${jobId}.txt`,
    ...(readAt === undefined ? {} : { read_at: readAt }),
  }
}

const api = {
  list: vi.fn(),
  markRead: vi.fn(),
  text: vi.fn(),
  subscribe: vi.fn(),
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ items: [] })
  api.markRead.mockReset().mockResolvedValue({ marked: 0 })
  api.text.mockReset().mockResolvedValue('正文')
  api.subscribe.mockReset().mockReturnValue(() => {})
})

function store() {
  return createProducedStore({ produced: api as unknown as ProducedApi })
}

describe('列表与未读数', () => {
  it('refresh 写入列表；未读数 = read_at 缺省的条数', async () => {
    api.list.mockResolvedValue({ items: [item('a'), item('b', '2026-09-25T03:00:00.000Z')] })
    const s = store()

    await s.refresh()

    expect(s.items.value).toHaveLength(2)
    expect(s.unreadCount.value).toBe(1)
  })

  it('refresh 失败：错误可读，且**不清空**已有列表（失败 ≠ 没有产出）', async () => {
    api.list.mockResolvedValueOnce({ items: [item('a')] })
    const s = store()
    await s.refresh()

    api.list.mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'x' })
    await s.refresh()

    expect(s.error.value?.code).toBe('NETWORK_ERROR')
    expect(s.items.value).toHaveLength(1)
  })
})

describe('标记已读', () => {
  it('成功后**就地**标记、未读数递减，且**不重拉列表**', async () => {
    api.list.mockResolvedValue({ items: [item('a'), item('b')] })
    api.markRead.mockResolvedValue({ marked: 1 })
    const s = store()
    await s.refresh()
    api.list.mockClear()

    await s.markRead(['a'])

    expect(api.markRead).toHaveBeenCalledWith(['a'])
    expect(s.items.value.find((i) => i.job_id === 'a')?.read_at).toBeDefined()
    expect(s.unreadCount.value).toBe(1)
    expect(api.list).not.toHaveBeenCalled()
  })

  it('只提交**当前未读**的（重复点击同一条不会重复打服务端）', async () => {
    api.list.mockResolvedValue({ items: [item('a', '2026-09-25T03:00:00.000Z')] })
    const s = store()
    await s.refresh()

    await s.markRead(['a'])

    expect(api.markRead).not.toHaveBeenCalled()
  })

  it('本地没有该条时也不提交（幽灵 job_id 不浪费一次请求）', async () => {
    const s = store()
    await s.refresh()

    await s.markRead(['never-seen'])

    expect(api.markRead).not.toHaveBeenCalled()
  })

  it('服务端 marked=0 时**不改本地**（服务端没有可写的，本地别自作主张）', async () => {
    api.list.mockResolvedValue({ items: [item('a')] })
    api.markRead.mockResolvedValue({ marked: 0 })
    const s = store()
    await s.refresh()

    await s.markRead(['a'])

    expect(s.items.value[0]?.read_at).toBeUndefined()
    expect(s.unreadCount.value).toBe(1)
  })

  it('标记失败：错误可读，未读数不变（不静默当成已读）', async () => {
    api.list.mockResolvedValue({ items: [item('a')] })
    api.markRead.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'x' })
    const s = store()
    await s.refresh()

    await s.markRead(['a'])

    expect(s.error.value?.code).toBe('NETWORK_ERROR')
    expect(s.unreadCount.value).toBe(1)
  })

  it('空数组直接返回，不打服务端', async () => {
    const s = store()

    await s.markRead([])

    expect(api.markRead).not.toHaveBeenCalled()
  })
})

describe('信号订阅', () => {
  it('start 幂等：重复调用只建一条连接', () => {
    const s = store()

    s.start()
    s.start()

    expect(api.subscribe).toHaveBeenCalledTimes(1)
  })

  it('收到信号即重拉列表（信号只是加速器，数据仍从列表来）', async () => {
    let onSignal: (() => void) | null = null
    api.subscribe.mockImplementation((cb: () => void) => {
      onSignal = cb
      return () => {}
    })
    const s = store()
    s.start()

    onSignal!()
    await Promise.resolve()

    expect(api.list).toHaveBeenCalled()
  })

  it('stop 退订，且**之后可以再 start**（生命周期可重入）', () => {
    const unsubscribe = vi.fn()
    api.subscribe.mockReturnValue(unsubscribe)
    const s = store()
    s.start()

    s.stop()
    s.stop()
    s.start()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(api.subscribe).toHaveBeenCalledTimes(2)
  })
})

describe('正文读取（契约 §10.5 ⑦）', () => {
  it('成功时返回正文', async () => {
    api.text.mockResolvedValue('产能表')
    const s = store()

    expect(await s.text('j_1')).toBe('产能表')
    expect(api.text).toHaveBeenCalledWith('j_1')
  })

  it('失败返回 null 且**不写 error**：局部失败不该让整个面板变错误态', async () => {
    api.text.mockRejectedValue({ code: 'FILE_NOT_FOUND', message: '已被清理' })
    const s = store()

    expect(await s.text('j_1')).toBeNull()
    expect(s.error.value).toBeNull()
  })
})
