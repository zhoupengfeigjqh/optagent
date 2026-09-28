/**
 * 组件测试：MCP 调用统计表。
 *
 * 核心口径（`FR-009`）：不可达时显示**「未知」而非 0**。
 *
 * 2026-09-23 改版：**一行 = 一个「用户 × 服务 × 工具」组合**，单元格为「总次数/成功次数」；
 * 原「明细」展开列已移除（用户已进列，分组行即最细粒度）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import McpStatsTable from './McpStatsTable.vue'

const GROUPS = [
  {
    service: 'ocr',
    tool_name: 'ocr_image',
    user_id: 'admin',
    calls_total: 5,
    calls_ok: 4,
    calls_failed: 1,
    last_called_at: '2026-09-23T06:00:00Z',
    windows: {
      h24: { ok: 2, failed: 0, total: 2 },
      d7: { ok: 3, failed: 1, total: 4 },
      d30: { ok: 4, failed: 1, total: 5 },
      d365: { ok: 4, failed: 1, total: 5 },
    },
  },
  {
    service: 'ocr',
    tool_name: 'ocr_pdf',
    user_id: 'zpf',
    calls_total: 1,
    calls_ok: 1,
    calls_failed: 0,
    last_called_at: '2026-09-22T09:00:00Z',
    windows: {
      h24: { ok: 1, failed: 0, total: 1 },
      d7: { ok: 1, failed: 0, total: 1 },
      d30: { ok: 1, failed: 0, total: 1 },
      d365: { ok: 1, failed: 0, total: 1 },
    },
  },
  {
    service: 'jev',
    tool_name: 'jev_run',
    user_id: 'admin',
    calls_total: 2,
    calls_ok: 2,
    calls_failed: 0,
    last_called_at: '2026-09-21T09:00:00Z',
    windows: {
      h24: { ok: 0, failed: 0, total: 0 },
      d7: { ok: 2, failed: 0, total: 2 },
      d30: { ok: 2, failed: 0, total: 2 },
      d365: { ok: 2, failed: 0, total: 2 },
    },
  },
]

describe('McpStatsTable —— 表头与网格', () => {
  it('列出 用户名 / 服务名 / 工具名 + 四个时间窗 + 最近调用时间（共 8 列）', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: GROUPS, available: true } })

    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual([
      '用户名',
      '服务名',
      '工具名',
      '最近24h',
      '最近7天',
      '最近30天',
      '最近一年',
      '最近调用时间',
    ])
  })

  it('一行 = 一个「用户 × 服务 × 工具」组合，窗口单元格为「总次数/成功次数」', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: GROUPS, available: true } })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)

    expect(rows[0]!.findAll('td').map((td) => td.text())).toEqual([
      'admin',
      'ocr',
      'ocr_image',
      '2/2',
      '4/3',
      '5/4',
      '5/4',
      '2026-09-23T06:00:00Z',
    ])
    // 同一服务的另一个工具、另一用户各占一行，互不合并
    expect(rows[1]!.findAll('td')[2]!.text()).toBe('ocr_pdf')
    expect(rows[1]!.findAll('td')[0]!.text()).toBe('zpf')
  })

  it('不再有「明细」列与展开入口（2026-09-23 移除）', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: GROUPS, available: true } })
    expect(wrapper.findAll('thead th')).toHaveLength(8)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('展开')
  })

  it('only：只显示指定服务的行（服务详情页用）', () => {
    const wrapper = mount(McpStatsTable, {
      props: { groups: GROUPS, available: true, only: 'ocr' },
    })

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).not.toContain('jev')
  })
})

describe('McpStatsTable —— 不可达时以「未知」呈现（FR-009）', () => {
  it('available=false：计数与时间一律「未知」，不出现 0', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: GROUPS, available: false } })

    const cells = wrapper.findAll('tbody tr')[0]!.findAll('td').map((td) => td.text())
    // 三个维度列仍照实显示（那是"谁调的"，不是统计值），计数与时间列一律未知
    expect(cells.slice(0, 3)).toEqual(['admin', 'ocr', 'ocr_image'])
    expect(cells.slice(3)).toEqual(['未知', '未知', '未知', '未知', '未知'])
    expect(wrapper.find('.mcp-stats__unknown').exists()).toBe(true)
  })

  it('不可达且无行：空态也是「未知」，MUST NOT 说成"尚无任何调用记录"', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: [], available: false } })

    expect(wrapper.find('tbody').text()).toContain('未知')
    expect(wrapper.find('tbody').text()).not.toContain('尚无任何调用记录')
  })
})

describe('McpStatsTable —— 历史与缺失数据', () => {
  it('user_id / tool_name 为 null（升级前的事件）：显示"未归属·升级前记录"而非空白', () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        groups: [
          {
            service: 'ocr',
            tool_name: null,
            user_id: null,
            calls_total: 1,
            calls_ok: 1,
            calls_failed: 0,
            last_called_at: null,
          },
        ],
        available: true,
      },
    })

    const cells = wrapper.findAll('tbody tr')[0]!.findAll('td').map((td) => td.text())
    expect(cells[0]).toBe('（未归属·升级前记录）')
    expect(cells[2]).toBe('（未归属·升级前记录）')
  })

  it('缺时间窗（旧响应）：该单元格显示"—"，未调用过的时间显示"从未调用"', () => {
    const wrapper = mount(McpStatsTable, {
      props: {
        groups: [
          {
            service: 'ocr',
            tool_name: 'ocr_image',
            user_id: 'admin',
            calls_total: 1,
            calls_ok: 1,
            calls_failed: 0,
            last_called_at: null,
          },
        ],
        available: true,
      },
    })

    const cells = wrapper.findAll('tbody tr')[0]!.findAll('td').map((td) => td.text())
    expect(cells.slice(3, 7)).toEqual(['—', '—', '—', '—'])
    expect(cells[7]).toBe('从未调用')
  })
})

describe('McpStatsTable —— 空态', () => {
  it('有统计但无任何行：明说"尚无任何调用记录"', () => {
    const wrapper = mount(McpStatsTable, { props: { groups: [], available: true } })
    expect(wrapper.find('tbody').text()).toContain('尚无任何调用记录')
  })

  it('only 且该服务无行：只提示一次"该服务从未被调用过"（不重复渲染两条空态）', () => {
    const wrapper = mount(McpStatsTable, {
      props: { groups: GROUPS, available: true, only: 'never-called' },
    })

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('该服务从未被调用过')
    expect(wrapper.text()).not.toContain('尚无任何调用记录')
  })
})
