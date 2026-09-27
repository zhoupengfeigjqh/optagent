/**
 * MCP 调用配置的**基础字段**校验（2026-09-27）。
 *
 * 弹窗新建（`McpCreateDialog`）与详情页表单（`McpCallConfigForm`）MUST 共用本模块：
 * 同一规则在多处各写一套，必然漂移成"弹窗能过、表单报错"（宪章原则二"同一职责唯一实现"）。
 *
 * 这里只做**少一次往返**的本地预校验，权威判据仍在后端
 * （`domain/mcp/service-config.ts` 的 `normalize()`）：重名（`ADM_MCP_SERVICE_EXISTS`）
 * 与 `file_args` / `rules_fields` 等形状校验只有服务端能判定。
 */
import { MCP_NAME_HINT, MCP_URL_HINT } from '../constants/mcp'

/** 服务名判据（与后端 `isValidMcpServiceName` 同口径；它同时是运行环境的工具前缀） */
export function isValidMcpServiceName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name)
}

export interface McpBasicsInput {
  /**
   * 服务名。**可选**：编辑态的名称取自服务端且不可改，无需（也不应）在此校验；
   * 只有新建弹窗会传。
   */
  name?: string
  transport: 'http' | 'stdio'
  url?: string
  command?: string
}

/** 返回首条可读错误；全部合法返回 `null` */
export function validateMcpBasics(input: McpBasicsInput): string | null {
  if (input.name !== undefined && !isValidMcpServiceName(input.name.trim())) {
    return `服务名非法：${MCP_NAME_HINT}`
  }
  if (input.transport === 'http') {
    const url = (input.url ?? '').trim()
    if (url === '') return `连接地址必填（${MCP_URL_HINT}）`
    if (!/^https?:\/\//i.test(url)) return `连接地址须为 ${MCP_URL_HINT}`
    return null
  }
  if ((input.command ?? '').trim() === '') return '启动命令必填（stdio 传输）'
  return null
}
