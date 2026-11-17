/**
 * 单元测试：粘贴上传的整批预校验（2026-11-17）
 *
 * 钉住三条语义：
 * 1. **不早停**：多个不合格项一次全部返回，用户一次看全；
 * 2. **按 index 回指**：同名文件不能靠名字区分；
 * 3. **补名不扩白名单**：只按已知 MIME 补扩展名，未知 MIME 原样交给格式校验拒绝。
 *
 * v1.3 起取舍方式改为**逐文件**（`partitionBatch`）：合格的收下、不合格的跳过，
 * 因为粘贴不再落盘，"不能传了一半"这条原子性理由已不存在。
 */
import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_BYTES } from '../constants/limits'
import { partitionBatch, pastedFileName, precheckBatch, withPastedName } from './upload-batch'

const TMP_EXTS = ['.csv', '.png'] as const

function file(name: string, size = 8, type = 'text/csv'): File {
  return new File([new Uint8Array(size)], name, { type })
}

/** 只被读取 `name` / `size`，用轻量对象代替真的 5MB+ 数组 */
function oversized(name: string): File {
  return { name, size: MAX_UPLOAD_BYTES + 1 } as unknown as File
}

describe('precheckBatch —— 整批预校验（不早停，按 index 回指）', () => {
  it('全部合格 → 无拒绝项', () => {
    expect(precheckBatch([file('a.csv'), file('b.png', 8, 'image/png')], TMP_EXTS)).toEqual([])
  })

  it('任一不合格 → 带 index / name / code 返回', () => {
    expect(precheckBatch([file('a.csv'), file('b.exe')], TMP_EXTS)).toEqual([
      { index: 1, name: 'b.exe', code: 'VALIDATION_FAILED' },
    ])
  })

  it('多个不合格一次全部收集（不遇错即停）', () => {
    const rejections = precheckBatch(
      [file('a.csv'), file('b.exe'), file('c.png', 8, 'image/png'), oversized('d.csv')],
      TMP_EXTS,
    )

    expect(rejections.map((item) => item.name)).toEqual(['b.exe', 'd.csv'])
    expect(rejections.map((item) => item.code)).toEqual(['VALIDATION_FAILED', 'FILE_TOO_LARGE'])
  })

  it('同名文件靠 index 区分（不能只按名字回指）', () => {
    const rejections = precheckBatch(
      [file('a.csv'), file('a.csv'), file('b.exe')],
      TMP_EXTS,
    )

    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.index).toBe(2)
  })

  it('空白名单不做扩展名校验（绕过风险由调用方先拦截，见 onPasteFiles）', () => {
    expect(precheckBatch([file('a.exe')], [])).toEqual([])
  })
})

describe('partitionBatch —— 粘贴侧逐文件取舍（v1.3）', () => {
  it('全部合格 ⇒ 原样收下、零拒绝', () => {
    const files = [file('a.csv'), file('b.png', 8, 'image/png')]

    const result = partitionBatch(files, TMP_EXTS)

    expect(result.accepted).toEqual(files)
    expect(result.rejections).toEqual([])
  })

  it('部分不合格 ⇒ 合格的按原顺序收下，不合格的逐条报出（不再整批作废）', () => {
    const result = partitionBatch(
      [file('a.exe'), file('b.csv'), oversized('c.csv')],
      TMP_EXTS,
    )

    expect(result.accepted.map((item) => item.name)).toEqual(['b.csv'])
    expect(result.rejections.map((item) => item.name)).toEqual(['a.exe', 'c.csv'])
    // index 仍指入参数组，调用方可据此把原因对回具体文件
    expect(result.rejections.map((item) => item.index)).toEqual([0, 2])
  })

  it('全部不合格 ⇒ 收下为空（调用方据此只提示、不产生胶囊）', () => {
    const result = partitionBatch([file('a.exe'), file('b.svg', 8, 'image/svg+xml')], TMP_EXTS)

    expect(result.accepted).toEqual([])
    expect(result.rejections).toHaveLength(2)
  })
})

describe('pastedFileName —— 剪贴板文件补名', () => {
  it('已有扩展名：原样返回（不重命名用户文件）', () => {
    expect(pastedFileName(file('订单.png', 8, 'image/png'), 0)).toBe('订单.png')
  })

  it('无扩展名 + 已知 MIME：补扩展名并给出可读名', () => {
    expect(pastedFileName(file('blob', 8, 'image/png'), 0)).toMatch(/^粘贴-\d+-1\.png$/)
  })

  it('无扩展名但保留了名字：只补扩展名、保留原名作为主体', () => {
    expect(pastedFileName(file('screenshot', 8, 'image/png'), 2)).toBe('screenshot.png')
  })

  it('未知 MIME：不补（交给格式校验拒绝，补名不得扩大白名单）', () => {
    expect(pastedFileName(file('blob', 8, 'image/svg+xml'), 0)).toBe('blob')
  })
})

describe('withPastedName', () => {
  it('名字未变 → 返回同一实例（不做无谓的 blob 复制）', () => {
    const source = file('a.csv')
    expect(withPastedName(source, 0)).toBe(source)
  })

  it('名字变了 → 重建 File，保留 type 与内容', async () => {
    const source = file('blob', 4, 'image/png')

    const renamed = withPastedName(source, 0)

    expect(renamed.name).toMatch(/^粘贴-\d+-1\.png$/)
    expect(renamed.type).toBe('image/png')
    expect(await renamed.text()).toBe(await source.text())
  })
})
