/**
 * MCP 服务 API（`contracts/admin-api.md` §3.1~§3.6）。
 *
 * **2026-09-27**：MCP 服务改为**平台内全人工配置**，新增新建/删除两个接口；
 * 启停（`/start`、`/stop`）与运行日志（`/logs`）随"不再读容器运行态"整体下架。
 */
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
  /**
   * 请求头（2026-10-08）：真实值。仅在管理员**显式编辑**过请求头时携带；
   * 不携带 = 服务端按**已保存**的请求头连（详情页回显的是掩码，界面拿不到真值）。
   */
  headers?: Record<string, string>
  /** 目标名（仅用于服务端报错文案可读；不参与连接） */
  name?: string
}

export function testMcpService(name: string, probe?: McpProbePayload): Promise<McpTestResult> {
  return http.post<McpTestResult>(
    `/api/admin/mcp/services/${encodeURIComponent(name)}/test`,
    probe,
  )
}

/**
 * 新建前的**工具清单探测**（契约 §3.9，2026-10-03）。
 *
 * 对一个**尚未登记**的连接目标连一次取回工具清单——新建弹窗据此让管理员勾选可见工具。
 * 与 `testMcpService` 的分工：那个要求服务已登记（未登记 404），这个不要求。
 * 连接失败时**返回 `ok: false` + 可读原因而不抛错**：失败要留在弹窗里、由管理员决定重试或放弃。
 */
export function probeMcpTarget(payload: McpProbePayload): Promise<McpProbeResult> {
  return http.post<McpProbeResult>('/api/admin/mcp/probe', payload)
}

/** 调用统计；`stats_available=false` 时界面 MUST 显示"未知"而非 0（`FR-009`） */
export function fetchMcpStats(): Promise<McpStatsResponse> {
  return http.get<McpStatsResponse>('/api/admin/mcp/stats')
}
