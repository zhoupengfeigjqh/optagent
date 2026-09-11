import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import type { Message } from '../api/types'
import { createSessionSearchStore } from './useSessionSearch'

function message(id: string, content: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    ts: '2026-09-10T00:00:00Z',
    feedback: null,
  }
}

function makeStore(messages: Message[]) {
  const source = ref(messages)
  return { store: createSessionSearchStore({ messages: () => source.value }), source }
}

describe('useSessionSearch - 匹配统计（FR-029）', () => {
  it('关键词为空时无匹配', () => {
    const { store } = makeStore([message('m1', '报告 报告')])

    expect(store.matches.value).toEqual([])
    expect(store.total.value).toBe(0)
  })

  it('纯空白关键词视为无匹配', () => {
    const { store } = makeStore([message('m1', 'abc')])
    store.keyword.value = '   '

    expect(store.total.value).toBe(0)
  })

  it('跨消息累计序号，并给出每条消息的基准序号', () => {
    const { store } = makeStore([
      message('m1', '报告与报告'),
      message('m2', '无关内容'),
      message('m3', '报告'),
    ])

    store.keyword.value = '报告'

    expect(store.matches.value).toEqual([
      { messageId: 'm1', index: 0 },
      { messageId: 'm1', index: 1 },
      { messageId: 'm3', index: 2 },
    ])
    expect(store.baseOf.value.get('m1')).toBe(0)
    expect(store.baseOf.value.get('m3')).toBe(2)
    expect(store.baseOf.value.has('m2')).toBe(false)
  })

  it('匹配口径与高亮一致：大小写不敏感且按字面量', () => {
    const { store } = makeStore([message('m1', 'Report report (10)')])

    store.keyword.value = 'report'
    expect(store.total.value).toBe(2)

    store.keyword.value = '(10)'
    expect(store.total.value).toBe(1)
  })
})

describe('useSessionSearch - 定位与循环（FR-030、SC-009）', () => {
  it('关键词变化后自动定位到首个命中', async () => {
    const { store } = makeStore([message('m1', 'a'), message('m2', 'b b')])

    store.keyword.value = 'b'
    await Promise.resolve()

    expect(store.activeIndex.value).toBe(0)
    expect(store.activeMessageId.value).toBe('m2')
  })

  it('无命中时定位为 -1', async () => {
    const { store } = makeStore([message('m1', 'a')])

    store.keyword.value = 'zzz'
    await Promise.resolve()

    expect(store.activeIndex.value).toBe(-1)
    expect(store.activeMessageId.value).toBeNull()
  })

  it('next 顺序前进，末尾回到首项', async () => {
    const { store } = makeStore([message('m1', 'x x x')])
    store.keyword.value = 'x'
    // `watch` 为异步刷新：先让关键词变化带来的自动定位落到首个命中（0）
    await Promise.resolve()

    store.next()
    expect(store.activeIndex.value).toBe(1)

    store.next()
    expect(store.activeIndex.value).toBe(2)

    store.next()
    expect(store.activeIndex.value).toBe(0)
  })

  it('next 在无匹配时为无操作', () => {
    const { store } = makeStore([message('m1', 'x')])

    store.next()

    expect(store.activeIndex.value).toBe(-1)
  })

  it('close 重置关键词、开关与定位', () => {
    const { store } = makeStore([message('m1', 'x')])
    store.open()
    store.keyword.value = 'x'

    store.close()

    expect(store.isOpen.value).toBe(false)
    expect(store.keyword.value).toBe('')
    expect(store.activeIndex.value).toBe(-1)
    expect(store.total.value).toBe(0)
  })

  it('消息变化（重新拉取）后匹配自动重算', () => {
    const { store, source } = makeStore([message('m1', 'x')])
    store.keyword.value = 'x'
    expect(store.total.value).toBe(1)

    source.value = [message('m1', 'x'), message('m2', 'x')]

    expect(store.total.value).toBe(2)
  })

  it('open 仅置开关', () => {
    const { store } = makeStore([])

    store.open()

    expect(store.isOpen.value).toBe(true)
  })
})
