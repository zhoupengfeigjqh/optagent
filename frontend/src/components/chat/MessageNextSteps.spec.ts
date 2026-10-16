/**
 * 组件测试：下一步动作提示容器（007）。
 *
 * 守住四条：无卡片时**无 DOM**、引导句逐字固定、卡片按序且只有提示词文本、
 * 以及"不含任何工具信息"这条底线（FR-013）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AgentStarter, AgentStarterTool } from '../../api/types'
import { NEXT_STEPS_GUIDE_TEXT } from '../../utils/next-steps'
import MessageNextSteps from './MessageNextSteps.vue'

const TOOL: AgentStarterTool = {
  kind: 'mcp',
  service: 'erp',
  name: 'query_order',
  exposed_name: 'erp__query_order',
}

function action(prompt: string, overrides: Partial<AgentStarter> = {}): AgentStarter {
  return {
    prompt,
    tools: [TOOL],
    guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
    ...overrides,
  }
}

describe('MessageNextSteps', () => {
  it('无卡片 → 根节点不渲染（无 DOM、无间距、无占位）', () => {
    const wrapper = mount(MessageNextSteps, { props: { actions: [] } })

    // `v-if` 未命中：落进 DOM 的只有注释占位，**没有任何元素**
    expect(wrapper.element.nodeType).toBe(Node.COMMENT_NODE)
    expect(wrapper.find('.next-steps').exists()).toBe(false)
    expect(wrapper.find('.next-steps__guide').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('有卡片 → 固定引导句 + 按序卡片，且文案逐字等于 prompt', () => {
    const wrapper = mount(MessageNextSteps, {
      props: { actions: [action('按交付日期梳理订单风险'), action('按月汇总这批订单的数量')] },
    })

    expect(wrapper.find('.next-steps__guide').text()).toBe(NEXT_STEPS_GUIDE_TEXT)
    const cards = wrapper.findAll('button')
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.text())).toEqual([
      '按交付日期梳理订单风险',
      '按月汇总这批订单的数量',
    ])
  })

  it('不出现任何工具信息（服务名 / 工具名 / 暴露名一律不上界面）', () => {
    const wrapper = mount(MessageNextSteps, {
      props: { actions: [action('按交付日期梳理订单风险')] },
    })

    expect(wrapper.text()).not.toContain('erp__query_order')
    expect(wrapper.text()).not.toContain('query_order')
    expect(wrapper.text()).not.toContain('erp')
    expect(wrapper.html()).not.toContain('guidance')
  })

  it('点选某张卡片 → 上抛该卡片（含隐藏引导），由上层决定确认与发送', async () => {
    const actions = [action('按交付日期梳理订单风险'), action('按月汇总这批订单的数量')]
    const wrapper = mount(MessageNextSteps, { props: { actions } })

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([actions[1]])
  })

  it('disabled 透传到每张卡片（本轮进行中 / 未选数字人时置灰）', () => {
    const wrapper = mount(MessageNextSteps, {
      props: { actions: [action('整理表格')], disabled: true },
    })

    expect(
      wrapper.findAll('button').every((card) => card.attributes('disabled') !== undefined),
    ).toBe(true)
  })

  it('语义容器：列表项为 button（原生键盘可达），并带可读的 aria-label', () => {
    const wrapper = mount(MessageNextSteps, { props: { actions: [action('整理表格')] } })

    expect(wrapper.find('section').attributes('aria-label')).toBe('下一步动作')
    expect(wrapper.find('ul').attributes('aria-label')).toBe('下一步动作列表')
    expect(wrapper.findAll('li')).toHaveLength(1)
  })
})
