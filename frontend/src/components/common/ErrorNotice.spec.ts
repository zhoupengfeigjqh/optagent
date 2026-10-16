/**
 * 组件测试：阻断式错误提示（T030 / TR-58）。
 *
 * 守住三件事：
 * 1. 文案一律经 `toUserMessage` 映射（V-12 / D13）——**不展示后端 `message`**，
 *    未知码兜底且保留原码；同码不同义时由 `context` 决定措辞；
 * 2. 重试入口的可见性**只**由 `retryLabel` 控制（`null` = 不渲染）——TR-58 的分流
 *    建立在这个契约上：能不能重发由上层判断，组件不自己猜，也不会留一个空按钮；
 * 3. `hint` 是可选的第二行（009：同一提示位承载"下一步怎么办"），为空即不占位。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ErrorNotice from './ErrorNotice.vue'

describe('ErrorNotice —— 文案映射（V-12 / D13）', () => {
  it('按错误码给出中文文案，且**不展示**后端 message', () => {
    const wrapper = mount(ErrorNotice, {
      props: {
        error: { code: 'THREAD_NOT_FOUND', message: 'thread 7f3 not found' },
      },
    })

    expect(wrapper.find('.error-notice__message').text()).toBe('会话不存在或已被删除')
    expect(wrapper.text()).not.toContain('7f3')
  })

  it('同码不同义：`context` 覆盖基础口径（上传 vs 预览）', () => {
    const error = { code: 'FILE_TOO_LARGE', message: '' }

    const uploaded = mount(ErrorNotice, { props: { error, context: 'upload' } })
    const previewed = mount(ErrorNotice, { props: { error, context: 'preview' } })

    expect(uploaded.find('.error-notice__message').text()).toBe('文件超过 5MB')
    expect(previewed.find('.error-notice__message').text()).toBe('文件过大，请下载查看')
  })

  it('未知错误码：通用文案 + 保留原码（便于排查），不回落成空白', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'SOMETHING_NEW', message: '' } },
    })

    expect(wrapper.find('.error-notice__message').text()).toBe(
      '请求失败，请稍后重试（SOMETHING_NEW）',
    )
  })

  it('错误体缺省（null）：仍给出通用文案，不抛错', () => {
    const wrapper = mount(ErrorNotice, { props: { error: { code: '', message: '' } } })

    expect(wrapper.find('.error-notice__message').text()).toBe('请求失败，请稍后重试')
  })
})

describe('ErrorNotice —— 重试入口（TR-58 分流依赖的契约）', () => {
  const error = { code: 'LLM_UNAVAILABLE', message: '' }

  it('缺省文案为「重试」，点击抛出 `retry` 事件', async () => {
    const wrapper = mount(ErrorNotice, { props: { error } })

    const retry = wrapper.find('.error-notice__retry')
    expect(retry.text()).toBe('重试')

    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('自定义文案原样展示（失败块据此切换「重试本轮」/「重新获取」）', () => {
    const wrapper = mount(ErrorNotice, { props: { error, retryLabel: '重试本轮' } })

    expect(wrapper.find('.error-notice__retry').text()).toBe('重试本轮')
  })

  it('`retryLabel = null`：不渲染重试入口（不留点了没反应的按钮）', async () => {
    const wrapper = mount(ErrorNotice, { props: { error, retryLabel: null } })

    expect(wrapper.find('.error-notice__retry').exists()).toBe(false)
    expect(wrapper.emitted('retry')).toBeUndefined()
  })
})

describe('ErrorNotice —— 诊断信息行（2026-10-15，TR-57）', () => {
  it('有诊断字段：渲染整行（生成逻辑在纯函数里，且不展示后端 message）', () => {
    const wrapper = mount(ErrorNotice, {
      props: {
        error: {
          code: 'LLM_UNAVAILABLE',
          message: '503 Service is too busy',
          upstream_status: 503,
          upstream_type: 'service_unavailable_error',
          request_id: 'rid-1',
        },
        context: 'send-message',
      },
    })

    expect(wrapper.find('.error-notice__diagnostics').text()).toBe(
      'LLM_UNAVAILABLE · 上游 503 · 上游类型 service_unavailable_error · 请求 ID rid-1',
    )
    expect(wrapper.text()).not.toContain('Service is too busy')
  })

  it('无诊断字段：不渲染该行（只剩一个码没有信息量）', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'LLM_UNAVAILABLE', message: '' }, context: 'send-message' },
    })

    expect(wrapper.find('.error-notice__diagnostics').exists()).toBe(false)
  })

  it('部分诊断字段：整行仍在，缺失项省略', () => {
    const wrapper = mount(ErrorNotice, {
      props: { error: { code: 'LLM_RATE_LIMITED', message: '', upstream_status: 429 } },
    })

    expect(wrapper.find('.error-notice__diagnostics').text()).toBe('LLM_RATE_LIMITED · 上游 429')
  })
})

describe('ErrorNotice —— 提示与无障碍', () => {
  const error = { code: 'AGENT_NOT_AVAILABLE', message: '' }

  it('`hint` 作为第二行渲染；缺省时不占位', () => {
    const withHint = mount(ErrorNotice, { props: { error, hint: '可切换为：agent-a' } })
    const withoutHint = mount(ErrorNotice, { props: { error } })

    expect(withHint.find('.error-notice__hint').text()).toBe('可切换为：agent-a')
    expect(withoutHint.find('.error-notice__hint').exists()).toBe(false)
  })

  it('`hint` 传空串：不渲染该行', () => {
    const wrapper = mount(ErrorNotice, { props: { error, hint: '' } })

    expect(wrapper.find('.error-notice__hint').exists()).toBe(false)
  })

  it('根节点带 `role="alert"`（中断流程的错误必须被辅助技术播报）', () => {
    const wrapper = mount(ErrorNotice, { props: { error } })

    expect(wrapper.find('.error-notice').attributes('role')).toBe('alert')
  })
})
