/**
 * 单元测试：MCP 服务管理状态（US4）
 *
 * 重点守住 `FR-009`：统计读不到时 `statsAvailable=false`，
 * **MUST NOT 以 0 冒充**。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpServices } from './useMcpServices'

const listMcpServices = vi.fn()
const getMcpService = vi.fn()
const saveMcpServiceConfig = vi.fn()
const startMcpService = vi.fn()
const stopMcpService = vi.fn()
const testMcpService = vi.fn()
const fetchMcpLogs = vi.fn()
const fetchMcpStats = vi.fn()

vi.mock('../api/mcp', () => ({
  listMcpServices: (...a: unknown[]) => listMcpServices(...a),
  getMcpService: (...a: unknown[]) => getMcpService(...a),
  saveMcpServiceConfig: (...a: unknown[]) => saveMcpServiceConfig(...a),
  startMcpService: (...a: unknown[]) => startMcpService(...a),
  stopMcpService: (...a: unknown[]) => stopMcpService(...a),
  testMcpService: (...a: unknown[]) => testMcpService(...a),
  fetchMcpLogs: (...a: unknown[]) => fetchMcpLogs(...a),
  fetchMcpStats: (...a: unknown[]) => fetchMcpStats(...a),
}))

const DETAIL = {
  name: 'ocr',
  transport: 'http' as const,
  status: 'running' as const,
  in_compose: true,
  description: 'OCR',
  endpoints: { container_network: 'http://ocr:8000/mcp' },
  command: null,
  args: null,
  writable: false,
  permission_scope: '只读',
  file_args: {},
  tools: [],
  tools_truncated: false,
  tools_error: null,
  compose_declaration: null,
  references: [],
  revision: 2,
}

beforeEach(() => {
  listMcpServices.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
  getMcpService.mockReset().mockResolvedValue(DETAIL)
  saveMcpServiceConfig.mockReset()
  startMcpService.mockReset()
  stopMcpService.mockReset()
  testMcpService.mockReset()
  fetchMcpLogs.mockReset().mockResolvedValue({ items: [], truncated: false })
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
    listMcpServices.mockRejectedValue({ code: 'ADM_COMPOSE_FILE_UNREADABLE', message: 'x' })
    const mcp = useMcpServices()
    await mcp.loadList()
    expect(mcp.error.value?.code).toBe('ADM_COMPOSE_FILE_UNREADABLE')
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

  it('loadLogs：写入有界日志；失败时清空并可读报错', async () => {
    fetchMcpLogs.mockResolvedValue({ items: [{ ts: null, line: 'x' }], truncated: true })
    const mcp = useMcpServices()
    await mcp.loadLogs('ocr', 50)
    expect(fetchMcpLogs).toHaveBeenCalledWith('ocr', 50)
    expect(mcp.logs.value).toHaveLength(1)

    fetchMcpLogs.mockRejectedValue({ code: 'ADM_DOCKER_UNAVAILABLE', message: 'x' })
    await mcp.loadLogs('ocr')
    expect(mcp.error.value?.code).toBe('ADM_DOCKER_UNAVAILABLE')
  })

  it('saveConfig：成功时刷新详情并回传受影响的数字人（FR-044）', async () => {
    saveMcpServiceConfig.mockResolvedValue({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      endpoints: { container_network: 'http://ocr:9000/mcp' },
      writable: false,
      permission_scope: '只读',
      file_args: {},
      revision: 3,
      affected_agents: ['demo'],
    })
    const mcp = useMcpServices()
    await mcp.loadDetail('ocr')

    const affected = await mcp.saveConfig('ocr', {
      description: 'OCR',
      transport: 'http',
      endpoints: { container_network: 'http://ocr:9000/mcp' },
      file_args: {},
    })

    expect(saveMcpServiceConfig).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ revision: 2 }),
    )
    expect(affected).toEqual(['demo'])
    expect(getMcpService).toHaveBeenCalledTimes(2)
  })

  it('saveConfig：未加载 detail 时可用**显式 revision** 保存（修复详情页保存静默失败的接线缺陷）', async () => {
    // 详情页持有的是父组件加载的 props，本实例的 detail 从未加载——
    // 早期实现 `if (!detail.value) return null` 让"保存"永远无效。
    // 修复后允许调用方显式传 revision（即 props.service.revision）。
    saveMcpServiceConfig.mockResolvedValue({
      name: 'ocr',
      description: 'OCR',
      transport: 'http',
      endpoints: {},
      file_args: {},
      revision: 9,
      affected_agents: [],
    })
    const mcp = useMcpServices()
    expect(mcp.detail.value).toBeNull()

    const affected = await mcp.saveConfig(
      'ocr',
      { description: 'OCR', transport: 'http', endpoints: {}, file_args: {} },
      9,
    )

    expect(saveMcpServiceConfig).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ revision: 9 }),
    )
    expect(affected).toEqual([])
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

  it('setRunning：启动 / 关闭分别调用对应端点并刷新（FR-046）', async () => {
    startMcpService.mockResolvedValue({ name: 'ocr', status: 'running' })
    stopMcpService.mockResolvedValue({ name: 'ocr', status: 'stopped' })

    const mcp = useMcpServices()
    expect(await mcp.setRunning('ocr', true)).toBe(true)
    expect(startMcpService).toHaveBeenCalledWith('ocr')

    expect(await mcp.setRunning('ocr', false)).toBe(true)
    expect(stopMcpService).toHaveBeenCalledWith('ocr')
  })

  it('setRunning 失败：返回 false 并可读报错（不误报为成功）', async () => {
    startMcpService.mockRejectedValue({ code: 'ADM_MCP_SERVICE_UNMANAGED', message: 'x' })
    const mcp = useMcpServices()
    expect(await mcp.setRunning('ocr', true)).toBe(false)
    expect(mcp.error.value?.code).toBe('ADM_MCP_SERVICE_UNMANAGED')
    expect(mcp.busy.value).toBe(false)
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
