<script setup lang="ts">
/**
 * 空状态占位（T028）
 *
 * 用于"无会话 / 无搜索结果 / 未选择文件"等场景；操作入口经 `action` 插槽注入。
 */
withDefaults(
  defineProps<{
    /** 主标题 */
    title: string
    /** 补充说明 */
    description?: string
  }>(),
  { description: '' },
)
</script>

<template>
  <section class="empty-state">
    <h2 class="empty-state__title">{{ title }}</h2>
    <p v-if="description" class="empty-state__description">{{ description }}</p>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-7) var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.empty-state__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}

.empty-state__description {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.empty-state__action {
  margin-top: var(--space-2);
}
</style>
