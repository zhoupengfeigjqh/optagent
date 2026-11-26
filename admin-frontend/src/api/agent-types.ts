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
  description: string
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
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
