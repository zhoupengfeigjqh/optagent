<script setup lang="ts">
/**
 * `@` 引用面板的浮层外壳（2026-10-12）。
 *
 * 为什么是 `fixed` 而不是 `absolute`：面板所在的祖先里有滚动容器
 * （`.base-dialog__body` 的 `overflow-y: auto`、表格的 `overflow-x: auto`），
 * absolute 会被裁断；而 `fixed` 的包含块是**视口**，逃逸祖先裁剪。
 *
 * 为什么**不搬动 DOM**（不 Teleport、不用 Popover）：面板留在原组件的 DOM 位置，
 * 于是它仍在 `<dialog>` 子树内——`showModal()` 的 `inert` 不会拦住它的点击，
 * 也就不会出现"看得见、点不动"；同时省掉了宿主推导与 top layer 提升。
 *
 * 约束（改样式时务必注意）：面板的祖先 MUST NOT 含 `transform` / `filter` /
 * `will-change` / `contain` / `perspective`，否则 `fixed` 的包含块会变成该祖先，
 * 定位会全乱。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { caretRectOf } from '../../utils/caret-rect'
import { placePopup, type PopupRect } from '../../utils/popup-position'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open: boolean
    /** 锚点：贴着它的光标右侧弹出（承载 `@` 的输入框本体） */
    anchor?: HTMLElement | null
    /** `@` 之后的光标下标；缺省时读锚点当前的 `selectionStart` */
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

/** 锚点元素自身的矩形：测不到光标时退化成"贴锚点下方"的锚点。 */
function anchorRect(anchor: HTMLElement): PopupRect {
  const rect = anchor.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** 立即按当前光标与面板尺寸重算坐标。 */
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

/** 合帧重算：滚动与内容变化可能在同一帧内触发多次。 */
function schedule(): void {
  if (!props.open) return
  cancelFrame(frame)
  frame = nextFrame(reposition)
}

/** 环境没有 rAF 时退化为定时器（浏览器都有，测试环境未必）。 */
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

/** 面板内容异步变化（如文件空间加载完成）会改尺寸，尺寸变了要重算。 */
watch(root, (element) => {
  observer?.disconnect()
  if (element) observer?.observe(element)
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(schedule)
  // capture：滚动可能发生在任意祖先（弹窗 body、表格容器）上
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
  /* 坐标完全由脚本写 left/top，这里显式清掉可能继承来的 inset */
  inset: auto;
  z-index: 60;
  width: max-content;
  max-width: min(560px, calc(100vw - 16px));
}
</style>
