import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Model } from '../../api/types'
import ComposerToolbar from './ComposerToolbar.vue'

const MODELS: Model[] = [
  { model: 'qwen-max', is_default: true },
  { model: 'qwen-plus', is_default: false },
]

/** 判断 `first` 是否位于 `second` 之前（文档顺序）。 */
function isBefore(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('ComposerToolbar', () => {
  it('布局契约：加号在最左，模型在思考开关之前（FR-008）', () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS } })
    const left = wrapper.find('.composer-toolbar__left').element
    const right = wrapper.find('.composer-toolbar__right').element
    const picker = wrapper.find('.model-picker').element
    const toggle = wrapper.find('.thinking-toggle').element

    expect(isBefore(left, right)).toBe(true)
    expect(isBefore(picker, toggle)).toBe(true)
    expect(wrapper.find('.composer-toolbar__left .base-icon').exists()).toBe(true)
  })

  it('点击加号派发 toggle-upload', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS } })
    await wrapper.find('.composer-toolbar__left .base-button').trigger('click')
    expect(wrapper.emitted('toggle-upload')).toHaveLength(1)
  })

  it('uploadDisabled 时加号禁用且不派发', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS, uploadDisabled: true } })
    const plus = wrapper.find('.composer-toolbar__left .base-button')
    expect(plus.attributes('disabled')).toBeDefined()

    await plus.trigger('click')
    expect(wrapper.emitted('toggle-upload')).toBeUndefined()
  })

  it('点击思考开关派发 toggle-thinking', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS, thinking: true } })
    await wrapper.find('.thinking-toggle').trigger('click')
    expect(wrapper.emitted('toggle-thinking')).toHaveLength(1)
    expect(wrapper.find('.thinking-toggle__label').text()).toBe('思考')
  })

  it('选择模型派发 select-model', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS, model: null } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')
    await wrapper.findAll('.base-dropdown__item')[1].trigger('click')

    expect(wrapper.emitted('select-model')).toEqual([['qwen-plus']])
  })

  it('canSend=false 时发送禁用且不派发', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS, canSend: false } })
    const send = wrapper.find('.base-button--primary')
    expect(send.attributes('disabled')).toBeDefined()
    expect(send.text()).toBe('发送')

    await send.trigger('click')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('可发送时点击发送派发 send', async () => {
    const wrapper = mount(ComposerToolbar, { props: { models: MODELS, canSend: true } })
    await wrapper.find('.base-button--primary').trigger('click')
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('streaming 时展示「中断本轮」且发送置灰', async () => {
    const wrapper = mount(ComposerToolbar, {
      props: { models: MODELS, canSend: true, streaming: true },
    })
    const stop = wrapper.find('.base-button--secondary')
    expect(stop.text()).toBe('中断本轮')
    expect(wrapper.find('.base-button--primary').attributes('disabled')).toBeDefined()

    await stop.trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)

    await wrapper.find('.base-button--primary').trigger('click')
    expect(wrapper.emitted('send')).toBeUndefined()
  })
})
