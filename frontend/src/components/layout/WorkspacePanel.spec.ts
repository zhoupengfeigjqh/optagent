import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { PreviewContent, PreviewTarget } from '../../composables/usePreview'
import WorkspacePanel from './WorkspacePanel.vue'

const URL = 'http://localhost:3000/taskresult?taskNo=SCHBE027CEC8DB44BC9A586265951D931DE'

function urlTarget(
  over: Partial<{ url: string; name: string; renderMode: 'iframe' | 'download' }> = {},
): PreviewTarget {
  return { kind: 'url', url: URL, name: '产品周报.html', renderMode: 'iframe', ...over }
}

function mountContent(target: PreviewTarget, content: PreviewContent | null = null) {
  return mount(WorkspacePanel, { props: { view: 'content', target, content } })
}

describe('WorkspacePanel —— 同源地址内容态（2026-10-15）', () => {
  it('`renderMode: iframe` → 面板内渲染 iframe（不是空面板）', () => {
    const wrapper = mountContent(urlTarget())
    const frame = wrapper.find('iframe')

    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe(URL)
    expect(frame.attributes('title')).toBe('产品周报.html')
    expect(wrapper.find('.workspace-panel__fallback').exists()).toBe(false)
  })

  it('头部标题取入口名，不落到列表态文案"文件空间"', () => {
    const wrapper = mountContent(urlTarget({ name: '一车间产能明细' }))

    expect(wrapper.find('.workspace-panel__name').text()).toBe('一车间产能明细')
  })

  it('`renderMode: download` → 给外部打开入口，点击在新窗口打开该地址', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mountContent(urlTarget({ renderMode: 'download' }))

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.workspace-panel__hint').text()).toContain('不支持内联预览')

    await wrapper.find('.workspace-panel__fallback button').trigger('click')

    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('2026-10-20：`.html` → 与 PDF 同形态的 iframe，但 MUST 带 `sandbox=""`', () => {
    const wrapper = mountContent(
      { kind: 'file', dir: '临时空间', filename: '看板.html' },
      {
        renderMode: 'html',
        text: null,
        url: '/api/files/preview?dir=临时空间&filename=看板.html',
        error: null,
      },
    )

    const frame = wrapper.find('iframe')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe('/api/files/preview?dir=临时空间&filename=看板.html')
    // 空值 = 全限制：脚本不执行、不共享本站源（用户上传内容不能获得平台权限）
    expect(frame.attributes('sandbox')).toBe('')
    expect(frame.attributes('referrerpolicy')).toBe('no-referrer')
  })

  it('文件目标（`kind: file`）不受影响：正文照旧按 `content` 渲染', () => {
    const wrapper = mountContent(
      { kind: 'file', dir: '数据准备', filename: '产能.txt' },
      {
        renderMode: 'text',
        text: '一车间 120 件',
        url: null,
        error: null,
      },
    )

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.workspace-panel__text').text()).toBe('一车间 120 件')
    expect(wrapper.find('.workspace-panel__name').text()).toBe('产能.txt')
  })

  it('`renderMode: sheet`（`.xlsx`）→ 交给 `SheetPreview` 画表，不进 iframe（2026-11-17）', () => {
    const wrapper = mountContent(
      { kind: 'file', dir: '临时空间', filename: '汇总.xlsx' },
      {
        renderMode: 'sheet',
        text: null,
        workbook: {
          sheets: [
            {
              name: '物料',
              rows: [
                ['物料', '数量'],
                ['A', '10'],
              ],
              numericCols: [1],
              merges: [],
              truncated: false,
            },
          ],
        },
        url: null,
        error: null,
      },
    )

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.workspace-panel__text').exists()).toBe(false)
    expect(wrapper.find('.sheet-preview').exists()).toBe(true)
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(['物料', '数量'])
    expect(wrapper.find('.workspace-panel__name').text()).toBe('汇总.xlsx')
  })
})

describe('WorkspacePanel —— 放大 / 缩小入口（011）', () => {
  function mountMaximizable(over: Partial<{ maximized: boolean; maximizeVisible: boolean }> = {}) {
    return mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: urlTarget(),
        maximizeVisible: true,
        maximized: false,
        ...over,
      },
    })
  }

  function mountPdf(over: Partial<{ maximized: boolean; maximizeVisible: boolean }> = {}) {
    return mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: { kind: 'file', dir: '临时空间', filename: '图纸.pdf' },
        content: { renderMode: 'pdf', text: null, url: '/api/files/x', error: null },
        maximizeVisible: true,
        maximized: false,
        ...over,
      },
    })
  }

  function actionLabels(wrapper: ReturnType<typeof mountMaximizable>): string[] {
    return wrapper
      .findAll('.workspace-panel__actions button')
      .map((button) => button.attributes('aria-label') ?? '')
  }

  function maximizeEntry(wrapper: ReturnType<typeof mountMaximizable>) {
    const entry = wrapper
      .findAll('.workspace-panel__actions button')
      .find((button) => /^(放大|缩小)页面$/.test(button.attributes('aria-label') ?? ''))
    if (!entry) {
      throw new Error('放大 / 缩小入口不存在')
    }
    return entry
  }

  it('入口在「收起」**左侧**（「下载」右侧），且是原生按钮（Tab 可达、Enter / 空格可触发）', () => {
    const wrapper = mountPdf()

    expect(actionLabels(wrapper)).toEqual(['下载当前文件', '放大页面', '收起文件空间'])
    expect(maximizeEntry(wrapper).attributes('type')).toBe('button')
  })

  it('同源地址目标下同样只有「放大 → 收起」两枚（不挤走也没有多余按钮）', () => {
    const wrapper = mountMaximizable()

    expect(actionLabels(wrapper)).toEqual(['放大页面', '收起文件空间'])
  })

  it('没有可放大内容时不渲染入口（范围内外由会话态决定，这里只认 prop）', () => {
    const wrapper = mountPdf({ maximizeVisible: false })

    expect(actionLabels(wrapper)).toEqual(['下载当前文件', '收起文件空间'])
  })

  it('点击派发 `toggle-maximize`，且两态复用**同一个**按钮节点', async () => {
    const wrapper = mountMaximizable()
    const entry = maximizeEntry(wrapper)
    const before = entry.element

    await entry.trigger('click')

    expect(wrapper.emitted('toggle-maximize')).toHaveLength(1)
    expect(maximizeEntry(wrapper).element).toBe(before)
  })

  it('放大态：名称变「缩小页面」、`aria-pressed` 为真、图标换成收回样式', () => {
    const entry = maximizeEntry(mountMaximizable({ maximized: true }))

    expect(entry.attributes('aria-label')).toBe('缩小页面')
    expect(entry.attributes('aria-pressed')).toBe('true')
    expect(entry.find('svg').html()).toContain('M4 14h6v6')
  })

  it('非放大态：名称是「放大页面」、`aria-pressed` 为假、图标是铺开样式', () => {
    const entry = maximizeEntry(mountMaximizable({ maximized: false }))

    expect(entry.attributes('aria-label')).toBe('放大页面')
    expect(entry.attributes('aria-pressed')).toBe('false')
    expect(entry.find('svg').html()).toContain('M15 3h6v6')
  })

  it('放大态给面板根节点打标记类（覆盖层断言的锚点）', async () => {
    const wrapper = mountMaximizable()

    expect(wrapper.find('.workspace-panel').classes()).not.toContain('workspace-panel--maximized')

    await wrapper.setProps({ maximized: true })

    expect(wrapper.find('.workspace-panel').classes()).toContain('workspace-panel--maximized')
  })

  it('放大 / 缩小 MUST NOT 重建承载内容的节点（iframe 元素与 `src` 都不动，FR-006）', async () => {
    const wrapper = mountMaximizable()
    const frame = wrapper.find('iframe').element

    await wrapper.setProps({ maximized: true })
    expect(wrapper.find('iframe').element).toBe(frame)

    await wrapper.setProps({ maximized: false })
    expect(wrapper.find('iframe').element).toBe(frame)
    expect(wrapper.find('iframe').attributes('src')).toBe(URL)
  })

  it('列表态下不出现入口（面板停在文件空间列表时没有可放大的内容，FR-011）', () => {
    const wrapper = mount(WorkspacePanel, {
      props: { view: 'list', maximizeVisible: false, maximized: false },
    })

    expect(actionLabels(wrapper)).toEqual(['收起文件空间'])
  })
})

describe('WorkspacePanel —— 放大态按 Esc（011）', () => {
  function mountUrl(over: Partial<{ maximized: boolean }> = {}) {
    return mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: urlTarget(),
        maximizeVisible: true,
        maximized: false,
        ...over,
      },
    })
  }

  function pressEscapeHere(): void {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }),
    )
  }

  function stubContentDocument(frame: { element: Element }): Document {
    const doc = document.implementation.createHTMLDocument('frame')
    Object.defineProperty(frame.element, 'contentDocument', { value: doc, configurable: true })
    return doc
  }

  it('放大态下本页按 Esc → 派发 `restore-maximize`（一次）', async () => {
    const wrapper = mountUrl({ maximized: true })

    pressEscapeHere()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('restore-maximize')).toHaveLength(1)
    wrapper.unmount()
  })

  it('非放大态按 Esc → **不**派发（不抢中栏"中断本轮回答"的那一次）', async () => {
    const wrapper = mountUrl({ maximized: false })

    pressEscapeHere()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('restore-maximize')).toBeUndefined()
    wrapper.unmount()
  })

  it('放大态下同源 iframe 文档内的 Esc → 同样派发 `restore-maximize`', async () => {
    const wrapper = mountUrl({ maximized: true })
    const frame = wrapper.find('iframe')
    const doc = stubContentDocument(frame)
    await frame.trigger('load')
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(wrapper.emitted('restore-maximize')).toHaveLength(1)
    wrapper.unmount()
  })

  it('iframe 加载仍保留滚动兜底（迁移过来的既有行为没被 Esc 转发挤掉）', async () => {
    const wrapper = mountUrl()
    const frame = wrapper.find('iframe')

    const doc = stubContentDocument(frame)
    await frame.trigger('load')

    expect(doc.head.textContent).toContain('overflow:auto')
    wrapper.unmount()
  })
})
