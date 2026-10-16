/**
 * 错误码文案映射单测（`src/utils/error-message.ts`）
 *
 * 运行方式：`npm run test` / `npm run test:coverage`（本地执行）
 *
 * 覆盖两条硬约束：
 * 1. **前端不直接展示后端 message**（面向开发者且不稳定），一律按 `code` 分派（D13 / V-12）；
 * 2. **同码不同义**——`FILE_TOO_LARGE` 在上传时说"超过 5MB"、在预览时说"文件过大，请下载查看"
 *    （`contracts/backend-api.md` §7 差异 6），因此 `context` 分支必须逐个有用例；
 * 3. **D13 唯一例外**——`FILE_SCHEMA_INVALID`（上传表字段校验）透传后端 `details`
 *    逐条问题清单，不套固定文案。
 */
import { describe, expect, it } from 'vitest'

import { formatErrorDiagnostics, toErrorInfo, toUserMessage } from './error-message'

const GENERIC = '请求失败，请稍后重试'

describe('toUserMessage - 基础映射', () => {
  it('按错误码返回中文文案，不使用后端 message', () => {
    expect(toUserMessage({ code: 'THREAD_NOT_FOUND', message: 'thread 3f2a not found' })).toBe(
      '会话不存在或已被删除',
    )
    expect(toUserMessage({ code: 'AGENT_NOT_SELECTED', message: 'raw' })).toBe('请先选择数字人')
    expect(toUserMessage({ code: 'NETWORK_ERROR', message: 'raw' })).toBe(
      '网络异常，请检查连接后重试',
    )
  })

  it('AGENT_NOT_AVAILABLE：默认与发消息/建会话场景都指向"重新选择"（009 FR-032）', () => {
    expect(toUserMessage({ code: 'AGENT_NOT_AVAILABLE', message: 'raw' })).toBe(
      '该数字人已不可用，请重新选择数字人',
    )
    expect(toUserMessage({ code: 'AGENT_NOT_AVAILABLE', message: '' }, 'send-message')).toContain(
      '选择其他数字人',
    )
    expect(toUserMessage({ code: 'AGENT_NOT_AVAILABLE', message: '' }, 'create-thread')).toContain(
      '重新选择',
    )
  })

  it('null / undefined / 无 code → 通用兜底文案', () => {
    expect(toUserMessage(null)).toBe(GENERIC)
    expect(toUserMessage(undefined)).toBe(GENERIC)
    expect(toUserMessage({ code: '', message: '' })).toBe(GENERIC)
  })

  it('未知错误码 → 通用文案并保留原码（便于排查）', () => {
    expect(toUserMessage({ code: 'SOME_NEW_CODE', message: 'raw' })).toBe(
      `${GENERIC}（SOME_NEW_CODE）`,
    )
  })
})

describe('toUserMessage - 场景化文案（同码不同义）', () => {
  it('FILE_TOO_LARGE：上传场景说尺寸上限', () => {
    expect(toUserMessage({ code: 'FILE_TOO_LARGE', message: '' }, 'upload')).toBe('文件超过 5MB')
  })

  it('FILE_TOO_LARGE：预览场景引导下载', () => {
    expect(toUserMessage({ code: 'FILE_TOO_LARGE', message: '' }, 'preview')).toBe(
      '文件过大，请下载查看',
    )
  })

  it('VALIDATION_FAILED：上传场景指向格式，预览场景指向参数', () => {
    expect(toUserMessage({ code: 'VALIDATION_FAILED', message: '' }, 'upload')).toBe(
      '文件格式不支持',
    )
    expect(toUserMessage({ code: 'VALIDATION_FAILED', message: '' }, 'preview')).toBe('参数非法')
  })

  it('UPLOAD_DIR_FORBIDDEN：上传与预览措辞不同', () => {
    expect(toUserMessage({ code: 'UPLOAD_DIR_FORBIDDEN', message: '' }, 'upload')).toBe(
      '该目录不允许上传',
    )
    expect(toUserMessage({ code: 'UPLOAD_DIR_FORBIDDEN', message: '' }, 'preview')).toBe(
      '该目录不支持预览',
    )
  })

  it('场景无覆盖时回落到基础映射', () => {
    // upload 场景未覆盖 FILE_NOT_FOUND
    expect(toUserMessage({ code: 'FILE_NOT_FOUND', message: '' }, 'upload')).toBe(
      '文件不存在或已被清理',
    )
    // send-message 场景未覆盖 THREAD_NOT_FOUND
    expect(toUserMessage({ code: 'THREAD_NOT_FOUND', message: '' }, 'send-message')).toBe(
      '会话不存在或已被删除',
    )
  })

  it('未传 context 时等同 default（走基础映射）', () => {
    expect(toUserMessage({ code: 'FILE_TOO_LARGE', message: '' })).toBe('文件超过 5MB')
  })

  it('create-thread 场景暂无覆盖项，回落到基础映射', () => {
    expect(toUserMessage({ code: 'THREAD_BUSY_LIMIT', message: '' }, 'create-thread')).toBe(
      '系统繁忙，请稍后重试',
    )
  })
})

describe('toUserMessage - 模型调用失败分级（2026-10-15，TR-54 / 契约 §19.2）', () => {
  const NEW_CODES = [
    'LLM_UNAVAILABLE',
    'LLM_RATE_LIMITED',
    'LLM_INSUFFICIENT_BALANCE',
    'LLM_UNAUTHORIZED',
    'LLM_CONTEXT_TOO_LONG',
  ]

  it('五个新码各有可行动文案：不回落成"（码）"、不展示上游原文', () => {
    for (const code of NEW_CODES) {
      const message = toUserMessage({ code, message: '503 Service is too busy' }, 'send-message')
      expect(message, code).not.toBe(GENERIC)
      expect(message, code).not.toContain(code)
      expect(message, code).not.toContain('Service is too busy')
    }
  })

  it('逐一钉住措辞（口径漂移会被拦下）', () => {
    expect(toUserMessage({ code: 'LLM_UNAVAILABLE', message: '' })).toBe(
      '模型服务暂时不可用，请稍后重试',
    )
    expect(toUserMessage({ code: 'LLM_RATE_LIMITED', message: '' })).toBe(
      '模型调用过于频繁，请稍后重试',
    )
    expect(toUserMessage({ code: 'LLM_INSUFFICIENT_BALANCE', message: '' })).toBe(
      '模型账户余额不足，请联系管理员充值',
    )
    expect(toUserMessage({ code: 'LLM_UNAUTHORIZED', message: '' })).toBe(
      '模型凭证无效或无权限，请联系管理员检查 API Key',
    )
    expect(toUserMessage({ code: 'LLM_CONTEXT_TOO_LONG', message: '' })).toBe(
      '本轮上下文过长，请精简输入或新开会话',
    )
  })

  it('文案不写死上游状态码、不断言"已自动重试"（同一码覆盖 5xx/408/429，是否重试由配置决定）', () => {
    const unavailable = toUserMessage({ code: 'LLM_UNAVAILABLE', message: '' })
    const limited = toUserMessage({ code: 'LLM_RATE_LIMITED', message: '' })

    expect(unavailable).not.toContain('503')
    expect(limited).not.toContain('429')
    expect(unavailable).not.toContain('已自动重试')
    // 具体状态码与线索由诊断行承载，见下方 formatErrorDiagnostics
    expect(
      formatErrorDiagnostics({
        code: 'LLM_UNAVAILABLE',
        message: '',
        upstream_status: 502,
      }),
    ).toBe('LLM_UNAVAILABLE · 上游 502')
  })

  it('兜底码仍走 D13 通用文案 + 保留原码（语义不变，排查线索不丢）', () => {
    expect(toUserMessage({ code: 'LLM_ERROR', message: 'boom' })).toBe(`${GENERIC}（LLM_ERROR）`)
    expect(toUserMessage({ code: 'LOOP_ERROR', message: 'boom' })).toBe(`${GENERIC}（LOOP_ERROR）`)
  })
})

describe('formatErrorDiagnostics - 诊断信息行（2026-10-15，TR-57）', () => {
  it('全字段 → 码 · 上游状态码 · 上游类型 · 请求 ID', () => {
    expect(
      formatErrorDiagnostics({
        code: 'LLM_UNAVAILABLE',
        message: '503 status code (no body)',
        upstream_status: 503,
        upstream_type: 'service_unavailable_error',
        request_id: 'rid-1',
      }),
    ).toBe('LLM_UNAVAILABLE · 上游 503 · 上游类型 service_unavailable_error · 请求 ID rid-1')
  })

  it('缺失字段自动省略（只剩状态码 / 只剩 request_id）', () => {
    expect(
      formatErrorDiagnostics({ code: 'LLM_UNAVAILABLE', message: '', upstream_status: 429 }),
    ).toBe('LLM_UNAVAILABLE · 上游 429')
    expect(formatErrorDiagnostics({ code: 'LLM_ERROR', message: '', request_id: 'rid-9' })).toBe(
      'LLM_ERROR · 请求 ID rid-9',
    )
  })

  it('三个诊断字段全缺 → `null`（调用方据此不渲染该行，避免只重复一个码）', () => {
    expect(formatErrorDiagnostics({ code: 'LLM_UNAVAILABLE', message: 'boom' })).toBeNull()
    expect(formatErrorDiagnostics({ code: 'LLM_ERROR', message: '' })).toBeNull()
  })

  it('`null` / `undefined` 错误体 → `null`（不抛错）', () => {
    expect(formatErrorDiagnostics(null)).toBeNull()
    expect(formatErrorDiagnostics(undefined)).toBeNull()
  })

  it('MUST NOT 掺入后端 `message`（上游原文可能含 provider 内部信息）', () => {
    const line = formatErrorDiagnostics({
      code: 'LLM_UNAVAILABLE',
      message: '503 Service is too busy: upstream trace abc',
      upstream_status: 503,
    })

    expect(line).not.toContain('Service is too busy')
    expect(line).not.toContain('upstream trace')
  })
})

describe('toUserMessage - FILE_SCHEMA_INVALID（D13 例外，透传 details）', () => {
  it('details 为非空字符串数组 → 换行拼接逐条问题', () => {
    const message = toUserMessage(
      {
        code: 'FILE_SCHEMA_INVALID',
        message: '上传表不符合该目录的字段约束',
        details: ['缺少必填表头：「产线编号」', '第 2 行「计划量」取值 "abc" 类型不符（期望整数）'],
      },
      'upload',
    )
    expect(message).toBe(
      '缺少必填表头：「产线编号」\n第 2 行「计划量」取值 "abc" 类型不符（期望整数）',
    )
  })

  it('details 缺失 / 空数组 / 非字符串数组 → 固定文案兜底', () => {
    expect(toUserMessage({ code: 'FILE_SCHEMA_INVALID', message: '' }, 'upload')).toBe(
      '上传表不符合该目录的字段约束',
    )
    expect(toUserMessage({ code: 'FILE_SCHEMA_INVALID', message: '', details: [] }, 'upload')).toBe(
      '上传表不符合该目录的字段约束',
    )
    expect(
      toUserMessage({ code: 'FILE_SCHEMA_INVALID', message: '', details: [{ x: 1 }] }, 'upload'),
    ).toBe('上传表不符合该目录的字段约束')
  })
})

describe('toErrorInfo', () => {
  it('带 code 的对象 → 原样保留后端错误码与文案', () => {
    expect(toErrorInfo({ code: 'FILE_NOT_FOUND', message: 'not found' })).toEqual({
      code: 'FILE_NOT_FOUND',
      message: 'not found',
    })
  })

  it('带 code 的对象 → 透传 details（FILE_SCHEMA_INVALID 的逐条问题清单）', () => {
    expect(
      toErrorInfo({
        code: 'FILE_SCHEMA_INVALID',
        message: 'x',
        details: ['缺少必填表头：「甲」'],
      }),
    ).toEqual({ code: 'FILE_SCHEMA_INVALID', message: 'x', details: ['缺少必填表头：「甲」'] })
  })

  it('带 code 但 message 非字符串 → message 归一为空串', () => {
    expect(toErrorInfo({ code: 'X', message: 42 })).toEqual({ code: 'X', message: '' })
    expect(toErrorInfo({ code: 'X' })).toEqual({ code: 'X', message: '' })
  })

  it('Error 实例（多为网络层异常）→ NETWORK_ERROR 并保留原始 message', () => {
    expect(toErrorInfo(new Error('Failed to fetch'))).toEqual({
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch',
    })
  })

  it('无 code 的对象 → INTERNAL_ERROR', () => {
    expect(toErrorInfo({ code: '' })).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo({ code: 123 })).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo({})).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })

  it('非对象抛出物（字符串 / 数字 / null）→ INTERNAL_ERROR', () => {
    expect(toErrorInfo('boom')).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo(42)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo(null)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toErrorInfo(undefined)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })

  it('归一结果可直接交给 toUserMessage 出文案（未知码不会被吞掉）', () => {
    const info = toErrorInfo(new Error('boom'))
    expect(toUserMessage(info)).toBe('网络异常，请检查连接后重试')
  })
})
