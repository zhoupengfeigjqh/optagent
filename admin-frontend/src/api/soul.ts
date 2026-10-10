/**
 * 结构化 SOUL 的契约类型（004）。
 *
 * 与后端 `admin-backend/src/domain/config-center/soul-design.ts` 同口径：
 * - **展示 / 引导**（不进模型）：`intro` / `welcome` / `starters`
 * - **提示词**（进模型）：`mission` / `capability_tags` / `forbidden` / `prompt_extra`
 *
 * 单独成文件的原因：`api/types.ts` 已接近单文件 500 行门禁（宪章原则二）。
 * `types.ts` 会 re-export 这三个类型，既有引用路径不受影响。
 */

/** 问题实例关联的工具引用 */
export interface SoulStarterTool {
  kind: 'builtin' | 'mcp'
  name: string
  /** 仅 `kind: 'mcp'` 存在：所属 MCP 服务名 */
  service?: string
}

/** 问题实例：卡片文本（点击即发送）+ 关联工具（生成隐藏引导） */
export interface SoulStarter {
  prompt: string
  tools: SoulStarterTool[]
}

/** 结构化 SOUL（设计态权威形态） */
export interface SoulDesign {
  intro: string
  welcome: string
  starters: SoulStarter[]
  mission: string
  capability_tags: string[]
  forbidden: string[]
  prompt_extra: string
}
