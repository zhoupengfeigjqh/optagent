import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginForm from './LoginForm.vue'

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithPhone: vi.fn(),
}))

vi.mock('@/composables/useAuth', () => ({ getAuthStore: () => auth }))

function mountForm(props: { defaultAccount?: string; submitLabel?: string } = {}) {
  return mount(LoginForm, { props })
}

async function submit(
  wrapper: ReturnType<typeof mountForm>,
  account: string,
  password: string,
): Promise<void> {
  await wrapper.get('#login-account').setValue(account)
  await wrapper.get('#login-password').setValue(password)
  await wrapper.get('form').trigger('submit')
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.login.mockResolvedValue({ user_id: 'admin' })
  auth.loginWithPhone.mockResolvedValue({ user_id: 'u_1' })
})

describe('LoginForm —— 标识分流', () => {
  it('11 位手机号走 loginWithPhone', async () => {
    const wrapper = mountForm()
    await submit(wrapper, '13900000001', '123456')
    expect(auth.loginWithPhone).toHaveBeenCalledWith('13900000001', '123456')
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('非手机号按账号（user_id）登录——没有手机号的 admin 类账号也能登', async () => {
    const wrapper = mountForm()
    await submit(wrapper, 'admin', '123456')
    expect(auth.login).toHaveBeenCalledWith('admin', '123456')
    expect(auth.loginWithPhone).not.toHaveBeenCalled()
  })

  it('标识首尾空格被裁剪后再分流', async () => {
    const wrapper = mountForm()
    await submit(wrapper, '  admin  ', '123456')
    expect(auth.login).toHaveBeenCalledWith('admin', '123456')
  })
})

describe('LoginForm —— 校验与反馈', () => {
  it('空字段走字段级提示，不发请求', async () => {
    const wrapper = mountForm()
    await wrapper.get('form').trigger('submit')

    expect(wrapper.text()).toContain('请输入账号或手机号')
    expect(wrapper.text()).toContain('请输入密码')
    expect(auth.login).not.toHaveBeenCalled()
    expect(auth.loginWithPhone).not.toHaveBeenCalled()
  })

  it('服务端拒绝显示可读文案（role=alert）', async () => {
    auth.login.mockRejectedValue({ code: 'ADM_INVALID_CREDENTIALS', message: '' })
    const wrapper = mountForm()
    await submit(wrapper, 'admin', 'wrong')

    expect(wrapper.get('[role="alert"]').text()).toContain('账号或密码错误')
    expect(wrapper.emitted('success')).toBeUndefined()
  })

  it('成功后 emit success（跳转交给页面决定）', async () => {
    const wrapper = mountForm()
    await submit(wrapper, 'admin', '123456')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('提交中文案变为登录中且禁用按钮', async () => {
    let release: (value: { user_id: string }) => void = () => undefined
    auth.login.mockReturnValue(
      new Promise<{ user_id: string }>((resolve) => {
        release = resolve
      }),
    )
    const wrapper = mountForm()
    await submit(wrapper, 'admin', '123456')

    expect(wrapper.get('button[type="submit"]').text()).toContain('登录中')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    release({ user_id: 'admin' })
    await wrapper.vm.$nextTick()
  })
})

describe('LoginForm —— 预填与密码可见性', () => {
  it('defaultAccount 预填到标识输入框', () => {
    const wrapper = mountForm({ defaultAccount: '13900000001' })
    expect((wrapper.get('#login-account').element as HTMLInputElement).value).toBe('13900000001')
  })

  it('预填值晚到（注册成功后才拿到手机号）也会同步，且不覆盖用户已输入内容', async () => {
    const wrapper = mountForm()
    await wrapper.setProps({ defaultAccount: '13900000001' })
    expect((wrapper.get('#login-account').element as HTMLInputElement).value).toBe('13900000001')

    await wrapper.get('#login-account').setValue('admin')
    await wrapper.setProps({ defaultAccount: '13800000002' })
    expect((wrapper.get('#login-account').element as HTMLInputElement).value).toBe('admin')
  })

  it('眼睛按钮切换密码可见性并同步 aria-label', async () => {
    const wrapper = mountForm()
    const eye = wrapper.get('.login-form__eye')
    expect(eye.attributes('aria-label')).toBe('显示密码')

    await eye.trigger('click')
    expect(eye.attributes('aria-label')).toBe('隐藏密码')
    expect(wrapper.get('#login-password').attributes('type')).toBe('text')
  })
})
