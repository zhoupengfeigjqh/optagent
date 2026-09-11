import { describe, expect, it } from 'vitest'

import { toUserMessage } from './error-message'

/** 后端可能返回的错误码全集（`contracts/backend-api.md` §1–§5）。 */
const KNOWN_CODES = [
  'THREAD_NOT_FOUND',
  'MESSAGE_NOT_FOUND',
  'THREAD_RUN_ACTIVE',
  'THREAD_BUSY_LIMIT',
  'AGENT_NOT_SELECTED',
  'AGENT_NOT_FOUND',
  'POOL_EXHAUSTED',
  'MODEL_NOT_FOUND',
  'FILE_REF_NOT_FOUND',
  'FILE_TOO_LARGE',
  'FILE_NOT_FOUND',
  'UPLOAD_DIR_FORBIDDEN',
  'TMP_WRITE_FAILED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
] as const

describe('toUserMessage - 已知错误码（V-12 映射完备）', () => {
  it('每个已知错误码都有中文文案且不暴露后端原始 message', () => {
    for (const code of KNOWN_CODES) {
      const message = toUserMessage({ code, message: 'raw backend text' })

      expect(message).not.toBe('')
      expect(message).not.toContain('raw backend text')
      expect(message).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('按契约给出关键文案', () => {
    expect(toUserMessage({ code: 'AGENT_NOT_SELECTED', message: '' })).toBe('请先选择数字人')
    expect(toUserMessage({ code: 'MODEL_NOT_FOUND', message: '' })).toBe('所选模型不可用，请重新选择')
    expect(toUserMessage({ code: 'FILE_REF_NOT_FOUND', message: '' })).toBe(
      '引用的文件不存在，请重新选择',
    )
    expect(toUserMessage({ code: 'THREAD_RUN_ACTIVE', message: '' })).toBe('该会话已有进行中的回复')
    expect(toUserMessage({ code: 'POOL_EXHAUSTED', message: '' })).toBe('系统繁忙，请稍后重试')
    expect(toUserMessage({ code: 'FILE_NOT_FOUND', message: '' })).toBe('文件不存在或已被清理')
  })
})

describe('toUserMessage - 未知码兜底', () => {
  it('未知码返回通用文案并保留原码', () => {
    const message = toUserMessage({ code: 'SOMETHING_NEW', message: 'x' })

    expect(message).toContain('请求失败')
    expect(message).toContain('SOMETHING_NEW')
  })

  it('缺失错误体时返回通用文案', () => {
    expect(toUserMessage(null)).toBe('请求失败，请稍后重试')
    expect(toUserMessage(undefined)).toBe('请求失败，请稍后重试')
    expect(toUserMessage({ code: '', message: 'x' })).toBe('请求失败，请稍后重试')
  })
})

describe('toUserMessage - 场景化文案（§7 差异 6：同码不同义）', () => {
  it('THREAD_BUSY_LIMIT 只有并发语义：创建与发消息场景都是系统繁忙', () => {
    const error = { code: 'THREAD_BUSY_LIMIT', message: '' }

    expect(toUserMessage(error, 'create-thread')).toBe('系统繁忙，请稍后重试')
    expect(toUserMessage(error, 'send-message')).toBe('系统繁忙，请稍后重试')
  })

  it('上传场景覆盖格式不支持与目录不允许上传', () => {
    expect(toUserMessage({ code: 'VALIDATION_FAILED', message: '' }, 'upload')).toBe(
      '文件格式不支持',
    )
    expect(toUserMessage({ code: 'UPLOAD_DIR_FORBIDDEN', message: '' }, 'upload')).toBe(
      '该目录不允许上传',
    )
  })

  it('预览场景覆盖文件过大引导下载', () => {
    expect(toUserMessage({ code: 'FILE_TOO_LARGE', message: '' }, 'preview')).toBe(
      '文件过大，请下载查看',
    )
  })

  it('场景未覆盖的错误码回落到基础映射', () => {
    expect(toUserMessage({ code: 'THREAD_NOT_FOUND', message: '' }, 'preview')).toBe(
      '会话不存在或已被删除',
    )
  })
})
