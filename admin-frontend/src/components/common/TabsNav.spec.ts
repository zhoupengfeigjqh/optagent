/**
 * 组件测试：功能区内页签（T035）
 *
 * 覆盖 ARIA Tabs 模式与键盘操作（原则四、`FR-053`）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TabsNav from './TabsNav.vue'

const tabs = [
  { id: 'soul', label: 'SOUL' },
  { id: 'mcp', label: 'MCP' },
  { id: 'tools', label: '工具' },
]

function mountTabs(modelValue = 'soul') {
  return mount(TabsNav, { props: { tabs, modelValue, label: '数字人设计分区' } })
}

describe('TabsNav', () => {
  it('渲染 tablist / tab / tabpanel 三种角色', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(3)
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true)
  })

  it('tablist 有可读标签，tabpanel 与当前 tab 关联', () => {
    const wrapper = mountTabs('mcp')
    expect(wrapper.find('[role="tablist"]').attributes('aria-label')).toBe('数字人设计分区')
    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe('tabpanel-mcp')
    expect(panel.attributes('aria-labelledby')).toBe('tab-mcp')
  })

  it('只有当前 tab 在 Tab 键顺序内（roving tabindex）', () => {
    const wrapper = mountTabs('mcp')
    const items = wrapper.findAll('[role="tab"]')
    expect(items.map((t) => t.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(items[1]?.attributes('aria-selected')).toBe('true')
  })

  it('点击切换并发出 update:modelValue', async () => {
    const wrapper = mountTabs()
    await wrapper.findAll('[role="tab"]')[2]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['tools'])
  })

  it('方向键循环移动并激活', async () => {
    const wrapper = mountTabs('soul')
    const items = wrapper.findAll('[role="tab"]')
    await items[0]?.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['mcp'])
    await items[2]?.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['soul'])
    await items[0]?.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['tools'])
  })

  it('Home / End 跳到首末项', async () => {
    const wrapper = mountTabs('mcp')
    const items = wrapper.findAll('[role="tab"]')
    await items[1]?.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['soul'])
    await items[1]?.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['tools'])
  })

  it('边界：无页签时不报错', () => {
    const wrapper = mount(TabsNav, { props: { tabs: [], modelValue: '', label: '空' } })
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
  })

  it('边界：modelValue 不在页签列表中时首项可聚焦且不发出事件', () => {
    const wrapper = mountTabs('not-exist')
    const items = wrapper.findAll('[role="tab"]')
    expect(items[0]?.attributes('tabindex')).toBe('0')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('插槽收到当前激活页签标识', () => {
    const wrapper = mount(TabsNav, {
      props: { tabs, modelValue: 'tools', label: 'x' },
      slots: { default: '<span class="probe">{{ params.active }}</span>' },
    })
    expect(wrapper.find('.probe').text()).toBe('tools')
  })
})
