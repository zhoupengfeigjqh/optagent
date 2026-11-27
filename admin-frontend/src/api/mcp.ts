import { http } from './http'
import type {
  McpProbeResult,
  McpServiceConfigPayload,
  McpServiceConfigSaved,
  McpServiceCreatePayload,
  McpServiceDetail,
  McpServiceListItem,
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

export function createMcpService(payload: McpServiceCreatePayload): Promise<McpServiceConfigSaved> {
  return http.post<McpServiceConfigSaved>('/api/admin/mcp/services', payload)
}

export function saveMcpServiceConfig(
  name: string,
  payload: McpServiceConfigPayload,
): Promise<McpServiceConfigSaved> {
  return http.put<McpServiceConfigSaved>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}`,
    payload,
  )
}

export function deleteMcpService(name: string): Promise<void> {
  return http.del<void>(`/api/admin/mcp/services/${encodeURIComponent(name)}`)
}

export interface McpProbePayload {
  transport: string
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  name?: string
}

export function testMcpService(name: string, probe?: McpProbePayload): Promise<McpTestResult> {
  return http.post<McpTestResult>(`/api/admin/mcp/services/${encodeURIComponent(name)}/test`, probe)
}

export function probeMcpTarget(payload: McpProbePayload): Promise<McpProbeResult> {
  return http.post<McpProbeResult>('/api/admin/mcp/probe', payload)
}

export function fetchMcpStats(): Promise<McpStatsResponse> {
  return http.get<McpStatsResponse>('/api/admin/mcp/stats')
}
