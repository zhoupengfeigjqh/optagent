import { defineComponent, h, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FileReference } from '../api/types'
import { SPACE_DIRECTORIES } from '../constants/directories'
import {
  createFetchRouter,
  jsonResponse,
  memoryStorage,
  mountInSession,
  waitFor,
} from '../../tests/helpers'
import { useChatPanel } from './useChatPanel'

type Panel = ReturnType<typeof useChatPanel>

const AGENT = {
  agent_name: 'ops',
  description: '排产',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

/** 默认路由：覆盖挂载时的 `models.load()` 与 `agents.loadCurrent()` */
function defaultRoutes() {
  return {
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    'GET /api/agents/ops': () => jsonResponse(AGENT),
    'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    'GET /api/files/workspace': () => jsonResponse({ dirs: [] }),
  }
}

/**
 * 以最小宿主组件调用 `useChatPanel()`：直接驱动接线处理器，
 * 无需经过完整 DOM 交互即可覆盖装配层分支。
 */
function setupPanel(extraRoutes: Parameters<typeof createFetchRouter>[0] = {}) {
  const router = createFetchRouter({ ...defaultRoutes(), ...extraRoutes })
  let panel!: Panel
  const Harness = defineComponent({
    name: 'ChatPanelHarness',
    setup() {
      panel = useChatPanel()
      return () => h('div')
    },
  })
  const { wrapper, session } = mountInSession(Harness, {
    sessionOptions: { fetchImpl: router.fetch, storage: memoryStorage() },
  })
  return { panel: panel!, session, router, wrapper }
}

function detailBody(total: number, messageCount: number) {
  return {
    thread_id: 't1',
    agent_name: 'ops',
    title: '会话',
    created_at: '2026-09-10T08:00:00.000Z',
    updated_at: '2026-09-10T08:00:02.000Z',
    total,
    running: false,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `m${index}`,
      role: 'assistant' as const,
      content: `第 ${index} 条`,
      ts: '2026-09-10T08:00:01.000Z',
      feedback: null,
    })),
  }
}

describe('useChatPanel - 搜索与工作空间开关（US8）', () => {
  it('搜索开关与关键词受控', () => {
    const { panel, session } = setupPanel()

    panel.onToggleSearch()
    expect(session.search.isOpen.value).toBe(true)

    panel.onSearchKeyword('甲')
    expect(session.search.keyword.value).toBe('甲')
    expect(session.search.total.value).toBe(0)

    panel.onToggleSearch()
    expect(session.search.isOpen.value).toBe(false)
  })

  it('工作空间开关：打开时刷新清单并停在列表态，再点收起', async () => {
    const { panel, session, router } = setupPanel()

    panel.onToggleWorkspace()
    expect(panel.workspaceOpen.value).toBe(true)
    expect(session.preview.view.value).toBe('list')
    await waitFor(() => router.countOf('GET', '/api/files/workspace') === 1, '未刷新工作空间')

    // 再点一次即收起整个面板（列表态 → 关闭）
    panel.onToggleWorkspace()
    expect(panel.workspaceOpen.value).toBe(false)
    expect(session.preview.open.value).toBe(false)
  })

  it('内容态下点工具栏按钮：退回列表态而非收起面板', async () => {
    const { panel, session } = setupPanel()

    // 面板可能被消息内的文件引用打开在内容态，此时工具栏按钮不高亮
    await session.preview.openFile({ dir: 'tmp', filename: 'plan.csv' })
    expect(panel.workspaceOpen.value).toBe(false)

    panel.onToggleWorkspace()
    expect(panel.workspaceOpen.value).toBe(true)
    expect(session.preview.open.value).toBe(true)
  })

  it('下载以直链触发（无大小上限，由面板承担）', () => {
    const { session } = setupPanel()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    session.preview.download({ dir: 'tmp', filename: 'plan.csv' })

    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})

describe('useChatPanel - 数字人面板（US6）', () => {
  it('打开时拉取候选、关闭时复位；失败不阻断', async () => {
    const { panel, router } = setupPanel({
      'GET /api/agents': () => jsonResponse([{ agent_name: 'ops', description: '排产' }]),
    })

    expect(panel.agentPanelOpen.value).toBe(false)

    panel.onToggleAgent()
    expect(panel.agentPanelOpen.value).toBe(true)
    await waitFor(() => router.countOf('GET', '/api/agents') === 1, '未拉取候选列表')

    panel.onCloseAgentPanel()
    expect(panel.agentPanelOpen.value).toBe(false)
  })
})

describe('useChatPanel - 输入区工具（US3）', () => {
  it('思考开关与模型选择落到对应 composable', () => {
    const { panel, session } = setupPanel()

    panel.onToggleThinking()
    expect(session.chat.thinkingEnabled.value).toBe(true)
    panel.onToggleThinking()
    expect(session.chat.thinkingEnabled.value).toBe(false)

    panel.onSelectModel('qwen-plus')
    expect(session.models.current.value).toBe('qwen-plus')
  })

  it('上传面板开合；不合规文件直接失败且不发请求', async () => {
    const { panel, router } = setupPanel()
    const invalid = new File(['x'], 'a.exe', { type: 'application/octet-stream' })

    panel.onToggleUpload()
    expect(panel.uploadOpen.value).toBe(true)

    panel.onPickFiles({ dir: 'tmp', files: [invalid] as unknown as FileList })
    await waitFor(() => panel.uploads.items.value.length === 1, '未生成上传项')

    expect(panel.uploads.items.value[0].status).toBe('failed')
    expect(router.countOf('POST', '/api/files/upload')).toBe(0)

    const localId = panel.uploads.items.value[0].localId
    panel.onRetryUpload(localId)
    await waitFor(() => panel.uploads.items.value[0].status === 'failed', '重试未收敛')
    expect(router.countOf('POST', '/api/files/upload')).toBe(0)

    panel.onCloseUpload()
    expect(panel.uploadOpen.value).toBe(false)
  })
})

describe('useChatPanel - @ 引用键盘与同步（US4）', () => {
  it('方向键移动高亮、Esc 收起面板', () => {
    const { panel, session } = setupPanel()

    session.mention.open.value = true
    session.mention.stage.value = 'dir'
    session.mention.activeIndex.value = 0

    panel.onMentionKey('ArrowDown')
    expect(session.mention.activeIndex.value).toBe(1)

    panel.onMentionKey('ArrowUp')
    expect(session.mention.activeIndex.value).toBe(0)

    panel.onMentionKey('Escape')
    expect(session.mention.open.value).toBe(false)
    // 关闭面板不丢文本（US4 场景 8）
    expect(session.chat.draft.value).toBe('')
  })

  it('Enter 在目录阶段选中高亮目录并进入文件阶段', async () => {
    const { panel, session } = setupPanel()

    session.mention.open.value = true
    session.mention.stage.value = 'dir'
    session.mention.activeIndex.value = 2

    panel.onMentionKey('Enter')

    expect(session.mention.stage.value).toBe('file')
    expect(session.mention.activeDir.value).toBe(SPACE_DIRECTORIES[2].dir)
  })

  it('选中文件后插入完整标记并收起面板；移除引用同步删除标记', () => {
    const { panel, session } = setupPanel()
    const reference: FileReference = { dir: 'tmp', filename: 'plan.csv' }

    session.mention.open.value = true
    session.chat.draft.value = '@p'

    panel.onPickFile(reference)

    expect(session.chat.draft.value).toBe('@plan.csv ')
    expect(session.mention.references.value).toEqual([reference])
    expect(session.mention.open.value).toBe(false)

    panel.onRemoveReference(reference)
    expect(session.chat.draft.value).toBe('')
    expect(session.mention.references.value).toEqual([])
  })

  it('超出上限时不插入且不新增引用', () => {
    const { panel, session } = setupPanel()
    session.chat.draft.value = '@p'

    for (let index = 0; index < 10; index += 1) {
      panel.onPickFile({ dir: 'tmp', filename: `f${index}.csv` })
    }
    expect(session.mention.references.value).toHaveLength(10)

    panel.onPickFile({ dir: 'tmp', filename: 'overflow.csv' })
    expect(session.mention.references.value).toHaveLength(10)
  })
})

describe('useChatPanel - 会话历史与恢复（US1 / US5）', () => {
  it('onLoadMore 触发更早消息的分页请求', async () => {
    const { panel, session, router } = setupPanel({
      'GET /api/threads/t1': () => jsonResponse(detailBody(80, 50)),
    })
    ;(session.threads.activeId as unknown as Ref<string | null>).value = 't1'
    await session.threads.refresh()
    expect(session.threads.hasMore.value).toBe(true)

    panel.onLoadMore()
    await waitFor(() => router.countOf('GET', '/api/threads/t1') === 2, '未触发分页请求')

    const detailCalls = router.calls.filter((call) => call.path === '/api/threads/t1')
    // 分页详情请求带 offset（从最新往前数）
    expect(detailCalls[0].query.has('offset')).toBe(false)
    expect(detailCalls[1].query.get('offset')).toBe('50')
  })

  it('onRecover 重新拉取会话详情并回到 completed', async () => {
    const { panel, session, router } = setupPanel({
      'GET /api/threads/t1': () => jsonResponse(detailBody(1, 1)),
    })
    ;(session.threads.activeId as unknown as Ref<string | null>).value = 't1'
    ;(session.chat.phase as unknown as Ref<string>).value = 'failed'

    panel.onRecover()

    await waitFor(() => router.countOf('GET', '/api/threads/t1') === 1, '未重新获取会话')
    await waitFor(() => session.chat.phase.value === 'completed', '未回到 completed')
  })

  it('onOpenLink 直跳新窗口且不改动预览目标（V-10）', () => {
    const { panel, session } = setupPanel()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    panel.onOpenLink('https://example.com/docs')

    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
    expect(session.preview.target.value).toEqual({ kind: 'none' })
    open.mockRestore()
  })

  it('卸载时停止 MCP 轮询', () => {
    const { wrapper } = setupPanel()
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
