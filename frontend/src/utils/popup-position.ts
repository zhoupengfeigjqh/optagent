/**
 * `@` 引用面板的坐标计算（纯几何，可单测，2026-10-12）。
 *
 * 规则：**紧贴锚点右侧** → 右侧放不下翻到左侧 → 两侧都放不下则夹取到视口内；
 * 垂直方向与锚点同高，超出视口时上收。
 *
 * 锚点通常是「`@` 之后的光标」的矩形（见 `caret-rect.ts`）。测不到光标时调用方
 * 改为传入锚点元素自身的矩形并令 `preferRight = false`，此处退化为「贴锚点下方」——
 * 这样降级只是位置变差，面板不会消失。
 */

/** 矩形（视口坐标系）。 */
export interface PopupRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 面板尺寸。 */
export interface PopupSize {
  width: number
  height: number
}

/** 视口尺寸。 */
export interface PopupViewport {
  width: number
  height: number
}

/** 落点：坐标 + 实际采用的方位（便于测试与排查）。 */
export interface PopupPlacement {
  left: number
  top: number
  side: 'right' | 'left' | 'below'
}

/** 面板与锚点之间的间隙。 */
const GAP = 6

/** 面板与视口边缘的最小留白。 */
const MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 计算面板落点。`preferRight` 为 false 时退化为「贴锚点下方」。 */
export function placePopup(
  anchor: PopupRect,
  size: PopupSize,
  viewport: PopupViewport,
  preferRight = true,
): PopupPlacement {
  const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN)
  const maxTop = Math.max(MARGIN, viewport.height - size.height - MARGIN)

  if (!preferRight) {
    return {
      left: clamp(anchor.left, MARGIN, maxLeft),
      top: clamp(anchor.bottom + GAP, MARGIN, maxTop),
      side: 'below',
    }
  }

  const top = clamp(anchor.top, MARGIN, maxTop)
  const right = anchor.right + GAP
  if (right <= maxLeft) return { left: right, top, side: 'right' }

  const left = anchor.left - size.width - GAP
  if (left >= MARGIN) return { left, top, side: 'left' }

  // 视口比面板还窄：两侧都放不下，夹取并保持右侧语义
  return { left: clamp(right, MARGIN, maxLeft), top, side: 'right' }
}
