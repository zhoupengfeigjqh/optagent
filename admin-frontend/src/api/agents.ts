import { http } from './http'
import type { OntologyCandidate } from './ontologies'
import type {
  AgentDeletionImpact,
  AgentDesign,
  AgentDesignPayload,
  AgentListItem,
  BuiltinTool,
  McpServiceListItem,
  Paged,
  SkillListItem,
} from './types'

export interface AgentCatalog {
  builtin_tools: BuiltinTool[]
  /** 内置工具目录不可读时的可读原因（此时其余候选仍可用） */
  builtin_tools_error: string | null
  mcp_services: McpServiceListItem[]
  skills: SkillListItem[]
  ontologies: OntologyCandidate[]
}

export function getAgentCatalog(): Promise<AgentCatalog> {
  return http.get<AgentCatalog>('/api/admin/agents/catalog')
}

export function listAgents(page = 1): Promise<Paged<AgentListItem>> {
  return http.get<Paged<AgentListItem>>('/api/admin/agents', { page })
}

/**
 * 取**全量**数字人（授权候选、用户编辑器候选共用）。
 *
 * 列表端点每页固定 8 条且不接受客户端页大小（`admin-backend/src/domain/paging.ts`），
 * 所以这里先取第一页拿到 `total_pages`，其余页并发取完再合并——候选必须全量，
 * 否则第 9 个数字人在界面上会静默缺席（`FR-064` 同口径）。
 *
 * 单一职责：候选的来源只有这一处，避免每个弹窗各写一遍翻页循环（原则二）。
 */
export async function listAllAgents(): Promise<AgentListItem[]> {
  const first = await listAgents(1)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, index) => listAgents(index + 2)),
  )
  return [first, ...rest].flatMap((page) => page.items)
}

export function getAgent(name: string): Promise<AgentDesign> {
  return http.get<AgentDesign>(`/api/admin/agents/${encodeURIComponent(name)}`)
}

export function createAgent(payload: AgentDesignPayload): Promise<AgentDesign> {
  return http.post<AgentDesign>('/api/admin/agents', payload)
}

export function updateAgent(name: string, payload: AgentDesignPayload): Promise<AgentDesign> {
  return http.put<AgentDesign>(`/api/admin/agents/${encodeURIComponent(name)}`, payload)
}

export function deleteAgent(name: string): Promise<void> {
  return http.del<void>(`/api/admin/agents/${encodeURIComponent(name)}`)
}

/** 删除前影响面：待失效的注册链接数与被关联用户（确认弹窗用，判定在服务端） */
export function getAgentDeletionImpact(name: string): Promise<AgentDeletionImpact> {
  return http.get<AgentDeletionImpact>(
    `/api/admin/agents/${encodeURIComponent(name)}/deletion-impact`,
  )
}
