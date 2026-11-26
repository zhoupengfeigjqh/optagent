<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { caretRectOf } from '../../utils/caret-rect'
import { placePopup, type PopupRect } from '../../utils/popup-position'

const props = withDefaults(
  defineProps<{
    open: boolean
    anchor?: HTMLElement | null
    caret?: number | null
  }>(),
  { anchor: null, caret: null },
)

const emit = defineEmits<{ (e: 'close'): void }>()

const root = ref<HTMLElement | null>(null)
let frame = 0
let observer: ResizeObserver | null = null

/** 光标下标：优先用调用方给的（状态机记录的那次），否则读控件当前值。 */
function currentCaret(anchor: HTMLElement): number {
  if (typeof props.caret === 'number') return props.caret
  const field = anchor as HTMLInputElement | HTMLTextAreaElement
  if (typeof field.selectionStart === 'number') return field.selectionStart
  return (field.value ?? '').length
}

function anchorRect(anchor: HTMLElement): PopupRect {
  const rect = anchor.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function reposition(): void {
  const popup = root.value
  const anchor = props.anchor
  if (!popup || !anchor) return

  const caret = caretRectOf(anchor, currentCaret(anchor))
  const place = placePopup(
    caret ?? anchorRect(anchor),
    { width: popup.offsetWidth, height: popup.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
    caret !== null,
  )
  popup.style.left = `${place.left}px`
  popup.style.top = `${place.top}px`
  popup.dataset.side = place.side
}

function schedule(): void {
  if (!props.open) return
  cancelFrame(frame)
  frame = nextFrame(reposition)
}

function nextFrame(callback: () => void): number {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : window.setTimeout(callback, 0)
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else window.clearTimeout(handle)
}

/** 焦点在面板内时也要能关；且不能把 Esc 漏给所在 `<dialog>`（原生关闭请求由 Esc keydown 触发）。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

watch(
  () => [props.open, props.anchor, props.caret] as const,
  async ([open]) => {
    if (!open) return
    await nextTick()
    reposition()
  },
  { immediate: true },
)

watch(root, (element) => {
  observer?.disconnect()
  if (element) observer?.observe(element)
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(schedule)
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  if (props.open) schedule()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('scroll', schedule, true)
  window.removeEventListener('resize', schedule)
  cancelFrame(frame)
})
</script>

<template>
  <div v-if="open" ref="root" class="mention-popup" @keydown="onKeydown">
    <slot />
  </div>
</template>

<style scoped>
.mention-popup {
  position: fixed;
  inset: auto;
  z-index: 60;
  width: max-content;
  max-width: min(560px, calc(100vw - 16px));
}
</style>
