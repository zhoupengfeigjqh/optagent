/**
 * 组件测试：空数据引导气泡（014）。
 *
 * 关注三件事：文案原样呈现、关闭只上抛事件、无障碍语义（status + 关闭按钮名称）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UploadHintBubble from './UploadHintBubble.vue'

const TEXT = '当前您还没有准备数据，请点击 “+” 上传吧。'

describe('UploadHintBubble', () => {
  it('原样呈现传入的文案', () => {
    const wrapper = mount(UploadHintBubble, { props: { text: TEXT } })

    expect(wrapper.text()).toContain(TEXT)
  })

  it('以 status 角色暴露为提示，关闭按钮有可读名称', () => {
    const wrapper = mount(UploadHintBubble, { props: { text: TEXT } })

    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.get('button').attributes('aria-label')).toBe('关闭提示')
  })

  it('点击「×」只上抛 close，不触发其它动作', async () => {
    const wrapper = mount(UploadHintBubble, { props: { text: TEXT } })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击文案区域不会关闭（避免误触）', async () => {
    const wrapper = mount(UploadHintBubble, { props: { text: TEXT } })

    await wrapper.get('.upload-hint__text').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
