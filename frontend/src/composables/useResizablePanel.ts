/**
 * 右栏「文件空间」面板的可拖动宽度（FR-002）
 *
 * 拖动面板左缘的分隔条调整宽度：指针左移变宽、右移变窄。
 * - 尚未手动调整时宽度为 `null`，沿用 CSS 默认比例（`--layout-preview-ratio` ≈ 1/3）
 * - 一旦调整即固定为像素值，窗口后续缩放不再改变面板宽度（手动尺寸优先）
 * - 宽度收敛在 `[PANEL_MIN_WIDTH, min(PANEL_MAX_WIDTH, 容器宽 - PANEL_RESERVED_WIDTH)]`，
 *   避免面板被拖没或把中栏挤到不可用
 * - 分隔条支持键盘（← 变宽 / → 变窄，Shift 加速），并具备 `separator` 语义
 */

import { computed, onBeforeUnmount, ref, type CSSProperties, type ComputedRef, type Ref } from 'vue'

/** 面板宽度下限（px） */
export const PANEL_MIN_WIDTH = 280

/** 面板宽度上限的绝对封顶（px） */
export const PANEL_MAX_WIDTH = 960

/** 左栏 + 中栏需保留的最小宽度（px），用于推算上限 */
export const PANEL_RESERVED_WIDTH = 520

/** 键盘调整步长（px） */
export const PANEL_KEY_STEP = 16

/** 键盘调整大步长（px，按住 Shift） */
export const PANEL_KEY_STEP_LARGE = 64

/** 注入到容器的宽度变量名 */
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

/** 构造参数：以取值函数注入 DOM，便于测试替换。 */
export interface ResizablePanelDeps {
  /** 栅格容器元素（用于推算上限） */
  container: () => HTMLElement | null
  /** 被调整的面板元素 */
  panel: () => HTMLElement | null
}

/** 可拖动面板契约。 */
export interface ResizablePanelStore {
  /** 手动宽度（px）；`null` = 尚未手动调整，沿用默认比例 */
  width: Ref<number | null>
  /** 是否正在拖动 */
  resizing: Ref<boolean>
  /** 绑定到容器的行内样式（注入宽度变量） */
  style: ComputedRef<CSSProperties>
  /** 分隔条 `pointerdown` */
  onPointerDown(event: PointerEvent): void
  /** 分隔条 `keydown`（← / → 调整） */
  onKeydown(event: KeyboardEvent): void
}

/** 创建可拖动面板状态（需在组件 `setup` 内调用，卸载时自动清理监听）。 */
export function useResizablePanel(deps: ResizablePanelDeps): ResizablePanelStore {
  const width = ref<number | null>(null)
  const resizing = ref(false)
  /** 拖动中挂在 window 上的监听清理函数；未拖动时为 `null` */
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
      // 面板在右侧：指针左移 → 面板变宽
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
    // 未手动调整过时，以默认比例下的实际宽度为基准
    apply((width.value ?? panelWidth()) + delta)
  }

  onBeforeUnmount(stop)

  return { width, resizing, style, onPointerDown, onKeydown }
}
