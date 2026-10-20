/**
 * 组件测试：视图入口行在气泡里的**位置与装配**（`TR-45` / `TR-48`）
 *
 * 位置是本特性的核心设计决定：入口行 MUST 在**回答正文之后**、状态提示与操作区之前
 * （它是"正文的附件"，不是"对消息的操作"）。这里用 DOM 顺序断言把它钉住——
 * 谁把它挪到工具卡片上方或操作区之后，本用例就会失败。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message, ToolCallRecord } from '../../api/types'
import MessageBubble from './MessageBubble.vue'

/** 未传 origin 时组件取当前页面入口；断言按同一来源，避免硬编码主机 */
const ORIGIN = window.location.origin

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '两个车间都已排定。',
    ts: '2026-10-10T06:00:00.000Z',
    status: 'completed',
    feedback: null,
    ...over,
  }
}

function call(over: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    call_id: 'c1',
    name: 'hd__排产结果',
    status: 'success',
    started_at: '2026-10-10T06:00:00.000Z',
    ...over,
  }
}

function mountBubble(over: Partial<Message> = {}) {
  return mount(MessageBubble, { props: { message: message(over) } })
}

describe('MessageBubble —— 视图入口行的位置（TR-45）', () => {
  it('顺序：工具卡片 → 回答正文 → 入口行 → 操作区', () => {
    const wrapper = mountBubble({
      tool_calls: [
        call({ view_links: [{ url: '/datasource/plan/ws1/xlsx', name: '一车间产能明细' }] }),
      ],
    })
    const order = [...wrapper.element.children].map((element) => element.className)

    const toolsAt = order.findIndex((name) => name.includes('message-bubble__tools'))
    const contentAt = order.findIndex((name) => name.includes('message-content'))
    const linksAt = order.findIndex((name) => name.includes('message-view-links'))
    const actionsAt = order.findIndex((name) => name.includes('message-actions'))

    expect(toolsAt).toBeGreaterThanOrEqual(0)
    expect(toolsAt).toBeLessThan(contentAt)
    expect(contentAt).toBeLessThan(linksAt)
    expect(linksAt).toBeLessThan(actionsAt)
  })

  it('没有 view_links 时不出现入口行，工具卡片照常', () => {
    const wrapper = mountBubble({ tool_calls: [call()] })

    expect(wrapper.find('[data-test="view-links"]').exists()).toBe(false)
    expect(wrapper.find('.tool-calls').exists()).toBe(true)
  })
})

describe('MessageBubble —— 入口取自"本条回答全部工具调用"（TR-45）', () => {
  it('多次调用的地址合并去重：跨工具重复只留一个入口', () => {
    const wrapper = mountBubble({
      tool_calls: [
        call({ call_id: 'c1', view_links: [{ url: '/a', name: 'A 明细' }] }),
        call({ call_id: 'c2', view_links: [{ url: '/a' }, { url: '/b' }] }),
      ],
    })
    const links = wrapper.findAll('.message-view-link')

    expect(links.map((link) => link.attributes('href'))).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`])
    // 首次已给名称 → 不被后面那次"无名称"的同一地址抹掉
    expect(links[0]?.text()).toBe('A 明细')
  })

  it('卡片头部的入口与入口行语义不同：两者都保留', () => {
    const wrapper = mountBubble({ tool_calls: [call({ view_links: [{ url: '/a' }] })] })

    expect(wrapper.find('.tool-calls').exists()).toBe(true)
    expect(wrapper.find('[data-test="view-links"]').exists()).toBe(true)
  })

  it('用户消息不产生入口行（没有工具记录）', () => {
    const wrapper = mountBubble({ id: 'm2', role: 'user', content: '帮我解析产能表' })

    expect(wrapper.find('[data-test="view-links"]').exists()).toBe(false)
  })
})

describe('MessageBubble —— 入口点击向上透传（2026-10-15）', () => {
  it('点入口行冒泡为 open-view（`{ url, name }`），异源直跳 / 同源预检交给装配层', async () => {
    const wrapper = mountBubble({
      tool_calls: [call({ view_links: [{ url: '/a', name: 'A 明细' }] })],
    })

    await wrapper.find('.message-view-link').trigger('click')

    expect(wrapper.emitted('open-view')).toEqual([
      [{ url: `${ORIGIN}/a`, name: 'A 明细', kind: 'url' }],
    ])
    // 不再是"直跳新窗口"的 open-link 口径（地址可能是同源页面或本地文件）
    expect(wrapper.emitted('open-link')).toBeUndefined()
  })

  it('工具卡片展开后的 viewUrl 也走同一条 open-view 出口（2026-10-20）', async () => {
    const wrapper = mountBubble({ tool_calls: [call({ content: '{"viewUrl":"/a/b"}' })] })

    await wrapper.find('.tool-call__head').trigger('click')
    await wrapper.find('.produced-json__link').trigger('click')

    expect(wrapper.emitted('open-view')).toEqual([
      [{ url: `${ORIGIN}/a/b`, name: '/a/b', kind: 'url' }],
    ])
  })
})
