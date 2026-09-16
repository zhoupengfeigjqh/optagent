<script setup lang="ts">
/**
 * 常驻一级导航（`FR-053`）。
 *
 * - 固定 **4 项**，常驻可见，**不因内部状态禁用**；
 * - 当前项标 `aria-current="page"`，读屏可辨；
 * - 完整键盘可达（原生 `<button>` + 可见焦点环）。
 */
import { NAV_ITEMS, type RouteName } from '../../router'

defineProps<{
  current: RouteName
}>()

const emit = defineEmits<{
  (e: 'navigate', name: RouteName): void
}>()
</script>

<template>
  <nav class="primary-nav" aria-label="管理平台一级导航">
    <ul class="primary-nav__list">
      <li v-for="item in NAV_ITEMS" :key="item.name">
        <button
          type="button"
          class="primary-nav__item"
          :class="{ 'primary-nav__item--active': item.name === current }"
          :aria-current="item.name === current ? 'page' : undefined"
          :data-route="item.name"
          @click="emit('navigate', item.name)"
        >
          {{ item.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.primary-nav {
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}

.primary-nav__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0 var(--space-4);
  list-style: none;
}

.primary-nav__item {
  padding: var(--space-3) var(--space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
  cursor: pointer;
}

.primary-nav__item:hover {
  color: var(--color-text);
}

.primary-nav__item--active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}
</style>
