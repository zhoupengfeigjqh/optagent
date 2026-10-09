/**
 * MCP 服务管理区的常量。
 */

/** 用途描述的输入提示（弹窗新建与详情页表单共用，避免文案漂移） */
export const MCP_DESCRIPTION_PLACEHOLDER = '展示在卡片上的用途说明'

/** 连接地址与名称的输入提示（与后端判据同一口径） */
export const MCP_NAME_HINT = '字母、数字、下划线或连字符，1~64 字符（会成为运行环境的工具前缀）'
export const MCP_URL_HINT = 'http(s):// 开头的可达地址，如 http://192.168.1.2:8000/mcp'

/** 请求头输入提示（2026-10-08；与后端 `MCP_HEADERS_HINT` 同一口径） */
export const MCP_HEADERS_HINT =
  '请求头为「头名 → 值」的 JSON 对象，例如 {"X-MCP-Token":"…"}；值为单行字符串'
export const MCP_HEADERS_PLACEHOLDER = '{"X-MCP-Token":"你的访问令牌"}'
