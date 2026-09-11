import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { createHttpClient } from '../api/http'
import { createThreadsApi } from '../api/threads'
import type { Conversation, Message } from '../api/types'
import { HISTORY_DEFAULT_LIMIT, HISTORY_EXPANDED_LIMIT } from '../constants/limits'
import { createFetchRouter, errorResponse, jsonResponse } from '../../tests/helpers'
import { createThreadsStore } from './useThreads'
import { createToastStore } from './useToast'

function conversation(index: number, updatedAt: string): Conversation {
  return {
    thread_id: `t${index}`,
    agent_name: 'ops',
    title: `会话 ${index}`,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: updatedAt,
  }
}

function message(id: string, content: string): Message {
  return { id, role: 'user', content, ts: '2026-09-10T00:00:00Z', feedback: null }
}

function makeStore(
  routes: Parameters<typeof createFetchRouter>[0],
  agentName: string | null = 'ops',
) {
  const router = createFetchRouter(routes)
  const threadsApi = createThreadsApi(createHttpClient({ baseUrl: '', fetchImpl: router.fetch }))
  const activeThreadId = ref<string | null>(null)
  const currentAgentName = ref<string | null>(agentName)
  const toast = createToastStore()
  const store = createThreadsStore({
    threads: threadsApi,
    activeThreadId,
    currentAgentName,
    toast,
  })
  return { store, router, activeThreadId, toast }
}

describe('useThreads - 列表与切片（V-09：10/100 为纯前端切片）', () => {
  it('loadList 不传 limit / offset（后端 Schema 会拒绝）', async () => {
    const { store, router } = makeStore({
      'GET /api/threads': () => jsonResponse([conversation(1, '2026-09-10T00:00:00Z')]),
    })

    await store.loadList()

    expect(router.calls[0].url).toBe('/api/threads')
    expect(router.calls[0].query.size).toBe(0)
  })

  it('列表按 updated_at 倒序', async () => {
    const { store } = makeStore({
      'GET /api/threads': () =>
        jsonResponse([
          conversation(1, '2026-09-01T00:00:00Z'),
          conversation(2, '2026-09-09T00:00:00Z'),
          conversation(3, '2026-09-05T00:00:00Z'),
        ]),
    })

    await store.loadList()

    expect(store.list.value.map((item) => item.thread_id)).toEqual(['t2', 't3', 't1'])
  })

  it('默认只展示 10 条', async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      conversation(index, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    )
    const { store } = makeStore({ 'GET /api/threads': () => jsonResponse(items) })

    await store.loadList()

    expect(store.list.value).toHaveLength(12)
    expect(store.visible.value).toHaveLength(HISTORY_DEFAULT_LIMIT)
  })

  it('showMore 切到 100 条且不产生任何网络请求', async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      conversation(index, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    )
    const { store, router } = makeStore({ 'GET /api/threads': () => jsonResponse(items) })
    await store.loadList()
    const before = router.calls.length

    store.showMore()

    expect(store.limit.value).toBe(HISTORY_EXPANDED_LIMIT)
    expect(store.visible.value).toHaveLength(12)
    expect(router.calls).toHaveLength(before)
  })

  it('带 agent_name 过滤时作为查询参数提交', async () => {
    const { store, router } = makeStore({
      'GET /api/threads': () => jsonResponse([]),
    })

    await store.loadList()

    expect(router.calls[0].query.get('agent_name')).toBeNull()
  })
})

describe('useThreads - 新建会话（FR-041、FR-042）', () => {
  it('未选数字人时不发请求且提示', async () => {
    const { store, router, toast } = makeStore({}, null)

    await store.create()

    expect(router.calls).toHaveLength(0)
    expect(toast.items.value[0]?.text).toBe('请先选择数字人')
    expect(store.activeId.value).toBeNull()
  })

  it('新建成功切换当前会话并刷新列表', async () => {
    const { store, router, activeThreadId } = makeStore({
      'POST /api/threads': () =>
        jsonResponse(
          { thread_id: 'new-1', title: null, created_at: '2026-09-10T00:00:00Z' },
          201,
        ),
      'GET /api/threads': () => jsonResponse([conversation(9, '2026-09-10T00:00:00Z')]),
    })

    await store.create()

    expect(router.bodiesOf('POST', '/api/threads')).toEqual([{ agent_name: 'ops' }])
    expect(activeThreadId.value).toBe('new-1')
    expect(store.messages.value).toEqual([])
    expect(store.list.value).toHaveLength(1)
  })

  it('创建失败（409）时保留当前视图并提示', async () => {
    const { store, toast } = makeStore({
      'POST /api/threads': () => errorResponse('AGENT_NOT_SELECTED', 'not-selected', 409),
    })

    await store.create()

    expect(toast.items.value[0]?.text).toContain('请先选择数字人')
    expect(store.activeId.value).toBeNull()
  })
})

describe('useThreads - 详情与分页（contracts §3.3）', () => {
  it('select 加载详情并映射 total / running', async () => {
    const { store, activeThreadId, router } = makeStore({
      'GET /api/threads/t1': () =>
        jsonResponse({
          ...conversation(1, '2026-09-10T00:00:00Z'),
          thread_id: 't1',
          total: 120,
          running: true,
          messages: [message('m1', '你好')],
        }),
    })

    await store.select('t1')

    expect(activeThreadId.value).toBe('t1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.total.value).toBe(120)
    expect(store.running.value).toBe(true)
    expect(router.calls[0].query.get('limit')).toBe('50')
  })

  it('hasMore 依据已加载条数与 total', async () => {
    const { store } = makeStore({
      'GET /api/threads/t1': () =>
        jsonResponse({
          ...conversation(1, '2026-09-10T00:00:00Z'),
          thread_id: 't1',
          total: 3,
          running: false,
          messages: [message('m1', 'a')],
        }),
    })

    await store.select('t1')

    expect(store.hasMore.value).toBe(true)
  })

  it('loadMore 前置更早消息并按 id 去重', async () => {
    let call = 0
    const { store } = makeStore({
      'GET /api/threads/t1': () => {
        call += 1
        if (call === 1) {
          return jsonResponse({
            ...conversation(1, '2026-09-10T00:00:00Z'),
            thread_id: 't1',
            total: 3,
            running: false,
            messages: [message('m2', 'b'), message('m3', 'c')],
          })
        }
        return jsonResponse({
          ...conversation(1, '2026-09-10T00:00:00Z'),
          thread_id: 't1',
          total: 3,
          running: false,
          messages: [message('m1', 'a'), message('m2', 'b')],
        })
      },
    })

    await store.select('t1')
    await store.loadMore()

    expect(store.messages.value.map((item) => item.id)).toEqual(['m1', 'm2', 'm3'])
    expect(store.hasMore.value).toBe(false)
  })

  it('loadMore 在无更多数据时为无操作', async () => {
    const { store, router } = makeStore({
      'GET /api/threads/t1': () =>
        jsonResponse({
          ...conversation(1, '2026-09-10T00:00:00Z'),
          thread_id: 't1',
          total: 1,
          running: false,
          messages: [message('m1', 'a')],
        }),
    })
    await store.select('t1')
    const before = router.calls.length

    await store.loadMore()

    expect(router.calls).toHaveLength(before)
  })

  it('无当前会话时 refresh 清空消息', async () => {
    const { store } = makeStore({})

    await store.refresh()

    expect(store.messages.value).toEqual([])
    expect(store.total.value).toBe(0)
    expect(store.running.value).toBe(false)
  })

  it('详情 404 时记录错误且不崩溃', async () => {
    const { store } = makeStore({
      'GET /api/threads/t1': () => errorResponse('THREAD_NOT_FOUND', 'x', 404),
    })

    await store.select('t1')

    expect(store.error.value?.code).toBe('THREAD_NOT_FOUND')
    expect(store.loading.value).toBe(false)
  })
})

describe('useThreads - 删除（FR-044）', () => {
  it('删除当前会话后清空并刷新列表', async () => {
    const { store, activeThreadId } = makeStore({
      'DELETE /api/threads/t1': () => new Response(null, { status: 204 }),
      'GET /api/threads': () => jsonResponse([]),
    })
    activeThreadId.value = 't1'

    await store.remove('t1')

    expect(activeThreadId.value).toBeNull()
    expect(store.messages.value).toEqual([])
    expect(store.list.value).toEqual([])
  })

  it('删除非当前会话不影响当前消息', async () => {
    const { store, activeThreadId } = makeStore({
      'DELETE /api/threads/t2': () => new Response(null, { status: 204 }),
      'GET /api/threads': () => jsonResponse([]),
    })
    activeThreadId.value = 't1'

    await store.remove('t2')

    expect(activeThreadId.value).toBe('t1')
  })

  it('删除失败时提示且不清空当前会话', async () => {
    const { store, activeThreadId, toast } = makeStore({
      'DELETE /api/threads/t1': () => errorResponse('THREAD_NOT_FOUND', 'x', 404),
    })
    activeThreadId.value = 't1'

    await store.remove('t1')

    expect(activeThreadId.value).toBe('t1')
    expect(toast.items.value[0]?.text).toBe('会话不存在或已被删除')
  })
})

describe('useThreads - 反馈本地改写（配合 useChatStream 的乐观更新）', () => {
  it('patchFeedback 只改写目标消息的 feedback', async () => {
    const { store } = makeStore({
      'GET /api/threads/t1': () =>
        jsonResponse({
          thread_id: 't1',
          agent_name: 'ops',
          title: '会话 1',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-10T00:00:00Z',
          total: 2,
          running: false,
          messages: [message('m1', '甲'), message('m2', '乙')],
        }),
    })

    await store.select('t1')
    store.patchFeedback('m1', 'up')

    expect(store.messages.value.map((item) => item.feedback)).toEqual(['up', null])
    // 其余字段与消息不受影响
    expect(store.messages.value.map((item) => item.content)).toEqual(['甲', '乙'])
  })
})
