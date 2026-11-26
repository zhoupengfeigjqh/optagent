import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { PreviewSheet, PreviewWorkbook } from '../../api/types'
import SheetPreview from './SheetPreview.vue'

function sheet(over: Partial<PreviewSheet> = {}): PreviewSheet {
  return {
    name: '订单明细',
    rows: [
      ['订单号', '数量', '金额'],
      ['SO-1', '120', '1,200.00'],
      ['SO-2', '80', '800.00'],
    ],
    numericCols: [1, 2],
    merges: [],
    truncated: false,
    ...over,
  }
}

function mountWith(workbook: PreviewWorkbook) {
  return mount(SheetPreview, { props: { workbook } })
}

function headTexts(wrapper: ReturnType<typeof mountWith>): string[] {
  return wrapper.findAll('thead th').map((cell) => cell.text())
}

describe('SheetPreview —— 工作表 Tab', () => {
  it('多 sheet 渲染成多个 tab，默认停在第一个', () => {
    const wrapper = mountWith({
      sheets: [sheet(), sheet({ name: '库存', rows: [['物料'], ['冷轧板']], numericCols: [] })],
    })

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['订单明细', '库存'])
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(headTexts(wrapper)).toEqual(['订单号', '数量', '金额'])
  })

  it('点击另一个 tab → 表头与数据一起换掉', async () => {
    const wrapper = mountWith({
      sheets: [sheet(), sheet({ name: '库存', rows: [['物料', '在库'], ['冷轧板', '860']], numericCols: [1] })],
    })

    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')

    expect(wrapper.findAll('[role="tab"]')[1]?.attributes('aria-selected')).toBe('true')
    expect(headTexts(wrapper)).toEqual(['物料', '在库'])
  })

  it('← → 方向键切换（tablist 语义：焦点跟着走）', async () => {
    // 焦点断言必须挂到 document：游离的 vnode 里 `focus()` 不生效
    const wrapper = mount(SheetPreview, {
      props: { workbook: { sheets: [sheet(), sheet({ name: '库存', rows: [['物料'], ['冷轧板']] })] } },
      attachTo: document.body,
    })
    const tabs = wrapper.findAll('[role="tab"]')

    await tabs[0]?.trigger('keydown', { key: 'ArrowRight' })

    expect(tabs[1]?.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1]?.element)
    wrapper.unmount()
  })

  it('换文件回到第一个 tab（不留在上一份文件的位置）', async () => {
    const wrapper = mountWith({
      sheets: [sheet(), sheet({ name: '库存', rows: [['物料'], ['冷轧板']] })],
    })
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')

    await wrapper.setProps({ workbook: { sheets: [sheet()] } })

    expect(wrapper.findAll('[role="tab"]')[0]?.attributes('aria-selected')).toBe('true')
  })
})

describe('SheetPreview —— 单元格呈现', () => {
  it('数字列加右对齐类，文本列不加（判据只看 numericCols）', () => {
    const wrapper = mountWith({ sheets: [sheet()] })

    const headerCells = wrapper.findAll('thead th')
    expect(headerCells[0]?.classes()).not.toContain('sheet-preview__cell--num')
    expect(headerCells[1]?.classes()).toContain('sheet-preview__cell--num')
    expect(headerCells[2]?.classes()).toContain('sheet-preview__cell--num')
  })

  it('合并单元格 → 起点带 rowspan，被覆盖的格子不渲染', () => {
    const wrapper = mountWith({
      sheets: [
        sheet({
          rows: [
            ['区域', '客户'],
            ['华东', 'A'],
            ['', 'B'],
          ],
          numericCols: [],
          merges: [{ r: 1, c: 0, rowSpan: 2, colSpan: 1 }],
        }),
      ],
    })

    const rows = wrapper.findAll('tbody tr')
    const firstCell = rows[0]?.findAll('td')[0]

    expect(firstCell?.attributes('rowspan')).toBe('2')
    expect(rows[1]?.findAll('td')).toHaveLength(1)
    expect(rows[1]?.text()).toBe('B')
  })

  it('第一行作表头（业务表格的默认形态），数据行从第二行开始', () => {
    const wrapper = mountWith({ sheets: [sheet()] })

    expect(headTexts(wrapper)).toEqual(['订单号', '数量', '金额'])
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })
})

describe('SheetPreview —— 空态与截断', () => {
  it('没有工作表 → 明确提示，而不是空白面板', () => {
    const wrapper = mountWith({ sheets: [] })

    expect(wrapper.find('.sheet-preview__empty').text()).toContain('没有任何工作表')
  })

  it('工作表没有内容 → 提示空表', () => {
    const wrapper = mountWith({ sheets: [sheet({ rows: [], numericCols: [] })] })

    expect(wrapper.find('.sheet-preview__empty').text()).toContain('该工作表为空')
  })

  it('行数超过渲染上限 → 只渲染前 400 行并提示下载', () => {
    const rows = Array.from({ length: 500 }, (_, index) => [`行 ${index}`])
    const wrapper = mountWith({ sheets: [sheet({ rows, numericCols: [] })] })

    expect(wrapper.findAll('tbody tr')).toHaveLength(400)
    expect(wrapper.find('.sheet-preview__hint').text()).toContain('前 400 行')
    expect(wrapper.find('.sheet-preview__hint').text()).toContain('下载')
  })

  it('服务端已截断（truncated）→ 也要提示，不能装作完整', () => {
    const wrapper = mountWith({ sheets: [sheet({ truncated: true })] })

    expect(wrapper.find('.sheet-preview__hint').exists()).toBe(true)
  })

  it('未截断 → 不显示提示条', () => {
    const wrapper = mountWith({ sheets: [sheet()] })

    expect(wrapper.find('.sheet-preview__hint').exists()).toBe(false)
  })
})
