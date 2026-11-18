/**
 * 组件测试：重置密码弹窗（契约 §6.4.1，2026-11-18）。
 *
 * 覆盖：弹窗形态、两种意图的说明文案、两次输入一致性校验、
 * 长度校验、提交载荷、失败提示就地展示、保存中态与重开清空。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ResetPasswordDialog from './ResetPasswordDialog.vue'

function mountDialog(overrides: Record<string, unknown> = {}) {
  return mount(ResetPasswordDialog, {
    props: { open: true, userId: 'admin', ...overrides },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountDialog>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

describe('ResetPasswordDialog —— 弹窗形态', () => {
  it('未打开时不带 open 属性，且不渲染输入框', () => {
    const wrapper = mountDialog({ open: false })
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.find('#reset-password').exists()).toBe(false)
  })

  it('打开后标题带上用户标识，并同时讲明"首次设置"与"旧密码失效"两种意图', async () => {
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('h2').text()).toBe('重置密码：admin')
    const text = wrapper.text()
    expect(text).toContain('从未设过密码')
    expect(text).toContain('旧密码立即失效')
    expect(text).toContain('会话会被一并注销')
  })

  it('新密码输入框自动聚焦（焦点陷阱内首个落点）', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('#reset-password').attributes('data-autofocus')).toBeDefined()
  })
})

describe('ResetPasswordDialog —— 校验与提交', () => {
  it('两次输入一致 → 发出 submit（只带密码明文，不带用户标识）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('#reset-password').setValue('new-secret')
    await wrapper.find('#reset-password-confirm').setValue('new-secret')

    await buttonByText(wrapper, '确认重置')!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]).toEqual(['new-secret'])
  })

  it('两次输入不一致 → 不发出 submit，并提示原因', async () => {
    const wrapper = mountDialog()
    await wrapper.find('#reset-password').setValue('new-secret')
    await wrapper.find('#reset-password-confirm').setValue('new-secreT')

    await buttonByText(wrapper, '确认重置')!.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('两次输入的密码不一致')
  })

  it('密码过短 → 不发出 submit，并提示长度约束', async () => {
    const wrapper = mountDialog()
    await wrapper.find('#reset-password').setValue('123')
    await wrapper.find('#reset-password-confirm').setValue('123')

    await buttonByText(wrapper, '确认重置')!.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('密码长度须为 6~128 个字符')
  })

  it('取消：回写 update:open=false，不发出 submit', async () => {
    const wrapper = mountDialog()
    await buttonByText(wrapper, '取消')!.trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('重置中：按钮文案变为「重置中…」且禁用', () => {
    const wrapper = mountDialog({ busy: true })
    const submit = buttonByText(wrapper, '重置中…')
    expect(submit).toBeDefined()
    expect((submit!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('失败时错误就地展示（弹窗保持打开，输入不丢）', () => {
    const wrapper = mountDialog({
      error: { code: 'ADM_USER_NOT_FOUND', message: '用户不存在：admin' },
    })
    expect(wrapper.text()).toContain('密码未重置')
    expect(wrapper.find('#reset-password').exists()).toBe(true)
  })

  it('重新打开时清空上一次的输入', async () => {
    const wrapper = mountDialog()
    await wrapper.find('#reset-password').setValue('new-secret')
    await wrapper.find('#reset-password-confirm').setValue('new-secret')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.find('#reset-password').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('#reset-password-confirm').element as HTMLInputElement).value).toBe('')
  })
})
