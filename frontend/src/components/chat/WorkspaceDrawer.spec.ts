import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SPACE_DIRECTORIES } from '../../constants/directories'
import type { WorkspaceDir } from '../../api/types'
import WorkspaceDrawer from './WorkspaceDrawer.vue'

// jsdom 未实现 <dialog> 的模态方法，提供最小桩件
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

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

describe('WorkspaceDrawer', () => {
  it('固定渲染 9 个目录分组（含空目录空态）', () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs() } })
    expect(wrapper.findAll('.workspace-drawer__group')).toHaveLength(9)

    const titles = wrapper.findAll('.workspace-drawer__group-title').map((node) => node.text())
    expect(titles[0]).toBe('生产计划')
    expect(titles).toContain('共享空间')
    expect(titles).toContain('临时空间')

    // 空目录仍保留分组并给出空态
    expect(wrapper.findAll('.workspace-drawer__empty')).toHaveLength(8)
  })

  it('展示文件与大小', () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs() } })
    expect(wrapper.find('.workspace-drawer__open').text()).toBe('plan.csv')
    expect(wrapper.find('.workspace-drawer__size').text()).toBe('2.0 KB')
  })

  it('点击文件派发 preview 并收起面板（FR-046）', async () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs() } })
    await wrapper.find('.workspace-drawer__open').trigger('click')

    expect(wrapper.emitted('preview')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击下载派发 download 且不关闭面板', async () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs() } })
    await wrapper.find('.workspace-drawer__download').trigger('click')

    expect(wrapper.emitted('download')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('loading 时展示加载指示且不渲染分组', () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs(), loading: true } })
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
    expect(wrapper.findAll('.workspace-drawer__group')).toHaveLength(0)
  })

  it('无目录时给出提示', () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: [] } })
    expect(wrapper.text()).toContain('暂无目录')
  })

  it('关闭按钮派发 close', async () => {
    const wrapper = mount(WorkspaceDrawer, { props: { open: true, dirs: dirs() } })
    await wrapper.find('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
