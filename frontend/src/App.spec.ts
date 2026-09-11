import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.vue'
import ConfirmDialog from './components/common/ConfirmDialog.vue'
import { useSession } from './composables/useAppSession'
import { createFetchRouter, flush, jsonResponse, waitFor } from '../tests/helpers'

describe('App', () => {
  it('渲染三栏骨架与全局提示宿主', () => {
    const wrapper = mount(App)

    expect(wrapper.find('.app-shell').exists()).toBe(true)
    expect(wrapper.find('.app-shell__sidebar').exists()).toBe(true)
    expect(wrapper.find('.app-shell__main').exists()).toBe(true)
    // 默认收起预览列
    expect(wrapper.find('.app-shell__preview').exists()).toBe(false)

    // 左栏装配 HistorySidebar（US5）
    expect(wrapper.find('.app-shell__sidebar .history-sidebar').exists()).toBe(true)
    expect(wrapper.find('.history-sidebar .base-button').text()).toBe('新建会话')

    // 中栏装配 ChatPanel（初始为居中入口形态）
    expect(wrapper.find('.app-shell__main .chat-panel').exists()).toBe(true)
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(true)

    const host = wrapper.find('.toast-host')
    expect(host.exists()).toBe(true)
    expect(host.attributes('aria-live')).toBe('polite')

    wrapper.unmount()
  })

  it('会话上下文可被后代组件注入取用', () => {
    let injected: ReturnType<typeof useSession> | null = null
    const Probe = defineComponent({
      name: 'Probe',
      setup() {
        injected = useSession()
        return () => h('div', { class: 'probe' })
      },
    })

    const wrapper = mount(App, { global: { stubs: { AppShell: Probe } } })

    expect(wrapper.find('.probe').exists()).toBe(true)
    expect(injected).not.toBeNull()
    expect((injected as unknown as { toast: unknown }).toast).toBeTruthy()
    expect((injected as unknown as { threads: unknown }).threads).toBeTruthy()

    wrapper.unmount()
  })
})

describe('App - 删除历史会话（backend-api §3.5）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function conversation(threadId: string, title: string) {
    return {
      thread_id: threadId,
      agent_name: 'ops',
      title,
      created_at: '2026-09-10T08:00:00.000Z',
      updated_at: '2026-09-10T09:00:00.000Z',
    }
  }

  function detail(threadId: string) {
    return {
      thread_id: threadId,
      agent_name: 'ops',
      title: null,
      created_at: '2026-09-10T08:00:00.000Z',
      updated_at: '2026-09-10T09:00:00.000Z',
      total: 0,
      messages: [],
      running: false,
    }
  }

  /** 装配一个假后端：列表 2 条会话，支持真实 DELETE 语义 */
  function setupBackend() {
    let list = [conversation('t1', '会话一'), conversation('t2', '会话二')]
    const router = createFetchRouter({
      'GET /api/threads': () => jsonResponse(list),
      'GET /api/threads/t1': () => jsonResponse(detail('t1')),
      'GET /api/threads/t2': () => jsonResponse(detail('t2')),
      'DELETE /api/threads/t1': () => {
        list = list.filter((item) => item.thread_id !== 't1')
        return new Response(null, { status: 204 })
      },
      // ChatPanel 挂载时的副作用请求
      'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
      'GET /api/agents/ops': () =>
        jsonResponse({
          agent_name: 'ops',
          soul: 's',
          skills: [],
          enabled_tools: [],
          mcp_servers: [],
        }),
      'GET /api/agents/current/mcp': () => jsonResponse({ agent_name: 'ops', mcp_servers: [] }),
      'GET /api/models': () => jsonResponse({ models: [{ model: 'm1', is_default: true }] }),
    })
    vi.stubGlobal('fetch', router.fetch)
    return router
  }

  it('点击删除入口先弹确认；确认后才发 DELETE 并从列表移除', async () => {
    const router = setupBackend()
    const wrapper = mount(App)
    await waitFor(() => wrapper.findAll('.history-item').length === 2, '历史列表加载')

    await wrapper.findAll('.history-item__remove')[0]?.trigger('click')

    // 只弹确认，不发请求
    expect(router.countOf('DELETE', '/api/threads/t1')).toBe(0)
    expect(wrapper.text()).toContain('确定要删除「会话一」吗？')

    await wrapper.find('.base-button--danger').trigger('click')
    await waitFor(() => wrapper.findAll('.history-item').length === 1, '列表移除')

    expect(router.countOf('DELETE', '/api/threads/t1')).toBe(1)
    expect(wrapper.text()).not.toContain('会话一')

    wrapper.unmount()
  })

  it('取消确认：不发请求且弹窗关闭', async () => {
    const router = setupBackend()
    const wrapper = mount(App)
    await waitFor(() => wrapper.findAll('.history-item').length === 2, '历史列表加载')

    await wrapper.findAll('.history-item__remove')[0]?.trigger('click')
    const dialog = wrapper.findComponent(ConfirmDialog)
    await dialog.findAll('.base-button')[0]?.trigger('click') // 取消

    expect(router.countOf('DELETE', '/api/threads/t1')).toBe(0)
    expect(wrapper.findAll('.history-item')).toHaveLength(2)
    expect(dialog.props('open')).toBe(false)

    wrapper.unmount()
  })

  it('删除当前选中会话：切换到相邻会话（§3.5）', async () => {
    const router = setupBackend()
    const wrapper = mount(App)
    await waitFor(() => wrapper.findAll('.history-item').length === 2, '历史列表加载')

    const rowOf = (title: string) => {
      const row = wrapper.findAll('.history-item').find((item) => item.text().includes(title))
      if (!row) throw new Error(`未找到会话行：${title}`)
      return row
    }

    // 选中「会话一」
    await rowOf('会话一').find('.history-item__button').trigger('click')
    await flush()
    expect({
      states: wrapper
        .findAll('.history-item__button')
        .map((button) => button.attributes('aria-current') ?? '-'),
      calls: router.calls.map((call) => `${call.method} ${call.path}`),
    }).toEqual({
      states: ['true', '-'],
      calls: expect.anything(),
    })

    await rowOf('会话一').find('.history-item__remove').trigger('click')
    await wrapper.find('.base-button--danger').trigger('click')

    // 删完自动切到相邻的 t2
    await waitFor(() => router.countOf('GET', '/api/threads/t2') === 1, '切换到相邻会话')

    expect(router.countOf('DELETE', '/api/threads/t1')).toBe(1)
    // 切会话会拉详情，loading 期间侧栏展示加载态；等列表重新渲染后再断言
    await waitFor(() => wrapper.findAll('.history-item').length === 1, '列表重新渲染')
    const remaining = wrapper.findAll('.history-item__button')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.attributes('aria-current')).toBe('true')

    wrapper.unmount()
  })
})
