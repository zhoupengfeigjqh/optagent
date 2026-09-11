import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Model } from '../../api/types'
import ModelPicker from './ModelPicker.vue'

const MODELS: Model[] = [
  { model: 'qwen-max', is_default: true },
  { model: 'qwen-plus', is_default: false },
]

describe('ModelPicker', () => {
  it('模型列表为空时展示加载中文案，且不展开菜单', async () => {
    const wrapper = mount(ModelPicker, { props: { models: [] } })
    expect(wrapper.find('.model-picker__label').text()).toBe('模型加载中')

    await wrapper.find('.base-dropdown__trigger').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('未选择时展示「默认模型」', () => {
    const wrapper = mount(ModelPicker, { props: { model: null, models: MODELS } })
    expect(wrapper.find('.model-picker__label').text()).toBe('默认模型')
  })

  it('已选模型展示名称，默认项附「默认」标识', () => {
    const asDefault = mount(ModelPicker, { props: { model: 'qwen-max', models: MODELS } })
    expect(asDefault.find('.model-picker__label').text()).toBe('qwen-max（默认）')

    const notDefault = mount(ModelPicker, { props: { model: 'qwen-plus', models: MODELS } })
    expect(notDefault.find('.model-picker__label').text()).toBe('qwen-plus')
  })

  it('展开后列出全部模型并标注默认项', async () => {
    const wrapper = mount(ModelPicker, { props: { model: 'qwen-plus', models: MODELS } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')

    const items = wrapper.findAll('.base-dropdown__item')
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.text())).toEqual(['qwen-max（默认）', 'qwen-plus'])
  })

  it('当前选择处于高亮态（roving tabindex）', async () => {
    const wrapper = mount(ModelPicker, { props: { model: 'qwen-plus', models: MODELS } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')

    expect(wrapper.findAll('.base-dropdown__item').map((item) => item.attributes('tabindex'))).toEqual([
      '-1',
      '0',
    ])
  })

  it('选择模型后派发 select 并收起菜单', async () => {
    const wrapper = mount(ModelPicker, { props: { model: null, models: MODELS } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')
    await wrapper.findAll('.base-dropdown__item')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['qwen-plus']])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('二次点击触发器可收起菜单', async () => {
    const wrapper = mount(ModelPicker, { props: { models: MODELS } })
    const trigger = wrapper.find('.base-dropdown__trigger')

    await trigger.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)

    await trigger.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('disabled 时不展开', async () => {
    const wrapper = mount(ModelPicker, { props: { models: MODELS, disabled: true } })
    await wrapper.find('.base-dropdown__trigger').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })
})
