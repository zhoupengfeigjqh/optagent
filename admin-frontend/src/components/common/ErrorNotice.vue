<script setup lang="ts">
/**
 * 错误提示：按**错误码分派**中文文案（前端 MUST NOT 直接展示后端 message），
 * 并在 `aria-live` 区域播报（原则四）。
 *
 * 2026-11-27：随 `/api/admin/deploy/validate` 废止，原「明细插槽」一并移除——
 * 全仓没有任何调用方传子节点，插槽从未渲染过。
 */
import { computed } from 'vue'
import type { ErrorInfo } from '../../api/types'
import { toUserMessage } from '../../utils/error-message'

const props = defineProps<{
  error: ErrorInfo | null | undefined
  title?: string
}>()

const message = computed(() => (props.error ? toUserMessage(props.error) : ''))
const code = computed(() => props.error?.code ?? '')
</script>

<template>
  <div v-if="error" class="error-notice" role="alert" aria-live="polite">
    <p class="error-notice__headline">
      <span class="error-notice__icon" aria-hidden="true">✕</span>
      <span>{{ title ?? '操作未完成' }}</span>
    </p>
    <p class="error-notice__message">{{ message }}</p>
    <p v-if="code" class="error-notice__code">错误码：{{ code }}</p>
  </div>
</template>

<style scoped>
.error-notice {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-status-error);
  border-left-width: 4px;
  border-radius: var(--radius-md);
  background: var(--color-status-error-bg);
  color: var(--color-text);
}

.error-notice__headline {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-weight: 600;
}

.error-notice__icon {
  color: var(--color-status-error);
}

.error-notice__message {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
}

.error-notice__code {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
}

</style>
