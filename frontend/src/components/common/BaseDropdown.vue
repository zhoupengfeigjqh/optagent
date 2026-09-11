<script setup lang="ts">
/**
 * 下拉菜单（T027）
 *
 * 受控开合 + 键盘可达：ArrowUp/Down 循环移动（跳过禁用项）、Home/End 首尾、
 * Enter/Space 选中、Esc 关闭并归还焦点；点击组件外部同样关闭。
 *
 * 高亮索引为组件内部状态（初值取自 `activeIndex`），对外只暴露意图事件，
 * 避免把"移动高亮"这种瞬时交互细节泄漏到父级。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import BaseIcon from './BaseIcon.vue'

interface DropdownItem {
  key: string
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 菜单项 */
    items?: DropdownItem[]
    /** 初始高亮项索引 */
    activeIndex?: number
  }>(),
  { open: false, items: () => [], activeIndex: 0 },
)

const emit = defineEmits<{
  toggle: []
  select: [key: string]
  close: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const highlight = ref(props.activeIndex)

/** 可聚焦项索引（跳过禁用项）。 */
const enabledIndexes = computed(() =>
  props.items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0),
)

function focusHighlighted(): void {
  const target = menuRef.value?.querySelector<HTMLElement>(`[data-index="${highlight.value}"]`)
  target?.focus()
}

function move(delta: number): void {
  const list = enabledIndexes.value
  if (list.length === 0) {
    return
  }
  const current = list.indexOf(highlight.value)
  const next =
    current === -1
      ? delta > 0
        ? 0
        : list.length - 1
      : (current + delta + list.length) % list.length
  highlight.value = list[next]
  void nextTick(focusHighlighted)
}

function jumpTo(edge: 'first' | 'last'): void {
  const list = enabledIndexes.value
  if (list.length === 0) {
    return
  }
  highlight.value = edge === 'first' ? list[0] : list[list.length - 1]
  void nextTick(focusHighlighted)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      emit('toggle')
    }
    return
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move(-1)
      break
    case 'Home':
      event.preventDefault()
      jumpTo('first')
      break
    case 'End':
      event.preventDefault()
      jumpTo('last')
      break
    case 'Enter':
    case ' ': {
      event.preventDefault()
      const item = props.items[highlight.value]
      if (item && !item.disabled) {
        emit('select', item.key)
      }
      break
    }
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
    default:
      break
  }
}

function onItemClick(item: DropdownItem): void {
  if (item.disabled) {
    return
  }
  emit('select', item.key)
}

function onDocumentPointerDown(event: Event): void {
  const root = rootRef.value
  if (!root) {
    return
  }
  // `event.target` 可能为空（如在 document 上派发的合成事件），此时按"外部点击"处理
  const target = event.target
  if (target instanceof Node && root.contains(target)) {
    return
  }
  emit('close')
}

watch(
  () => props.activeIndex,
  (value) => {
    highlight.value = value
  },
)

watch(
  () => props.open,
  (value) => {
    if (typeof document === 'undefined') {
      return
    }
    if (value) {
      highlight.value = props.activeIndex
      document.addEventListener('pointerdown', onDocumentPointerDown)
      void nextTick(focusHighlighted)
      return
    }
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    triggerRef.value?.focus()
  },
  // 挂载时若已是展开态（如受控初值），同样需要登记外部点击监听
  { immediate: true },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
  }
})
</script>

<template>
  <div ref="rootRef" class="base-dropdown" @keydown="onKeydown">
    <button
      ref="triggerRef"
      type="button"
      class="base-dropdown__trigger"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click="emit('toggle')"
    >
      <span class="base-dropdown__trigger-label">
        <slot name="trigger" />
      </span>
      <BaseIcon name="chevron-down" :size="16" />
    </button>

    <ul v-if="open" ref="menuRef" class="base-dropdown__menu" role="menu">
      <li v-for="(item, index) in items" :key="item.key" role="none">
        <button
          type="button"
          role="menuitem"
          class="base-dropdown__item"
          :class="{ 'base-dropdown__item--active': index === highlight }"
          :data-index="index"
          :disabled="item.disabled"
          :aria-disabled="item.disabled ? 'true' : undefined"
          :tabindex="index === highlight ? 0 : -1"
          @click="onItemClick(item)"
        >
          {{ item.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.base-dropdown {
  position: relative;
  display: inline-block;
}

.base-dropdown__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
}

.base-dropdown__menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: var(--z-index-dropdown);
  min-width: 180px;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(15 20 30 / 14%);
}

.base-dropdown__item {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.base-dropdown__item--active,
.base-dropdown__item:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.base-dropdown__item:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}
</style>
