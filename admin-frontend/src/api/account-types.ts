/**
 * 账号与数字人服务绑定（028 §13）的前端类型 —— 与契约一一映射（原则七）。
 *
 * 独立成件（同 `skill-types.ts` / `agent-types.ts` 先例）：`types.ts` 已接近
 * 500 行硬门禁，新增 §13 类型全部放这里，再由 `types.ts` 统一再导出。
 */

/* ---------- §13 数字人服务 ---------- */

export interface AgentServiceItem {
  code: string
  name: string
  /** 平台设计态数字人名称（部署落点） */
  platform_agent_name: string
  status: 'enabled' | 'disabled'
  /** 已授权（approved）用户数 */
  registered_users: number
  created_at: string
  updated_at: string
}

export interface AgentServiceCreatePayload {
  code: string
  name: string
  platform_agent_name: string
}

export interface AgentServiceUpdatePayload {
  name?: string
  status?: 'enabled' | 'disabled'
}

/* ---------- §13 专属注册链接 ---------- */

export interface RegisterLinkItem {
  token: string
  agent_code: string
  agent_name: string
  /** null = 长期有效 */
  expires_at: string | null
  /** null = 未撤销 */
  revoked_at: string | null
  use_count: number
  created_by: string | null
  created_at: string
}

export interface RegisterLinkCreated {
  token: string
  /** 可直接分发的完整链接（基址未配置时为相对路径） */
  url: string
  agent_code: string
  /** null = 长期有效 */
  expires_at: string | null
}

/* ---------- §13 授权（绑定关联） ---------- */

export type GrantStatus = 'approved' | 'pending' | 'revoked'

export interface GrantItem {
  user_id: string
  phone: string | null
  display_name: string | null
  agent_code: string
  agent_name: string
  status: GrantStatus
  source: 'register_link' | 'apply' | 'manual'
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface GrantApplyResult {
  user_id: string
  agent_code: string
  status: GrantStatus
}

/* ---------- §13 鉴权扩展 ---------- */

export interface MeProfile {
  user_id: string
  phone: string | null
  display_name: string | null
  role: 'admin' | 'user'
}

export interface MyAgents {
  items: Array<{
    code: string
    name: string
    platform_agent_name: string
    status: 'approved'
  }>
  pending: Array<{ code: string; name: string; platform_agent_name: string }>
}

export interface RegisterResult {
  user_id: string
  phone: string
  display_name: string
  granted_agent: { code: string; name: string }
}

export interface RegisterLinkLookup {
  agent: { code: string; name: string }
  expired: boolean
}
