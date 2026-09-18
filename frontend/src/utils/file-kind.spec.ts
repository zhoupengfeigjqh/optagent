/**
 * 文件类型分派与上传预校验单测（`src/utils/file-kind.ts`）
 *
 * 运行方式：`npm run test` / `npm run test:coverage`（本地执行）
 *
 * 覆盖两条硬约束：
 * 1. `resolvePreviewKind` 的分派表与后端 `GET /api/files/preview` 的 Content-Type
 *    映射必须一致（`contracts/backend-api.md` §5.4）——分派错了会"预览出乱码或空白"。
 * 2. `isUploadAllowed` 不合规时调用方 MUST **不发请求**（FR-010），
 *    因此"尺寸上限"与"空间白名单"两条拦截都要有用例。
 */
import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_BYTES } from '../constants/limits'
import { fileExtension, isUploadAllowed, resolvePreviewKind } from './file-kind'

describe('fileExtension', () => {
  it('返回小写扩展名（含点）', () => {
    expect(fileExtension('report.csv')).toBe('.csv')
    expect(fileExtension('REPORT.Xlsx')).toBe('.xlsx')
  })

  it('多段扩展名只取最后一段', () => {
    expect(fileExtension('archive.tar.gz')).toBe('.gz')
  })

  it('无扩展名 → 空串', () => {
    expect(fileExtension('noext')).toBe('')
    expect(fileExtension('')).toBe('')
  })

  it('点开头的隐藏文件 → 空串（不把 .gitkeep 当成扩展名）', () => {
    expect(fileExtension('.gitkeep')).toBe('')
  })
})

describe('resolvePreviewKind', () => {
  it.each(['a.txt', 'a.csv', 'a.json'])('%s → 文本内联', (filename) => {
    expect(resolvePreviewKind(filename)).toBe('text')
  })

  it('pdf → iframe 内联', () => {
    expect(resolvePreviewKind('季度报告.pdf')).toBe('pdf')
  })

  it.each(['a.jpg', 'a.jpeg', 'a.png', 'a.bmp', 'a.webp', 'a.gif'])('%s → 图片内联', (filename) => {
    expect(resolvePreviewKind(filename)).toBe('image')
  })

  it.each(['a.xlsx', 'a.tif', 'a.tiff'])('%s → 回退下载', (filename) => {
    expect(resolvePreviewKind(filename)).toBe('download')
  })

  it('扩展名大小写不敏感', () => {
    expect(resolvePreviewKind('A.TXT')).toBe('text')
    expect(resolvePreviewKind('A.Pdf')).toBe('pdf')
  })

  it('未知或缺失扩展名 → 不支持', () => {
    expect(resolvePreviewKind('a.exe')).toBe('unsupported')
    expect(resolvePreviewKind('noext')).toBe('unsupported')
  })
})

describe('isUploadAllowed', () => {
  it('未超限且扩展名在目标空间白名单内 → 通过', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: 1 }, ['.csv'])).toEqual({ ok: true })
  })

  it('恰好等于 5MB 上限 → 通过（边界取闭区间）', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: MAX_UPLOAD_BYTES }, ['.csv'])).toEqual({ ok: true })
  })

  it('超过 5MB → FILE_TOO_LARGE', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: MAX_UPLOAD_BYTES + 1 }, ['.csv'])).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    })
  })

  it('尺寸超限优先于扩展名判定（扩展名合规也照样拦）', () => {
    expect(isUploadAllowed({ name: 'a.csv', size: MAX_UPLOAD_BYTES + 1 }, undefined)).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    })
  })

  it('扩展名不在目标空间白名单 → VALIDATION_FAILED', () => {
    expect(isUploadAllowed({ name: 'a.exe', size: 1 }, ['.csv', '.xlsx'])).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    })
  })

  it('白名单为小写含点 → 大写文件名也能命中', () => {
    expect(isUploadAllowed({ name: 'REPORT.CSV', size: 1 }, ['.csv'])).toEqual({ ok: true })
  })

  it('未传白名单（工作空间尚未加载）→ 只校验尺寸，扩展名交后端兜底', () => {
    expect(isUploadAllowed({ name: 'a.exe', size: 1 })).toEqual({ ok: true })
  })

  it('白名单为空数组 → 视为未下发，不拦扩展名', () => {
    expect(isUploadAllowed({ name: 'a.exe', size: 1 }, [])).toEqual({ ok: true })
  })
})
