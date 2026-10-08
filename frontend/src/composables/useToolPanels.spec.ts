/**
 * 工具查看态测试（002 特性 / TR-36）
 *
 * 守三件事：
 * 1. `panelOf` 返回的必须是**同一个 reactive 对象**（否则组件里改 `loading` 不触发更新，
 *    卡片会永远停在"加载中"——这是本模块文档注释里点明的坑）
 * 2. 明细展开态按分组键读写
 * 3. `reset()` 能清空（模块级单例，测试之间必须隔离）
 */
import { nextTick, watchEffect } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import { useToolPanels } from './useToolPanels'

afterEach(() => {
  // 模块级单例：不清空会串到下一个用例
  useToolPanels().reset()
})

describe('useToolPanels', () => {
  it('同一 call_id 返回同一对象，且是 reactive 的（改属性会触发依赖更新）', async () => {
    const panels = useToolPanels()
    expect(panels.panelOf('c1')).toBe(panels.panelOf('c1'))

    const seen: boolean[] = []
    watchEffect(() => {
      seen.push(panels.panelOf('c1').loading)
    })
    panels.panelOf('c1').loading = true
    await nextTick()
    expect(seen).toEqual([false, true])
  })

  it('新 call_id 的初始态：收起、未加载、无降级标记', () => {
    expect(useToolPanels().panelOf('c9')).toEqual({
      open: false,
      loading: false,
      content: null,
      expired: false,
      error: null,
    })
  })

  it('明细展开态：默认收起，可读写', () => {
    const panels = useToolPanels()
    expect(panels.isDetailsOpen('g1')).toBe(false)
    panels.setDetailsOpen('g1', true)
    expect(panels.isDetailsOpen('g1')).toBe(true)
    panels.setDetailsOpen('g1', false)
    expect(panels.isDetailsOpen('g1')).toBe(false)
  })

  it('reset 清空条目态与明细态（测试隔离依赖它）', () => {
    const panels = useToolPanels()
    panels.panelOf('c1').open = true
    panels.panelOf('c1').content = '正文'
    panels.setDetailsOpen('g1', true)

    panels.reset()

    expect(panels.panelOf('c1').open).toBe(false)
    expect(panels.panelOf('c1').content).toBeNull()
    expect(panels.isDetailsOpen('g1')).toBe(false)
  })

  it('是同一份共享实例（跨组件调用者拿到同一个存取口）', () => {
    expect(useToolPanels()).toBe(useToolPanels())
  })
})
