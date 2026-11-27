import { describe, expect, it } from 'vitest'

import type { WorkspaceDir, WorkspaceFile, WorkspaceSpace } from '../api/types'
import { isFlatSpace, spaceFileCount, spaceSubDirs } from './space'

function makeFile(filename: string, size = 0): WorkspaceFile {
  return { filename, size, updated_at: '2026-09-15T00:00:00.000Z' }
}

function makeDir(dir: string, files: WorkspaceFile[] = []): WorkspaceDir {
  return { dir, label: dir, deletable: true, files, fields: [], upload_extensions: [], predefined: false }
}

function makeSpace(name: string, dirs: WorkspaceDir[]): WorkspaceSpace {
  return { name, agent_writable: false, upload_extensions: [], dirs }
}

describe('isFlatSpace', () => {
  // 2026-11-18（025）：共享空间下线后，扁平空间只剩临时空间（原"共享空间"用例已并入本条）
  it('临时空间（dirs 仅含自身一项）判为扁平空间', () => {
    expect(isFlatSpace(makeSpace('临时空间', [makeDir('临时空间')]))).toBe(true)
  })

  it('数据准备（多个二级子目录）不是扁平空间', () => {
    const space = makeSpace('数据准备', [makeDir('生产计划'), makeDir('库存')])
    expect(isFlatSpace(space)).toBe(false)
  })

  it('仅一项但目录名与空间名不一致 → 不是扁平空间', () => {
    expect(isFlatSpace(makeSpace('数据准备', [makeDir('生产计划')]))).toBe(false)
  })

  it('dirs 为空 → 不是扁平空间', () => {
    expect(isFlatSpace(makeSpace('临时空间', []))).toBe(false)
  })
})

describe('spaceSubDirs', () => {
  it('扁平空间返回空数组（不下钻，直接出文件）', () => {
    const space = makeSpace('临时空间', [makeDir('临时空间', [makeFile('a.pdf')])])
    expect(spaceSubDirs(space)).toEqual([])
  })

  it('数据准备返回其二级子目录清单', () => {
    const dirs = [makeDir('生产计划'), makeDir('库存')]
    expect(spaceSubDirs(makeSpace('数据准备', dirs))).toEqual(dirs)
  })
})

describe('spaceFileCount', () => {
  it('数据准备 = 各二级子目录文件数之和（空目录计 0）', () => {
    const space = makeSpace('数据准备', [
      makeDir('生产计划', [makeFile('a.csv'), makeFile('b.csv')]),
      makeDir('库存', [makeFile('c.csv')]),
      makeDir('空目录'),
    ])
    expect(spaceFileCount(space)).toBe(3)
  })

  it('扁平空间 = 其自身目录的文件数', () => {
    const space = makeSpace('临时空间', [
      makeDir('临时空间', [makeFile('t1.txt'), makeFile('t2.txt')]),
    ])
    expect(spaceFileCount(space)).toBe(2)
  })

  it('dirs 为空 = 0', () => {
    expect(spaceFileCount(makeSpace('临时空间', []))).toBe(0)
  })
})
