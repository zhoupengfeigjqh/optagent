/**
 * 单元测试：全局会话上下文装配（002 刷新恢复 / 007 下一步动作卡片）。
 *
 * 守住一条关键不变式：**`activeThreadId` 在装配期必须为 `null`**。
 * 它表达"当前选中"这一状态，只由选中动作驱动；"要恢复哪个会话"由 `initialThreadId` 表达，
 * 二者各司其职。一旦用 `initialThreadId` 预置该 ref，`useNextSteps` / `useChatStream` 的
 * watch 收不到"变化"，刷新时（`WorkbenchView.restoreThread` 写回同一个 id）下一步动作卡片
 * 就永不恢复——即"刷新后卡片消失、点其它会话却能看到"。
 */
import { describe, expect, it } from 'vitest'

import type { ThreadNextSteps } from '../api/threads'
import { STORAGE_KEY_THREAD } from '../constants/limits'
import { createAppSession } from './useAppSession'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

/** http 客户端只用到 `ok` / `status` / `text`，无需真实 `Response` */
function respond(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

const DETAIL = {
  thread_id: 'th_1',
  agent_name: 'agent',
  title: 't',
  created_at: '',
  updated_at: '',
  total: 1,
  running: false,
  pending_interaction: null,
  messages: [{ id: 'm-1', role: 'assistant', content: '回答', ts: '', feedback: null }],
}

const CARDS: ThreadNextSteps = {
  message_id: 'm-1',
  actions: [{ prompt: '继续看看', tools: [], guidance: '' }],
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('装配期不预置 activeThreadId（刷新恢复的前提）', () => {
  it('读回 initialThreadId 但不预置 ref（预置会让恢复的 watch 永不触发）', () => {
    const session = createAppSession({
      storage: memoryStorage({ [STORAGE_KEY_THREAD]: 'th_1' }),
    })

    expect(session.initialThreadId).toBe('th_1')
    expect(session.threads.activeId.value).toBeNull()
  })

  it('刷新恢复路径：select 同一个 id 仍拉取一次卡片并写入 steps', async () => {
    const requests: string[] = []
    const session = createAppSession({
      storage: memoryStorage({ [STORAGE_KEY_THREAD]: 'th_1' }),
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        return respond(url.includes('/next-actions') ? CARDS : DETAIL)
      }) as unknown as typeof fetch,
    })

    // WorkbenchView.restoreThread() 的等价动作：写回装配期读到的同一个 id
    await session.threads.select('th_1')
    await settle()
    await settle()

    expect(requests.some((url) => url.includes('/next-actions'))).toBe(true)
    expect(session.nextSteps.steps.value).toEqual(CARDS)
  })
})
