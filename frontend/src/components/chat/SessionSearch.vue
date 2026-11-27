<script setup lang="ts">
import { computed } from 'vue'

import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    keyword?: string
    total?: number
    activeIndex?: number
  }>(),
  { open: false, keyword: '', total: 0, activeIndex: -1 },
)

const emit = defineEmits<{
  'update:keyword': [value: string]
  next: []
  close: []
}>()

const hasKeyword = computed(() => props.keyword.trim() !== '')
const noResult = computed(() => hasKeyword.value && props.total === 0)
const positionText = computed(
  () => `第 ${props.activeIndex < 0 ? 0 : props.activeIndex + 1} / 共 ${props.total} 项`,
)

function onInput(event: Event): void {
  emit('update:keyword', (event.target as HTMLInputElement).value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('next')
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div v-if="open" class="session-search" role="search">
    <BaseIcon name="search" :size="16" />

    <input
      class="session-search__input"
      type="search"
      :value="keyword"
      placeholder="搜索本会话内容"
      aria-label="搜索本会话内容"
      @input="onInput"
      @keydown="onKeydown"
    />

    <p class="session-search__status" aria-live="polite">
      <template v-if="noResult">无匹配结果</template>
      <template v-else-if="hasKeyword">{{ positionText }}</template>
      <template v-else>输入关键词开始搜索</template>
    </p>

    <BaseButton size="sm" variant="secondary" :disabled="total === 0" @click="emit('next')">
      下一个
    </BaseButton>

    <BaseButton size="sm" variant="ghost" aria-label="关闭搜索" @click="emit('close')">
      <BaseIcon name="close" :size="14" />
    </BaseButton>
  </div>
</template>

<style scoped>
.session-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}

.session-search__input {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
}

.session-search__status {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
