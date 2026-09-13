import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { WorkspaceDir } from '../../api/types'
import { SPACE_DIRECTORIES } from '../../constants/directories'
import WorkspaceFileTree from './WorkspaceFileTree.vue'

/** 9 个目录，仅在 `生产计划` 放一个文件，其余为空 */
function dirs(): WorkspaceDir[] {
  return SPACE_DIRECTORIES.map((item) => ({
    dir: item.dir,
    files:
      item.dir === '生产计划'
        ? [{ filename: 'plan.csv', size: 2048, updated_at: '2026-09-10T08:00:00.000Z' }]
        : [],
  }))
}

describe('WorkspaceFileTree', () => {
  it('固定渲染 9 个目录分组，且默认全部收起', () => {
    const wrapper = mount(WorkspaceFileTree, { props: { dirs: dirs() } })

    expect(wrapper.findAll('.workspace-tree__group-toggle')).toHaveLength(9)
    // 默认收起：既没有文件行，也不显示空态
    expect(wrapper.findAll('.workspace-tree__file')).toHaveLength(0)
    expect(wrapper.findAll('.workspace-tree__empty')).toHaveLength(0)

    const titles = wrapper.findAll('.workspace-tree__group-name').map((node) => node.text())
    expect(titles[0]).toBe('生产计划')
    expect(titles).toContain('共享空间')
    expect(titles).toContain('临时空间')
  })

  it('点击分组派发 toggle-dir', async () => {
    const wrapper = mount(WorkspaceFileTree, { props: { dirs: dirs() } })
    await wrapper.find('.workspace-tree__group-toggle').trigger('click')

    expect(wrapper.emitted('toggle-dir')).toEqual([['生产计划']])
  })

  it('展开的目录展示文件、大小与删除入口', () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: { dirs: dirs(), expandedDirs: ['生产计划'] },
    })

    expect(wrapper.find('.workspace-tree__open').text()).toContain('plan.csv')
    expect(wrapper.find('.workspace-tree__size').text()).toBe('2.0 KB')
    expect(wrapper.find('.workspace-tree__action--danger').exists()).toBe(true)
  })

  it('点击文件名派发 preview，点击下载派发 download', async () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: { dirs: dirs(), expandedDirs: ['生产计划'] },
    })

    await wrapper.find('.workspace-tree__open').trigger('click')
    expect(wrapper.emitted('preview')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])

    // 行内第一个动作按钮是下载
    await wrapper.find('.workspace-tree__action').trigger('click')
    expect(wrapper.emitted('download')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
  })

  it('点击删除派发 remove', async () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: { dirs: dirs(), expandedDirs: ['生产计划'] },
    })
    await wrapper.find('.workspace-tree__action--danger').trigger('click')

    expect(wrapper.emitted('remove')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
  })

  it('共享空间为只读：不渲染删除入口', () => {
    const sharedOnly: WorkspaceDir[] = [
      {
        dir: 'shared',
        files: [{ filename: 'ref.csv', size: 10, updated_at: '2026-09-10T08:00:00.000Z' }],
      },
    ]
    const wrapper = mount(WorkspaceFileTree, {
      props: { dirs: sharedOnly, expandedDirs: ['shared'] },
    })

    expect(wrapper.find('.workspace-tree__open').exists()).toBe(true)
    expect(wrapper.find('.workspace-tree__action--danger').exists()).toBe(false)
  })

  it('展开的空目录给出空态提示', () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: { dirs: [{ dir: '生产计划', files: [] }], expandedDirs: ['生产计划'] },
    })
    expect(wrapper.text()).toContain('该目录暂无文件')
  })

  it('loading 时展示加载指示且不渲染分组', () => {
    const wrapper = mount(WorkspaceFileTree, { props: { dirs: dirs(), loading: true } })
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
    expect(wrapper.findAll('.workspace-tree__group-toggle')).toHaveLength(0)
  })

  it('无目录时给出提示', () => {
    const wrapper = mount(WorkspaceFileTree, { props: { dirs: [] } })
    expect(wrapper.text()).toContain('暂无目录')
  })
})
