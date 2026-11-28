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
  /**
   * 服务编码（`DH-` 开头，全局唯一、创建后不可改）。
   *
   * **省略 / 空串 = 由平台生成**（`DH-` + 5 位去混淆 Base32）。生成结果是权威值，
   * 调用方 MUST 以 `POST` 响应的 `code` 为准，不得本地预生成或自行拼接——
   * 编码会被注册链接与审计引用，前端再生成一份就等于出现第二个真相源。
   * 仅导入历史数据或指定可读语义码时才显式传入。
   */
  code?: string
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

/* ---------- §13 鉴权扩展 ---------- */

export interface MeProfile {
  user_id: string
  phone: string | null
  display_name: string | null
  role: 'admin' | 'user'
}

