/**
 * 组件测试：MCP 服务详情（2026-09-27 改版）
 *
 * 守住四条容易回退的口径：
 * 1. **页面级动作在右上角**——「删除服务」「保存调用配置」在页头，不在表单里；
 * 2. 右上角的保存**走表单自身的提交路径**（含本地校验），不是第二套判据；
 * 3. 配置面板**常驻**（`v-show`）——切页签回来时未保存的编辑不丢，保存按钮在任意页签可用；
 * 4. 暴露的 `runTest()`（父级"创建成功后自动测试一次"用）与「发起测试」按钮**同一路径**。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpServiceDetail from './McpServiceDetail.vue'
import type { ErrorInfo, McpServiceDetail as Detail } from '../../api/types'

const saveMcpServiceConfig = vi.fn()
const deleteMcpService = vi.fn()
const testMcpService = vi.fn()
const fetchReferences = vi.fn()

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: vi.fn(),
  saveMcpServiceConfig: (...a: unknown[]) => saveMcpServiceConfig(...a),
  deleteMcpService: (...a: unknown[]) => deleteMcpService(...a),
  testMcpService: (...a: unknown[]) => testMcpService(...a),
  fetchMcpStats: vi.fn().mockResolvedValue({ stats_available: true, items: [], groups: [] }),
}))

vi.mock('../../api/deploy', () => ({
  fetchReferences: (...a: unknown[]) => fetchReferences(...a),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
  withdrawDeploy: vi.fn(),
}))

const SERVICE: Detail = {
  name: 'ocr',
  transport: 'http',
  description: 'OCR 识别服务',
  url: 'http://192.168.1.2:8000/mcp',
  command: null,
  args: null,
  file_args: {},
  tools: [{ name: 'ocr_image', description: '识别图片', parameters: {} }],
  tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 1,
}

function mountDetail(
  service: Detail | null = SERVICE,
  extra: { loading?: boolean; openedName?: string; error?: ErrorInfo | null } = {},
) {
  return mount(McpServiceDetail, {
    props: {
      openedName: extra.openedName ?? service?.name ?? 'ghost',
      service,
      loading: extra.loading ?? false,
      error: extra.error ?? null,
    },
  })
}

function button(wrapper: ReturnType<typeof mountDetail>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

/** 页面右上角的动作区 */
function headerActions(wrapper: ReturnType<typeof mountDetail>) {
  return wrapper.find('.mcp-detail__actions')
}

beforeEach(() => {
  saveMcpServiceConfig.mockReset().mockResolvedValue({
    name: 'ocr',
    description: 'OCR 识别服务',
    transport: 'http',
    url: 'http://192.168.1.2:8000/mcp',
    command: null,
    args: null,
    file_args: {},
    rules_fields: {},
    async_tools: [],
    confirmation: 'never',
    updated_at: 'x',
    revision: 2,
    affected_agents: [],
  })
  deleteMcpService.mockReset().mockResolvedValue(undefined)
  testMcpService.mockReset().mockResolvedValue({
    ok: true,
    connectivity: { ok: true, duration_ms: 1 },
    capability: { ok: true, method: 'ping', duration_ms: 1 },
    target: { transport: 'http', url: 'http://192.168.1.2:8000/mcp', command: null },
    checked_at: '2026-09-27T00:00:00.000Z',
  })
  fetchReferences.mockReset().mockResolvedValue({ target_type: 'mcp_service', target_name: 'ocr', affected: [] })
})

describe('McpServiceDetail —— 页面级动作位置', () => {
  it('编辑态：右上角同时是「删除服务」与「保存调用配置」，表单内不再有保存按钮', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    expect(headerActions(wrapper).text()).toContain('删除服务')
    expect(headerActions(wrapper).text()).toContain('保存调用配置')
    // 表单里只剩「发起测试」（与连接地址同排）
    expect(wrapper.findAll('button').filter((b) => /保存调用配置|创建服务/.test(b.text()))).toHaveLength(1)
  })

  it('暴露的 runTest()（父级"创建后自动测试一次"用）：按表单当前值探测并播报结果', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    await (wrapper.vm as unknown as { runTest: () => Promise<void> }).runTest()
    await flushPromises()

    expect(testMcpService).toHaveBeenCalledWith('ocr', {
      transport: 'http',
      url: 'http://192.168.1.2:8000/mcp',
    })
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('连通性与能力验证均通过')
  })

  it('点击右上角保存 → 走表单提交路径发出 PUT（含当前 revision）', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ url: 'http://192.168.1.2:8000/mcp', revision: 1 }),
    )
  })

  it('表单本地校验不过时右上角保存不提交（同一套判据）', async () => {
    const wrapper = mountDetail({ ...SERVICE, url: '' })
    await flushPromises()

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('连接地址必填')
  })

  it('删除：先取受影响清单并二次确认，确认后才调 DELETE', async () => {
    fetchReferences.mockResolvedValue({
      target_type: 'mcp_service',
      target_name: 'ocr',
      affected: [{ user_id: 'admin', agent_name: 'demo' }],
    })
    const wrapper = mountDetail()
    await flushPromises()

    await button(wrapper, '删除服务')?.trigger('click')
    await flushPromises()

    expect(fetchReferences).toHaveBeenCalledWith('mcp_service', 'ocr')
    expect(wrapper.text()).toContain('正被 1 个数字人引用')
    expect(deleteMcpService).not.toHaveBeenCalled()

    await wrapper.find('dialog button.btn--danger').trigger('click')
    await flushPromises()
    expect(deleteMcpService).toHaveBeenCalledWith('ocr')
    expect(wrapper.emitted('deleted')?.[0]).toEqual(['ocr'])
  })
})

describe('McpServiceDetail —— 加载态（方案 B，2026-09-28）', () => {
  it('加载中：标题用已知服务名、给出加载提示、页头动作禁用（revision 未到手）', async () => {
    const wrapper = mountDetail(null, { loading: true, openedName: 'antv' })
    await flushPromises()

    expect(wrapper.find('#mcp-detail-title').text()).toBe('antv')
    expect(wrapper.text()).toContain('正在读取调用配置与工具清单')
    // 数据未到手：不得渲染表单，也不得让"保存/删除"可点
    expect(wrapper.find('#mcp-description').exists()).toBe(false)
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="delete"]').attributes('disabled')).toBeDefined()
  })

  it('数据到手后动作区恢复可用', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="delete"]').attributes('disabled')).toBeUndefined()
  })

  it('读取失败：停在详情页给出可读原因与「重试」（不是默默退回列表）', async () => {
    const wrapper = mountDetail(null, {
      openedName: 'antv',
      error: { code: 'ADM_RUNTIME_UNREACHABLE', message: '连不上' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('未能读取该服务的配置')
    expect(wrapper.text()).toContain('ADM_RUNTIME_UNREACHABLE')

    await wrapper.find('[data-test="retry"]').trigger('click')
    expect(wrapper.emitted('reload')).toEqual([[]])
  })
})

describe('McpServiceDetail —— 页签与草稿', () => {
  it('切到「工具清单」再切回，未保存的编辑仍在（配置面板常驻）', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    const tabs = wrapper.findAll('.tabs-nav__tab')
    await wrapper.find('#mcp-description').setValue('我改的用途')

    await tabs.find((t) => t.text() === '工具清单')?.trigger('click')
    await flushPromises()
    await tabs.find((t) => t.text() === '调用配置')?.trigger('click')
    await flushPromises()

    expect((wrapper.find('#mcp-description').element as HTMLInputElement).value).toBe('我改的用途')
  })

  it('进入「调用统计」才拉取统计（该页签此前首次进入是空的）', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    await wrapper.findAll('.tabs-nav__tab').find((t) => t.text() === '调用统计')?.trigger('click')
    await flushPromises()

    const mcp = await import('../../api/mcp')
    expect(mcp.fetchMcpStats).toHaveBeenCalled()
  })
})
