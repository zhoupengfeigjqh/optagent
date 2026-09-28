/**
 * 会话恢复工具测试（002 特性）
 *
 * 守住三件事：
 * 1. URL `?thread=` 的读取与保留其他参数（不能把别的 query 冲掉）
 * 2. `replaceState` 语义：只改当前条目，不产生历史记录
 * 3. 存储不可用（隐私模式/配额满）时**静默降级**，不影响主流程
 */
import { describe, expect, it, vi } from 'vitest'

import {
  readStoredThread,
  readThreadFromSearch,
  withThreadParam,
  writeStoredThread,
  writeThreadToUrl,
} from './thread-restore'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

describe('readThreadFromSearch', () => {
  it('取到 thread 参数', () => {
    expect(readThreadFromSearch('?thread=a1b2c3')).toBe('a1b2c3')
  })

  it('无参数 / 空值 / 其他参数 → null', () => {
    expect(readThreadFromSearch('')).toBeNull()
    expect(readThreadFromSearch('?thread=')).toBeNull()
    expect(readThreadFromSearch('?thread=%20')).toBeNull()
    expect(readThreadFromSearch('?foo=1')).toBeNull()
  })
})

describe('withThreadParam', () => {
  it('保留其它 query 参数', () => {
    expect(withThreadParam('?foo=1', 'abc')).toBe('?foo=1&thread=abc')
  })

  it('写入后再清空：回到不含 thread 的原样', () => {
    expect(withThreadParam('?foo=1&thread=abc', null)).toBe('?foo=1')
  })

  it('无任何参数时返回空串（不留下孤立的 ?）', () => {
    expect(withThreadParam('?thread=abc', null)).toBe('')
  })
})

describe('writeThreadToUrl', () => {
  it('拼接 pathname + search + hash，走 replace 回调', () => {
    const replace = vi.fn()
    writeThreadToUrl(
      'abc',
      { pathname: '/chat', search: '?foo=1', hash: '#top' },
      replace,
    )

    expect(replace).toHaveBeenCalledWith('/chat?foo=1&thread=abc#top')
  })

  it('清除会话：URL 里不再有 thread 参数', () => {
    const replace = vi.fn()
    writeThreadToUrl('abc', { pathname: '/', search: '?thread=abc', hash: '' }, replace)
    writeThreadToUrl(null, { pathname: '/', search: '?thread=abc', hash: '' }, replace)

    expect(replace).toHaveBeenLastCalledWith('/')
  })
})

describe('本地存储兜底', () => {
  it('写入后可读回；清除后为 null', () => {
    const storage = memoryStorage()
    writeStoredThread(storage, 'abc')
    expect(readStoredThread(storage)).toBe('abc')

    writeStoredThread(storage, null)
    expect(readStoredThread(storage)).toBeNull()
  })

  it('存储不可用（getItem 抛错）时静默降级为 null', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    } as unknown as Storage

    expect(readStoredThread(broken)).toBeNull()
    expect(() => writeStoredThread(broken, 'abc')).not.toThrow()
  })

  it('storage 为 null 时不抛错', () => {
    expect(readStoredThread(null)).toBeNull()
    expect(() => writeStoredThread(null, 'abc')).not.toThrow()
  })
})
