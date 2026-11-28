<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ErrorInfo } from '../../api/types'
import { passwordError as passwordIssue } from '../../utils/password'
import BaseDialog from '../common/BaseDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
  userId: string
  busy?: boolean
  error?: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', password: string): void
}>()

const password = ref('')
const confirmPassword = ref('')
const localError = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    password.value = ''
    confirmPassword.value = ''
    localError.value = ''
  },
  { immediate: true },
)

function submit(): void {
  localError.value = ''
  const issue = passwordIssue(password.value)
  if (issue) {
    localError.value = issue
    return
  }
  if (password.value !== confirmPassword.value) {
    localError.value = '两次输入的密码不一致'
    return
  }
  emit('submit', password.value)
}
</script>

<template>
  <BaseDialog
    :open="open"
    :title="`重置密码：${props.userId}`"
    :width="480"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <p class="reset-password__hint">
        为「{{ props.userId }}」设置一个新密码：从未设过密码的账号由此获得登录能力；
        已有密码的账号旧密码立即失效。该用户当前已登录的会话会被一并注销，需要用新密码重新登录。
      </p>

      <label class="field reset-password__field" for="reset-password">
        <span class="field__label">
          新密码<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input
          id="reset-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="至少 6 个字符"
          data-autofocus
        />
      </label>

      <label class="field reset-password__field" for="reset-password-confirm">
        <span class="field__label">
          确认新密码<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input
          id="reset-password-confirm"
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="再输入一次"
        />
        <span class="field__hint">两次输入必须一致，避免手误后无法登录。</span>
      </label>

      <p v-if="localError" class="field__hint" role="alert" style="color: #c00">
        {{ localError }}
      </p>

      <ErrorNotice v-if="props.error" :error="props.error" title="密码未重置" />
    </template>

    <template #footer>
      <button type="button" class="btn" @click="emit('update:open', false)">取消</button>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
        {{ busy ? '重置中…' : '确认重置' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.reset-password__hint {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.reset-password__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}
</style>
