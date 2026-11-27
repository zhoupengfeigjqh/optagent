
export interface PopupRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PopupSize {
  width: number
  height: number
}

export interface PopupViewport {
  width: number
  height: number
}

export interface PopupPlacement {
  left: number
  top: number
  side: 'right' | 'left' | 'below'
}

export interface MenuPlacement {
  left: number
  top: number
  side: 'below' | 'above'
}

const GAP = 6

const MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

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

  return { left: clamp(right, MARGIN, maxLeft), top, side: 'right' }
}

export function placeMenu(
  anchor: PopupRect,
  size: PopupSize,
  viewport: PopupViewport,
): MenuPlacement {
  const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN)
  const left = clamp(anchor.left, MARGIN, maxLeft)

  const below = anchor.bottom + GAP
  const above = anchor.top - size.height - GAP

  if (below + size.height <= viewport.height - MARGIN) {
    return { left, top: below, side: 'below' }
  }
  if (above >= MARGIN) {
    return { left, top: above, side: 'above' }
  }

  const maxTop = Math.max(MARGIN, viewport.height - size.height - MARGIN)
  return { left, top: clamp(below, MARGIN, maxTop), side: 'below' }
}
