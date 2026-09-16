/**
 * MCP 服务 API（`contracts/admin-api.md` §3.1~§3.8）。
 */
import { http } from './http'
import type {
  McpLogLine,
  McpServiceConfigPayload,
  McpServiceConfigSaved,
  McpServiceDetail,
  McpServiceListItem,
  McpServiceStatusResponse,
  McpStatsResponse,
  McpTestResult,
  Paged,
} from './types'

export function listMcpServices(page = 1): Promise<Paged<McpServiceListItem>> {
  return http.get<Paged<McpServiceListItem>>('/api/admin/mcp/services', { page })
}

export function getMcpService(name: string): Promise<McpServiceDetail> {
  return http.get<McpServiceDetail>(`/api/admin/mcp/services/${encodeURIComponent(name)}`)
}

/** 保存调用配置；响应含 `affected_agents`（`FR-044`：自动作用于所有引用者） */
export function saveMcpServiceConfig(
  name: string,
  payload: McpServiceConfigPayload,
): Promise<McpServiceConfigSaved> {
  return http.put<McpServiceConfigSaved>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}`,
    payload,
  )
}

export function startMcpService(name: string): Promise<McpServiceStatusResponse> {
  return http.post<McpServiceStatusResponse>(`/api/admin/mcp/services/${encodeURIComponent(name)}/start`)
}

export function stopMcpService(name: string): Promise<McpServiceStatusResponse> {
  return http.post<McpServiceStatusResponse>(`/api/admin/mcp/services/${encodeURIComponent(name)}/stop`)
}

/**
 * 测试 = 连通性 + 一次实际能力验证（`FR-047`）。
 *
 * `probe` 可选：携带**表单里尚未保存**的连接值时按其探测；
 * 不带则按已保存的调用配置测试。
 */
export interface McpProbePayload {
  transport: string
  endpoints: Record<string, string>
  command?: string
  args?: string[]
}

export function testMcpService(name: string, probe?: McpProbePayload): Promise<McpTestResult> {
  return http.post<McpTestResult>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}/test`,
    probe,
  )
}

export function fetchMcpLogs(
  name: string,
  /** 默认 50 条（与日志查看器的默认值一致）；上限 500 */
  limit = 50,
): Promise<{ items: McpLogLine[]; truncated: boolean }> {
  return http.get<{ items: McpLogLine[]; truncated: boolean }>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}/logs`,
    { limit },
  )
}

/** 调用统计；`stats_available=false` 时界面 MUST 显示"未知"而非 0（`FR-009`） */
export function fetchMcpStats(): Promise<McpStatsResponse> {
  return http.get<McpStatsResponse>('/api/admin/mcp/stats')
}
