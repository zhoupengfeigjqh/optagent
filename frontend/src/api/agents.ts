/**
 * 数字人与 MCP 接口（`contracts/backend-api.md` §1）
 *
 * 注意 §7 差异 3：`POST /api/agents/{name}/select` **只校验"是否已选中他人"**，
 * 不校验会话是否进行中；"会话进行中禁止切换"（FR-036）是**纯前端 UX 约束**，由 `useAgents` 承担。
 */

import type { HttpClient } from './http'
import type {
  AgentListItem,
  CurrentAgentResponse,
  CurrentMcpResponse,
  DigitalHuman,
  ExitAgentResponse,
  SelectAgentResponse,
} from './types'

/** 数字人 API 接口。 */
export interface AgentsApi {
  /** `GET /api/agents` → 顶层数组 */
  list(): Promise<AgentListItem[]>
  /** `GET /api/agents/{agent_name}` → 详情（`soul` 全文 + 技能 + 工具 + MCP） */
  detail(agentName: string): Promise<DigitalHuman>
  /** `POST /api/agents/{agent_name}/select` */
  select(agentName: string): Promise<SelectAgentResponse>
  /** `POST /api/agents/current/exit` */
  exit(): Promise<ExitAgentResponse>
  /** `GET /api/agents/current` → 未选中时 `agent_name` 为 `null` */
  current(): Promise<CurrentAgentResponse>
  /** `GET /api/agents/current/mcp` → 实例未创建时全部为 `failed` */
  currentMcp(): Promise<CurrentMcpResponse>
}

/** 创建数字人 API。 */
export function createAgentsApi(client: HttpClient): AgentsApi {
  return {
    list: () => client.get<AgentListItem[]>('/api/agents'),
    detail: (agentName) =>
      client.get<DigitalHuman>(`/api/agents/${encodeURIComponent(agentName)}`),
    select: (agentName) =>
      client.post<SelectAgentResponse>(`/api/agents/${encodeURIComponent(agentName)}/select`),
    exit: () => client.post<ExitAgentResponse>('/api/agents/current/exit'),
    current: () => client.get<CurrentAgentResponse>('/api/agents/current'),
    currentMcp: () => client.get<CurrentMcpResponse>('/api/agents/current/mcp'),
  }
}
