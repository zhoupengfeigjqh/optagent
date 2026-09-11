import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MessageContent from './MessageContent.vue'

describe('MessageContent', () => {
  it('纯文本原样渲染', () => {
    const wrapper = mount(MessageContent, { props: { content: '求解完成，用时 3 秒。' } })
    expect(wrapper.text()).toBe('求解完成，用时 3 秒。')
    expect(wrapper.find('.message-content__link').exists()).toBe(false)
    expect(wrapper.find('.message-content__mark').exists()).toBe(false)
  })

  it('空内容渲染为空段落', () => {
    const wrapper = mount(MessageContent, { props: { content: '' } })
    expect(wrapper.text()).toBe('')
    expect(wrapper.findAll('span')).toHaveLength(0)
  })

  it('http(s) 链接渲染为直跳外链（FR-045）', () => {
    const wrapper = mount(MessageContent, {
      props: { content: '详见 https://example.com/docs 说明。' },
    })
    const anchor = wrapper.find('.message-content__link')
    expect(anchor.attributes('href')).toBe('https://example.com/docs')
    expect(anchor.attributes('target')).toBe('_blank')
    expect(anchor.attributes('rel')).toBe('noopener noreferrer')
  })

  it('点击链接阻止默认行为并派发 open-link', () => {
    const wrapper = mount(MessageContent, { props: { content: 'https://example.com' } })
    const anchor = wrapper.find('.message-content__link').element as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('open-link')).toEqual([['https://example.com']])
  })

  it('关键词高亮为 mark 并携带全局匹配序号', () => {
    const wrapper = mount(MessageContent, {
      props: { content: '甲 甲 甲', keyword: '甲', matchIndexBase: 5 },
    })
    const marks = wrapper.findAll('.message-content__mark')
    expect(marks).toHaveLength(3)
    expect(marks.map((mark) => mark.attributes('data-match-index'))).toEqual(['5', '6', '7'])
  })

  it('关键词落在链接内时同时是链接与高亮', () => {
    const wrapper = mount(MessageContent, {
      props: { content: 'https://example.com', keyword: 'example' },
    })
    const marks = wrapper.findAll('.message-content__mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].text()).toBe('example')
    expect(marks[0].attributes('data-match-index')).toBe('0')
    // 高亮片段仍位于链接内，保持可点击跳转
    expect(marks[0].element.closest('a')?.getAttribute('href')).toBe('https://example.com')
  })

  it('分段拼接可还原原文', () => {
    const content = '看 https://a.example.com/x 说明，再搜 甲甲 结束'
    const wrapper = mount(MessageContent, { props: { content, keyword: '甲' } })
    expect(wrapper.element.textContent).toBe(content)
  })
})
