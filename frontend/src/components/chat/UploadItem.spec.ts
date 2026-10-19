/**
 * 组件测试：单文件上传项（012 补同名测试——该组件本次被改动，按"改动即补测"）
 *
 * 只钉住本次相关的两条：
 * 1. **展示名取落盘名**：`serverFilename`（可能是 `原名(1).ext`）优先，缺失才回落原始名（FR-024）；
 * 2. 失败态的文案与「重试」入口不因命名改动而退化（回归护栏）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { UploadedDocument } from '../../composables/useUploads'
import UploadItem from './UploadItem.vue'

function doc(overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return {
    localId: 'upload-1',
    dir: '临时空间',
    name: '报告.csv',
    size: 2048,
    status: 'success',
    serverFilename: '报告.csv',
    error: null,
    ...overrides,
  }
}

describe('UploadItem —— 展示名取落盘名（012 FR-024）', () => {
  it('成功项：展示 `serverFilename`，含 (1) 后缀时逐字展示', () => {
    const wrapper = mount(UploadItem, { props: { doc: doc({ serverFilename: '报告(1).csv' }) } })

    expect(wrapper.find('.upload-item__name').text()).toBe('报告(1).csv')
    expect(wrapper.find('.upload-item__status').text()).toBe('已完成')
  })

  it('尚未落盘（无 serverFilename）：回落原始文件名', () => {
    const wrapper = mount(UploadItem, {
      props: { doc: doc({ status: 'uploading', serverFilename: null }) },
    })

    expect(wrapper.find('.upload-item__name').text()).toBe('报告.csv')
    expect(wrapper.find('.upload-item__status').text()).toBe('上传中')
  })

  it('失败项：展示原因（按 code 映射的中文）并给出「重试」，点击即 emit', async () => {
    const wrapper = mount(UploadItem, {
      props: {
        doc: doc({
          status: 'failed',
          serverFilename: null,
          error: { code: 'FILE_NAME_CONFLICT', message: 'raw' },
        }),
      },
    })

    expect(wrapper.find('.upload-item__status').text()).toBe('上传失败')
    expect(wrapper.find('.upload-item__error').text()).toContain('同名文件过多')
    // 不展示后端原始 message（前端一律按 code 分派文案）
    expect(wrapper.text()).not.toContain('raw')

    await wrapper.find('.upload-item__retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('成功项不渲染「重试」与失败原因', () => {
    const wrapper = mount(UploadItem, { props: { doc: doc() } })

    expect(wrapper.find('.upload-item__retry').exists()).toBe(false)
    expect(wrapper.find('.upload-item__error').exists()).toBe(false)
  })
})
