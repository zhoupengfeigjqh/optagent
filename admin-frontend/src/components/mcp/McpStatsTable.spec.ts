/**
 * 组件测试：MCP 调用统计表（T118）
 *
 * 核心口径（`FR-009`）：不可达时显示**「未知」而非 0**。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import McpStatsTable from './McpStatsTable.vue'

const ITEMS = [
  {
    name: 'ocr',
    calls_total: 5,
    calls_ok: 4,
    calls_failed: 1,
    last_called_at: '2026-09-15T06:00:00Z',
    windows: {
      h24: { ok: 2, failed: 0, total: 2 },
      d7: { ok: 3, failed: 1, total: 4 },
      d30: { ok: 4, failed: 1, total: 5 },
      d365: { ok: 4, failed: 1, total: 5 },
    },
    users: [
      {
        user_id: 'admin',
        calls_total: 4,
        calls_ok: 3,
        calls_failed: 1,
        last_called_at: '2026-09-15T06:00:00Z',
      },
      {
        user_id: 'zpf',
        calls_total: 1,
        calls_ok: 1,
        calls_failed: 0,
        last_called_at: '2026-09-14T09:00:00Z',
      },
    ],
  },
]

describe('McpStatsTable', () => {
  it('展示四个时间窗（成功/总数）+ 累计（成功/失败）+ 最近调用时间', () => {
    const wrapper = mount(McpStatsTable, { props: { items: ITEMS, available: true } })
    const text = wrapper.text()
    expect(text).toContain('ocr')
    // 时间窗列头
    expect(text).toContain('最近24h')
    expect(text).toContain('最近7天')
    expect(text).toContain('最近30天')
    expect(text).toContain('最近一年')
    // 窗口单元格：成功/总数
    expect(text).toContain('2/2')
    expect(text).toContain('3/4')
    // 累计：成功 / 失败
    expect(text).toContain('4 / 1')
    expect(text).toContain('2026-09-15T06:00:00Z')
  })

  it('旧数据无 windows 字段：时间窗显示"—"而非报错', () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [{ name: 'legacy', calls_total: 1, calls_ok: 1, calls_failed: 0, last_called_at: null }],
        available: true,
      },
    })
    expect(wrapper.text()).toContain('legacy')
    expect(wrapper.text()).toContain('—')
  })

  it('不可达时全部数值显示为"未知"，并给出明确说明（MUST NOT 以 0 冒充）', () => {
    const wrapper = mount(McpStatsTable, { props: { items: [], available: false } })
    expect(wrapper.text()).toContain('未知')
    expect(wrapper.text()).toContain('MUST NOT 以 0 冒充')
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('only 过滤：只显示指定服务', () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [...ITEMS, { name: 'other', calls_total: 1, calls_ok: 1, calls_failed: 0, last_called_at: null }],
        available: true,
        only: 'other',
      },
    })
    expect(wrapper.text()).toContain('other')
    expect(wrapper.text()).not.toContain('ocr')
  })

  it('边界：可用但无任何调用记录时给出明确空态（而不是"未知"）', () => {
    const wrapper = mount(McpStatsTable, { props: { items: [], available: true } })
    expect(wrapper.text()).toContain('尚无任何调用记录')
  })

  it('边界：从未调用的服务显示"从未调用"而非空', () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [{ name: 'ocr', calls_total: 0, calls_ok: 0, calls_failed: 0, last_called_at: null }],
        available: true,
      },
    })
    expect(wrapper.text()).toContain('从未调用')
  })
})

describe('McpStatsTable —— 按用户明细展开（2026-09-16 十四次调整）', () => {
  it('展开后显示该服务每个用户的调用次数（成功/失败分列）', async () => {
    const wrapper = mount(McpStatsTable, { props: { items: ITEMS, available: true } })

    expect(wrapper.find('.mcp-stats__detail').exists()).toBe(false)

    await wrapper.find('button.mcp-stats__toggle').trigger('click')

    const detail = wrapper.find('.mcp-stats__detail')
    expect(detail.exists()).toBe(true)
    const text = detail.text().replace(/\s+/g, '')
    expect(text).toContain('admin')
    expect(text).toContain('成功3/失败1（共4次）')
    expect(text).toContain('zpf')
    expect(text).toContain('成功1/失败0（共1次）')
    expect(wrapper.find('button.mcp-stats__toggle').attributes('aria-expanded')).toBe('true')
  })

  it('同时只展开一行：展开第二个服务时第一个自动收起', async () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [...ITEMS, { name: 'other', calls_total: 1, calls_ok: 1, calls_failed: 0, last_called_at: null }],
        available: true,
      },
    })

    const buttons = wrapper.findAll('button.mcp-stats__toggle')
    await buttons[0]!.trigger('click')
    expect(wrapper.findAll('tr.mcp-stats__detail-row')).toHaveLength(1)

    await buttons[1]!.trigger('click')
    expect(wrapper.findAll('tr.mcp-stats__detail-row')).toHaveLength(1)
    expect(wrapper.find('.mcp-stats__detail').text()).toContain('暂无按用户明细')
  })

  it('无 users 明细（旧响应或明细已超保留期）：明说原因，不静默留白', async () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [{ name: 'legacy', calls_total: 2, calls_ok: 2, calls_failed: 0, last_called_at: null }],
        available: true,
      },
    })

    await wrapper.find('button.mcp-stats__toggle').trigger('click')

    expect(wrapper.find('.mcp-stats__detail').text()).toContain('暂无按用户明细')
  })

  it('user_id 为 null（升级前的历史事件）：显示"未归属"而非空白', async () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        items: [
          {
            name: 'ocr',
            calls_total: 1,
            calls_ok: 1,
            calls_failed: 0,
            last_called_at: null,
            users: [
              { user_id: null, calls_total: 1, calls_ok: 1, calls_failed: 0, last_called_at: null },
            ],
          },
        ],
        available: true,
      },
    })

    await wrapper.find('button.mcp-stats__toggle').trigger('click')

    expect(wrapper.find('.mcp-stats__detail').text()).toContain('未归属·升级前记录')
  })
})
