<script setup lang="ts">
/**
 * 普通用户注册/登录页。
 *
 * 专属注册链接落在 `/register?link=<token>`。注册成功后自动获得链接对应数字人的权限，
 * 随后切到登录页签；登录成功直接进入现有对话工作台。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons-vue'
import type { RegisterResult } from '@/api/auth'
import { getAuthStore } from '@/composables/useAuth'
import { toErrorInfo, toUserMessage } from '@/utils/error-message'

const route = useRoute()
const router = useRouter()
const auth = getAuthStore()

const link = computed(() => (typeof route.query.link === 'string' ? route.query.link : ''))

/** 页面阶段：校验链接 → 无效（只有警告）/ 可用（表单） */
const phase = ref<'loading' | 'invalid' | 'ready'>('loading')
const agent = ref<{ code: string; name: string } | null>(null)
const lookupMessage = ref('')

const mode = ref<'register' | 'login'>('register')

const rPhone = ref('')
const rName = ref('')
const rPwd = ref('')
const rPhoneErr = ref('')
const rNameErr = ref('')
const rPwdErr = ref('')

const lPhone = ref('')
const lPwd = ref('')
const lPhoneErr = ref('')
const lPwdErr = ref('')

const rShowPwd = ref(false)
const lShowPwd = ref(false)

const existAlert = ref(false)
const okMessage = ref('')
const formMessage = ref('')
const submitting = ref(false)

const avatarChar = computed(() => (agent.value?.name ?? '数').slice(0, 1))

watch(
  link,
  async (token) => {
    phase.value = 'loading'
    agent.value = null
    if (!token) {
      lookupMessage.value = '请通过数字人的「专属注册链接」进入本页（链接缺少 token）。'
      phase.value = 'invalid'
      return
    }
    try {
      const result = await auth.lookupRegisterLink(token)
      agent.value = result.agent
      phase.value = 'ready'
    } catch (err) {
      lookupMessage.value = toUserMessage(toErrorInfo(err))
      phase.value = 'invalid'
    }
  },
  { immediate: true },
)

function switchMode(next: 'register' | 'login'): void {
  mode.value = next
  existAlert.value = false
  formMessage.value = ''
  if (next === 'login' && /^1[3-9]\d{9}$/.test(rPhone.value.trim()) && lPhone.value === '') {
    lPhone.value = rPhone.value.trim()
  }
}

function validateRegister(): boolean {
  rPhoneErr.value = ''
  rNameErr.value = ''
  rPwdErr.value = ''
  let ok = true
  const phone = rPhone.value.trim()
  if (phone === '') {
    rPhoneErr.value = '请输入手机号'
    ok = false
  } else if (!/^1[3-9]\d{9}$/.test(phone)) {
    rPhoneErr.value = '手机号格式不正确，需为 11 位有效号码'
    ok = false
  }
  const name = rName.value.trim()
  if (name === '') {
    rNameErr.value = '请输入用户名'
    ok = false
  } else if (name.length < 2) {
    rNameErr.value = '用户名至少 2 个字符'
    ok = false
  }
  if (rPwd.value === '') {
    rPwdErr.value = '请输入密码'
    ok = false
  } else if (rPwd.value.length < 6) {
    rPwdErr.value = '密码至少 6 位'
    ok = false
  }
  return ok
}

async function submitRegister(): Promise<void> {
  okMessage.value = ''
  formMessage.value = ''
  existAlert.value = false
  if (!validateRegister()) return
  submitting.value = true
  try {
    const created: RegisterResult = await auth.register({
      link_token: link.value,
      phone: rPhone.value.trim(),
      display_name: rName.value.trim(),
      password: rPwd.value,
    })
    okMessage.value = `注册成功！已自动获得「${created.granted_agent.name}」的使用权限，请登录。`
    rPwd.value = ''
    lPhone.value = created.phone
    mode.value = 'login'
  } catch (err) {
    const info = toErrorInfo(err)
    if (info.code === 'ADM_PHONE_TAKEN') existAlert.value = true
    else formMessage.value = toUserMessage(info)
  } finally {
    submitting.value = false
  }
}

function gotoLogin(): void {
  existAlert.value = false
  mode.value = 'login'
  lPhone.value = rPhone.value.trim()
}

function changePhone(): void {
  existAlert.value = false
  rPhone.value = ''
}

async function submitLogin(): Promise<void> {
  formMessage.value = ''
  lPhoneErr.value = ''
  lPwdErr.value = ''
  let ok = true
  if (lPhone.value.trim() === '') {
    lPhoneErr.value = '请输入手机号'
    ok = false
  } else if (!/^1[3-9]\d{9}$/.test(lPhone.value.trim())) {
    lPhoneErr.value = '手机号格式不正确'
    ok = false
  }
  if (lPwd.value === '') {
    lPwdErr.value = '请输入密码'
    ok = false
  }
  if (!ok) return

  submitting.value = true
  try {
    await auth.loginWithPhone(lPhone.value.trim(), lPwd.value)
    await router.replace('/')
  } catch (err) {
    formMessage.value = toUserMessage(toErrorInfo(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <section
      class="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      aria-label="普通用户注册或登录"
    >
      <p v-if="phase === 'loading'" class="text-center text-sm text-slate-500" role="status">
        正在校验注册链接…
      </p>

      <div
        v-else-if="phase === 'invalid'"
        class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        role="alert"
      >
        {{ lookupMessage }}
      </div>

      <template v-else>
        <div class="mb-6 flex items-center gap-3 border-b border-slate-200 pb-5">
          <div
            class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {{ avatarChar }}
          </div>
          <div>
            <p class="text-base font-semibold text-slate-800">{{ agent?.name }}</p>
            <p class="text-xs text-slate-500">专属注册链接 · {{ agent?.code }}</p>
          </div>
        </div>

        <div class="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="注册或登录">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'register'"
            class="flex-1 rounded-md py-2 text-sm text-slate-600"
            :class="mode === 'register' ? 'bg-white font-semibold text-blue-600 shadow-sm' : ''"
            @click="switchMode('register')"
          >
            注册
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'login'"
            class="flex-1 rounded-md py-2 text-sm text-slate-600"
            :class="mode === 'login' ? 'bg-white font-semibold text-blue-600 shadow-sm' : ''"
            @click="switchMode('login')"
          >
            登录
          </button>
        </div>

        <div
          v-if="existAlert"
          class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          role="alert"
        >
          <span>该手机号已注册，无需重复注册。设置过密码可直接登录。</span>
          <span class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              @click="gotoLogin"
            >
              直接登录
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              @click="changePhone"
            >
              换个手机号
            </button>
          </span>
        </div>
        <div
          v-if="okMessage"
          class="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200"
          role="status"
        >
          {{ okMessage }}
        </div>
        <div
          v-if="formMessage"
          class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          role="alert"
        >
          {{ formMessage }}
        </div>

        <form v-if="mode === 'register'" novalidate @submit.prevent="submitRegister">
          <label class="mb-4 block">
            <span class="mb-1 block text-sm text-slate-600">手机号</span>
            <input
              id="register-phone"
              v-model="rPhone"
              class="w-full rounded-md border px-3 py-2 focus:outline-none"
              :class="
                rPhoneErr !== ''
                  ? 'border-red-400 bg-red-50'
                  : 'border-slate-300 focus:border-blue-500'
              "
              type="tel"
              inputmode="numeric"
              maxlength="11"
              autocomplete="tel"
              placeholder="请输入 11 位手机号"
            />
            <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ rPhoneErr }}</span>
          </label>
          <label class="mb-4 block">
            <span class="mb-1 block text-sm text-slate-600">用户名</span>
            <input
              id="register-name"
              v-model="rName"
              class="w-full rounded-md border px-3 py-2 focus:outline-none"
              :class="
                rNameErr !== ''
                  ? 'border-red-400 bg-red-50'
                  : 'border-slate-300 focus:border-blue-500'
              "
              type="text"
              maxlength="20"
              autocomplete="nickname"
              placeholder="请输入用户名，2-20 个字符"
            />
            <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ rNameErr }}</span>
          </label>
          <label class="mb-4 block">
            <span class="mb-1 block text-sm text-slate-600">密码</span>
            <span class="relative block">
              <input
                id="register-password"
                v-model="rPwd"
                class="w-full rounded-md border px-3 py-2 pr-11 focus:outline-none"
                :class="
                  rPwdErr !== ''
                    ? 'border-red-400 bg-red-50'
                    : 'border-slate-300 focus:border-blue-500'
                "
                :type="rShowPwd ? 'text' : 'password'"
                maxlength="20"
                autocomplete="new-password"
                placeholder="请输入 6-20 位密码"
              />
              <button
                type="button"
                class="register-view__eye absolute right-1 top-1/2 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                :aria-label="rShowPwd ? '隐藏密码' : '显示密码'"
                :title="rShowPwd ? '隐藏密码' : '显示密码'"
                @click="rShowPwd = !rShowPwd"
              >
                <EyeInvisibleOutlined v-if="rShowPwd" />
                <EyeOutlined v-else />
              </button>
            </span>
            <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ rPwdErr }}</span>
          </label>
          <button
            type="submit"
            class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
            :disabled="submitting"
          >
            {{ submitting ? '注册中…' : '注册' }}
          </button>
        </form>

        <form v-else novalidate @submit.prevent="submitLogin">
          <label class="mb-4 block">
            <span class="mb-1 block text-sm text-slate-600">手机号</span>
            <input
              id="login-phone"
              v-model="lPhone"
              class="w-full rounded-md border px-3 py-2 focus:outline-none"
              :class="
                lPhoneErr !== ''
                  ? 'border-red-400 bg-red-50'
                  : 'border-slate-300 focus:border-blue-500'
              "
              type="tel"
              inputmode="numeric"
              maxlength="11"
              autocomplete="tel"
              placeholder="请输入已注册的手机号"
            />
            <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ lPhoneErr }}</span>
          </label>
          <label class="mb-4 block">
            <span class="mb-1 block text-sm text-slate-600">密码</span>
            <span class="relative block">
              <input
                id="login-password"
                v-model="lPwd"
                class="w-full rounded-md border px-3 py-2 pr-11 focus:outline-none"
                :class="
                  lPwdErr !== ''
                    ? 'border-red-400 bg-red-50'
                    : 'border-slate-300 focus:border-blue-500'
                "
                :type="lShowPwd ? 'text' : 'password'"
                maxlength="20"
                autocomplete="current-password"
                placeholder="请输入密码"
              />
              <button
                type="button"
                class="register-view__eye absolute right-1 top-1/2 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                :aria-label="lShowPwd ? '隐藏密码' : '显示密码'"
                :title="lShowPwd ? '隐藏密码' : '显示密码'"
                @click="lShowPwd = !lShowPwd"
              >
                <EyeInvisibleOutlined v-if="lShowPwd" />
                <EyeOutlined v-else />
              </button>
            </span>
            <span class="mt-1 block text-xs text-red-600" aria-live="polite">{{ lPwdErr }}</span>
          </label>
          <button
            type="submit"
            class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
            :disabled="submitting"
          >
            {{ submitting ? '登录中…' : '登录' }}
          </button>
        </form>

        <div class="mt-5 border-t border-dashed border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
          通过本链接注册成功后，自动获得该数字人权限，无需后台审批；登录后直接进入对话窗口。
        </div>
      </template>
    </section>
  </main>
</template>
