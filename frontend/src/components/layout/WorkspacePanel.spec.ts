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
