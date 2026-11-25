/**
 * 组件测试：管理员登录页（2026-11-24 按注册原型重构）。
 *
 * 守住：行内校验（空字段不发起请求）、凭据错误的 alert-warn 反馈、
 * 登录成功的 `authenticated` 事件、密码明文切换。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AdminLoginView from './AdminLoginView.vue'

const loginMock = vi.fn()
const logoutMock = vi.fn()
const isAdmin = ref(true)

vi.mock('../../composables/useAuthSession', () => ({
  useAuthSession: () => ({
    login: (...a: unknown[]) => loginMock(...a),
    logout: (...a: unknown[]) => logoutMock(...a),
    isAdmin,
  }),
}))

function byText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text))
}

beforeEach(() => {
  vi.clearAllMocks()
  isAdmin.value = true
})

describe('AdminLoginView —— 行内校验', () => {
  it('空账号：行内提示且不发起登录', async () => {
    const wrapper = mount(AdminLoginView)
    await byText(wrapper, '登录管理后台')!.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('请输入管理员账号')
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('空密码：行内提示且不发起登录', async () => {
    const wrapper = mount(AdminLoginView)
    await wrapper.find('#admin-account').setValue('admin')
    await byText(wrapper, '登录管理后台')!.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('请输入密码')
    expect(loginMock).not.toHaveBeenCalled()
  })
})

describe('AdminLoginView —— 登录流程', () => {
  it('登录成功：以去空格后的账号登录并发出 authenticated', async () => {
    loginMock.mockResolvedValue(undefined)
    const wrapper = mount(AdminLoginView)
    await wrapper.find('#admin-account').setValue('  admin  ')
    await wrapper.find('#admin-password').setValue('admin123')
    await byText(wrapper, '登录管理后台')!.trigger('submit')
    await flushPromises()
    expect(loginMock).toHaveBeenCalledWith('admin', 'admin123')
    expect(wrapper.emitted('authenticated')).toHaveLength(1)
  })

  it('凭据错误：alert 框展示错误码文案，不发出 authenticated', async () => {
    loginMock.mockRejectedValue({ code: 'ADM_INVALID_CREDENTIALS', message: '' })
    const wrapper = mount(AdminLoginView)
    await wrapper.find('#admin-account').setValue('admin')
    await wrapper.find('#admin-password').setValue('bad')
    await byText(wrapper, '登录管理后台')!.trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('账号或密码错误')
    expect(wrapper.emitted('authenticated')).toBeUndefined()
  })

  it('普通用户账号：拒绝进入管理台并清理会话', async () => {
    loginMock.mockResolvedValue(undefined)
    isAdmin.value = false
    const wrapper = mount(AdminLoginView)
    await wrapper.find('#admin-account').setValue('13800000000')
    await wrapper.find('#admin-password').setValue('123456')
    await byText(wrapper, '登录管理后台')!.trigger('submit')
    await flushPromises()
    expect(logoutMock).toHaveBeenCalled()
    expect(wrapper.text()).toContain('该账号不是管理员')
    expect(wrapper.emitted('authenticated')).toBeUndefined()
  })
})

describe('AdminLoginView —— 密码明文切换', () => {
  it('眼睛按钮在 password / text 间切换', async () => {
    const wrapper = mount(AdminLoginView)
    const input = wrapper.find('#admin-password')
    expect(input.attributes('type')).toBe('password')
    await wrapper.find('.admin-login__eye').trigger('click')
    expect(input.attributes('type')).toBe('text')
    await wrapper.find('.admin-login__eye').trigger('click')
    expect(input.attributes('type')).toBe('password')
  })
})
