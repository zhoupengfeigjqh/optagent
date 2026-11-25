<script setup lang="ts">
/**
 * 管理员专属登录页（2026-11-24 按注册原型 `#view-admin-login` 复刻）。
 *
 * 整页视图（路由保留伪路由 `/admin/login`），不套 `AppShell`——未登录的管理台
 * 没有一级导航可言。登录成功后 emit `authenticated`，由 App.vue 导航进控制台；
 * 已登录管理员误访本页时 App.vue 会直接改道，本组件不处理。
 *
 * 反馈分两路（与原型一致）：空字段走行内 `.err` 提示；服务端拒绝
 * （`ADM_INVALID_CREDENTIALS` 等）走 `alert-warn` 错误框。
 */
import { ref } from 'vue'
import { useAuthSession } from '../../composables/useAuthSession'
import { toErrorInfo, toUserMessage } from '../../utils/error-message'

const emit = defineEmits<{
  (e: 'authenticated'): void
}>()

const session = useAuthSession()

const account = ref('')
const password = ref('')
const accountError = ref('')
const passwordError = ref('')
/** 服务端拒绝的文案（行内校验错误不进这里） */
const alertMessage = ref('')
const submitting = ref(false)

async function submit(): Promise<void> {
  alertMessage.value = ''
  accountError.value = ''
  passwordError.value = ''
  if (account.value.trim() === '') {
    accountError.value = '请输入管理员账号'
    return
  }
  if (password.value === '') {
    passwordError.value = '请输入密码'
    return
  }
  submitting.value = true
  try {
    await session.login(account.value.trim(), password.value)
    if (!session.isAdmin.value) {
      await session.logout()
      alertMessage.value = '该账号不是管理员，请通过数字人的专属注册链接登录普通用户页面。'
      return
    }
    emit('authenticated')
  } catch (err) {
    alertMessage.value = toUserMessage(toErrorInfo(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="admin-login">
    <header class="admin-login__head">
      <p class="admin-login__brand">
        <span class="admin-login__mark" aria-hidden="true">DH</span>
        <span>数字人管理平台</span>
      </p>
      <span class="admin-login__tag">管理员入口</span>
    </header>

    <div class="admin-login__body">
      <div class="admin-login__card">
        <div class="admin-login__cap">
          <p class="admin-login__name">管理员登录</p>
          <p class="admin-login__sub">登录后可操作数字人设计、注册链接、用户管理等全部功能</p>
        </div>

        <div v-if="alertMessage" class="admin-login__alert" role="alert">{{ alertMessage }}</div>

        <form novalidate @submit.prevent="submit">
          <div class="admin-login__item">
            <label class="admin-login__label" for="admin-account">管理员账号</label>
            <input
              id="admin-account"
              v-model="account"
              class="admin-login__ctrl"
              :class="{ 'admin-login__ctrl--err': accountError !== '' }"
              type="text"
              autocomplete="username"
              placeholder="请输入管理员账号"
            />
            <p class="admin-login__err" aria-live="polite">{{ accountError }}</p>
          </div>

          <div class="admin-login__item">
            <label class="admin-login__label" for="admin-password">密码</label>
            <input
              id="admin-password"
              v-model="password"
              class="admin-login__ctrl"
              :class="{ 'admin-login__ctrl--err': passwordError !== '' }"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
            <p class="admin-login__err" aria-live="polite">{{ passwordError }}</p>
          </div>

          <button type="submit" class="btn btn--primary admin-login__submit" :disabled="submitting">
            {{ submitting ? '登录中…' : '登录' }}
          </button>
        </form>

        <div class="admin-login__foot">
          普通用户请通过数字人的「专属注册链接」进入注册/登录页，登录后仅可使用聊天对话功能。
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 版式与配色按原型复刻：渐变底 + 居中 460px 卡片 */
.admin-login {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, #f4f7fd 0%, #eef2f8 46%, #f7f8fa 100%);
}

.admin-login__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 18px 24px;
  flex-wrap: wrap;
}

.admin-login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-weight: 700;
  font-size: var(--font-size-md);
}

.admin-login__mark {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.admin-login__tag {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: #f2f3f5;
  border-radius: var(--radius-sm);
  padding: 1px 8px;
}

.admin-login__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px 48px;
}

.admin-login__card {
  width: min(460px, 100%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  box-shadow: 0 6px 24px rgb(31 35 41 / 14%);
  padding: 28px 30px 30px;
}

.admin-login__cap {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 20px;
}

.admin-login__name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.admin-login__sub {
  margin: 4px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.admin-login__alert {
  border-radius: var(--radius-md);
  padding: 11px 13px;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  margin-bottom: var(--space-4);
  background: var(--color-status-error-bg);
  border: 1px solid #f7d4d5;
  color: #a8323a;
}

.admin-login__item {
  margin-bottom: var(--space-4);
}

.admin-login__label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.admin-login__ctrl {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-lg);
  color: var(--color-text);
  background: var(--color-surface);
}

.admin-login__ctrl::placeholder {
  color: #b6bbc2;
  font-size: var(--font-size-sm);
}

.admin-login__ctrl:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgb(47 111 237 / 12%);
}

.admin-login__ctrl--err {
  border-color: var(--color-status-error);
  background: var(--color-status-error-bg);
}

.admin-login__err {
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  min-height: 18px;
  margin: 4px 0 0;
}

.admin-login__submit {
  width: 100%;
  height: 44px;
  font-size: 15px;
  justify-content: center;
}

.admin-login__foot {
  margin-top: 18px;
  padding-top: var(--space-4);
  border-top: 1px dashed var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.8;
}
</style>
