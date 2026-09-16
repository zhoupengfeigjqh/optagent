<script setup lang="ts">
/**
 * 空态：明确区分"没有数据"与"加载失败"（两者都必须给出可读原因）。
 */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <div class="empty-state" role="status">
    <p class="empty-state__title">{{ title }}</p>
    <p v-if="description" class="empty-state__description">{{ description }}</p>
    <div v-if="$slots.default" class="empty-state__action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--color-text-secondary);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.empty-state__title {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
}

.empty-state__description {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
}

.empty-state__action {
  margin-top: var(--space-4);
}
</style>
