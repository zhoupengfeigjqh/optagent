import { AGENT_NAME_MAX_LENGTH } from '../constants/agent-design'

/** 名称安全：非空、≤ 上限、不含 `/`、`\`、`..` 与控制字符 */
export function isSafeAgentName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false
  if (name.length > AGENT_NAME_MAX_LENGTH) return false
  if (name === '.' || name === '..') return false
  if (/[/\\]/.test(name)) return false
  if (name.includes('..')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false
  return true
}

export function validateNewAgentName(raw: string, existingNames: readonly string[]): string | null {
  const name = raw.trim()
  if (name === '') return '数字人名称必填'
  if (!isSafeAgentName(name)) {
    return `名称非法：不得含路径分隔符、“..”或控制字符，且不超过 ${AGENT_NAME_MAX_LENGTH} 个字符`
  }
  if (existingNames.includes(name)) return `数字人名称已存在：${name}（名称 MUST 唯一，请换一个）`
  return null
}
