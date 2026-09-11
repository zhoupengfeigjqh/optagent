import { describe, expect, it } from 'vitest'

import {
  BUSINESS_DIRS,
  directoryLabel,
  isSpaceDirectory,
  SHARED_DIR,
  SPACE_DIRECTORIES,
  SPACE_DIRECTORY_NAMES,
  TMP_DIR,
} from './directories'

const EXPECTED_DIRS = [
  '生产计划',
  '产线信息',
  '切换时间',
  '求解时间',
  '产线电价',
  '目标优先级',
  '使用规则',
  'shared',
  'tmp',
]

describe('SPACE_DIRECTORIES（V-01 白名单恒为 9 个，三处引用同一常量）', () => {
  it('恒为 9 个目录，且顺序与后端白名单一致', () => {
    expect(SPACE_DIRECTORIES).toHaveLength(9)
    expect(SPACE_DIRECTORIES.map((item) => item.dir)).toEqual(EXPECTED_DIRS)
  })

  it('由 7 个业务目录 + shared + tmp 组成', () => {
    expect(BUSINESS_DIRS).toHaveLength(7)
    expect([...BUSINESS_DIRS]).toEqual(EXPECTED_DIRS.slice(0, 7))
    expect(SHARED_DIR).toBe('shared')
    expect(TMP_DIR).toBe('tmp')
    expect(SPACE_DIRECTORIES.map((item) => item.dir)).toContain(SHARED_DIR)
    expect(SPACE_DIRECTORIES.map((item) => item.dir)).toContain(TMP_DIR)
  })

  it('目录名互不重复', () => {
    const dirs = SPACE_DIRECTORIES.map((item) => item.dir)
    expect(new Set(dirs).size).toBe(dirs.length)
  })

  it('共享空间与临时空间使用中文展示名', () => {
    expect(directoryLabel('shared')).toBe('共享空间')
    expect(directoryLabel('tmp')).toBe('临时空间')
    expect(directoryLabel('生产计划')).toBe('生产计划')
  })

  it('常量不可变，避免消费方各自改写导致口径漂移', () => {
    expect(Object.isFrozen(SPACE_DIRECTORIES)).toBe(true)
    expect(() => {
      ;(SPACE_DIRECTORIES as SpaceDirectoryMutable[]).push({ dir: 'x', label: 'x' })
    }).toThrow()
  })
})

describe('白名单校验', () => {
  it('9 个目录均在白名单内', () => {
    for (const dir of EXPECTED_DIRS) {
      expect(isSpaceDirectory(dir)).toBe(true)
    }
    expect(SPACE_DIRECTORY_NAMES.size).toBe(9)
  })

  it('非白名单目录返回 false（含会话存储目录 threads 与大小写变体）', () => {
    expect(isSpaceDirectory('threads')).toBe(false)
    expect(isSpaceDirectory('Shared')).toBe(false)
    expect(isSpaceDirectory('')).toBe(false)
    expect(isSpaceDirectory('生产计划 ')).toBe(false)
  })

  it('未知目录的展示名回退为目录名本身', () => {
    expect(directoryLabel('threads')).toBe('threads')
  })
})

/** 仅用于类型断言的辅助类型（测试内部使用）。 */
type SpaceDirectoryMutable = { dir: string; label: string }
