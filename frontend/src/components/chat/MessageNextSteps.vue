<script setup lang="ts">
import type { NextStepAction } from '../../api/types'
import { NEXT_STEPS_GUIDE_TEXT } from '../../utils/next-steps'
import SuggestionCard from './SuggestionCard.vue'

withDefaults(
  defineProps<{
    actions?: NextStepAction[]
    /** 本轮进行中 / 不可发送时置灰卡片 */
    disabled?: boolean
  }>(),
  { actions: () => [], disabled: false },
)

const emit = defineEmits<{
  select: [action: NextStepAction]
}>()
</script>

<template>
  <section v-if="actions.length > 0" class="next-steps" aria-label="下一步动作">
    <p class="next-steps__guide">{{ NEXT_STEPS_GUIDE_TEXT }}</p>
    <ul class="next-steps__list" aria-label="下一步动作列表">
      <li v-for="(action, index) in actions" :key="index">
        <SuggestionCard
          :text="action.prompt"
          :disabled="disabled"
          :data-test="`next-step-${index}`"
          @select="emit('select', action)"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* 出现动效随系统偏好降级：不做"淡入"也不影响功能 */
@media (prefers-reduced-motion: no-preference) {
  .next-steps {
    animation: next-steps-in 160ms ease-out;
  }
}

@keyframes next-steps-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.next-steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.next-steps__guide {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.next-steps__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  /* **单列**（2026-10-12 产品口径）：一行一张、可以多行，MUST NOT 一行多个——
     与首屏问题实例（多列紧凑）刻意不同；两处共用同一枚卡片（FR-012），栅格各自定义 */
  grid-template-columns: 1fr;
  gap: var(--space-2);
}
</style>
