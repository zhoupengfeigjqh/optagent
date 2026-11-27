<script setup lang="ts">
import { computed } from 'vue'

import type { ThreadSource } from '../../api/types'
import { formatDateTime } from '../../utils/schedule-format'
import BaseIcon from '../common/BaseIcon.vue'

const props = defineProps<{ source: ThreadSource }>()

const triggeredAt = computed(() => formatDateTime(props.source.triggered_at))
</script>

<template>
  <p class="source-notice" role="status">
    <BaseIcon name="schedule" :size="14" class="source-notice__icon" />
    <span>
      由定时任务「{{ source.task_name }}」于 {{ triggeredAt }} 触发
    </span>
  </p>
</template>

<style scoped>
.source-notice {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0 var(--space-5) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.source-notice__icon {
  color: var(--color-primary);
}
</style>
