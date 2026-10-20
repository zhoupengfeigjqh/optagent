/**
 * 单元测试：全局会话上下文装配（002 刷新恢复 / 007 下一步动作卡片 / 009 切换编排）。
 *
 * 守住一条关键不变式：**`activeThreadId` 在装配期必须为 `null`**。
 * 它表达"当前选中"这一状态，只由选中动作驱动；"要恢复哪个会话"由 `initialThreadId` 表达，
 * 二者各司其职。一旦用 `initialThreadId` 预置该 ref，`useNextSteps` / `useChatStream` 的
 * watch 收不到"变化"，刷新时（`WorkbenchView.restoreThread` 写回同一个 id）下一步动作卡片
 * 就永不恢复——即"刷新后卡片消失、点其它会话却能看到"。
 *
 * 009 追加：**切换数字人的收尾编排**（`onSwitched`）＝ 进入空对话视图（`startNew`）→
 * 重取会话列表 → 重取文件空间 → 重取后台产出（铃铛是常驻组件，不重取就会一直显示上一个
 * 数字人的记录）；且全程 **MUST NOT** 创建空会话。
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

/** 已完成轮次的 SSE 脚本：一段正文 + done（message_id 非 null ⇒ completed） */
const DONE_SCRIPT = [
  'event: content',
  'data: {"delta":"你好"}',
  '',
  'event: done',
  'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":1.2,"message_id":"m_1","agent_name":"agent-a"}',
  '',
  '',
].join('\n')

/**
 * 009：切换数字人的端到端编排（真实装配 + fetch 桩）。
 *
 * 记录每一次请求（URL + method），逐条断言"切换后做了什么 / 没做什么"。
 */
function makeSwitchSession() {
  const requests: Array<{ url: string; method: string }> = []
  // 服务端唯一选中态：select 之后 current 返回新的那一个（固定返回值会让"切换生效"看不出区别）
  let selectedName = 'agent-a'

  const session = createAppSession({
    storage: memoryStorage(),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, method: (init?.method ?? 'GET').toUpperCase() })

      const selected = /\/api\/agents\/([^/?]+)\/select$/.exec(url)
      if (selected) {
        selectedName = decodeURIComponent(selected[1]!)
        return respond({ agent_name: selectedName, selected: true })
      }
      if (url.includes('/api/agents/current/mcp')) {
        return respond({ agent_name: selectedName, mcp_servers: [] })
      }
      if (url.includes('/api/agents/current')) return respond({ agent_name: selectedName })
      if (url.includes('/api/agents/')) {
        return respond({
          ...DETAIL,
          agent_name: selectedName,
          skills: [],
          enabled_tools: [],
          mcp_servers: [],
        })
      }
      if (url.includes('/api/threads')) return respond([])
      if (url.includes('/api/files/workspace')) return respond({ spaces: [] })
      if (url.includes('/api/produced')) return respond({ items: [] })
      return respond({})
    }) as unknown as typeof fetch,
  })
  return { session, requests }
}

describe('切换数字人 → 进入新的空对话视图（009 FR-010/FR-022）', () => {
  it('切换后：清空当前会话、重取会话列表与文件空间，且**不创建**空会话', async () => {
    const { session, requests } = makeSwitchSession()

    await session.agents.loadCurrent()
    expect(session.agents.currentAgent.value?.agent_name).toBe('agent-a')

    const before = requests.length
    await session.agents.switchTo('agent-b')
    await settle()
    await settle()

    const after = requests.slice(before)
    // 选中 + 重新读取当前数字人详情/状态 + 会话列表 + 文件空间 + 后台产出
    expect(after.some((item) => item.method === 'POST' && item.url.includes('/select'))).toBe(true)
    expect(after.some((item) => item.url.includes('/api/threads'))).toBe(true)
    expect(after.some((item) => item.url.includes('/api/files/workspace'))).toBe(true)
    // 产出清单按数字人隔离：切换后必须重拉，否则铃铛一直显示上一个数字人的记录
    expect(after.some((item) => item.url.includes('/api/produced'))).toBe(true)

    // MUST NOT 落盘空会话：没有任何创建会话的 POST
    expect(
      after.filter((item) => item.method === 'POST' && item.url.endsWith('/api/threads')),
    ).toEqual([])

    // 视图已回到空对话
    expect(session.threads.activeId.value).toBeNull()
    expect(session.threads.messages.value).toEqual([])
    expect(session.agents.currentAgent.value?.agent_name).toBe('agent-b')
  })
})

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

describe('轮末刷新会话列表（首句完成后新会话带标题进入侧栏）', () => {
  it('一轮完成（onTurnFinished）：重拉列表，新会话带标题进入 list', async () => {
    // 服务端列表：首条消息落盘前为空，之后返回一条带标题的会话（后端即时回落标题）
    let threadList: unknown[] = []
    const requests: Array<{ url: string; method: string }> = []

    const session = createAppSession({
      storage: memoryStorage(),
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        requests.push({ url, method })

        if (url.includes('/api/agents/current/mcp')) {
          return respond({ agent_name: 'agent-a', mcp_servers: [] })
        }
        if (url.includes('/api/agents/current')) return respond({ agent_name: 'agent-a' })
        if (url.includes('/api/agents/')) {
          return respond({
            ...DETAIL,
            agent_name: 'agent-a',
            skills: [],
            enabled_tools: [],
            mcp_servers: [],
          })
        }
        // 发消息：返回一条完成轮次的 SSE 流；"落盘"后列表里出现这条会话
        if (/\/api\/threads\/[^/]+\/messages$/.test(url)) {
          threadList = [
            {
              thread_id: 'th_new',
              agent_name: 'agent-a',
              title: '你好',
              created_at: '',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ]
          return new Response(DONE_SCRIPT, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        // 新建会话
        if (method === 'POST' && url.endsWith('/api/threads')) {
          return respond({ thread_id: 'th_new', title: null, created_at: '' })
        }
        // 会话列表
        if (method === 'GET' && url.endsWith('/api/threads')) return respond(threadList)
        // 会话详情
        if (/\/api\/threads\/[^/]+$/.test(url)) return respond(DETAIL)
        if (url.includes('/api/files/workspace')) return respond({ spaces: [] })
        return respond({})
      }) as unknown as typeof fetch,
    })

    // 选中数字人 → 新建对话视图 → 发首条消息（等价 useChatPanel.onSend 的链路）
    await session.agents.loadCurrent()
    session.threads.startNew()
    await session.threads.create()
    // 创建后列表还是空的（尚无任何消息，服务端剔除空会话）
    expect(session.threads.list.value).toEqual([])

    await session.chat.send({ content: '你好', attachments: [] })

    // 首轮完成后：列表被重拉，新会话带标题进入
    expect(session.threads.list.value.map((item) => item.thread_id)).toContain('th_new')
    expect(session.threads.list.value.map((item) => item.title)).toContain('你好')
    // 列表接口在 create 与轮末各拉一次（轮末这一次是本次修复点）
    expect(
      requests.filter((r) => r.method === 'GET' && r.url.endsWith('/api/threads')),
    ).toHaveLength(2)
  })
})
