<script setup lang="ts">
withDefaults(
  defineProps<{
    text: string
    /** 本轮进行中 / 未选数字人等场景下置灰（不可点击） */
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  select: []
}>()
</script>

<template>
  <button type="button" class="suggestion-card" :disabled="disabled" @click="emit('select')">
    <span class="suggestion-card__text">{{ text }}</span>
  </button>
</template>

<style scoped>
.suggestion-card {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  background: var(--color-surface, #fff);
  color: inherit;
  font: inherit;
  font-size: var(--font-size-sm, 13px);
  text-align: left;
  cursor: pointer;
}

.suggestion-card__text {
  line-height: var(--line-height-tight);
}

.suggestion-card:hover:not(:disabled) {
  border-color: var(--color-primary, #2f6fed);
}

.suggestion-card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
