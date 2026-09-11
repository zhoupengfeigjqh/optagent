<script setup lang="ts">
/**
 * 全局提示宿主（T031）
 *
 * 只负责渲染与派发意图，队列与计时由 `useToast` 承载（D14）。
 * 容器 `aria-live="polite"`，同一时刻最多展示 `TOAST_MAX_VISIBLE` 条。
 */
import { computed } from 'vue'

import { TOAST_MAX_VISIBLE } from '../../constants/limits'
import type { ToastItem } from '../../composables/useToast'
import BaseIcon from './BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 待展示的提示列表 */
    items?: ToastItem[]
  }>(),
  { items: () => [] },
)

const emit = defineEmits<{
  dismiss: [id: string]
  action: [id: string]
}>()

/** 兜底截断：即使上游未限制容量，也不会渲染超过上限的条目。 */
const visible = computed(() => props.items.slice(0, TOAST_MAX_VISIBLE))
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <ul class="toast-host__list">
      <li
        v-for="item in visible"
        :key="item.id"
        class="toast-host__item"
        :class="`toast-host__item--${item.level}`"
      >
        <span class="toast-host__text">{{ item.text }}</span>
        <button
          v-if="item.action"
          type="button"
          class="toast-host__action"
          @click="emit('action', item.id)"
        >
          {{ item.action.label }}
        </button>
        <button
          type="button"
          class="toast-host__close"
          aria-label="关闭提示"
          @click="emit('dismiss', item.id)"
        >
          <BaseIcon name="close" :size="14" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-5);
  bottom: var(--space-5);
  z-index: var(--z-index-toast);
  width: min(360px, calc(100vw - var(--space-5) * 2));
}

.toast-host__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.toast-host__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-status-pending);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 6px 18px rgb(15 20 30 / 12%);
  font-size: var(--font-size-sm);
}

.toast-host__item--success {
  border-left-color: var(--color-status-success);
  background: var(--color-status-success-bg);
}

.toast-host__item--error {
  border-left-color: var(--color-status-error);
  background: var(--color-status-error-bg);
}

.toast-host__text {
  flex: 1;
  line-height: 1.5;
}

.toast-host__action,
.toast-host__close {
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.toast-host__action {
  padding: 0 var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-primary);
}

.toast-host__close {
  display: inline-flex;
  padding: var(--space-1);
}
</style>
