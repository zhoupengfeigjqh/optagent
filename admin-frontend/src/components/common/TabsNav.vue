<script setup lang="ts">
/**
 * 功能区内分区（ARIA Tabs 模式，`FR-053`）。
 *
 * 承载"功能区内细分内容"，**不新增导航层级**（一级导航固定在 4 项之内）。
 * 完整键盘支持：←/→ 移动并激活、Home/End 跳到首/末项，
 * `aria-selected` 与 `aria-controls` 同步，读屏可辨当前页签。
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  tabs: Array<{ id: string; label: string }>
  modelValue: string
  /**
   * 无障碍标签：说明这组页签属于哪个功能区。
   *
   * 不命名为 `ariaLabel` 是为了避免与 ARIA 属性同名造成模板侧的属性/属性名歧义
   * （Volar 会把 `aria-label` 当作原生 ARIA 属性而不是组件 prop）。
   */
  label: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const buttons = ref<Array<HTMLButtonElement | null>>([])

const activeIndex = computed(() => Math.max(0, props.tabs.findIndex((t) => t.id === props.modelValue)))

function select(index: number): void {
  const tab = props.tabs[index]
  if (!tab) return
  emit('update:modelValue', tab.id)
  buttons.value[index]?.focus()
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const last = props.tabs.length - 1
  if (last < 0) return
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      select(index === last ? 0 : index + 1)
      break
    case 'ArrowLeft':
      event.preventDefault()
      select(index === 0 ? last : index - 1)
      break
    case 'Home':
      event.preventDefault()
      select(0)
      break
    case 'End':
      event.preventDefault()
      select(last)
      break
    default:
      break
  }
}
</script>

<template>
  <div class="tabs-nav">
    <div class="tabs-nav__list" role="tablist" :aria-label="props.label">
      <button
        v-for="(tab, index) in tabs"
        :id="`tab-${tab.id}`"
        :key="tab.id"
        :ref="(el) => (buttons[index] = el as HTMLButtonElement | null)"
        type="button"
        role="tab"
        class="tabs-nav__tab"
        :class="{ 'tabs-nav__tab--active': tab.id === modelValue }"
        :aria-selected="index === activeIndex"
        :aria-controls="`tabpanel-${tab.id}`"
        :tabindex="index === activeIndex ? 0 : -1"
        @click="select(index)"
        @keydown="onKeydown($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      :id="`tabpanel-${modelValue}`"
      role="tabpanel"
      :aria-labelledby="`tab-${modelValue}`"
      tabindex="0"
      class="tabs-nav__panel"
    >
      <slot :active="modelValue" />
    </div>
  </div>
</template>

<style scoped>
.tabs-nav__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
}

.tabs-nav__tab {
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.tabs-nav__tab--active {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
  font-weight: 600;
}

.tabs-nav__panel {
  padding-top: var(--space-4);
}
</style>
