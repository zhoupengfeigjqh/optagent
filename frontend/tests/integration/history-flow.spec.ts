/**
 * US5 集成验收：历史会话浏览与「更多」
 *
 * 覆盖 quickstart 的 US5 独立测试路径（默认 10 条 → 「更多」查看 100 次），
 * 并验证 V-09：请求 **不含** `limit` / `offset`，10 → 100 是纯前端切片（不产生新请求）。
 *
 * 这里直接挂载 `App`（真实装配链路），只把全局 `fetch` 换成路由桩。
 */

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App.vue'
import type { Conversation } from '../../src/api/types'
import { createFetchRouter, jsonResponse, waitFor } from '../helpers'

function thread(index: number): Conversation {
  return {
    thread_id: `t${index}`,
    agent_name: 'ops',
    title: `会话 ${index}`,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: `2026-09-10T00:${String(index).padStart(2, '0')}:00Z`,
  }
}

const THREADS = Array.from({ length: 15 }, (_, index) => thread(index + 1))

function stubFetch(): ReturnType<typeof createFetchRouter> {
  const router = createFetchRouter({
    'GET /api/threads': () => jsonResponse(THREADS),
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
  })
  vi.stubGlobal('fetch', router.fetch)
  return router
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('US5 集成：历史会话', () => {
  it('默认 10 条、按更新时间倒序；「更多」切到全部且不再发请求（V-09）', async () => {
    const router = stubFetch()
    const wrapper = mount(App)

    await waitFor(
      () => wrapper.findAll('.history-item').length === 10,
      '历史会话未渲染为 10 条',
    )

    // 请求 URL 不含 limit / offset（传参会被后端 Schema 拒绝）
    const listCalls = router.calls.filter((call) => call.path === '/api/threads')
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0].method).toBe('GET')
    expect(listCalls[0].query.size).toBe(0)

    // updated_at 倒序：最新的排在首位
    expect(wrapper.findAll('.history-item__title')[0].text()).toBe('会话 15')

    const callsBeforeMore = router.calls.length

    await wrapper.find('.history-sidebar__more').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.history-item')).toHaveLength(15)
    expect(wrapper.find('.history-sidebar__more').exists()).toBe(false)
    // 纯前端切片：未产生任何新请求
    expect(router.calls.length).toBe(callsBeforeMore)

    wrapper.unmount()
  })

  it('空列表展示空态且「新建会话」可用（FR-043）', async () => {
    const router = createFetchRouter({
      'GET /api/threads': () => jsonResponse([]),
      'GET /api/models': () => jsonResponse({ models: [] }),
      'POST /api/threads': () => jsonResponse({ thread_id: 't-new', title: null }, 201),
    })
    vi.stubGlobal('fetch', router.fetch)

    const wrapper = mount(App)
    await waitFor(() => wrapper.find('.empty-state').exists(), '空态未展示')

    const create = wrapper.find('.history-sidebar .base-button')
    expect(create.attributes('disabled')).toBeUndefined()

    // 未选定数字人 → 不发起创建请求，仅提示
    await create.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.countOf('POST', '/api/threads')).toBe(0)

    wrapper.unmount()
  })
})
