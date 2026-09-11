<script setup lang="ts">
/**
 * 阻断式错误提示（T030）
 *
 * 与 Toast 的分工：Toast 只承载"失败原因 / 需知短信息"，本组件承载**流程阻断**
 * （如会话加载失败、流式失败），因此提供 `retry` 出口。
 *
 * 文案一律经 `toUserMessage` 映射（V-12）：不直接展示后端 `message`。
 */
import { computed } from 'vue'

import type { ErrorInfo } from '../../api/types'
import { toUserMessage, type ErrorMessageContext } from '../../utils/error-message'

const props = withDefaults(
  defineProps<{
    /** 归一化后的错误信息 */
    error: ErrorInfo
    /** 重试按钮文案；传 `null` 则不展示重试入口 */
    retryLabel?: string | null
    /** 文案场景（同码不同义时决定措辞） */
    context?: ErrorMessageContext
  }>(),
  { retryLabel: '重试', context: 'default' },
)

const emit = defineEmits<{ retry: [] }>()

const message = computed(() => toUserMessage(props.error, props.context))
</script>

<template>
  <div class="error-notice" role="alert">
    <p class="error-notice__message">{{ message }}</p>
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

.error-notice__retry {
  padding: var(--space-1) var(--space-3);
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
