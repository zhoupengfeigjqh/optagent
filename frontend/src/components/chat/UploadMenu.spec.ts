import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SPACE_DIRECTORIES } from '../../constants/directories'
import type { UploadedDocument } from '../../composables/useUploads'
import { makeFile } from '../../../tests/helpers'
import UploadMenu from './UploadMenu.vue'

function fileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList
}

function uploadDoc(overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return {
    localId: 'upload-1',
    dir: '生产计划',
    name: 'plan.csv',
    size: 1024,
    status: 'failed',
    serverFilename: null,
    error: { code: 'FILE_TOO_LARGE', message: '' },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UploadMenu', () => {
  it('open=false 时不渲染', () => {
    const wrapper = mount(UploadMenu, { props: { directories: SPACE_DIRECTORIES } })
    expect(wrapper.find('.upload-menu').exists()).toBe(false)
  })

  it('固定渲染 9 个目录入口，文案取展示名（SC-021）', () => {
    const wrapper = mount(UploadMenu, {
      props: { directories: SPACE_DIRECTORIES, open: true },
    })
    const buttons = wrapper.findAll('.upload-menu__dir-button')
    expect(buttons).toHaveLength(9)

    const labels = wrapper.findAll('.upload-menu__dir-label').map((node) => node.text())
    expect(labels).toContain('生产计划')
    expect(labels).toContain('共享空间')
    expect(labels).toContain('临时空间')
    expect(labels).toHaveLength(9)
  })

  it('点击目录触发文件选择', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const wrapper = mount(UploadMenu, {
      props: { directories: SPACE_DIRECTORIES, open: true },
    })

    await wrapper.findAll('.upload-menu__dir-button')[0].trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('选中文件后派发 { dir, files }', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const wrapper = mount(UploadMenu, {
      props: { directories: SPACE_DIRECTORIES, open: true },
    })

    await wrapper.findAll('.upload-menu__dir-button')[7].trigger('click') // shared
    const input = wrapper.find('.upload-menu__input')
    const files = [makeFile('a.csv', 10)]
    Object.defineProperty(input.element, 'files', { configurable: true, value: fileList(files) })
    await input.trigger('change')

    const emitted = wrapper.emitted('pick')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0][0]).toMatchObject({ dir: 'shared' })
    expect((emitted?.[0][0] as { files: FileList }).files).toHaveLength(1)
  })

  it('未选择文件时不派发', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const wrapper = mount(UploadMenu, {
      props: { directories: SPACE_DIRECTORIES, open: true },
    })

    await wrapper.findAll('.upload-menu__dir-button')[0].trigger('click')
    const input = wrapper.find('.upload-menu__input')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: fileList([]),
    })
    await input.trigger('change')

    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('渲染上传项并透传重试的 localId', async () => {
    const wrapper = mount(UploadMenu, {
      props: {
        directories: SPACE_DIRECTORIES,
        open: true,
        uploads: [uploadDoc(), uploadDoc({ localId: 'upload-2', status: 'success' })],
      },
    })
    expect(wrapper.findAll('.upload-item')).toHaveLength(2)

    await wrapper.find('.upload-item__retry').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['upload-1']])
  })

  it('无上传项时不渲染上传区', () => {
    const wrapper = mount(UploadMenu, {
      props: { directories: SPACE_DIRECTORIES, open: true },
    })
    expect(wrapper.find('.upload-menu__uploads').exists()).toBe(false)
  })
})
