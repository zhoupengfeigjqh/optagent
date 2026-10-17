/**
 * 单元测试：「思考模式」开关的存储读写（2026-10-16，拆分产出）。
 *
 * 这一组函数的价值全在**容错**上：`sessionStorage` 在隐私模式、跨源 iframe、
 * 禁用 cookie 等情形会直接抛错，而"记住开关"是纯便利功能——读失败当关闭、写失败当成功，
 * MUST NOT 让聊天区因此报错（宪章原则九：能力不存在 ≠ 出错）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_THINKING } from '../constants/limits'
import { readStoredThinking, safeSessionStorage, writeStoredThinking } from './thinking-storage'

/** 只实现本模块用到的两个方法；读/写可被注入为抛错，用来走容错分支。 */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  return {
    getItem: () => null,
    setItem: () => undefined,
    ...overrides,
  } as Storage
}

describe('safeSessionStorage（2026-10-16）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('正常环境返回可用的 sessionStorage', () => {
    expect(safeSessionStorage()).toBe(globalThis.sessionStorage)
  })

  it('不存在 sessionStorage（非浏览器环境）→ null 而不是抛错', () => {
    vi.stubGlobal('sessionStorage', undefined)

    expect(safeSessionStorage()).toBeNull()
  })
})

describe('readStoredThinking（2026-10-16）', () => {
  it("只有 '1' 算开启，其余值（含 null）一律关闭", () => {
    expect(readStoredThinking(fakeStorage({ getItem: () => '1' }))).toBe(true)
    expect(readStoredThinking(fakeStorage({ getItem: () => '0' }))).toBe(false)
    expect(readStoredThinking(fakeStorage({ getItem: () => null }))).toBe(false)
  })

  it('存储不可用（null）或读取抛错 → 当作关闭，不抛错', () => {
    expect(readStoredThinking(null)).toBe(false)
    expect(
      readStoredThinking(
        fakeStorage({
          getItem: () => {
            throw new Error('SecurityError')
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('writeStoredThinking（2026-10-16）', () => {
  it('开启写 1、关闭写 0（用同一把键）', () => {
    const writes: Array<[string, string]> = []
    const storage = fakeStorage({
      setItem: (key: string, value: string) => {
        writes.push([key, value])
      },
    })

    writeStoredThinking(storage, true)
    writeStoredThinking(storage, false)

    expect(writes).toEqual([
      [STORAGE_KEY_THINKING, '1'],
      [STORAGE_KEY_THINKING, '0'],
    ])
  })

  it('存储不可用（null）或写入抛错 → 静默降级，不抛错', () => {
    expect(() => writeStoredThinking(null, true)).not.toThrow()
    expect(() =>
      writeStoredThinking(
        fakeStorage({
          setItem: () => {
            throw new Error('QuotaExceededError')
          },
        }),
        true,
      ),
    ).not.toThrow()
  })
})
