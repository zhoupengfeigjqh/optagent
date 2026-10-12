/**
 * 单测：`@` 面板的坐标计算（纯几何）。
 *
 * 守住的语义：紧贴锚点**右侧**；右侧放不下翻**左侧**；两侧都放不下夹取进视口；
 * 垂直方向不出视口；测不到光标（`preferRight=false`）时退化为「贴锚点下方」。
 */
import { describe, expect, it } from 'vitest'

import { placePopup, type PopupRect } from './popup-position'

const VIEWPORT = { width: 1000, height: 600 }
const SIZE = { width: 300, height: 200 }

/** 造一个矩形：`left`/`top` 为左上角，`width`/`height` 缺省时是零宽的一行光标。 */
function rect(left: number, top: number, width = 0, height = 20): PopupRect {
  return { left, top, right: left + width, bottom: top + height }
}

describe('placePopup —— 紧贴右侧优先', () => {
  it('右侧放得下：左边缘 = 锚点右缘 + 间隙，上边缘与锚点同高', () => {
    expect(placePopup(rect(100, 200), SIZE, VIEWPORT)).toEqual({
      left: 106,
      top: 200,
      side: 'right',
    })
  })

  it('右侧放不下：翻到锚点左侧', () => {
    const place = placePopup(rect(900, 200), SIZE, VIEWPORT)

    expect(place.side).toBe('left')
    expect(place.left).toBe(900 - SIZE.width - 6)
  })

  it('两侧都放不下（视口比面板还窄）：夹取到左边界，仍报右侧语义', () => {
    const place = placePopup(rect(150, 200), SIZE, { width: 200, height: 600 })

    expect(place.side).toBe('right')
    expect(place.left).toBe(8)
  })
})

describe('placePopup —— 垂直方向', () => {
  it('锚点靠近底部时上收，不越过下边界', () => {
    expect(placePopup(rect(100, 570), SIZE, VIEWPORT).top).toBe(VIEWPORT.height - SIZE.height - 8)
  })

  it('锚点在视口上方（负坐标）时落到上边界', () => {
    expect(placePopup(rect(100, -30), SIZE, VIEWPORT).top).toBe(8)
  })
})

describe('placePopup —— 降级', () => {
  it('preferRight=false 时退化为「贴锚点下方」', () => {
    const place = placePopup(rect(120, 300, 200, 24), SIZE, VIEWPORT, false)

    expect(place).toEqual({ left: 120, top: 330, side: 'below' })
  })

  it('降级仍受视口夹取约束', () => {
    const place = placePopup(rect(980, 580, 200, 24), SIZE, VIEWPORT, false)

    expect(place.left).toBe(VIEWPORT.width - SIZE.width - 8)
    expect(place.top).toBe(VIEWPORT.height - SIZE.height - 8)
  })
})
