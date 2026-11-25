<script setup lang="ts">
/** 管理台常驻一级页签；当前项使用 `aria-current` 标记。 */
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
  margin: 0 calc(-1 * var(--space-5));
  padding: 0 var(--space-5);
  background: #f2f3f5;
  border-bottom: 1px solid #e8e9eb;
  overflow-x: auto;
}

.primary-nav__list {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: max-content;
}

.primary-nav__item {
  padding: 14px 18px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 15px;
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

@media (max-width: 640px) {
  .primary-nav {
    margin: 0 calc(-1 * var(--space-4));
    padding: 0 var(--space-4);
  }

  .primary-nav__item {
    padding: 13px 12px;
    font-size: var(--font-size-md);
  }
}
</style>
