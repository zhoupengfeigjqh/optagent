/**
 * 组件测试：「?」气泡提示。
 *
 * 守住：默认不展示文案（省空间）、点击展开/再点收起、点浮层外收起、
 * 无障碍属性齐备（`aria-expanded` / `aria-label` / `role="tooltip"`）、多行文案保留换行。
 */
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import HintTip from './HintTip.vue'

function mountTip(text = '表头须含：产线编号', label = '查看表头要求') {
  return mount(HintTip, { props: { text, label } })
}

describe('HintTip —— 展开与收起', () => {
  it('默认收起：只有「?」按钮，不渲染文案', () => {
    const wrapper = mountTip()

    expect(wrapper.find('.hint-tip__pop').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('表头须含')
    expect(wrapper.find('.hint-tip__btn').text()).toBe('?')
  })

  it('点击展开、再点收起；`aria-expanded` 随状态变化', async () => {
    const wrapper = mountTip()
    const button = wrapper.find('.hint-tip__btn')
    expect(button.attributes('aria-expanded')).toBe('false')

    await button.trigger('click')
    expect(wrapper.find('.hint-tip__pop').text()).toContain('表头须含：产线编号')
    expect(button.attributes('aria-expanded')).toBe('true')

    await button.trigger('click')
    expect(wrapper.find('.hint-tip__pop').exists()).toBe(false)
  })

  it('浮层带 role="tooltip"，按钮带可读的无障碍名', async () => {
    const wrapper = mountTip('x', '查看参数说明')
    expect(wrapper.find('.hint-tip__btn').attributes('aria-label')).toBe('查看参数说明')

    await wrapper.find('.hint-tip__btn').trigger('click')
    expect(wrapper.find('.hint-tip__pop').attributes('role')).toBe('tooltip')
  })

  it('点击浮层外收起（含多行文案保留换行）', async () => {
    document.body.innerHTML = '<div id="outside"></div>'
    const wrapper = mount(HintTip, {
      props: { text: '第一行\n第二行' },
      attachTo: document.body,
    })

    await wrapper.find('.hint-tip__btn').trigger('click')
    expect(wrapper.find('.hint-tip__pop').text()).toContain('第一行')

    document.getElementById('outside')!.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.hint-tip__pop').exists()).toBe(false)
  })

  it('点击浮层内部不收起（浮层里可以选中文字）', async () => {
    const wrapper = mountTip()
    await wrapper.find('.hint-tip__btn').trigger('click')

    await wrapper.find('.hint-tip__pop').trigger('click')

    expect(wrapper.find('.hint-tip__pop').exists()).toBe(true)
  })

  it('卸载时移除 document 监听（不留悬挂监听）', async () => {
    const wrapper = mountTip()
    await wrapper.find('.hint-tip__btn').trigger('click')

    wrapper.unmount()

    // 卸载后再点击 document 不应报错（监听已清理）
    expect(() => document.body.click()).not.toThrow()
  })

  it('点击按钮不冒泡到外层（避免触发外层关闭逻辑）', async () => {
    let clicks = 0
    // 用 render 函数而非模板字符串：运行时渲染模板需要编译器，测试环境只带 runtime
    const Outer = defineComponent({
      render: () =>
        h('div', { onClick: () => (clicks += 1) }, [h(HintTip, { text: 'x' })]),
    })
    const wrapper = mount(Outer)

    await wrapper.find('.hint-tip__btn').trigger('click')

    expect(clicks).toBe(0)
  })
})
