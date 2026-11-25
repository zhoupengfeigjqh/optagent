/**
 * 全局登录会话（模块级单例状态，2026-11-24 按注册原型重构新增）。
 *
 * 三个顶层视图共享同一份会话投影：管理员登录页、注册链接页、受守卫的功能区。
 * App.vue 挂载即 `probe()`（`GET /auth/me`），登录页提交成功后写入 profile，
 * 守卫按 `profile.role === 'admin'` 放行功能区。
 *
 * 024 口径：会话凭据是 HttpOnly Cookie（`optagent_auth`），前端不持有 token——
 * 「登录态」只存在于这份内存投影里，刷新页面后靠 `probe()` 重建。
 *
 * 角色口径（028 §4.1）：`role` 只在 `/auth/me` 响应中携带；`login` 响应只有
 * `user_id`，故登录成功后立即再探一次 `/me` 把 `role`/`display_name` 补齐。
 */
import { computed, ref } from 'vue'
import { fetchMe, login as loginApi, logout as logoutApi } from '../api/auth'
import type { MeProfile } from '../api/types'

/** 当前会话（null = 未登录）；模块级单例，跨组件共享 */
const profile = ref<MeProfile | null>(null)

/** 是否已完成过一次探测：完成前不渲染受守卫视图，避免闪跳登录页 */
const ready = ref(false)

/** 当前会话是否为管理员（功能区守卫的唯一口径） */
const isAdmin = computed(() => profile.value?.role === 'admin')

/** 探测登录态：成功写入 profile；401 / 网络异常一律按未登录处理（024：失效即重登） */
async function probe(): Promise<MeProfile | null> {
  try {
    profile.value = await fetchMe()
  } catch {
    profile.value = null
  } finally {
    ready.value = true
  }
  return profile.value
}

/**
 * 管理员登录：先建立 Cookie 会话，再探 `/me` 补齐角色与展示名。
 *
 * 失败（`ADM_INVALID_CREDENTIALS` 等）原样抛出，由登录页按错误码映射文案；
 * 此时 profile 保持 null。
 */
async function login(account: string, password: string): Promise<void> {
  const res = await loginApi({ user_id: account, password })
  const me = await fetchMe()
  profile.value = { ...me, user_id: res.user_id }
}

/** 退出登录：后端幂等（无效令牌也返回 204），无论成败都清掉本地投影 */
async function logout(): Promise<void> {
  try {
    await logoutApi()
  } catch {
    // 会话已失效时后端仍会清 Cookie；这里吞掉异常，保证本地一定回未登录态
  } finally {
    profile.value = null
  }
}

/** 会话句柄（模块级单例的只读视图） */
export function useAuthSession() {
  return {
    profile,
    ready,
    isAdmin,
    probe,
    login,
    logout,
  }
}
