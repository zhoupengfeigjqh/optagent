/**
 * 测「`@` 之后的光标」在**视口坐标系**里的位置（2026-10-12）。
 *
 * 做法是 mirror-div：克隆一个与输入框排版属性逐一相同的隐藏容器，把光标前的文本
 * 塞进去，末尾放一个零宽标记，读它的矩形。`<input>` 不换行、`<textarea>` 按 `pre-wrap`，
 * 因此两种控件的换行行为与真实一致；再扣掉 textarea 自身滚动量。
 *
 * 拿不到布局时（如 jsdom：`getBoundingClientRect()` 恒为 0）返回 `null`，
 * 由调用方回退为「贴锚点下方」（见 `popup-position.ts` 的 `preferRight = false`）。
 */
import type { PopupRect } from './popup-position'

/** 需要从输入框克隆到镜像上的排版属性（缺一项测量就会偏）。 */
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

/**
 * `@` 之后的光标矩形；无布局或控制台不认识该控件时返回 `null`。
 * 返回的 `left`/`right` 相同（零宽光标），即面板会紧贴光标右缘。
 */
export function caretRectOf(element: HTMLElement, caret: number): PopupRect | null {
  const field = element as HTMLInputElement | HTMLTextAreaElement
  if (typeof field.value !== 'string') return null

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
