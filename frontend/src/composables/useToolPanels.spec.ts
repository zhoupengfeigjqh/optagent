/**
 * 工具查看态测试（002 特性 / TR-36）
 *
 * 守三件事：
 * 1. `panelOf` 返回的必须是**同一个 reactive 对象**（否则组件里改展开态不触发更新，
 *    卡片会永远停在"刚展开"的样子——这是本模块文档注释里点明的坑）
 * 2. 明细展开态按分组键读写
 * 3. `reset()` 能清空（模块级单例，测试之间必须隔离）
 *
 * 2026-11-08：卡片不再按需拉取外置正文，状态里只剩 `open` / `raw` 两个字段。
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
    const stop = watchEffect(() => {
      seen.push(panels.panelOf('c1').open)
    })
    panels.panelOf('c1').open = true
    await nextTick()
    expect(seen).toEqual([false, true])
    // 必须停掉：模块级单例上的 effect 不会随组件卸载，留着会在后续用例插入新键时
    // 反复重建 `c1`（曾导致"FIFO 淘汰"用例单独跑绿、组内跑红）
    stop()
  })

  it('新 call_id 的初始态：收起、正文按结构化展示', () => {
    expect(useToolPanels().panelOf('c9')).toEqual({ open: false, raw: false })
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
    panels.panelOf('c1').raw = true
    panels.setDetailsOpen('g1', true)

    panels.reset()

    expect(panels.panelOf('c1').open).toBe(false)
    expect(panels.panelOf('c1').raw).toBe(false)
    expect(panels.isDetailsOpen('g1')).toBe(false)
  })

  it('是同一份共享实例（跨组件调用者拿到同一个存取口）', () => {
    expect(useToolPanels()).toBe(useToolPanels())
  })

  /**
   * 上限（2026-10-27）：模板对**每张**工具卡片都会 `panelOf`，量级 = 本页出现过的调用数；
   * 长会话切来切去会无界增长，必须有硬上限。
   */
  it('条目态按插入顺序 FIFO 淘汰：超 200 条后最旧的被清掉，最新的仍在', () => {
    const panels = useToolPanels()
    for (let index = 0; index < 201; index += 1) panels.panelOf(`c${index}`).open = true

    // 最旧的一条已被淘汰：重新取到的是全新初始态（展开态丢失 = 内存已释放）
    expect(panels.panelOf('c0').open).toBe(false)
    // 最新的一条仍在记忆里
    expect(panels.panelOf('c200').open).toBe(true)
  })

  it('明细展开态同样有上限（不随分组键无限增长）', () => {
    const panels = useToolPanels()
    for (let index = 0; index < 201; index += 1) panels.setDetailsOpen(`g${index}`, true)

    expect(panels.isDetailsOpen('g0')).toBe(false)
    expect(panels.isDetailsOpen('g200')).toBe(true)
  })
})
