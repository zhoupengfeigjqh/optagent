<script setup lang="ts">
/**
 * 目标运行形态切换（`FR-057`、`FR-007`）。
 *
 * **属破坏性操作**：切换后既有部署产物需按新形态重新物化，因此 MUST
 * 先提示并**二次确认**。选项来自服务端（前端 MUST NOT 硬编码，原则七）。
 */
import { ref } from 'vue'
import type { ErrorInfo, RuntimeFormOption } from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  current: string
  forms: RuntimeFormOption[]
  label?: string
}>()

const emit = defineEmits<{
  (e: 'switch', value: string): void
  (e: 'announce', text: string): void
}>()

const pending = ref<string | null>(null)
const error = ref<ErrorInfo | null>(null)

function request(form: string): void {
  if (form === props.current) return
  pending.value = form
}

function confirm(): void {
  const form = pending.value
  if (!form) return
  emit('switch', form)
  emit('announce', '目标运行形态已切换，请重新部署以使产物按新形态物化')
  pending.value = null
}
</script>

<template>
  <div class="runtime-form-switch">
    <p class="runtime-form-switch__current">
      当前目标运行形态：<strong>{{ current }}</strong>
    </p>

    <div class="runtime-form-switch__options" role="radiogroup" aria-label="目标运行形态">
      <button
        v-for="form in forms"
        :key="form.value"
        type="button"
        role="radio"
        class="btn"
        :class="{ 'btn--primary': form.value === current }"
        :aria-checked="form.value === current"
        @click="request(form.value)"
      >
        {{ form.label }}
      </button>
    </div>
    <p class="field__hint">
      连接地址随形态而异；切换**不会**修改宿主机 hosts 文件，也不需手工编辑数字人配置。
    </p>

    <ErrorNotice :error="error" title="切换失败" />

    <ConfirmDialog
      :open="pending !== null"
      title="切换目标运行形态？"
      message="既有部署产物将按新形态重新物化，需重新执行一次「部署生效」；切换本身不写入运行环境。"
      confirm-label="切换"
      danger
      @update:open="(value) => { if (!value) pending = null }"
      @confirm="confirm"
    />
  </div>
</template>

<style scoped>
.runtime-form-switch__current {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
}

.runtime-form-switch__options {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
</style>
