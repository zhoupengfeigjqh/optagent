/**
 * 组件测试：用户气泡里的显式技能胶囊（2026-11-07）。
 *
 * 守两件事：技能只在**用户消息**上渲染成 `/技能名` 胶囊；缺省（普通消息）不出现任何空壳。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Message } from '../../api/types'
import MessageBubble from './MessageBubble.vue'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    role: 'user',
    content: '查一下 S-1024 的账期',
    ts: '2026-11-07T08:00:00.000Z',
    feedback: null,
    ...overrides,
  }
}

describe('MessageBubble —— 显式技能胶囊', () => {
  it('用户消息带 skill：渲染 `/技能名` 胶囊', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: message({ skill: 'supplier-query' }) },
    })

    const chip = wrapper.find('.message-bubble__skill')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toBe('/supplier-query')
  })

  it('普通消息（无 skill）：不渲染空胶囊', () => {
    const wrapper = mount(MessageBubble, { props: { message: message() } })

    expect(wrapper.find('.message-bubble__skill').exists()).toBe(false)
  })
})
