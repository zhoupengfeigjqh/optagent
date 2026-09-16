/**
 * 组件测试：全局异常项汇总（T082）
 *
 * 守住 `FR-055` / `SC-016`：**一次视图内**列出全部受影响的数字人及其所属用户，
 * 并可跳转到编辑位置。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnomalySummary from './AnomalySummary.vue'

const fetchAnomalies = vi.fn()

vi.mock('../../api/deploy', () => ({
  fetchAnomalies: (...args: unknown[]) => fetchAnomalies(...args),
  fetchReferences: vi.fn(),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
}))

const PAYLOAD = {
  items: [
    {
      user_id: 'admin',
      agent_name: 'demo',
      category: 'builtin_tool' as const,
      target_name: 'ghost',
      detail: '引用的内置工具 ghost 不在工具目录中',
    },
    {
      user_id: 'ops',
      agent_name: 'demo2',
      category: 'mcp_service' as const,
      target_name: 'ocr-old',
      detail: '引用的 MCP 服务 ocr-old 不在容器编排声明中',
    },
  ],
  total: 2,
  truncated: false,
  edit_path: '/agents/{agent_name}?tab={category}',
}

beforeEach(() => {
  fetchAnomalies.mockReset()
})

describe('AnomalySummary', () => {
  it('一次视图内列出全部受影响数字人及所属用户（SC-016）', async () => {
    fetchAnomalies.mockResolvedValue(PAYLOAD)
    const wrapper = mount(AnomalySummary)
    await flushPromises()

    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).toContain('admin')
    expect(wrapper.text()).toContain('demo2')
    expect(wrapper.text()).toContain('共 2 项失效引用')
  })

  it('类别以图标 + 文本呈现，不只靠颜色', async () => {
    fetchAnomalies.mockResolvedValue(PAYLOAD)
    const wrapper = mount(AnomalySummary)
    await flushPromises()
    expect(wrapper.text()).toContain('内置工具')
    expect(wrapper.text()).toContain('MCP 服务')
  })

  it('「去修复」按服务端返回的路径模板跳转（前端不硬编码路由）', async () => {
    fetchAnomalies.mockResolvedValue(PAYLOAD)
    const wrapper = mount(AnomalySummary)
    await flushPromises()

    const buttons = wrapper.findAll('button').filter((b) => b.text() === '去修复')
    await buttons[0]?.trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['/agents/demo?tab=builtin_tool'])
  })

  it('边界：无异常项显示空态', async () => {
    fetchAnomalies.mockResolvedValue({ items: [], total: 0, truncated: false, edit_path: '' })
    const wrapper = mount(AnomalySummary)
    await flushPromises()
    expect(wrapper.text()).toContain('没有异常项')
  })

  it('边界：失败显示可读原因', async () => {
    fetchAnomalies.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const wrapper = mount(AnomalySummary)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('平台设计态存储不可写')
  })

  it('未关联用户的异常项显示为「未关联」而非空白', async () => {
    fetchAnomalies.mockResolvedValue({
      ...PAYLOAD,
      items: [{ ...PAYLOAD.items[0]!, user_id: '' }],
      total: 1,
    })
    const wrapper = mount(AnomalySummary)
    await flushPromises()
    expect(wrapper.text()).toContain('（未关联）')
  })

  it('刷新按钮重新拉取', async () => {
    fetchAnomalies.mockResolvedValue(PAYLOAD)
    const wrapper = mount(AnomalySummary)
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '刷新')?.trigger('click')
    await flushPromises()
    expect(fetchAnomalies).toHaveBeenCalledTimes(2)
  })
})
