/**
 * 单元测试：部署差异项文字（纯函数）
 *
 * 三件事：①带数字人时给"用户 / 数字人"；②数字人为空时不出现孤立的斜杠；
 * ③`detail` 缺失回退到差异类型，两者都缺也不抛错（脏数据容错）。
 */
import { describe, expect, it } from 'vitest'
import { diffText } from './deploy-diff'

describe('diffText', () => {
  it('用户 + 数字人 + 说明', () => {
    expect(
      diffText({
        user_id: 'admin',
        target: 'demo',
        kind: 'missing_in_runtime',
        detail: '运行环境缺失',
      }),
    ).toBe('admin / demo：运行环境缺失')
  })

  it('数字人为空：只给用户，不出现孤立的斜杠', () => {
    expect(
      diffText({ user_id: 'admin', target: '', kind: 'extra_in_runtime', detail: '多出 old' }),
    ).toBe('admin：多出 old')
  })

  it('说明缺失：回退到差异类型（仍可读）', () => {
    expect(diffText({ user_id: 'admin', target: 'demo', kind: 'agent_mismatch', detail: '' })).toBe(
      'admin / demo：agent_mismatch',
    )
  })

  it('说明与类型都缺：只留冒号，不抛错', () => {
    expect(diffText({ user_id: 'admin', target: '', kind: '', detail: '' })).toBe('admin：')
  })
})
