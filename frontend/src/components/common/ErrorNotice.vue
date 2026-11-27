<script setup lang="ts">
import { computed } from 'vue'

import type { ErrorInfo } from '../../api/types'
import {
  formatErrorDiagnostics,
  toUserMessage,
  type ErrorMessageContext,
} from '../../utils/error-message'

const props = withDefaults(
  defineProps<{
    error: ErrorInfo
    retryLabel?: string | null
    context?: ErrorMessageContext
    hint?: string | null
  }>(),
  { retryLabel: '重试', context: 'default', hint: null },
)

const emit = defineEmits<{ retry: [] }>()

const message = computed(() => toUserMessage(props.error, props.context))

const diagnostics = computed(() => formatErrorDiagnostics(props.error))
</script>

<template>
  <div class="error-notice" role="alert">
    <p class="error-notice__message">{{ message }}</p>
    <p v-if="hint" class="error-notice__hint">{{ hint }}</p>
    <p v-if="diagnostics" class="error-notice__diagnostics">{{ diagnostics }}</p>
    <button
      v-if="retryLabel !== null"
      type="button"
      class="error-notice__retry"
      @click="emit('retry')"
    >
      {{ retryLabel }}
    </button>
  </div>
</template>

<style scoped>
.error-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-status-error);
  border-radius: var(--radius-md);
  background: var(--color-status-error-bg);
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.error-notice__message {
  flex: 1 1 200px;
}

.error-notice__hint {
  flex: 1 1 100%;
  color: var(--color-text-secondary);
}

.error-notice__diagnostics {
  flex: 1 1 100%;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.error-notice__retry {
  padding: var(--space-1) var(--space-3);
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
