import { describe, expect, it } from 'vitest'

import { allocateName, candidateName, MAX_BASE_CHARS, splitName } from './upload-name'

describe('splitName —— 主名 / 扩展名切分（与 path.extname 同口径）', () => {
  it('普通文件', () => {
    expect(splitName('a.csv')).toEqual({ stem: 'a', ext: '.csv' })
  })

  it('多点文件只认最后一段扩展名', () => {
    expect(splitName('a.tar.gz')).toEqual({ stem: 'a.tar', ext: '.gz' })
  })

  it('dotfile 没有扩展名（与 node 的 extname 一致）', () => {
    expect(splitName('.env')).toEqual({ stem: '.env', ext: '' })
  })

  it('无扩展名', () => {
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' })
  })

  it('路径分隔符一律压平成下划线（剪贴板偶尔带路径）', () => {
    expect(splitName('C:\\tmp\\a.csv')).toEqual({ stem: 'C:_tmp_a', ext: '.csv' })
  })
})

describe('candidateName —— 编号只在主名与扩展名之间', () => {
  it('0 ⇒ 原名', () => {
    expect(candidateName('报告.csv', 0)).toBe('报告.csv')
  })

  it('n ⇒ 主名(n)扩展名（半角括号）', () => {
    expect(candidateName('报告.csv', 1)).toBe('报告(1).csv')
  })

  it('多点扩展名：编号插在最后一段之前', () => {
    expect(candidateName('a.tar.gz', 2)).toBe('a.tar(2).gz')
  })

  it('无扩展名：编号缀在末尾', () => {
    expect(candidateName('README', 1)).toBe('README(1)')
  })

  it('dotfile：编号缀在末尾（不把 .env 当成扩展名）', () => {
    expect(candidateName('.env', 1)).toBe('.env(1)')
  })

  it('主名过长按码点截断，给编号与扩展名留位', () => {
    const long = `${'名'.repeat(MAX_BASE_CHARS)}.csv`
    const name = candidateName(long, 1)
    const { stem, ext } = splitName(name)

    expect(ext).toBe('.csv')
    expect(stem.endsWith('(1)')).toBe(true)
    expect(Array.from(stem).length).toBeLessThanOrEqual(MAX_BASE_CHARS)
  })
})

describe('allocateName —— 在已占用集合里找唯一名', () => {
  it('不冲突 ⇒ 原名，并写回 taken', () => {
    const taken = new Set<string>()
    expect(allocateName('a.csv', taken)).toBe('a.csv')
    expect(taken.has('a.csv')).toBe(true)
  })

  it('原名被占 ⇒ 从 (1) 起跳号', () => {
    const taken = new Set(['a.csv', 'a(1).csv'])
    expect(allocateName('a.csv', taken)).toBe('a(2).csv')
  })

  it('大小写不敏感：Report.csv 与 report.csv 互斥', () => {
    const taken = new Set(['report.csv'])
    expect(allocateName('Report.csv', taken)).toBe('Report(1).csv')
  })

  it('同一批连续分配：两个同名文件拿到两个不同名字', () => {
    const taken = new Set<string>()
    expect([allocateName('a.csv', taken), allocateName('a.csv', taken)]).toEqual([
      'a.csv',
      'a(1).csv',
    ])
  })

  it('尝试上限用尽也不抛错（退化为下一号，服务端仍会兜底）', () => {
    const taken = new Set<string>(['a.csv', 'a(1).csv'])
    expect(allocateName('a.csv', taken, 1)).toBe('a(2).csv')
  })
})
