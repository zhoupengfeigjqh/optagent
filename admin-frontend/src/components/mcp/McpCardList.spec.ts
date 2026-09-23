/**
 * 组件测试：MCP 服务卡片列表（T118）
 *
 * 覆盖 `FR-043`/`FR-006`：名称与用途描述、状态四态、异常原因；
 * 以及 `FR-009` 的统计口径（不可达时显示"未知"而非 0）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import McpCardList from './McpCardList.vue'
import type { McpServiceListItem } from '../../api/types'

const ITEMS: McpServiceListItem[] = [
  {
    name: 'ocr',
    description: 'OCR 识别服务',
    transport: 'http',
    status: 'running',
    in_compose: true,
    configured: true,
    abnormal_reason: null,
  },
  {
    name: 'ghost',
    description: '',
    transport: 'stdio',
    status: 'unknown',
    in_compose: false,
    configured: true,
    abnormal_reason: '服务 ghost 已不在容器编排声明中（可能已移除或改名）',
  },
]

function mountList(overrides: Record<string, unknown> = {}) {
  return mount(McpCardList, {
    props: {
      items: ITEMS,
      total: 2,
      page: 1,
      loading: false,
      error: null,
      stats: [{ name: 'ocr', calls_total: 7, calls_ok: 7, calls_failed: 0, last_called_at: 'x' }],
      statsAvailable: true,
      ...overrides,
    },
  })
}

describe('McpCardList', () => {
  it('卡片含名称、用途描述、传输方式与状态（FR-043、FR-006）', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('ocr')
    expect(wrapper.text()).toContain('OCR 识别服务')
    expect(wrapper.text()).toContain('传输 streamable-http')
    expect(wrapper.text()).toContain('运行中')
  })

  it('未填写用途描述时给出占位而非空白', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('（未填写用途描述）')
  })

  it('状态不止靠颜色：每种状态都有文本', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('未知')
  })

  it('不在编排中的服务标为异常并给出具体差异（FR-052）', () => {
    const wrapper = mountList()
    const abnormal = wrapper.find('.card--abnormal')
    expect(abnormal.exists()).toBe(true)
    expect(abnormal.text()).toContain('已不在容器编排声明中')
  })

  it('统计可用时显示最近一年调用次数', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('最近一年调用 7')
  })

  it('统计不可达时显示"未知"而非 0（FR-009）', () => {
    const wrapper = mountList({ statsAvailable: false, stats: [] })
    expect(wrapper.text()).toContain('最近一年调用 未知')
  })

  it('未配置的服务明确标注', () => {
    const wrapper = mountList({
      items: [{ ...ITEMS[0]!, configured: false, description: '' }],
    })
    expect(wrapper.text()).toContain('未配置')
  })

  it('点击「查看详情」发出 open(name)', async () => {
    const wrapper = mountList()
    await wrapper.findAll('button').find((b) => b.text() === '查看详情')?.trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['ocr'])
  })

  it('边界：编排中无服务时给出自动识别说明', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('容器编排中没有 MCP 服务')
    expect(wrapper.text()).toContain('无需平台侧登记')
  })

  it('边界：读取失败显示可读原因与错误码', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'ADM_COMPOSE_FILE_UNREADABLE', message: 'x' },
    })
    expect(wrapper.text()).toContain('无法读取容器编排声明')
  })
})
