import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceDir } from '../../api/types'
import { SPACE_DIRECTORIES } from '../../constants/directories'
import WorkspacePanel from './WorkspacePanel.vue'

// ConfirmDialog 基于原生 <dialog>；jsdom 未实现其模态方法，提供最小桩件
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

const FILE_TARGET = { kind: 'file', dir: '生产计划', filename: 'plan.csv' } as const

describe('WorkspacePanel · 列表态', () => {
  it('标题为「文件空间」并渲染 9 个折叠分组', () => {
    const wrapper = mount(WorkspacePanel, { props: { view: 'list', dirs: dirs() } })

    expect(wrapper.find('.workspace-panel__name').text()).toBe('文件空间')
    expect(wrapper.findAll('.workspace-tree__group-toggle')).toHaveLength(9)
  })

  it('点击分组上报 toggle-dir', async () => {
    const wrapper = mount(WorkspacePanel, { props: { view: 'list', dirs: dirs() } })
    await wrapper.find('.workspace-tree__group-toggle').trigger('click')

    expect(wrapper.emitted('toggle-dir')).toEqual([['生产计划']])
  })

  it('点击文件上报 preview 且不收起面板', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: { view: 'list', dirs: dirs(), expandedDirs: ['生产计划'] },
    })
    await wrapper.find('.workspace-tree__open').trigger('click')

    expect(wrapper.emitted('preview')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('删除需二次确认：未确认不上报，确认后才上报 remove', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: { view: 'list', dirs: dirs(), expandedDirs: ['生产计划'] },
    })

    await wrapper.find('.workspace-tree__action--danger').trigger('click')
    // 弹确认、但还没确认：不应上报删除
    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.text()).toContain('确定要删除')

    await wrapper.find('.base-button--danger').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
  })

  it('取消确认不上报 remove', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: { view: 'list', dirs: dirs(), expandedDirs: ['生产计划'] },
    })

    await wrapper.find('.workspace-tree__action--danger').trigger('click')
    await wrapper.find('.base-button--secondary').trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
  })

  it('收起按钮上报 close', async () => {
    const wrapper = mount(WorkspacePanel, { props: { view: 'list', dirs: dirs() } })
    await wrapper.find('[aria-label="收起文件空间"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('WorkspacePanel · 内容态', () => {
  it('展示文件名与目录，并渲染文本内容', () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: FILE_TARGET,
        content: { renderMode: 'text', text: 'a,b\n1,2\n', url: null, error: null },
      },
    })

    expect(wrapper.find('.workspace-panel__name').text()).toBe('plan.csv')
    expect(wrapper.find('.workspace-panel__dir').text()).toBe('生产计划')
    // 用 textContent 而非 text()：<pre> 必须逐字符原样呈现，不能被 trim 掩盖首尾空白
    expect(wrapper.find('.workspace-panel__text').element.textContent).toBe('a,b\n1,2\n')
  })

  it('返回列表上报 back（面板不收起）', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: FILE_TARGET,
        content: { renderMode: 'text', text: 'x', url: null, error: null },
      },
    })
    await wrapper.find('[aria-label="返回文件空间"]').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('下载上报 download', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: FILE_TARGET,
        content: { renderMode: 'download', text: null, url: 'blob:x', error: null },
      },
    })
    await wrapper.find('[aria-label="下载当前文件"]').trigger('click')

    expect(wrapper.emitted('download')).toEqual([[{ dir: '生产计划', filename: 'plan.csv' }]])
  })

  it('加载中展示指示', () => {
    const wrapper = mount(WorkspacePanel, {
      props: { view: 'content', target: FILE_TARGET, contentLoading: true },
    })
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
  })

  it('不支持内联的类型给出下载引导（V-11）', () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: { kind: 'file', dir: 'tmp', filename: 'a.xlsx' },
        content: { renderMode: 'download', text: null, url: 'blob:x', error: null },
      },
    })
    expect(wrapper.text()).toContain('该类型不支持内联预览')
  })

  it('错误态展示可读文案与下载引导（FR-048）', () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: { kind: 'file', dir: 'tmp', filename: 'gone.csv' },
        content: {
          renderMode: 'error',
          text: null,
          url: 'blob:x',
          error: { code: 'FILE_NOT_FOUND', message: '' },
        },
      },
    })
    expect(wrapper.text()).toContain('文件不存在或已被清理')
  })
})
