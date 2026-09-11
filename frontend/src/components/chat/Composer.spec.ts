import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import Composer from './Composer.vue'

const REFERENCES = [
  { dir: '生产计划', filename: 'plan.csv' },
  { dir: 'shared', filename: 'rule.txt' },
]

describe('Composer', () => {
  it('textarea 展示受控文本，输入时派发 update:modelValue', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '初始文本' } })
    const textarea = wrapper.find('.composer__input')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('初始文本')

    await textarea.setValue('新文本')
    expect(wrapper.emitted('update:modelValue')).toEqual([['新文本']])
  })

  it('Enter 发送：内容去首尾空白并携带引用副本', async () => {
    const wrapper = mount(Composer, {
      props: { modelValue: '  求解一下  ', references: REFERENCES },
    })
    await wrapper.find('.composer__input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toEqual([[{ content: '求解一下', attachments: REFERENCES }]])
  })

  it('Shift + Enter 不发送', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '换行' } })
    await wrapper.find('.composer__input').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('空内容时发送按钮禁用且不派发', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '   ' } })
    const button = wrapper.find('.base-button')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('disabled 时输入框禁用', () => {
    const wrapper = mount(Composer, { props: { modelValue: '内容', disabled: true } })
    expect(wrapper.find('.composer__input').attributes('disabled')).toBeDefined()
  })

  it('sending 时展示「中断本轮」并派发 stop', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '内容', sending: true } })
    const button = wrapper.find('.base-button')
    expect(button.text()).toBe('中断本轮')

    await button.trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('渲染已选引用并支持移除', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '', references: REFERENCES } })
    expect(wrapper.findAll('.composer__ref-text').map((node) => node.text())).toEqual([
      '@plan.csv',
      '@rule.txt',
    ])

    await wrapper.findAll('.composer__ref-remove')[1].trigger('click')
    expect(wrapper.emitted('remove-reference')).toEqual([[REFERENCES[1]]])
  })

  it('未提供引用时不渲染引用区', () => {
    const wrapper = mount(Composer, { props: { modelValue: '' } })
    expect(wrapper.find('.composer__refs').exists()).toBe(false)
  })

  it('toolbar 插槽覆盖内置按钮', () => {
    const wrapper = mount(Composer, {
      props: { modelValue: '内容' },
      slots: { toolbar: '<button class="custom-toolbar">自定义</button>' },
    })
    expect(wrapper.find('.custom-toolbar').exists()).toBe(true)
    expect(wrapper.find('.base-button').exists()).toBe(false)
  })

  it('输入时携带文本与光标位置（供 @ 触发检测）', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '' } })
    const textarea = wrapper.find('.composer__input').element as HTMLTextAreaElement
    textarea.value = '看 @plan'
    textarea.setSelectionRange(3, 3)

    await wrapper.find('.composer__input').trigger('input')

    expect(wrapper.emitted('update:modelValue')).toEqual([['看 @plan']])
    expect(wrapper.emitted('input-text')).toEqual([[{ value: '看 @plan', caret: 3 }]])
  })

  it('@ 面板展开时 Enter / 方向键交给上层，不发消息', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '看 @p', mentionOpen: true } })
    const input = wrapper.find('.composer__input')

    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape']) {
      await input.trigger('keydown', { key })
    }

    expect(wrapper.emitted('mention-key')).toEqual([
      ['Enter'],
      ['ArrowDown'],
      ['ArrowUp'],
      ['Escape'],
    ])
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('@ 面板收起时方向键不拦截', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '文本' } })
    await wrapper.find('.composer__input').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('mention-key')).toBeUndefined()
  })

  it('mention 插槽接收目录白名单与工作空间清单', () => {
    const wrapper = mount(Composer, {
      props: { modelValue: '' },
      slots: {
        mention:
          '<template #default="{ directories }"><span class="dirs">{{ directories.length }}</span></template>',
      },
    })
    expect(wrapper.find('.dirs').text()).toBe('9')
  })
})

/** 伪造 scrollHeight（jsdom 不做布局，默认恒为 0） */
function stubScrollHeight(el: HTMLElement, height: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: height, configurable: true })
}

describe('Composer 输入框自适应高度', () => {
  it('初始 2 行：空内容不缩到 1 行', () => {
    const wrapper = mount(Composer, { props: { modelValue: '' } })
    expect(wrapper.find('.composer__input').attributes('rows')).toBe('2')
  })

  it('输入后按内容实际高度撑开（自动折行一并计入）', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '' } })
    const el = wrapper.find('.composer__input').element as HTMLTextAreaElement
    stubScrollHeight(el, 96)

    await wrapper.find('.composer__input').trigger('input')

    expect(parseFloat(el.style.height)).toBeGreaterThanOrEqual(96)
  })

  it('内容减少后高度回缩', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '首行' } })
    const el = wrapper.find('.composer__input').element as HTMLTextAreaElement

    stubScrollHeight(el, 120)
    await wrapper.setProps({ modelValue: '首行\n次行\n三行' })
    await nextTick()
    const tall = parseFloat(el.style.height)
    expect(tall).toBeGreaterThanOrEqual(120)

    stubScrollHeight(el, 44)
    await wrapper.setProps({ modelValue: '首行' })
    await nextTick()
    expect(parseFloat(el.style.height)).toBeLessThan(tall)
  })

  it('发送后清空 → 高度回缩（2 行下限由 CSS min-height 兜底）', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '多行内容' } })
    const el = wrapper.find('.composer__input').element as HTMLTextAreaElement

    stubScrollHeight(el, 88)
    await wrapper.setProps({ modelValue: '多行内容\n第二行' })
    await nextTick()
    const tall = parseFloat(el.style.height)
    expect(tall).toBeGreaterThanOrEqual(88)

    stubScrollHeight(el, 44)
    await wrapper.setProps({ modelValue: '' })
    await nextTick()
    expect(parseFloat(el.style.height)).toBeLessThan(tall)
  })

  it('无布局环境（scrollHeight 为 0）不写入高度，交由 CSS 兜底', async () => {
    const wrapper = mount(Composer, { props: { modelValue: '' } })
    const el = wrapper.find('.composer__input').element as HTMLTextAreaElement

    await wrapper.find('.composer__input').trigger('input')

    expect(el.style.height).toBe('')
  })
})
