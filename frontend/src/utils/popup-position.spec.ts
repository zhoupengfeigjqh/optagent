/**
 * 单测：弹层坐标计算（纯几何）。
 *
 * `placePopup`（`@` 面板）：紧贴锚点**右侧**；右侧放不下翻**左侧**；两侧都放不下夹取进视口；
 * 垂直方向不出视口；测不到光标（`preferRight=false`）时退化为「贴锚点下方」。
 *
 * `placeMenu`（下拉菜单，2026-10-13）：优先**下方**；下方放不下翻**上方**；上下都放不下夹进视口；
 * 水平方向越界一律夹取 —— 底部工具栏（模型选择）因此向上弹，且左右永不溢出。
 */
import { describe, expect, it } from 'vitest'

import { placeMenu, placePopup, type PopupRect } from './popup-position'

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

describe('placeMenu —— 上下方位（2026-10-13）', () => {
  it('下方放得下：紧贴触发器下缘（含间隙），水平左对齐触发器', () => {
    expect(placeMenu(rect(120, 300, 200, 24), SIZE, VIEWPORT)).toEqual({
      left: 120,
      top: 330,
      side: 'below',
    })
  })

  it('底部工具栏：下方放不下 ⇒ 翻到**上方**，不盖住触发器', () => {
    // 触发器贴底（600 高视口里的 y=552~580），200 高菜单下方只剩 20px
    const place = placeMenu(rect(120, 552, 200, 28), SIZE, VIEWPORT)

    expect(place.side).toBe('above')
    expect(place.top).toBe(552 - SIZE.height - 6)
  })

  it('上下都放不下（菜单高于视口可用高度）⇒ 整块夹进视口，绝不跑到屏幕外', () => {
    const tall = { width: 300, height: 700 }
    const place = placeMenu(rect(120, 300, 200, 24), tall, VIEWPORT)

    expect(place.top).toBe(8)
    expect(place.top).toBeGreaterThanOrEqual(8)
  })
})

describe('placeMenu —— 水平方向永不溢出', () => {
  it('触发器靠近右缘：菜单左移夹取，右边缘不越出视口', () => {
    const place = placeMenu(rect(900, 100, 100, 28), SIZE, VIEWPORT)

    expect(place.left).toBe(VIEWPORT.width - SIZE.width - 8)
    expect(place.left + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width - 8)
  })

  it('触发器靠近左缘：夹取到左边界', () => {
    expect(placeMenu(rect(-40, 100, 100, 28), SIZE, VIEWPORT).left).toBe(8)
  })

  it('视口比菜单还窄：仍夹进视口（左边界优先）', () => {
    expect(placeMenu(rect(10, 100, 80, 28), SIZE, { width: 200, height: 600 }).left).toBe(8)
  })
})
