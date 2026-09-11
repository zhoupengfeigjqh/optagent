import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { PreviewContent, PreviewTarget } from '../../composables/usePreview'
import PreviewPanel from './PreviewPanel.vue'

const TARGET: PreviewTarget = { kind: 'file', dir: 'tmp', filename: 'plan.csv' }

function content(overrides: Partial<PreviewContent> = {}): PreviewContent {
  return { renderMode: 'text', text: '', url: null, error: null, ...overrides }
}

describe('PreviewPanel', () => {
  it('未选择目标时展示占位态且不渲染头部', () => {
    const wrapper = mount(PreviewPanel)
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.find('.preview-panel__header').exists()).toBe(false)
  })

  it('头部展示文件名与目录展示名', () => {
    const wrapper = mount(PreviewPanel, { props: { target: TARGET } })
    expect(wrapper.find('.preview-panel__filename').text()).toBe('plan.csv')
    expect(wrapper.find('.preview-panel__dir').text()).toBe('临时空间')
  })

  it('loading 时展示加载指示', () => {
    const wrapper = mount(PreviewPanel, { props: { target: TARGET, loading: true } })
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
  })

  it('文本类以 pre 原样渲染（FR-046）', () => {
    const wrapper = mount(PreviewPanel, {
      props: { target: TARGET, content: content({ text: 'a,b\n1,2' }) },
    })
    expect(wrapper.find('pre').text()).toBe('a,b\n1,2')
  })

  it('PDF 以 iframe 内联渲染同源直链', () => {
    const wrapper = mount(PreviewPanel, {
      props: {
        target: { kind: 'file', dir: 'shared', filename: 'spec.pdf' },
        content: content({ renderMode: 'pdf', text: null, url: '/api/files/preview?dir=shared&filename=spec.pdf' }),
      },
    })
    const frame = wrapper.find('iframe')
    expect(frame.attributes('src')).toBe('/api/files/preview?dir=shared&filename=spec.pdf')
    expect(frame.attributes('title')).toBe('PDF 预览')
  })

  it('不支持内联预览时提示并给出下载按钮（V-11）', async () => {
    const wrapper = mount(PreviewPanel, {
      props: {
        target: { kind: 'file', dir: '生产计划', filename: 'plan.xlsx' },
        content: content({ renderMode: 'download', text: null, url: '/api/files/download?dir=x' }),
      },
    })
    expect(wrapper.find('.preview-panel__hint').text()).toContain('不支持内联预览')

    await wrapper.find('.preview-panel__download').trigger('click')
    expect(wrapper.emitted('download')).toEqual([[{ dir: '生产计划', filename: 'plan.xlsx' }]])
  })

  it('错误态展示预览语境文案与下载引导（FR-048）', async () => {
    const wrapper = mount(PreviewPanel, {
      props: {
        target: TARGET,
        content: content({
          renderMode: 'error',
          text: null,
          error: { code: 'FILE_TOO_LARGE', message: '' },
        }),
      },
    })
    expect(wrapper.find('.error-notice__message').text()).toBe('文件过大，请下载查看')
    // 错误提示本身不提供重试按钮，改为下载引导
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)

    await wrapper.find('.preview-panel__download').trigger('click')
    expect(wrapper.emitted('download')).toEqual([[{ dir: 'tmp', filename: 'plan.csv' }]])
  })

  it('文件不存在时同样给出下载引导', () => {
    const wrapper = mount(PreviewPanel, {
      props: {
        target: TARGET,
        content: content({
          renderMode: 'error',
          text: null,
          error: { code: 'FILE_NOT_FOUND', message: '' },
        }),
      },
    })
    expect(wrapper.find('.error-notice__message').text()).toBe('文件不存在或已被清理')
  })

  it('点击收起派发 close', async () => {
    const wrapper = mount(PreviewPanel, { props: { target: TARGET } })
    await wrapper.find('.preview-panel__header .base-button').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
