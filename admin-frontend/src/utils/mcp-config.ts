import { MCP_NAME_HINT, MCP_URL_HINT } from '../constants/mcp'
import type { McpServiceConfigInput, McpServiceDetail } from '../api/types'

/**
 * 服务名判据（与后端 `isValidMcpServiceName` 同口径；它同时是运行环境的工具前缀）。
 *
 * **禁止 `__`**：运行环境按 `__` 切分把暴露名还原成裸工具名，服务名自带 `__` 会让
 * 裸名匹配不上 ⇒ 权限与规则两层管控静默失效（详见后端 `service-config-fields.ts`）。
 */
export function isValidMcpServiceName(name: string): boolean {
  return /^(?!.*__)[A-Za-z0-9_-]{1,64}$/.test(name)
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

export function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
}

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function parseHeaders(
  text: string,
): { headers: Record<string, string>; error?: undefined } | { headers?: undefined; error: string } {
  const raw = (text ?? '').trim()
  if (raw === '') return { headers: {} }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: '请求头必须是合法 JSON，例如 {"X-MCP-Token":"xxx"}' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: '请求头须为 JSON 对象（头名 → 值），例如 {"X-MCP-Token":"xxx"}' }
  }

  const headers: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [rawName, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const name = rawName.trim()
    if (!isValidHeaderName(name)) {
      return { error: `请求头名称非法：${JSON.stringify(rawName)}（如 X-MCP-Token）` }
    }
    if (seen.has(name.toLowerCase())) return { error: `请求头存在重复的头名：${name}` }
    seen.add(name.toLowerCase())
    if (typeof rawValue !== 'string') return { error: `请求头 ${name} 的值必须是字符串` }
    const value = rawValue.trim()
    if (value === '')
      return { error: `请求头 ${name} 的值不能为空；如需清空请用「清空全部请求头」` }
    if (value.includes('…') || value.includes('•')) {
      return { error: `请求头 ${name} 的值像是界面上显示的掩码，请填真实值` }
    }
    if (hasControlChars(value)) return { error: `请求头 ${name} 的值须为单行字符串` }
    headers[name] = value
  }
  return { headers }
}

export function formatHeaders(headers?: Record<string, string>): string {
  return headers && Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : ''
}

export function buildToolScopePayload(
  service: McpServiceDetail,
  allowedTools: string[],
): McpServiceConfigInput {
  return {
    description: service.description,
    transport: service.transport,
    url: service.url ?? undefined,
    command: service.command ?? undefined,
    args: service.args ?? undefined,
    file_args: service.file_args,
    confirmation: service.confirmation,
    rules_fields: service.rules_fields,
    allowed_tools: [...allowedTools],
    tool_labels: { ...(service.tool_labels ?? {}) },
  }
}
