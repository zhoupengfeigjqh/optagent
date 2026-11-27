import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RegisterView from './RegisterView.vue'

const auth = vi.hoisted(() => ({
  lookupRegisterLink: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  loginWithPhone: vi.fn(),
}))
const route = vi.hoisted(() => ({ query: { link: 'tok-1' } as Record<string, string> }))
const replace = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined))

vi.mock('@/composables/useAuth', () => ({ getAuthStore: () => auth }))
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}))

function mountView() {
  return mount(RegisterView)
}

function tab(wrapper: ReturnType<typeof mountView>, label: string) {
  return wrapper.findAll('[role="tab"]').find((item) => item.text().includes(label))
}

async function fillRegister(wrapper: ReturnType<typeof mountView>): Promise<void> {
  await wrapper.find('#register-phone').setValue('13900000001')
  await wrapper.find('#register-name').setValue('李四')
  await wrapper.find('#register-password').setValue('123456')
}

async function fillLogin(
  wrapper: ReturnType<typeof mountView>,
  account: string,
  password = '123456',
): Promise<void> {
  await wrapper.get('#login-account').setValue(account)
  await wrapper.get('#login-password').setValue(password)
  await wrapper.get('form').trigger('submit')
}

beforeEach(() => {
  vi.clearAllMocks()
  route.query = { link: 'tok-1' }
  auth.lookupRegisterLink.mockResolvedValue({
    agent: { code: 'DH-BOM001', name: 'BOM数字人' },
  })
  auth.register.mockResolvedValue({
    user_id: 'u_1',
    phone: '13900000001',
    display_name: '李四',
    granted_agent: { code: 'DH-BOM001', name: 'BOM数字人' },
  })
  auth.login.mockResolvedValue({ user_id: 'admin' })
  auth.loginWithPhone.mockResolvedValue({ user_id: 'u_1' })
})

describe('RegisterView —— 链接校验', () => {
  it('缺少 token 时提示原因，但保留登录入口（登录与 token 无关）', async () => {
    route.query = {}
    const wrapper = mountView()
    await flushPromises()
    expect(auth.lookupRegisterLink).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('链接缺少 token')
    expect(wrapper.find('#login-account').exists()).toBe(true)
    expect(wrapper.find('#register-phone').exists()).toBe(false)
  })

  it('链接失效时仍可用账号登录进入工作台', async () => {
    auth.lookupRegisterLink.mockRejectedValue({ code: 'ADM_INVALID_LINK', message: '' })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('注册链接不可用不影响登录')
    await fillLogin(wrapper, 'admin')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith('admin', '123456')
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('有效链接展示数字人信息与注册表单', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(auth.lookupRegisterLink).toHaveBeenCalledWith('tok-1')
    expect(wrapper.text()).toContain('BOM数字人')
    expect(wrapper.text()).toContain('DH-BOM001')
    expect(wrapper.find('#register-phone').exists()).toBe(true)
  })
})

describe('RegisterView —— 注册与登录', () => {
  it('注册成功后提示自动授权并切到登录页签（预填手机号）', async () => {
    const wrapper = mountView()
    await flushPromises()
    await fillRegister(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(auth.register).toHaveBeenCalledWith({
      link_token: 'tok-1',
      phone: '13900000001',
      display_name: '李四',
      password: '123456',
    })
    expect(wrapper.text()).toContain('已自动获得「BOM数字人」的使用权限')
    expect(wrapper.find('#login-account').exists()).toBe(true)
    expect((wrapper.find('#login-account').element as HTMLInputElement).value).toBe('13900000001')
  })

  it('登录页签用手机号登录（走 loginWithPhone）并跳转对话窗口', async () => {
    const wrapper = mountView()
    await flushPromises()
    await tab(wrapper, '登录')?.trigger('click')
    await fillLogin(wrapper, '13900000001')
    await flushPromises()

    expect(auth.loginWithPhone).toHaveBeenCalledWith('13900000001', '123456')
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('登录页签也支持账号（无手机号）登录', async () => {
    const wrapper = mountView()
    await flushPromises()
    await tab(wrapper, '登录')?.trigger('click')
    await fillLogin(wrapper, 'admin')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith('admin', '123456')
    expect(auth.loginWithPhone).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('手机号已注册时提供直接登录与更换手机号入口', async () => {
    auth.register.mockRejectedValue({ code: 'ADM_PHONE_TAKEN', message: '' })
    const wrapper = mountView()
    await flushPromises()
    await fillRegister(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('该手机号已注册')
    expect(wrapper.findAll('button').some((item) => item.text().includes('直接登录'))).toBe(true)
    expect(wrapper.findAll('button').some((item) => item.text().includes('换个手机号'))).toBe(true)
  })

  it('密码可见性按钮使用睁眼/闭眼图标', async () => {
    const wrapper = mountView()
    await flushPromises()
    const eye = wrapper.get('.register-view__eye')
    expect(eye.attributes('aria-label')).toBe('显示密码')
    expect(eye.text()).not.toContain('显示')
    await eye.trigger('click')
    expect(eye.attributes('aria-label')).toBe('隐藏密码')
    expect(wrapper.find('#register-password').attributes('type')).toBe('text')
  })
})
