/**
 * 数字人设计区的常量。
 */
import type { AgentScenario } from '../api/types'

/**
 * "新建数字人"的路径哨兵。
 *
 * 设计态编辑器同时承担"新建"与"编辑"两种职责，二者的差异只是
 * "是否已有一份保存过的设计态文档"。用哨兵而非第二个路由，
 * 是为了保持**功能区内导航不超过两级**（`FR-053`）。
 */
export const NEW_AGENT_SENTINEL = '__new__'

/** 五类配置在编辑器内的分区（页签）标识 */
export const AGENT_DESIGN_TABS = [
  { id: 'soul', label: 'SOUL' },
  { id: 'tools', label: '内置工具' },
  { id: 'mcp', label: 'MCP 服务' },
  { id: 'skills', label: 'SKILL' },
  { id: 'scenario', label: '文件空间场景' },
] as const

export type AgentDesignTab = (typeof AGENT_DESIGN_TABS)[number]['id']

/** 空场景（新建时的初值）：无目录、无字段约束 */
export function emptyScenario(): AgentScenario {
  return { scenario: '', data_prep_dirs: [], data_prep_fields: {} }
}
