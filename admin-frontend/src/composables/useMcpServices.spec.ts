/**
 * 单元测试：MCP 服务管理状态
 *
 * 重点守住 `FR-009`：统计读不到时 `statsAvailable=false`，
 * **MUST NOT 以 0 冒充**；以及 2026-09-27 新增的新建/删除语义。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpServices } from './useMcpServices'

const listMcpServices = vi.fn()
const getMcpService = vi.fn()
const createMcpService = vi.fn()
const saveMcpServiceConfig = vi.fn()
const deleteMcpService = vi.fn()
const testMcpService = vi.fn()
const fetchMcpStats = vi.fn()

vi.mock('../api/mcp', () => ({
  listMcpServices: (...a: unknown[]) => listMcpServices(...a),
  getMcpService: (...a: unknown[]) => getMcpService(...a),
  createMcpService: (...a: unknown[]) => createMcpService(...a),
  saveMcpServiceConfig: (...a: unknown[]) => saveMcpServiceConfig(...a),
  deleteMcpService: (...a: unknown[]) => deleteMcpService(...a),
  testMcpService: (...a: unknown[]) => testMcpService(...a),
  fetchMcpStats: (...a: unknown[]) => fetchMcpStats(...a),
}))

const DETAIL = {
  name: 'ocr',
  transport: 'http' as const,
  description: 'OCR',
  url: 'http://192.168.1.2:8000/mcp',
  command: null,
  args: null,
  file_args: {},
  tools: [],
  tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 2,
}

beforeEach(() => {
  listMcpServices.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
  getMcpService.mockReset().mockResolvedValue(DETAIL)
  createMcpService.mockReset()
  saveMcpServiceConfig.mockReset()
  deleteMcpService.mockReset()
  testMcpService.mockReset()
  fetchMcpStats.mockReset().mockResolvedValue({ stats_available: true, items: [], groups: [] })
})

describe('useMcpServices', () => {
  it('loadList / loadDetail 正常路径', async () => {
    const mcp = useMcpServices()
    await mcp.loadList()
    await mcp.loadDetail('ocr')
    expect(mcp.list.value?.page_size).toBe(8)
    expect(mcp.detail.value?.name).toBe('ocr')
  })

  it('loadList 失败：错误可读', async () => {
    listMcpServices.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const mcp = useMcpServices()
    await mcp.loadList()
    expect(mcp.error.value?.code).toBe('ADM_STORAGE_UNAVAILABLE')
  })

  it('loadStats：可用时写入数据（服务级汇总 + 分组行）', async () => {
    fetchMcpStats.mockResolvedValue({
      stats_available: true,
      items: [{ name: 'ocr', calls_total: 1, calls_ok: 1, calls_failed: 0, last_called_at: null }],
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
    })
    const mcp = useMcpServices()
    await mcp.loadStats()
    expect(mcp.statsAvailable.value).toBe(true)
    expect(mcp.stats.value).toHaveLength(1)
    expect(mcp.statsGroups.value).toHaveLength(1)
    expect(mcp.statsGroups.value[0]!.tool_name).toBe('ocr_image')
  })

  it('loadStats：**不可达 → statsAvailable=false 且不填 0**（FR-009）', async () => {
    fetchMcpStats.mockRejectedValue(new Error('boom'))
    const mcp = useMcpServices()
    await mcp.loadStats()
    expect(mcp.statsAvailable.value).toBe(false)
    expect(mcp.stats.value).toEqual([])
    expect(mcp.statsGroups.value).toEqual([])
  })

  it('loadStats：后端明确告知不可用（stats_available=false）时同样保持"未知"', async () => {
    fetchMcpStats.mockResolvedValue({ stats_available: false, items: [], groups: [] })
    const mcp = useMcpServices()
    await mcp.loadStats()
    expect(mcp.statsAvailable.value).toBe(false)
    expect(mcp.statsGroups.value).toEqual([])
  })

  it('createService：成功后返回保存后的完整配置（含新 revision）', async () => {
    createMcpService.mockResolvedValue({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      url: 'http://192.168.1.2:8000/mcp',
      command: null,
      args: null,
      file_args: {},
      rules_fields: {},
      async_tools: [],
      confirmation: 'never',
      updated_at: 'x',
      revision: 3,
      affected_agents: [],
    })

    const mcp = useMcpServices()
    const saved = await mcp.createService({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      url: 'http://192.168.1.2:8000/mcp',
    })

    expect(createMcpService).toHaveBeenCalled()
    expect(saved?.name).toBe('ocr')
    expect(mcp.error.value).toBeNull()
  })

  it('createService：重名失败返回 null 且错误可读（ADM_MCP_SERVICE_EXISTS）', async () => {
    createMcpService.mockRejectedValue({ code: 'ADM_MCP_SERVICE_EXISTS', message: 'x' })
    const mcp = useMcpServices()
    expect(
      await mcp.createService({ name: 'ocr', description: '', transport: 'http', url: 'http://x/mcp' }),
    ).toBeNull()
    expect(mcp.error.value?.code).toBe('ADM_MCP_SERVICE_EXISTS')
    expect(mcp.busy.value).toBe(false)
  })

  it('removeService：成功 true；失败 false 且错误可读', async () => {
    deleteMcpService.mockResolvedValue(undefined)
    const mcp = useMcpServices()
    expect(await mcp.removeService('ocr')).toBe(true)

    deleteMcpService.mockRejectedValue({ code: 'ADM_MCP_SERVICE_NOT_FOUND', message: 'x' })
    expect(await mcp.removeService('ghost')).toBe(false)
    expect(mcp.error.value?.code).toBe('ADM_MCP_SERVICE_NOT_FOUND')
  })

  it('saveConfig：成功时用响应回传受影响数字人与新 revision，**不再二次请求详情**（FR-044、契约 §0.5 ②）', async () => {
    saveMcpServiceConfig.mockResolvedValue({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      url: 'http://192.168.1.2:9000/mcp',
      file_args: {},
      revision: 3,
      affected_agents: ['demo'],
    })
    const mcp = useMcpServices()
    await mcp.loadDetail('ocr')

    const result = await mcp.saveConfig('ocr', {
      description: 'OCR',
      transport: 'http',
      url: 'http://192.168.1.2:9000/mcp',
      file_args: {},
    })

    expect(saveMcpServiceConfig).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ revision: 2 }),
    )
    // `maskedHeaders`：保存响应里的掩码请求头（2026-10-08），界面据此就地刷新展示
    expect(result).toEqual({ affected: ['demo'], revision: 3, maskedHeaders: {} })
    // 详情只被显式 `loadDetail` 请求过一次：保存路径 MUST NOT 再次 GET 详情——
    // 否则会连带触发一次 MCP 实时探测（工具清单抖动 → 界面"闪一下"）
    expect(getMcpService).toHaveBeenCalledTimes(1)
  })

  it('saveConfig：未加载 detail 时可用**显式 revision** 保存（修复详情页保存静默失败的接线缺陷）', async () => {
    // 详情页持有的是父组件加载的 props，本实例的 detail 从未加载——
    // 早期实现 `if (!detail.value) return null` 让"保存"永远无效。
    // 修复后允许调用方显式传 revision（即 props.service.revision）。
    saveMcpServiceConfig.mockResolvedValue({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      url: 'http://x/mcp',
      file_args: {},
      revision: 9,
      affected_agents: [],
    })
    const mcp = useMcpServices()
    expect(mcp.detail.value).toBeNull()

    const result = await mcp.saveConfig(
      'ocr',
      { description: 'OCR', transport: 'http', url: 'http://x/mcp', file_args: {} },
      9,
    )

    expect(saveMcpServiceConfig).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ revision: 9 }),
    )
    expect(result).toEqual({ affected: [], revision: 9, maskedHeaders: {} })
  })

  it('saveConfig：未加载详情且未提供 revision 时不做任何事（防御性）', async () => {
    const mcp = useMcpServices()
    expect(await mcp.saveConfig('ocr', {} as never)).toBeNull()
    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
  })

  it('saveConfig 失败：返回 null 且错误可读', async () => {
    saveMcpServiceConfig.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const mcp = useMcpServices()
    await mcp.loadDetail('ocr')
    expect(await mcp.saveConfig('ocr', {} as never)).toBeNull()
    expect(mcp.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
  })

  it('runTest：返回测试报告；失败可读（FR-047）', async () => {
    const report = {
      ok: false,
      connectivity: { ok: false, duration_ms: 1, error_code: 'MCP_TIMEOUT', message: '超时' },
      capability: { ok: false, method: 'ping', duration_ms: 0 },
      checked_at: 'x',
    }
    testMcpService.mockResolvedValue(report)
    const mcp = useMcpServices()
    expect(await mcp.runTest('ocr')).toEqual(report)

    testMcpService.mockRejectedValue({ code: 'ADM_MCP_SERVICE_NOT_FOUND', message: 'x' })
    expect(await mcp.runTest('ghost')).toBeNull()
    expect(mcp.error.value?.code).toBe('ADM_MCP_SERVICE_NOT_FOUND')
  })
})
