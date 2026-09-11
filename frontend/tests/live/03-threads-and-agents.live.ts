/**
 * US5 历史会话与新建 + US6 数字人与 MCP —— **真实后端**。
 *
 * 重点验证：
 * - `GET /api/threads` 一次拉全量、**URL 不含 `limit`/`offset`**，"更多"是纯前端切片不发请求
 * - 详情分页 `offset += limit` 的**前插**行为
 * - 新建会话**不设总数上限**；并发上限（3）由发消息端返回 `THREAD_BUSY_LIMIT`
 * - `switchTo` 严格 **exit → select** 顺序（FR-037）
 * - MCP 红/绿双通道（`demo2` 配了一绿一红）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  cleanupTrackedThreads,
  createLiveSession,
  selectAgent,
  trackThread,
  trackedThreadIds,
  until,
  type LiveSession,
} from './harness'

const AGENT = 'demo2'

let live: LiveSession

describe('US5 历史会话与新建（真实后端）', () => {
  beforeAll(async () => {
    live = createLiveSession()
    await selectAgent(live, AGENT)
  })

  afterAll(async () => {
    await cleanupTrackedThreads(live.session)
  })

  it('loadList 一次性拉全量：URL 不含 limit / offset（差异 2 修正后口径）', async () => {
    const { threads } = live.session
    live.resetCalls()

    await threads.loadList()

    const listed = live.calls.find((call) => call.method === 'GET' && call.path === '/api/threads')
    expect(listed, '未发出列表请求').toBeTruthy()
    expect(listed?.query.has('limit')).toBe(false)
    expect(listed?.query.has('offset')).toBe(false)
    expect(Array.isArray(threads.list.value)).toBe(true)
  })

  it('前端切片：默认 10 条 →「更多」切 100 条且不发请求（FR-039/040）', () => {
    const { threads } = live.session
    const total = threads.list.value.length

    expect(threads.limit.value).toBe(10)
    expect(threads.visible.value.length).toBe(Math.min(10, total))

    live.resetCalls()
    threads.showMore()

    expect(threads.limit.value).toBe(100)
    expect(threads.visible.value.length).toBe(Math.min(100, total))
    expect(live.calls).toHaveLength(0)
  })

  it('select + 分页：loadMore 前插更早消息（FR-025）', async () => {
    const { threads } = live.session
    await threads.loadList()

    const seeded = threads.list.value.find((item) => (item.title ?? '').startsWith('itest-'))
    if (!seeded) throw new Error('需要先跑 prepare-integration-data.ts all')
    await threads.select(seeded.thread_id)

    expect(threads.total.value).toBe(120)
    expect(threads.messages.value).toHaveLength(50)
    expect(threads.hasMore.value).toBe(true)
    const firstId = threads.messages.value[0]?.id

    await threads.loadMore()

    expect(threads.messages.value).toHaveLength(100)
    expect(threads.messages.value[0]?.id).not.toBe(firstId)
    expect(threads.hasMore.value).toBe(true)
  })

  it('create 不受会话总数限制：连续创建 4 个均成功、无上限提示（FR-041/042）', async () => {
    const { threads, toast } = live.session
    await threads.loadList()

    const seen = new Set(threads.list.value.map((item) => item.thread_id))
    toast.clear()

    for (let i = 0; i < 4; i += 1) {
      await threads.create()
      const created = threads.activeId.value
      if (!created || seen.has(created)) throw new Error(`第 ${i + 1} 个会话创建失败`)
      seen.add(created)
      trackThread(created)
    }

    expect(seen.size).toBeGreaterThanOrEqual(4)
    expect(toast.items.value.some((item) => item.text.includes('上限'))).toBe(false)
  })

  it('删除会话：真实 DELETE 后从列表消失且选中态清空（§3.5）', async () => {
    const { threads } = live.session
    await threads.loadList()

    // 只删本文件自己创建的会话，绝不碰预置数据与用户数据
    let target = threads.list.value.find((item) => trackedThreadIds().includes(item.thread_id))
    if (!target) {
      // 本文件还没建过 → 先建一个再删（创建不受会话总数限制）
      const before = new Set(threads.list.value.map((item) => item.thread_id))
      await threads.create()
      const created = threads.activeId.value
      if (created && !before.has(created)) {
        trackThread(created)
        target = threads.list.value.find((item) => item.thread_id === created)
      }
    }
    if (!target) throw new Error('无可删除的会话')
    await threads.select(target.thread_id)

    await threads.remove(target.thread_id)

    expect(threads.activeId.value).toBeNull()
    expect(threads.messages.value).toHaveLength(0)
    expect(threads.list.value.some((item) => item.thread_id === target.thread_id)).toBe(false)
  })
})

describe('US6 数字人与 MCP（真实后端）', () => {
  it('当前数字人与候选列表（FR-032）', async () => {
    const { agents } = live.session

    await agents.loadCurrent()
    expect(agents.currentAgent.value?.agent_name).toBe(AGENT)

    await agents.loadCandidates()
    const names = agents.candidates.value.map((item) => item.agent_name)
    expect(names).toContain('demo')
    expect(names).toContain(AGENT)
  })

  it('switchTo 严格 exit → select 顺序（FR-037）', async () => {
    const { agents } = live.session
    live.resetCalls()

    await agents.switchTo('demo')

    const exitIndex = live.calls.findIndex((call) => call.path.endsWith('/current/exit'))
    const selectIndex = live.calls.findIndex((call) => call.path.endsWith('/select'))
    expect(exitIndex).toBeGreaterThanOrEqual(0)
    expect(selectIndex).toBeGreaterThanOrEqual(0)
    expect(exitIndex).toBeLessThan(selectIndex)
    expect(agents.currentAgent.value?.agent_name).toBe('demo')
  })

  it('MCP 状态：轮询刷新出一绿一红双通道（FR-033 / SC-010）', async () => {
    const { agents, chat } = live.session
    await selectAgent(live, AGENT)

    const connected = (): boolean =>
      agents.mcpServers.value.some((item) => item.status === 'connected')

    agents.startMcpPolling()
    try {
      await until(connected, 'MCP 建连（轮询）', 20_000)
    } catch {
      // 实例是"首条消息"才创建的：发一条消息触发建连，再等一轮轮询
      chat.setThinking(false)
      await chat.send({ content: '只回复：好', attachments: [] })
      await until(connected, 'MCP 建连（触发实例创建后）', 25_000)
    } finally {
      agents.stopMcpPolling()
    }

    const servers = agents.mcpServers.value.map((item) => ({
      name: item.name,
      status: item.status,
    }))
    expect(servers).toHaveLength(2)
    const echo = servers.find((item) => item.name === 'itest-echo')
    const broken = servers.find((item) => item.name === 'itest-broken-mcp')
    expect(echo?.status).toBe('connected')
    expect(broken?.status).toBe('failed')
  })
})
