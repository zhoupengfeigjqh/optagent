/**
 * 数字人设计区的常量。
 */
import type { AgentScenario, SoulDesign } from '../api/types'

/**
 * "新建数字人"的路径哨兵。
 *
 * 设计态编辑器同时承担"新建"与"编辑"两种职责，二者的差异只是
 * "是否已有一份保存过的设计态文档"。用哨兵而非第二个路由，
 * 是为了保持**功能区内导航不超过两级**（`FR-053`）。
 */
export const NEW_AGENT_SENTINEL = '__new__'

/**
 * 数字人名称的长度上限与提示文案（`FR-015`）。
 *
 * 与 `admin-backend` `domain/config-center/naming.ts` 的 `isSafeName` MUST 同步
 * （名称最终成为设计态文件名 `.platform-data/agents/{name}.json`）。
 */
export const AGENT_NAME_MAX_LENGTH = 64

export const AGENT_NAME_HINT = '不得含路径分隔符或 “..”，且不可与既有数字人重名'

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
  return {
    scenario: '',
    data_prep_dirs: [...PREDEFINED_DATA_PREP_DIRS],
    data_prep_fields: {},
    data_prep_uploads: {},
  }
}

/**
 * 「数据准备」二级目录的可上传文件类型候选（勾选项）。
 *
 * 权威定义在 `admin-backend` `domain/config-center/scenario.ts` 的 `DATA_PREP_UPLOAD_EXTS`
 * （MUST 同步），数组顺序也就是服务端归一化后的固定顺序。
 */
export const DATA_PREP_UPLOAD_EXTS = [
  '.xlsx',
  '.xls',
  '.csv',
  '.txt',
  '.pdf',
  '.json',
  '.zip',
  '.jpg',
  '.png',
  '.jpeg',
] as const

/** 未配置目录时弹窗的默认勾选值（与平台默认 `.csv` / `.xlsx` 一致，FR-004） */
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
  listItems: 20,
  listItemLength: 100,
  capabilityTagLength: 20,
} as const

/** 空结构化 SOUL（新建数字人时的初值） */
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
    // `JSON.stringify(draft.soul) !== JSON.stringify(emptySoulDesign())` 判"是否有输入"，
    // 漏了字段会让"只勾了这个开关"或"什么都没填"的两种状态判反
    next_action_hints: false,
    // 条数同样显式落缺省：脏检查比对的是**整个对象**，少一个键就会与后端 `emptySoulDesign()` 不等
    next_action_hints_count: SOUL_LIMITS.nextActionHintsDefault,
  }
}
