/**
 * 组件测试：全局登录会话（2026-11-24 按注册原型重构）。
 *
 * 会话状态是模块级单例，因此每个用例先 `vi.resetModules()` 取全新实例，
 * 保证用例间互不污染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeProfile } from '../api/types'

const fetchMe = vi.fn()
const loginApi = vi.fn()
const logoutApi = vi.fn()

vi.mock('../api/auth', () => ({
  fetchMe: (...a: unknown[]) => fetchMe(...a),
  login: (...a: unknown[]) => loginApi(...a),
  logout: (...a: unknown[]) => logoutApi(...a),
}))

const ME_ADMIN: MeProfile = {
  user_id: 'admin',
  phone: null,
  display_name: '平台管理员',
  role: 'admin',
}
const ME_USER: MeProfile = {
  user_id: 'u_1',
  phone: '13800000000',
  display_name: '张三',
  role: 'user',
}

/** 取全新模块实例（resetModules 后重新 import） */
async function fresh() {
  const mod = await import('./useAuthSession')
  return mod.useAuthSession()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('useAuthSession —— probe', () => {
  it('探测到管理员会话：写入 profile，isAdmin 为真', async () => {
    fetchMe.mockResolvedValue(ME_ADMIN)
    const s = await fresh()
    expect(s.ready.value).toBe(false)
    await s.probe()
    expect(s.profile.value).toEqual(ME_ADMIN)
    expect(s.ready.value).toBe(true)
    expect(s.isAdmin.value).toBe(true)
  })

  it('未登录（/me 401）：profile 保持 null，ready 置位', async () => {
    fetchMe.mockRejectedValue({ code: 'ADM_UNAUTHENTICATED' })
    const s = await fresh()
    await s.probe()
    expect(s.profile.value).toBeNull()
    expect(s.ready.value).toBe(true)
    expect(s.isAdmin.value).toBe(false)
  })
})

describe('useAuthSession —— login', () => {
  it('登录成功：以 /me 结果补齐角色与展示名', async () => {
    loginApi.mockResolvedValue({ user_id: 'admin' })
    fetchMe.mockResolvedValue(ME_ADMIN)
    const s = await fresh()
    await s.login('admin', 'admin123')
    expect(loginApi).toHaveBeenCalledWith({ user_id: 'admin', password: 'admin123' })
    expect(s.profile.value).toEqual(ME_ADMIN)
    expect(s.isAdmin.value).toBe(true)
  })

  it('登录失败（凭据错误）：异常向上抛，profile 保持未登录', async () => {
    loginApi.mockRejectedValue({ code: 'ADM_INVALID_CREDENTIALS' })
    const s = await fresh()
    await expect(s.login('admin', 'bad')).rejects.toMatchObject({
      code: 'ADM_INVALID_CREDENTIALS',
    })
    expect(s.profile.value).toBeNull()
  })

  it('普通用户登录：isAdmin 为假（功能区守卫不放行）', async () => {
    loginApi.mockResolvedValue({ user_id: 'u_1' })
    fetchMe.mockResolvedValue(ME_USER)
    const s = await fresh()
    await s.login('13800000000', '123456')
    expect(s.isAdmin.value).toBe(false)
  })
})

describe('useAuthSession —— logout', () => {
  it('退出登录：清空本地会话', async () => {
    fetchMe.mockResolvedValue(ME_ADMIN)
    const s = await fresh()
    await s.probe()
    expect(s.profile.value).not.toBeNull()
    await s.logout()
    expect(s.profile.value).toBeNull()
    expect(s.isAdmin.value).toBe(false)
  })

  it('登出 API 失败也清空本地会话（后端幂等，本地必须回未登录态）', async () => {
    fetchMe.mockResolvedValue(ME_ADMIN)
    logoutApi.mockRejectedValue(new Error('network'))
    const s = await fresh()
    await s.probe()
    await s.logout()
    expect(s.profile.value).toBeNull()
  })
})

describe('useAuthSession —— 单例', () => {
  it('两次取句柄共享同一份状态', async () => {
    fetchMe.mockResolvedValue(ME_ADMIN)
    const s1 = await fresh()
    const s2 = await fresh()
    await s1.probe()
    expect(s2.profile.value).toEqual(ME_ADMIN)
    expect(s2.isAdmin.value).toBe(true)
  })
})
