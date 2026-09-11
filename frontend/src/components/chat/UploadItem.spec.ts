import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { UploadedDocument, UploadStatus } from '../../composables/useUploads'
import UploadItem from './UploadItem.vue'

function doc(status: UploadStatus, overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return {
    localId: 'upload-1',
    dir: '生产计划',
    name: 'plan.csv',
    size: 2048,
    status,
    serverFilename: null,
    error: null,
    ...overrides,
  }
}

describe('UploadItem', () => {
  it('渲染文件名与大小', () => {
    const wrapper = mount(UploadItem, { props: { doc: doc('pending') } })
    expect(wrapper.find('.upload-item__name').text()).toBe('plan.csv')
    expect(wrapper.find('.upload-item__size').text()).toBe('2.0 KB')
  })

  it('四态渲染对应状态文案', () => {
    const labelOf = (status: UploadStatus) =>
      mount(UploadItem, { props: { doc: doc(status) } }).find('.upload-item__status').text()

    expect(labelOf('pending')).toBe('待上传')
    expect(labelOf('uploading')).toBe('上传中')
    expect(labelOf('success')).toBe('已完成')
    expect(labelOf('failed')).toBe('上传失败')
  })

  it('成功后展示服务端落盘名（不自行拼接）', () => {
    const wrapper = mount(UploadItem, {
      props: { doc: doc('success', { serverFilename: 'plan_20260910_100000.csv' }) },
    })
    expect(wrapper.find('.upload-item__name').text()).toBe('plan_20260910_100000.csv')
  })

  it('失败项展示映射后的原因与「重试」，并可派发 retry', async () => {
    const wrapper = mount(UploadItem, {
      props: { doc: doc('failed', { error: { code: 'FILE_TOO_LARGE', message: 'raw' } }) },
    })
    expect(wrapper.find('.upload-item__error').text()).toBe('文件超过 50MB')
    expect(wrapper.text()).not.toContain('raw')

    await wrapper.find('.upload-item__retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('目录非法时给出目录相关文案', () => {
    const wrapper = mount(UploadItem, {
      props: { doc: doc('failed', { error: { code: 'UPLOAD_DIR_FORBIDDEN', message: '' } }) },
    })
    expect(wrapper.find('.upload-item__error').text()).toBe('该目录不允许上传')
  })

  it('非失败态不展示原因与重试', () => {
    for (const status of ['pending', 'uploading', 'success'] as UploadStatus[]) {
      const wrapper = mount(UploadItem, { props: { doc: doc(status) } })
      expect(wrapper.find('.upload-item__retry').exists()).toBe(false)
      expect(wrapper.find('.upload-item__error').exists()).toBe(false)
    }
  })
})
