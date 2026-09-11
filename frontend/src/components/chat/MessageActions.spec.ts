import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MessageActions from './MessageActions.vue'

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MessageActions', () => {
  it('展示用量与耗时（耗时统一 1 位小数）', () => {
    const wrapper = mount(MessageActions, {
      props: { usage: { input_tokens: 3, output_tokens: 5 }, durationSeconds: 1.24 },
    })
    expect(wrapper.find('.message-actions__usage').text()).toBe('输入 3 · 输出 5 tokens')
    expect(wrapper.find('.message-actions__duration').text()).toBe('1.2s')
  })

  it('无用量与耗时时不渲染对应文本', () => {
    const wrapper = mount(MessageActions)
    expect(wrapper.find('.message-actions__usage').exists()).toBe(false)
    expect(wrapper.find('.message-actions__duration').exists()).toBe(false)
  })

  it('点击点赞/点踩上报对应取值', async () => {
    const wrapper = mount(MessageActions)
    await wrapper.find('.message-actions__up').trigger('click')
    await wrapper.find('.message-actions__down').trigger('click')
    expect(wrapper.emitted('feedback')).toEqual([['up'], ['down']])
  })

  it('选中态互斥并由 feedback 受控', async () => {
    const wrapper = mount(MessageActions, { props: { feedback: 'up' } })
    expect(wrapper.find('.message-actions__up').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.message-actions__down').attributes('aria-pressed')).toBe('false')

    await wrapper.setProps({ feedback: 'down' })
    expect(wrapper.find('.message-actions__up').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.message-actions__down').attributes('aria-pressed')).toBe('true')
  })

  it('复制成功后短暂展示「已复制」，超时恢复', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    const wrapper = mount(MessageActions, { props: { copyText: '求解结果' } })
    expect(wrapper.find('.message-actions__hint').text()).toBe('复制')

    await wrapper.find('.message-actions__copy').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.emitted('copy')).toHaveLength(1)
    expect(writeText).toHaveBeenCalledWith('求解结果')
    expect(wrapper.find('.message-actions__hint').text()).toBe('已复制')

    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.message-actions__hint').text()).toBe('复制')
  })

  it('复制失败时不展示成功反馈', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    stubClipboard(writeText)

    const wrapper = mount(MessageActions, { props: { copyText: '正文' } })
    await wrapper.find('.message-actions__copy').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.find('.message-actions__hint').text()).toBe('复制')
  })

  it('未提供 copyText 时只派发 copy，不触碰剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    const wrapper = mount(MessageActions)
    await wrapper.find('.message-actions__copy').trigger('click')
    await Promise.resolve()

    expect(wrapper.emitted('copy')).toHaveLength(1)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('disabled 时按钮禁用且不派发事件', async () => {
    const wrapper = mount(MessageActions, { props: { disabled: true } })
    const up = wrapper.find('.message-actions__up')
    expect(up.attributes('disabled')).toBeDefined()

    await up.trigger('click')
    await wrapper.find('.message-actions__copy').trigger('click')
    expect(wrapper.emitted('feedback')).toBeUndefined()
    expect(wrapper.emitted('copy')).toBeUndefined()
  })
})
