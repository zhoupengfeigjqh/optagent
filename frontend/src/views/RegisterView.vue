<script setup lang="ts">
/**
 * 普通用户注册/登录页。
 *
 * 专属注册链接落在 `/register?link=<token>`。注册成功后自动获得链接对应数字人的权限，
 * 随后切到登录页签；登录成功直接进入现有对话工作台。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
const rAgree = ref(false)
const rPhoneErr = ref('')
const rNameErr = ref('')
const rPwdErr = ref('')
const rAgreeErr = ref('')

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
  rAgreeErr.value = ''
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
  if (!rAgree.value) {
    rAgreeErr.value = '请先阅读并同意用户协议'
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
    rAgree.value = false
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
  <main class="register-view">
    <div class="register-view__body">
      <section class="register-view__card" aria-label="普通用户注册或登录">
        <p v-if="phase === 'loading'" class="register-view__loading" role="status">
          正在校验注册链接…
        </p>

        <div
          v-else-if="phase === 'invalid'"
          class="register-view__alert register-view__alert--warn"
          role="alert"
        >
          {{ lookupMessage }}
        </div>

        <template v-else>
          <div class="register-view__chip">
            <div class="register-view__avatar" aria-hidden="true">{{ avatarChar }}</div>
            <div>
              <p class="register-view__robot-name">{{ agent?.name }}</p>
              <p class="register-view__robot-sub">专属注册链接 · {{ agent?.code }}</p>
            </div>
          </div>

          <div class="register-view__seg" role="tablist" aria-label="注册或登录">
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'register'"
              :class="{ 'register-view__seg-btn--active': mode === 'register' }"
              @click="switchMode('register')"
            >
              注册
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'login'"
              :class="{ 'register-view__seg-btn--active': mode === 'login' }"
              @click="switchMode('login')"
            >
              登录
            </button>
          </div>

          <div
            v-if="existAlert"
            class="register-view__alert register-view__alert--warn"
            role="alert"
          >
            <span>该手机号已注册，无需重复注册。设置过密码可直接登录。</span>
            <span class="register-view__alert-ops">
              <button type="button" class="btn btn--primary" @click="gotoLogin">直接登录</button>
              <button type="button" class="btn" @click="changePhone">换个手机号</button>
            </span>
          </div>
          <div v-if="okMessage" class="register-view__alert register-view__alert--ok" role="status">
            {{ okMessage }}
          </div>
          <div
            v-if="formMessage"
            class="register-view__alert register-view__alert--warn"
            role="alert"
          >
            {{ formMessage }}
          </div>

          <form v-if="mode === 'register'" novalidate @submit.prevent="submitRegister">
            <div class="register-view__item">
              <label class="register-view__label" for="register-phone">手机号</label>
              <input
                id="register-phone"
                v-model="rPhone"
                class="register-view__ctrl"
                :class="{ 'register-view__ctrl--err': rPhoneErr !== '' }"
                type="tel"
                inputmode="numeric"
                maxlength="11"
                autocomplete="tel"
                placeholder="请输入 11 位手机号"
              />
              <p class="register-view__err" aria-live="polite">{{ rPhoneErr }}</p>
            </div>
            <div class="register-view__item">
              <label class="register-view__label" for="register-name">用户名</label>
              <input
                id="register-name"
                v-model="rName"
                class="register-view__ctrl"
                :class="{ 'register-view__ctrl--err': rNameErr !== '' }"
                type="text"
                maxlength="20"
                autocomplete="nickname"
                placeholder="请输入用户名，2-20 个字符"
              />
              <p class="register-view__err" aria-live="polite">{{ rNameErr }}</p>
            </div>
            <div class="register-view__item">
              <label class="register-view__label" for="register-password">密码</label>
              <div class="register-view__pwd">
                <input
                  id="register-password"
                  v-model="rPwd"
                  class="register-view__ctrl"
                  :class="{ 'register-view__ctrl--err': rPwdErr !== '' }"
                  :type="rShowPwd ? 'text' : 'password'"
                  maxlength="20"
                  autocomplete="new-password"
                  placeholder="请输入 6-20 位密码"
                />
                <button
                  type="button"
                  class="register-view__eye"
                  :aria-label="rShowPwd ? '隐藏密码' : '显示密码'"
                  @click="rShowPwd = !rShowPwd"
                >
                  {{ rShowPwd ? '隐藏' : '显示' }}
                </button>
              </div>
              <p class="register-view__err" aria-live="polite">{{ rPwdErr }}</p>
            </div>
            <label class="register-view__agree">
              <input v-model="rAgree" type="checkbox" />
              <span>
                我已阅读并同意《用户服务协议》与《隐私政策》
                <span v-if="rAgreeErr !== ''" class="register-view__err" role="alert">
                  {{ rAgreeErr }}
                </span>
              </span>
            </label>
            <button
              type="submit"
              class="btn btn--primary register-view__submit"
              :disabled="submitting"
            >
              {{ submitting ? '提交中…' : '点击注册' }}
            </button>
          </form>

          <form v-else novalidate @submit.prevent="submitLogin">
            <div class="register-view__item">
              <label class="register-view__label" for="login-phone">手机号</label>
              <input
                id="login-phone"
                v-model="lPhone"
                class="register-view__ctrl"
                :class="{ 'register-view__ctrl--err': lPhoneErr !== '' }"
                type="tel"
                inputmode="numeric"
                maxlength="11"
                autocomplete="tel"
                placeholder="请输入已注册的手机号"
              />
              <p class="register-view__err" aria-live="polite">{{ lPhoneErr }}</p>
            </div>
            <div class="register-view__item">
              <label class="register-view__label" for="login-password">密码</label>
              <div class="register-view__pwd">
                <input
                  id="login-password"
                  v-model="lPwd"
                  class="register-view__ctrl"
                  :class="{ 'register-view__ctrl--err': lPwdErr !== '' }"
                  :type="lShowPwd ? 'text' : 'password'"
                  maxlength="20"
                  autocomplete="current-password"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  class="register-view__eye"
                  :aria-label="lShowPwd ? '隐藏密码' : '显示密码'"
                  @click="lShowPwd = !lShowPwd"
                >
                  {{ lShowPwd ? '隐藏' : '显示' }}
                </button>
              </div>
              <p class="register-view__err" aria-live="polite">{{ lPwdErr }}</p>
            </div>
            <button
              type="submit"
              class="btn btn--primary register-view__submit"
              :disabled="submitting"
            >
              {{ submitting ? '登录中…' : '登录并进入对话' }}
            </button>
          </form>

          <div class="register-view__foot">
            通过本链接注册成功后，自动获得该数字人权限，无需后台审批；登录后直接进入对话窗口。
          </div>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped src="./RegisterView.css"></style>
