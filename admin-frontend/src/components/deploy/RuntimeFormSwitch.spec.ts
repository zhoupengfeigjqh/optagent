/**
 * 组件测试：目标运行形态切换（T082）
 *
 * 守住 `FR-057` / `FR-007`：切换属破坏性操作，**必须二次确认**。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RuntimeFormSwitch from './RuntimeFormSwitch.vue'

const FORMS = [
  { value: 'container_network', label: '容器编排内网' },
  { value: 'host_local', label: '宿主机本地' },
]

function mountSwitch(current = 'container_network') {
  return mount(RuntimeFormSwitch, { props: { current, forms: FORMS } })
}

describe('RuntimeFormSwitch', () => {
  it('展示当前形态，并对当前项标 aria-checked', () => {
    const wrapper = mountSwitch()
    expect(wrapper.text()).toContain('container_network')
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios[0]?.attributes('aria-checked')).toBe('true')
    expect(radios[1]?.attributes('aria-checked')).toBe('false')
  })

  it('选项来自服务端 props（前端不硬编码形态名）', () => {
    const wrapper = mountSwitch()
    expect(wrapper.text()).toContain('宿主机本地')
  })

  it('点击当前形态不触发任何操作', async () => {
    const wrapper = mountSwitch()
    await wrapper.findAll('[role="radio"]')[0]?.trigger('click')
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('点击另一形态先弹二次确认，不立即切换（FR-057）', async () => {
    const wrapper = mountSwitch()
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('既有部署产物将按新形态重新物化')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('确认后才发出 switch 事件', async () => {
    const wrapper = mountSwitch()
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="confirm"]').trigger('click')
    expect(wrapper.emitted('switch')?.[0]).toEqual(['host_local'])
  })

  it('取消则不发出 switch', async () => {
    const wrapper = mountSwitch()
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="cancel"]').trigger('click')
    expect(wrapper.emitted('switch')).toBeUndefined()
  })

  it('提示不依赖修改 hosts 文件或手工编辑配置', () => {
    const wrapper = mountSwitch()
    expect(wrapper.text()).toContain('hosts')
  })

  it('边界：形态列表为空时不报错', () => {
    const wrapper = mount(RuntimeFormSwitch, { props: { current: 'x', forms: [] } })
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(0)
  })
})
