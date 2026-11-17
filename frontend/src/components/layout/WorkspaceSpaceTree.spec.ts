/**
 * 组件测试：文件空间树的空间 / 目录空态（2026-11-17）
 *
 * 背景：管理员可在平台侧**屏蔽**「数据准备」的预定义二级目录，甚至全部屏蔽。
 * 此时后端的「数据准备」空间仍然存在，但 `dirs` 为空数组——树组件必须给出
 * 明确空态，不能渲染成一片空白（用户会以为"没加载出来"）。
 *
 * 同时守"扁平空间（共享 / 临时）不受影响"：它们恒有自身一项目录。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { WorkspaceDir, WorkspaceSpace } from '../../api/types'
import WorkspaceSpaceTree from './WorkspaceSpaceTree.vue'

function dir(name: string, files: Array<{ filename: string; size: number; updated_at: string }> = []): WorkspaceDir {
  return {
    dir: name,
    label: name.split('/').pop() ?? name,
    deletable: true,
    files,
    fields: [],
    upload_extensions: ['.csv', '.xlsx'],
    predefined: false,
  }
}

function prepSpace(dirs: WorkspaceDir[]): WorkspaceSpace {
  return { name: '数据准备', agent_writable: false, upload_extensions: ['.csv', '.xlsx'], dirs }
}

function flatSpace(name: '共享空间' | '临时空间', dirs: WorkspaceDir[]): WorkspaceSpace {
  return { name, agent_writable: name === '临时空间', upload_extensions: ['.csv'], dirs }
}

function mountTree(spaces: WorkspaceSpace[], expanded: string[]) {
  return mount(WorkspaceSpaceTree, {
    props: { spaces, expandedSpaces: expanded, expandedDirs: [] },
  })
}

describe('WorkspaceSpaceTree —— 「数据准备」空清单（全部屏蔽）', () => {
  it('展开数据准备空间：给出"未开放目录"空态，而不是空白', () => {
    const wrapper = mountTree([prepSpace([])], ['数据准备'])

    expect(wrapper.text()).toContain('该数字人未开放「数据准备」目录')
  })

  it('有子目录时不出空态，按目录渲染', () => {
    const wrapper = mountTree([prepSpace([dir('数据准备/生产计划')])], ['数据准备'])

    expect(wrapper.text()).not.toContain('该数字人未开放「数据准备」目录')
    expect(wrapper.text()).toContain('生产计划')
  })

  it('未展开空间时不渲染空态（默认全部收起）', () => {
    const wrapper = mountTree([prepSpace([])], [])

    expect(wrapper.text()).not.toContain('该数字人未开放「数据准备」目录')
  })

  it('扁平空间的空态口径不变：共享空间无文件 → "该空间暂无文件"', () => {
    const wrapper = mountTree([flatSpace('共享空间', [dir('共享空间')])], ['共享空间'])

    expect(wrapper.text()).toContain('该空间暂无文件')
    expect(wrapper.text()).not.toContain('未开放「数据准备」目录')
  })
})
