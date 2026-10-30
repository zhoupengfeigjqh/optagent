<script setup lang="ts">
/**
 * 会话来源提示（015，T043）
 *
 * 打开一个定时任务产生的会话时，在消息流顶部说明"这条对话是谁在什么时候触发的"。
 *
 * `role="status"`（礼貌级播报）：进入会话时播报一次即可——本组件随会话切换挂载、
 * 卸载，不会反复重播；**不用** `aria-live="assertive"`，那会打断用户正在听的回答。
 */
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
