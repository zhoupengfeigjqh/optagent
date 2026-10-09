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
import { buildPath } from '../../router'
import type { McpServiceDetail } from '../../api/types'

const httpGet = vi.fn()
const createMcpService = vi.fn()
const probeMcpTarget = vi.fn()
const testMcpService = vi.fn()

vi.mock('../../api/http', async () => {
  const actual = await vi.importActual<typeof import('../../api/http')>('../../api/http')
  return { ...actual, http: { ...actual.http, get: (...a: unknown[]) => httpGet(...a) } }
})

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: (...a: unknown[]) => createMcpService(...a),
  saveMcpServiceConfig: vi.fn(),
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
    if (path === '/api/admin/mcp/stats') return Promise.resolve({ stats_available: true, items: [] })
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
      if (path === '/api/admin/mcp/stats') return Promise.resolve({ stats_available: true, items: [] })
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
      if (path === '/api/admin/mcp/stats') return Promise.resolve({ stats_available: true, items: [] })
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
