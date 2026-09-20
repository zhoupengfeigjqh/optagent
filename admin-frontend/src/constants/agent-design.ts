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

/**
 * 「数据准备」预定义二级目录（平台硬编码）。
 *
 * 与 `admin-backend` `domain/config-center/scenario.ts` 的同名常量 MUST 同步。
 * 场景清单必须完整包含这组目录；预定义目录不强制字段约束（0 条 = 无约束）。
 */
export const PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const

/** 空场景（新建时的初值）：带预定义目录，无字段约束 */
export function emptyScenario(): AgentScenario {
  return { scenario: '', data_prep_dirs: [...PREDEFINED_DATA_PREP_DIRS], data_prep_fields: {} }
}
