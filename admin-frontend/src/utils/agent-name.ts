/**
 * 数字人名称判据（`FR-015`，2026-10-09 新建走弹窗后新增）。
 *
 * 与 `admin-backend` `src/domain/config-center/naming.ts` 的 `isSafeName` **同判据**：
 * 名称最终会成为平台设计态的**文件名**（`.platform-data/agents/{name}.json`），
 * 两侧口径分叉就会出现"界面放行、保存却被拒"的割裂体验
 * （与 `PREDEFINED_DATA_PREP_DIRS` 的两处同步约定同理）。
 *
 * 本地判据的目的只有一个：**在弹窗里就挡住非法名与重名**。权威判据仍在服务端
 * （`ADM_AGENT_NAME_TAKEN` / `VALIDATION_FAILED`），本地判据 MUST NOT 被当作放行依据。
 */
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

/**
 * 校验新建数字人的名称。
 *
 * @param raw           用户输入（内部 `trim`：名称即文件名，首尾空白没有意义，
 *                      还会制造"看起来一样、实际是两个数字人"的重名盲区）
 * @param existingNames 已存在的全部数字人名（`CreateAgentDialog` 汇总后传入）
 * @returns 可读原因；通过则返回 `null`
 */
export function validateNewAgentName(raw: string, existingNames: readonly string[]): string | null {
  const name = raw.trim()
  if (name === '') return '数字人名称必填'
  if (!isSafeAgentName(name)) {
    return `名称非法：不得含路径分隔符、“..”或控制字符，且不超过 ${AGENT_NAME_MAX_LENGTH} 个字符`
  }
  if (existingNames.includes(name)) return `数字人名称已存在：${name}（名称 MUST 唯一，请换一个）`
  return null
}
