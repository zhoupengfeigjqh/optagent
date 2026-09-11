/**
 * US7 集成验收：内容跳转与右侧预览
 *
 * 覆盖 quickstart 的 US7 独立测试路径：
 * 点击外部地址 → 新窗口直接跳转且**不进入预览区**（V-10 / FR-045）；
 * 点击空间目录文件（含 `tmp`）→ 右侧约 1/3 宽预览区内联渲染（FR-046）；
 * 无预览目标时右栏不占位（FR-002）。
 *
 * 直接挂载 `App`（真实装配链路），只把全局 `fetch` 换成路由桩、`window.open` 换成间谍。
 */

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App.vue'
import type { Message } from '../../src/api/types'
import { createFetchRouter, jsonResponse, waitFor } from '../helpers'

const AGENT = {
  agent_name: 'ops',
  description: '排产',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

const LINK = 'https://example.com/docs'

const USER_MESSAGE: Message = {
  id: 'u1',
  role: 'user',
  content: `看 ${LINK} 和 @plan.csv`,
  ts: '2026-09-10T08:00:01.000Z',
  feedback: null,
  attachments: [{ dir: 'tmp', filename: 'plan.csv' }],
}

const PREVIEW_TEXT = 'a,b\n1,2'

function stubRouter(): ReturnType<typeof createFetchRouter> {
  const router = createFetchRouter({
    'GET /api/threads': () =>
      jsonResponse([
        {
          thread_id: 't1',
          agent_name: 'ops',
          title: '排产会话',
          created_at: '2026-09-10T08:00:00.000Z',
          updated_at: '2026-09-10T08:00:02.000Z',
        },
      ]),
    'GET /api/threads/t1': () =>
      jsonResponse({
        thread_id: 't1',
        agent_name: 'ops',
        title: '排产会话',
        created_at: '2026-09-10T08:00:00.000Z',
        updated_at: '2026-09-10T08:00:02.000Z',
        total: 1,
        messages: [USER_MESSAGE],
        running: false,
      }),
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    'GET /api/agents/ops': () => jsonResponse(AGENT),
    'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    // 文本类预览：直接返回纯文本（非 JSON）
    'GET /api/files/preview': () =>
      new Response(PREVIEW_TEXT, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
  })
  vi.stubGlobal('fetch', router.fetch)
  return router
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('US7 集成：跳转与预览', () => {
  it('外部地址直跳不进预览区；空间目录文件在右栏内联预览并可收起', async () => {
    const router = stubRouter()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = mount(App)

    // 选择会话 → 消息渲染
    await waitFor(() => wrapper.find('.history-item').exists(), '历史会话未渲染')
    await wrapper.find('.history-item__button').trigger('click')
    await waitFor(() => wrapper.find('.message-bubble').exists(), '消息未渲染')

    // 无预览目标时右栏不占位（FR-002）
    expect(wrapper.find('.preview-panel').exists()).toBe(false)

    // 1. 外部地址：新窗口直跳，且**不**改变预览目标（V-10）
    await wrapper.find('.message-content__link').trigger('click')
    expect(openSpy).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer')
    expect(wrapper.find('.preview-panel').exists()).toBe(false)
    expect(router.countOf('GET', '/api/files/preview')).toBe(0)

    // 2. 空间目录文件：进入右侧内联预览（FR-046）
    await wrapper.find('.message-bubble__ref').trigger('click')
    await waitFor(() => wrapper.find('.preview-panel').exists(), '预览列未展开')
    await waitFor(() => wrapper.find('.preview-panel__text').exists(), '文本未渲染')

    expect(router.countOf('GET', '/api/files/preview')).toBe(1)
    expect(wrapper.find('.preview-panel__filename').text()).toBe('plan.csv')
    expect(wrapper.find('.preview-panel__dir').text()).toBe('临时空间')
    expect(wrapper.find('.preview-panel__text').text()).toBe(PREVIEW_TEXT)

    // 3. 收起预览 → 右栏收回（不占宽）
    await wrapper.find('.preview-panel__header .base-button').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.preview-panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('预览超限（413）时给出错误文案与下载引导（FR-048）', async () => {
    const router = createFetchRouter({
      'GET /api/threads': () =>
        jsonResponse([
          {
            thread_id: 't1',
            agent_name: 'ops',
            title: '排产会话',
            created_at: '2026-09-10T08:00:00.000Z',
            updated_at: '2026-09-10T08:00:02.000Z',
          },
        ]),
      'GET /api/threads/t1': () =>
        jsonResponse({
          thread_id: 't1',
          agent_name: 'ops',
          title: '排产会话',
          created_at: '2026-09-10T08:00:00.000Z',
          updated_at: '2026-09-10T08:00:02.000Z',
          total: 1,
          messages: [USER_MESSAGE],
          running: false,
        }),
      'GET /api/models': () => jsonResponse({ models: [] }),
      'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
      'GET /api/agents/ops': () => jsonResponse(AGENT),
      'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
      'GET /api/files/preview': () =>
        jsonResponse({ error: { code: 'FILE_TOO_LARGE', message: '' } }, 413),
    })
    vi.stubGlobal('fetch', router.fetch)

    const wrapper = mount(App)

    await waitFor(() => wrapper.find('.history-item').exists(), '历史会话未渲染')
    await wrapper.find('.history-item__button').trigger('click')
    await waitFor(() => wrapper.find('.message-bubble__ref').exists(), '引用未渲染')

    await wrapper.find('.message-bubble__ref').trigger('click')
    await waitFor(() => wrapper.find('.error-notice').exists(), '错误态未展示')

    expect(wrapper.find('.error-notice__message').text()).toBe('文件过大，请下载查看')
    expect(wrapper.find('.preview-panel__fallback .base-button').text()).toBe('下载完整文件')

    wrapper.unmount()
  })
})
