import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ErrorNotice from './ErrorNotice.vue'

describe('ErrorNotice', () => {
  it('展示映射后的中文文案（不暴露后端 message）', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'THREAD_NOT_FOUND', message: 'thread missing' } },
    })
    expect(wrapper.find('.error-notice__message').text()).toBe('会话不存在或已被删除')
    expect(wrapper.text()).not.toContain('thread missing')
  })

  it('未知 code 使用兜底文案并保留原码', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'SOMETHING_NEW', message: '' } },
    })
    const text = wrapper.find('.error-notice__message').text()
    expect(text).toContain('请求失败，请稍后重试')
    expect(text).toContain('SOMETHING_NEW')
  })

  it('context 决定同码不同义的措辞', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'FILE_TOO_LARGE', message: '' }, context: 'preview' },
    })
    expect(wrapper.find('.error-notice__message').text()).toBe('文件过大，请下载查看')
  })

  it('点击重试派发 retry 事件', async () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'NETWORK_ERROR', message: '' } },
    })
    await wrapper.find('.error-notice__retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('retryLabel 为 null 时不展示重试入口', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'NETWORK_ERROR', message: '' }, retryLabel: null },
    })
    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)
  })

  it('以 alert 角色暴露给读屏', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'NETWORK_ERROR', message: '' } },
    })
    expect(wrapper.attributes('role')).toBe('alert')
  })
})
