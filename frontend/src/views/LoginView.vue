<script setup lang="ts">
/**
 * 工作台登录页（薄壳）。
 *
 * 表单实现只有一处：`components/auth/LoginForm.vue`（与注册链接页的「登录」页签共用）。
 * 本页只负责落实 `?redirect=` 的落地去向。
 */
import { useRoute, useRouter } from 'vue-router'
import LoginForm from '@/components/auth/LoginForm.vue'

const router = useRouter()
const route = useRoute()

function onSuccess(): void {
  const redirect =
    typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
  void router.replace(redirect)
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <section
      class="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      aria-label="登录"
    >
      <h1 class="mb-6 text-xl font-semibold text-slate-800">登录</h1>

      <LoginForm @success="onSuccess" />
    </section>
  </main>
</template>
