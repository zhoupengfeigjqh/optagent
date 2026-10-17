/**
 * 组件测试：MCP 服务功能区（2026-09-27「新建改弹窗 + 创建后自动测试」）
 *
 * 守住的口径：
 * 1. 「新建 MCP 服务」**开弹窗**，不直接导航（导航发生在创建成功之后）；
 * 2. 创建成功 → 导航到该服务详情，并在详情就绪后**自动测试一次**；
 * 3. 自动测试只对"刚创建的那条"生效：普通打开已有服务不测，离开详情即放弃该意图。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpArea from './McpArea.vue'
import McpToolScopeDialog from './McpToolScopeDialog.vue'
import { buildPath } from '../../router'
import type { McpServiceDetail } from '../../api/types'

const httpGet = vi.fn()
const createMcpService = vi.fn()
const probeMcpTarget = vi.fn()
const testMcpService = vi.fn()
const saveMcpServiceConfig = vi.fn()

vi.mock('../../api/http', async () => {
  const actual = await vi.importActual<typeof import('../../api/http')>('../../api/http')
  return { ...actual, http: { ...actual.http, get: (...a: unknown[]) => httpGet(...a) } }
})

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: (...a: unknown[]) => createMcpService(...a),
  saveMcpServiceConfig: (...a: unknown[]) => saveMcpServiceConfig(...a),
  deleteMcpService: vi.fn(),
  testMcpService: (...a: unknown[]) => testMcpService(...a),
  probeMcpTarget: (...a: unknown[]) => probeMcpTarget(...a),
  fetchMcpStats: vi.fn(),
}))

vi.mock('../../api/deploy', () => ({
  fetchReferences: vi
    .fn()
    .mockResolvedValue({ target_type: 'mcp_service', target_name: 'new-mcp', affected: [] }),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
  withdrawDeploy: vi.fn(),
}))

const DETAIL: McpServiceDetail = {
  name: 'new-mcp',
  transport: 'http',
  description: '排产服务',
  url: 'http://192.168.1.2:9000/mcp',
  command: null,
  args: null,
  file_args: {},
  // 工具白名单（2026-10-03）：详情只呈现白名单里的工具
  allowed_tools: ['ocr_image'],
  missing_tools: [],
  // 请求头（2026-10-08）：详情回显的只有掩码；本用例不关心其内容
  headers: {},
  tools: [],
  tools_truncated: false,
  available_tools: [],
  available_tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 1,
}

function mountArea(detail: string | null = null) {
  return mount(McpArea, { props: { detail, tab: null } })
}

/** 走完一次「开弹窗 → 填基础字段 → 探测 → 勾选一个工具 → 创建」（两步流程） */
async function createService(wrapper: ReturnType<typeof mountArea>): Promise<void> {
  await wrapper.find('.mcp-card-list__toolbar button').trigger('click')
  await flushPromises()
  await wrapper.find('#mcp-create-name').setValue('new-mcp')
  await wrapper.find('#mcp-create-url').setValue('http://192.168.1.2:9000/mcp')
  await wrapper.find('[data-test="confirm"]').trigger('click')
  await flushPromises()
  await wrapper.find('[data-test="tool"]').setValue(true)
  await wrapper.find('[data-test="create"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  httpGet.mockReset().mockImplementation((path: string) => {
    if (path === '/api/admin/mcp/services') {
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    }
    if (path === '/api/admin/mcp/stats')
      return Promise.resolve({ stats_available: true, items: [] })
    if (path === '/api/admin/mcp/services/new-mcp') return Promise.resolve(DETAIL)
    if (path === '/api/admin/mcp/services/ocr') return Promise.resolve({ ...DETAIL, name: 'ocr' })
    return Promise.reject(new Error(`unexpected path: ${path}`))
  })
  createMcpService.mockReset().mockResolvedValue({ name: 'new-mcp', revision: 2 })
  // 新建第一步的探测（2026-10-03）：返回一个可选工具，供勾选后创建
  probeMcpTarget.mockReset().mockResolvedValue({
    ok: true,
    tools: [{ name: 'ocr_image', description: '识别图片', parameters: {} }],
    tools_truncated: false,
    error: null,
    error_code: null,
    target: { transport: 'http', url: 'http://192.168.1.2:9000/mcp', command: null },
    checked_at: '2026-09-27T00:00:00.000Z',
  })
  testMcpService.mockReset().mockResolvedValue({
    ok: true,
    connectivity: { ok: true, duration_ms: 1 },
    capability: { ok: true, method: 'ping', duration_ms: 1 },
    target: { transport: 'http', url: 'http://192.168.1.2:9000/mcp', command: null },
    checked_at: '2026-09-27T00:00:00.000Z',
  })
})

describe('McpArea —— 新建入口', () => {
  it('点「新建 MCP 服务」→ 开弹窗，且不导航（导航在创建成功后）', async () => {
    const wrapper = mountArea()
    await flushPromises()

    await wrapper.find('.mcp-card-list__toolbar button').trigger('click')
    await flushPromises()

    expect(wrapper.find('#mcp-create-name').exists()).toBe(true)
    expect(wrapper.emitted('navigate')).toBeUndefined()
  })
})

describe('McpArea —— 创建后的导航与自动测试', () => {
  it('创建成功 → 导航到详情；详情就绪后自动测试一次，且只测一次', async () => {
    const wrapper = mountArea()
    await flushPromises()
    await createService(wrapper)

    expect(wrapper.emitted('navigate')?.at(-1)).toEqual([
      buildPath({ name: 'mcp', detail: 'new-mcp' }),
    ])
    expect(testMcpService).not.toHaveBeenCalled()

    // 路由跟随（父级把 detail 切到新服务）→ 详情加载完成后自动测一次
    await wrapper.setProps({ detail: 'new-mcp' })
    await flushPromises()

    expect(testMcpService).toHaveBeenCalledTimes(1)
    expect(testMcpService).toHaveBeenCalledWith('new-mcp', {
      transport: 'http',
      url: 'http://192.168.1.2:9000/mcp',
    })

    // 离开详情再回来：一次性意图已消费，不再自动测
    await wrapper.setProps({ detail: null })
    await flushPromises()
    await wrapper.setProps({ detail: 'new-mcp' })
    await flushPromises()
    expect(testMcpService).toHaveBeenCalledTimes(1)
  })

  it('普通打开已有服务详情 → 不自动测试', async () => {
    const wrapper = mountArea('ocr')
    await flushPromises()

    expect(testMcpService).not.toHaveBeenCalled()
    // 服务名是详情页标题（确认详情确实渲染了）
    expect(wrapper.text()).toContain('ocr')
  })
})

describe('McpArea —— 立即反馈（方案 B，2026-09-28）', () => {
  it('路由切到某服务后立刻进入详情壳，不等详情接口（含 MCP 探测）返回', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') {
        return new Promise((resolve) => {
          resolveDetail = resolve
        })
      }
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })

    const wrapper = mountArea()
    await flushPromises()

    await wrapper.setProps({ detail: 'ocr' })
    await flushPromises()

    // 请求仍挂起，但界面**已经**在详情页：标题可读 + 明示在等什么
    expect(wrapper.find('.mcp-detail').exists()).toBe(true)
    expect(wrapper.find('#mcp-detail-title').text()).toBe('ocr')
    expect(wrapper.text()).toContain('正在读取调用配置与工具清单')
    // 加载中：表单未渲染，保存/删除不可点（revision 尚未到手）
    expect(wrapper.find('#mcp-description').exists()).toBe(false)
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()

    resolveDetail?.({ ...DETAIL, name: 'ocr' })
    await flushPromises()
    expect(wrapper.find('#mcp-description').exists()).toBe(true)
  })

  it('详情读取失败：停在详情页给出重试，点击后重新拉取', async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') {
        return Promise.reject({ code: 'ADM_MCP_SERVICE_NOT_FOUND', message: '不存在' })
      }
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })
    const wrapper = mountArea('ocr')
    await flushPromises()

    expect(wrapper.text()).toContain('未能读取该服务的配置')
    expect(wrapper.find('#mcp-detail-title').text()).toBe('ocr')

    const before = httpGet.mock.calls.length
    await wrapper.find('[data-test="retry"]').trigger('click')
    await flushPromises()
    expect(httpGet.mock.calls.length).toBeGreaterThan(before)
  })
})

describe('McpArea —— 工具范围调整（2026-10-15：「重新探测」成功后开窗）', () => {
  const OCR = { name: 'ocr_image', description: '识别图片', parameters: {} }
  const PDF = { name: 'ocr_pdf', description: '识别 PDF', parameters: {} }
  const WITH_TOOLS: McpServiceDetail = {
    ...DETAIL,
    name: 'ocr',
    allowed_tools: ['ocr_image'],
    tools: [OCR],
    available_tools: [OCR, PDF],
    revision: 4,
  }

  /** 详情接口被请求了几次（"保存不再重载详情"的断言用） */
  function detailCalls(): number {
    return httpGet.mock.calls.filter(([path]) => path === '/api/admin/mcp/services/ocr').length
  }

  /**
   * 弹窗实例。
   *
   * 后面所有交互都在它内部找元素：`data-test="save"` / `"tool"` 在**详情页头**
   * （保存调用配置）与调用配置表单里也存在，用 `wrapper.find` 会命中错的按钮
   * ——那会让用例看起来"点了保存"，实际改的是调用配置。
   */
  function scopeDialog(wrapper: ReturnType<typeof mountArea>) {
    return wrapper.findComponent(McpToolScopeDialog)
  }

  function checkedTools(wrapper: ReturnType<typeof mountArea>): Array<[string, boolean]> {
    return scopeDialog(wrapper)
      .findAll<HTMLInputElement>('[data-test="tool"]')
      .map((box) => [String(box.element.value), box.element.checked] as [string, boolean])
  }

  async function reprobe(wrapper: ReturnType<typeof mountArea>): Promise<void> {
    // 「工具清单」页签是 `v-show` 常驻，无需先切页签
    await wrapper.find('[data-test="reprobe"]').trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    saveMcpServiceConfig.mockReset().mockResolvedValue({
      name: 'ocr',
      description: 'OCR 识别服务',
      transport: 'http',
      url: 'http://192.168.1.2:9000/mcp',
      command: null,
      args: null,
      file_args: {},
      confirmation: 'never',
      rules_fields: {},
      allowed_tools: ['ocr_image', 'ocr_pdf'],
      headers: {},
      updated_at: '2026-10-15T00:00:00.000Z',
      revision: 5,
      affected_agents: ['u1/agent-a'],
    })
  })

  it('探测成功 → 立即开窗，且按当前白名单预勾选（基准是本次探测的全量清单）', async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') return Promise.resolve(WITH_TOOLS)
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })
    const wrapper = mountArea('ocr')
    await flushPromises()

    await reprobe(wrapper)

    expect(wrapper.find('#mcp-tool-scope-title').text()).toContain('ocr')
    expect(checkedTools(wrapper)).toEqual([
      ['ocr_image', true],
      ['ocr_pdf', false],
    ])
  })

  it('取消 → 弹窗收起、`open` 属性清掉（2026-10-16 假死缺陷：清了属性但没真关，弹窗会留在模态态 → 整页点不动）', async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') return Promise.resolve(WITH_TOOLS)
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })
    const wrapper = mountArea('ocr')
    await flushPromises()
    await reprobe(wrapper)

    // 必须限定在工具范围弹窗里点：`data-test="cancel"` 在删除确认窗（`ConfirmDialog`）里也有，
    // 全局 `find` 会命中那一个（它没开，点了什么也不会发生）
    await scopeDialog(wrapper).find('[data-test="cancel"]').trigger('click')
    await flushPromises()

    const dialog = scopeDialog(wrapper)
    expect(dialog.props('open')).toBe(false)
    expect(dialog.find('dialog').element.hasAttribute('open')).toBe(false)
  })

  it('探测失败（服务连不上）→ **不开窗**：拿不到可信清单时勾选等于凭空造范围', async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') {
        return Promise.resolve({
          ...WITH_TOOLS,
          available_tools: [],
          tools: [],
          tools_error: '连接被拒绝',
        })
      }
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })
    const wrapper = mountArea('ocr')
    await flushPromises()

    await reprobe(wrapper)

    expect(wrapper.findComponent(McpToolScopeDialog).props('open')).toBe(false)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('工具清单不可得')
  })

  it('保存成功 → 白名单与清单**就地**更新，且不重载详情（不丢未提交的表单草稿）', async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === '/api/admin/mcp/services/ocr') return Promise.resolve(WITH_TOOLS)
      if (path === '/api/admin/mcp/stats')
        return Promise.resolve({ stats_available: true, items: [] })
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 })
    })
    const wrapper = mountArea('ocr')
    await flushPromises()
    await reprobe(wrapper)

    const pdf = scopeDialog(wrapper)
      .findAll<HTMLInputElement>('[data-test="tool"]')
      .find((box) => box.element.value === 'ocr_pdf')
    await pdf?.setValue(true)
    const before = detailCalls()

    await scopeDialog(wrapper).find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).toHaveBeenCalledTimes(1)
    expect(detailCalls()).toBe(before)

    // 弹窗收起，清单按新白名单重投影：两个工具都在，且 MUST NOT 把新勾的判成"已不存在"
    expect(wrapper.findComponent(McpToolScopeDialog).props('open')).toBe(false)
    expect(wrapper.findAll('.mcp-tool-list__item')).toHaveLength(2)
    expect(wrapper.find('.mcp-tool-list__item--missing').exists()).toBe(false)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('下次部署时生效')
  })
})
