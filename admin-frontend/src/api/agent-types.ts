import type { SoulDesign, SoulStarter, SoulStarterTool } from './soul'
export type { SoulDesign, SoulStarter, SoulStarterTool }

export const SCENARIO_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
] as const
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number]

export interface ScenarioField {
  name: string
  type: ScenarioFieldType
  required: boolean
}

export interface AgentScenario {
  scenario: string
  data_prep_dirs: string[]
  data_prep_fields: Record<string, ScenarioField[]>
  data_prep_uploads?: Record<string, string[]>
}

export interface AgentListItem {
  name: string
  /** 对外编码（与注册服务的 `code` 同源；旧设计未回填时为 null） */
  code: string | null
  description: string
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
}

/** 删除前影响面（2026-11-27）：确认弹窗据此提示将被级联撤销的链接数 */
export interface AgentDeletionImpact {
  name: string
  /** 对外编码；该数字人尚无服务时为 null */
  code: string | null
  /** 已关联该数字人的用户（非空则服务端会拒绝删除） */
  linked_users: string[]
  /** 删除时会被一并软撤销的注册链接条数（仅统计未撤销的） */
  active_register_links: number
}

export interface AgentDesign {
  name: string
  soul: SoulDesign
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  ontologies: string[]
  scenario: AgentScenario
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
  revision: number
}

export interface AgentDesignPayload {
  name: string
  soul: SoulDesign
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  ontologies: string[]
  scenario: AgentScenario
  revision?: number
}
