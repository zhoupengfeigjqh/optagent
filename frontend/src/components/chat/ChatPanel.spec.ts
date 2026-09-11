import { describe, expect, it } from 'vitest'
import type { Ref } from 'vue'

import type { ErrorInfo, Message } from '../../api/types'
import {
  createFetchRouter,
  errorResponse,
  flush,
  jsonResponse,
  mountInSession,
  waitFor,
} from '../../../tests/helpers'
import ChatPanel from './ChatPanel.vue'

function message(id: string, content: string): Message {
  return { id, role: 'assistant', content, ts: '2026-09-10T08:00:00.000Z', feedback: null }
}

describe('ChatPanel', () => {
  it('头部接入 ChatHeader：展示当前数字人与三个按钮位', async () => {
    const router = createFetchRouter({
      'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
      'GET /api/agents/ops': () =>
        jsonResponse({
          agent_name: 'ops',
          soul: '',
          skills: [],
          enabled_tools: [],
          mcp_servers: [],
        }),
      'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    })
    const { wrapper } = mountInSession(ChatPanel, {
      props: { expanded: true },
      sessionOptions: { fetchImpl: router.fetch },
    })

    await waitFor(() => wrapper.find('.agent-summary__name').exists(), '数字人未展示')
    expect(wrapper.find('.agent-summary__name').text()).toBe('ops')
    expect(wrapper.findAll('.chat-header__action')).toHaveLength(3)
  })

  it('未展开且无消息时展示居中入口，不渲染消息列表', () => {
    const { wrapper } = mountInSession(ChatPanel, { props: { expanded: false } })
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(true)
    expect(wrapper.find('.message-list').exists()).toBe(false)
  })

  it('expanded=true 时渲染消息列表', () => {
    const { wrapper } = mountInSession(ChatPanel, { props: { expanded: true } })
    expect(wrapper.find('.message-list').exists()).toBe(true)
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(false)
  })

  it('本轮进行中即使未展开也渲染列表（首轮尚未落盘，FR-004）', async () => {
    const { wrapper, session } = mountInSession(ChatPanel, { props: { expanded: false } })
    ;(session.chat.phase as unknown as Ref<string>).value = 'streaming'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.message-list').exists()).toBe(true)
    expect(wrapper.find('.chat-panel__hero').exists()).toBe(false)
  })

  it('已有消息时即使未展开也渲染列表（FR-004）', () => {
    const { wrapper, session } = mountInSession(ChatPanel, { props: { expanded: false } })
    ;(session.threads.messages as unknown as Ref<Message[]>).value = [message('m1', '你好')]
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('.message-list').exists()).toBe(true)
      expect(wrapper.find('.chat-panel__hero').exists()).toBe(false)
    })
  })

  it('输入区与 chat.draft 双向绑定', async () => {
    const { wrapper, session } = mountInSession(ChatPanel, { props: { expanded: true } })
    await wrapper.find('.composer__input').setValue('你好')
    expect(session.chat.draft.value).toBe('你好')
  })

  it('failed 阶段展示断连提示与「重新获取」入口', async () => {
    const { wrapper, session } = mountInSession(ChatPanel, { props: { expanded: true } })
    ;(session.chat.phase as unknown as Ref<string>).value = 'failed'
    ;(session.chat.error as Ref<ErrorInfo | null>).value = {
      code: 'STREAM_DISCONNECTED',
      message: '',
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.error-notice').exists()).toBe(true)
    expect(wrapper.find('.error-notice__retry').text()).toBe('重新获取')
  })

  it('点赞提交反馈：本地乐观更新并 PUT 后端', async () => {
    const router = createFetchRouter({
      'PUT /api/threads/t1/messages/m1/feedback': () =>
        jsonResponse({ message_id: 'm1', feedback: 'up' }),
    })
    const { wrapper, session } = mountInSession(ChatPanel, {
      props: { expanded: true },
      sessionOptions: { fetchImpl: router.fetch },
    })
    ;(session.threads.activeId as unknown as Ref<string | null>).value = 't1'
    ;(session.threads.messages as unknown as Ref<Message[]>).value = [
      {
        id: 'm1',
        role: 'assistant',
        content: '答',
        ts: '2026-09-10T08:00:02.000Z',
        status: 'completed',
        feedback: null,
      },
    ]
    await wrapper.vm.$nextTick()

    await wrapper.find('.message-actions__up').trigger('click')
    await flush()

    expect(session.threads.messages.value[0].feedback).toBe('up')
    expect(router.bodiesOf('PUT', '/api/threads/t1/messages/m1/feedback')).toEqual([{ value: 'up' }])
    expect(wrapper.find('.message-actions__up').attributes('aria-pressed')).toBe('true')
  })

  it('创建会话失败时保留输入且不发起消息请求', async () => {
    const router = createFetchRouter({
      'POST /api/threads': () => errorResponse('AGENT_NOT_SELECTED', '', 400),
    })
    const { wrapper, session } = mountInSession(ChatPanel, {
      props: { expanded: true },
      sessionOptions: { fetchImpl: router.fetch },
    })

    await wrapper.find('.composer__input').setValue('你好')
    await wrapper.find('.base-button--primary').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(session.threads.activeId.value).toBeNull()
    expect(session.chat.draft.value).toBe('你好')
    expect(router.calls.filter((call) => call.path.endsWith('/messages'))).toHaveLength(0)
  })
})
