<script setup lang="ts">
/**
 * 工作台登录表单（`/login` 与注册链接页的「登录」页签**共用同一实现**）。
 *
 * 标识字段为「账号或手机号」：11 位手机号走 `loginWithPhone`，其余按 `user_id`。
 * 后端 `POST /api/admin/auth/login` 本就支持 `user_id` / `phone` 二选一（`user_id` 优先），
 * 两条路径是同一契约，前端只做形态分流——因此没有手机号的 `admin` 类账号也能从任意入口登录。
 *
 * 本组件**不感知路由**：成功后只 `emit('success')`，去向由页面决定
 * （`/login` 尊重 `?redirect=`，注册链接页固定回工作台）。
 *
 * 反馈分两路（与 `AdminLoginView` 一致）：空字段走字段级行内提示；
 * 服务端拒绝（`ADM_INVALID_CREDENTIALS` 等）走统一 `role="alert"` 错误框。
 */
import { ref, watch } from 'vue'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons-vue'
import { getAuthStore } from '@/composables/useAuth'
import { toErrorInfo, toUserMessage } from '@/utils/error-message'

const props = withDefaults(
  defineProps<{
    /** 预填标识（通常是刚注册成功的手机号） */
    defaultAccount?: string
    /** 提交按钮文案 */
    submitLabel?: string
  }>(),
  { defaultAccount: '', submitLabel: '登录' },
)

const emit = defineEmits<{ (e: 'success'): void }>()

const auth = getAuthStore()

const account = ref(props.defaultAccount)
const password = ref('')
const accountError = ref('')
const passwordError = ref('')
const alertMessage = ref('')
const showPwd = ref(false)
const busy = ref(false)

/** 手机号形态（与注册页、后端 `normalizePhone` 同一规则）；命中才走 `phone` 登录 */
const PHONE_PATTERN = /^1\d{10}$/

// 预填值可能晚于本组件挂载（注册成功后才拿到手机号），到位且用户尚未输入时同步
watch(
  () => props.defaultAccount,
  (next) => {
    if (next !== '' && account.value.trim() === '') account.value = next
  },
)

async function onSubmit(): Promise<void> {
  if (busy.value) return
  alertMessage.value = ''
  accountError.value = ''
  passwordError.value = ''

  const identifier = account.value.trim()
  let ok = true
  if (identifier === '') {
    accountError.value = '请输入账号或手机号'
    ok = false
  }
  if (password.value === '') {
    passwordError.value = '请输入密码'
    ok = false
  }
  if (!ok) return

  busy.value = true
  try {
    if (PHONE_PATTERN.test(identifier)) {
      await auth.loginWithPhone(identifier, password.value)
    } else {
      await auth.login(identifier, password.value)
    }
    emit('success')
  } catch (err) {
    alertMessage.value = toUserMessage(toErrorInfo(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form novalidate aria-label="登录" @submit.prevent="onSubmit">
    <label class="mb-4 block">
      <span class="mb-1 block text-sm text-slate-600">账号或手机号</span>
      <input
        id="login-account"
        v-model="account"
        name="account"
        class="w-full rounded-md border px-3 py-2 focus:outline-none"
        :class="
          accountError !== ''
            ? 'border-red-400 bg-red-50'
            : 'border-slate-300 focus:border-blue-500'
        "
        type="text"
        autocomplete="username"
        placeholder="账号 / 11 位手机号"
      />
      <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ accountError }}</span>
    </label>

    <label class="mb-4 block">
      <span class="mb-1 block text-sm text-slate-600">密码</span>
      <span class="relative block">
        <input
          id="login-password"
          v-model="password"
          name="password"
          class="w-full rounded-md border px-3 py-2 pr-11 focus:outline-none"
          :class="
            passwordError !== ''
              ? 'border-red-400 bg-red-50'
              : 'border-slate-300 focus:border-blue-500'
          "
          :type="showPwd ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
        <button
          type="button"
          class="login-form__eye absolute right-1 top-1/2 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          :aria-label="showPwd ? '隐藏密码' : '显示密码'"
          :title="showPwd ? '隐藏密码' : '显示密码'"
          @click="showPwd = !showPwd"
        >
          <EyeInvisibleOutlined v-if="showPwd" />
          <EyeOutlined v-else />
        </button>
      </span>
      <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ passwordError }}</span>
    </label>

    <p v-if="alertMessage" class="mb-3 text-sm text-red-600" role="alert">{{ alertMessage }}</p>

    <button
      type="submit"
      class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
      :disabled="busy"
    >
      {{ busy ? '登录中…' : submitLabel }}
    </button>
  </form>
</template>
