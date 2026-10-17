/**
 * 单元测试：消息区滚动跟随、会话位置记忆与读屏播报（2026-10-16，拆分产出）。
 *
 * 这个模块是从 `MessageList.vue` **原样搬出来**的（宪章原则二：单文件 ≤500 行），
 * 本文件的作用是"锁住搬运后的行为"。它与组件测试的分工：
 * - 组件测试（`MessageList.spec.ts`）从用户视角走通"上翻 → 箭头 → 点回去"；
 * - 本文件直接驱动组合式函数，覆盖**组件层到不了的两条路径**：
 *   ① 存档上限 50 的淘汰（要连切 51 个会话才能看到）；
 *   ② `ResizeObserver` 分支（jsdom 没有该 API，组件测试里被守卫跳过）。
 */
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '../api/types'
import { useMessageScroll, type MessageScroll } from './useMessageScroll'

function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: 'user',
    content: '内容',
    ts: '2026-10-16T10:00:00Z',
    feedback: null,
    ...overrides,
  }
}

/**
 * 在真实组件里调用一次：本模块靠 `onMounted` / `onBeforeUnmount` 装拆 `ResizeObserver`，
 * 游离调用拿不到生命周期钩子。
 */
function mountScroll(options: { messages?: Message[]; threadId?: string | null } = {}) {
  const listRef = ref<HTMLElement | null>(null)
  const messages = ref<Message[]>(options.messages ?? [msg('m_1')])
  const streamKey = ref('')
  const pendingUser = ref<unknown | null>(null)
  const threadId = ref<string | null>(options.threadId ?? null)

  // 用对象属性承载：`let` 变量在 TS 的控制流里只有 `= null` 这一次赋值
  // （闭包内的赋值不进流图），守卫之后就退化成 `never` 了
  const holder: { api: MessageScroll | null } = { api: null }
  const wrapper = mount(
    defineComponent({
      setup() {
        holder.api = useMessageScroll({ listRef, messages, streamKey, pendingUser, threadId })
        return () => h('div', { ref: listRef })
      },
    }),
  )
  if (holder.api === null) throw new Error('组合式函数未执行')

  return {
    wrapper,
    api: holder.api,
    listRef,
    messages,
    streamKey,
    pendingUser,
    threadId,
    element: (): HTMLElement => listRef.value as HTMLElement,
  }
}

/**
 * 装上可用的滚动尺寸。
 *
 * jsdom 不参与布局：`scrollHeight` / `clientHeight` 恒为 0、写 `scrollTop` 也没反应，
 * 所以三者都要显式定义（`scrollTop` 用可写存取器，便于模拟"用户上翻"）。
 * 返回读取当前 `scrollTop` 的函数——"有没有真的被程序化置底"要看它。
 */
function installScrollMetrics(
  element: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
): () => number {
  let scrollTop = 0
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
    configurable: true,
  })
  return () => scrollTop
}

describe('useMessageScroll —— 跟随与暂停（2026-10-16）', () => {
  it('贴底时追加新消息：跟随到最新', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)
    // 会话切换那一次置底已经落地；这里从贴底状态出发（scrollTop 归位到最底）
    harness.element().scrollTop = 1000
    harness.api.onScroll()
    expect(harness.api.atBottom.value).toBe(true)

    harness.messages.value = [msg('m_1'), msg('m_2')]
    await flushPromises()

    expect(readScrollTop()).toBe(1000)
    harness.wrapper.unmount()
  })

  it('阈值边界：距底 80px 仍在跟随之内，81px 即暂停', () => {
    const harness = mountScroll()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 620 // 1000 - 620 - 300 = 80
    harness.api.onScroll()
    expect(harness.api.atBottom.value).toBe(true)

    harness.element().scrollTop = 619 // 距底 81
    harness.api.onScroll()
    expect(harness.api.atBottom.value).toBe(false)

    harness.wrapper.unmount()
    expect(readScrollTop()).toBe(619)
  })

  it('上翻后流式增量不打扰视口（用户正在读旧内容）', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 300
    harness.api.onScroll()
    expect(harness.api.atBottom.value).toBe(false)

    harness.streamKey.value = 'streaming|120|0|2'
    await flushPromises()

    expect(readScrollTop()).toBe(300)
    harness.wrapper.unmount()
  })

  it('本端发送（乐观气泡出现）：不看阈值强制置底', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 100
    harness.api.onScroll()
    expect(harness.api.atBottom.value).toBe(false)

    harness.pendingUser.value = { content: '再看看这份', attachments: [] }
    await flushPromises()

    expect(readScrollTop()).toBe(1000)
    expect(harness.api.atBottom.value).toBe(true)
    harness.wrapper.unmount()
  })

  it('清除乐观气泡（变回 null）不触发任何滚动', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 250
    harness.api.onScroll()

    harness.pendingUser.value = null
    await flushPromises()

    expect(readScrollTop()).toBe(250)
    harness.wrapper.unmount()
  })
})

describe('useMessageScroll —— 会话位置记忆（2026-10-16）', () => {
  it('上翻过的会话切回来落在原位置；未上翻的会话切过去即置底', async () => {
    const harness = mountScroll({ messages: [msg('m_a')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 300
    harness.api.onScroll() // 在 th_a 里上翻

    harness.threadId.value = 'th_b'
    harness.messages.value = [msg('m_b')]
    await flushPromises()
    expect(readScrollTop()).toBe(1000) // th_b 没有存档 → 置底

    harness.threadId.value = 'th_a'
    harness.messages.value = [msg('m_a')]
    await flushPromises()
    expect(readScrollTop()).toBe(300) // 回到离开时那一屏

    harness.wrapper.unmount()
  })

  it('前插（加载更早消息）：只补偿新增高度，不跳到底部', async () => {
    const harness = mountScroll({ messages: [msg('m_b')], threadId: 'th_a' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    harness.element().scrollTop = 200
    harness.api.onScroll()

    // 前插一页：首条变了、末条没变、条数变多 ⇒ 走"补偿高度"分支
    harness.messages.value = [msg('m_a'), msg('m_b')]
    await flushPromises()

    expect(readScrollTop()).toBe(200) // 首次读到的 before 是 1000，新增高度 0 ⇒ 位置不变
    harness.wrapper.unmount()
  })

  it('存档上限 50：最久未用的档被淘汰（切回去只能置底）', async () => {
    const harness = mountScroll({ messages: [msg('m_0')], threadId: 'th_0' })
    await flushPromises()
    const readScrollTop = installScrollMetrics(harness.element(), 1000, 300)

    // 依次造访 51 个会话，每个都上翻后再离开（离开即存档）
    for (let index = 0; index < 51; index += 1) {
      harness.threadId.value = `th_${index}`
      harness.messages.value = [msg(`m_${index}`)]
      await flushPromises()
      harness.element().scrollTop = 300
      harness.api.onScroll()
    }

    // 最后访问过的会话仍有档
    harness.threadId.value = 'th_50'
    harness.messages.value = [msg('m_50')]
    await flushPromises()
    expect(readScrollTop()).toBe(300)

    // 最早的 th_0 已被淘汰 → 置底
    harness.threadId.value = 'th_0'
    harness.messages.value = [msg('m_0')]
    await flushPromises()
    expect(readScrollTop()).toBe(1000)

    harness.wrapper.unmount()
  })
})

describe('useMessageScroll —— 读屏播报（2026-10-16）', () => {
  it('新的 assistant 消息落定：只播一句结论（字数取正文长度）', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()

    harness.messages.value = [
      msg('m_1'),
      msg('m_2', { role: 'assistant', content: '产能 1200', status: 'completed' }),
    ]
    await flushPromises()

    expect(harness.api.announcement.value).toBe('回答已完成，共 7 字')
    harness.wrapper.unmount()
  })

  it('失败轮与用户消息都不播（失败由 ErrorNotice 的 role="alert" 负责）', async () => {
    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()

    harness.messages.value = [msg('m_1'), msg('m_2', { role: 'user' })]
    await flushPromises()
    expect(harness.api.announcement.value).toBe('')

    harness.messages.value = [
      msg('m_1'),
      msg('m_2', { role: 'user' }),
      msg('m_3', { role: 'assistant', content: '半截', status: 'failed' }),
    ]
    await flushPromises()
    expect(harness.api.announcement.value).toBe('')
    harness.wrapper.unmount()
  })
})

describe('useMessageScroll —— ResizeObserver（2026-10-16）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** jsdom 没有 ResizeObserver：装一个可手动触发的替身，才能走到组件测试跳过的那条分支 */
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(private readonly callback: () => void) {
      FakeResizeObserver.instances.push(this)
    }
    trigger(): void {
      this.callback()
    }
  }

  it('挂载即观察容器；尺寸变化重判贴底；卸载即断开', async () => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const harness = mountScroll({ messages: [msg('m_1')], threadId: 'th_a' })
    await flushPromises()

    const observer = FakeResizeObserver.instances[0]
    expect(observer).toBeDefined()
    expect(observer.observe).toHaveBeenCalledTimes(1)

    // 内容不满一屏（右侧面板收起等）→ 重判为贴底
    installScrollMetrics(harness.element(), 300, 300)
    harness.api.atBottom.value = false
    observer.trigger()
    expect(harness.api.atBottom.value).toBe(true)

    harness.wrapper.unmount()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
