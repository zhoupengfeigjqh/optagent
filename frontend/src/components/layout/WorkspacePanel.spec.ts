/**
 * 组件测试：右侧面板的「同源地址」内容态（2026-10-15）
 *
 * 守三件事：
 * 1. **点同源入口后面板里要有东西** —— `openView()` 只写 `target`（不写 `content`），
 *    若内容区只认 `content`，用户看到的就是一个标题为"文件空间"的空面板
 * 2. **预检结论决定渲染** —— `iframe` 内联；`download` 给外部打开入口（不静默失败）
 * 3. **头部取入口名**，不退回列表态文案
 */
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
})

/**
 * 放大 / 缩小（2026-10-16，011）
 *
 * 本文件只测**面板这一层的契约**：入口在不在、在哪儿、叫什么、点了派发什么、标记类有没有。
 * "什么内容可以放大"的判据在会话态（`usePreview.spec.ts` 的 8 例矩阵），这里用
 * `maximizeVisible` 这个布尔 prop 代表结论——面板 MUST NOT 自行对 `target` / `content` 判第二遍（FR-010）。
 */
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

  /** 文件目标（PDF）：动作区同时有「下载」与「放大」，才能断言三者的相对顺序。 */
  function mountPdf(over: Partial<{ maximized: boolean; maximizeVisible: boolean }> = {}) {
    return mount(WorkspacePanel, {
      props: {
        view: 'content',
        target: { kind: 'file', dir: '共享空间', filename: '图纸.pdf' },
        content: { renderMode: 'pdf', text: null, url: '/api/files/x', error: null },
        maximizeVisible: true,
        maximized: false,
        ...over,
      },
    })
  }

  /** 头部动作区里每个按钮的可访问名称，按 DOM 顺序。 */
  function actionLabels(wrapper: ReturnType<typeof mountMaximizable>): string[] {
    return wrapper
      .findAll('.workspace-panel__actions button')
      .map((button) => button.attributes('aria-label') ?? '')
  }

  /** 放大 / 缩小入口（按可访问名称定位，不依赖它在动作区里的下标）。 */
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
    // 组件不改状态（真源在会话态），故先确认节点没被换掉：换节点 = 焦点在切换时丢失
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

/**
 * 放大态下的 Esc（011）
 *
 * 面板负责把两处 Esc 汇成同一个 `restore-maximize`：本页 `window`（同源 iframe 之外的场景）
 * 与同源 iframe 文档内（用户点进页面里翻的常见路径）。"退出放大不中断回答"的拦截细节
 * 在 `useMaximizeEscape.spec.ts` 里测，这里只钉面板的接线与转发。
 */
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

  /** 给 iframe 就地挂一份"同源文档"，返回它以便断言与派发事件。 */
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
    // jsdom 不会为带 `src` 的 iframe 造文档（真实浏览器里同源才有 `contentDocument`），
    // 故就地注入一份等价文档：本用例测的是"拿到文档之后我们做了什么"
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
