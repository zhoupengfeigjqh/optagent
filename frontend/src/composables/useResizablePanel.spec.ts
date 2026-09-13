import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import {
  PANEL_KEY_STEP,
  PANEL_KEY_STEP_LARGE,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_RESERVED_WIDTH,
  PANEL_WIDTH_VAR,
  clampPanelWidth,
  useResizablePanel,
  type ResizablePanelStore,
} from './useResizablePanel'

/** 仅需 width 的 DOMRect 桩件 */
function rectOf(width: number): DOMRect {
  return { width } as unknown as DOMRect
}

function pointerDown(options: { button?: number; clientX?: number }): PointerEvent {
  return new MouseEvent('pointerdown', {
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
  }) as unknown as PointerEvent
}

function keydown(key: string, options: { shiftKey?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey: options.shiftKey ?? false })
}

/** 挂载一个壳组件以取得 composable（`onBeforeUnmount` 需要组件上下文） */
function setup(containerWidth: number, panelWidth: number) {
  const container = document.createElement('div')
  const panel = document.createElement('div')
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf(containerWidth))
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rectOf(panelWidth))

  let store!: ResizablePanelStore
  const Harness = defineComponent({
    setup() {
      store = useResizablePanel({ container: () => container, panel: () => panel })
      return () => null
    },
  })
  const wrapper = mount(Harness)
  return { store, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('clampPanelWidth', () => {
  it('低于下限时收敛到下限', () => {
    expect(clampPanelWidth(10, 1400)).toBe(PANEL_MIN_WIDTH)
  })

  it('上限受容器宽度约束（容器宽 - 保留宽）', () => {
    expect(clampPanelWidth(5000, 1400)).toBe(1400 - PANEL_RESERVED_WIDTH)
  })

  it('容器很宽时不超过绝对封顶', () => {
    expect(clampPanelWidth(5000, 4000)).toBe(PANEL_MAX_WIDTH)
  })

  it('容器宽未知（≤0）时按绝对封顶', () => {
    expect(clampPanelWidth(5000, 0)).toBe(PANEL_MAX_WIDTH)
  })

  it('容器窄到上限低于下限时仍保底为下限', () => {
    // 容器 600 → 上限 80，低于下限，收敛结果取下限
    expect(clampPanelWidth(300, 600)).toBe(PANEL_MIN_WIDTH)
  })

  it('范围内的值原样返回', () => {
    expect(clampPanelWidth(420, 1400)).toBe(420)
  })
})

describe('useResizablePanel', () => {
  it('初始未手动调整：width 为 null、样式为空、非拖动', () => {
    const { store } = setup(1400, 400)

    expect(store.width.value).toBeNull()
    expect(store.style.value).toEqual({})
    expect(store.resizing.value).toBe(false)
  })

  it('键盘 ArrowLeft 变宽、ArrowRight 变窄', () => {
    const { store } = setup(1400, 400)

    store.onKeydown(keydown('ArrowLeft'))
    expect(store.width.value).toBe(400 + PANEL_KEY_STEP)

    store.onKeydown(keydown('ArrowRight'))
    expect(store.width.value).toBe(400)
  })

  it('键盘 Shift 使用大步长', () => {
    const { store } = setup(1400, 400)

    store.onKeydown(keydown('ArrowLeft', { shiftKey: true }))

    expect(store.width.value).toBe(400 + PANEL_KEY_STEP_LARGE)
  })

  it('键盘调整后再次按键以当前宽度为基准（而非初始值）', () => {
    const { store } = setup(1400, 400)

    store.onKeydown(keydown('ArrowLeft'))
    store.onKeydown(keydown('ArrowLeft'))

    expect(store.width.value).toBe(400 + PANEL_KEY_STEP * 2)
  })

  it('键盘到达下限后不再缩小', () => {
    const { store } = setup(1400, 300)

    store.onKeydown(keydown('ArrowRight'))
    store.onKeydown(keydown('ArrowRight'))
    store.onKeydown(keydown('ArrowRight'))

    expect(store.width.value).toBe(PANEL_MIN_WIDTH)
  })

  it('键盘到达上限后不再增大', () => {
    // 容器 1400 → 上限 880；起始 880，再按 ← 应被夹回上限
    const { store } = setup(1400, 1400 - PANEL_RESERVED_WIDTH)

    store.onKeydown(keydown('ArrowLeft'))
    store.onKeydown(keydown('ArrowLeft'))

    expect(store.width.value).toBe(1400 - PANEL_RESERVED_WIDTH)
  })

  it('其它按键不处理且不阻止默认行为', () => {
    const { store } = setup(1400, 400)
    const event = keydown('Enter')
    const prevent = vi.spyOn(event, 'preventDefault')

    store.onKeydown(event)

    expect(prevent).not.toHaveBeenCalled()
    expect(store.width.value).toBeNull()
  })

  it('width 变化时注入 CSS 变量', () => {
    const { store } = setup(1400, 400)

    store.onKeydown(keydown('ArrowLeft'))

    expect(store.style.value[PANEL_WIDTH_VAR]).toBe(`${400 + PANEL_KEY_STEP}px`)
  })

  it('非左键按下不进入拖动', () => {
    const { store } = setup(1400, 400)

    store.onPointerDown(pointerDown({ button: 1 }))

    expect(store.resizing.value).toBe(false)
    expect(store.width.value).toBeNull()
  })

  it('面板尚未布局（宽度为 0）时不进入拖动', () => {
    const { store } = setup(1400, 0)

    store.onPointerDown(pointerDown({ clientX: 100 }))

    expect(store.resizing.value).toBe(false)
  })

  it('拖动：指针左移变宽、右移变窄，抬起后结束', () => {
    const { store } = setup(1400, 400)

    store.onPointerDown(pointerDown({ clientX: 200 }))
    expect(store.resizing.value).toBe(true)

    // 指针左移 50 → 面板变宽 50
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }))
    expect(store.width.value).toBe(450)

    // 指针右移回 260 → 面板在起始宽度基础上变窄 60
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 260 }))
    expect(store.width.value).toBe(340)

    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(store.resizing.value).toBe(false)
  })

  it('拖动结束后 pointermove 不再改变宽度', () => {
    const { store } = setup(1400, 400)

    store.onPointerDown(pointerDown({ clientX: 200 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    const settled = store.width.value

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20 }))

    expect(store.width.value).toBe(settled)
  })

  it('pointercancel 结束拖动', () => {
    const { store } = setup(1400, 400)

    store.onPointerDown(pointerDown({ clientX: 200 }))
    window.dispatchEvent(new MouseEvent('pointercancel'))

    expect(store.resizing.value).toBe(false)
  })

  it('拖动中宽度同样收敛在上下限内', () => {
    const { store } = setup(1400, 400)

    store.onPointerDown(pointerDown({ clientX: 1000 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0 }))

    expect(store.width.value).toBe(1400 - PANEL_RESERVED_WIDTH)
  })

  it('卸载时清理 window 监听并复位拖动状态', () => {
    const { store, wrapper } = setup(1400, 400)
    const remove = vi.spyOn(window, 'removeEventListener')

    store.onPointerDown(pointerDown({ clientX: 200 }))
    wrapper.unmount()

    expect(store.resizing.value).toBe(false)
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function))
  })
})
