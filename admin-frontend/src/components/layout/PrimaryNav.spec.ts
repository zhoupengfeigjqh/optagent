/**
 * 组件测试：一级导航（T035）
 *
 * 覆盖 props / emit / 边界（`FR-053`：常驻 4 项、当前项 `aria-current`、键盘可达）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PrimaryNav from './PrimaryNav.vue'
import { NAV_ITEMS } from '../../router'

describe('PrimaryNav', () => {
  it('常驻渲染 4 个功能区，标签与顺序固定', () => {
    const wrapper = mount(PrimaryNav, { props: { current: 'agents' } })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(4)
    expect(buttons.map((b) => b.text())).toEqual(NAV_ITEMS.map((i) => i.label))
  })

  it('当前项标 aria-current=page，其余不标', () => {
    const wrapper = mount(PrimaryNav, { props: { current: 'deploy' } })
    const current = wrapper.find('[aria-current="page"]')
    expect(current.attributes('data-route')).toBe('deploy')
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('点击发出 navigate 事件', async () => {
    const wrapper = mount(PrimaryNav, { props: { current: 'agents' } })
    await wrapper.find('[data-route="skills"]').trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['skills'])
  })

  it('不因内部状态禁用任何导航项（FR-053）', () => {
    const wrapper = mount(PrimaryNav, { props: { current: 'mcp' } })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeUndefined()
    }
  })

  it('是原生可聚焦控件（键盘可达）', () => {
    const wrapper = mount(PrimaryNav, { props: { current: 'mcp' } })
    expect(wrapper.findAll('button').every((b) => b.element.tagName === 'BUTTON')).toBe(true)
  })
})
