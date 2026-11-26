import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import type { Conversation } from '../../api/types'
import HistoryItem from './HistoryItem.vue'

const THREAD: Conversation = {
  thread_id: 'th_1',
  agent_name: 'demo',
  title: '旧标题',
  created_at: '2026-10-16T01:00:00Z',
  updated_at: '2026-10-16T02:00:00Z',
}

function mountItem(extra: Partial<{ active: boolean; disabled: boolean; running: boolean }> = {}) {
  return mount(HistoryItem, {
    props: { thread: THREAD, ...extra },
    attachTo: document.body,
  })
}

async function startEditing(wrapper: ReturnType<typeof mountItem>) {
  await wrapper.find('.history-item__rename').trigger('click')
  await nextTick()
  return wrapper.find('.history-item__input')
}

describe('HistoryItem —— 行内重命名（2026-10-16）', () => {
  it('双击标题进入编辑态：预填当前标题并聚焦（不必再点一次输入框）', async () => {
    const wrapper = mountItem()
    expect(wrapper.find('.history-item__input').exists()).toBe(false)

    await wrapper.find('.history-item__button').trigger('dblclick')
    await nextTick()

    const input = wrapper.find('.history-item__input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('旧标题')
    expect(document.activeElement).toBe(input.element)

    wrapper.unmount()
  })

  it('Enter 提交：去掉首尾空格后上报，并退出编辑态', async () => {
    const wrapper = mountItem()
    const input = await startEditing(wrapper)

    await input.setValue('  新标题  ')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('rename')).toEqual([[{ threadId: 'th_1', title: '新标题' }]])
    expect(wrapper.find('.history-item__input').exists()).toBe(false)

    wrapper.unmount()
  })

  it('失焦即提交：点到别处不会把编辑态挂着', async () => {
    const wrapper = mountItem()
    const input = await startEditing(wrapper)

    await input.setValue('新标题')
    ;(input.element as HTMLInputElement).blur()
    await nextTick()

    expect(wrapper.emitted('rename')).toEqual([[{ threadId: 'th_1', title: '新标题' }]])

    wrapper.unmount()
  })

  it('Esc 取消：不上报，且**不冒泡**到 document（否则会连带中断本轮回答）', async () => {
    const wrapper = mountItem()
    const input = await startEditing(wrapper)
    await input.setValue('改了一半')

    const seen: string[] = []
    const spy = (event: Event): void => {
      seen.push((event as KeyboardEvent).key)
    }
    document.addEventListener('keydown', spy)
    input.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    document.removeEventListener('keydown', spy)
    await nextTick()

    expect(seen).toEqual([])
    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.find('.history-item__input').exists()).toBe(false)

    wrapper.unmount()
  })

  it('空标题 / 与现值相同：就地收手，不产生请求', async () => {
    const wrapper = mountItem()

    const blank = await startEditing(wrapper)
    await blank.setValue('   ')
    await blank.trigger('keydown.enter')
    expect(wrapper.emitted('rename')).toBeUndefined()

    const unchanged = await startEditing(wrapper)
    await unchanged.setValue('旧标题')
    await unchanged.trigger('keydown.enter')
    expect(wrapper.emitted('rename')).toBeUndefined()

    wrapper.unmount()
  })
})

describe('HistoryItem —— 导出入口（2026-10-16）', () => {
  it('点导出上报该会话 id（拉取与落盘由上层编排）', async () => {
    const wrapper = mountItem()

    await wrapper.find('.history-item__export').trigger('click')

    expect(wrapper.emitted('export')).toEqual([['th_1']])

    wrapper.unmount()
  })

  it('disabled（有进行中会话）：重命名 / 导出 / 删除都不响应，也不进入编辑态', async () => {
    const wrapper = mountItem({ disabled: true })

    await wrapper.find('.history-item__button').trigger('dblclick')
    await wrapper.find('.history-item__rename').trigger('click')
    await wrapper.find('.history-item__export').trigger('click')
    await wrapper.find('.history-item__remove').trigger('click')
    await nextTick()

    expect(wrapper.find('.history-item__input').exists()).toBe(false)
    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.emitted('export')).toBeUndefined()
    expect(wrapper.emitted('remove')).toBeUndefined()

    wrapper.unmount()
  })
})
