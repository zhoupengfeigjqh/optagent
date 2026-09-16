/**
 * 单元测试：错误码 → 中文文案映射（原则七）
 *
 * 守住两条口径：
 * ① 前端**按 code 分派**文案，不直接展示后端 `message`；
 * ② 未知码回退通用文案并**保留原码**（便于排查）。
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_ERROR_CODES, ERROR_MESSAGES, GENERIC_MESSAGE } from '../constants/error-messages'
import { extractDetailErrors, toErrorInfo, toUserMessage } from './error-message'

describe('文案映射表完整性', () => {
  it('契约 §0.4 的每个错误码都有中文文案', () => {
    for (const code of Object.values(ADMIN_ERROR_CODES)) {
      expect(ERROR_MESSAGES[code], `缺少 ${code} 的文案`).toBeTruthy()
    }
  })

  it('映射表不含契约之外的码（避免"表里多了没人用"的漂移）', () => {
    const known = new Set<string>(Object.values(ADMIN_ERROR_CODES))
    for (const code of Object.keys(ERROR_MESSAGES)) {
      expect(known.has(code)).toBe(true)
    }
  })

  it('新增 ADM_ 码与复用码都以可读中文呈现', () => {
    expect(toUserMessage({ code: 'ADM_SKILL_ARCHIVE_UNSAFE', message: 'raw' })).toContain('安全风险')
    expect(toUserMessage({ code: 'ADM_RUNTIME_FORM_NOT_CONFIGURED', message: 'raw' })).toContain(
      '运行形态',
    )
  })
})

describe('toUserMessage', () => {
  it('按码分派，**不**直接展示后端 message', () => {
    const text = toUserMessage({ code: 'ADM_USER_ID_TAKEN', message: 'user_id exists: ops' })
    expect(text).toBe('用户标识已存在或非法，请换一个标识')
    expect(text).not.toContain('user_id exists')
  })

  it('未知码：通用文案 + 保留原码', () => {
    expect(toUserMessage({ code: 'SOMETHING_NEW', message: 'x' })).toBe(
      `${GENERIC_MESSAGE}（SOMETHING_NEW）`,
    )
  })

  it('缺 code / 传 null 一律通用文案', () => {
    expect(toUserMessage(null)).toBe(GENERIC_MESSAGE)
    expect(toUserMessage(undefined)).toBe(GENERIC_MESSAGE)
    expect(toUserMessage({ code: '', message: 'x' })).toBe(GENERIC_MESSAGE)
  })
})

describe('toErrorInfo', () => {
  it('带 code 的对象原样保留（含 ApiError）', () => {
    expect(toErrorInfo({ code: 'ADM_AGENT_NOT_FOUND', message: 'm' })).toEqual({
      code: 'ADM_AGENT_NOT_FOUND',
      message: 'm',
    })
  })

  it('普通 Error → NETWORK_ERROR（传输层异常）', () => {
    expect(toErrorInfo(new Error('boom'))).toEqual({ code: 'NETWORK_ERROR', message: 'boom' })
  })

  it('其他类型 → INTERNAL_ERROR（不抛出）', () => {
    expect(toErrorInfo('字符串')).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo(undefined)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })

  it('空 code 视为无码，走普通 Error 分支', () => {
    expect(toErrorInfo({ code: '', message: 'x' })).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })

  it('code 非字符串时也走兜底（不产生非法 ErrorInfo）', () => {
    expect(toErrorInfo({ code: 42, message: 'x' })).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })
})

describe('extractDetailErrors —— 部署前校验的明细（SC-020）', () => {
  it('抽出全部错误项（一次性列全）', () => {
    const items = extractDetailErrors({
      errors: [
        { user_id: 'admin', agent_name: 'demo', category: 'runtime_form', code: 'X', message: 'a' },
        { user_id: 'ops', agent_name: 'demo2', category: 'reference_validity', code: 'Y', message: 'b' },
      ],
    })
    expect(items).toHaveLength(2)
    expect(items[0]?.user_id).toBe('admin')
  })

  it('字段缺失时补空串（界面不出现 undefined）', () => {
    expect(extractDetailErrors({ errors: [{}] })[0]).toEqual({
      user_id: '',
      agent_name: '',
      category: '',
      code: '',
      message: '',
    })
  })

  it('details 不是对象 / errors 不是数组 → 空数组（不抛错）', () => {
    expect(extractDetailErrors(undefined)).toEqual([])
    expect(extractDetailErrors(null)).toEqual([])
    expect(extractDetailErrors('x')).toEqual([])
    expect(extractDetailErrors({ errors: 'nope' })).toEqual([])
  })
})
