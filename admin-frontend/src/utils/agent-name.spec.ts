/**
 * 单元测试：数字人名称判据（`FR-015`，2026-10-09）。
 *
 * 判据与 `admin-backend` `domain/config-center/naming.ts` 的 `isSafeName` **同源**：
 * 这里守住"非法名与重名在弹窗内即被拒绝"这条线——两侧判据分叉的后果是
 * "界面放行、保存却被拒"的割裂体验。
 */
import { describe, expect, it } from 'vitest'
import { AGENT_NAME_MAX_LENGTH } from '../constants/agent-design'
import { isSafeAgentName, validateNewAgentName } from './agent-name'

const EXISTING = ['生产计划助手', 'demo']

describe('isSafeAgentName', () => {
  it('常规中文名与英文名合法', () => {
    expect(isSafeAgentName('生产计划助手')).toBe(true)
    expect(isSafeAgentName('agent-1_2')).toBe(true)
  })

  it('空名、分隔符、`..`、控制字符、超长均非法', () => {
    expect(isSafeAgentName('')).toBe(false)
    expect(isSafeAgentName('a/b')).toBe(false)
    expect(isSafeAgentName('a\\b')).toBe(false)
    expect(isSafeAgentName('..')).toBe(false)
    expect(isSafeAgentName('a..b')).toBe(false)
    expect(isSafeAgentName('a\u0000b')).toBe(false)
    expect(isSafeAgentName('x'.repeat(AGENT_NAME_MAX_LENGTH + 1))).toBe(false)
  })

  it('刚好到达长度上限仍合法（边界）', () => {
    expect(isSafeAgentName('x'.repeat(AGENT_NAME_MAX_LENGTH))).toBe(true)
  })
})

describe('validateNewAgentName', () => {
  it('合法且不重名 → 通过', () => {
    expect(validateNewAgentName('新助手', EXISTING)).toBeNull()
  })

  it('空 / 纯空白 → 提示必填', () => {
    expect(validateNewAgentName('', EXISTING)).toContain('必填')
    expect(validateNewAgentName('   ', EXISTING)).toContain('必填')
  })

  it('非法名 → 给出可读原因（不只说"失败"）', () => {
    expect(validateNewAgentName('a/b', EXISTING)).toContain('名称非法')
  })

  it('重名 → 明确拒绝（FR-015：名称 MUST 唯一）', () => {
    expect(validateNewAgentName('生产计划助手', EXISTING)).toContain('数字人名称已存在')
  })

  it('首尾空白按 trim 后判重名（避免"看起来一样、实际两个数字人"）', () => {
    expect(validateNewAgentName('  demo  ', EXISTING)).toContain('已存在')
  })
})
