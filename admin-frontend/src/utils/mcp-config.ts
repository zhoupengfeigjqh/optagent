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

/** HTTP 头名判据（与后端 `service-config-fields.ts` / 运行环境 `agent-instance.ts` 同一口径） */
export function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
}

/**
 * 值里是否含换行或控制字符（header injection：换行会被拆成额外的头）。
 *
 * 逐字符判断而非正则——控制字符类正则会触发 `no-control-regex`，
 * 且"单行且可打印"这个意图用代码更直白；与后端 `hasControlChars` 同一判据。
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 请求头（2026-10-08）：文本框里的 JSON 对象 → `headers`。
 *
 * 与后端保存期判据同口径，只为"少一次往返"；权威判据仍在服务端
 * （`domain/mcp/service-config-fields.ts` 的 `normalizeHeaders`）。
 * 空串 → `{}`（= 不带请求头）。**掩码值直接拒绝**：界面回显的是 `6UuE…F3Z`
 * 这类掩码，原样提交等于把令牌换成掩码（静默 401，几乎无法自查）。
 */
export function parseHeaders(text: string): { headers: Record<string, string>; error?: undefined } | { headers?: undefined; error: string } {
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
    if (value === '') return { error: `请求头 ${name} 的值不能为空；如需清空请用「清空全部请求头」` }
    if (value.includes('…') || value.includes('•')) {
      return { error: `请求头 ${name} 的值像是界面上显示的掩码，请填真实值` }
    }
    if (hasControlChars(value)) return { error: `请求头 ${name} 的值须为单行字符串` }
    headers[name] = value
  }
  return { headers }
}

/** `headers` → 编辑框内容（空对象 → 空串；用于"编辑"态的初始值） */
export function formatHeaders(headers?: Record<string, string>): string {
  return headers && Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : ''
}
