/**
 * 组件测试：MCP 日志查看（T118）
 *
 * 覆盖 `FR-048`：按时间倒序、**有界返回**、失败可读。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpLogViewer from './McpLogViewer.vue'

const fetchMcpLogs = vi.fn()

vi.mock('../../api/mcp', () => ({
  fetchMcpLogs: (...a: unknown[]) => fetchMcpLogs(...a),
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  saveMcpServiceConfig: vi.fn(),
  startMcpService: vi.fn(),
  stopMcpService: vi.fn(),
  testMcpService: vi.fn(),
  fetchMcpStats: vi.fn(),
}))

beforeEach(() => {
  fetchMcpLogs.mockReset()
})

describe('McpLogViewer', () => {
  it('按服务名加载日志并渲染时间戳与正文', async () => {
    fetchMcpLogs.mockResolvedValue({
      items: [
        { ts: '2026-09-15T06:00:02Z', line: '最新一行' },
        { ts: '2026-09-15T06:00:01Z', line: '早一行' },
      ],
      truncated: false,
    })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()

    // 默认 50 条（2026-09-15 调整），可下拉切换 200/500
    expect(fetchMcpLogs).toHaveBeenCalledWith('ocr', 50)
    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('最新一行')
  })

  it('截断时明确标注（有界返回，FR-048）', async () => {
    fetchMcpLogs.mockResolvedValue({ items: [{ ts: null, line: 'x' }], truncated: true })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()
    expect(wrapper.text()).toContain('仅显示最近 50 行')
  })

  it('无时间戳的行标注"（无时间戳）"而非留空', async () => {
    fetchMcpLogs.mockResolvedValue({ items: [{ ts: null, line: 'x' }], truncated: false })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()
    expect(wrapper.text()).toContain('（无时间戳）')
  })

  it('边界：无日志时给出明确文案', async () => {
    fetchMcpLogs.mockResolvedValue({ items: [], truncated: false })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()
    expect(wrapper.text()).toContain('没有日志输出')
  })

  it('边界：读取失败显示可读原因', async () => {
    fetchMcpLogs.mockRejectedValue({ code: 'ADM_DOCKER_UNAVAILABLE', message: 'x' })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('无法访问宿主机 Docker')
  })

  it('切换条数上限后按新 limit 重新拉取', async () => {
    fetchMcpLogs.mockResolvedValue({ items: [], truncated: false })
    const wrapper = mount(McpLogViewer, { props: { serviceName: 'ocr' } })
    await flushPromises()
    await wrapper.find('select').setValue('500')
    await flushPromises()
    expect(fetchMcpLogs).toHaveBeenLastCalledWith('ocr', 500)
  })
})
