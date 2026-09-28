/**
 * MCP 服务 API（`contracts/admin-api.md` §3.1~§3.6）。
 *
 * **2026-09-27**：MCP 服务改为**平台内全人工配置**，新增新建/删除两个接口；
 * 启停（`/start`、`/stop`）与运行日志（`/logs`）随"不再读容器运行态"整体下架。
 */
import { http } from './http'
import type {
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

/** 新建服务（§3.3）；名称由管理员指定且全局唯一（重名 → `ADM_MCP_SERVICE_EXISTS`） */
export function createMcpService(payload: McpServiceCreatePayload): Promise<McpServiceConfigSaved> {
  return http.post<McpServiceConfigSaved>('/api/admin/mcp/services', payload)
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

/**
 * 删除服务（2026-09-27）。
 *
 * 被数字人引用时**不阻止删除**，但调用方 MUST 先经 §7.1 引用查询列出受影响清单
 * 并二次确认（原"关闭前提示引用"的能力迁移到删除上）。
 */
export function deleteMcpService(name: string): Promise<void> {
  return http.del<void>(`/api/admin/mcp/services/${encodeURIComponent(name)}`)
}

/**
 * 测试 = 连通性 + 一次实际能力验证（`FR-047`）。
 *
 * `probe` 可选：携带**表单里尚未保存**的连接值时按其探测；
 * 不带则按已保存的调用配置测试。
 */
export interface McpProbePayload {
  transport: string
  url?: string
  command?: string
  args?: string[]
}

export function testMcpService(name: string, probe?: McpProbePayload): Promise<McpTestResult> {
  return http.post<McpTestResult>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}/test`,
    probe,
  )
}

/** 调用统计；`stats_available=false` 时界面 MUST 显示"未知"而非 0（`FR-009`） */
export function fetchMcpStats(): Promise<McpStatsResponse> {
  return http.get<McpStatsResponse>('/api/admin/mcp/stats')
}
