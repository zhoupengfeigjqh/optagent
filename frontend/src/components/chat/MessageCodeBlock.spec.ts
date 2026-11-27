import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContentSegment } from '../../utils/segments'
import MessageCodeBlock from './MessageCodeBlock.vue'

const COPY_FEEDBACK_MS = 2000

function mountBlock(segments: ContentSegment[], language = '') {
  return mount(MessageCodeBlock, { props: { language, segments } })
}

const CODE: ContentSegment[] = [
  { type: 'text', text: 'select ' },
  { type: 'mark', text: '1', matchIndex: 0 },
  { type: 'text', text: '\nselect 2' },
]

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { writeText } })
}

describe('MessageCodeBlock —— 语言角标（2026-10-16）', () => {
  it('围栏标注了语言就用它；未标注时兜底显示 code', () => {
    expect(mountBlock(CODE, 'sql').find('.message-code__language').text()).toBe('sql')
    expect(mountBlock(CODE).find('.message-code__language').text()).toBe('code')
  })

  it('代码正文经 MessageSegments 落 DOM：命中仍是可定位的高亮', () => {
    const wrapper = mountBlock(CODE, 'sql')

    expect(wrapper.find('mark[data-match-index="0"]').text()).toBe('1')
    expect(wrapper.find('.message-code__code').text()).toBe('select 1\nselect 2')
  })
})

describe('MessageCodeBlock —— 复制原文（2026-10-16）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('写入剪贴板的是分段无损拼接的原文（不含高亮标记）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    const wrapper = mountBlock(CODE, 'sql')
    await wrapper.find('.message-code__copy').trigger('click')

    expect(writeText).toHaveBeenCalledWith('select 1\nselect 2')
  })

  it('成功后文案与 aria-label 翻为「已复制」，约 2 秒后复原', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined))

    const wrapper = mountBlock(CODE)
    const button = wrapper.find('.message-code__copy')

    await button.trigger('click')
    expect(button.text()).toContain('已复制')
    expect(button.attributes('aria-label')).toBe('已复制代码')

    vi.advanceTimersByTime(COPY_FEEDBACK_MS)
    await nextTick()

    expect(button.text()).toContain('复制')
    expect(button.text()).not.toContain('已复制')
    expect(button.attributes('aria-label')).toBe('复制代码')
  })

  it('窗口内再次复制：旧定时器被清掉，反馈从最后一次点击重新计时', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined))

    const wrapper = mountBlock(CODE)
    const button = wrapper.find('.message-code__copy')

    await button.trigger('click')
    vi.advanceTimersByTime(COPY_FEEDBACK_MS - 500)
    await button.trigger('click')

    vi.advanceTimersByTime(500)
    await nextTick()
    expect(button.text()).toContain('已复制')

    vi.advanceTimersByTime(COPY_FEEDBACK_MS - 500)
    await nextTick()
    expect(button.text()).not.toContain('已复制')
  })

  it('代码为空：不往剪贴板写空串', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    const wrapper = mountBlock([])
    await wrapper.find('.message-code__copy').trigger('click')

    expect(writeText).not.toHaveBeenCalled()
    expect(wrapper.find('.message-code__copy').text()).toContain('复制')
  })
})

describe('MessageCodeBlock —— 降级与生命周期（2026-10-16）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('剪贴板不可用（非安全上下文）：静默不改文案，不抛错', async () => {
    vi.stubGlobal('navigator', {})

    const wrapper = mountBlock(CODE)
    await wrapper.find('.message-code__copy').trigger('click')

    expect(wrapper.find('.message-code__copy').text()).toContain('复制')
    expect(wrapper.find('.message-code__copy').text()).not.toContain('已复制')
  })

  it('写入抛错（权限被拒）：同样静默，不谎报已复制', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))

    const wrapper = mountBlock(CODE)
    await wrapper.find('.message-code__copy').trigger('click')

    expect(wrapper.find('.message-code__copy').text()).not.toContain('已复制')
  })

  it('卸载时清掉待复原的定时器（不留悬挂回调写已销毁的组件）', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    const setSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')

    const wrapper = mountBlock(CODE)
    await wrapper.find('.message-code__copy').trigger('click')

    const timerId = setSpy.mock.results[setSpy.mock.results.length - 1].value as number
    wrapper.unmount()

    expect(clearSpy).toHaveBeenCalledWith(timerId)
  })
})
