/**
 * 单元测试：会话 store 的「新建对话」语义（009 FR-010 / FR-016，D14）
 *
 * 守住一条**契约级**不变式：`startNew()` 是**视图态**操作——
 *
 * 1. 只清空当前选中与消息（`activeId` / `messages` / `total` / `running` / `pending`）；
 * 2. **MUST NOT** 调 `POST /api/threads`（否则每次"新建对话"或切换数字人都留下一条
 *    "没有任何消息"的记录，列表被塞满且用户删不掉——FR-016 只呈现有消息的会话）；
 * 3. **MUST NOT** 产生任何网络请求（含列表拉取：作用域没变，拉取没有意义）。
 *
 * 真实会话由既有路径创建：首条消息时 `activeId === null` → `create()`。
 *
 * 另含**重命名与导出**（2026-10-16，见文件末尾）：重命名是乐观更新（失败整体回滚 +
 * 提示，空标题/未改动不发请求），导出按详情分页**往前翻**并拼成正序全文。
 */
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadsApi } from '../api/threads'
import type { Conversation, Message, ThreadDetail } from '../api/types'
import { createThreadsStore } from './useThreads'

/**
 * 详情响应夹具。
 *
 * 显式标注 `ThreadDetail`：让 tsc 守住「桩形状 == 接口契约」，避免契约漂移；
 * 用例可用 `calls.detail.mockResolvedValue({ ...DETAIL_FIXTURE, ... })` 改写上游返回。
 */
const DETAIL_FIXTURE: ThreadDetail = {
  thread_id: 'th_1',
  agent_name: 'demo',
  title: null,
  created_at: '',
  updated_at: '',
  total: 0,
  running: false,
  pending_interaction: null,
  messages: [],
}

function makeApi(overrides: Partial<Record<keyof ThreadsApi, unknown>> = {}) {
  const calls = {
    create: vi.fn(async () => ({ thread_id: 'th_new', created_at: '', title: null })),
    list: vi.fn(async (): Promise<Conversation[]> => []),
    detail: vi.fn(async () => DETAIL_FIXTURE),
    rename: vi.fn(async (threadId: string, title: string) => ({ thread_id: threadId, title })),
    remove: vi.fn(async () => undefined),
  }
  const api = {
    create: calls.create,
    list: calls.list,
    detail: calls.detail,
    rename: calls.rename,
    remove: calls.remove,
    ...overrides,
  } as unknown as ThreadsApi
  return { api, calls }
}

function makeStore(api: ThreadsApi) {
  const activeThreadId = ref<string | null>(null)
  const currentAgentName = ref<string | null>('demo')
  const toast = { push: vi.fn() }
  const store = createThreadsStore({
    threads: api,
    activeThreadId,
    currentAgentName,
    toast: toast as unknown as Parameters<typeof createThreadsStore>[0]['toast'],
  })
  return { store, activeThreadId, toast }
}

const ONE_MESSAGE: Message[] = [
  { id: 'm-1', role: 'user', content: '你好', ts: '', feedback: null },
]

/* ---------- 重命名 / 导出夹具（2026-10-16） ---------- */

const CONVERSATION: Conversation = {
  thread_id: 'th_1',
  agent_name: 'demo',
  title: '旧标题',
  created_at: '2026-10-16T01:00:00Z',
  updated_at: '2026-10-16T02:00:00Z',
}

/** 三轮消息：导出要断言的是**正序**，所以按时间先后命名 */
const MSG_1: Message = { id: 'm-1', role: 'user', content: '第一条', ts: '', feedback: null }
const MSG_2: Message = { id: 'm-2', role: 'assistant', content: '第二条', ts: '', feedback: null }
const MSG_3: Message = { id: 'm-3', role: 'user', content: '第三条', ts: '', feedback: null }

describe('ThreadsStore.startNew —— 视图态空对话（不落盘）', () => {
  it('清空当前选中与消息，且**不**调创建接口、不产生任何请求', async () => {
    const { api, calls } = makeApi()
    const { store, activeThreadId } = makeStore(api)

    // 先造出"正在看一个已有消息的会话"的状态：
    // 走公开路径（select → detail），而不是直接改写 store 暴露的只读视图——
    // 那些视图的契约就是 Readonly<Ref>，生产代码同样写不了。
    calls.detail.mockResolvedValue({
      ...DETAIL_FIXTURE,
      messages: ONE_MESSAGE,
      total: 1,
      running: true,
    })
    await store.select('th_1')
    calls.detail.mockClear()

    store.startNew()
    await Promise.resolve()

    expect(activeThreadId.value).toBeNull()
    expect(store.messages.value).toEqual([])
    expect(store.total.value).toBe(0)
    expect(store.running.value).toBe(false)
    expect(store.pendingInteraction.value).toBeNull()

    // 关键：一个请求都没发（尤其不能创建空会话）
    expect(calls.create).not.toHaveBeenCalled()
    expect(calls.list).not.toHaveBeenCalled()
    expect(calls.detail).not.toHaveBeenCalled()
  })

  it('与 clearActive 同效（同一条实现，不引入第二套清空逻辑）', async () => {
    const { api, calls } = makeApi()
    const { store, activeThreadId } = makeStore(api)

    calls.detail.mockResolvedValue({
      ...DETAIL_FIXTURE,
      messages: ONE_MESSAGE,
      total: 1,
    })
    await store.select('th_1')

    store.startNew()

    expect(activeThreadId.value).toBeNull()
    expect(store.messages.value).toEqual([])
  })

  it('重复调用幂等：仍是空态、仍不发请求', () => {
    const { api, calls } = makeApi()
    const { store } = makeStore(api)

    store.startNew()
    store.startNew()

    expect(store.messages.value).toEqual([])
    expect(calls.create).not.toHaveBeenCalled()
  })

  it('对照：`create()` 才会落盘（首条消息路径仍可用）', async () => {
    const { api, calls } = makeApi()
    const { store, activeThreadId } = makeStore(api)

    await store.create()

    expect(calls.create).toHaveBeenCalledWith('demo')
    expect(activeThreadId.value).toBe('th_new')
    // create 之后会拉一次列表（列表只含有消息的会话，故此时为空）
    expect(calls.list).toHaveBeenCalled()
  })
})

describe('ThreadsStore —— 列表口径（服务端权威，前端不过滤）', () => {
  it('loadList 原样采用服务端数组（只做倒序稳定化，不做消息数过滤）', async () => {
    const serverList = [
      { thread_id: 'b', title: 'B', created_at: '2026-01-02', updated_at: '2026-01-02' },
      { thread_id: 'a', title: 'A', created_at: '2026-01-01', updated_at: '2026-01-03' },
    ]
    const { api } = makeApi({ list: vi.fn(async () => serverList) })
    const { store } = makeStore(api)

    await store.loadList()

    expect(store.list.value.map((item) => item.thread_id)).toEqual(['a', 'b'])
  })

  it('列表失败只落 error，不抛出（侧栏呈现错误态，不影响聊天区）', async () => {
    const { api } = makeApi({
      list: vi.fn(async () => {
        const err = new Error('boom') as Error & { code?: string }
        err.code = 'AGENT_NOT_AVAILABLE'
        throw err
      }),
    })
    const { store } = makeStore(api)

    await expect(store.loadList()).resolves.toBeUndefined()
    expect(store.list.value).toEqual([])
  })
})

describe('ThreadsStore.rename —— 重命名（2026-10-16）', () => {
  async function storeWithList() {
    const { api, calls } = makeApi()
    calls.list.mockResolvedValue([CONVERSATION])
    const made = makeStore(api)
    await made.store.loadList()
    return { ...made, calls }
  }

  it('乐观更新：请求还没回来，列表里已经是新标题（去掉首尾空格）', async () => {
    const { store, calls } = await storeWithList()

    const pending = store.rename('th_1', '  新标题  ')
    expect(store.list.value[0]?.title).toBe('新标题')
    await pending

    expect(calls.rename).toHaveBeenCalledWith('th_1', '新标题')
    expect(store.list.value[0]?.title).toBe('新标题')
  })

  it('失败整体回滚到旧标题并提示（返回 false，调用方据此不动界面）', async () => {
    const { store, calls, toast } = await storeWithList()
    calls.rename.mockRejectedValue(new Error('boom'))

    const ok = await store.rename('th_1', '新标题')

    expect(ok).toBe(false)
    expect(store.list.value[0]?.title).toBe('旧标题')
    expect(toast.push).toHaveBeenCalled()
  })

  it('空标题 / 与原值相同：视为"不改了"，不产生请求', async () => {
    const { store, calls } = await storeWithList()

    expect(await store.rename('th_1', '   ')).toBe(true)
    expect(await store.rename('th_1', '旧标题')).toBe(true)

    expect(calls.rename).not.toHaveBeenCalled()
    expect(store.list.value[0]?.title).toBe('旧标题')
  })
})

describe('ThreadsStore.exportMarkdown —— 导出全文（2026-10-16）', () => {
  it('按分页往前翻并拼成**正序**全文（不是只导出当前窗口）', async () => {
    const { api, calls } = makeApi()
    calls.list.mockResolvedValue([CONVERSATION])
    const { store } = makeStore(api)
    await store.loadList()

    // 详情接口的 offset 从最新往前数：第一页是"最新两条"，第二页才是更早那条
    calls.detail
      .mockResolvedValueOnce({ ...DETAIL_FIXTURE, total: 3, messages: [MSG_2, MSG_3] })
      .mockResolvedValueOnce({ ...DETAIL_FIXTURE, total: 3, messages: [MSG_1] })

    const markdown = await store.exportMarkdown('th_1')

    expect(markdown).toContain('# 旧标题')
    expect(markdown?.indexOf('第一条')).toBeLessThan(markdown?.indexOf('第三条') ?? -1)
    expect(calls.detail).toHaveBeenCalledTimes(2)
    // 页长取后端上限，几千条的会话才不至于退化成几十次往返
    expect(calls.detail).toHaveBeenNthCalledWith(1, 'th_1', { limit: 200, offset: 0 })
    expect(calls.detail).toHaveBeenNthCalledWith(2, 'th_1', { limit: 200, offset: 2 })
  })

  it('拉取失败：返回 null 并提示（不产生空文件）', async () => {
    const { api, calls } = makeApi()
    calls.list.mockResolvedValue([CONVERSATION])
    const { store, toast } = makeStore(api)
    await store.loadList()
    calls.detail.mockRejectedValue(new Error('boom'))

    await expect(store.exportMarkdown('th_1')).resolves.toBeNull()
    expect(toast.push).toHaveBeenCalled()
  })

  it('列表里没有这个会话：直接返回 null，不发请求', async () => {
    const { api, calls } = makeApi()
    const { store } = makeStore(api)

    await expect(store.exportMarkdown('th_unknown')).resolves.toBeNull()
    expect(calls.detail).not.toHaveBeenCalled()
  })
})
