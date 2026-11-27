import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAM_TEXT_INTERVAL_MS, useThrottledText } from './useThrottledText'

function mountThrottled(source: Ref<string>): { view: Ref<string>; wrapper: VueWrapper } {
  let view: Ref<string> | null = null
  const wrapper = mount(
    defineComponent({
      setup() {
        view = useThrottledText(source)
        return () => null
      },
    }),
  )
  if (view === null) throw new Error('组合式函数未执行')
  return { view, wrapper }
}

describe('useThrottledText —— 渲染节流（2026-10-16）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口内的多次变化合并成一次更新（延迟到窗口末尾落定）', async () => {
    const source = ref('')
    const { view, wrapper } = mountThrottled(source)

    source.value = '一'
    await nextTick()
    expect(view.value).toBe('')

    source.value = '一二'
    await nextTick()
    source.value = '一二三'
    await nextTick()
    expect(view.value).toBe('')

    vi.advanceTimersByTime(STREAM_TEXT_INTERVAL_MS)
    expect(view.value).toBe('一二三')

    wrapper.unmount()
  })

  it('复位（文本变短 = 新一轮）立即落定，不让上一轮内容在气泡里闪现', async () => {
    const source = ref('')
    const { view, wrapper } = mountThrottled(source)

    source.value = '上一轮的长回答'
    // 先让 watcher 落地（开窗口），再推进时间轴；否则定时器根本还没建
    await nextTick()
    vi.advanceTimersByTime(STREAM_TEXT_INTERVAL_MS)
    expect(view.value).toBe('上一轮的长回答')

    source.value = ''
    await nextTick()

    expect(view.value).toBe('')
    wrapper.unmount()
  })

  it('卸载时清掉待落的定时器（不留悬挂回调写已销毁的视图）', async () => {
    const source = ref('')
    const { view, wrapper } = mountThrottled(source)

    source.value = '半截内容'
    await nextTick()
    wrapper.unmount()

    vi.advanceTimersByTime(STREAM_TEXT_INTERVAL_MS * 4)

    expect(view.value).toBe('')
  })
})
