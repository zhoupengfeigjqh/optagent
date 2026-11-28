import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell.vue'

function mountShell() {
  return mount(AppShell, {
    props: { current: 'agents', areaLabel: '数字人', who: '张三' },
  })
}

describe('AppShell 退出确认', () => {
  it('点页头退出只开确认框，不立即发出 logout', async () => {
    const wrapper = mountShell()
    await wrapper.find('.app-shell__logout').trigger('click')

    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('退出登录')
    expect(wrapper.emitted('logout')).toBeUndefined()
  })

  it('确认后才发出 logout', async () => {
    const wrapper = mountShell()
    await wrapper.find('.app-shell__logout').trigger('click')
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('logout')).toHaveLength(1)
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('取消关闭确认框且不发出 logout', async () => {
    const wrapper = mountShell()
    await wrapper.find('.app-shell__logout').trigger('click')
    await wrapper.find('[data-test="cancel"]').trigger('click')

    expect(wrapper.emitted('logout')).toBeUndefined()
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('未登录（who 为空）时不渲染退出入口', () => {
    const wrapper = mount(AppShell, {
      props: { current: 'agents', areaLabel: '数字人', who: null },
    })
    expect(wrapper.find('.app-shell__logout').exists()).toBe(false)
  })
})
