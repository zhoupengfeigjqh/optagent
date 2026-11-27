
import { computed, onBeforeUnmount, ref, type CSSProperties, type ComputedRef, type Ref } from 'vue'

/** 面板宽度下限（px） */
export const PANEL_MIN_WIDTH = 280

/** 面板宽度上限的绝对封顶（px） */
export const PANEL_MAX_WIDTH = 1300

/** 左栏 + 中栏需保留的最小宽度（px），用于推算上限 */
export const PANEL_RESERVED_WIDTH = 520

export const PANEL_KEY_STEP = 16

export const PANEL_KEY_STEP_LARGE = 64

export const PANEL_WIDTH_VAR = '--layout-preview-width'

/**
 * 宽度收敛：夹在 `[下限, 上限]` 之间。
 * 上限取「绝对封顶」与「容器宽 - 保留宽」的较小值；容器宽未知（≤0）时按绝对封顶。
 */
export function clampPanelWidth(value: number, containerWidth: number): number {
  const available = containerWidth > 0 ? containerWidth - PANEL_RESERVED_WIDTH : PANEL_MAX_WIDTH
  const upper = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, available))
  return Math.min(Math.max(value, PANEL_MIN_WIDTH), upper)
}

export interface ResizablePanelDeps {
  /** 栅格容器元素（用于推算上限） */
  container: () => HTMLElement | null
  panel: () => HTMLElement | null
}

export interface ResizablePanelStore {
  width: Ref<number | null>
  resizing: Ref<boolean>
  style: ComputedRef<CSSProperties>
  onPointerDown(event: PointerEvent): void
  onKeydown(event: KeyboardEvent): void
}

export function useResizablePanel(deps: ResizablePanelDeps): ResizablePanelStore {
  const width = ref<number | null>(null)
  const resizing = ref(false)
  let cleanup: (() => void) | null = null

  const style = computed<CSSProperties>(() =>
    width.value === null ? {} : ({ [PANEL_WIDTH_VAR]: `${width.value}px` } as CSSProperties),
  )

  function containerWidth(): number {
    return deps.container()?.getBoundingClientRect().width ?? 0
  }

  function panelWidth(): number {
    return deps.panel()?.getBoundingClientRect().width ?? 0
  }

  function apply(value: number): void {
    width.value = clampPanelWidth(value, containerWidth())
  }

  function stop(): void {
    resizing.value = false
    cleanup?.()
    cleanup = null
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    const startWidth = panelWidth()
    // 面板尚未布局（宽度为 0）时不进入拖动，避免以错误基准计算
    if (startWidth <= 0) {
      return
    }

    event.preventDefault()
    const startX = event.clientX
    resizing.value = true

    const target = event.currentTarget as HTMLElement | null
    if (typeof target?.setPointerCapture === 'function') {
      target.setPointerCapture(event.pointerId)
    }

    const onMove = (move: PointerEvent): void => {
      apply(startWidth - (move.clientX - startX))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? PANEL_KEY_STEP_LARGE : PANEL_KEY_STEP
    let delta: number
    if (event.key === 'ArrowLeft') {
      delta = step
    } else if (event.key === 'ArrowRight') {
      delta = -step
    } else {
      return
    }

    event.preventDefault()
    apply((width.value ?? panelWidth()) + delta)
  }

  onBeforeUnmount(stop)

  return { width, resizing, style, onPointerDown, onKeydown }
}
