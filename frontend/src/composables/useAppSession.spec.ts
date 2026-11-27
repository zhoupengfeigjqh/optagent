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
  actions: [{ prompt: '继续看看', tool_tips: [] }],
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const DONE_SCRIPT = [
  'event: content',
  'data: {"delta":"你好"}',
  '',
  'event: done',
  'data: {"finish_reason":"completed","usage":{"input_tokens":1,"output_tokens":2},"duration_seconds":1.2,"message_id":"m_1","agent_name":"agent-a"}',
  '',
  '',
].join('\n')

function makeSwitchSession(workspaceSpaces: unknown[] = []) {
  const requests: Array<{ url: string; method: string }> = []
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
      if (url.includes('/api/files/workspace')) return respond({ spaces: workspaceSpaces })
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
    expect(after.some((item) => item.method === 'POST' && item.url.includes('/select'))).toBe(true)
    expect(after.some((item) => item.url.includes('/api/threads'))).toBe(true)
    expect(after.some((item) => item.url.includes('/api/files/workspace'))).toBe(true)
    // 产出清单按数字人隔离：切换后必须重拉，否则铃铛一直显示上一个数字人的记录
    expect(after.some((item) => item.url.includes('/api/produced'))).toBe(true)

    // MUST NOT 落盘空会话：没有任何创建会话的 POST
    expect(
      after.filter((item) => item.method === 'POST' && item.url.endsWith('/api/threads')),
    ).toEqual([])

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

    await session.threads.select('th_1')
    await settle()
    await settle()

    expect(requests.some((url) => url.includes('/next-actions'))).toBe(true)
    expect(session.nextSteps.steps.value).toEqual(CARDS)
  })
})

describe('轮末刷新会话列表（首句完成后新会话带标题进入侧栏）', () => {
  it('一轮完成（onTurnFinished）：重拉列表，新会话带标题进入 list', async () => {
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
        if (method === 'POST' && url.endsWith('/api/threads')) {
          return respond({ thread_id: 'th_new', title: null, created_at: '' })
        }
        if (method === 'GET' && url.endsWith('/api/threads')) return respond(threadList)
        if (/\/api\/threads\/[^/]+$/.test(url)) return respond(DETAIL)
        if (url.includes('/api/files/workspace')) return respond({ spaces: [] })
        return respond({})
      }) as unknown as typeof fetch,
    })

    await session.agents.loadCurrent()
    session.threads.startNew()
    await session.threads.create()
    expect(session.threads.list.value).toEqual([])

    await session.chat.send({ content: '你好', attachments: [] })

    expect(session.threads.list.value.map((item) => item.thread_id)).toContain('th_new')
    expect(session.threads.list.value.map((item) => item.title)).toContain('你好')
    expect(
      requests.filter((r) => r.method === 'GET' && r.url.endsWith('/api/threads')),
    ).toHaveLength(2)
  })
})

describe('切换数字人 → 空数据引导判定（014 FR-005/FR-006）', () => {
  const EMPTY_PREP_SPACES = [
    {
      name: '数据准备',
      agent_writable: false,
      upload_extensions: ['.csv'],
      dirs: [
        {
          dir: '数据准备/算法规则',
          label: '算法规则',
          deletable: true,
          files: [],
          fields: [],
          upload_extensions: ['.csv'],
          predefined: true,
        },
        {
          dir: '数据准备/生产计划',
          label: '生产计划',
          deletable: true,
          files: [],
          fields: [],
          upload_extensions: ['.csv'],
          predefined: false,
        },
      ],
    },
  ]

  it('首次加载不弹；切换成功后按新清单判定并弹出', async () => {
    const { session } = makeSwitchSession(EMPTY_PREP_SPACES)

    await session.agents.loadCurrent()
    expect(session.emptyHint.visible.value).toBe(false)

    await session.agents.switchTo('agent-b')
    await settle()
    await settle()

    expect(session.emptyHint.visible.value).toBe(true)
  })

  it('切换到清单不满足条件的数字人 → 不弹', async () => {
    const { session } = makeSwitchSession([])

    await session.agents.loadCurrent()
    await session.agents.switchTo('agent-b')
    await settle()
    await settle()

    expect(session.emptyHint.visible.value).toBe(false)
  })

  it('切换失败 → 保持不弹（不拿旧清单误判）', async () => {
    const session = createAppSession({
      storage: memoryStorage(),
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/select')) throw new Error('数字人不可用')
        if (url.includes('/api/agents/current/mcp'))
          return respond({ agent_name: 'agent-a', mcp_servers: [] })
        if (url.includes('/api/agents/current')) return respond({ agent_name: 'agent-a' })
        if (url.includes('/api/files/workspace')) return respond({ spaces: EMPTY_PREP_SPACES })
        return respond({})
      }) as unknown as typeof fetch,
    })

    await session.agents.loadCurrent()
    expect(session.emptyHint.visible.value).toBe(false)

    await session.agents.switchTo('agent-b').catch(() => undefined)
    await settle()

    expect(session.emptyHint.visible.value).toBe(false)
  })
})
