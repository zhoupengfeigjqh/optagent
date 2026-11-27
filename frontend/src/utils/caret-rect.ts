import type { PopupRect } from './popup-position'

const MIRRORED_STYLE_NAMES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'text-indent',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'box-sizing',
]

/** 兜底行高（`line-height: normal` 时 `marker` 可能量不到高度）。 */
const FALLBACK_LINE_HEIGHT = 18

function selectionRectOf(element: HTMLElement): PopupRect | null {
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return null

  const box = range.getBoundingClientRect()
  if ((box.width === 0 && box.height === 0) || box.height <= 0) return null
  return { left: box.left, top: box.top, right: box.left, bottom: box.top + box.height }
}

export function caretRectOf(element: HTMLElement, caret: number): PopupRect | null {
  const field = element as HTMLInputElement | HTMLTextAreaElement
  if (typeof field.value !== 'string') return selectionRectOf(element)

  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const styles = getComputedStyle(element)
  const mirror = document.createElement('div')
  mirror.style.cssText = MIRRORED_STYLE_NAMES.map(
    (name) => `${name}:${styles.getPropertyValue(name)}`,
  ).join(';')
  mirror.style.position = 'fixed'
  mirror.style.left = `${rect.left}px`
  mirror.style.top = `${rect.top}px`
  mirror.style.width = `${element.offsetWidth}px`
  mirror.style.height = 'auto'
  mirror.style.whiteSpace = element.tagName === 'INPUT' ? 'pre' : 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'

  mirror.textContent = field.value.slice(0, Math.max(0, caret))
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const markerRect = marker.getBoundingClientRect()
  const parsedLineHeight = Number.parseFloat(styles.lineHeight)
  mirror.remove()

  const lineHeight =
    markerRect.height > 0
      ? markerRect.height
      : Number.isFinite(parsedLineHeight)
        ? parsedLineHeight
        : FALLBACK_LINE_HEIGHT
  const top = markerRect.top - (field.scrollTop || 0)

  return { left: markerRect.left, top, right: markerRect.left, bottom: top + lineHeight }
}
