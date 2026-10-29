/**
 * 单测：空数据引导判定（014）。
 *
 * 覆盖真值表四种情形 + 降级口径（字段缺失不误弹）+ 文案常量逐字一致。
 */
import { describe, expect, it } from 'vitest'

import type { WorkspaceDir, WorkspaceFile, WorkspaceSpace } from '../api/types'
import { EMPTY_DATA_HINT_TEXT, needsDataUpload } from './empty-data-hint'

function file(filename: string, size = 0): WorkspaceFile {
  return { filename, size, updated_at: '2026-10-29T00:00:00.000Z' }
}

function dir(name: string, files: WorkspaceFile[] = [], predefined = false): WorkspaceDir {
  return {
    dir: `数据准备/${name}`,
    label: name,
    deletable: true,
    files,
    fields: [],
    upload_extensions: ['.csv'],
    predefined,
  }
}

function prepSpace(dirs: WorkspaceDir[]): WorkspaceSpace {
  return { name: '数据准备', agent_writable: false, upload_extensions: ['.csv'], dirs }
}

function flatSpace(name: string, files: WorkspaceFile[] = []): WorkspaceSpace {
  return {
    name,
    agent_writable: false,
    upload_extensions: ['.csv'],
    dirs: [
      {
        dir: name,
        label: name,
        deletable: false,
        files,
        fields: [],
        upload_extensions: ['.csv'],
        predefined: false,
      },
    ],
  }
}

describe('needsDataUpload', () => {
  it('没有非扁平空间（数据准备缺失）→ 不提示', () => {
    expect(needsDataUpload([])).toBe(false)
    expect(needsDataUpload([flatSpace('共享空间'), flatSpace('临时空间')])).toBe(false)
    expect(needsDataUpload(undefined)).toBe(false)
  })

  it('只有预定义目录 → 不提示（避免把用户引向规则目录）', () => {
    expect(needsDataUpload([prepSpace([dir('算法规则', [], true)])])).toBe(false)
  })

  it('非预定义目录全部为空 → 提示', () => {
    const spaces = [prepSpace([dir('算法规则', [file('rules.xlsx')], true), dir('生产计划')])]

    expect(needsDataUpload(spaces)).toBe(true)
  })

  it('任一非预定义目录有文件 → 不提示（预定义目录有文件也不影响判断）', () => {
    const spaces = [
      prepSpace([
        dir('算法规则', [], true),
        dir('生产计划', [file('计划.csv', 12)]),
        dir('产线电价'),
      ]),
    ]

    expect(needsDataUpload(spaces)).toBe(false)
  })

  it('0 字节文件也算"已准备"（有文件即非空）', () => {
    expect(needsDataUpload([prepSpace([dir('生产计划', [file('empty.csv', 0)])])])).toBe(false)
  })

  it('predefined 字段缺失 → 不提示（降级：宁可不弹，也不误判）', () => {
    const broken = dir('生产计划')
    // 模拟旧服务端 / 半部署：字段未下发
    delete (broken as { predefined?: boolean }).predefined

    expect(needsDataUpload([prepSpace([broken])])).toBe(false)
  })

  it('文案常量逐字固定（含中文引号与加号）', () => {
    expect(EMPTY_DATA_HINT_TEXT).toBe('当前您还没有准备数据，请点击 “+” 上传吧。')
  })
})
