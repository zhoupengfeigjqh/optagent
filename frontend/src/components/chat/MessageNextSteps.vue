<script setup lang="ts">
/**
 * 下一步动作提示容器（007）：固定引导句 + 卡片列表。
 *
 * 位置由父级（`MessageBubble`）决定：在**回答正文之后**（FR-010），与工具记录、视图入口同层。
 *
 * 两条硬约束：
 * - **无卡片时 MUST NOT 渲染任何 DOM**（FR-014）：连容器带间距一起消失，
 *   回答区布局与未开启该功能时逐字一致。故 `v-if` 挂在根节点上，不是"渲染空 `<ul>`"。
 * - **引导句由界面固定渲染**（FR-011）：`您接下来可以操作以下动作，请选择` 是 UI 常量，
 *   MUST NOT 取自模型输出——模型说什么都改不了它。
 */
import type { AgentStarter } from '../../api/types'
import { NEXT_STEPS_GUIDE_TEXT } from '../../utils/next-steps'
import SuggestionCard from './SuggestionCard.vue'

withDefaults(
  defineProps<{
    /** 归属于本轮的卡片（空数组 = 整块不渲染） */
    actions?: AgentStarter[]
    /** 本轮进行中 / 不可发送时置灰卡片 */
    disabled?: boolean
  }>(),
  { actions: () => [], disabled: false },
)

const emit = defineEmits<{
  /** 点选某张卡片；确认与发送由上层（ChatPanel）决定 */
  select: [action: AgentStarter]
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
