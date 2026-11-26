import type { AgentScenario, SoulDesign } from '../api/types'

export const NEW_AGENT_SENTINEL = '__new__'

/**
 * 数字人名称的长度上限与提示文案（`FR-015`）。
 *
 * 与 `admin-backend` `domain/config-center/naming.ts` 的 `isSafeName` MUST 同步
 * （名称最终成为设计态文件名 `.platform-data/agents/{name}.json`）。
 */
export const AGENT_NAME_MAX_LENGTH = 64

export const AGENT_NAME_HINT = '不得含路径分隔符或 “..”，且不可与既有数字人重名'

export const AGENT_DESIGN_TABS = [
  { id: 'soul', label: 'SOUL' },
  { id: 'tools', label: '内置工具' },
  { id: 'mcp', label: 'MCP 服务' },
  { id: 'skills', label: 'SKILL' },
  { id: 'ontologies', label: '本体' },
  { id: 'scenario', label: '文件空间场景' },
] as const

export type AgentDesignTab = (typeof AGENT_DESIGN_TABS)[number]['id']

export const PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const

export function emptyScenario(): AgentScenario {
  return {
    scenario: '',
    data_prep_dirs: [...PREDEFINED_DATA_PREP_DIRS],
    data_prep_fields: {},
    data_prep_uploads: {},
  }
}

export const DATA_PREP_UPLOAD_EXTS = [
  '.xlsx',
  '.xls',
  '.csv',
  '.txt',
  '.pdf',
  '.json',
  '.html',
  '.zip',
  '.jpg',
  '.png',
  '.jpeg',
] as const

export const DEFAULT_DATA_PREP_UPLOADS = ['.csv', '.xlsx'] as const

/**
 * 结构化 SOUL 的字段上限（004）。
 *
 * 与 `admin-backend` `domain/config-center/soul-design.ts` 的 `SOUL_LIMITS`
 * MUST 同步：前端用它做 maxlength 与计数提示，后端用它做保存校验，
 * 两侧不同步会造成"界面允许输入、保存却被拒"的割裂体验。
 */
export const SOUL_LIMITS = {
  intro: 100,
  welcome: 100,
  starterPrompt: 150,
  starters: 12,
  toolsPerStarter: 10,
  mission: 4000,
  promptExtra: 4000,
  /**
   * 下一步动作提示条数（007）：下限、上限与缺省。
   * 输入框的 `min` / `max` 与初值共用这组数字，后端 `readPositiveInt` 用同一组做拒绝式校验。
   */
  nextActionHintsMin: 1,
  nextActionHintsMax: 6,
  nextActionHintsDefault: 3,
  focusDepthMin: 0,
  focusDepthMax: 2,
  focusDepthDefault: 0,
  listItems: 20,
  listItemLength: 100,
  capabilityTagLength: 20,
} as const

export function emptySoulDesign(): SoulDesign {
  return {
    intro: '',
    welcome: '',
    starters: [],
    mission: '',
    capability_tags: [],
    forbidden: [],
    prompt_extra: '',
    // 007：新建默认关闭。**这个键必须显式写出**——`useAgentDesign.dirty` 用
    next_action_hints: false,
    next_action_hints_count: SOUL_LIMITS.nextActionHintsDefault,
    // 013：同上，必须显式——与后端 `emptySoulDesign()` 同形，脏检查才不会一进页面就报"有修改"
    intent_focus: false,
    intent_focus_depth: SOUL_LIMITS.focusDepthDefault,
    input_rewrite: false,
    term_normalize: false,
    task_planning: false,
  }
}
