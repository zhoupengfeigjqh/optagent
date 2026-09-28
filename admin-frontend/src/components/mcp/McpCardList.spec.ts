/**
 * 组件测试：MCP 服务卡片列表（2026-09-27 改版）
 *
 * 覆盖 `FR-043`/`FR-006`：名称、用途描述、传输方式、连接地址；
 * 「新建 MCP 服务」入口；以及 `FR-009` 的统计口径（不可达时显示"未知"而非 0）。
 * 容器运行态（状态四态/编排来源）已随概念下架，不再断言。
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
    url: 'http://192.168.1.2:8000/mcp',
  },
  {
    name: 'local-mcp',
    description: '',
    transport: 'stdio',
    url: null,
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
  it('卡片含名称、用途描述、传输方式与连接地址（FR-043、FR-006）', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('ocr')
    expect(wrapper.text()).toContain('OCR 识别服务')
    expect(wrapper.text()).toContain('传输 streamable-http')
    expect(wrapper.text()).toContain('http://192.168.1.2:8000/mcp')
  })

  it('未填写用途描述时给出占位而非空白；stdio 服务给出"本地命令启动"说明', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('（未填写用途描述）')
    expect(wrapper.text()).toContain('stdio')
    expect(wrapper.text()).toContain('（stdio：本地命令启动）')
  })

  it('统计可用时显示最近一年调用次数', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('最近一年调用 7')
  })

  it('统计不可达时显示"未知"而非 0（FR-009）', () => {
    const wrapper = mountList({ statsAvailable: false, stats: [] })
    expect(wrapper.text()).toContain('最近一年调用 未知')
  })

  it('点击「查看详情」发出 open(name)', async () => {
    const wrapper = mountList()
    await wrapper.findAll('button').find((b) => b.text() === '查看详情')?.trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['ocr'])
  })

  it('顶部工具栏提供「新建 MCP 服务」并发出 create()', async () => {
    const wrapper = mountList()
    const create = wrapper.findAll('button').find((b) => b.text() === '新建 MCP 服务')
    expect(create?.exists()).toBe(true)
    await create?.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('边界：空清单时给出"点击新建"的引导', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('还没有 MCP 服务')
    expect(wrapper.text()).toContain('点击「新建 MCP 服务」登记第一个服务')
  })

  it('边界：读取失败显示可读原因与错误码', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'INTERNAL_ERROR', message: 'x' },
    })
    expect(wrapper.text()).toContain('系统繁忙，请稍后重试')
  })
})
