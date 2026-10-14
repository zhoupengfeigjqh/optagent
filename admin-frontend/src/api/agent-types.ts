/**
 * 数字人设计相关类型（契约 `admin-api.md` §5）。
 *
 * **2026-10-13 拆件**：从 `api/types.ts` **逐字搬运**而来（原则二：单文件 ≤ 500 行；
 * 拆分前 `types.ts` 实测 499 行，距门禁仅 1 行）。`api/types.ts` 以 re-export 保持
 * 既有一律从 `api/types` 导入的写法**零破坏**；本拆分 MUST NOT 改语义。
 *
 * 契约是唯一事实源；本文件、后端 schema、契约文档与测试用例 MUST 四处同步。
 */
import type { SoulDesign, SoulStarter, SoulStarterTool } from './soul'
export type { SoulDesign, SoulStarter, SoulStarterTool }

/**
 * 字段取值类型（JSON Schema 基本类型的子集）。
 *
 * 与 `admin-backend` / `agent-backend` 的同一枚举**三处同步**（契约 §5.2）。
 */
export const SCENARIO_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
] as const
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number]

/**
 * 数据准备目录的上传表字段约束。
 *
 * 校验发生在**上传时**（由运行环境按表头预检，本期未实现）；此处只声明结构。
 */
export interface ScenarioField {
  /** 字段名（＝上传表的表头名），同目录内唯一 */
  name: string
  type: ScenarioFieldType
  /** 必填：表头 MUST 包含；`false` 为可选（出现则类型仍须匹配） */
  required: boolean
}

/**
 * 「数据准备」目录级可上传文件类型白名单（2026-10-13 新增，契约 §5.3）。
 *
 * 目录名 → 允许上传的扩展名数组；**只出现被配置的目录**（未配置的目录不出现，
 * 缺失 ≡ 平台默认 `.csv` + `.xlsx`）。候选 9 项见 `constants/agent-design.ts`
 * 的 `DATA_PREP_UPLOAD_EXTS`。请求体可省略该键。
 */
export interface AgentScenario {
  scenario: string
  data_prep_dirs: string[]
  /** 目录 → 字段约束；无约束的目录不出现（服务端保证总有该键） */
  data_prep_fields: Record<string, ScenarioField[]>
  /** 目录 → 可上传类型（2026-10-13 新增）；未配置的目录不出现 */
  data_prep_uploads?: Record<string, string[]>
}

export interface AgentListItem {
  name: string
  description: string
  abnormal: boolean
  abnormal_reason: string | null
  updated_at: string
}

/** 设计态完整内容（§5.3 响应） */
export interface AgentDesign {
  name: string
  soul: SoulDesign
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
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
  scenario: AgentScenario
  revision?: number
}
