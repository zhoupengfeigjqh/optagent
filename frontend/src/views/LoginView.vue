<script setup lang="ts">
/**
 * 登录页（024）
 *
 * 账号 = 数字人管理平台的业务使用者标识；密码由管理员在新建用户时设置。
 * 登录成功后由后端下发 HttpOnly Cookie，前端不持有凭据。
 */
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { getAuthStore } from '@/composables/useAuth'

const router = useRouter()
const route = useRoute()
const auth = getAuthStore()

const userId = ref('')
const password = ref('')
const busy = ref(false)
const errorText = ref('')

async function onSubmit(): Promise<void> {
  if (busy.value) return
  errorText.value = ''
  busy.value = true
  try {
    await auth.login(userId.value.trim(), password.value)
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/'
    await router.replace(redirect)
  } catch (err) {
    errorText.value =
      err instanceof ApiError ? err.message || '账号或密码错误' : '登录失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <form
      class="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      aria-label="登录"
      @submit.prevent="onSubmit"
    >
      <h1 class="mb-6 text-xl font-semibold text-slate-800">登录</h1>

      <label class="mb-4 block">
        <span class="mb-1 block text-sm text-slate-600">账号</span>
        <input
          v-model="userId"
          name="user_id"
          autocomplete="username"
          required
          class="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label class="mb-4 block">
        <span class="mb-1 block text-sm text-slate-600">密码</span>
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </label>

      <p v-if="errorText" class="mb-3 text-sm text-red-600" role="alert">{{ errorText }}</p>

      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {{ busy ? '登录中…' : '登录' }}
      </button>
    </form>
  </main>
</template>
