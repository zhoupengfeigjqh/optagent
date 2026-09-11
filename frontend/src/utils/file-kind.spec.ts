import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_BYTES } from '../constants/limits'
import { fileExtension, isUploadAllowed, resolvePreviewKind } from './file-kind'

describe('fileExtension', () => {
  it('返回含点的小写扩展名', () => {
    expect(fileExtension('a.txt')).toBe('.txt')
    expect(fileExtension('a.CSV')).toBe('.csv')
    expect(fileExtension('a.PdF')).toBe('.pdf')
  })

  it('多段扩展名只取最后一段', () => {
    expect(fileExtension('archive.tar.gz')).toBe('.gz')
  })

  it('无扩展名或隐藏文件返回空串', () => {
    expect(fileExtension('noext')).toBe('')
    expect(fileExtension('.gitkeep')).toBe('')
    expect(fileExtension('')).toBe('')
  })
})

describe('resolvePreviewKind（D12：按扩展名分派）', () => {
  it('5 种扩展名分派正确', () => {
    expect(resolvePreviewKind('a.txt')).toBe('text')
    expect(resolvePreviewKind('a.csv')).toBe('text')
    expect(resolvePreviewKind('a.json')).toBe('text')
    expect(resolvePreviewKind('a.pdf')).toBe('pdf')
    expect(resolvePreviewKind('a.xlsx')).toBe('download')
  })

  it('大小写不敏感', () => {
    expect(resolvePreviewKind('A.TXT')).toBe('text')
    expect(resolvePreviewKind('A.PDF')).toBe('pdf')
    expect(resolvePreviewKind('A.XLSX')).toBe('download')
  })

  it('未知扩展名 → unsupported', () => {
    expect(resolvePreviewKind('a.docx')).toBe('unsupported')
    expect(resolvePreviewKind('a.png')).toBe('unsupported')
    expect(resolvePreviewKind('noext')).toBe('unsupported')
  })

  it('带时间戳的落盘名仍按扩展名分派', () => {
    expect(resolvePreviewKind('计划_20260910_120000.csv')).toBe('text')
  })
})

describe('isUploadAllowed（FR-010 客户端预校验）', () => {
  it('白名单扩展名且未超限 → 允许', () => {
    for (const name of ['a.csv', 'a.xlsx', 'a.txt', 'a.json', 'a.pdf']) {
      expect(isUploadAllowed({ name, size: 1024 })).toEqual({ ok: true })
    }
  })

  it('超过 50MB → FILE_TOO_LARGE', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: MAX_UPLOAD_BYTES + 1 })).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    })
  })

  it('恰好 50MB → 允许（边界含等于）', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: MAX_UPLOAD_BYTES })).toEqual({ ok: true })
  })

  it('扩展名不在白名单 → VALIDATION_FAILED', () => {
    expect(isUploadAllowed({ name: 'a.docx', size: 1024 })).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    })
    expect(isUploadAllowed({ name: 'noext', size: 1024 })).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    })
  })

  it('大小写不敏感', () => {
    expect(isUploadAllowed({ name: 'A.CSV', size: 1024 })).toEqual({ ok: true })
  })

  it('同时超限且扩展名非法时优先报文件过大（FR-011 文案顺序）', () => {
    expect(isUploadAllowed({ name: 'a.docx', size: MAX_UPLOAD_BYTES + 1 })).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    })
  })
})
