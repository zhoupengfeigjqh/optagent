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
  deploy: vi.fn(),
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
  allowed_tools: ['ocr_image'],
  missing_tools: [],
  headers: {},
  tools: [{ name: 'ocr_image', description: '识别图片', parameters: {} }],
  tools_truncated: false,
  available_tools: [{ name: 'ocr_image', description: '识别图片', parameters: {} }],
  available_tools_truncated: false,
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

function headerActions(wrapper: ReturnType<typeof mountDetail>) {
  return wrapper.find('.mcp-detail__actions')
}

async function clickTab(wrapper: ReturnType<typeof mountDetail>, label: string): Promise<void> {
  await wrapper
    .findAll('.tabs-nav__tab')
    .find((tab) => tab.text() === label)
    ?.trigger('click')
  await flushPromises()
}

function activeTab(wrapper: ReturnType<typeof mountDetail>): string {
  return wrapper.find('.tabs-nav__tab--active').text()
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
    confirmation: 'never',
    allowed_tools: ['ocr_image'],
    headers: { 'X-MCP-Token': '6UuE…3F' },
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
  fetchReferences
    .mockReset()
    .mockResolvedValue({ target_type: 'mcp_service', target_name: 'ocr', affected: [] })
})

describe('McpServiceDetail —— 页面级动作位置', () => {
  it('编辑态：右上角同时是「删除服务」与「保存调用配置」，表单内不再有保存按钮', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    expect(headerActions(wrapper).text()).toContain('删除服务')
    expect(headerActions(wrapper).text()).toContain('保存调用配置')
    expect(
      wrapper.findAll('button').filter((b) => /保存调用配置|创建服务/.test(b.text())),
    ).toHaveLength(1)
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

  it('保存响应里的掩码请求头透传给表单：不重载详情也能看到新掩码（2026-10-08）', async () => {
    const wrapper = mountDetail({ ...SERVICE, headers: { 'X-MCP-Token': 'OLD…99' } })
    await flushPromises()
    expect(wrapper.find('[data-test="headers-view"]').text()).toContain('OLD…99')

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="headers-view"]').text()).toContain('6UuE…3F')
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

  it('「重新探测」：向上转发 reprobe 并播报；探测中（loading）按钮禁用（2026-10-02；2026-10-15 改专用事件）', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    await wrapper.find('[data-test="reprobe"]').trigger('click')
    expect(wrapper.emitted('reprobe')).toEqual([[]])
    expect(wrapper.emitted('reload')).toBeUndefined()
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('正在重新探测工具清单')

    const busy = mountDetail(SERVICE, { loading: true })
    await flushPromises()
    expect(busy.find('[data-test="reprobe"]').attributes('disabled')).toBeDefined()
  })

  it('进入「调用统计」才拉取统计（该页签此前首次进入是空的）', async () => {
    const wrapper = mountDetail()
    await flushPromises()

    await wrapper
      .findAll('.tabs-nav__tab')
      .find((t) => t.text() === '调用统计')
      ?.trigger('click')
    await flushPromises()

    const mcp = await import('../../api/mcp')
    expect(mcp.fetchMcpStats).toHaveBeenCalled()
  })
})

describe('McpServiceDetail —— 右上角保存 MUST NOT 切页签（2026-10-16）', () => {
  it('在「工具清单」页签点保存：照常提交，但页签**留在原地**（不再被拽回「调用配置」）', async () => {
    const wrapper = mountDetail()
    await flushPromises()
    await clickTab(wrapper, '工具清单')

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).toHaveBeenCalledTimes(1)
    expect(activeTab(wrapper)).toBe('工具清单')
  })

  it('在别的页签点保存而本地校验不过：页签不动，但要**播报**一句指路（否则看着像"点了没反应"）', async () => {
    const wrapper = mountDetail({ ...SERVICE, url: '' })
    await flushPromises()
    await clickTab(wrapper, '工具清单')

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
    expect(activeTab(wrapper)).toBe('工具清单')
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('调用配置')
  })

  it('人就在「调用配置」页签：校验不过也不额外播报（报错正文就在眼前，不制造噪音）', async () => {
    const wrapper = mountDetail({ ...SERVICE, url: '' })
    await flushPromises()

    await button(wrapper, '保存调用配置')?.trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
    expect(activeTab(wrapper)).toBe('调用配置')
    expect(wrapper.emitted('announce')).toBeUndefined()
  })
})
