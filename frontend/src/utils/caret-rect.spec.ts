/**
 * 单测：`@` 之后的光标测量（mirror-div）。
 *
 * 守住的语义：非输入控件与"无布局"环境（jsdom 的 `getBoundingClientRect()` 恒为 0）
 * 一律返回 `null`，由调用方降级为"贴锚点下方"——因此这两条**降级路径**必须有覆盖。
 * 真实几何量不到（jsdom 无排版），故用可控的 marker 矩形代替。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { caretRectOf } from './caret-rect'

const MARKER = { left: 240, top: 132, right: 240, bottom: 150 }

function fakeRect(rect: { left: number; top: number; right: number; bottom: number }): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    toJSON: () => rect,
    ...rect,
  } as DOMRect
}

/** 造一个"有布局"的输入框（自身矩形可控）。 */
function mountField(tag: 'input' | 'textarea'): HTMLInputElement | HTMLTextAreaElement {
  const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
  field.value = '数据准备/@产'
  field.getBoundingClientRect = (): DOMRect =>
    fakeRect({ left: 100, top: 120, right: 400, bottom: 160 })
  document.body.appendChild(field)
  return field
}

/** 让镜像里的零宽 marker 报出可控矩形（其余元素保持真实）。 */
function stubMarkerRect(rect: typeof MARKER = MARKER): void {
  const original = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = original(tag) as HTMLElement
    if (tag === 'span') element.getBoundingClientRect = (): DOMRect => fakeRect(rect)
    return element
  }) as typeof document.createElement)
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('caretRectOf —— 降级路径', () => {
  it('非输入控件（拿不到 value）返回 null', () => {
    expect(caretRectOf(document.createElement('div'), 0)).toBeNull()
  })

  it('无布局（矩形全 0，jsdom 常态）返回 null，交给调用方贴锚点下方', () => {
    const field = document.createElement('input')
    field.value = '@'

    expect(caretRectOf(field, 1)).toBeNull()
  })
})

describe('caretRectOf —— 镜像测量', () => {
  it('返回零宽光标矩形（左右边同一点，面板因此紧贴光标右缘）', () => {
    const field = mountField('input')
    stubMarkerRect()

    expect(caretRectOf(field, 5)).toEqual({
      left: MARKER.left,
      top: MARKER.top,
      right: MARKER.left,
      bottom: MARKER.bottom,
    })
  })

  it('扣除 textarea 自身的滚动量（滚动后光标在视口里的位置要上移）', () => {
    const field = mountField('textarea')
    Object.defineProperty(field, 'scrollTop', { value: 12, configurable: true })
    stubMarkerRect()

    expect(caretRectOf(field, 5)?.top).toBe(MARKER.top - 12)
  })

  it('测量用的镜像节点用完即清（不留 DOM 垃圾）', () => {
    const field = mountField('input')
    const before = document.body.children.length

    caretRectOf(field, 2)

    expect(document.body.children.length).toBe(before)
  })

  it('沿用了镜像矩形的高度（量得到高度时不走兜底行高）', () => {
    const field = mountField('input')
    stubMarkerRect()

    const rect = caretRectOf(field, 5)

    expect(rect!.bottom - rect!.top).toBe(MARKER.bottom - MARKER.top)
  })

  it('量不到高度且 line-height:normal → 用兜底行高，矩形仍有可见高度', () => {
    const field = mountField('input')
    // marker 高度为 0（`line-height: normal` 时的真实情况），jsdom 的 computed line-height 也是 'normal'
    stubMarkerRect({ left: MARKER.left, top: MARKER.top, right: MARKER.left, bottom: MARKER.top })

    const rect = caretRectOf(field, 5)

    expect(rect!.bottom - rect!.top).toBe(18)
  })

  it('未滚动（scrollTop 缺省为 0）时 top 直接取 marker 的 top', () => {
    const field = mountField('textarea')
    stubMarkerRect()

    expect(caretRectOf(field, 5)?.top).toBe(MARKER.top)
  })
})

/**
 * 富文本输入区（`contenteditable`）改用**选区矩形**（2026-10-18 起聊天输入区不再是 textarea）。
 * 这些分支此前未覆盖，降级口径一旦走错，面板会贴到视口左上角。
 */
describe('caretRectOf —— contenteditable 的选区矩形', () => {
  /** 造一个选区桩（"选区是否落在编辑区内"由 `stubContains` 单独控制） */
  function stubSelection(options: {
    rangeCount?: number
    rect?: { left: number; top: number; right: number; bottom: number }
  }): void {
    const { rangeCount = 1, rect = MARKER } = options
    const range = {
      startContainer: document.body,
      getBoundingClientRect: (): DOMRect => fakeRect(rect),
    }
    vi.spyOn(document, 'getSelection').mockReturnValue({
      rangeCount,
      getRangeAt: () => range,
    } as unknown as Selection)
  }

  /** 让 `element.contains(range.startContainer)` 返回期望值 */
  function stubContains(value: boolean): void {
    const editor = document.querySelector('[contenteditable]')
    if (editor) vi.spyOn(editor, 'contains').mockReturnValue(value)
  }

  function mountEditor(): HTMLElement {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.appendChild(editor)
    return editor
  }

  it('选区落在编辑区内 → 返回选区矩形（零宽光标）', () => {
    const editor = mountEditor()
    stubSelection({})
    stubContains(true)

    expect(caretRectOf(editor, 5)).toEqual({
      left: MARKER.left,
      top: MARKER.top,
      right: MARKER.left,
      bottom: MARKER.bottom,
    })
  })

  it('无选区 / 选区数为 0 → null（面板失焦后回到"贴锚点下方"）', () => {
    const editor = mountEditor()
    stubSelection({ rangeCount: 0 })

    expect(caretRectOf(editor, 5)).toBeNull()
  })

  it('选区起点不在编辑区内 → null（点到面板别处时不误判）', () => {
    const editor = mountEditor()
    stubSelection({})
    stubContains(false)

    expect(caretRectOf(editor, 5)).toBeNull()
  })

  it('选区矩形无高度（未排版）→ null', () => {
    const editor = mountEditor()
    stubSelection({ rect: { left: 0, top: 0, right: 0, bottom: 0 } })
    stubContains(true)

    expect(caretRectOf(editor, 5)).toBeNull()
  })

  it('环境没有 getSelection（老 WebView）→ null，不抛错', () => {
    const editor = mountEditor()
    vi.spyOn(document, 'getSelection').mockReturnValue(undefined as unknown as Selection)

    expect(caretRectOf(editor, 5)).toBeNull()
  })
})
