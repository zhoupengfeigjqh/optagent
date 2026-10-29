/**
 * 组件测试：输入区工具栏（014 新增 `upload-hint` 插槽）。
 *
 * 组件不持有业务状态，因此这里只守两件事：
 * 1. 插槽内容必须落在「+」所在分组内（气泡的锚点就是该分组）；
 * 2. 没有插槽时不产生多余 DOM，既有事件仍照常上抛。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ComposerToolbar from './ComposerToolbar.vue'

describe('ComposerToolbar', () => {
  it('点击「+」上抛 toggle-upload', async () => {
    const wrapper = mount(ComposerToolbar)

    await wrapper.get('[aria-label="上传文件"]').trigger('click')

    expect(wrapper.emitted('toggle-upload')).toHaveLength(1)
  })

  it('upload-hint 插槽内容渲染在「+」所在分组内（作为定位锚点）', () => {
    const wrapper = mount(ComposerToolbar, {
      slots: { 'upload-hint': '<div class="fake-hint">提示</div>' },
    })

    const left = wrapper.get('.composer-toolbar__left')
    expect(left.find('.fake-hint').exists()).toBe(true)
    expect(left.find('[aria-label="上传文件"]').exists()).toBe(true)
  })

  it('未提供插槽时左侧分组只有上传按钮（无空容器噪音）', () => {
    const wrapper = mount(ComposerToolbar, {})

    const left = wrapper.get('.composer-toolbar__left')
    expect(left.findAll('button')).toHaveLength(1)
  })

  it('流式中发送位变为中断按钮（既有行为不回归）', async () => {
    const wrapper = mount(ComposerToolbar, { props: { streaming: true, canSend: true } })

    expect(wrapper.find('[aria-label="中断本轮"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('发送')
  })
})
